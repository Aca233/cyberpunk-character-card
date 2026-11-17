import { z } from "zod";

/** 战利品墙最多挂几件 */
export const TROPHIES_MAX = 24;

/** 开局住所表的一条：按出身模块 id 给；origin 写 default 的是没对上时用的。数据在 content 包的 safehouses.ts */
export const HomeDefSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  /** 出身模块 id（street-kid、nomad、corpo），或 default */
  origin: z.string().min(1),
  /** 共享同一处开局住所的出身模块 id 列表 */
  origins: z.array(z.string().min(1)).optional(),
  name: z.string().min(1).max(24),
  /** 地点表里的 id */
  location: z.string().min(1),
  note: z.string().min(1).max(120),
  source: z.string().min(1),
});
export type HomeDef = z.infer<typeof HomeDefSchema>;
export const HomeCatalogSchema = z.array(HomeDefSchema);

/** 能买下的公寓：一次付清，不收房租；人在那个地点时在界面上买。数据在 content 包的 safehouses.ts */
export const ApartmentDefSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  name: z.string().min(1).max(24),
  /** 地点表里的 id */
  location: z.string().min(1),
  price: z.number().int().min(1000).max(500_000),
  note: z.string().min(1).max(120),
  source: z.string().min(1),
});
export type ApartmentDef = z.infer<typeof ApartmentDefSchema>;
export const ApartmentCatalogSchema = z.array(ApartmentDefSchema);

export const HomeSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  location: z.string().min(1),
  since: z.number().int(),
});
export type Home = z.infer<typeof HomeSchema>;

/** @deprecated 仅作历史存档反序列化兼容；战利品墙展示与 trophy 指令已下线 */
export const TrophySchema = z.object({
  label: z.string().min(1).max(20),
  note: z.string().min(1).max(120),
  at: z.number().int(),
});
export type Trophy = z.infer<typeof TrophySchema>;

export const SafehouseStateSchema = z.object({
  homes: z.array(HomeSchema).default([]),
  /** 安全屋存放箱：安全屋 id → 物品 id → 数量；后备箱由车辆 cargo 保存。 */
  stash: z.record(z.string(), z.record(z.string(), z.number().int().min(1))).default({}),
  /** 历史存档兼容字段；战利品墙已下线 */
  trophies: z.array(TrophySchema).default([]),
});
export type SafehouseState = z.infer<typeof SafehouseStateSchema>;

/** 模型使用：{"type": "stash", "action": "store", "item": "...", "reason": "..."} */
export const StashCommandSchema = z
  .object({
    type: z.literal("stash"),
    action: z.enum(["store", "take"]),
    item: z.string().min(1),
    /** 放在哪：安全屋 id 或车的 id；人在安全屋里可以不写 */
    where: z.string().min(1).optional(),
    reason: z.string().trim().min(1).max(80),
  })
  .describe(
    "存放：store 把背包里的东西放进安全屋存放箱或后备箱，take 拿出来放回背包；where 写安全屋 id 或车的 id，人在安全屋里可以不写",
  );
export type StashCommand = z.infer<typeof StashCommandSchema>;

/** @deprecated 战利品墙指令已下线 */
export const TrophyCommandSchema = z.object({
  type: z.literal("trophy"),
  label: z.string().trim().min(1).max(20),
  note: z.string().trim().min(1).max(120),
});
export type TrophyCommand = z.infer<typeof TrophyCommandSchema>;

/** 只能由代码发出：建档时给开局住所 */
export const SafehouseInternalSchemas = {
  "safehouse.seed": z.object({
    type: z.literal("safehouse.seed"),
    id: z.string().min(1),
    name: z.string().min(1),
    location: z.string().min(1),
  }),
};
export type SafehouseInternal = z.infer<
  (typeof SafehouseInternalSchemas)[keyof typeof SafehouseInternalSchemas]
>;
