import type { Patch } from "immer";
import type { z } from "zod";
import type {
  AbortSignalLike,
  LlmClient,
  LlmMessage,
  LlmRequest,
  LlmUsage,
  Rng,
} from "../kernel/ports";
import type { Command } from "../kernel/system";
import type { Closeup, LogRecord } from "../kernel/turnlog";
import { effectiveTurns } from "../kernel/turnlog";
import type { WorldState } from "../kernel/world";
import {
  CharacterStateSchema,
  TRAIT_LABELS,
  type Trait,
  type TraitSlot,
} from "../systems/character";
import { OFFSCREEN_SCENES } from "../systems/city";
import { CombatStateSchema, MAX_QUICK } from "../systems/combat";
import { CyberwareStateSchema, cyberwareCatalog } from "../systems/cyberware";
import {
  CheckProposalSchema,
  type CheckSpec,
  checkFactFrom,
  legacyDvToEdge,
  resolveCheck,
  rollFaces,
} from "../systems/dice";
import { falloutKinds } from "../systems/fallout";
import { HealthStateSchema } from "../systems/health";
import { itemCatalog, shopList } from "../systems/inventory/apply";
import { InventoryStateSchema, type ItemDef } from "../systems/inventory/schema";
import { IncomingMessageSchema, MESSAGES_PER_TURN } from "../systems/phone";
import { registry } from "../systems/registry";
import {
  autoMove,
  type PlannedTrip,
  planTrip,
  tripFact,
  tripText,
  tripWorldOf,
} from "../systems/travel";
import { formatGameTime, WorldClockStateSchema, withSavedPlaces } from "../systems/world";
import {
  type Choice,
  ChoiceProposalSchema,
  ExtractDocSchema,
  type ExtractShape,
  GateProposalSchema,
  issueText,
  legacyGate,
  MAX_CHOICES,
  MAX_VOICES,
  parseModelJson,
  readExtractShape,
  StateSplitter,
  type Voice,
  VoiceSchema,
} from "./block";
import {
  BUDGET_LABELS,
  type BudgetTrace,
  contextBudget,
  fitMemories,
  historyTurns,
  MIN_HISTORY,
  memoryTokens,
} from "./budget";
import { schemaDoc } from "./doc";
import { type LoreSource, type LoreTrace, lookupLore } from "./lore";
import {
  buildOffscreenPrompt,
  OFFSCREEN_TEMPERATURE,
  offscreenDue,
  offscreenSkipReason,
  presentNpcs,
  readOffscreen,
} from "./offscreen";
import { prepareFor, type RolledCheck } from "./pending";
import { applyPreset, applyPresetRegex, type TavernPreset } from "./preset";
import {
  buildExtractPrompt,
  buildJudgePrompt,
  buildNarratorPrompt,
  buildVerifyPrompt,
  EXTRACT_TEMPERATURE,
  HISTORY_TURNS,
  JUDGE_TEMPERATURE,
  NARRATE_LENGTH,
  NARRATE_LENGTH_PRESET,
  type NarratorPlan,
  type PromptExtras,
  VERIFY_TEMPERATURE,
} from "./prompts";
import { estimateTokens } from "./prompts/layers";
import { type Expansion, expandMemories, judgeCandidates, memoryPool } from "./retrieve";
import { closeupFor, sceneTitle } from "./scene";
import {
  applyFix,
  type BigSpend,
  BuyProposalSchema,
  bigSpend,
  type GateResult,
  gateText,
  JudgeDocSchema,
  type JudgeShape,
  judgeGate,
  MAX_RECALL,
  type Memory,
  parseFlags,
  parsePatch,
  readJudgeShape,
  skipStop,
} from "./stages";
import { buildSummaryPrompt, readSummary, SUMMARY_TEMPERATURE } from "./summary";

/**
 * 一轮五步：① 判断（叙事模型，JSON）→ ② 拼上下文 → ③ 写正文（叙事模型，纯文本，边收边放）
 * → ④ 抽取（辅助模型，JSON）→ ⑤ 核对（辅助模型，<patch>）→ 代码校验和记账。
 * 只算出结果，不写日志：写日志、加锁和版本核对由调用方负责
 */

export interface Dropped {
  /** 出问题的位置，例如 changes[2]、check、choices[1]、抽取 */
  readonly where: string;
  readonly raw: unknown;
  readonly reason: string;
  /** format：格式不合格，修过一次仍不行；verify：核对认为正文里没有依据；rules：业务校验没通过 */
  readonly stage: "format" | "verify" | "rules";
}

/** 同一句提示一轮只记一次 */
function noteOnce(notes: string[], note: string): void {
  if (!notes.includes(note)) notes.push(note);
}

/** 建议选项里的检定或门槛仍写了数字时，先换成档位再校验 */
function legacyChoice(item: unknown, notes: string[]): unknown {
  if (typeof item !== "object" || item === null || Array.isArray(item)) return item;
  let out = item as Record<string, unknown>;
  if ("check" in out) {
    const legacy = legacyDvToEdge(out.check);
    if (legacy.note !== undefined) {
      noteOnce(notes, legacy.note);
      out = { ...out, check: legacy.value };
    }
  }
  if ("gate" in out) {
    const legacy = legacyGate(out.gate);
    if (legacy.note !== undefined) {
      noteOnce(notes, legacy.note);
      out = { ...out, gate: legacy.value };
    }
  }
  return out;
}

/** 关键条目：被拒、被丢或被核对删掉时，这一轮正文标为未定稿 */
const KEY_ITEMS: Readonly<Record<string, string>> = {
  damage: "伤害",
  "health.limb": "断肢",
  "health.die": "死亡",
  npcDeath: "人物死亡",
  money: "欧元",
  trade: "买卖",
  loot: "零钱",
  item: "物品",
  jobEnd: "委托结局",
};

/** 互相关联的条目：一种没生效，跟着它的也不生效（付钱和拿货互相跟，受伤跟着开战） */
type Role = "pay" | "goods" | "fightStart" | "hit";

const ROLE_LABELS: Readonly<Record<Role, string>> = {
  pay: "付钱",
  goods: "拿货",
  fightStart: "开战",
  hit: "受伤",
};

const FOLLOWERS: Readonly<Record<Role, readonly Role[]>> = {
  pay: ["goods"],
  goods: ["pay"],
  fightStart: ["hit"],
  hit: [],
};

function roleOf(raw: unknown): Role | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const c = raw as { type?: unknown; delta?: unknown; action?: unknown };
  if (c.type === "money" && typeof c.delta === "number" && c.delta < 0) return "pay";
  // 买东西一条里同时付钱和拿货，不用跟别的条目配对；买服务、交罚款算付钱
  if (c.type === "trade" && c.action === "service") return "pay";
  if (c.type === "item" && c.action === "gain") return "goods";
  if (c.type === "combat" && c.action === "start") return "fightStart";
  if (c.type === "damage") return "hit";
  return undefined;
}

/** 去掉跟着没生效条目的那些，记进 dropped */
function dropFollowers(
  b: TurnBuilder,
  commands: readonly Command[],
  failed: ReadonlySet<Role>,
): Command[] {
  return commands.filter((command) => {
    const role = roleOf(command);
    if (!role) return true;
    const cause = [...failed].find((r) => FOLLOWERS[r].includes(role));
    if (!cause) return true;
    b.drop(command.type, command, `同一轮的${ROLE_LABELS[cause]}没生效，这一条跟着不算`, "rules");
    return false;
  });
}

