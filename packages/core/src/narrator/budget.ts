import type { LlmRequest } from "../kernel/ports";
import { effectiveTurns, type LogRecord } from "../kernel/turnlog";
import { TurnInputSchema } from "../schemas/turn";
import { estimateTokens } from "./prompts/layers";
import type { Memory } from "./stages";

/**
 * 上下文预算（规格“记忆与上下文”）：按叙事模型方案的 contextWindow 给写正文那一步的各部分分额度，
 * 32K 和 128K 两档之间按窗口线性插值，32K 以下按比例缩，128K 以上按 128K 那档。
 * 含写作预设的最终请求超出时，从低优先级裁起：扩展层 → 【前情】 → 设定资料 → 原文（最少留 MIN_HISTORY 轮）。
 * 必需内容不截断；仍超出时在正文生成前停止本轮，避免发送已知超预算的请求。
 */

export type BudgetPart =
  | "rules"
  | "world"
  | "character"
  | "hot"
  | "expanded"
  | "recap"
  | "history"
  | "reply";

export const BUDGET_LABELS: Readonly<Record<BudgetPart, string>> = {
  rules: "规则层和表",
  world: "世界观（设定资料）",
  character: "角色卡和硬数据",
  hot: "热层的状态和在场人物卡",
  expanded: "扩展层（旧记忆）",
  recap: "【前情】",
  history: "最近几轮原文",
  reply: "留给回复",
};

/** 规格的表：32K 模型一列、128K 以上一列（token）；14 个常驻规则模块归入静态 system 层走 KV 缓存后，rules 对应调宽 */
const SMALL: Readonly<Record<BudgetPart, number>> = {
  rules: 10000,
  world: 2000,
  character: 1500,
  hot: 4000,
  expanded: 3000,
  recap: 2000,
  history: 10000,
  reply: 4000,
};
const LARGE: Readonly<Record<BudgetPart, number>> = {
  rules: 12000,
  world: 6000,
  character: 3000,
  hot: 12000,
  expanded: 10000,
  recap: 8000,
  history: 40000,
  reply: 16000,
};
const SMALL_WINDOW = 32_000;
const LARGE_WINDOW = 128_000;
/** 没拿到方案时按 32K 算 */
export const DEFAULT_WINDOW = SMALL_WINDOW;

/** 文本请求的保守估算，包括消息外壳和原生 JSON schema；不把图片 base64 当文本估算。 */
export function requestInputTokens(request: LlmRequest): number {
  const schema = request.responseFormat?.schema;
  return (
    256 +
    request.messages.reduce((sum, message) => sum + estimateTokens(message.content) + 8, 0) +
    (schema ? estimateTokens(JSON.stringify(schema)) : 0)
  );
}

export class NarratorContextError extends Error {
  override name = "NarratorContextError";
}

/** 必需材料放不下时明确停止，不能靠截断世界事实或正文来发送超窗请求。 */
export function assertRequestBudget(
  request: LlmRequest,
  window: number,
  output: number,
  label: string,
): void {
  const input = requestInputTokens(request);
  if (input + output > window) {
    throw new NarratorContextError(
      `${label}上下文不足：当前窗口 ${window} token，完整输入估算 ${input} token（含协议余量），输出预留 ${output} token，合计至少需要 ${input + output} token。未发送请求、未裁剪必需事实；请提高实际模型窗口配置，或在输入可容纳时调整输出上限后重试。`,
    );
  }
}

/** 原文至少带几轮（规格“最近 3 轮原文”），预算够时往前补，最多 HISTORY_TURNS 轮 */
export const MIN_HISTORY = 3;

export interface ContextBudget {
  readonly window: number;
  readonly parts: Readonly<Record<BudgetPart, number>>;
}

export function contextBudget(window: number = DEFAULT_WINDOW): ContextBudget {
  const w = Number.isFinite(window) && window > 0 ? window : DEFAULT_WINDOW;
  const parts = {} as Record<BudgetPart, number>;
  for (const key of Object.keys(SMALL) as BudgetPart[]) {
    const small = SMALL[key];
    const large = LARGE[key];
    const value =
      w <= SMALL_WINDOW
        ? (small * w) / SMALL_WINDOW
        : small + (large - small) * Math.min(1, (w - SMALL_WINDOW) / (LARGE_WINDOW - SMALL_WINDOW));
    parts[key] = Math.round(value);
  }
  return { window: w, parts };
}

