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

/** 战利品墙上的一件：只做展示，点开是当时的履历片段 */
export const TrophySchema = z.object({
  label: z.string().min(1).max(20),
  note: z.string().min(1).max(120),
  at: z.number().int(),
});
export type Trophy = z.infer<typeof TrophySchema>;

export const SafehouseStateSchema = z.object({
  homes: z.array(HomeSchema).default([]),
  /** 存放的东西：安全屋 id 或车的 id → 物品 id → 数量 */
  stash: z.record(z.string(), z.record(z.string(), z.number().int().min(1))).default({}),
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
    "存放：store 把背包里的东西放进安全屋存放箱或后备箱，take 拿出来放回背包；where 写安全屋 id 或车的 id，人在安全屋里可以不写。装备着的要先卸下",
  );
export type StashCommand = z.infer<typeof StashCommandSchema>;

/** 模型使用：{"type": "trophy", "label": "...", "note": "..."} */
export const TrophyCommandSchema = z
  .object({
    type: z.literal("trophy"),
    label: z.string().trim().min(1).max(20),
    note: z.string().trim().min(1).max(120),
  })
  .describe(
    "战利品墙：人在安全屋、把一件有纪念意义的东西挂上墙时写；label 是东西的名字，note 是一句当时的事。只做展示，不改物品栏",
  );
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