/** 正文和账目对不上的原因；没有关键条目出问题时为 undefined */
export function unsettledReason(dropped: readonly Dropped[]): string | undefined {
  for (const d of dropped) {
    if (d.where === "抽取") return "这一轮的记账没抽出来，状态没有变";
    const raw = d.raw;
    if (typeof raw !== "object" || raw === null) continue;
    const type = (raw as { type?: unknown }).type;
    if (typeof type !== "string") continue;
    const label = type === "world" && "location" in raw ? "移动" : KEY_ITEMS[type];
    if (label) return `${label}没有记上：${d.reason}`;
  }
  return undefined;
}

export interface NarratorTurn {
  /** 正文 */
  readonly text: string;
  readonly read: string | undefined;
  readonly choices: readonly Choice[];
  /** 内心声音，0–2 条 */
  readonly voices: readonly Voice[];
  /** 判断给出、等玩家确认的检定；当场掷过的不在这里，见 rolled */
  readonly check: CheckSpec | undefined;
  /** 当场掷过的检定（用户 2026-11-01 选的「全改」）：骰子记进这一轮的 dice，不再等确认 */
  readonly rolled: RolledCheck | undefined;
  /** 判断给出的门槛和代码判定的结果 */
  readonly gate: GateResult | undefined;
  /** 生效的指令，按结算顺序 */
  readonly commands: readonly Command[];
  readonly dropped: readonly Dropped[];
  /** 未定稿：关键条目没记上时的原因；正文照常显示，但不进旧记忆、不弹特写卡 */
  readonly unsettled: string | undefined;
  /** 抽取考虑过但没抽的，和原因 */
  readonly considered: readonly string[];
  /** 判断给检定或门槛时写的理由，只供剧透视图 */
  readonly ruling: string | undefined;
  /** ⑥ 场外推演跑了时：发出的用户消息和原始回复，只供剧透视图 */
  readonly offscreen: { readonly prompt: string; readonly reply: string } | undefined;
  /** ⑥ 收了场却没推演时的原因，只供剧透视图 */
  readonly offscreenSkip: string | undefined;
  /** ⑦ 场景摘要跑了时：发出的用户消息和原始回复，只供剧透视图 */
  readonly summary: { readonly prompt: string; readonly reply: string } | undefined;
  readonly notes: readonly string[];
  /** ⑤ 审守则的提醒（替玩家角色说话、泄露秘密、死人出场）；只供剧透视图，不拦这一轮 */
  readonly flags: readonly string[];
  readonly world: WorldState;
  readonly patches: readonly Patch[];
  readonly modules: readonly string[];
  readonly pin: boolean;
  /** 生死瞬间：下一轮可以开斯安威斯坦 */
  readonly clutch: boolean;
  /** 这一轮发生在第几个场景 */
  readonly scene: number;
  /** 场景标题卡的一行；还没有地点时为 undefined */
  readonly title: string | undefined;
  /** 这一轮弹出的特写卡 */
  readonly closeup: Closeup | undefined;
  /** 判断认为这次是场外提问：不改状态，也不顶掉上一轮的选项和检定 */
  readonly ooc: boolean;
  /** 叙事模型的用量（判断和写正文） */
  readonly usage: LlmUsage | undefined;
  /** 辅助模型抽取和核对的用量 */
  readonly auxUsage: LlmUsage;
  /** 修格式用的辅助模型调用次数和用量 */
  readonly repairs: number;
  readonly repairUsage: LlmUsage;
  /** 写正文时发给叙事模型的消息，上下文查看器和测评用 */
  readonly messages: readonly LlmMessage[];
  /** 写正文之前代码定下的事，记进回合日志，上下文查看器重建写正文那一步用 */
  readonly decided: readonly string[];
  /** 判断调出的旧记忆 */
  readonly recalled: readonly Memory[];
  /** 扩展层按分数补进来的旧记忆（不含判断调的） */
  readonly expanded: readonly Memory[];
  /** 扩展层为什么检索、前几名的分数和退回原因；没检索时为 undefined，只供剧透视图 */
  readonly retrieval: Expansion | undefined;
  /** 设定库：检索词、挑中的原作资料和分数；没接文本库或没查时为 undefined，只供剧透视图 */
  readonly lore: LoreTrace | undefined;
  /** 上下文预算：窗口、各部分占用和额度、原文带了几轮、裁了什么；只供剧透视图 */
  readonly budget: BudgetTrace;
}

export type NarratorResult =
  | { readonly kind: "done"; readonly turn: NarratorTurn }
  | { readonly kind: "blocked"; readonly reason: string }
  /** 提交前确认：这一轮要一次花掉一大笔钱，先问玩家；什么都没写，取消不算一轮 */
  | ({ readonly kind: "confirmSpend" } & BigSpend);

export interface NarratorDeps {
  readonly llm: LlmClient;
  readonly rng: Rng;
  /** 静态数据表（content 包） */
  readonly data?: Readonly<Record<string, unknown>>;
  /** 这个存档的开场设定（内容包），故事还没开始时给模型 */
  readonly opening?: string | undefined;
  /** 开场的游戏时间；按它算原剧时间线走到第几天 */
  readonly startTime?: number | undefined;
  readonly signal?: AbortSignalLike;
  /** 每收到一段可以显示的正文就调用 */
  readonly onText?: (text: string) => void;
  /** 场外推演隔几场跑一次；null 是关掉，没写按默认 3 场 */
  readonly offscreen?: number | null | undefined;
  /** 路上偶遇的频率倍数；0 是关掉，没写按 1 */
  readonly encounters?: number | undefined;
  /** 设定库：本机官方文本库的只读检索；没有文本库时不接，这一步自动关掉 */
  readonly lore?: LoreSource | undefined;
  /** 叙事模型方案的上下文窗口（token）；按它分上下文预算，没给按 32K */
  readonly contextWindow?: number | undefined;
  /**
   * 玩家导入并启用的酒馆预设（用户定的）：只给写正文那一步，条目叠在本作提示词前面、本作规则在后，
   * 采样参数和正则也只用在这一步；判断、抽取、核对、修复、场外推演、摘要都不套
   */
  readonly preset?: TavernPreset | undefined;
  /** 预设宏里 {{user}} 换成什么：玩家角色名 */
  readonly userName?: string | undefined;
}

export class NarratorEmptyReplyError extends Error {
  override name = "NarratorEmptyReplyError";
}

export class NarratorAbortedError extends Error {
  override name = "NarratorAbortedError";
}

const REPAIR_SYSTEM =
  "你负责修复 JSON 格式。只输出修好的 JSON，不要解释，不要代码块。不改原意，不补充原文没有的内容；实在修不了就输出 null。";

const ZERO: LlmUsage = { inputTokens: 0, outputTokens: 0 };
/** 判断写的对手打算和裁决理由最多留几个字 */
const FOES_CHARS = 160;
const RULING_CHARS = 200;

const addUsage = (a: LlmUsage, b: LlmUsage | undefined): LlmUsage =>
  b
    ? { inputTokens: a.inputTokens + b.inputTokens, outputTokens: a.outputTokens + b.outputTokens }
    : a;

type Reply =
  | { readonly text: string; readonly usage: LlmUsage | undefined }
  | { readonly blocked: string };

/** 一条等核对的提议：抽取的 changes 或 messages，格式已经校验过 */
interface Proposal {
  readonly where: string;
  readonly kind: "change" | "message";
  value: Record<string, unknown>;
  readonly parse: (value: unknown) => Command | undefined;
}

