import type { z } from "zod";
import { issueText } from "./block";
import { schemaDoc } from "./doc";
import { estimateTokens } from "./prompts/layers";

export type RepairStage =
  | "judge"
  | "extract"
  | "extract-rules"
  | "offscreen-macro"
  | "offscreen-social";
export const REPAIR_INPUT_TOKENS = 8_000;
export const REPAIR_OUTPUT_TOKENS = 2_048;

/** 每阶段最多一次修复，包括顶层 JSON 修复。 */
export class RepairBudget {
  private readonly used = new Set<RepairStage>();

  claim(stage: RepairStage, input: string): string | undefined {
    if (this.used.has(stage)) return "本阶段的修复额度已用完";
    if (estimateTokens(input) > REPAIR_INPUT_TOKENS) return "修复内容超出输入预算";
    this.used.add(stage);
    return undefined;
  }
}

export interface ValidationEntry {
  readonly key: string;
  readonly raw: unknown;
  readonly schema: z.ZodType;
  /** 关键账目优先，避免可选内容先耗尽修复上下文。 */
  readonly priority?: number;
}

export interface ValidationFailure {
  readonly entry: ValidationEntry;
  readonly reason: string;
}

const BATCH_TASK = `下面是同一阶段中格式不合法的条目。只修字段格式，不改原意、不补充事实；文本字段超出字数上限时，保留原意精简到上限以内。
只返回 {"fixes":[{"key":"原样的条目键","value":修好的条目}]}。
只允许修列出的条目，每个 key 最多一次；修不了的省略。不得返回或改动其他条目。`;

/** 已合法的条目保持不变；全部错误只发一个批次，超额或修复失败继续保留错误供结算拦截。 */
export async function validateEntries(
  entries: readonly ValidationEntry[],
  repair: (task: string, raw: string) => Promise<unknown>,
): Promise<{
  readonly values: ReadonlyMap<string, unknown>;
  readonly failures: readonly ValidationFailure[];
  readonly repaired: readonly string[];
}> {
  const values = new Map<string, unknown>();
  const invalid: ValidationFailure[] = [];
  for (const entry of entries) {
    const result = entry.schema.safeParse(entry.raw);
    if (result.success) values.set(entry.key, result.data);
    else invalid.push({ entry, reason: issueText(result.error) });
  }
  const selected = new Map<string, ValidationEntry>();
  const batch: { key: string; raw: unknown; error: string; format: string }[] = [];
  for (const { entry, reason } of [...invalid].sort(
    (a, b) => (b.entry.priority ?? 0) - (a.entry.priority ?? 0),
  )) {
    const candidate = {
      key: entry.key,
      raw: entry.raw,
      error: reason,
      format: schemaDoc(entry.schema),
    };
    // 预留系统说明和任务外壳，实际发出前仍由 RepairBudget 检查完整内容。
    if (
      estimateTokens(`${BATCH_TASK}\n${JSON.stringify([...batch, candidate])}`) >
      REPAIR_INPUT_TOKENS - 300
    )
      continue;
    batch.push(candidate);
    selected.set(entry.key, entry);
  }
  const repaired: string[] = [];
  if (batch.length > 0) {
    const result = await repair(BATCH_TASK, JSON.stringify(batch));
    const fixes =
      typeof result === "object" && result !== null && "fixes" in result ? result.fixes : undefined;
    if (Array.isArray(fixes)) {
      // 重复 key 含糊不清，整项拒绝；模型不能改动未提交的合法条目。
      const keys = fixes.map((fix: unknown) =>
        typeof fix === "object" && fix !== null && "key" in fix ? fix.key : undefined,
      );
      for (const fix of fixes) {
        if (typeof fix !== "object" || fix === null || typeof fix.key !== "string") continue;
        const entry = selected.get(fix.key);
        if (!entry || keys.filter((key) => key === fix.key).length !== 1) continue;
        const parsed = entry.schema.safeParse(fix.value);
        if (parsed.success) {
          values.set(entry.key, parsed.data);
          repaired.push(entry.key);
        }
      }
    }
  }
  return {
    values,
    repaired,
    failures: invalid.filter(({ entry }) => !values.has(entry.key)),
  };
}
