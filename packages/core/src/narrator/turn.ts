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
import type { WorldState } from "../kernel/world";
import {
  CharacterStateSchema,
  TRAIT_LABELS,
  type Trait,
  type TraitSlot,
} from "../systems/character";
import { CombatStateSchema, MAX_QUICK } from "../systems/combat";
import { CyberwareStateSchema, cyberwareCatalog } from "../systems/cyberware";
import { type CheckSpec, CheckSpecSchema, checkFactFrom } from "../systems/dice";
import { falloutKinds } from "../systems/fallout";
import { HealthStateSchema } from "../systems/health";
import { itemCatalog } from "../systems/inventory/apply";
import { InventoryStateSchema, type ItemDef } from "../systems/inventory/schema";
import { IncomingMessageSchema, MESSAGES_PER_TURN } from "../systems/phone";
import { registry } from "../systems/registry";
import { WorldClockStateSchema } from "../systems/world";
import {
  type Choice,
  ChoiceSchema,
  ExtractDocSchema,
  type ExtractShape,
  GateSchema,
  issueText,
  MAX_CHOICES,
  MAX_VOICES,
  parseModelJson,
  readExtractShape,
  StateSplitter,
  type Voice,
  VoiceSchema,
} from "./block";
import { schemaDoc } from "./doc";
import { prepareFor } from "./pending";
import {
  buildExtractPrompt,
  buildJudgePrompt,
  buildNarratorPrompt,
  buildVerifyPrompt,
  EXTRACT_TEMPERATURE,
  HISTORY_TURNS,
  JUDGE_TEMPERATURE,
  type NarratorPlan,
  type PromptExtras,
  VERIFY_TEMPERATURE,
} from "./prompts";
import { closeupFor, sceneTitle } from "./scene";
import {
  applyFix,
  type GateResult,
  gateText,
  JudgeDocSchema,
  type JudgeShape,
  judgeGate,
  MAX_RECALL,
  type Memory,
  parsePatch,
  readJudgeShape,
  recallCandidates,
} from "./stages";

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

/** 关键条目：被拒、被丢或被核对删掉时，这一轮正文标为未定稿 */
const KEY_ITEMS: Readonly<Record<string, string>> = {
  damage: "伤害",
  "health.limb": "断肢",
  "health.die": "死亡",
  npcDeath: "人物死亡",
  money: "欧元",
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
  /** 判断给出、等玩家确认的检定 */
  readonly check: CheckSpec | undefined;
  /** 判断给出的门槛和代码判定的结果 */
  readonly gate: GateResult | undefined;
  /** 生效的指令，按结算顺序 */
  readonly commands: readonly Command[];
  readonly dropped: readonly Dropped[];
  /** 未定稿：关键条目没记上时的原因；正文照常显示，但不进旧记忆、不弹特写卡 */
  readonly unsettled: string | undefined;
  /** 抽取考虑过但没抽的，和原因 */
  readonly considered: readonly string[];
  readonly notes: readonly string[];
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
}

export type NarratorResult =
  | { readonly kind: "done"; readonly turn: NarratorTurn }
  | { readonly kind: "blocked"; readonly reason: string };