class TurnBuilder {
  readonly dropped: Dropped[] = [];
  readonly notes: string[] = [];
  /** ⑤ 审守则的提醒，只供剧透视图 */
  readonly flags: string[] = [];
  repairs = 0;
  repairUsage: LlmUsage = ZERO;
  auxUsage: LlmUsage = ZERO;

  constructor(private readonly deps: NarratorDeps) {}

  checkAborted(): void {
    if (this.deps.signal?.aborted) throw new NarratorAbortedError("已停止生成");
  }

  drop(where: string, raw: unknown, reason: string, stage: Dropped["stage"]): void {
    this.dropped.push({ where, raw, reason, stage });
  }

  /** 调一次模型，收完全部文字 */
  async call(request: LlmRequest): Promise<Reply> {
    this.checkAborted();
    let text = "";
    let usage: LlmUsage | undefined;
    for await (const event of this.deps.llm.stream(request, this.deps.signal)) {
      if (event.type === "text") text += event.text;
      else if (event.type === "blocked") return { blocked: event.reason };
      else usage = event.usage;
    }
    this.checkAborted();
    return { text, usage };
  }

  /** 让辅助模型修一次；修不好返回 undefined */
  async repair(task: string, raw: string): Promise<unknown> {
    this.repairs += 1;
    const reply = await this.call({
      purpose: "aux",
      temperature: 0,
      messages: [
        { role: "system", content: REPAIR_SYSTEM },
        { role: "user", content: `${task}\n\n原文：\n${raw}` },
      ],
    });
    if ("blocked" in reply) return undefined;
    this.repairUsage = addUsage(this.repairUsage, reply.usage);
    const parsed = parseModelJson(reply.text);
    return parsed.ok && parsed.value !== null ? parsed.value : undefined;
  }

  /** 按 schema 校验一条，不合格时修一次，仍不合格就丢掉 */
  async validate<T>(where: string, raw: unknown, schema: z.ZodType<T>): Promise<T | undefined> {
    const first = schema.safeParse(raw);
    if (first.success) return first.data;
    const reason = issueText(first.error);
    const fixed = await this.repair(
      `这一条（${where}）不符合格式：${reason}\n应当是：${schemaDoc(schema)}`,
      JSON.stringify(raw),
    );
    if (fixed !== undefined) {
      const second = schema.safeParse(fixed);
      if (second.success) {
        this.notes.push(`${where} 的格式已自动修正`);
        return second.data;
      }
    }
    this.drop(where, raw, reason, "format");
    return undefined;
  }

  /** ① 判断的顶层结构；解析不了修一次，仍不行按“不检定、不调记忆”继续 */
  async readJudge(text: string): Promise<JudgeShape> {
    const json = parseModelJson(text);
    const shape = json.ok ? readJudgeShape(json.value) : undefined;
    if (shape?.ok) return shape.judge;
    const reason = shape ? shape.error : json.ok ? "" : `不是合法的 JSON：${json.error}`;
    const fixed = await this.repair(
      `下面的判断解析不了（${reason}）。修成一个 JSON 对象，格式：${schemaDoc(JudgeDocSchema)}`,
      text,
    );
    const second = fixed === undefined ? undefined : readJudgeShape(fixed);
    if (second?.ok) {
      this.notes.push("判断的格式已自动修正");
      return second.judge;
    }
    this.drop("判断", text, `${reason}；修过一次仍然不行，这一轮按不检定、不调记忆继续`, "format");
    this.notes.push("这一轮的判断没解析出来，按不检定继续");
    return {};
  }

  /** ④ 抽取的顶层结构；解析不了修一次，仍不行就只保留正文、状态不变 */
  async readExtract(text: string): Promise<ExtractShape> {
    const json = parseModelJson(text);
    const shape = json.ok ? readExtractShape(json.value) : undefined;
    if (shape?.ok) return shape.extract;
    const reason = shape ? shape.error : json.ok ? "" : `不是合法的 JSON：${json.error}`;
    const fixed = await this.repair(
      `下面的抽取结果解析不了（${reason}）。修成一个 JSON 对象，格式：${schemaDoc(ExtractDocSchema)}`,
      text,
    );
    const second = fixed === undefined ? undefined : readExtractShape(fixed);
    if (second?.ok) {
      this.notes.push("抽取的格式已自动修正");
      return second.extract;
    }
    this.drop("抽取", text, `${reason}；修过一次仍然不行，这一轮只保留正文`, "format");
    return {};
  }
}

/** 来源前缀能对上主板上的哪几类；过往也算上负面经历 */
const SOURCE_SLOTS: Readonly<Record<string, readonly TraitSlot[]>> = {
  出身: ["origin"],
  过往: ["past", "flaw"],
  本事: ["skill"],
  负面经历: ["flaw"],
  联动: ["combo"],
};

/**
 * 专属选项的来源要对得上：义体来源必须是身上装着的义体；角色有主板时，出身、过往、本事、
 * 联动来源必须是主板上的模块（名字互相包含就算）。对不上时去掉来源，选项留着
 */
function verifySource(
  choice: Choice,
  chrome: ReadonlySet<string>,
  traits: readonly Trait[],
  notes: string[],
): Choice {
  const match = choice.source?.match(/^([^：:]+)[：:]\s*(.+)$/);
  if (!match) return choice;
  const kind = (match[1] ?? "").trim();
  const named = (match[2] ?? "").trim();
  let reason: string;
  if (kind === "义体") {
    if (chrome.has(named)) return choice;
    reason = "不是身上装着的义体";
  } else {
    const slots = SOURCE_SLOTS[kind];
    if (slots === undefined || traits.length === 0) return choice;
    const fits = traits.some(
      (t) => slots.includes(t.slot) && (t.label.includes(named) || named.includes(t.label)),
    );
    if (fits) return choice;
    reason = `不是主板上的${slots.map((s) => TRAIT_LABELS[s]).join("或")}`;
  }
  const { source: _source, ...rest } = choice;
  notes.push(`选项「${choice.text}」的来源「${choice.source}」${reason}，去掉了来源`);
  return rest;
}

/** 抽取的 dropped：考虑过但没抽的，只留文字 */
function readConsidered(raw: readonly unknown[] | undefined): string[] {
  return (raw ?? []).flatMap((item) => {
    if (typeof item === "string" && item.trim() !== "") return [item.trim().slice(0, 200)];
    if (typeof item === "object" && item !== null) return [JSON.stringify(item).slice(0, 200)];
    return [];
  });
}

/** ⑤ 核对：没有正文依据的删掉，写重了的按正文改小；核对出问题时提议原样保留 */
async function verify(
  b: TurnBuilder,
  messages: readonly LlmMessage[],
  proposals: Proposal[],
): Promise<Proposal[]> {
  if (proposals.length === 0) return proposals;
  const reply = await b.call({ purpose: "aux", temperature: VERIFY_TEMPERATURE, messages });
  if ("blocked" in reply) {
    b.notes.push("核对被辅助模型拒答，提议原样保留");
    return proposals;
  }
  b.auxUsage = addUsage(b.auxUsage, reply.usage);
  const lines = parsePatch(reply.text);
  b.flags.push(...parseFlags(reply.text));
  if (lines === undefined) {
    b.notes.push("核对没给出 <patch>，提议原样保留");
    return proposals;
  }
  const seen = new Set<number>();
  const removed = new Set<number>();
  for (const line of lines) {
    const index = line.n - 1;
    const proposal = proposals[index];
    if (!proposal || seen.has(index)) continue;
    seen.add(index);
    if (line.op === "drop") {
      b.drop(proposal.where, proposal.value, `核对：${line.reason}`, "verify");
      removed.add(index);
    } else if (line.op === "fix") {
      const fixed = applyFix(proposal.value, line.fields);
      const parsed = fixed.ok ? proposal.parse(fixed.value) : undefined;
      if (fixed.ok && parsed) {
        proposal.value = fixed.value;
        b.notes.push(`核对按正文改小了 ${proposal.where}${line.reason ? `：${line.reason}` : ""}`);
      } else {
        b.notes.push(
          `核对对 ${proposal.where} 的改动不合规（${fixed.ok ? "改完格式不对" : fixed.reason}），按原样保留`,
        );
      }
    }
  }
  return proposals.filter((_, i) => !removed.has(i));
}

