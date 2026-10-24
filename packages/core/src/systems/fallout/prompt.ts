import { ConsequenceTableSchema, FALLOUT_KINDS, FALLOUT_LABELS, type FalloutState } from "./schema";

const SHIFT: Readonly<Record<string, string>> = {
  streetLegend:
    "当前难度是街头传说：后果整体轻一档，按低一星的那一行挑；1 星时只让局面变坏，不扣数值。",
  deathCity: "当前难度是死亡之城：后果整体重一档，按高一星的那一行挑；5 星照旧。",
};

/** 给模型看的【后果参考表】：按委托星级给分量和例子；难度模式整体挪一档 */
export function consequenceSection(
  data: Readonly<Record<string, unknown>>,
  mode: string,
): string | undefined {
  if (data.consequences === undefined) return undefined;
  const table = [...ConsequenceTableSchema.parse(data.consequences)].sort(
    (a, b) => a.risk - b.risk,
  );
  const lines = [
    "【后果参考表】",
    "失败、冒险和坏选择要有真实的后果。按委托星级挑一两样（不在委托里时按对手估：街头混混 1–2 星，帮派精锐和公司保安 3 星，更硬的 4–5 星）；只是参考，按情境换成说得通的别的东西也行。伤害只能照检定事先说明的档位来，难度不改它。也可以不扣数值、让局面变坏（对方有了防备、被跟上、丢了先机），但要真的落进后面的戏里。",
    ...(SHIFT[mode] ? [SHIFT[mode]] : []),
    ...table.map((t) => `- ${t.risk} 星（${t.label}）：${t.examples.join("；")}`),
  ];
  return lines.join("\n");
}

/** 给模型看的【近期后果】：最近落下了什么、有没有连着重复、有没有失败却没落地的检定 */
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
      `- 已经连着两次是「${repeated.map((k) => FALLOUT_LABELS[k]).join("、")}」，下一次后果换个花样：${[...others, "局面变坏"].join("、")}`,
    );
  }
  if (state.owed)
    lines.push(
      `- 检定 ${state.owed.id} 失败了，但还没落下实际的后果：这一轮让它在戏里落地，不超过当时说好的范围`,
    );
  return lines.length > 0 ? lines.join("\n") : undefined;
}
