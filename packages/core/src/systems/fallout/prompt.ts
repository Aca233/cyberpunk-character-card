import { ConsequenceTableSchema, FALLOUT_KINDS, FALLOUT_LABELS, type FalloutState } from "./schema";

/** 给模型看的【后果参考表】：按局面与对手分量给例子 */
export function consequenceSection(data: Readonly<Record<string, unknown>>): string | undefined {
  if (data.consequences === undefined) return undefined;
  const table = [...ConsequenceTableSchema.parse(data.consequences)].sort(
    (a, b) => a.risk - b.risk,
  );
  const lines = [
    "【后果参考表】",
    "仅在既有条件确实引出后果时参考，不是每轮挑选惩罚的清单。按实际行动、环境和对手能力判断；伤害遵循前置物理裁决与当前伤势，暴露、跟踪或失去先机也必须有具体原因。准备充分可以顺利成功，无事发生时不补后果；同一损伤或警戒持续存在，不重复制造一次新伤害。",
    ...table.map((t) => `- ${t.label}：${t.examples.join("；")}`),
  ];
  return lines.join("\n");
}

/** 给模型看的【近期后果】：延续已有后果，避免把持续状态当成每轮新增损伤 */
export function falloutSection(state: FalloutState): string | undefined {
  const lines: string[] = [];
  const recent = state.recent.slice(-4);
  if (recent.length > 0) {
    const shown = recent.map((e) => e.kinds.map((k) => FALLOUT_LABELS[k]).join("+"));
    lines.push(`- 最近几次（早的在前）：${shown.join("、")}`);
  }
  const [prev, last] = state.recent.slice(-2);
  const repeated = prev && last ? last.kinds.filter((k) => prev.kinds.includes(k)) : [];
  if (repeated.length > 0) {
    const used = new Set(state.recent.slice(-3).flatMap((e) => e.kinds));
    const others = FALLOUT_KINDS.filter((k) => !used.has(k) && k !== "humanity" && k !== "job").map(
      (k) => FALLOUT_LABELS[k],
    );
    lines.push(
      `- 连续两次记录了「${repeated.map((k) => FALLOUT_LABELS[k]).join("、")}」：先区分同一后果持续存在与新事件，不因重复而换花样或再次加重。有新的因果依据才参考其他后果（${[...others, "局面变坏"].join("、")}），没有就保持现状。`,
    );
  }
  if (state.owed)
    lines.push(
      `- 已记录的后果 ${state.owed.id} 尚未落地：只在其发生条件满足时写出实际影响，不超出已经确定的原因与范围，不另添惩罚。`,
    );
  return lines.length > 0 ? lines.join("\n") : undefined;
}
