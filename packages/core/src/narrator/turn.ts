import type { Patch } from "immer";
import type { z } from "zod";
import type {
  AbortSignalLike,
  Embedder,
  LlmClient,
  LlmMessage,
  LlmRequest,
  LlmUsage,
  Reranker,
  Rng,
} from "../kernel/ports";
import type { AppliedCommand, Command } from "../kernel/system";
import type { LogRecord } from "../kernel/turnlog";
import { effectiveTurns } from "../kernel/turnlog";
import type { WorldState } from "../kernel/world";
import type { NarrativeIntensity } from "../physics";
import type { TurnStage } from "../schemas/turn";
import { BraindanceStateSchema, braindanceWork } from "../systems/braindance";
import {
  CharacterStateSchema,
  TRAIT_LABELS,
  type Trait,
  type TraitSlot,
} from "../systems/character";
import { CityStateSchema, OFFSCREEN_SCENES } from "../systems/city";
import { CombatStateSchema } from "../systems/combat";
import { CyberwareStateSchema, cyberwareCatalog, sandevistanOf } from "../systems/cyberware";
import { rulingFactFrom } from "../systems/dice";
import { falloutKinds } from "../systems/fallout";
import { quickhackCatalog } from "../systems/hacking";
import { HealthStateSchema } from "../systems/health";
import { withWorldObjects } from "../systems/inventory/apply";
import { InventoryStateSchema } from "../systems/inventory/schema";
import { memoryRecords } from "../systems/memory";
import { NPC_UNDECIDED_PREFIX, NpcStateSchema, onStage } from "../systems/npc";
import { IncomingMessageSchema, MESSAGES_PER_TURN } from "../systems/phone";
import { registry } from "../systems/registry";
import { currentTension } from "../systems/tension";
import { type PlannedTrip, planTrip, tripFact, tripText, tripWorldOf } from "../systems/travel";
import { locationCatalog, WorldClockStateSchema, withSavedPlaces } from "../systems/world";
import { pendingUiActions } from "../ui-actions";
import {
  type Choice,
  ChoiceProposalSchema,
  ExtractDocSchema,
  type ExtractShape,
  issueText,
  MAX_CHOICES,
  normalizeChoiceProposal,
  parseModelJson,
  readExtractShape,
  StateSplitter,
} from "./block";
import {
  BUDGET_LABELS,
  type BudgetTrace,
  contextBudget,
  DEFAULT_WINDOW,
  fitMemories,
  historyMaxFor,
  historyStrideFor,
  historyTurns,
  MIN_HISTORY,
  memoryTokens,
  replyTokenCap,
  stepDownHistory,
} from "./budget";
import {
  type ExtractedCheckpointData,
  type NarratedCheckpointData,
  NarratorStageError,
  type PreparedCheckpointData,
  type TurnCheckpoint,
  type TurnCheckpointStage,
  turnInputKey,
} from "./checkpoint";
import { completeFinish, isLengthFinish } from "./completion";
import { responseJsonSchema, schemaDoc } from "./doc";
import { readEventPlan } from "./event-plan";
import { applyEventCommands, type SettlementEvent } from "./event-settlement";
import { type LoreSource, type LoreTrace, lookupLore } from "./lore";
import { preparePurchases } from "./merchant-settlement";
import {
  buildIdLookup,
  findIdRuleIssues,
  normalizeChangeIds,
  normalizeMemoryNpcIds,
} from "./normalize-ids";
import {
  MacroOffscreenDocSchema,
  nextRetrySeq,
  OFFSCREEN_TEMPERATURE,
  offscreenSkipReason,
  prepareMacroOffscreenBatch,
  prepareSocialOffscreenBatch,
  presentNpcs,
  readMacroOffscreen,
  readSocialOffscreen,
  SocialOffscreenDocSchema,
  trackOffscreenDue,
} from "./offscreen";
import {
  applyExpandedPreset,
  applyPresetRegex,
  presetMessages,
  sanitizePresetNarrative,
  type TavernPreset,
} from "./preset";
import {
  buildExtractPrompt,
  buildJudgePrompt,
  buildNarratorPrompt,
  EXTRACT_TEMPERATURE,
  HISTORY_TURNS,
  hardHackBlockReason,
  JUDGE_TEMPERATURE,
  type NarratorPlan,
  type PromptExtras,
} from "./prompts";
import { estimateTokens } from "./prompts/layers";
import {
  cosineSimilarity,
  type Expansion,
  expandMemories,
  judgeCandidates,
  type MemoryEntry,
  memoryPool,
  scoreMemories,
} from "./retrieve";
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
import { ThoughtStreamSplitter } from "./thought";
import {
  REPAIR_OUTPUT_TOKENS,
  RepairBudget,
  type RepairStage,
  type ValidationEntry,
  validateEntries,
} from "./validation";
import {
  type ActiveWorldbook,
  applyWorldbookDepth,
  resolveWorldbooks,
  worldbookDynamicSection,
} from "./worldbook";

/**
 * 一轮四步：① 判断（辅助模型，JSON Schema：记忆调度与定性物理/社会因果裁决）→ ② 拼上下文
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
  deckLoad: "程序芯片插拔",
  breach: "入侵协议",
  dive: "潜网行动",
  npcHack: "快速破解",
  damage: "伤害",
  healthCondition: "生命状态",
  "health.limb": "断肢",
  "health.die": "死亡",
  trauma: "创伤小组服务",
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
  jobPayment: "委托到账",
  "phone.receive": "收到的消息",
  "phone.reply": "回复的消息",
};

const NEW_NPC_ROLE_HINT =
  /陌生人|兜帽|摊主|店员|酒保|服务员|保安|守卫|门卫|混混|打手|掮客|线人|接头人|雇主|警员|巡警|黑客|义体医生|技师|司机|前台|接待/;

function hasUndecidedOnStage(world: WorldState): boolean {
  const clock = WorldClockStateSchema.parse(world.slices.world);
  const stage = { location: clock.location, sceneStartedAt: clock.sceneStartedAt };
  return Object.values(NpcStateSchema.parse(world.slices.npc).npcs).some(
    (npc) =>
      npc.alive &&
      onStage(npc, stage) &&
      (npc.look.startsWith(NPC_UNDECIDED_PREFIX) || npc.voice.startsWith(NPC_UNDECIDED_PREFIX)),
  );
}

/** 抽取阶段是否需要附带新人物装备选型参考：判断预判新人物、存在未定型旧识，或正文疑似出现未登记角色 */
function narrativeNeedsNpcEquipment(
  world: WorldState,
  newNpcLikely: boolean,
  narrative: string,
): boolean {
  if (newNpcLikely || hasUndecidedOnStage(world)) return true;
  if (NEW_NPC_ROLE_HINT.test(narrative)) return true;
  const clock = WorldClockStateSchema.parse(world.slices.world);
  const stage = { location: clock.location, sceneStartedAt: clock.sceneStartedAt };
  const anyoneOnStage = Object.values(NpcStateSchema.parse(world.slices.npc).npcs).some(
    (npc) => npc.alive && onStage(npc, stage),
  );
  return !anyoneOnStage && /[“「]/.test(narrative);
}

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
  /** 本轮思维链（模型原生推理流或思考标签剥离所得），供前端默认折叠展示 */
  readonly thought?: string | undefined;
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
  /** 叙事模型的用量（写正文） */
  readonly usage: LlmUsage | undefined;
  /** 辅助模型的用量（判断、抽取、场外推演和场景摘要） */
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
  /** 可选向量嵌入客户端：用于旧记忆语义检索，未配置或失败时自动退化为规则检索 */
  readonly embedder?: Embedder | undefined;
  /** 可选语义重排客户端：对粗排前 20 条候选做精排，可与向量模型共用或单独使用 */
  readonly reranker?: Reranker | undefined;
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
  /** 每收到一段思维链（模型原生思考或思考标签内文本）就调用 */
  readonly onThought?: (text: string) => void;
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
  /**
   * 玩家导入并启用的酒馆世界书（可同时启用多本）：只在写正文那一步生效；
   * 蓝灯常驻进静态 system 缓存层，绿灯关键词命中进 user 槽位，@D 深度条目先于酒馆预设叠加，不干扰预设破甲位置
   */
  readonly worldbooks?: readonly ActiveWorldbook[] | undefined;
  /** 预设宏里 {{user}} 换成什么：玩家角色名 */
  readonly userName?: string | undefined;
  /** 可选阶段断点：跳过已完成的大模型调用，从断点继续 */
  readonly checkpoint?: TurnCheckpoint | undefined;
  /** 每走完一次核心阶段即回调保存断点 */
  readonly onCheckpoint?: ((checkpoint: TurnCheckpoint) => Promise<void> | void) | undefined;
  readonly saveId?: string | undefined;
  readonly baseVersion?: number | undefined;
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

