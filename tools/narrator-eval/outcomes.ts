/** 这里只衡量叙事管线的结果，不代表 GameService 已提交存档。 */
export type EvalOutcome =
  | "complete"
  | "ooc"
  | "draft"
  | "unsettled"
  | "blocked"
  | "confirmSpend"
  | "error";

interface Usage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

interface OutcomeRun {
  readonly outcome: EvalOutcome;
  readonly ok: boolean;
  readonly ms: number;
  /** 仅包含实际回传的叙事、辅助和修复用量；不含评分模型。 */
  readonly generationUsage?: Usage;
}

export interface OutcomeSummary {
  readonly scope: "narrator-only-no-save-commit";
  readonly attempts: number;
  readonly outcomes: Readonly<Record<EvalOutcome, number>>;
  readonly completeOutputs: number;
  readonly completeSettlements: number;
  readonly verifiedCompleteOutputs: number;
  readonly verifiedCompleteSettlements: number;
  readonly latencyMs: { readonly p50: number | null; readonly p95: number | null };
  readonly knownGenerationUsage: Usage;
  readonly usageReportedRuns: number;
  readonly usageUnreportedRuns: number;
  /** 全部已知生成用量 / 验证通过的完整输出次数（含场外问答）；缺失用量不当成真实零成本。 */
  readonly knownTokensPerVerifiedCompleteOutput: Usage | null;
}

export function turnOutcome(turn: {
  readonly text: string;
  readonly draft?: boolean | undefined;
  readonly unsettled?: string | undefined;
  readonly ooc: boolean;
}): EvalOutcome {
  if (turn.draft) return "draft";
  if (turn.text.trim() === "") return "error";
  if (turn.unsettled !== undefined) return "unsettled";
  return turn.ooc ? "ooc" : "complete";
}

/** nearest-rank 分位数；样本为空时不报告伪造的 0ms。 */
function percentile(sorted: readonly number[], fraction: number): number | null {
  return sorted.length === 0 ? null : (sorted[Math.ceil(sorted.length * fraction) - 1] ?? null);
}

export function summarizeOutcomes(runs: readonly OutcomeRun[]): OutcomeSummary {
  const outcomes: Record<EvalOutcome, number> = {
    complete: 0,
    ooc: 0,
    draft: 0,
    unsettled: 0,
    blocked: 0,
    confirmSpend: 0,
    error: 0,
  };
  const knownGenerationUsage = { inputTokens: 0, outputTokens: 0 };
  let usageReportedRuns = 0;
  for (const run of runs) {
    outcomes[run.outcome] += 1;
    if (run.generationUsage !== undefined) {
      usageReportedRuns += 1;
      knownGenerationUsage.inputTokens += run.generationUsage.inputTokens;
      knownGenerationUsage.outputTokens += run.generationUsage.outputTokens;
    }
  }
  const completeOutputs = outcomes.complete + outcomes.ooc;
  const verifiedCompleteOutputs = runs.filter(
    (r) => r.ok && (r.outcome === "complete" || r.outcome === "ooc"),
  ).length;
  const verifiedCompleteSettlements = runs.filter((r) => r.ok && r.outcome === "complete").length;
  const sorted = runs.map((r) => r.ms).sort((a, b) => a - b);
  return {
    scope: "narrator-only-no-save-commit",
    attempts: runs.length,
    outcomes,
    completeOutputs,
    completeSettlements: outcomes.complete,
    verifiedCompleteOutputs,
    verifiedCompleteSettlements,
    latencyMs: { p50: percentile(sorted, 0.5), p95: percentile(sorted, 0.95) },
    knownGenerationUsage,
    usageReportedRuns,
    usageUnreportedRuns: runs.length - usageReportedRuns,
    knownTokensPerVerifiedCompleteOutput:
      verifiedCompleteOutputs === 0
        ? null
        : {
            inputTokens: knownGenerationUsage.inputTokens / verifiedCompleteOutputs,
            outputTokens: knownGenerationUsage.outputTokens / verifiedCompleteOutputs,
          },
  };
}
