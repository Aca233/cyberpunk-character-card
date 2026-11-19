import { z } from "zod";
import { ItemDefSchema } from "../inventory";

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

export const SafehouseStateSchema = z.object({
  homes: z.array(HomeSchema).default([]),
});
export type SafehouseState = z.infer<typeof SafehouseStateSchema>;

/** 模型使用：{"type": "itemPlace", "action": "leave", "item": "...", "where": "...", "reason": "..."} */
export const ItemPlaceCommandSchema = z
  .object({
    type: z.literal("itemPlace"),
    action: z.enum(["leave", "take"]),
    item: z.string().min(1),
    count: z.number().int().min(1).max(99).optional(),
    /** 仅 leave：明确从背包、当前穿着或快捷栏取出；省略时按实际随身状态取。 */
    source: z.enum(["backpack", "worn", "quick"]).optional(),
    /** 放在/取自哪里：安全屋 id、车辆 id、地点 id 或人物 id；在安全屋或当前地点时可省略 */
    where: z.string().min(1).optional(),
    /** 首次把现场物品/尸体直接放进车里或留在某处时提供 */
    definition: ItemDefSchema.optional(),
    origin: z.string().min(1).max(240).optional(),
    note: z.string().trim().min(1).max(120).optional(),
    reason: z.string().trim().min(1).max(80),
  })
  .superRefine((command, ctx) => {
    if (command.source !== undefined && command.action !== "leave") {
      ctx.addIssue({ code: "custom", path: ["source"], message: "取回物品时不能指定随身来源" });
    }
    if ((command.source === "worn" || command.source === "quick") && (command.count ?? 1) !== 1) {
      ctx.addIssue({
        code: "custom",
        path: ["count"],
        message: "穿着或快捷栏的物品每次只能存放一件",
      });
    }
  })
  .describe(
    "留置与取回：只有玩家明确把东西留在家、放进车里、留在某处或暂交某人，或从这些地方拿回随身时才写；普通杂物不建档。回家换装拿物再出门在同一轮里一起完成，穿戴中或快捷栏的物品留下时自动脱下。",
  );
export type ItemPlaceCommand = z.infer<typeof ItemPlaceCommandSchema>;

/** 剧情中获得、借住或失去住所 */
export const HomeCommandSchema = z
  .object({
    type: z.literal("home"),
    action: z.enum(["gain", "lose"]),
    id: z.string().min(1),
    name: z.string().min(1).max(24).optional(),
    location: z.string().min(1).optional(),
    reason: z.string().trim().min(1).max(80),
  })
  .describe(
    "住所变化：剧情里新得/借住落脚点写 gain（写 id、name、location），抄家暴露或退掉写 lose",
  );
export type HomeCommand = z.infer<typeof HomeCommandSchema>;

/** 只能由代码发出：建档时给开局住所或界面买房 */
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