const addUsage = (a: LlmUsage, b: LlmUsage | undefined): LlmUsage => {
  if (!b) return a;
  const cached = (a.cachedInputTokens ?? 0) + (b.cachedInputTokens ?? 0);
  const write = (a.cacheWriteTokens ?? 0) + (b.cacheWriteTokens ?? 0);
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    ...(cached > 0 ? { cachedInputTokens: cached } : {}),
    ...(write > 0 ? { cacheWriteTokens: write } : {}),
  };
};

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
      this.checkAborted();
      if (event.type === "text") text += event.text;
      else if (event.type === "blocked") return { blocked: event.reason };
      else if (event.type === "done") {
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
    const stageLabel =
      stage === "judge"
        ? "判断"
        : stage === "extract"
          ? "抽取"
          : stage === "extract-rules"
            ? "实体ID"
            : stage === "offscreen-macro"
              ? "宏观推演"
              : "人物推演";
    const content = `${task}\n\n原文：\n${raw}`;
    const denied = this.repairBudget.claim(stage, `${REPAIR_SYSTEM}\n${content}`);
    if (denied) {
      noteOnce(this.notes, `${stageLabel}：${denied}，未追加修复请求`);
      return undefined;
    }
    this.repairs += 1;
    this.deps.onStage?.({
      stage: "repair",
      label: stage === "extract-rules" ? "实体 ID 自动修正" : `格式修复（${stageLabel}）`,
      detail:
        stage === "extract-rules" ? "核对并修正引用错误的人物或目录 ID" : "修正结构化 JSON 输出",
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
  "phoneContact",
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

async function computeVectorScores(
  embedder: Embedder | undefined,
  pool: readonly MemoryEntry[],
  queryText: string,
  signal?: AbortSignalLike,
): Promise<ReadonlyMap<string, number> | undefined> {
  if (signal?.aborted) throw new NarratorAbortedError("已停止生成");
  if (!embedder || pool.length === 0 || queryText.trim() === "") return undefined;
  const docTexts = pool.map((e) => `${e.title}\n${e.text}`.slice(0, 600));
  let qVectors: readonly (readonly number[])[];
  let docVectors: readonly (readonly number[])[];
  try {
    [qVectors, docVectors] = await Promise.all([
      embedder.embed([queryText], { signal, task: "query" }),
      embedder.embed(docTexts, { signal, task: "document" }),
    ]);
  } catch {
    if (signal?.aborted) throw new NarratorAbortedError("已停止生成");
    return undefined;
  }
  if (signal?.aborted) throw new NarratorAbortedError("已停止生成");
  const qVec = qVectors[0];
  if (!qVec || qVec.length === 0 || docVectors.length !== pool.length) return undefined;
  const map = new Map<string, number>();
  for (let i = 0; i < pool.length; i += 1) {
    const entry = pool[i];
    const vec = docVectors[i];
    if (!entry || !vec || vec.length === 0) continue;
    const sim = cosineSimilarity(qVec, vec);
    if (sim > 0) map.set(entry.id, sim);
  }
  return map.size > 0 ? map : undefined;
}

/** 第二阶段精排：只把粗排最靠前的候选送给重排模型，兼顾速度、成本与准度 */
const RERANK_TOP_K = 20;

async function computeRerankScores(
  reranker: Reranker | undefined,
  candidates: readonly MemoryEntry[],
  queryText: string,
  signal?: AbortSignalLike,
): Promise<ReadonlyMap<string, number> | undefined> {
  if (signal?.aborted) throw new NarratorAbortedError("已停止生成");
  if (!reranker || candidates.length === 0 || queryText.trim() === "") return undefined;
  const shortlist = candidates.slice(0, RERANK_TOP_K);
  const documents = shortlist.map((e) => `${e.title}\n${e.text}`.slice(0, 600));
  let ranked: readonly { readonly index: number; readonly score: number }[];
  try {
    ranked = await reranker.rerank(queryText, documents, { topN: documents.length, signal });
  } catch {
    if (signal?.aborted) throw new NarratorAbortedError("已停止生成");
    return undefined;
  }
  if (signal?.aborted) throw new NarratorAbortedError("已停止生成");
  if (ranked.length === 0) return undefined;
  const map = new Map<string, number>();
  for (const row of ranked) {
    const entry = shortlist[row.index];
    if (!entry || !Number.isFinite(row.score)) continue;
    const clamped = Math.max(0, Math.min(1, row.score));
    if (clamped > 0) map.set(entry.id, clamped);
  }
  return map.size > 0 ? map : undefined;
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
  b.checkAborted();
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
  const saveCheckpoint = async (
    stage: TurnCheckpointStage,
    prepared: PreparedCheckpointData,
    narrated?: NarratedCheckpointData,
    extracted?: ExtractedCheckpointData,
  ): Promise<void> => {
    b.checkAborted();
    if (!deps.onCheckpoint || deps.saveId === undefined || deps.baseVersion === undefined) return;
    if (plan.kind !== "action") return;
    await deps.onCheckpoint({
      saveId: deps.saveId,
      baseVersion: deps.baseVersion,
      input: plan.input,
      inputKey: turnInputKey(plan.input),
      stage,
      updatedAt: new Date().toISOString(),
      prepared,
      ...(narrated ? { narrated } : {}),
      ...(extracted ? { extracted } : {}),
    });
    b.checkAborted();
  };

  let preparedData: PreparedCheckpointData;
  if (deps.checkpoint) {
    const cp = deps.checkpoint.prepared;
    preparedData = cp;
    b.auxUsage = cp.auxUsage;
    b.repairs = cp.repairs;
    b.repairUsage = cp.repairUsage;
    b.notes.push(...cp.notes);
    b.dropped.push(...cp.dropped);
    b.flags.push(...cp.flags);
    if (
      cp.confirmation &&
      ((deps.approvedSpend !== undefined && deps.approvedSpend !== cp.confirmation.quoteKey) ||
        (cp.spend &&
          !(
            plan.kind === "action" &&
            plan.input.spendOk === true &&
            deps.approvedSpend === cp.confirmation.quoteKey
          )))
    ) {
      return { kind: "confirmSpend", ...cp.confirmation };
    }
    deps.onStage?.({
      stage: "prepare",
      label: "从断点恢复",
      detail: "已跳过第 ① 步意图判断与上下文拼装",
    });
  } else {
    // ① 判断：用原生 JSON Schema 获取意图、物理/社会因果定性裁决和记忆调度；旧存档选了出戏也跳过
    let judge: JudgeShape = {};
    // 上下文预算：原文带几轮、【前情】多少额度先定下，候选池按同一组数去重
    const budget = contextBudget(deps.contextWindow);
    const historyStride = historyStrideFor(budget.window);
    const historyMax = historyMaxFor(budget.window, HISTORY_TURNS);
    const promptRecords = memoryRecords(world, records);
    let hot = historyTurns(promptRecords, budget.parts.history, historyMax, historyStride);
    let recapTokens = budget.parts.recap;
    const pool =
      plan.kind === "action" && !legacyOoc ? memoryPool(world, records, hot, recapTokens) : [];
    const lately = effectiveTurns(promptRecords)
      .slice(-2)
      .map((t) => t.text)
      .join("\n");
    if (plan.kind === "action" && !legacyOoc && deps.embedder && pool.length > 0) {
      deps.onStage?.({
        stage: "prepare",
        label: "检索旧记忆（向量）",
        detail: `匹配 ${pool.length} 条记忆片段`,
      });
    }
    const vectorScores =
      plan.kind === "action" && !legacyOoc
        ? await computeVectorScores(deps.embedder, pool, plan.input.text, deps.signal)
        : undefined;
    const coarseForRerank =
      plan.kind === "action" && !legacyOoc && deps.reranker && pool.length > 0
        ? scoreMemories(pool, world, { input: plan.input.text, context: lately, vectorScores })
            .slice(0, RERANK_TOP_K)
            .map((s) => s.entry)
        : [];
    if (coarseForRerank.length > 0) {
      deps.onStage?.({
        stage: "prepare",
        label: "精排旧记忆（重排）",
        detail: `精排前 ${coarseForRerank.length} 条候选记忆`,
      });
    }
    const rerankScores =
      coarseForRerank.length > 0
        ? await computeRerankScores(deps.reranker, coarseForRerank, plan.input.text, deps.signal)
        : undefined;
    const memories: Memory[] =
      plan.kind === "action"
        ? judgeCandidates(pool, world, {
            input: plan.input.text,
            context: lately,
            vectorScores,
            rerankScores,
          })
        : [];
    if (plan.kind === "action" && !legacyOoc) {
      deps.onStage?.({
        stage: "judge",
        label: "① 意图判断与因果裁决",
        detail: "调度记忆并核对物理与局势条件",
      });
      const prompt = buildJudgePrompt(world, records, plan, extras, memories);
      const reply = await b.call({
        purpose: "aux",
        temperature: JUDGE_TEMPERATURE,
        responseFormat: responseJsonSchema("judge", JudgeDocSchema),
        messages: prompt.messages,
        ...(deps.saveId ? { cacheKey: `cp:${deps.saveId}:judge` } : {}),
      });
      if ("blocked" in reply) return { kind: "blocked", reason: reply.blocked };
      b.auxUsage = addUsage(b.auxUsage, reply.usage);
      judge = await b.readJudge(reply.text);
      if (b.dropped.some((d) => d.where === "判断"))
        return {
          kind: "blocked",
          reason: "本轮判断格式无法修复，尚未推进剧情或修改状态，请重试。",
        };
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
    // 代码级物理硬锁：未装完好网络接入仓却主动尝试发起快速破解/黑客入侵时，强制锁定 blocked，不依赖模型自觉
    if (plan.kind === "action" && !ooc && !inFlashback && rulingSpec?.kind !== "blocked") {
      const hackBlock = hardHackBlockReason(
        world,
        deps.data,
        [plan.input.text, read ?? ""].join("\n"),
      );
      if (hackBlock) {
        rulingSpec = {
          kind: "blocked",
          outcome: hackBlock,
          harm: "none",
          reason: hackBlock,
        };
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

    // 旧记忆：兼容纯标题与「标题｜摘要」写法
    const recalled: Memory[] = [];
    if (!ooc) {
      for (const [i, raw] of (judge.recall ?? []).entries()) {
        const where = `recall[${i}]`;
        const text = typeof raw === "string" ? raw.trim() : "";
        const hit =
          text !== ""
            ? memories.find((m) => m.title === text || text.startsWith(`${m.title}｜`))
            : undefined;
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
            {
              input: [plan.input.text, read ?? ""].join("\n"),
              context: lately,
              vectorScores,
              rerankScores,
            },
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
    if (!ooc && !inFlashback) {
      const uiActions = pendingUiActions(records);
      if (uiActions.length > 0) {
        decided.push(
          `【刚完成的界面操作（已结算，须自然写进本轮正文，严禁重复扣款/发货）】${uiActions.map((a) => a.summary).join("；")}`,
        );
      }
    }
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
          ? `【本次交易报价】${proposal.destination ? `以实际到达 ${proposal.destination} 为前提；` : ""}${quote.detail}。这一条只对应一件或一次服务；玩家本轮已明确付款或同意交付时当轮爽快收款推进，不得另改交易对象、价钱或旧件处理，也不要编造额外转账通道故障拖延成交。`
          : `【本次交易尚不能成立】${quote.reason}。直接说明这一真实障碍即可，不要编造互相矛盾的付款通道借口；未解决前不能先写成已付款、拿货或安装。`,
      );
    }
    // 抽取只认硬事实与已定条件；对手打算与人物潜台词便笺仅给正文主笔，不混入抽取
    const extractDecided = [...decided];
    const foes =
      !ooc && typeof judge.foes === "string" && judge.foes.trim() !== ""
        ? judge.foes.trim().slice(0, FOES_CHARS)
        : undefined;
    if (foes)
      decided.push(`对手这一轮的打算（对手不会只等着挨打；按局面写进对手的行动，可以改）：${foes}`);
    const npcPulse =
      !ooc && !inFlashback && typeof judge.npcPulse === "string" && judge.npcPulse.trim() !== ""
        ? judge.npcPulse.trim().slice(0, 220)
        : undefined;
    if (npcPulse) {
      decided.push(
        `【人物潜台词便笺（幕后导演参考：自然融入对方神态、停顿、话外音与反应中，切勿直接说破隐藏秘密）】${npcPulse}`,
      );
    }
    const newNpcLikely = !ooc && !inFlashback && judge.newNpcLikely === true;
    // 裁决理由：仅留档在剧透视图里查看，不进游戏正文
    const ruling = rulingSpec
      ? `${rulingSpec.outcome}（${rulingSpec.reason}）`.slice(0, RULING_CHARS)
      : undefined;

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
    const macroCtx = {
      user: deps.userName ?? CharacterStateSchema.parse(world.slices.character).name ?? "玩家",
      char: "叙事者",
      lastUserMessage: plan.input.text,
      roll: (sides: number) => deps.rng.roll(sides),
    };
    // 宏只展开一次，预设的前置、深度条目及衔接说明都计入最终请求预算。
    const expandedPreset = preset ? presetMessages(preset, macroCtx) : undefined;
    const presetTokens = expandedPreset
      ? applyExpandedPreset([], expandedPreset).reduce((n, m) => n + estimateTokens(m.content), 0)
      : 0;
    // 酒馆世界书（可同时启用多本）：仅在非场外提问时评估；蓝灯常驻进静态 system，绿灯动态进 user，@D 在预设之前插入
    const resolvedWorldbook =
      !ooc && deps.worldbooks && deps.worldbooks.length > 0
        ? (() => {
            const clockNow = WorldClockStateSchema.parse(world.slices.world);
            const loc = clockNow.location
              ? locationCatalog(withSavedPlaces(deps.data ?? {}, world)).get(clockNow.location)
              : undefined;
            const sceneTerms: string[] = [];
            if (loc?.name) sceneTerms.push(loc.name);
            const stage = { location: clockNow.location, sceneStartedAt: clockNow.sceneStartedAt };
            for (const npc of Object.values(NpcStateSchema.parse(world.slices.npc).npcs)) {
              if (!npc.alive || !onStage(npc, stage)) continue;
              if (npc.name) sceneTerms.push(npc.name);
              if (npc.alias) sceneTerms.push(npc.alias);
            }
            const recentTurnTexts = effectiveTurns(promptRecords).map((t) => {
              const inputText =
                typeof (t.input as { text?: unknown } | undefined)?.text === "string"
                  ? (t.input as { text: string }).text
                  : "";
              return inputText ? `${inputText}\n${t.text}` : t.text;
            });
            return resolveWorldbooks(deps.worldbooks, {
              inputText: plan.input.text,
              recentTurnTexts,
              sceneTerms,
              macro: macroCtx,
            });
          })()
        : undefined;
    let dynamicWorldbookEntries = resolvedWorldbook ? [...resolvedWorldbook.dynamicEntries] : [];
    const atDepthTokens = resolvedWorldbook
      ? resolvedWorldbook.atDepth.reduce((n, e) => n + e.tokens, 0)
      : 0;
    const sampling = preset?.sampling ?? {};
    const replyCap = replyTokenCap(budget);
    const requestedReply =
      deps.maxOutputTokens !== undefined && sampling.maxOutputTokens !== undefined
        ? Math.min(deps.maxOutputTokens, sampling.maxOutputTokens)
        : (deps.maxOutputTokens ?? sampling.maxOutputTokens ?? budget.parts.reply);
    let maxOutputTokens = Math.max(1, Math.floor(Math.min(requestedReply, replyCap)));
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
    // 新人物装备创作参考按需挂载：仅当判断预判新人物或现场存在未定型旧识时加载，常规熟人对话/独处不塞噪音
    let includeNpcEquipment =
      extras.data !== undefined &&
      live.input.mode !== "ooc" &&
      (newNpcLikely || hasUndecidedOnStage(world));
    const build = () =>
      buildNarratorPrompt(world, records, live, {
        ...extras,
        includeNpcEquipment,
        hasPreset: preset !== undefined,
        intensity,
        decided,
        recalled: [...recalled, ...expanded],
        lore: loreSection,
        worldbookStaticBefore: resolvedWorldbook?.constantBefore,
        worldbookStaticAfter: resolvedWorldbook?.constantAfter,
        worldbookDynamic: worldbookDynamicSection(dynamicWorldbookEntries),
        history: hot,
        recapTokens,
      });
    // 整份超出窗口时先撤可选装备参考与低优先级动态世界书条目，再按原顺序裁记忆材料；原文保留 MIN_HISTORY 轮。
    let limit = budget.window - maxOutputTokens;
    const totalOf = (p: ReturnType<typeof build>) =>
      presetTokens + atDepthTokens + p.messages.reduce((n, m) => n + estimateTokens(m.content), 0);
    let prompt = build();
    for (let total = totalOf(prompt); total > limit; total = totalOf(prompt)) {
      if (includeNpcEquipment) {
        includeNpcEquipment = false;
        cuts.push("整份超出，先撤下新人物装备选型参考，保留记忆与历史");
      } else if (dynamicWorldbookEntries.length > 0) {
        const droppedWb = dynamicWorldbookEntries[0];
        dynamicWorldbookEntries = dynamicWorldbookEntries.slice(1);
        cuts.push(`整份超出，裁去低优先级世界书条目「${droppedWb?.entryName ?? "未命名"}」`);
      } else if (expanded.length > 0) {
        expanded = expanded.slice(0, -1);
        cuts.push("整份超出，扩展层少补一条");
      } else if (recapTokens > 0 && (prompt.parts?.recap ?? 0) > 0) {
        recapTokens = recapTokens >= 400 ? Math.floor(recapTokens / 2) : 0;
        cuts.push(`整份超出，【前情】额度降到 ${recapTokens}`);
      } else if (loreSection !== undefined) {
        loreSection = undefined;
        cuts.push("整份超出，不带设定资料");
      } else if (hot > MIN_HISTORY) {
        hot = stepDownHistory(promptRecords, hot, historyStride);
        cuts.push(`整份超出，原文按缓存步长收紧（剩 ${hot} 轮）`);
      } else if (maxOutputTokens > budget.parts.reply) {
        maxOutputTokens = Math.max(budget.parts.reply, budget.window - total);
        limit = budget.window - maxOutputTokens;
        cuts.push(`整份超出，回复预留降至 ${maxOutputTokens}`);
        continue;
      } else {
        return {
          kind: "blocked",
          reason: `当前规则、人物状态、最低限度历史与写作预设/世界书合计约 ${total} token，超过本次输入预算 ${limit}。请缩短写作预设、停用部分常驻世界书条目或提高模型上下文窗口后重试；本轮尚未写入。`,
        };
      }
      prompt = build();
    }
    const used = prompt.parts ?? {};
    const worldbookTokens = (used.worldbook ?? 0) + atDepthTokens;
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
        ...(worldbookTokens > 0
          ? [{ part: "worldbook", label: "酒馆世界书", tokens: worldbookTokens, limit: null }]
          : []),
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
    // 先插入世界书 @D 深度条目，再叠加酒馆预设（保证预设的 head 与 depth:0 破甲位置 100% 不受干扰）
    const withWorldbook = resolvedWorldbook
      ? applyWorldbookDepth(prompt.messages, resolvedWorldbook.atDepth)
      : prompt.messages;
    const narrateMessages = expandedPreset
      ? applyExpandedPreset(withWorldbook, expandedPreset)
      : withWorldbook;
    if (preset) b.notes.push(`写正文套用了酒馆预设「${preset.name}」`);
    if (resolvedWorldbook && resolvedWorldbook.hits.length > 0) {
      const constCount = resolvedWorldbook.hits.filter(
        (h) => h.constant && h.position !== "at_depth",
      ).length;
      const dynCount = dynamicWorldbookEntries.length;
      const depthCount = resolvedWorldbook.atDepth.length;
      const keptCount = constCount + dynCount + depthCount;
      if (keptCount > 0) {
        b.notes.push(
          `附加世界书命中 ${keptCount} 条（常驻 ${constCount} / 关键词 ${dynCount}${depthCount > 0 ? ` / 深度 ${depthCount}` : ""}）`,
        );
      }
    }

    preparedData = {
      liveInput: live.input,
      ooc,
      read,
      rulingSpec,
      counterHackSpec,
      ruling,
      sandevistanBoosted,
      activeBoost: activeBoost ? { id: activeBoost.id, name: activeBoost.name } : undefined,
      recalled,
      expanded,
      retrieval,
      trip,
      purchases: prepared.purchases,
      confirmation,
      spend: prepared.spend,
      decided,
      extractDecided,
      newNpcLikely,
      loreTrace,
      loreSection,
      budgetTrace,
      promptModules: prompt.modules,
      narrateMessages,
      maxOutputTokens,
      sampling: {
        ...(sampling.temperature !== undefined ? { temperature: sampling.temperature } : {}),
        ...(sampling.topP !== undefined ? { topP: sampling.topP } : {}),
        ...(sampling.topK !== undefined ? { topK: sampling.topK } : {}),
      },
      presetName: preset?.name,
      auxUsage: b.auxUsage,
      repairs: b.repairs,
      repairUsage: b.repairUsage,
      notes: [...b.notes],
      dropped: [...b.dropped],
      flags: [...b.flags],
    };
    await saveCheckpoint("prepared", preparedData);
  }

  const {
    ooc,
    read,
    rulingSpec,
    counterHackSpec,
    ruling,
    sandevistanBoosted,
    activeBoost,
    recalled,
    expanded,
    retrieval,
    trip,
    purchases: preparedPurchases,
    decided,
    extractDecided,
    newNpcLikely,
    loreTrace,
    budgetTrace,
    promptModules,
    narrateMessages,
    maxOutputTokens,
    sampling,
    presetName,
  } = preparedData;
  const live: NarratorPlan = { kind: "action", input: preparedData.liveInput };
  const preset = ooc ? undefined : deps.preset;

  if (sandevistanBoosted && activeBoost) {
    deps.onBoost?.({ id: activeBoost.id, name: activeBoost.name });
  }
  let narrative: string;
  let thought: string | undefined;
  let narratedData: NarratedCheckpointData;
  const draftOnly = (text: string, reason: string): NarratorResult => ({
    kind: "done",
    turn: {
      text,
      ...(thought !== undefined ? { thought } : {}),
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
      modules: promptModules,
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

  if (deps.checkpoint?.narrated) {
    narratedData = deps.checkpoint.narrated;
    narrative = narratedData.narrative;
    thought = narratedData.thought;
    usage = narratedData.usage;
    b.notes.splice(0, b.notes.length, ...narratedData.notes);
    b.dropped.splice(0, b.dropped.length, ...narratedData.dropped);
    deps.onStage?.({
      stage: "narrate",
      label: "已恢复第 ③ 步正文",
      detail: "跳过重新生成，直接继续记账",
    });
    if (thought) deps.onThought?.(thought);
    deps.onText?.(narrative);
  } else {
    const splitter = new StateSplitter();
    const thoughtSplitter = new ThoughtStreamSplitter();
    let nativeThought = "";
    let narrativeIssue: string | undefined;
    let narrativeComplete = false;
    let narrativeError: unknown;
    const emitBodyChunk = (chunk: string) => {
      if (chunk === "") return;
      const piece = thoughtSplitter.push(chunk);
      if (piece.thought !== "") deps.onThought?.(piece.thought);
      if (piece.text !== "") deps.onText?.(piece.text);
    };
    b.checkAborted();
    deps.onStage?.({
      stage: "narrate",
      label: "③ 正在写正文",
      detail: presetName ? `流式生成（预设「${presetName}」）` : "流式生成剧情",
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
          ...(deps.saveId ? { cacheKey: `cp:${deps.saveId}:narrate` } : {}),
        },
        deps.signal,
      )) {
        b.checkAborted();
        if (event.type === "thought") {
          if (event.text !== "") {
            nativeThought += event.text;
            deps.onThought?.(event.text);
          }
        } else if (event.type === "text") {
          emitBodyChunk(splitter.push(event.text));
        } else if (event.type === "blocked") {
          return { kind: "blocked", reason: event.reason };
        } else if (event.type === "done") {
          addNarrator(event.usage);
          narrativeComplete = completeFinish(event.finishReason);
          if (!narrativeComplete) {
            if (isLengthFinish(event.finishReason)) {
              const usedOut = event.usage?.outputTokens ?? usage?.outputTokens;
              const stat =
                usedOut !== undefined
                  ? `${usedOut}/${maxOutputTokens} tokens`
                  : `上限 ${maxOutputTokens} tokens`;
              narrativeIssue = `正文未完整生成（输出达到上限：${stat}，${event.finishReason}），已保存草稿；本轮未推进世界，请调大最大输出上限或重新生成。`;
            } else {
              const reasonTag = event.finishReason ? `（结束原因：${event.finishReason}）` : "";
              narrativeIssue = `正文未完整生成${reasonTag}，已保存草稿；本轮未推进世界，请重新生成。`;
            }
          }
        }
      }
    } catch (error) {
      b.checkAborted();
      if (error instanceof NarratorAbortedError) throw error;
      narrativeError = error;
    }
    b.checkAborted();
    if (narrativeError) throw narrativeError;
    const split = splitter.finish();
    const { rest, block } = split;
    if (rest !== "") emitBodyChunk(rest);
    const thoughtSplit = thoughtSplitter.finish();
    if (thoughtSplit.restThought !== "") deps.onThought?.(thoughtSplit.restThought);
    if (thoughtSplit.restText !== "") deps.onText?.(thoughtSplit.restText);
    const mergedThought = [nativeThought.trim(), thoughtSplit.thought]
      .filter((part) => part !== "")
      .join("\n\n");
    thought = mergedThought !== "" ? mergedThought : undefined;
    // 预设正则改存下来的纯净正文（标签、八股词之类）；思考标签已单独收入 thought 供折叠查看
    const rawBody = thoughtSplit.body;
    const regexCleaned = preset ? applyPresetRegex(rawBody, preset).trim() : rawBody;
    const cleaned = preset ? sanitizePresetNarrative(regexCleaned) : regexCleaned;
    // 正则或标签清理把正文整段清空（例如玩家打开了只该改旧楼层的那类）时保底用原文，不让这一轮白写
    const wiped = preset !== undefined && cleaned === "" && rawBody.trim() !== "";
    narrative = wiped ? rawBody : cleaned;
    if (wiped) b.notes.push("预设正则会把整段正文清空，这一轮没套正则，用的是原文");
    else if (preset && narrative !== rawBody.trim())
      b.notes.push("正文按预设正则清理过（思维链、标签等）");
    if (narrative === "") {
      throw new NarratorEmptyReplyError("模型没有返回正文，可以重试");
    }
    if (block !== null) b.notes.push("正文末尾带了指令块，已经去掉；状态按抽取结算");

    if (!narrativeComplete || narrativeIssue) {
      const reason = narrativeIssue ?? "正文没有正常结束，已保存草稿；本轮未推进世界，请重新生成。";
      b.drop("正文", null, reason, "format");
      return draftOnly(narrative, reason);
    }

    narratedData = {
      narrative,
      ...(thought !== undefined ? { thought } : {}),
      usage,
      notes: [...b.notes],
      dropped: [...b.dropped],
    };
    await saveCheckpoint("narrated", preparedData, narratedData);
  }

  // ④ 抽取：场外提问不抽，状态不变；其余常规与裁决回合都照常记账
  const settle = !ooc;
  let extractedData: ExtractedCheckpointData;
  if (deps.checkpoint?.extracted) {
    extractedData = deps.checkpoint.extracted;
    b.auxUsage = extractedData.auxUsage;
    b.repairs = extractedData.repairs;
    b.repairUsage = extractedData.repairUsage;
    b.notes.splice(0, b.notes.length, ...extractedData.notes);
    b.dropped.splice(0, b.dropped.length, ...extractedData.dropped);
    deps.onStage?.({
      stage: "extract",
      label: "已恢复第 ④ 步记账",
      detail: "跳过重新抽取，继续推演与保存",
    });
  } else {
    let shape: ExtractShape = {};
    if (settle) {
      deps.onStage?.({
        stage: "extract",
        label: "④ 抽取状态与记账",
        detail: "识别事件、交易、物件与关系变化",
      });
      // 兼容从旧断点恢复的正文：防御性剥离酒馆预设残留的 HTML/脚本与元信息块，避免送入抽取时撑爆请求或触发断连
      const extractNarrative = sanitizePresetNarrative(narrative);
      const tradePlansText = preparedPurchases.length
        ? preparedPurchases
            .map(
              ({ proposal, quote }) =>
                `${JSON.stringify(proposal)}：${quote.ok ? quote.detail : `未获准成交：${quote.reason}`}`,
            )
            .join("\n")
        : "本轮没有确认交易意图；可以保存对方报价，不应执行购买、出售、义体服务或还款。";
      const extractFacts = extractDecided ?? decided;
      const needExtractEquipment = narrativeNeedsNpcEquipment(
        world,
        Boolean(newNpcLikely),
        extractNarrative,
      );
      let extract = buildExtractPrompt(
        world,
        records,
        live,
        { ...extras, decided: extractFacts, includeNpcEquipment: needExtractEquipment },
        extractNarrative,
        tradePlansText,
      );
      // 只撤可选创作/能力参考，不裁正文、事实、人物边界或完整 ID 基表。
      // 辅助连接未单独配置时实际回落到正文连接，窗口也按同一连接核算。
      const auxWindow = deps.auxContextWindow ?? deps.contextWindow ?? DEFAULT_WINDOW;
      const auxOutput = deps.auxMaxOutputTokens ?? deps.maxOutputTokens ?? 4_096;
      const auxBudget = Math.max(0, auxWindow - auxOutput);
      // 为消息角色与供应商的 JSON 协议包装留余量；不能用输入预算下限突破实际窗口。
      const estimateExtract = (p: ReturnType<typeof buildExtractPrompt>) =>
        256 + p.messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
      if (estimateExtract(extract) > auxBudget) {
        if (needExtractEquipment) {
          extract = buildExtractPrompt(
            world,
            records,
            live,
            { ...extras, decided: extractFacts, includeNpcEquipment: false },
            extractNarrative,
            tradePlansText,
          );
          noteOnce(b.notes, "抽取窗口不足，撤下可选新人物装备参考；完整正文与世界事实保留");
        }
        if (estimateExtract(extract) > auxBudget) {
          extract = buildExtractPrompt(
            world,
            records,
            live,
            {
              ...extras,
              decided: extractFacts,
              includeNpcEquipment: false,
              includeCatalogDetails: false,
            },
            extractNarrative,
            tradePlansText,
          );
          noteOnce(b.notes, "抽取窗口不足，撤下可选能力详解；完整物品、义体与地点 ID 基表保留");
        }
      }
      const extractInput = estimateExtract(extract);
      if (extractInput > auxBudget) {
        const minimumWindow = extractInput + auxOutput;
        throw new NarratorStageError(
          "extract",
          `④ 辅助模型上下文不足：当前窗口 ${auxWindow} token，完整抽取输入估算 ${extractInput} token（含协议余量），输出预留 ${auxOutput} token，合计至少需要 ${minimumWindow} token。未发送超预算请求，完整正文与事实已保存在正文断点。请改用实际支持至少 ${minimumWindow} token 的辅助模型并更新窗口配置；也可在输入可容纳时降低输出上限。配置调整后可从已保存正文继续记账，原配置下反复重试不会解决。`,
          false,
          "narrated",
        );
      }
      let reply: Reply;
      try {
        reply = await b.call({
          purpose: "aux",
          temperature: EXTRACT_TEMPERATURE,
          maxOutputTokens: auxOutput,
          responseFormat: responseJsonSchema("extract"),
          messages: extract.messages,
          ...(deps.saveId ? { cacheKey: `cp:${deps.saveId}:extract` } : {}),
        });
      } catch (error) {
        b.checkAborted();
        if (error instanceof NarratorAbortedError) throw error;
        if (error instanceof IncompleteReplyError) {
          throw new NarratorStageError(
            "extract",
            "④ 抽取记账回复未完整结束（已保存判断与正文，点重试将直接继续记账）",
            true,
            "narrated",
          );
        }
        throw error;
      }
      if ("blocked" in reply) {
        throw new NarratorStageError(
          "extract",
          `④ 抽取被辅助模型拦截：${reply.blocked}（已保存判断与正文）`,
          true,
          "narrated",
        );
      }
      b.auxUsage = addUsage(b.auxUsage, reply.usage);
      shape = await b.readExtract(reply.text);
      const extractDrop = b.dropped.find((entry) => entry.where === "抽取");
      if (extractDrop) {
        throw new NarratorStageError(
          "extract",
          `④ 抽取格式无法修复（${extractDrop.reason}；已保存判断与正文，点重试将直接继续记账）`,
          true,
          "narrated",
        );
      }
    }
    const considered: string[] = settle ? readConsidered(shape.dropped) : [];
    let eventPlan = readEventPlan(settle ? shape.events : []);
    if (!eventPlan.ok && settle) {
      const fixedEvents = await b.repair(
        "extract",
        `下面的 events 事件清单校验失败（${eventPlan.error}）。请修成合法 JSON 对象 {"events":[...]}：每个事件含 id（本轮唯一小写英文数字连字符）、requires（仅引用排在前面的事件 id 或 "$action"，独立事件写 []）、changes（指令数组）与可选 messages，不能有空事件；不增删原文事实。`,
        JSON.stringify(shape.events ?? []),
      );
      if (fixedEvents !== undefined) {
        const candidate = Array.isArray(fixedEvents)
          ? fixedEvents
          : typeof fixedEvents === "object" && fixedEvents !== null && "events" in fixedEvents
            ? (fixedEvents as { events?: unknown }).events
            : undefined;
        if (candidate !== undefined) {
          const secondPlan = readEventPlan(candidate);
          if (secondPlan.ok) {
            eventPlan = secondPlan;
            b.notes.push("事件因果清单格式已自动修正");
          }
        }
      }
    }
    if (!eventPlan.ok) {
      throw new NarratorStageError(
        "extract",
        `④ 事件因果不完整：${eventPlan.error}（已保存判断与正文，点重试将直接继续记账）`,
        true,
        "narrated",
      );
    }
    const owner = new Map(eventPlan.events.flatMap((e) => e.entries.map((entry) => [entry, e.id])));

    // 先做唯一精确名称 -> id 的确定性归一（绝不猜模糊匹配），再逐条 Zod 校验与批量格式修复。
    let idLookup = buildIdLookup(world, deps.data ?? {}, eventPlan.changes);
    const extractEntries: ValidationEntry[] = [];
    const rawChangeTypes = new Map<string, string>();
    for (const [i, item] of eventPlan.changes.entries()) {
      const where = `changes[${i}]`;
      const type =
        typeof item === "object" && item !== null ? (item as { type?: unknown }).type : undefined;
      if (typeof type === "string") rawChangeTypes.set(where, type);
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
      // 建卡的原始 id 保留到批量格式修复结束，再连同后续引用一次归一。
      const idNorm = normalizeChangeIds(proposal.value, idLookup, false);
      for (const note of idNorm.notes) noteOnce(b.notes, note);
      extractEntries.push({
        key: where,
        raw: idNorm.value,
        schema,
        priority: typeof type === "string" && (type === "world" || KEY_ITEMS[type]) ? 1 : 0,
      });
    }
    if (!inFlashback) {
      for (const [i, item] of eventPlan.messages.slice(0, MESSAGES_PER_TURN).entries())
        extractEntries.push({ key: `messages[${i}]`, raw: item, schema: IncomingMessageSchema });
    }
    const extracted = new Map(await b.validateBatch("extract", extractEntries));
    // 修复可能补回姓名或调整建卡字段，不能继续使用修复前的实体索引。
    const validatedChanges = eventPlan.changes.flatMap((_, index) => {
      const value = extracted.get(`changes[${index}]`);
      return value === undefined ? [] : [value];
    });
    idLookup = buildIdLookup(world, deps.data ?? {}, validatedChanges);
    for (const [key, value] of extracted) {
      if (!key.startsWith("changes[")) continue;
      const normalized = normalizeChangeIds(value, idLookup);
      for (const note of normalized.notes) noteOnce(b.notes, note);
      extracted.set(key, normalized.value);
    }
    shape = {
      ...shape,
      sceneMemory: normalizeMemoryNpcIds(shape.sceneMemory, idLookup),
      summary: normalizeMemoryNpcIds(shape.summary, idLookup),
    };

    // 落盘前轻量规则预检：把错填成事件 slug 或不存在实体 id 的条目，连同合法候选清单打包做 1 次精准修正
    const idPrecheck = findIdRuleIssues(extracted, idLookup, world, deps.data ?? {});
    if (idPrecheck.issues.length > 0) {
      const issueMap = new Map(idPrecheck.issues.map((item) => [item.key, item]));
      const idRepairTask = [
        "下面几条记账指令引用了当前存档或目录中不存在的 id（例如把事件 slug 填成了人物 id）。",
        "请只根据下面的候选清单把错误 id 改成对应的已有规范 id；保持其余字段与原意不变，确实没有对应实体时省略该条。",
        '只返回 {"fixes":[{"key":"原样的条目键","value":修正后的完整指令对象}]}。',
        idPrecheck.candidates,
      ].join("\n");
      const idFixed = await b.repair(
        "extract-rules",
        idRepairTask,
        JSON.stringify(idPrecheck.issues.map(({ key, raw, error }) => ({ key, raw, error }))),
      );
      const fixes =
        typeof idFixed === "object" && idFixed !== null && "fixes" in idFixed
          ? (idFixed as { fixes?: unknown }).fixes
          : undefined;
      if (Array.isArray(fixes)) {
        const fixKeys = fixes.map((f) =>
          typeof f === "object" && f !== null && "key" in f
            ? (f as { key?: unknown }).key
            : undefined,
        );
        for (const fix of fixes) {
          if (
            typeof fix !== "object" ||
            fix === null ||
            typeof (fix as { key?: unknown }).key !== "string"
          ) {
            continue;
          }
          const key = (fix as { key: string }).key;
          const original = issueMap.get(key);
          if (!original || fixKeys.filter((k) => k === key).length !== 1) continue;
          const candidateVal = (fix as { value?: unknown }).value;
          if (typeof candidateVal !== "object" || candidateVal === null) continue;
          const candidateType = (candidateVal as { type?: unknown }).type;
          if (candidateType !== original.raw.type) continue;
          const schema =
            typeof candidateType === "string" ? registry.commandSchema(candidateType) : undefined;
          if (!schema) continue;
          const normalized = normalizeChangeIds(
            registry.normalizeProposal(candidateVal).value,
            idLookup,
          ).value;
          const parsed = schema.safeParse(normalized);
          if (!parsed.success) continue;
          const singleCheck = findIdRuleIssues(
            new Map([[key, parsed.data]]),
            idLookup,
            world,
            deps.data ?? {},
          );
          if (singleCheck.issues.length === 0) {
            extracted.set(key, parsed.data);
            b.notes.push(`${key} 的实体 id 已自动修正`);
          }
        }
      }
    }

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
      const choice = b.validate(where, normalizeChoiceProposal(item), ChoiceProposalSchema);
      if (!choice) continue;
      choices.push(verifySource(choice, chrome, traits, b.notes));
    }

    // 代码校验第一步：白名单和逐条格式
    const proposals: Proposal[] = [];
    for (const [i] of eventPlan.changes.entries()) {
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
    for (const [i, item] of eventPlan.messages.entries()) {
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
      const normalized = normalizeChangeIds({ type: "phone.receive", ...message }, idLookup);
      for (const note of normalized.notes) noteOnce(b.notes, note);
      proposals.push({
        where,
        kind: "message",
        value: normalized.value as Record<string, unknown>,
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
    // 只有实际增加分钟的活动拥有时间；纯暂停/恢复仍可保留现场交谈的世界时间。
    const bdState = BraindanceStateSchema.parse(world.slices.braindance);
    const parsedActivities = verified.map((proposal) => ({
      command: proposal.parse(proposal.value),
      event: owner.get(proposal.where),
    }));
    const timedActivityEvents = new Set(
      parsedActivities.flatMap(({ command: cmd, event: id }) => {
        let ownsTime = false;
        if (cmd?.type === "braindance") {
          ownsTime = ["progress", "scan"].includes(String(cmd.action));
          if (cmd.action === "stop" && cmd.outcome === "finished") {
            const play = parsedActivities.find(
              (p) =>
                p.event === id && p.command?.type === "braindance" && p.command.action === "play",
            )?.command;
            const previous =
              typeof play?.from === "string"
                ? bdState.history.find((h) => h.id === play.from)
                : undefined;
            const workId = typeof play?.work === "string" ? play.work : bdState.active?.work;
            const work = workId ? braindanceWork(bdState, deps.data ?? {}, workId) : undefined;
            ownsTime =
              !!work &&
              work.durationMinutes >
                (play ? (previous?.watchedMinutes ?? 0) : (bdState.active?.watchedMinutes ?? 0));
          }
        } else if (cmd?.type === "commerce.service") {
          ownsTime = false;
        }
        return id && ownsTime ? [id] : [];
      }),
    );
    const deferredWorldClocks = new Map<string, Command[]>();
    for (const proposal of verified) {
      let command = proposal.parse(proposal.value);
      if (!command) continue;
      if (command.type === "world" && timedActivityEvents.has(owner.get(proposal.where) ?? "")) {
        const { time, phases, ...withoutElapsed } = command;
        if (time !== undefined || phases !== undefined) {
          // world.time 是回合结束的绝对时刻：在本事件活动之后核对，保留真实聊天等余下时间。
          // 相对 phases 不能再次叠加同一段体验；其他活动应由独立事件的绝对时间承接。
          const id = owner.get(proposal.where) as string;
          if (typeof time === "number") {
            const clocks = deferredWorldClocks.get(id) ?? [];
            clocks.push({ type: "world", activity: command.activity, time });
            deferredWorldClocks.set(id, clocks);
          }
          b.notes.push("体验分钟先按实际活动结算，再核对同事件的世界结束时刻，不重复叠加");
          const remainingKeys = Object.keys(withoutElapsed).filter(
            (key) => key !== "type" && key !== "activity",
          );
          if (remainingKeys.length === 0) {
            redundant.add(proposal.where);
            continue;
          }
          command = withoutElapsed;
        }
      }
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
      // 对玩家造成伤害的快速破解由 npcHack 依据独立裁决统一结算；不允许重复记 damage / combat wound
      if (
        harmfulHackEvents.has(owner.get(where) ?? "") &&
        (command.type === "damage" || (command.type === "combat" && command.action === "wound"))
      ) {
        noteOnce(
          b.notes,
          "本次快速破解由 npcHack 统一结算，重复的 damage / combat wound 已合并忽略",
        );
        redundant.add(where);
        continue;
      }
      // 战斗里挨打走 combat wound，伤口要记下谁、用什么、打在哪；同事件已有 wound 时重复 damage 静默合并
      if (combatEvents.has(owner.get(where) ?? "") && command.type === "damage") {
        if (woundEvents.has(owner.get(where) ?? "")) {
          noteOnce(b.notes, "战斗中挨打已由 combat wound 记账，重复的 damage 已合并忽略");
          redundant.add(where);
        } else {
          b.drop(where, command, "战斗中挨打发 combat wound（by、weapon、part、tier）", "rules");
        }
        continue;
      }
      addCommand(proposal, command);
    }
    b.checkAborted();

    // 时间由抽取按正文写在 world 里；没写就是时间没动，代码不补保底
    if (settle && shape.sceneEnd === true && inFlashback)
      b.notes.push("闪回里不收场，回到现在后再写 sceneEnd");

    const facts: Record<string, unknown> = {
      tradeNarrative: narrative,
      braindanceInput: plan.kind === "action" ? plan.input.text : "",
      braindanceTurn: records.length,
    };
    facts.actionStartLocation = WorldClockStateSchema.parse(world.slices.world).location;
    facts.ruling = rulingFactFrom(`turn.${records.length}`, rulingSpec);
    if (counterHackSpec) {
      facts.npcHackRuling = rulingFactFrom(`turn.${records.length}.npcHack`, {
        kind: counterHackSpec.harm === "none" ? "possible" : "costly",
        harm: counterHackSpec.harm,
        reason: counterHackSpec.reason,
      });
    }
    // 断肢打在义肢上改记为义体损坏：坏着的也要放进来，不然会当成血肉再断一次
    const limbChrome = Object.fromEntries(
      installedChrome
        .filter((c) => c.slot === "arms" || c.slot === "legs")
        .map((c) => [c.slot, { id: c.id, name: parts.get(c.id)?.name ?? c.id }]),
    );
    if (Object.keys(limbChrome).length > 0) facts.chrome = limbChrome;
    // 躲在自己的安全屋：heat 不能读安全屋（safehouse→travel→heat 会成环），这一轮没出门才算
    const here = (world.slices.world as { location?: unknown } | undefined)?.location;
    const homes = (world.slices.safehouse as { homes?: { location?: unknown }[] } | undefined)
      ?.homes;
    const leaves = commands.some(
      (c) => c.type === "world" && c.location !== undefined && c.location !== here,
    );
    if (!trip && !leaves && here !== undefined && (homes ?? []).some((h) => h.location === here)) {
      facts.hideout = true;
    }
    const setup: SettlementEvent[] = [];
    const prependSetup = (id: string, command: Command): void => {
      setup.unshift({ id, requires: [], commands: [command] });
    };
    // 开了斯安威斯坦（前端开关、选项或判断阶段识别）：先扣人性再结算
    if (sandevistanBoosted) {
      const boost = working.map((c) => parts.get(c.id)).find((d) => d?.accelerator === true);
      if (boost) prependSetup("$boost", { type: "cyberware.boost", id: boost.id });
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
        eventCommands.push(...(deferredWorldClocks.get(event.id) ?? []));
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
    // 旁枝记录类指令（人物记忆/情报/近况/笔记等）失败只拦截自身，不连坐卡死整场收尾
    const SCENE_END_NON_BLOCKING_TYPES = new Set([
      "learn",
      "memory",
      "doing",
      "relation",
      "tie",
      "ledger",
      "ledgerSettle",
      "npcOutfit",
      "npcScan",
      "threadTold",
      "note",
      "chronicle",
    ]);
    const blockingEventIds = new Set<string>(setup.map((e) => e.id));
    for (const [idx, planEvent] of eventPlan.events.entries()) {
      const settledEvent = events[setup.length + idx];
      if (!settledEvent) continue;
      const dependsOnAction = settledEvent.requires.includes("$action");
      const hasBlockingCommand = settledEvent.commands.some(
        (c) => !SCENE_END_NON_BLOCKING_TYPES.has(c.type),
      );
      const hasBlockingRaw = planEvent.entries.some((entry) => {
        if (entry.startsWith("messages[")) return true;
        const t = rawChangeTypes.get(entry);
        return t === undefined || !SCENE_END_NON_BLOCKING_TYPES.has(t);
      });
      if (dependsOnAction || hasBlockingCommand || (settledEvent.invalid && hasBlockingRaw)) {
        blockingEventIds.add(settledEvent.id);
      }
    }
    // 收场不能绕过抵达、付款、主行动或核心状态推进，但不被旁枝记忆/情报条目失败连坐阻断。
    if (settle && shape.sceneEnd === true && !inFlashback) {
      blockingEventIds.add("$scene-end");
      events.push({
        id: "$scene-end",
        requires: events.filter((event) => blockingEventIds.has(event.id)).map((event) => event.id),
        commands: [{ type: "world.endScene" }],
      });
    }
    const applied = applyEventCommands(
      world,
      events,
      applyCtx,
      preparedPurchases,
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
    const anyFailedEvent = applied.events.find((event) => event.status !== "applied");
    if (anyFailedEvent && accepted.length === 0 && applied.patches.length === 0) {
      throw new NarratorStageError(
        "extract",
        `④ 本轮事件未能结算：${anyFailedEvent.reason}（已保存判断与正文，点重试将直接继续记账）`,
        true,
        "narrated",
      );
    }
    const failedEvent = applied.events.find(
      (event) => event.status !== "applied" && blockingEventIds.has(event.id),
    );
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
    const beforeWorld = WorldClockStateSchema.parse(world.slices.world);
    const afterWorld = WorldClockStateSchema.parse(settled.world.slices.world);
    const computedTitle = sceneTitle(
      afterWorld.scene === beforeWorld.scene ? settled.world : world,
      deps.data ?? {},
    );
    const computedUnsettled = settle
      ? failedEvent
        ? `事件 ${failedEvent.id} 未生效：${failedEvent.reason}；独立事件已保留，可按账目改写正文`
        : unsettledReason(b.dropped)
      : undefined;
    const settledPatches: Patch[] = ooc
      ? [...applied.patches]
      : [...applied.patches, ...(settled === applied ? [] : settled.patches)];

    extractedData = {
      shape,
      choices,
      accepted,
      considered,
      settledWorld: settled.world,
      settledPatches,
      facts,
      title: computedTitle,
      unsettled: computedUnsettled,
      auxUsage: b.auxUsage,
      repairs: b.repairs,
      repairUsage: b.repairUsage,
      notes: [...b.notes],
      dropped: [...b.dropped],
    };
    await saveCheckpoint("extracted", preparedData, narratedData, extractedData);
  }

  const {
    shape,
    choices,
    accepted,
    settledWorld,
    settledPatches,
    facts: savedFacts,
    title,
    unsettled,
  } = extractedData;
  const considered = [...extractedData.considered];
  const applyCtx = {
    rng: deps.rng,
    facts: { ...savedFacts },
    ...(deps.data ? { data: deps.data } : {}),
  };
  const before = WorldClockStateSchema.parse(world.slices.world);
  const after = WorldClockStateSchema.parse(settledWorld.slices.world);

  // ⑥+⑦ 收尾辅调预准备：场外演化（宏观 + 社交）与回退场景摘要均只读取结算态，可单次 Promise.all 并行请求再按固定顺序落盘
  const dead = HealthStateSchema.parse(settledWorld.slices.health).condition === "dead";
  let currentWorld = settledWorld;
  const offscreenPatches: Patch[] = [];
  let offscreenTrace: { prompt: string; reply: string } | undefined;
  let offscreenCapacityReason: string | undefined;
  const every = deps.offscreen === undefined ? OFFSCREEN_SCENES : deps.offscreen;
  const offscreenEligible =
    settle && !inFlashback && !dead && unsettled === undefined && every !== null;
  const dueOpts = { every: every ?? OFFSCREEN_SCENES, records, accepted };
  const macroDue =
    offscreenEligible && trackOffscreenDue(world, settledWorld, { track: "macro", ...dueOpts });
  const socialDue =
    offscreenEligible && trackOffscreenDue(world, settledWorld, { track: "social", ...dueOpts });

  // 先在内存预览本轮场景记忆与抽取摘要是否合格，确定是否需要回退发起 ⑦ 整理场景摘要
  const workingMemory =
    settle && !inFlashback && unsettled === undefined
      ? readSceneMemory(shape.sceneMemory, world, settledWorld, plan.input, narrative)
      : undefined;
  const memoryPreviewWorld = workingMemory?.command
    ? registry.applyCommands(settledWorld, [workingMemory.command], applyCtx).world
    : settledWorld;
  let summarySkipNote: string | undefined;
  let mergedSummary: ReturnType<typeof summaryFromExtract> | undefined;
  let fallbackSummaryMessages: LlmMessage[] | undefined;
  if (settle && after.scene !== before.scene) {
    if (inFlashback) summarySkipNote = "场景摘要：闪回里不写";
    else if (unsettled !== undefined) summarySkipNote = "场景摘要：这一轮没结算干净，不写";
    else {
      mergedSummary = summaryFromExtract(
        shape.summary,
        memoryPreviewWorld,
        before.scene,
        before.location,
        {
          input: plan.input,
          narrative,
        },
      );
      if (!mergedSummary.command) {
        fallbackSummaryMessages = buildSummaryPrompt(
          world,
          memoryPreviewWorld,
          records,
          plan.input,
          narrative,
          extras,
        );
      }
    }
  }

  const present = macroDue || socialDue ? presentNpcs(world, settledWorld) : new Set<string>();
  let macroBatch: ReturnType<typeof prepareMacroOffscreenBatch> | undefined;
  let socialBatch: ReturnType<typeof prepareSocialOffscreenBatch> | undefined;

  if (macroDue || socialDue) {
    const capacity = {
      contextWindow: deps.auxContextWindow ?? 32_000,
      ...(deps.auxMaxOutputTokens === undefined
        ? {}
        : { maxOutputTokens: deps.auxMaxOutputTokens }),
    };
    macroBatch = macroDue
      ? prepareMacroOffscreenBatch(settledWorld, records, extras, narrative, capacity)
      : undefined;
    socialBatch = socialDue
      ? prepareSocialOffscreenBatch(settledWorld, records, extras, narrative, present, capacity)
      : undefined;
    const blockedReasons: string[] = [];
    const blockedTracks: ("macro" | "social")[] = [];
    if (macroBatch?.kind === "blocked") {
      blockedReasons.push(macroBatch.reason);
      blockedTracks.push("macro");
      considered.push(macroBatch.reason);
    }
    if (socialBatch?.kind === "blocked") {
      blockedReasons.push(socialBatch.reason);
      blockedTracks.push("social");
      considered.push(socialBatch.reason);
    }
    if (blockedTracks.length > 0) {
      const blockedRetrySeq = nextRetrySeq(records);
      const backoff = registry.applyCommands(
        currentWorld,
        blockedTracks.map((track) => ({
          type: "city.failed" as const,
          track,
          retrySeq: blockedRetrySeq,
        })),
        applyCtx,
      );
      currentWorld = backoff.world;
      offscreenPatches.push(...backoff.patches);
    }
    if (
      blockedReasons.length > 0 &&
      macroBatch?.kind !== "ready" &&
      socialBatch?.kind !== "ready"
    ) {
      offscreenCapacityReason = blockedReasons.join("；");
    }
  }

  const macroReady = macroBatch?.kind === "ready";
  const socialReady = socialBatch?.kind === "ready";
  const summaryReady = fallbackSummaryMessages !== undefined;
  let summaryReply: Reply | { failed: true } | undefined;

  if (macroReady || socialReady || summaryReady) {
    if ((macroReady || socialReady) && summaryReady) {
      deps.onStage?.({
        stage: "offscreen",
        label: "⑥ 场外世界推演与摘要",
        detail: "并行推演场外局势、人物动向与本场记忆摘要",
      });
    } else if (macroReady || socialReady) {
      deps.onStage?.({
        stage: "offscreen",
        label: "⑥ 场外世界推演",
        detail:
          macroReady && socialReady
            ? "并行推演宏观局势与人物动向"
            : macroReady
              ? "推演城中局势、新闻与商家经营"
              : "推演人物近况、关系与私信",
      });
    } else {
      deps.onStage?.({
        stage: "summary",
        label: "⑦ 整理场景摘要",
        detail: "归档本场记忆与锚点",
      });
    }

    const [macroReply, socialReply, resolvedSummaryReply] = await Promise.all([
      macroBatch?.kind === "ready"
        ? b.supplement({
            purpose: "aux",
            temperature: OFFSCREEN_TEMPERATURE,
            maxOutputTokens: macroBatch.maxOutputTokens,
            messages: macroBatch.messages,
            responseFormat: responseJsonSchema("offscreen_macro", MacroOffscreenDocSchema),
            ...(deps.saveId ? { cacheKey: `cp:${deps.saveId}:offscreen-macro` } : {}),
          })
        : Promise.resolve(undefined),
      socialBatch?.kind === "ready"
        ? b.supplement({
            purpose: "aux",
            temperature: OFFSCREEN_TEMPERATURE,
            maxOutputTokens: socialBatch.maxOutputTokens,
            messages: socialBatch.messages,
            responseFormat: responseJsonSchema("offscreen_social", SocialOffscreenDocSchema),
            ...(deps.saveId ? { cacheKey: `cp:${deps.saveId}:offscreen-social` } : {}),
          })
        : Promise.resolve(undefined),
      fallbackSummaryMessages !== undefined
        ? b.supplement({
            purpose: "aux",
            temperature: SUMMARY_TEMPERATURE,
            messages: fallbackSummaryMessages,
            responseFormat: responseJsonSchema("summary", SummaryDocSchema),
            ...(deps.saveId ? { cacheKey: `cp:${deps.saveId}:summary` } : {}),
          })
        : Promise.resolve(undefined),
    ]);
    summaryReply = resolvedSummaryReply;

    if (macroReady || socialReady) {
      const tracePrompts: string[] = [];
      const traceReplies: string[] = [];
      const formatReplyText = (reply: Reply | { failed: true }) =>
        "failed" in reply
          ? "（辅助请求失败，未采用不完整回复）"
          : "blocked" in reply
            ? `（拒答：${reply.blocked}）`
            : reply.text;

      const recordOffscreenResults = (results: readonly AppliedCommand[]) => {
        for (const { command, result } of results) {
          if (!result.ok) {
            considered.push(`场外推演：${command.type} 未生效（已跳过）：${result.reason}`);
            continue;
          }
          if (command.type === "phone.receive" || command.type === "character.deed") {
            b.notes.push(...result.notes);
          } else {
            const c = command as {
              type: string;
              id?: string;
              title?: string;
              text?: string;
              cause?: string;
            };
            if (c.type === "city.event") considered.push(`场外推演：动静 ${c.id}「${c.title}」`);
            else if (c.type === "npc.offscreenDoing")
              considered.push(`场外推演：${c.id} 最近 ${c.text}`);
            else if (c.type === "city.rumor") considered.push(`场外推演：传闻「${c.text}」`);
            else if (c.type === "city.bulletin") considered.push(`场外推演：快讯「${c.title}」`);
            else if (c.type === "npc.past") considered.push(`场外推演：${c.id} 的经历压成摘要`);
            else if (c.type === "threadTold") considered.push(`场外推演：快讯播了局势 ${c.id}`);
            else if (c.type === "jobOffer")
              considered.push(`场外推演：新委托 ${c.id}「${c.title}」`);
            else if (c.type.startsWith("thread.") && c.id)
              considered.push(`场外推演：局势 ${c.id}（${c.type}）${c.text ?? ""}`);
            considered.push(...result.notes.map((n) => `场外推演：${n}`));
          }
        }
      };

      const retrySeq = nextRetrySeq(records);

      // 提交 Track A：宏观局势（逐条容错，仅 L0 硬失败才记 macro 退避）
      if (macroBatch?.kind === "ready" && macroReply !== undefined) {
        tracePrompts.push(
          `【通道 A：宏观局势推演】\n${macroBatch.messages[macroBatch.messages.length - 1]?.content ?? ""}`,
        );
        traceReplies.push(`【通道 A：宏观局势推演】\n${formatReplyText(macroReply)}`);
        let macroCommands: Command[] | undefined;
        if ("failed" in macroReply) {
          considered.push("宏观局势推演请求失败，保留待处理事项");
        } else if ("blocked" in macroReply) {
          considered.push(`宏观局势推演被辅助模型拒答：${macroReply.blocked}`);
        } else {
          b.auxUsage = addUsage(b.auxUsage, macroReply.usage);
          let parsed = readMacroOffscreen(macroReply.text, currentWorld, {
            data: extras.data ?? {},
          });
          if (!parsed.ok && parsed.fatal) {
            const fixed = await b.repair(
              "offscreen-macro",
              `下面的宏观世界推演结果解析失败（${parsed.fatal}）。修成一个包含 situations 数组的 JSON 对象，不补充原文没有的事实。`,
              macroReply.text,
            );
            if (fixed !== undefined) {
              const second = readMacroOffscreen(JSON.stringify(fixed), currentWorld, {
                data: extras.data ?? {},
              });
              if (second.ok) {
                parsed = second;
                considered.push("宏观局势推演格式已自动修复");
              }
            }
          }
          considered.push(...parsed.notes);
          if (parsed.ok) macroCommands = parsed.commands;
        }
        if (macroCommands !== undefined) {
          const appliedMacro = registry.applyCommands(
            currentWorld,
            [
              ...macroCommands,
              ...(macroBatch.backlog ? [] : [{ type: "thread.remind" }]),
              {
                type: "city.ran",
                track: "macro",
                through: macroBatch.through,
                backlog: macroBatch.backlog,
              },
            ],
            applyCtx,
          );
          currentWorld = appliedMacro.world;
          offscreenPatches.push(...appliedMacro.patches);
          recordOffscreenResults(appliedMacro.results);
          if (macroBatch.backlog) {
            considered.push(`宏观局势推演已处理至回合 ${macroBatch.through}，剩余积压保留到下一批`);
          }
        } else {
          const failedMacro = registry.applyCommands(
            currentWorld,
            [{ type: "city.failed", track: "macro", retrySeq }],
            applyCtx,
          );
          currentWorld = failedMacro.world;
          offscreenPatches.push(...failedMacro.patches);
          considered.push("宏观局势推演未完成，已进入独立重试间隔");
        }
      }

      // 提交 Track B：人物生活与社交（逐条容错，仅 L0 硬失败才记 social 退避）
      if (socialBatch?.kind === "ready" && socialReply !== undefined) {
        tracePrompts.push(
          `【通道 B：人物社交推演】\n${socialBatch.messages[socialBatch.messages.length - 1]?.content ?? ""}`,
        );
        traceReplies.push(`【通道 B：人物社交推演】\n${formatReplyText(socialReply)}`);
        let socialCommands: Command[] | undefined;
        const sent = accepted.filter((c) => c.type === "phone.receive").length;
        if ("failed" in socialReply) {
          considered.push("人物社交推演请求失败，保留待处理事项");
        } else if ("blocked" in socialReply) {
          considered.push(`人物社交推演被辅助模型拒答：${socialReply.blocked}`);
        } else {
          b.auxUsage = addUsage(b.auxUsage, socialReply.usage);
          let parsed = readSocialOffscreen(socialReply.text, currentWorld, {
            present,
            messages: MESSAGES_PER_TURN - sent,
            data: extras.data ?? {},
          });
          if (!parsed.ok && parsed.fatal) {
            const fixed = await b.repair(
              "offscreen-social",
              `下面的人物社交推演结果解析失败（${parsed.fatal}）。修成一个包含 npcs 与 messages 数组的 JSON 对象，不补充原文没有的事实。`,
              socialReply.text,
            );
            if (fixed !== undefined) {
              const second = readSocialOffscreen(JSON.stringify(fixed), currentWorld, {
                present,
                messages: MESSAGES_PER_TURN - sent,
                data: extras.data ?? {},
              });
              if (second.ok) {
                parsed = second;
                considered.push("人物社交推演格式已自动修复");
              }
            }
          }
          considered.push(...parsed.notes);
          if (parsed.ok) socialCommands = parsed.commands;
        }
        if (socialCommands !== undefined) {
          const appliedSocial = registry.applyCommands(
            currentWorld,
            [
              ...socialCommands,
              {
                type: "city.ran",
                track: "social",
                through: socialBatch.through,
                backlog: socialBatch.backlog,
              },
            ],
            applyCtx,
          );
          currentWorld = appliedSocial.world;
          offscreenPatches.push(...appliedSocial.patches);
          recordOffscreenResults(appliedSocial.results);
          if (socialBatch.backlog) {
            considered.push(
              `人物社交推演已处理至回合 ${socialBatch.through}，剩余积压保留到下一批`,
            );
          }
        } else {
          const failedSocial = registry.applyCommands(
            currentWorld,
            [{ type: "city.failed", track: "social", retrySeq }],
            applyCtx,
          );
          currentWorld = failedSocial.world;
          offscreenPatches.push(...failedSocial.patches);
          considered.push("人物社交推演未完成，已进入独立重试间隔");
        }
      }

      if (tracePrompts.length > 0) {
        offscreenTrace = {
          prompt: tracePrompts.join("\n\n---\n\n"),
          reply: traceReplies.join("\n\n---\n\n"),
        };
      }
    }
  }
  const cityAfter = CityStateSchema.parse(currentWorld.slices.city ?? {});
  const retrying = cityAfter.macro.retryAt !== null || cityAfter.social.retryAt !== null;
  const offscreenSkip =
    offscreenCapacityReason ??
    (offscreenTrace === undefined
      ? offscreenSkipReason({
          closed: after.scene !== before.scene,
          flashback: inFlashback,
          unsettled: unsettled !== undefined,
          dead,
          every,
          retrying,
        })
      : undefined);

  // ⑦ 记忆跟随真正结算的正文保存；承诺/计划是增量锚点，不因滚动提要重写而消失。
  let ended = currentWorld;
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
  if (workingMemory !== undefined) {
    considered.push(...workingMemory.notes);
    if (workingMemory.command) saveMemory(workingMemory.command);
  }
  // 正常收场复用抽取中的摘要；不合格时已与场外演化并行完成恢复整理，按确定性顺序落盘。
  if (summarySkipNote !== undefined) {
    considered.push(summarySkipNote);
  } else if (mergedSummary !== undefined) {
    considered.push(...mergedSummary.notes);
    if (mergedSummary.command) {
      saveMemory(mergedSummary.command);
    } else if (fallbackSummaryMessages !== undefined && summaryReply !== undefined) {
      summaryTrace = {
        prompt: fallbackSummaryMessages[fallbackSummaryMessages.length - 1]?.content ?? "",
        reply:
          "failed" in summaryReply
            ? "（辅助请求失败，未采用不完整回复）"
            : "blocked" in summaryReply
              ? `（拒答：${summaryReply.blocked}）`
              : summaryReply.text,
      };
      if ("failed" in summaryReply) {
        considered.push("场景摘要请求失败，保留完整场景提要与记忆锚点");
      } else if ("blocked" in summaryReply) {
        considered.push(`场景摘要被辅助模型拒答：${summaryReply.blocked}`);
      } else {
        b.auxUsage = addUsage(b.auxUsage, summaryReply.usage);
        const got = readSummary(summaryReply.text, ended, before.scene, before.location, {
          input: plan.input,
          narrative,
        });
        considered.push(...got.notes);
        if (got.command) saveMemory(got.command);
      }
    }
  }
  return {
    kind: "done",
    turn: {
      text: narrative,
      ...(thought !== undefined ? { thought } : {}),
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
        ? [...settledPatches]
        : [...settledPatches, ...offscreenPatches, ...memoryPatches],
      modules: promptModules,
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