export async function runNarratorTurn(
  deps: NarratorDeps,
  world: WorldState,
  records: readonly LogRecord[],
  plan: NarratorPlan,
): Promise<NarratorResult> {
  const b = new TurnBuilder(deps);
  const extras: PromptExtras = {
    data: deps.data,
    opening: deps.opening,
    startTime: deps.startTime,
  };
  let usage: LlmUsage | undefined;
  const addNarrator = (u: LlmUsage | undefined) => {
    if (u) usage = addUsage(usage ?? ZERO, u);
  };
  // 闪回里不掷骰、不推进时间、不记账：只认 flashback 指令
  const inFlashback = CharacterStateSchema.parse(world.slices.character).flashback !== null;
  const flashbackReason = "闪回里不掷骰、不推进时间、不记账";
  const oocReason = "场外提问不改状态";
  const legacyOoc = plan.kind === "action" && plan.input.mode === "ooc";

  // ① 判断：确认过的检定（包括预先带检定的选项）跳过；旧存档选了出戏也跳过
  let judge: JudgeShape = {};
  // 上下文预算：原文带几轮、【前情】多少额度先定下，候选池按同一组数去重
  const budget = contextBudget(deps.contextWindow);
  let hot = historyTurns(records, budget.parts.history, HISTORY_TURNS);
  let recapTokens = budget.parts.recap;
  const pool =
    plan.kind === "action" && !legacyOoc ? memoryPool(world, records, hot, recapTokens) : [];
  const lately = effectiveTurns(records)
    .slice(-2)
    .map((t) => t.text)
    .join("\n");
  const memories: Memory[] =
    plan.kind === "action"
      ? judgeCandidates(pool, world, { input: plan.input.text, context: lately })
      : [];
  if (plan.kind === "action" && !legacyOoc) {
    const prompt = buildJudgePrompt(world, records, plan, extras, memories);
    const reply = await b.call({
      purpose: "narrator",
      temperature: JUDGE_TEMPERATURE,
      messages: prompt.messages,
    });
    if ("blocked" in reply) return { kind: "blocked", reason: reply.blocked };
    addNarrator(reply.usage);
    judge = await b.readJudge(reply.text);
  }
  const ooc = legacyOoc || (plan.kind === "action" && judge.ooc === true);
  const read =
    !ooc && typeof judge.read === "string" && judge.read.trim() !== ""
      ? judge.read.trim()
      : undefined;

  // 待确认的检定：格式对了还要能算出难度值（档位范围、属性）
  let check: CheckSpec | undefined;
  if (judge.check !== undefined && judge.check !== null) {
    if (ooc || inFlashback) {
      b.drop("check", judge.check, ooc ? oocReason : flashbackReason, "rules");
    } else {
      const legacy = legacyDvToEdge(judge.check);
      if (legacy.note !== undefined) noteOnce(b.notes, legacy.note);
      const spec = await b.validate("check", legacy.value, CheckProposalSchema);
      const prepared = spec && prepareFor(world, spec);
      if (spec && prepared && !prepared.ok) b.drop("check", spec, prepared.reason, "rules");
      else check = spec;
    }
  }

  // 门槛：代码直接判定，不掷骰；这一轮已经给了检定就不再判
  let gate: GateResult | undefined;
  if (judge.gate !== undefined && judge.gate !== null) {
    if (ooc) b.drop("gate", judge.gate, oocReason, "rules");
    else {
      const legacyG = legacyGate(judge.gate);
      if (legacyG.note !== undefined) noteOnce(b.notes, legacyG.note);
      const spec = await b.validate("gate", legacyG.value, GateProposalSchema);
      if (spec && check) b.drop("gate", spec, "这一轮已经给了检定，门槛不再判", "rules");
      else if (spec) gate = judgeGate(world, spec);
    }
  }

  // 提交前确认：一次花掉超过存款一半且超过 1,000 欧元时先停下来问；玩家确认过就不再问
  if (
    judge.buy !== undefined &&
    judge.buy !== null &&
    plan.kind === "action" &&
    plan.input.spendOk !== true &&
    !ooc &&
    !inFlashback
  ) {
    const buy = await b.validate("buy", judge.buy, BuyProposalSchema);
    const spend = buy && bigSpend(world, deps.data ?? {}, buy);
    if (spend) return { kind: "confirmSpend", ...spend };
  }

  // 旧记忆：只认候选里原样抄来的标题
  const recalled: Memory[] = [];
  if (!ooc) {
    for (const [i, raw] of (judge.recall ?? []).entries()) {
      const where = `recall[${i}]`;
      const hit =
        typeof raw === "string" ? memories.find((m) => m.title === raw.trim()) : undefined;
      if (!hit) b.drop(where, raw, "不在可调的旧记忆里", "rules");
      else if (recalled.length >= MAX_RECALL)
        b.drop(where, raw, `一轮最多调 ${MAX_RECALL} 条旧记忆`, "rules");
      else if (!recalled.includes(hit)) recalled.push(hit);
    }
  }
  // 扩展层：覆盖不够时按分数补几条旧记忆，判断调过的不重复；检索用玩家输入加判断的理解
  const retrieval =
    plan.kind === "action" && !ooc
      ? expandMemories(
          pool,
          world,
          records,
          hot,
          { input: [plan.input.text, read ?? ""].join("\n"), context: lately },
          recalled,
          deps.data ?? {},
        )
      : undefined;
  const cuts: string[] = [];
  // 扩展层额度：判断调的先占，补进来的按分数从高到低留到额度用完
  const recalledTokens = recalled.reduce((n, m) => n + memoryTokens(m), 0);
  const fitted = fitMemories(
    (retrieval?.picked ?? []).map((m) => ({ title: m.title, text: m.text })),
    Math.max(0, budget.parts.expanded - recalledTokens),
  );
  let expanded: Memory[] = fitted.kept;
  if (fitted.dropped > 0) cuts.push(`扩展层超额，少补 ${fitted.dropped} 条`);

  // ② 拼上下文：写正文之前代码已经定下的事
  const decided: string[] = [];
  if (ooc) decided.push("场外提问：跳出角色，用一两句话直接回答，不推进剧情");
  // 当场掷骰（用户 2026-11-01 选的「全改」第 1 步）：判断给了检定就直接掷，不再停笔等玩家确认；
  // 结果按确认检定那条路交给写正文、抽取和核对，一轮写完、一轮记账
  let rolled: RolledCheck | undefined;
  if (check) {
    const prepared = prepareFor(world, check);
    if (prepared.ok) {
      rolled = {
        offer: { id: `inline.${records.length}`, label: check.intent, spec: check },
        prepared: prepared.check,
        result: resolveCheck(prepared.check, rollFaces(deps.rng)),
      };
    }
  }
  const live: NarratorPlan = rolled ? { kind: "resolve", input: plan.input, check: rolled } : plan;
  if (gate) decided.push(gateText(gate));
  // 路线面板确认的出行：耗时、路费和路上偶遇在写正文前由代码定下
  let trip: PlannedTrip | undefined;
  if (plan.kind === "action" && plan.input.travel !== undefined && !ooc && !inFlashback) {
    // 地点簿并进地点表（places-plan §四）：place:、poi:、ft: 也能当出行的目的地，和 travelBlock 一致
    const planned = planTrip(
      tripWorldOf(world),
      withSavedPlaces(deps.data ?? {}, world),
      plan.input.travel,
      {
        rng: deps.rng,
        factor: deps.encounters ?? 1,
      },
    );
    if (planned.ok) {
      trip = planned.trip;
      decided.push(tripText(planned.trip));
    } else b.notes.push(`出行没成：${planned.reason}`);
  }
  // 对手的打算：只给写正文的一步，正文照它写对手的行动
  const foes =
    !ooc && typeof judge.foes === "string" && judge.foes.trim() !== ""
      ? judge.foes.trim().slice(0, FOES_CHARS)
      : undefined;
  // 对手的打算从“照这个写”改成素材（用户 2026-11-01 定的「全改」第 3 步：模型当主持人，代码只管记账）
  if (foes)
    decided.push(`对手这一轮的打算（对手不会只等着挨打；按局面写进对手的行动，可以改）：${foes}`);
  // 裁决理由：给了检定或门槛时留档，只在剧透视图里看
  const ruling =
    (check || gate) && typeof judge.why === "string" && judge.why.trim() !== ""
      ? judge.why.trim().slice(0, RULING_CHARS)
      : undefined;

  // ③ 写正文：边收边放；模型偶尔仍附上旧的 <state> 块，拆分器把它拿掉
  // 设定库：按地点、在场人物和输入里的专有名词查原作资料，单独一块给写正文；场外提问不查
  const lore = ooc
    ? undefined
    : lookupLore(deps.lore, world, records, plan.input.text, deps.data ?? {}, budget.parts.world);
  let loreSection = lore?.section;
  const build = () =>
    buildNarratorPrompt(world, records, live, {
      ...extras,
      decided,
      recalled: [...recalled, ...expanded],
      lore: loreSection,
      history: hot,
      recapTokens,
    });
  // 整份超出窗口（减去留给回复的）时从低优先级裁起：扩展层 → 【前情】 → 设定资料 → 原文（留 MIN_HISTORY 轮）
  const limit = budget.window - budget.parts.reply;
  const totalOf = (p: ReturnType<typeof build>) =>
    p.messages.reduce((n, m) => n + estimateTokens(m.content), 0);
  let prompt = build();
  for (let total = totalOf(prompt); total > limit; total = totalOf(prompt)) {
    if (expanded.length > 0) {
      expanded = expanded.slice(0, -1);
      cuts.push("整份超出，扩展层少补一条");
    } else if (recapTokens > 0 && (prompt.parts?.recap ?? 0) > 0) {
      recapTokens = recapTokens >= 400 ? Math.floor(recapTokens / 2) : 0;
      cuts.push(`整份超出，【前情】额度降到 ${recapTokens}`);
    } else if (loreSection !== undefined) {
      loreSection = undefined;
      cuts.push("整份超出，不带设定资料");
    } else if (hot > MIN_HISTORY) {
      hot -= 1;
      cuts.push(`整份超出，原文少带一轮（剩 ${hot} 轮）`);
    } else {
      cuts.push(`必需的部分已经超出（约 ${total} / ${limit} token），没有能再裁的`);
      break;
    }
    prompt = build();
  }
  const used = prompt.parts ?? {};
  const budgetTrace: BudgetTrace = {
    window: budget.window,
    history: hot,
    recapTokens,
    parts: [
      ...(["rules", "hot", "history", "recap", "expanded", "world"] as const).map((part) => ({
        part,
        label: BUDGET_LABELS[part],
        tokens: used[part] ?? 0,
        limit: part === "hot" ? budget.parts.hot + budget.parts.character : budget.parts[part],
      })),
      { part: "other", label: "输入和其余", tokens: used.other ?? 0, limit: null },
      { part: "reply", label: BUDGET_LABELS.reply, tokens: 0, limit: budget.parts.reply },
    ],
    total: totalOf(prompt),
    limit,
    cuts,
  };
  // 设定资料被整份裁掉时，日志里也不记那块
  const loreTrace =
    lore && loreSection === undefined && lore.section !== undefined
      ? { ...lore.trace, section: undefined, note: "整份超出上下文预算，没带" }
      : lore?.trace;
  // 酒馆预设（用户定的）：条目叠在本作提示词前面、本作规则在后；采样参数只给这一步；场外提问不套
  const preset = ooc ? undefined : deps.preset;
  // 预设兼容：启用时把本作默认篇幅让给预设，只改本轮系统提示，不改历史正文或检定规则。
  const gameMessages = preset
    ? prompt.messages.map((message) =>
        message.role === "system"
          ? {
              ...message,
              content: message.content.replace(NARRATE_LENGTH, NARRATE_LENGTH_PRESET),
            }
          : message,
      )
    : prompt.messages;
  const narrateMessages = preset
    ? applyPreset(gameMessages, preset, {
        // 酒馆预设的 {{user}} 使用当前存档角色名；旧存档没有名字时才回退为玩家。
        user: deps.userName ?? CharacterStateSchema.parse(world.slices.character).name ?? "玩家",
        char: "叙事者",
        lastUserMessage: plan.input.text,
        roll: (sides) => deps.rng.roll(sides),
      })
    : prompt.messages;
  const sampling = preset?.sampling ?? {};
  if (preset) b.notes.push(`写正文套用了酒馆预设「${preset.name}」`);
  const splitter = new StateSplitter();
  b.checkAborted();
  for await (const event of deps.llm.stream(
    {
      purpose: "narrator",
      messages: narrateMessages,
      ...(sampling.temperature !== undefined ? { temperature: sampling.temperature } : {}),
      ...(sampling.topP !== undefined ? { topP: sampling.topP } : {}),
      ...(sampling.topK !== undefined ? { topK: sampling.topK } : {}),
      ...(sampling.maxOutputTokens !== undefined
        ? { maxOutputTokens: sampling.maxOutputTokens }
        : {}),
    },
    deps.signal,
  )) {
    if (event.type === "text") {
      const shown = splitter.push(event.text);
      if (shown !== "") deps.onText?.(shown);
    } else if (event.type === "blocked") {
      return { kind: "blocked", reason: event.reason };
    } else {
      addNarrator(event.usage);
    }
  }
  b.checkAborted();
  const split = splitter.finish();
  const { rest, block } = split;
  if (rest !== "") deps.onText?.(rest);
  // 预设正则改存下来的正文（思维链、八股词之类）；边收边放的那份不改，存档和抽取按改过的
  const cleaned = preset ? applyPresetRegex(split.narrative, preset).trim() : split.narrative;
  // 正则把正文整段清空（例如玩家打开了只该改旧楼层的那类）时保底用原文，不让这一轮白写
  const wiped = preset !== undefined && cleaned === "" && split.narrative.trim() !== "";
  const narrative = wiped ? split.narrative : cleaned;
  if (wiped) b.notes.push("预设正则会把整段正文清空，这一轮没套正则，用的是原文");
  else if (preset && narrative !== split.narrative.trim())
    b.notes.push("正文按预设正则清理过（思维链、标签等）");
  if (narrative === "") throw new NarratorEmptyReplyError("模型没有返回正文，可以重试");
  if (block !== null) b.notes.push("正文末尾带了指令块，已经去掉；状态按抽取结算");

  // ④ 抽取：场外提问不抽，状态不变；检定当场掷过，这一轮照常记账
  let shape: ExtractShape = {};
  const settle = !ooc && (check === undefined || rolled !== undefined);
  if (settle) {
    const extract = buildExtractPrompt(world, records, live, extras, narrative);
    const reply = await b.call({
      purpose: "aux",
      temperature: EXTRACT_TEMPERATURE,
      messages: extract.messages,
    });
    if ("blocked" in reply) {
      b.drop("抽取", null, `辅助模型拒答：${reply.blocked}；这一轮只保留正文`, "format");
    } else {
      b.auxUsage = addUsage(b.auxUsage, reply.usage);
      shape = await b.readExtract(reply.text);
    }
  }
  const considered: string[] = settle ? readConsidered(shape.dropped) : [];

  // 装着的义体的名字：义体来源的专属选项和义体的内心声音要对得上
  const parts = cyberwareCatalog(deps.data ?? {});
  // 打坏的义体修好前失去能力：不算专属选项的来源、不会说话、不挡伤害
  const installedChrome = CyberwareStateSchema.parse(world.slices.cyberware ?? {}).installed;
  const broken = new Set(HealthStateSchema.parse(world.slices.health).brokenChrome);
  const working = installedChrome.filter((c) => !broken.has(c.id));
  const chrome = new Set(working.map((c) => parts.get(c.id)?.name ?? c.id));
  const traits = CharacterStateSchema.parse(world.slices.character).traits;
  // 武器栏里有带专属声音的不朽武器时，它才会说话
  const items = deps.data?.items ? itemCatalog(deps.data) : new Map<string, ItemDef>();
  const inventory = InventoryStateSchema.safeParse(world.slices.inventory);
  const iconicHeld =
    inventory.success &&
    inventory.data.weapons.some((w) => w !== null && items.get(w)?.voice !== undefined);
  const choices: Choice[] = [];
  for (const [i, item] of (shape.choices ?? []).entries()) {
    const where = `choices[${i}]`;
    if (i >= MAX_CHOICES) {
      b.drop(where, item, `建议选项最多 ${MAX_CHOICES} 个`, "rules");
      continue;
    }
    const choice = await b.validate(where, legacyChoice(item, b.notes), ChoiceProposalSchema);
    if (!choice) continue;
    // 闪回里不掷骰：选项去掉检定，只留行动
    if (inFlashback && choice.check) {
      const { check: _dropped, ...plain } = choice;
      b.notes.push(`选项「${choice.text}」在闪回里，去掉了检定`);
      choices.push(verifySource(plain as Choice, chrome, traits, b.notes));
      continue;
    }
    const prepared = choice.check && prepareFor(world, choice.check);
    if (prepared && !prepared.ok) b.drop(where, choice, prepared.reason, "rules");
    else choices.push(verifySource(choice, chrome, traits, b.notes));
  }

  const voices: Voice[] = [];
  for (const [i, item] of (shape.voices ?? []).entries()) {
    const where = `voices[${i}]`;
    if (i >= MAX_VOICES) {
      b.drop(where, item, `内心声音每轮最多 ${MAX_VOICES} 条`, "rules");
      continue;
    }
    const voice = await b.validate(where, item, VoiceSchema);
    if (!voice) continue;
    if (voice.from === "chrome" && chrome.size === 0) {
      b.drop(where, voice, "身上没装义体，义体不会说话", "rules");
      continue;
    }
    if (voice.from === "iconic" && !iconicHeld) {
      b.drop(where, voice, "武器栏里没有会说话的不朽武器", "rules");
      continue;
    }
    voices.push(voice);
  }

  // 代码校验第一步：白名单和逐条格式
  const proposals: Proposal[] = [];
  for (const [i, item] of (shape.changes ?? []).entries()) {
    const where = `changes[${i}]`;
    const type =
      typeof item === "object" && item !== null ? (item as { type?: unknown }).type : undefined;
    const schema = typeof type === "string" ? registry.commandSchema(type) : undefined;
    if (!schema) {
      b.drop(
        where,
        item,
        typeof type === "string" ? `未知的指令类型：${type}` : "指令缺少 type",
        "format",
      );
      continue;
    }
    // 模型仍写数字时先换成档位；校验后得到结算用的指令，之后核对和结算都按结算格式读
    const legacy = registry.normalizeProposal(item);
    if (legacy.note !== undefined) noteOnce(b.notes, legacy.note);
    const command = await b.validate(where, legacy.value, schema);
    if (!command) continue;
    proposals.push({
      where,
      kind: "change",
      value: command as Record<string, unknown>,
      parse: (v) => {
        const parsed = registry.parseCommand(v);
        return parsed.ok ? parsed.command : undefined;
      },
    });
  }
  // 消息：每轮最多两条；闪回里不收
  for (const [i, item] of (shape.messages ?? []).entries()) {
    const where = `messages[${i}]`;
    if (inFlashback) {
      b.drop(where, item, flashbackReason, "rules");
      continue;
    }
    if (i >= MESSAGES_PER_TURN) {
      b.drop(where, item, `消息每轮最多 ${MESSAGES_PER_TURN} 条`, "rules");
      continue;
    }
    const message = await b.validate(where, item, IncomingMessageSchema);
    if (!message) continue;
    proposals.push({
      where,
      kind: "message",
      value: { ...message },
      parse: (v) => {
        const parsed = IncomingMessageSchema.safeParse(v);
        return parsed.success
          ? {
              type: "phone.receive",
              from: parsed.data.from,
              text: parsed.data.text,
              ...(parsed.data.job === undefined ? {} : { job: parsed.data.job }),
            }
          : undefined;
      },
    });
  }

  // ⑤ 核对：没有正文依据的删掉，写重了的改小
  const verified = await verify(
    b,
    buildVerifyPrompt(
      world,
      records,
      live,
      extras,
      narrative,
      proposals.map((p) => p.value),
    ),
    proposals,
  );

  // 代码校验第二步：业务规则（闪回、战斗中的限制、快捷动作上限）
  const commands: Command[] = [];
  // 快捷动作（用治疗品、扔手雷、放快速破解）每段最多两个：超出的在结算前拦下
  const fight = CombatStateSchema.parse(world.slices.combat).active;
  let quick = fight ? (fight.quick ?? 0) : 0;
  const isQuick = (c: Command) => {
    const x = c as { type: string; source?: unknown; action?: unknown; id?: unknown };
    if (x.type === "heal") return x.source === "maxdoc";
    if (x.type === "hack") return (x.action ?? "use") === "use";
    return x.type === "item" && x.action === "use" && typeof x.id === "string"
      ? items.get(x.id)?.kind === "grenade"
      : false;
  };
  for (const proposal of verified) {
    const command = proposal.parse(proposal.value);
    if (!command) continue;
    if (proposal.kind === "message") {
      commands.push(command);
      continue;
    }
    const { where } = proposal;
    if (inFlashback && command.type !== "flashback") {
      b.drop(where, command, flashbackReason, "rules");
      continue;
    }
    if (
      fight &&
      command.type === "flashback" &&
      (command as { action?: unknown }).action !== "end"
    ) {
      b.drop(where, command, "战斗中不能闪回", "rules");
      continue;
    }
    if (fight && isQuick(command)) {
      if (quick >= MAX_QUICK) {
        b.drop(where, command, `这一段的快捷动作已经用了 ${MAX_QUICK} 个`, "rules");
        continue;
      }
      quick += 1;
    }
    commands.push(command);
  }
  b.checkAborted();

  // 长时间跳过在决策点停下：中间有期限或委托到期时，时间截在最早到期的那一刻，交给玩家
  for (const [i, c] of commands.entries()) {
    const time = c.type === "world" ? (c as { time?: unknown }).time : undefined;
    if (typeof time !== "number") continue;
    const stop = skipStop(world, time);
    if (!stop) continue;
    commands[i] = { ...c, time: stop.at } as Command;
    b.notes.push(`时间停在 ${formatGameTime(stop.at)}：${stop.label}到期，接下来交给玩家`);
  }

  // 模型直接在 world 里写了 location（用户定的"自动转"，2026-10-30）：500 米内按步行补上用时，
  // 更远的转成一次出行，照路线表扣时间和路费；玩家在路线面板确认过出行的这一轮不管
  if (!trip && !ooc && !inFlashback) {
    const moveData = withSavedPlaces(deps.data ?? {}, world);
    for (const [i, c] of commands.entries()) {
      if (c.type !== "world") continue;
      const loc = (c as { location?: unknown }).location;
      if (typeof loc !== "string") continue;
      const move = autoMove(tripWorldOf(world), moveData, loc);
      if (move.kind === "near") {
        const time = (c as { time?: unknown }).time;
        const at = world.time + move.minutes;
        if (typeof time !== "number" || time < at) {
          commands[i] = { ...c, time: at } as Command;
          b.notes.push(`就在附近，走过去 ${move.minutes} 分钟（代码按步行算）`);
        }
      } else if (move.kind === "trip") {
        // 到达和时间由出行结算，world 里的 location 去掉，免得绕过路线
        trip = move.trip;
        const { location: _location, ...rest } = c as Command & { location?: unknown };
        commands[i] = rest as Command;
        b.notes.push(
          `远处的地点自动转成出行：${move.trip.route.label}去${move.trip.to.name}，${move.trip.route.minutes} 分钟`,
        );
      }
      break;
    }
  }

  // 对峙倒数：这一轮开始前就在对峙才扣，这一轮刚开的不扣；化解或开打了倒数什么也不做
  if (!ooc && !inFlashback && CombatStateSchema.parse(world.slices.combat).standoff) {
    commands.push({ type: "combat.standoffTick" });
  }
  const flashbackAction = (c: Command) =>
    c.type === "flashback" ? (c as { action?: unknown }).action : undefined;
  // 闪回里过一轮；这一轮写了 end 就不再扣
  if (!ooc && inFlashback && !commands.some((c) => flashbackAction(c) === "end")) {
    commands.push({ type: "character.flashbackTick" });
  }
  // 时间由抽取按正文写在 world 里；没写就是时间没动，代码不补保底
  if (settle && shape.sceneEnd === true) {
    if (inFlashback) b.notes.push("闪回里不收场，回到现在后再写 sceneEnd");
    else commands.push({ type: "world.endScene" });
  }

  const facts: Record<string, unknown> = {};
  if (live.kind === "resolve") {
    facts.check = checkFactFrom(live.check.offer.id, live.check.prepared, live.check.result);
  }
  // 门槛结果：入侵协议等要门槛达标的指令据此核对
  if (gate) facts.gate = { attribute: gate.gate.attribute, met: gate.met };
  // 护甲降档：health 不能读义体（health→cyberware→character→health 会成环），这里把护甲义体的名字放进事实
  const armor = working.map((c) => parts.get(c.id)).find((d) => d?.armor === true);
  if (armor) facts.armor = armor.name;
  // 断肢打在义肢上改记为义体损坏：坏着的也要放进来，不然会当成血肉再断一次
  const limbChrome = Object.fromEntries(
    installedChrome
      .filter((c) => c.slot === "arms" || c.slot === "legs")
      .map((c) => [c.slot, { id: c.id, name: parts.get(c.id)?.name ?? c.id }]),
  );
  if (Object.keys(limbChrome).length > 0) facts.chrome = limbChrome;
  // 躲在自己的安全屋：heat 不能读安全屋（safehouse→travel→heat 会成环），这一轮没出门才算
  const here = (world.slices.world as { location?: unknown } | undefined)?.location;
  const homes = (world.slices.safehouse as { homes?: { location?: unknown }[] } | undefined)?.homes;
  if (!trip && here !== undefined && (homes ?? []).some((h) => h.location === here)) {
    facts.hideout = true;
  }
  // 队员名单：npc 不能读小队（squad 读 npc），写 npcDeath 杀队员时按它走同一道保底
  const members = (world.slices.squad as { members?: { npc?: unknown }[] } | undefined)?.members;
  const squadIds = (members ?? []).map((m) => m.npc).filter((id) => typeof id === "string");
  if (squadIds.length > 0) facts.squad = squadIds;
  // 人在店里：叙事模型写的 trade buy 买这家货架上的东西时，和界面买一样占库存；这一轮出了门不算
  const shopHereNow =
    trip || here === undefined
      ? undefined
      : shopList(deps.data ?? {}).find((s) => s.location === here);
  if (shopHereNow) facts.shop = { id: shopHereNow.id, at: world.time };
  // 开了斯安威斯坦：先扣人性再结算；能不能开（clutch、义体能用）由后端在调模型前拦下
  if (plan.kind === "action" && plan.input.sandevistan === true && !ooc && !inFlashback) {
    const boost = working.map((c) => parts.get(c.id)).find((d) => d?.accelerator === true);
    if (boost) commands.unshift({ type: "cyberware.boost", id: boost.id });
  }
  // 超梦编辑器里下的结论：对错由代码按冻结的答案判断，情境里已经告诉叙事模型；能不能下由后端在调模型前拦下
  if (plan.kind === "action" && plan.input.braindance !== undefined && !ooc) {
    commands.unshift({ type: "braindance.conclude", option: plan.input.braindance });
  }
  // 回复消息：先记下回的是哪一条、回了什么（消息窗口里显示成一来一回）
  if (plan.kind === "action" && plan.input.replyTo !== undefined && !ooc) {
    const said = plan.input.text.trim().slice(0, 300);
    commands.unshift({
      type: "phone.reply",
      id: plan.input.replyTo,
      ...(said === "" ? {} : { text: said }),
    });
  }
  if (trip) {
    facts.travel = tripFact(trip);
    commands.unshift({ type: "travel", to: trip.to.id, mode: trip.route.mode });
  }
  const applyCtx = { rng: deps.rng, facts, ...(deps.data ? { data: deps.data } : {}) };
  // 成组生效：之前被丢的、结算时被拒的，跟着它的条目一起不生效，剩下的重新结算
  const failed = new Set<Role>();
  for (const d of b.dropped) {
    const role = roleOf(d.raw);
    if (role) failed.add(role);
  }
  let pending = dropFollowers(b, commands, failed);
  let applied = registry.applyCommands(world, pending, applyCtx);
  for (;;) {
    const fresh = applied.results
      .filter(({ result }) => !result.ok)
      .map(({ command }) => roleOf(command))
      .filter((r): r is Role => r !== undefined && !failed.has(r) && FOLLOWERS[r].length > 0);
    if (fresh.length === 0) break;
    for (const r of fresh) failed.add(r);
    pending = dropFollowers(b, pending, failed);
    applied = registry.applyCommands(world, pending, applyCtx);
  }
  const accepted: Command[] = [];
  for (const { command, result } of applied.results) {
    if (result.ok) {
      accepted.push(command);
      b.notes.push(...result.notes);
    } else {
      b.drop(command.type, command, result.reason, "rules");
    }
  }
  // 近期后果：按这一轮真正生效的指令归类；检定失败却什么都没发生时下一轮提醒
  const settled =
    ooc || inFlashback
      ? applied
      : registry.applyCommands(
          applied.world,
          [{ type: "fallout.record", kinds: falloutKinds(accepted, live.kind === "resolve") }],
          applyCtx,
        );

  // 场景标题：这一轮收了场就按收场前的地点和时间
  const before = WorldClockStateSchema.parse(world.slices.world);
  const after = WorldClockStateSchema.parse(settled.world.slices.world);
  const title = sceneTitle(after.scene === before.scene ? settled.world : world, deps.data ?? {});
  const unsettled = settle ? unsettledReason(b.dropped) : undefined;

  // ⑥ 场外推演：收场时隔了几场或半天，推演玩家没看着的地方；结果只进补丁，和本轮一起落盘撤回
  const dead = HealthStateSchema.parse(settled.world.slices.health).condition === "dead";
  let final = settled;
  let offscreenTrace: { prompt: string; reply: string } | undefined;
  const every = deps.offscreen === undefined ? OFFSCREEN_SCENES : deps.offscreen;
  if (
    settle &&
    !inFlashback &&
    !dead &&
    unsettled === undefined &&
    every !== null &&
    offscreenDue(world, settled.world, every)
  ) {
    const present = presentNpcs(world, settled.world);
    const messages = buildOffscreenPrompt(settled.world, records, extras, narrative, present);
    const reply = await b.call({ purpose: "aux", temperature: OFFSCREEN_TEMPERATURE, messages });
    offscreenTrace = {
      prompt: messages[messages.length - 1]?.content ?? "",
      reply: "blocked" in reply ? `（拒答：${reply.blocked}）` : reply.text,
    };
    let offscreen: Command[] = [];
    if ("blocked" in reply) {
      considered.push(`场外推演被辅助模型拒答：${reply.blocked}`);
    } else {
      b.auxUsage = addUsage(b.auxUsage, reply.usage);
      const sent = accepted.filter((c) => c.type === "phone.receive").length;
      const got = readOffscreen(reply.text, settled.world, {
        present,
        messages: MESSAGES_PER_TURN - sent,
        data: extras.data ?? {},
      });
      considered.push(...got.notes);
      offscreen = got.commands;
    }
    // 读不了也记下场次和时间，下一轮不马上重试；到点没写的事代码不替它编，只提醒一次再往后拨
    // （用户 2026-11-01 定的「全改」第 4 步：模型当主持人，代码只管记账）
    final = registry.applyCommands(
      settled.world,
      [...offscreen, { type: "thread.remind" }, { type: "city.ran" }],
      applyCtx,
    );
    for (const { command, result } of final.results) {
      if (!result.ok) considered.push(`场外推演：${command.type} 没生效：${result.reason}`);
      // 消息和头条带来的声望玩家看得到；其余只进剧透视图
      else if (command.type === "phone.receive" || command.type === "streetCred") {
        b.notes.push(...result.notes);
      } else {
        const c = command as {
          type: string;
          id?: string;
          title?: string;
          text?: string;
          cause?: string;
          npc?: string;
          concern?: string;
          resolve?: boolean;
        };
        if (c.type === "city.event") considered.push(`场外推演：动静 ${c.id}「${c.title}」`);
        else if (c.type === "doing") considered.push(`场外推演：${c.id} 最近 ${c.text}`);
        else if (c.type === "city.rumor") considered.push(`场外推演：传闻「${c.text}」`);
        else if (c.type === "city.bulletin") considered.push(`场外推演：快讯「${c.title}」`);
        else if (c.type === "npc.past") considered.push(`场外推演：${c.id} 的经历压成摘要`);
        else if (c.type === "threadTold") considered.push(`场外推演：快讯播了事项 ${c.id}`);
        else if (c.type === "jobOffer") considered.push(`场外推演：新委托 ${c.id}「${c.title}」`);
        else if (c.type.startsWith("thread.") && c.id)
          considered.push(`场外推演：事项 ${c.id}（${c.type}）${c.text ?? ""}`);
        else if (c.type === "arc.offscreen")
          considered.push(
            `场外推演：${c.npc} 的心事 ${c.concern}${c.resolve ? "有了结果" : ""}：${c.text ?? ""}`,
          );
        considered.push(...result.notes.map((n) => `场外推演：${n}`));
      }
    }
  }
  const offscreenSkip =
    offscreenTrace === undefined
      ? offscreenSkipReason({
          closed: after.scene !== before.scene,
          flashback: inFlashback,
          unsettled: unsettled !== undefined,
          dead,
          every,
        })
      : undefined;

  // ⑦ 场景摘要：收了场就把这一场压成一条摘要，原文掉出窗口以后由【前情】接上；只进补丁，和本轮一起撤回
  let ended = final.world;
  const summaryPatches: Patch[] = [];
  let summaryTrace: { prompt: string; reply: string } | undefined;
  if (settle && after.scene !== before.scene) {
    if (inFlashback) considered.push("场景摘要：闪回里不写");
    else if (unsettled !== undefined) considered.push("场景摘要：这一轮没结算干净，不写");
    else {
      const messages = buildSummaryPrompt(world, ended, records, plan.input, narrative, extras);
      const reply = await b.call({ purpose: "aux", temperature: SUMMARY_TEMPERATURE, messages });
      summaryTrace = {
        prompt: messages[messages.length - 1]?.content ?? "",
        reply: "blocked" in reply ? `（拒答：${reply.blocked}）` : reply.text,
      };
      if ("blocked" in reply) {
        considered.push(`场景摘要被辅助模型拒答：${reply.blocked}`);
      } else {
        b.auxUsage = addUsage(b.auxUsage, reply.usage);
        const got = readSummary(reply.text, ended, before.scene, before.location);
        considered.push(...got.notes);
        if (got.command) {
          const done = registry.applyCommands(ended, [got.command], applyCtx);
          for (const { result } of done.results) {
            if (!result.ok) considered.push(`场景摘要没记上：${result.reason}`);
          }
          ended = done.world;
          summaryPatches.push(...done.patches);
        }
      }
    }
  }
  const closeup =
    ooc || unsettled !== undefined
      ? undefined
      : closeupFor(accepted, world, records, deps.data ?? {});

  return {
    kind: "done",
    turn: {
      text: narrative,
      read,
      choices,
      voices,
      check: rolled ? undefined : check,
      rolled,
      gate,
      commands: accepted,
      dropped: b.dropped,
      unsettled,
      considered,
      ruling,
      offscreen: offscreenTrace,
      offscreenSkip,
      summary: summaryTrace,
      notes: b.notes,
      flags: b.flags,
      world: ended,
      patches: ooc
        ? applied.patches
        : [
            ...applied.patches,
            ...settled.patches,
            ...(final === settled ? [] : final.patches),
            ...summaryPatches,
          ],
      modules: prompt.modules,
      pin: settle && unsettled === undefined && shape.pin === true,
      clutch: settle && shape.clutch === true,
      scene: before.scene,
      title,
      closeup,
      ooc,
      usage,
      auxUsage: b.auxUsage,
      repairs: b.repairs,
      repairUsage: b.repairUsage,
      // 返回实际发送的消息，包含预设条目和展开后的宏，供上下文检查与测评使用
      messages: narrateMessages,
      decided,
      recalled,
      expanded,
      retrieval,
      lore: loreTrace,
      budget: budgetTrace,
    },
  };
}
