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
import type { LogRecord } from "../kernel/turnlog";
import { effectiveTurns } from "../kernel/turnlog";
import type { WorldState } from "../kernel/world";
import type { NarrativeIntensity } from "../physics";
import type { TurnStage } from "../schemas/turn";
import {
  CharacterStateSchema,
  TRAIT_LABELS,
  type Trait,
  type TraitSlot,
} from "../systems/character";
import { OFFSCREEN_SCENES } from "../systems/city";
import { CombatStateSchema } from "../systems/combat";
import { CyberwareStateSchema, cyberwareCatalog, sandevistanOf } from "../systems/cyberware";
import { rulingFactFrom } from "../systems/dice";
import { falloutKinds } from "../systems/fallout";
import { quickhackCatalog } from "../systems/hacking";
import { HealthStateSchema } from "../systems/health";
import { withWorldObjects } from "../systems/inventory/apply";
import { InventoryStateSchema } from "../systems/inventory/schema";
import { memoryRecords } from "../systems/memory";
import { NpcStateSchema } from "../systems/npc";
import { IncomingMessageSchema, MESSAGES_PER_TURN } from "../systems/phone";
import { registry } from "../systems/registry";
import { currentTension } from "../systems/tension";
import { type PlannedTrip, planTrip, tripFact, tripText, tripWorldOf } from "../systems/travel";
import { WorldClockStateSchema, withSavedPlaces } from "../systems/world";
import {
  type Choice,
  ChoiceProposalSchema,
  ExtractDocSchema,
  type ExtractShape,
  issueText,
  MAX_CHOICES,
  parseModelJson,
  readExtractShape,
  StateSplitter,
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
import { completeFinish } from "./completion";
import { responseJsonSchema, schemaDoc } from "./doc";
import { readEventPlan } from "./event-plan";
import { applyEventCommands, type SettlementEvent } from "./event-settlement";
import { type LoreSource, type LoreTrace, lookupLore } from "./lore";
import { preparePurchases } from "./merchant-settlement";
import {
  OFFSCREEN_TEMPERATURE,
  offscreenDue,
  offscreenSkipReason,
  prepareOffscreenBatch,
  presentNpcs,
  readOffscreen,
} from "./offscreen";
import { applyExpandedPreset, applyPresetRegex, presetMessages, type TavernPreset } from "./preset";
import {
  buildExtractPrompt,
  buildJudgePrompt,
  buildNarratorPrompt,
  EXTRACT_TEMPERATURE,
  HISTORY_TURNS,
  JUDGE_TEMPERATURE,
  type NarratorPlan,
  type PromptExtras,
} from "./prompts";
import { estimateTokens } from "./prompts/layers";
import { type Expansion, expandMemories, judgeCandidates, memoryPool } from "./retrieve";
import { sceneTitle } from "./scene";
import { readSceneMemory, summaryFromExtract } from "./scene-memory";
import {
  accelerationRequested,
  type BigSpend,
  type CounterHackRuling,
  CounterHackRulingSchema,
  counterHackText,
  JudgeDocSchema,
  type JudgeRuling,
  JudgeRulingSchema,
  type JudgeShape,
  MAX_RECALL,
  type Memory,
  readJudgeShape,
  rulingText,
  type TransactionIntent,
  TransactionIntentSchema,
} from "./stages";
import { buildSummaryPrompt, readSummary, SUMMARY_TEMPERATURE, SummaryDocSchema } from "./summary";
import {
  REPAIR_OUTPUT_TOKENS,
  RepairBudget,
  type RepairStage,
  type ValidationEntry,
  validateEntries,
} from "./validation";

/**
 * 一轮四步：① 判断（叙事模型，JSON Schema：记忆调度与定性物理/社会因果裁决）→ ② 拼上下文
 * → ③ 写正文（叙事模型，纯文本，边收边放）→ ④ 抽取（辅助模型，JSON）+ 确定性规则核验与记账。
 * 只算出结果，不写日志：写日志、加锁和版本核对由调用方负责
 */

export interface Dropped {
  /** 出问题的位置，例如 changes[2]、ruling、choices[1]、抽取 */
  readonly where: string;
  readonly raw: unknown;
  readonly reason: string;
  /** format：格式不合格且有限修复未能解决；verify：历史字段；rules：业务校验没通过 */
  readonly stage: "format" | "verify" | "rules";
}

/** 同一句提示一轮只记一次 */
function noteOnce(notes: string[], note: string): void {
  if (!notes.includes(note)) notes.push(note);
}

/** 关键条目：被拒、被丢或规则拦截时，这一轮正文标为未定稿 */
const KEY_ITEMS: Readonly<Record<string, string>> = {
  combat: "战斗后果",
  hack: "快速破解",
  breach: "入侵协议",
  dive: "潜网行动",
  npcHack: "快速破解",
  damage: "伤害",
  "health.limb": "断肢",
  "health.die": "死亡",
  npcDeath: "人物死亡",
  money: "欧元",
  trade: "买卖",
  gunsmith: "枪匠改装",
  cyberware: "义体交易",
  "cyberware.service": "义体服务",
  "cyberware.part": "义体实物",
  "cyberware.supply": "诊所供货",
  "cyberware.clinic": "诊所经营",
  shopOrder: "商店订货",
  shopBusiness: "商店经营",
  "logistics.route": "供货路况",
  vehicle: "车辆变更",
  itemPlace: "物品留置",
  home: "住所变更",
  "commerce.offer": "交易报价",
  "commerce.withdraw": "报价撤回",
  loot: "零钱",
  item: "物品",
  jobEnd: "委托结局",
  "phone.receive": "收到的消息",
  "phone.reply": "回复的消息",
};

/** 正文和账目对不上的原因；没有关键条目出问题时为 undefined */
export function unsettledReason(dropped: readonly Dropped[]): string | undefined {
  for (const d of dropped) {
    if (d.where === "抽取") return "这一轮的记账没完整抽出来，正文尚未定稿";
    if (d.stage === "format" && /^(changes|messages)\[/.test(d.where))
      return `本轮事实尚未完整记账：${d.reason}`;
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
  /** 自由行动不产生检定；投影维持现有界面形状 */
  readonly check: undefined;
  /** 自由行动不产生掷骰 */
  readonly rolled: undefined;
  /** 自由行动不产生属性门槛 */
  readonly gate: undefined;
  /** 生效的指令，按结算顺序 */
  readonly commands: readonly Command[];
  readonly dropped: readonly Dropped[];
  /** 未定稿：关键条目没记上时的原因；正文照常显示，但不进旧记忆 */
  readonly unsettled: string | undefined;
  /** 正文/整份记账尚未完整返回的零结算草稿，只能重新生成，不能按已结算账目改写。 */
  readonly draft?: true;
  /** 抽取考虑过但没抽的，和原因 */
  readonly considered: readonly string[];
  /** 判断给出物理与社会因果裁决时留档的摘要，只供剧透视图 */
  readonly ruling: string | undefined;
  /** ⑥ 场外推演跑了时：发出的用户消息和原始回复，只供剧透视图 */
  readonly offscreen: { readonly prompt: string; readonly reply: string } | undefined;
  /** ⑥ 收了场却没推演时的原因，只供剧透视图 */
  readonly offscreenSkip: string | undefined;
  /** ⑦ 场景摘要跑了时：发出的用户消息和原始回复，只供剧透视图 */
  readonly summary: { readonly prompt: string; readonly reply: string } | undefined;
  readonly notes: readonly string[];
  /** 历史提醒字段，只供剧透视图 */
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
  /** @deprecated 特写弹窗已退役，恒为 undefined */
  readonly closeup: undefined;
  /** 判断认为这次是场外提问：不改状态，也不顶掉上一轮的选项 */
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

export interface TurnStageInfo {
  readonly stage: TurnStage;
  readonly label: string;
  readonly detail?: string;
}

export interface NarratorDeps {
  /** 服务端曾展示且玩家确认的具体报价；单独的 spendOk 不能授权不同交易。 */
  readonly approvedSpend?: string | undefined;
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
  /** 每次进入主要生成阶段或模型调用前通知，让界面展示实时进度 */
  readonly onStage?: (stage: TurnStageInfo) => void;
  /** 判断或前端触发了斯安威斯坦时，在正文流式输出前通知前端激活超频特效 */
  readonly onBoost?: (boost: { readonly id: string; readonly name: string }) => void;
  /** 场外推演隔几场跑一次；null 是关掉，没写按默认 3 场 */
  readonly offscreen?: number | null | undefined;
  /** 路上偶遇的频率倍数；0 是关掉，没写按 1 */
  readonly encounters?: number | undefined;
  /** 设定库：本机官方文本库的只读检索；没有文本库时不接，这一步自动关掉 */
  readonly lore?: LoreSource | undefined;
  /** 叙事模型方案的上下文窗口（token）；按它分上下文预算，没给按 32K */
  readonly contextWindow?: number | undefined;
  /** 正文连接本身的输出上限；预设不能把它扩大到窗口预算之外。 */
  readonly maxOutputTokens?: number | undefined;
  /** 辅助连接的实际窗口和输出上限，场外批次按该连接单独预算。 */
  readonly auxContextWindow?: number | undefined;
  readonly auxMaxOutputTokens?: number | undefined;
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

class IncompleteReplyError extends Error {}

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
  private readonly repairBudget = new RepairBudget();

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
    let complete = false;
    for await (const event of this.deps.llm.stream(request, this.deps.signal)) {
      if (event.type === "text") text += event.text;
      else if (event.type === "blocked") return { blocked: event.reason };
      else {
        usage = event.usage;
        complete = completeFinish(event.finishReason);
      }
    }
    this.checkAborted();
    if (!complete) throw new IncompleteReplyError("模型回复未正常结束，未采用不完整结果");
    return { text, usage };
  }

  /** 已结算后的补充请求失败不能丢掉正文；玩家主动停止仍终止整个回合。 */
  async supplement(request: LlmRequest): Promise<Reply | { failed: true }> {
    try {
      return await this.call(request);
    } catch (error) {
      this.checkAborted();
      if (error instanceof NarratorAbortedError) throw error;
      return { failed: true };
    }
  }

  /** 顶层和条目修复共用阶段额度；不因错误数量增加调用次数。 */
  async repair(stage: RepairStage, task: string, raw: string): Promise<unknown> {
    const content = `${task}\n\n原文：\n${raw}`;
    const denied = this.repairBudget.claim(stage, `${REPAIR_SYSTEM}\n${content}`);
    if (denied) {
      noteOnce(this.notes, `${stage === "judge" ? "判断" : "抽取"}：${denied}，未追加修复请求`);
      return undefined;
    }
    this.repairs += 1;
    this.deps.onStage?.({
      stage: "repair",
      label: `格式修复（${stage === "judge" ? "判断" : "抽取"}）`,
      detail: "修正结构化 JSON 输出",
    });
    const reply = await this.supplement({
      purpose: "aux",
      temperature: 0,
      maxOutputTokens: REPAIR_OUTPUT_TOKENS,
      responseFormat: responseJsonSchema("repair"),
      messages: [
        { role: "system", content: REPAIR_SYSTEM },
        { role: "user", content },
      ],
    });
    if ("blocked" in reply || "failed" in reply) return undefined;
    this.repairUsage = addUsage(this.repairUsage, reply.usage);
    const parsed = parseModelJson(reply.text);
    return parsed.ok && parsed.value !== null ? parsed.value : undefined;
  }

  /** 可选建议直接本地校验，不占用事实修复额度。 */
  validate<T>(where: string, raw: unknown, schema: z.ZodType<T>): T | undefined {
    const first = schema.safeParse(raw);
    if (first.success) return first.data;
    this.drop(where, raw, issueText(first.error), "format");
    return undefined;
  }

  async validateBatch(stage: RepairStage, entries: readonly ValidationEntry[]) {
    const result = await validateEntries(entries, (task, raw) => this.repair(stage, task, raw));
    for (const key of result.repaired) this.notes.push(`${key} 的格式已批量修正`);
    for (const { entry, reason } of result.failures)
      this.drop(entry.key, entry.raw, `${reason}；有限批量修复未解决`, "format");
    return result.values;
  }

  /** ① 判断的顶层结构；有限修复仍失败时交给调用处停止本轮。 */
  async readJudge(text: string): Promise<JudgeShape> {
    const json = parseModelJson(text);
    const shape = json.ok ? readJudgeShape(json.value) : undefined;
    if (shape?.ok) return shape.judge;
    const reason = shape ? shape.error : json.ok ? "" : `不是合法的 JSON：${json.error}`;
    const fixed = await this.repair(
      "judge",
      `下面的判断解析不了（${reason}）。修成一个 JSON 对象，格式：${schemaDoc(JudgeDocSchema)}`,
      text,
    );
    const second = fixed === undefined ? undefined : readJudgeShape(fixed);
    if (second?.ok) {
      this.notes.push("判断的格式已自动修正");
      return second.judge;
    }
    this.drop("判断", text, `${reason}；有限修复未解决，不能确认本轮行动条件`, "format");
    return {};
  }

  /** ④ 抽取的顶层结构；有限修复仍失败则不接收模型账目，正文标为未定稿。 */
  async readExtract(text: string): Promise<ExtractShape> {
    const json = parseModelJson(text);
    const shape = json.ok ? readExtractShape(json.value) : undefined;
    if (shape?.ok) return shape.extract;
    const reason = shape ? shape.error : json.ok ? "" : `不是合法的 JSON：${json.error}`;
    const fixed = await this.repair(
      "extract",
      `下面的抽取结果解析不了（${reason}）。修成一个 JSON 对象，格式：${schemaDoc(ExtractDocSchema)}`,
      text,
    );
    const second = fixed === undefined ? undefined : readExtractShape(fixed);
    if (second?.ok) {
      this.notes.push("抽取的格式已自动修正");
      return second.extract;
    }
    this.drop("抽取", text, `${reason}；有限修复未解决，这一轮只保留正文`, "format");
    return {};
  }
}

/** 来源前缀能对上主板上的哪几类；过往也算上负面经历 */
const SOURCE_SLOTS: Readonly<Record<string, readonly TraitSlot[]>> = {
  出身: ["origin"],
  过往: ["past", "flaw"],
  本事: ["skill"],
  特长: ["skill"],
  负面经历: ["flaw"],
};

/**
 * 专属选项的来源要对得上：义体来源必须是身上装着的义体；角色有主板时，出身、过往、本事
 * 来源必须是主板上的模块（名字互相包含就算）。对不上时去掉来源，选项留着
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

const DEAD_NPC_BLOCKED_TYPES = new Set([
  "npcUpdate",
  "npcHack",
  "npcHumanity",
  "npcDeath",
  "npc.move",
  "npc.hurt",
  "npc.heal",
  "npc.status",
  "npc.equip",
]);

/** 确定性常识与物理一致性复核：不再调用额外的辅助模型质检，代码拦截死人行动等硬错误 */
function sanityGuard(
  b: TurnBuilder,
  world: WorldState,
  proposals: readonly Proposal[],
): Proposal[] {
  const npcs = NpcStateSchema.safeParse(world.slices.npc ?? { npcs: {} });
  const cards = npcs.success ? npcs.data.npcs : {};
  const kept: Proposal[] = [];
  for (const proposal of proposals) {
    if (proposal.kind === "change") {
      const type = proposal.value.type;
      const npcId = proposal.value.id;
      if (
        typeof type === "string" &&
        DEAD_NPC_BLOCKED_TYPES.has(type) &&
        typeof npcId === "string" &&
        cards[npcId] &&
        !cards[npcId].alive
      ) {
        b.drop(
          proposal.where,
          proposal.value,
          `${cards[npcId].name}已经死了，不能再行动或改状态`,
          "rules",
        );
        continue;
      }
    }
    kept.push(proposal);
  }
  return kept;
}

export async function runNarratorTurn(
  deps: NarratorDeps,
  world: WorldState,
  records: readonly LogRecord[],
  plan: NarratorPlan,
): Promise<NarratorResult> {
  deps = {
    ...deps,
    data: withWorldObjects(
      deps.data ?? {},
      InventoryStateSchema.parse(world.slices.inventory).objects,
    ),
  };
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
  // 闪回里不推进时间、不记账：只认 flashback 指令
  const inFlashback = CharacterStateSchema.parse(world.slices.character).flashback !== null;
  const flashbackReason = "闪回里不推进时间、不记账";
  const oocReason = "场外提问不改状态";
  const legacyOoc = plan.kind === "action" && plan.input.mode === "ooc";

  // ① 判断：用原生 JSON Schema 获取意图、物理/社会因果定性裁决和记忆调度；旧存档选了出戏也跳过
  let judge: JudgeShape = {};
  // 上下文预算：原文带几轮、【前情】多少额度先定下，候选池按同一组数去重
  const budget = contextBudget(deps.contextWindow);
  const promptRecords = memoryRecords(world, records);
  let hot = historyTurns(promptRecords, budget.parts.history, HISTORY_TURNS);
  let recapTokens = budget.parts.recap;
  const pool =
    plan.kind === "action" && !legacyOoc ? memoryPool(world, records, hot, recapTokens) : [];
  const lately = effectiveTurns(promptRecords)
    .slice(-2)
    .map((t) => t.text)
    .join("\n");
  const memories: Memory[] =
    plan.kind === "action"
      ? judgeCandidates(pool, world, { input: plan.input.text, context: lately })
      : [];
  if (plan.kind === "action" && !legacyOoc) {
    deps.onStage?.({
      stage: "judge",
      label: "① 意图判断与因果裁决",
      detail: "调度记忆并核对物理与局势条件",
    });
    const prompt = buildJudgePrompt(world, records, plan, extras, memories);
    const reply = await b.call({
      purpose: "narrator",
      temperature: JUDGE_TEMPERATURE,
      responseFormat: responseJsonSchema("judge", JudgeDocSchema),
      messages: prompt.messages,
    });
    if ("blocked" in reply) return { kind: "blocked", reason: reply.blocked };
    addNarrator(reply.usage);
    judge = await b.readJudge(reply.text);
    if (b.dropped.some((d) => d.where === "判断"))
      return { kind: "blocked", reason: "本轮判断格式无法修复，尚未推进剧情或修改状态，请重试。" };
  }
  const ooc = legacyOoc || (plan.kind === "action" && judge.ooc === true);
  const activeBoost = sandevistanOf(world, deps.data ?? {});
  const sandevistanBoosted =
    plan.kind === "action" &&
    !ooc &&
    !inFlashback &&
    activeBoost !== null &&
    (plan.input.sandevistan === true ||
      (judge.sandevistan === true && accelerationRequested(plan.input, activeBoost.name)));
  const live: NarratorPlan =
    sandevistanBoosted && plan.kind === "action" && plan.input.sandevistan !== true
      ? { ...plan, input: { ...plan.input, sandevistan: true } }
      : plan;
  const read =
    !ooc && typeof judge.read === "string" && judge.read.trim() !== ""
      ? judge.read.trim()
      : undefined;

  const judgeEntries: ValidationEntry[] = [];
  if (!ooc && !inFlashback) {
    if (judge.ruling !== undefined && judge.ruling !== null)
      judgeEntries.push({ key: "ruling", raw: judge.ruling, schema: JudgeRulingSchema });
    if (judge.counterHack !== undefined && judge.counterHack !== null)
      judgeEntries.push({
        key: "counterHack",
        raw: judge.counterHack,
        schema: CounterHackRulingSchema,
      });
    if (judge.buy !== undefined && judge.buy !== null)
      judgeEntries.push({ key: "buy", raw: judge.buy, schema: TransactionIntentSchema });
  }
  const judged = await b.validateBatch("judge", judgeEntries);
  if (judgeEntries.some((entry) => !judged.has(entry.key)))
    return {
      kind: "blocked",
      reason: "本轮行动条件或交易信息仍有格式错误，尚未修改状态，请重试。",
    };

  // 定性物理与社会因果裁决：日常对话写 null，冲突/受阻/险境才给出
  let rulingSpec: JudgeRuling | undefined;
  if (judge.ruling !== undefined && judge.ruling !== null) {
    if (ooc || inFlashback) {
      b.drop("ruling", judge.ruling, ooc ? oocReason : flashbackReason, "rules");
    } else {
      rulingSpec = judged.get("ruling") as JudgeRuling;
    }
  }
  let counterHackSpec: CounterHackRuling | undefined;
  if (judge.counterHack !== undefined && judge.counterHack !== null) {
    if (ooc || inFlashback) {
      b.drop("counterHack", judge.counterHack, ooc ? oocReason : flashbackReason, "rules");
    } else {
      counterHackSpec = judged.get("counterHack") as CounterHackRuling;
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
  // 扩展层：覆盖不够时按分数补几条旧记忆，判断调过的不重复；检索用玩家输入加判断的理解
  const retrieval =
    plan.kind === "action" && !ooc
      ? expandMemories(
          pool,
          world,
          promptRecords,
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
  if (rulingSpec) decided.push(rulingText(rulingSpec));
  if (counterHackSpec) decided.push(counterHackText(counterHackSpec));
  // 路线面板确认的出行：耗时、路费和路上偶遇在写正文前由代码定下
  let trip: PlannedTrip | undefined;
  if (plan.kind === "action" && plan.input.travel !== undefined && !ooc && !inFlashback) {
    // 存档记下的地点并进地点表：place:、poi:、ft: 也能当出行的目的地，和 travelBlock 一致
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
  // 在临时世界走同一条已规划路线，让途中到货、到达初始化和实际路费参与报价。
  // 偶遇已经由 trip 确定；临时预览不消费正式随机流，不写入正式世界。
  const quoteWorld: WorldState = trip
    ? registry.applyCommands(world, [{ type: "travel", to: trip.to.id, mode: trip.route.mode }], {
        rng: { roll: () => 1 },
        data: withSavedPlaces(deps.data ?? {}, world),
        facts: { travel: tripFact(trip) },
      }).world
    : world;
  const buy = judged.get("buy") as TransactionIntent | undefined;
  deps.onStage?.({
    stage: "prepare",
    label: "② 核验条件与拼装上下文",
    detail: buy ? "核对交易报价与库存" : "裁剪记忆、规则与设定资料",
  });
  const prepared = preparePurchases(quoteWorld, deps.data ?? {}, buy);
  const confirmation = prepared.confirmation;
  if (
    confirmation &&
    ((deps.approvedSpend !== undefined && deps.approvedSpend !== confirmation.quoteKey) ||
      (prepared.spend &&
        !(plan.input.spendOk === true && deps.approvedSpend === confirmation.quoteKey)))
  )
    return { kind: "confirmSpend", ...confirmation };
  for (const { proposal, quote, journey } of prepared.purchases) {
    if (journey) decided.push(`【成交前出行】${journey}`);
    decided.push(
      quote.ok
        ? `【本次交易报价】${proposal.destination ? `以实际到达 ${proposal.destination} 为前提；` : ""}${quote.detail}。这一条只对应一件或一次服务；只有玩家已接受并确实交付才成交，不得另改交易对象、价钱或旧件处理。`
        : `【本次交易尚不能成立】${quote.reason}。可以继续询价或商谈，不能先写成已付款、拿货或安装。`,
    );
  }
  // 对手的打算：只给写正文的一步，正文照它写对手的行动
  const foes =
    !ooc && typeof judge.foes === "string" && judge.foes.trim() !== ""
      ? judge.foes.trim().slice(0, FOES_CHARS)
      : undefined;
  if (foes)
    decided.push(`对手这一轮的打算（对手不会只等着挨打；按局面写进对手的行动，可以改）：${foes}`);
  // 裁决理由：仅留档在剧透视图里查看，不进游戏正文
  const ruling = rulingSpec
    ? `${rulingSpec.outcome}（${rulingSpec.reason}）`.slice(0, RULING_CHARS)
    : undefined;

  if (sandevistanBoosted && activeBoost) {
    deps.onBoost?.({ id: activeBoost.id, name: activeBoost.name });
  }
  // ③ 写正文：边收边放；模型偶尔仍附上旧的 <state> 块，拆分器把它拿掉
  // 设定库：按地点、在场人物和输入里的专有名词查原作资料，单独一块给写正文；场外提问不查
  const lore = ooc
    ? undefined
    : lookupLore(
        deps.lore,
        world,
        promptRecords,
        plan.input.text,
        deps.data ?? {},
        budget.parts.world,
      );
  let loreSection = lore?.section;
  const preset = ooc ? undefined : deps.preset;
  // 宏只展开一次，预设的前置、深度条目及衔接说明都计入最终请求预算。
  const expandedPreset = preset
    ? presetMessages(preset, {
        user: deps.userName ?? CharacterStateSchema.parse(world.slices.character).name ?? "玩家",
        char: "叙事者",
        lastUserMessage: plan.input.text,
        roll: (sides) => deps.rng.roll(sides),
      })
    : undefined;
  const presetTokens = expandedPreset
    ? applyExpandedPreset([], expandedPreset).reduce((n, m) => n + estimateTokens(m.content), 0)
    : 0;
  const sampling = preset?.sampling ?? {};
  const maxOutputTokens = Math.max(
    1,
    Math.floor(
      Math.min(
        budget.parts.reply,
        deps.maxOutputTokens ?? budget.parts.reply,
        sampling.maxOutputTokens ?? budget.parts.reply,
      ),
    ),
  );
  const inCombatNow = CombatStateSchema.parse(world.slices.combat).active !== null;
  const exposure = currentTension(world).exposure;
  const intensity: NarrativeIntensity =
    inCombatNow ||
    rulingSpec?.harm === "heavy" ||
    rulingSpec?.harm === "lethal" ||
    rulingSpec?.kind === "costly" ||
    exposure === "openConflict" ||
    exposure === "compromised"
      ? "climax"
      : trip !== undefined || rulingSpec !== undefined || exposure === "suspicious"
        ? "exploration"
        : "dialogue";
  const build = () =>
    buildNarratorPrompt(world, records, live, {
      ...extras,
      hasPreset: preset !== undefined,
      intensity,
      decided,
      recalled: [...recalled, ...expanded],
      lore: loreSection,
      history: hot,
      recapTokens,
    });
  // 整份超出窗口（减去留给回复的）时从低优先级裁起：扩展层 → 【前情】 → 设定资料 → 原文（留 MIN_HISTORY 轮）
  const limit = budget.window - maxOutputTokens;
  const totalOf = (p: ReturnType<typeof build>) =>
    presetTokens + p.messages.reduce((n, m) => n + estimateTokens(m.content), 0);
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
      return {
        kind: "blocked",
        reason: `当前规则、人物状态、最低限度历史与写作预设合计约 ${total} token，超过本次输入预算 ${limit}。请缩短写作预设或提高模型上下文窗口后重试；本轮尚未写入。`,
      };
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
      { part: "preset", label: "酒馆写作预设", tokens: presetTokens, limit: null },
      { part: "other", label: "输入和其余", tokens: used.other ?? 0, limit: null },
      { part: "reply", label: BUDGET_LABELS.reply, tokens: 0, limit: maxOutputTokens },
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
  // 酒馆预设（用户定的）：条目叠在本作提示词前面、本作规则在后；节律提示由用户消息尾端自适应处理，不破坏系统前缀缓存
  const narrateMessages = expandedPreset
    ? applyExpandedPreset(prompt.messages, expandedPreset)
    : prompt.messages;
  if (preset) b.notes.push(`写正文套用了酒馆预设「${preset.name}」`);
  const splitter = new StateSplitter();
  let narrativeIssue: string | undefined;
  let narrativeComplete = false;
  let narrativeError: unknown;
  b.checkAborted();
  deps.onStage?.({
    stage: "narrate",
    label: "③ 正在写正文",
    detail: preset ? `流式生成（预设「${preset.name}」）` : "流式生成剧情",
  });
  try {
    for await (const event of deps.llm.stream(
      {
        purpose: "narrator",
        messages: narrateMessages,
        ...(sampling.temperature !== undefined ? { temperature: sampling.temperature } : {}),
        ...(sampling.topP !== undefined ? { topP: sampling.topP } : {}),
        ...(sampling.topK !== undefined ? { topK: sampling.topK } : {}),
        maxOutputTokens,
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
        narrativeComplete = completeFinish(event.finishReason);
        if (!narrativeComplete)
          narrativeIssue = "正文未完整生成，已保存草稿；本轮未推进世界，请重新生成。";
      }
    }
  } catch (error) {
    b.checkAborted();
    if (error instanceof NarratorAbortedError) throw error;
    narrativeError = error;
    narrativeIssue = "正文生成途中中断，已保存收到的草稿；本轮未推进世界，请重新生成。";
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
  if (narrative === "") {
    if (narrativeError) throw narrativeError;
    throw new NarratorEmptyReplyError("模型没有返回正文，可以重试");
  }
  if (block !== null) b.notes.push("正文末尾带了指令块，已经去掉；状态按抽取结算");

  // 草稿与事实分开：保存可见文字，但没有任何状态补丁、内部自动行动或后续推演。
  const draftOnly = (reason: string): NarratorResult => ({
    kind: "done",
    turn: {
      text: narrative,
      read,
      choices: [],
      check: undefined,
      rolled: undefined,
      gate: undefined,
      commands: [],
      dropped: b.dropped,
      unsettled: reason,
      draft: true,
      considered: [reason],
      ruling,
      offscreen: undefined,
      offscreenSkip: "正文尚未定稿，不推演",
      summary: undefined,
      notes: b.notes,
      flags: b.flags,
      world,
      patches: [],
      modules: prompt.modules,
      pin: false,
      clutch: false,
      scene: WorldClockStateSchema.parse(world.slices.world).scene,
      title: sceneTitle(world, deps.data ?? {}),
      closeup: undefined,
      ooc,
      usage,
      auxUsage: b.auxUsage,
      repairs: b.repairs,
      repairUsage: b.repairUsage,
      messages: narrateMessages,
      decided,
      recalled,
      expanded,
      retrieval,
      lore: loreTrace,
      budget: budgetTrace,
    },
  });
  if (!narrativeComplete || narrativeIssue) {
    const reason = narrativeIssue ?? "正文没有正常结束，已保存草稿；本轮未推进世界，请重新生成。";
    b.drop("正文", null, reason, "format");
    return draftOnly(reason);
  }

  // ④ 抽取：场外提问不抽，状态不变；其余常规与裁决回合都照常记账
  let shape: ExtractShape = {};
  const settle = !ooc;
  if (settle) {
    deps.onStage?.({
      stage: "extract",
      label: "④ 抽取状态与记账",
      detail: "识别事件、交易、物件与关系变化",
    });
    const extract = buildExtractPrompt(
      world,
      records,
      live,
      { ...extras, decided },
      narrative,
      prepared.purchases.length
        ? prepared.purchases
            .map(
              ({ proposal, quote }) =>
                `${JSON.stringify(proposal)}：${quote.ok ? quote.detail : `未获准成交：${quote.reason}`}`,
            )
            .join("\n")
        : "本轮没有确认交易意图；可以保存对方报价，不应执行购买、出售、义体服务或还款。",
    );
    const reply = await b.supplement({
      purpose: "aux",
      temperature: EXTRACT_TEMPERATURE,
      responseFormat: responseJsonSchema("extract"),
      messages: extract.messages,
    });
    if ("failed" in reply) {
      b.drop(
        "抽取",
        null,
        "记账请求失败或回复未完整结束；已保存正文草稿，本轮未推进世界",
        "format",
      );
    } else if ("blocked" in reply) {
      b.drop("抽取", null, `辅助模型拒答：${reply.blocked}；这一轮只保留正文`, "format");
    } else {
      b.auxUsage = addUsage(b.auxUsage, reply.usage);
      shape = await b.readExtract(reply.text);
    }
    if (b.dropped.some((entry) => entry.where === "抽取")) {
      return draftOnly("本轮记账未完成，正文已保存为草稿；世界状态未改变，请重新生成。");
    }
  }
  const considered: string[] = settle ? readConsidered(shape.dropped) : [];
  const eventPlan = readEventPlan(
    settle ? shape.events : [],
    shape.changes?.length ?? 0,
    shape.messages?.length ?? 0,
  );
  if (!eventPlan.ok) {
    b.drop("events", shape.events, eventPlan.error, "format");
    return draftOnly(`本轮事件因果不完整：${eventPlan.error}；世界状态未改变，请重新生成。`);
  }
  const owner = new Map(eventPlan.events.flatMap((e) => e.entries.map((entry) => [entry, e.id])));

  // 状态变化和消息集中修复；合法条目不会被送回模型，建议选项只做本地校验。
  const extractEntries: ValidationEntry[] = [];
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
    const proposal = registry.normalizeProposal(item);
    if (proposal.note !== undefined) noteOnce(b.notes, proposal.note);
    extractEntries.push({
      key: where,
      raw: proposal.value,
      schema,
      priority: typeof type === "string" && (type === "world" || KEY_ITEMS[type]) ? 1 : 0,
    });
  }
  if (!inFlashback) {
    for (const [i, item] of (shape.messages ?? []).slice(0, MESSAGES_PER_TURN).entries())
      extractEntries.push({ key: `messages[${i}]`, raw: item, schema: IncomingMessageSchema });
  }
  const extracted = await b.validateBatch("extract", extractEntries);

  // 装着的义体的名字：义体来源的专属选项要对得上
  const parts = cyberwareCatalog(deps.data ?? {});
  // 打坏的义体修好前失去能力：不算专属选项的来源、不挡伤害
  const installedChrome = CyberwareStateSchema.parse(world.slices.cyberware ?? {}).installed;
  const broken = new Set(HealthStateSchema.parse(world.slices.health).brokenChrome);
  const working = installedChrome.filter((c) => !broken.has(c.id));
  const chrome = new Set(working.map((c) => parts.get(c.id)?.name ?? c.id));
  const traits = CharacterStateSchema.parse(world.slices.character).traits;
  const choices: Choice[] = [];
  for (const [i, item] of (shape.choices ?? []).entries()) {
    const where = `choices[${i}]`;
    if (i >= MAX_CHOICES) {
      b.drop(where, item, `建议选项最多 ${MAX_CHOICES} 个`, "rules");
      continue;
    }
    const choice = b.validate(where, item, ChoiceProposalSchema);
    if (!choice) continue;
    choices.push(verifySource(choice, chrome, traits, b.notes));
  }

  // 代码校验第一步：白名单和逐条格式
  const proposals: Proposal[] = [];
  for (const [i] of (shape.changes ?? []).entries()) {
    const where = `changes[${i}]`;
    const command = extracted.get(where) as Command | undefined;
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
    const message = extracted.get(where) as z.infer<typeof IncomingMessageSchema> | undefined;
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

  // 确定性规则核验（退休辅助模型质检）：拦掉死人行动等硬错误
  const verified = sanityGuard(b, world, proposals);

  // 代码校验第二步：业务规则（闪回、战斗、快速破解去重）
  const commands: Command[] = [];
  const entryCommands = new Map<string, Command>();
  const redundant = new Set<string>();
  const addCommand = (proposal: Proposal, command: Command): void => {
    commands.push(command);
    entryCommands.set(proposal.where, command);
  };
  const quickhacks = quickhackCatalog(deps.data ?? {});
  const harmfulHackEvents = new Set(
    verified.flatMap((proposal) => {
      const cmd = proposal.parse(proposal.value);
      if (cmd?.type !== "npcHack") return [];
      const c = cmd as { target?: unknown; program?: unknown };
      if (c.target !== "你" || typeof c.program !== "string") return [];
      const def =
        quickhacks.get(c.program) ?? [...quickhacks.values()].find((q) => q.name === c.program);
      const id = owner.get(proposal.where);
      return id && (def?.category === "damage" || def?.category === "ultimate") ? [id] : [];
    }),
  );
  // 同一交战事件里的重复创口不因条目顺序多记；失败交战不能误删另一事件的真实伤害。
  const combatEvents = new Set<string>();
  const woundEvents = new Set<string>();
  for (const proposal of verified) {
    const command = proposal.parse(proposal.value);
    const id = owner.get(proposal.where);
    if (id && command?.type === "combat") {
      combatEvents.add(id);
      if (command.action === "wound") woundEvents.add(id);
    }
  }
  const alreadyFighting = CombatStateSchema.parse(world.slices.combat).active !== null;
  for (const proposal of verified) {
    const command = proposal.parse(proposal.value);
    if (!command) continue;
    if (proposal.kind === "message") {
      addCommand(proposal, command);
      continue;
    }
    const { where } = proposal;
    if (inFlashback && command.type !== "flashback") {
      b.drop(where, command, flashbackReason, "rules");
      continue;
    }
    if (
      (alreadyFighting || combatEvents.has(owner.get(where) ?? "")) &&
      command.type === "flashback" &&
      (command as { action?: unknown }).action !== "end"
    ) {
      b.drop(where, command, "战斗中不能闪回", "rules");
      continue;
    }
    // 对玩家造成伤害的快速破解由 npcHack 统一结算；不允许独立伤害绕过 RAM、ICE 或重复扣血
    if (
      harmfulHackEvents.has(owner.get(where) ?? "") &&
      (command.type === "damage" || (command.type === "combat" && command.action === "wound"))
    ) {
      b.drop(
        where,
        command,
        "本次快速破解由 npcHack 统一结算，不另记 damage 或 combat wound",
        "rules",
      );
      redundant.add(where);
      continue;
    }
    // 战斗里挨打走 combat wound，伤口要记下谁、用什么、打在哪；模型另写的 damage 不算，免得扣两次
    if (combatEvents.has(owner.get(where) ?? "") && command.type === "damage") {
      b.drop(where, command, "战斗中挨打发 combat wound（by、weapon、part、tier）", "rules");
      if (woundEvents.has(owner.get(where) ?? "")) redundant.add(where);
      continue;
    }
    addCommand(proposal, command);
  }
  b.checkAborted();

  // 时间由抽取按正文写在 world 里；没写就是时间没动，代码不补保底
  if (settle && shape.sceneEnd === true && inFlashback)
    b.notes.push("闪回里不收场，回到现在后再写 sceneEnd");

  const facts: Record<string, unknown> = { tradeNarrative: narrative };
  facts.actionStartLocation = WorldClockStateSchema.parse(world.slices.world).location;
  facts.ruling = rulingFactFrom(`turn.${records.length}`, rulingSpec);
  if (counterHackSpec) {
    facts.npcHackRuling = rulingFactFrom(`turn.${records.length}.npcHack`, {
      kind: counterHackSpec.harm === "none" ? "possible" : "costly",
      harm: counterHackSpec.harm,
      reason: counterHackSpec.reason,
    });
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
  // 躲在自己的安全屋：heat 不能读安全屋（safehouse→travel→heat 会成环），这一轮没出门才算
  const here = (world.slices.world as { location?: unknown } | undefined)?.location;
  const homes = (world.slices.safehouse as { homes?: { location?: unknown }[] } | undefined)?.homes;
  const leaves = commands.some(
    (c) => c.type === "world" && c.location !== undefined && c.location !== here,
  );
  if (!trip && !leaves && here !== undefined && (homes ?? []).some((h) => h.location === here)) {
    facts.hideout = true;
  }
  // 队员名单：npc 不能读小队（squad 读 npc），写 npcDeath 杀队员时按它走同一道保底
  const members = (world.slices.squad as { members?: { npc?: unknown }[] } | undefined)?.members;
  const squadIds = (members ?? []).map((m) => m.npc).filter((id) => typeof id === "string");
  if (squadIds.length > 0) facts.squad = squadIds;
  const setup: SettlementEvent[] = [];
  const prependSetup = (id: string, command: Command): void => {
    setup.unshift({ id, requires: [], commands: [command] });
  };
  // 开了斯安威斯坦（前端开关、选项或判断阶段识别）：先扣人性再结算
  if (sandevistanBoosted) {
    const boost = working.map((c) => parts.get(c.id)).find((d) => d?.accelerator === true);
    if (boost) prependSetup("$boost", { type: "cyberware.boost", id: boost.id });
  }
  // 超梦编辑器里下的结论：对错由代码按冻结的答案判断，情境里已经告诉叙事模型；能不能下由后端在调模型前拦下
  if (plan.kind === "action" && plan.input.braindance !== undefined && !ooc) {
    prependSetup("$braindance", { type: "braindance.conclude", option: plan.input.braindance });
  }
  // 回复消息：先记下回的是哪一条、回了什么（消息窗口里显示成一来一回）
  if (plan.kind === "action" && plan.input.replyTo !== undefined && !ooc) {
    const said = plan.input.text.trim().slice(0, 300);
    prependSetup("$reply", {
      type: "phone.reply",
      id: plan.input.replyTo,
      ...(said === "" ? {} : { text: said }),
    });
  }
  if (trip) {
    facts.travel = tripFact(trip);
    prependSetup("$travel", { type: "travel", to: trip.to.id, mode: trip.route.mode });
  }
  const applyCtx = { rng: deps.rng, facts, ...(deps.data ? { data: deps.data } : {}) };
  const events: SettlementEvent[] = [
    ...setup,
    ...eventPlan.events.map((event): SettlementEvent => {
      const missing = event.entries.find(
        (entry) => !entryCommands.has(entry) && !redundant.has(entry),
      );
      const invalid = missing
        ? (b.dropped.find((d) => d.where === missing)?.reason ?? `${missing} 未通过事实校验`)
        : undefined;
      const eventCommands = event.entries.flatMap((entry) => {
        const command = entryCommands.get(entry);
        return command ? [command] : [];
      });
      const requires = new Set(event.requires);
      if (requires.has("$action")) for (const e of setup) requires.add(e.id);
      if (
        trip &&
        eventCommands.some(
          (c) =>
            (c.type === "world" && c.location !== undefined) ||
            c.type === "trade" ||
            c.type === "cyberware" ||
            c.type === "cyberware.service",
        )
      )
        requires.add("$travel");
      return {
        id: event.id,
        requires: [...requires],
        commands: eventCommands,
        ...(invalid ? { invalid } : {}),
      };
    }),
  ];
  // 收场不能绕过抵达、付款或其他未成立事件；它也受同一事务机制保护。
  if (settle && shape.sceneEnd === true && !inFlashback)
    events.push({
      id: "$scene-end",
      requires: events.map((event) => event.id),
      commands: [{ type: "world.endScene" }],
    });
  const applied = applyEventCommands(
    world,
    events,
    applyCtx,
    prepared.purchases,
    rulingSpec?.kind === "blocked" ? rulingSpec.reason : undefined,
  );
  for (const event of applied.events) {
    if (event.status === "applied") continue;
    b.drop(`events.${event.id}`, { event: event.id }, event.reason ?? "事件未生效", "rules");
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
  const failedEvent = applied.events.find((event) => event.status !== "applied");
  if (failedEvent && accepted.length === 0 && applied.patches.length === 0)
    return draftOnly(`本轮事件未能结算：${failedEvent.reason}；世界状态未改变，请重新生成。`);
  // 近期后果：按这一轮真正生效的指令归类；检定失败却什么都没发生时下一轮提醒
  const settled =
    ooc || inFlashback
      ? applied
      : registry.applyCommands(
          applied.world,
          [{ type: "fallout.record", kinds: falloutKinds(accepted, false) }],
          applyCtx,
        );

  // 场景标题：这一轮收了场就按收场前的地点和时间
  const before = WorldClockStateSchema.parse(world.slices.world);
  const after = WorldClockStateSchema.parse(settled.world.slices.world);
  const title = sceneTitle(after.scene === before.scene ? settled.world : world, deps.data ?? {});
  const unsettled = settle
    ? failedEvent
      ? `事件 ${failedEvent.id} 未生效：${failedEvent.reason}；独立事件已保留，可按账目改写正文`
      : unsettledReason(b.dropped)
    : undefined;

  // ⑥ 按游戏时间、到期事件和收场批次推演；结果与本次行动一起落盘撤回
  const dead = HealthStateSchema.parse(settled.world.slices.health).condition === "dead";
  let final = settled;
  let offscreenTrace: { prompt: string; reply: string } | undefined;
  let offscreenCapacityReason: string | undefined;
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
    const batch = prepareOffscreenBatch(settled.world, records, extras, narrative, present, {
      contextWindow: deps.auxContextWindow ?? 32_000,
      ...(deps.auxMaxOutputTokens === undefined
        ? {}
        : { maxOutputTokens: deps.auxMaxOutputTokens }),
    });
    if (batch.kind === "blocked") {
      offscreenCapacityReason = batch.reason;
      considered.push(batch.reason);
    } else {
      deps.onStage?.({
        stage: "offscreen",
        label: "⑥ 场外世界推演",
        detail: "推进城市动静、传闻与私信",
      });
      const messages = batch.messages;
      const reply = await b.supplement({
        purpose: "aux",
        temperature: OFFSCREEN_TEMPERATURE,
        maxOutputTokens: batch.maxOutputTokens,
        messages,
        responseFormat: responseJsonSchema("offscreen"),
      });
      offscreenTrace = {
        prompt: messages[messages.length - 1]?.content ?? "",
        reply:
          "failed" in reply
            ? "（辅助请求失败，未采用不完整回复）"
            : "blocked" in reply
              ? `（拒答：${reply.blocked}）`
              : reply.text,
      };
      let offscreen: Command[] = [];
      let offscreenComplete = false;
      if ("failed" in reply) {
        considered.push("场外推演请求失败，保留本轮正文与待处理事项");
      } else if ("blocked" in reply) {
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
        offscreenComplete = got.ok;
      }
      // 批次完整解析且全部结算成功才提交；失败不发送消息、不挪期限，也不推进成功游标。
      if (offscreenComplete) {
        const trial = registry.applyCommands(
          settled.world,
          [
            ...offscreen,
            ...(batch.backlog ? [] : [{ type: "thread.remind" }]),
            { type: "city.ran", through: batch.through, backlog: batch.backlog },
          ],
          applyCtx,
        );
        const rejected = trial.results.filter(({ result }) => !result.ok);
        if (rejected.length === 0) {
          final = trial;
          if (batch.backlog)
            considered.push(
              `场外推演已处理至回合 ${batch.through}，剩余积压保留到后续批次，尚未推进全部时限`,
            );
        } else {
          offscreenComplete = false;
          for (const { command, result } of rejected) {
            if (!result.ok) considered.push(`场外推演批次未提交：${command.type} ${result.reason}`);
          }
        }
      }
      if (!offscreenComplete) {
        final = registry.applyCommands(settled.world, [{ type: "city.failed" }], applyCtx);
        considered.push("场外推演未完整完成，保留待处理事项，经过重试间隔后再推演");
      }
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
          else if (c.type === "npc.offscreenDoing")
            considered.push(`场外推演：${c.id} 最近 ${c.text}`);
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
  }
  const offscreenSkip =
    offscreenCapacityReason ??
    (offscreenTrace === undefined
      ? offscreenSkipReason({
          closed: after.scene !== before.scene,
          flashback: inFlashback,
          unsettled: unsettled !== undefined,
          dead,
          every,
        })
      : undefined);

  // ⑦ 记忆跟随真正结算的正文保存；承诺/计划是增量锚点，不因滚动提要重写而消失。
  let ended = final.world;
  const memoryPatches: Patch[] = [];
  let summaryTrace: { prompt: string; reply: string } | undefined;
  const saveMemory = (command: Command): void => {
    const done = registry.applyCommands(ended, [command], applyCtx);
    for (const { result } of done.results) {
      if (!result.ok) considered.push(`场景记忆没记上：${result.reason}`);
    }
    ended = done.world;
    memoryPatches.push(...done.patches);
  };
  if (settle && !inFlashback && unsettled === undefined) {
    const working = readSceneMemory(shape.sceneMemory, world, settled.world, plan.input, narrative);
    considered.push(...working.notes);
    if (working.command) saveMemory(working.command);
  }
  // 正常收场复用抽取中的摘要；不合格时仍单独整理，以记忆质量为先。
  if (settle && after.scene !== before.scene) {
    if (inFlashback) considered.push("场景摘要：闪回里不写");
    else if (unsettled !== undefined) considered.push("场景摘要：这一轮没结算干净，不写");
    else {
      const merged = summaryFromExtract(shape.summary, ended, before.scene, before.location, {
        input: plan.input,
        narrative,
      });
      considered.push(...merged.notes);
      if (merged.command) saveMemory(merged.command);
      else {
        deps.onStage?.({
          stage: "summary",
          label: "⑦ 整理场景摘要",
          detail: "归档本场记忆与锚点",
        });
        const messages = buildSummaryPrompt(world, ended, records, plan.input, narrative, extras);
        const reply = await b.supplement({
          purpose: "aux",
          temperature: SUMMARY_TEMPERATURE,
          messages,
          responseFormat: responseJsonSchema("summary", SummaryDocSchema),
        });
        summaryTrace = {
          prompt: messages[messages.length - 1]?.content ?? "",
          reply:
            "failed" in reply
              ? "（辅助请求失败，未采用不完整回复）"
              : "blocked" in reply
                ? `（拒答：${reply.blocked}）`
                : reply.text,
        };
        if ("failed" in reply) {
          considered.push("场景摘要请求失败，保留完整场景提要与记忆锚点");
        } else if ("blocked" in reply) {
          considered.push(`场景摘要被辅助模型拒答：${reply.blocked}`);
        } else {
          b.auxUsage = addUsage(b.auxUsage, reply.usage);
          const got = readSummary(reply.text, ended, before.scene, before.location, {
            input: plan.input,
            narrative,
          });
          considered.push(...got.notes);
          if (got.command) saveMemory(got.command);
        }
      }
    }
  }
  return {
    kind: "done",
    turn: {
      text: narrative,
      read,
      choices: unsettled === undefined ? choices : [],
      check: undefined,
      rolled: undefined,
      gate: undefined,
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
            ...(settled === applied ? [] : settled.patches),
            ...(final === settled ? [] : final.patches),
            ...memoryPatches,
          ],
      modules: prompt.modules,
      pin: settle && unsettled === undefined && shape.pin === true,
      clutch: settle && unsettled === undefined && shape.clutch === true,
      scene: before.scene,
      title,
      closeup: undefined,
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