/** 单轮回复（含思考/思维链 token）在当前上下文窗口下允许的最大预留上限，至少保留 75% 给输入。 */
export function replyTokenCap(budget: ContextBudget): number {
  return Math.max(budget.parts.reply, Math.min(65_536, Math.floor(budget.window * 0.25)));
}

function inputText(input: unknown): string {
  const parsed = TurnInputSchema.safeParse(input);
  return parsed.success ? parsed.data.text : "";
}

/** 一轮原文放进对话历史大约多少 token：玩家输入加正文 */
export function turnTokens(input: unknown, text: string): number {
  return estimateTokens(inputText(input)) + estimateTokens(text) + 8;
}

/** 对话历史分块滑窗默认步长：超过上限后按块推进起始轮次，让连续多轮共享完全一致的历史前缀以命中 KV 缓存 */
export const HISTORY_STRIDE = 4;

/** 大窗口（≥128K）采用更宽的滑窗步长与上限，拉高历史前缀缓存命中周期（75% → 83.3%）并保留更长原文记忆 */
export function historyStrideFor(window: number = DEFAULT_WINDOW): number {
  return window >= LARGE_WINDOW ? 6 : HISTORY_STRIDE;
}

export function historyMaxFor(window: number = DEFAULT_WINDOW, baseMax = 12): number {
  return window >= LARGE_WINDOW ? Math.max(baseMax, 16) : baseMax;
}

/** 写正文带最近几轮原文：至少 MIN_HISTORY 轮，再往前补到预算用完，最多 max 轮；超出后按步长分块滑窗以保前缀缓存 */
export function historyTurns(
  records: readonly LogRecord[],
  tokens: number,
  max: number,
  stride: number = HISTORY_STRIDE,
): number {
  const turns = effectiveTurns(records);
  let used = 0;
  let n = 0;
  for (let i = turns.length - 1; i >= 0 && n < max; i -= 1) {
    const t = turns[i];
    if (!t) break;
    const cost = turnTokens(t.input, t.text);
    if (n >= MIN_HISTORY && used + cost > tokens) break;
    used += cost;
    n += 1;
  }
  if (n < turns.length && n > MIN_HISTORY) {
    // 把窗口起点向上对齐到 stride 的整数倍，使连续最多 stride 轮拥有相同起始轮次与前缀
    const rawStart = turns.length - n;
    const alignedStart = Math.ceil(rawStart / stride) * stride;
    const alignedCount = turns.length - alignedStart;
    if (alignedCount >= MIN_HISTORY) return alignedCount;
  }
  return n;
}

/** 紧窗口预算裁剪时按步长推进历史起点，尽量保持相邻回合的历史前缀对齐（最低保底 MIN_HISTORY 轮） */
export function stepDownHistory(
  records: readonly LogRecord[],
  currentHot: number,
  stride: number = HISTORY_STRIDE,
): number {
  if (currentHot <= MIN_HISTORY) return MIN_HISTORY;
  const total = effectiveTurns(records).length;
  const currentStart = Math.max(0, total - currentHot);
  const nextAlignedStart = (Math.floor(currentStart / stride) + 1) * stride;
  const alignedCount = total - nextAlignedStart;
  if (alignedCount >= MIN_HISTORY && alignedCount < currentHot) return alignedCount;
  return Math.max(MIN_HISTORY, currentHot - 1);
}

/** 一条旧记忆在【调出的旧记忆】里大约多少 token */
export function memoryTokens(m: Memory): number {
  return estimateTokens(`${m.title}${m.text}`) + 6;
}

/** 扩展层按分数从高到低留，留到预算用完；判断调的另算，不在这里裁 */
export function fitMemories(
  memories: readonly Memory[],
  tokens: number,
): { readonly kept: Memory[]; readonly dropped: number } {
  const kept: Memory[] = [];
  let used = 0;
  for (const m of memories) {
    const cost = memoryTokens(m);
    if (used + cost > tokens) continue;
    used += cost;
    kept.push(m);
  }
  return { kept, dropped: memories.length - kept.length };
}

/** 上下文查看器里看的：窗口、各部分占用和额度、原文带了几轮、裁了什么 */
export interface BudgetTrace {
  readonly window: number;
  /** 写正文带了几轮原文 */
  readonly history: number;
  /** 【前情】的额度；裁过时比默认小，重建时照它截 */
  readonly recapTokens: number;
  readonly parts: readonly {
    readonly part: string;
    readonly label: string;
    readonly tokens: number;
    readonly limit: number | null;
  }[];
  readonly total: number;
  /** 窗口减去留给回复的部分 */
  readonly limit: number;
  readonly cuts: readonly string[];
}
