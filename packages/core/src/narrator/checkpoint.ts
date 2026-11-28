import type { Patch } from "immer";
import type { LlmMessage, LlmUsage } from "../kernel/ports";
import type { Command } from "../kernel/system";
import type { WorldState } from "../kernel/world";
import type { TurnInput, TurnStage } from "../schemas/turn";
import type { PlannedTrip } from "../systems/travel";
import type { Choice, ExtractShape } from "./block";
import type { BudgetTrace } from "./budget";
import type { LoreTrace } from "./lore";
import type { PreparedPurchase } from "./merchant-settlement";
import type { PresetRegex } from "./preset";
import type { Expansion } from "./retrieve";
import type { BigSpend, CounterHackRuling, JudgeRuling, Memory } from "./stages";

export type TurnCheckpointStage = "prepared" | "narrated" | "extracted";

export interface TurnDroppedEntry {
  /** 出问题的位置，例如 changes[2]、ruling、choices[1]、抽取 */
  readonly where: string;
  readonly raw: unknown;
  readonly reason: string;
  /** format：格式不合格且有限修复未能解决；verify：历史字段；rules：业务校验没通过 */
  readonly stage: "format" | "verify" | "rules";
}

export interface PreparedCheckpointData {
  readonly liveInput: TurnInput;
  readonly ooc: boolean;
  readonly read: string | undefined;
  readonly rulingSpec: JudgeRuling | undefined;
  readonly counterHackSpec: CounterHackRuling | undefined;
  readonly ruling: string | undefined;
  readonly sandevistanBoosted: boolean;
  readonly activeBoost: { readonly id: string; readonly name: string } | undefined;
  readonly recalled: readonly Memory[];
  readonly expanded: readonly Memory[];
  readonly retrieval: Expansion | undefined;
  readonly trip: PlannedTrip | undefined;
  readonly purchases: readonly PreparedPurchase[];
  readonly confirmation: BigSpend | undefined;
  readonly spend: BigSpend | undefined;
  readonly decided: readonly string[];
  readonly extractDecided?: readonly string[] | undefined;
  readonly newNpcLikely?: boolean | undefined;
  readonly loreTrace: LoreTrace | undefined;
  readonly loreSection: string | undefined;
  readonly budgetTrace: BudgetTrace;
  readonly promptModules: readonly string[];
  readonly narrateMessages: readonly LlmMessage[];
  readonly maxOutputTokens: number;
  readonly sampling: {
    readonly temperature?: number;
    readonly topP?: number;
    readonly topK?: number;
  };
  readonly presetName: string | undefined;
  /** 与已保存提示词配套的正文后处理；切换预设不能改变尚未完成的旧尝试。 */
  readonly narrationPreset: {
    readonly regex: readonly PresetRegex[];
    readonly maxOutputTokens?: number | undefined;
  } | null;
  readonly auxUsage: LlmUsage;
  readonly repairs: number;
  readonly repairUsage: LlmUsage;
  readonly notes: readonly string[];
  readonly dropped: readonly TurnDroppedEntry[];
  readonly flags: readonly string[];
}

export interface NarratedCheckpointData {
  readonly narrative: string;
  readonly thought?: string | undefined;
  readonly usage: LlmUsage | undefined;
  readonly notes: readonly string[];
  readonly dropped: readonly TurnDroppedEntry[];
}

export interface ExtractedCheckpointData {
  readonly shape: ExtractShape;
  readonly choices: readonly Choice[];
  readonly accepted: readonly Command[];
  readonly considered: readonly string[];
  readonly settledWorld: WorldState;
  readonly settledPatches: readonly Patch[];
  readonly facts: Readonly<Record<string, unknown>>;
  readonly title: string | undefined;
  readonly unsettled: string | undefined;
  readonly auxUsage: LlmUsage;
  readonly repairs: number;
  readonly repairUsage: LlmUsage;
  readonly notes: readonly string[];
  readonly dropped: readonly TurnDroppedEntry[];
}

/** 回合阶段断点：每走完一次关键大模型调用即落盘，后续报错时从断点继续而不必重头再跑 */
export interface TurnCheckpoint {
  readonly saveId: string;
  readonly baseVersion: number;
  readonly input: TurnInput;
  readonly inputKey: string;
  readonly stage: TurnCheckpointStage;
  readonly updatedAt: string;
  readonly prepared: PreparedCheckpointData;
  readonly narrated?: NarratedCheckpointData | undefined;
  readonly extracted?: ExtractedCheckpointData | undefined;
}

/** 返回给前端状态投影的轻量断点摘要（不含提示词全文或整份世界快照） */
export interface TurnCheckpointSummary {
  readonly baseVersion: number;
  readonly stage: TurnCheckpointStage;
  readonly completedLabels: readonly string[];
  readonly input: TurnInput;
  readonly narrativePreview?: string | undefined;
  readonly thoughtPreview?: string | undefined;
  readonly updatedAt: string;
}

export const TURN_CHECKPOINT_LABELS: Readonly<Record<TurnCheckpointStage, readonly string[]>> = {
  prepared: ["① 意图判断与因果裁决"],
  narrated: ["① 意图判断与因果裁决", "③ 正文生成"],
  extracted: ["① 意图判断与因果裁决", "③ 正文生成", "④ 抽取状态与记账"],
};

export function checkpointSummaryOf(cp: TurnCheckpoint): TurnCheckpointSummary {
  const preview = cp.narrated?.narrative;
  const thoughtPreview = cp.narrated?.thought;
  return {
    baseVersion: cp.baseVersion,
    stage: cp.stage,
    completedLabels: TURN_CHECKPOINT_LABELS[cp.stage],
    input: cp.input,
    ...(preview !== undefined ? { narrativePreview: preview } : {}),
    ...(thoughtPreview !== undefined ? { thoughtPreview } : {}),
    updatedAt: cp.updatedAt,
  };
}

/** 计算与花费确认解耦的输入键，确保确认大额花费或重试时命中同一断点 */
export function turnInputKey(input: TurnInput): string {
  const { spendOk: _spendOk, ...rest } = input;
  return JSON.stringify(rest);
}

/** 在已保存阶段断点之后发生的失败：携带阶段标识与已完成步骤，供服务端提示玩家断点续跑 */
export class NarratorStageError extends Error {
  override name = "NarratorStageError";
  constructor(
    readonly stage: Extract<TurnStage, "narrate" | "extract">,
    message: string,
    readonly retryable: boolean,
    readonly savedStage: TurnCheckpointStage,
  ) {
    super(message);
  }
}