export interface NarratorDeps {
  readonly llm: LlmClient;
  readonly rng: Rng;
  /** 静态数据表（content 包） */
  readonly data?: Readonly<Record<string, unknown>>;
  /** 这个存档的开场设定（内容包），故事还没开始时给模型 */
  readonly opening?: string | undefined;
  readonly signal?: AbortSignalLike;
  /** 每收到一段可以显示的正文就调用 */
  readonly onText?: (text: string) => void;
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
  const extras: PromptExtras = { data: deps.data, opening: deps.opening };
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
  const memories: Memory[] =
    plan.kind === "action" && !legacyOoc ? recallCandidates(records, HISTORY_TURNS) : [];
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
      const spec = await b.validate("check", judge.check, CheckSpecSchema);
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
      const spec = await b.validate("gate", judge.gate, GateSchema);
      if (spec && check) b.drop("gate", spec, "这一轮已经给了检定，门槛不再判", "rules");
      else if (spec) gate = judgeGate(world, spec);
    }
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

  // ② 拼上下文：写正文之前代码已经定下的事
  const decided: string[] = [];
  if (ooc) decided.push("场外提问：跳出角色，用一两句话直接回答，不推进剧情");
  if (check) {
    decided.push(
      `先给检定：${check.intent}。这一轮只写到行动将要发生的那一刻（一两句），不写结果，停笔等玩家确认`,
    );
  }
  if (gate) decided.push(gateText(gate));

  // ③ 写正文：边收边放；模型偶尔仍附上旧的 <state> 块，拆分器把它拿掉
  const prompt = buildNarratorPrompt(world, records, plan, { ...extras, decided, recalled });
  const splitter = new StateSplitter();
  b.checkAborted();
  for await (const event of deps.llm.stream(
    { purpose: "narrator", messages: prompt.messages },
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
  const { rest, narrative, block } = splitter.finish();
  if (rest !== "") deps.onText?.(rest);
  if (narrative === "") throw new NarratorEmptyReplyError("模型没有返回正文，可以重试");
  if (block !== null) b.notes.push("正文末尾带了指令块，已经去掉；状态按抽取结算");

  // ④ 抽取：场外提问和等检定的轮次不抽，状态不变
  let shape: ExtractShape = {};
  const settle = !ooc && check === undefined;
  if (settle) {
    const extract = buildExtractPrompt(world, records, plan, extras, narrative);
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
  const considered = settle ? readConsidered(shape.dropped) : [];

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
    const choice = await b.validate(where, item, ChoiceSchema);
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
    const command = await b.validate(where, item, schema);
    if (!command) continue;
    proposals.push({
      where,
      kind: "change",
      value: command as Record<string, unknown>,
      parse: (v) => {
        const parsed = schema.safeParse(v);
        return parsed.success ? parsed.data : undefined;
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
          ? { type: "phone.receive", from: parsed.data.from, text: parsed.data.text }
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
      plan,
      extras,
      narrative,
      proposals.map((p) => p.value),
    ),
    proposals,
  );

  // 代码校验第二步：业务规则（闪回、战斗中的限制、快捷动作上限）
  const commands: Command[] = [];
  // 快捷动作（用治疗品、扔手雷）每段最多两个：超出的在结算前拦下
  const fight = CombatStateSchema.parse(world.slices.combat).active;
  let quick = fight ? (fight.quick ?? 0) : 0;
  const isQuick = (c: Command) => {
    const x = c as { type: string; source?: unknown; action?: unknown; id?: unknown };
    if (x.type === "heal") return x.source === "maxdoc";
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
  if (plan.kind === "resolve") {
    facts.check = checkFactFrom(plan.check.offer.id, plan.check.prepared, plan.check.result);
  }
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
  // 开了斯安威斯坦：先扣人性再结算；能不能开（clutch、义体能用）由后端在调模型前拦下
  if (plan.kind === "action" && plan.input.sandevistan === true && !ooc && !inFlashback) {
    const boost = working.map((c) => parts.get(c.id)).find((d) => d?.accelerator === true);
    if (boost) commands.unshift({ type: "cyberware.boost", id: boost.id });
  }
  // 回复消息：先记下回的是哪一条
  if (plan.kind === "action" && plan.input.replyTo !== undefined && !ooc) {
    commands.unshift({ type: "phone.reply", id: plan.input.replyTo });
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
          [{ type: "fallout.record", kinds: falloutKinds(accepted, plan.kind === "resolve") }],
          applyCtx,
        );

  // 场景标题：这一轮收了场就按收场前的地点和时间
  const before = WorldClockStateSchema.parse(world.slices.world);
  const after = WorldClockStateSchema.parse(settled.world.slices.world);
  const title = sceneTitle(after.scene === before.scene ? settled.world : world, deps.data ?? {});
  const unsettled = settle ? unsettledReason(b.dropped) : undefined;
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
      check,
      gate,
      commands: accepted,
      dropped: b.dropped,
      unsettled,
      considered,
      notes: b.notes,
      world: settled.world,
      patches: ooc ? applied.patches : [...applied.patches, ...settled.patches],
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
      messages: prompt.messages,
    },
  };
}
