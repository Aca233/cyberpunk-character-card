import { z } from "zod";

export const HUMANITY_MAX = 100;
/** 单次扣除上限 */
export const LOSS_CAP = 15;
/** 每个游戏日最多恢复多少 */
export const DAILY_RECOVERY_CAP = 8;
export const MINUTES_PER_DAY = 1440;

/** 义体耐受：建角色时选，乘在义体的人性消耗上 */
export const ToleranceSchema = z.enum(["low", "normal", "high"]);
export type Tolerance = z.infer<typeof ToleranceSchema>;
export const TOLERANCE_FACTOR: Readonly<Record<Tolerance, number>> = {
  low: 1.3,
  normal: 1,
  high: 0.7,
};

export const HumanityStateSchema = z.object({
  current: z.number().int().min(0).max(HUMANITY_MAX),
  /** 已装义体的人性消耗之和；义体系统通过内部指令更新 */
  cyberwareCost: z.number().int().min(0).max(HUMANITY_MAX),
  /** 旧存档没有：都按普通 */
  tolerance: ToleranceSchema.default("normal"),
  /** 某个游戏日（序号）已经恢复了多少 */
  recovery: z.object({ day: z.number().int(), amount: z.number().int().min(0) }),
  /** 已经结算过的事件 id；同一事件只结算一次 */
  settled: z.array(z.string()),
});
export type HumanityState = z.infer<typeof HumanityStateSchema>;

/** 模型使用：{"type": "humanity", "delta": -2, "reason": "..."} */
export const HumanityCommandSchema = z
  .object({
    type: z.literal("humanity"),
    delta: z
      .number()
      .int()
      .refine((v) => v !== 0, "人性变化不能为 0"),
    reason: z.string().min(1),
    /** 事件 id，例如某个重要的人死去；带上后同一事件只结算一次 */
    event: z.string().min(1).optional(),
  })
  .describe(
    "人性变化（结算用；模型写的是类别和大小，见 HumanityProposalSchema）；单次和每天的恢复有上限，代码截断",
  );
export type HumanityCommand = z.infer<typeof HumanityCommandSchema>;

/** 人性的类别和大小档；换算表只在这里写一份（暂定，试玩时调） */
export const HUMANITY_KINDS = {
  cruelty: { label: "残忍行为", sizes: { small: -2, medium: -3, large: -5 } },
  loss: { label: "失去重要的人", sizes: { small: -10, medium: -10, large: -10 } },
  rest: { label: "休整", sizes: { small: 3, medium: 5, large: 8 } },
} as const;
export type HumanityKind = keyof typeof HUMANITY_KINDS;
type HumanitySize = keyof (typeof HUMANITY_KINDS)["cruelty"]["sizes"];
const SIZE_LABELS: Readonly<Record<HumanitySize, string>> = {
  small: "小",
  medium: "中",
  large: "大",
};

/** 模型写的人性：只选类别和大小，代码按 HUMANITY_KINDS 换成数字 */
export const HumanityProposalSchema = z
  .object({
    type: z.literal("humanity"),
    kind: z
      .enum(["cruelty", "loss", "rest"])
      .describe("cruelty 残忍行为，loss 失去重要的人，rest 休整"),
    size: z
      .enum(["small", "medium", "large"])
      .optional()
      .describe(
        "cruelty 和 rest 要写：cruelty 按残忍程度；rest 的 small 普通休整，medium 有意义的休整，large 和重要的人相处",
      ),
    reason: z.string().min(1),
    event: z
      .string()
      .min(1)
      .optional()
      .describe("事件 id，例如某个重要的人死去；带上后同一事件只结算一次"),
  })
  .refine((h) => h.size !== undefined || h.kind === "loss", {
    message: "cruelty 和 rest 要写 size",
    path: ["size"],
  })
  .describe("人性变化：只选类别和大小，不写数字，代码换算并截断")
  .transform(
    ({ kind, size, ...rest }): HumanityCommand => ({
      ...rest,
      delta: HUMANITY_KINDS[kind].sizes[size ?? "medium"],
    }),
  );

/** 模型仍写了数字人性时：换成最近的类别和大小（一样近取轻的），正数算休整 */
export function legacyHumanity(
  raw: Readonly<Record<string, unknown>>,
): { readonly value: Record<string, unknown>; readonly note: string } | undefined {
  if (!("delta" in raw)) return undefined;
  const { delta, ...rest } = raw;
  if (rest.kind !== undefined) {
    return { value: rest, note: "人性写了数字，按写的类别和大小处理，数字不用" };
  }
  if (typeof delta !== "number" || !Number.isFinite(delta) || delta === 0) return undefined;
  const options: [HumanityKind, HumanitySize, number][] = [];
  for (const [kind, def] of Object.entries(HUMANITY_KINDS) as [
    HumanityKind,
    (typeof HUMANITY_KINDS)[HumanityKind],
  ][]) {
    for (const [size, value] of Object.entries(def.sizes) as [HumanitySize, number][]) {
      if (Math.sign(value) === Math.sign(delta)) options.push([kind, size, value]);
    }
  }
  const [kind, size] = options.reduce((best, cur) =>
    Math.abs(cur[2] - delta) < Math.abs(best[2] - delta) ? cur : best,
  );
  const fixed = kind === "loss";
  return {
    value: { ...rest, kind, ...(fixed ? {} : { size }) },
    note: `人性写了数字，已按最近的档位（${HUMANITY_KINDS[kind].label}${fixed ? "" : `·${SIZE_LABELS[size]}`}）处理`,
  };
}

/** 只能由代码发出：义体装卸后更新消耗合计 */
export const SetCyberwareCostSchema = z.object({
  type: z.literal("humanity.setCyberwareCost"),
  total: z.number().int().min(0).max(HUMANITY_MAX),
});
export type SetCyberwareCost = z.infer<typeof SetCyberwareCostSchema>;

/** 只能由代码发出：建档时写入义体耐受；要在装开局义体之前发 */
export const SetToleranceSchema = z.object({
  type: z.literal("humanity.setTolerance"),
  tolerance: ToleranceSchema,
});
export type SetTolerance = z.infer<typeof SetToleranceSchema>;

/** 只能由代码发出：危机章节里被拉回来，人性直接回到某个值（不受每天恢复上限限制，仍不超过上限） */
export const RestoreHumanitySchema = z.object({
  type: z.literal("humanity.restore"),
  value: z.number().int().min(0).max(HUMANITY_MAX),
});
export type RestoreHumanity = z.infer<typeof RestoreHumanitySchema>;
