import { z } from "zod";
import { ItemDefSchema } from "../inventory";

/** 住所产权类型：租住（周期交租，逾期断水电锁门）或自有买断（免房租） */
export const HomeTenureSchema = z.enum(["rented", "owned"]);
export type HomeTenure = z.infer<typeof HomeTenureSchema>;

/** 租住公寓默认账单周期（30 天）与宽限期（3 天），单位为游戏分钟 */
export const RENT_DEFAULT_PERIOD_DAYS = 30;
export const RENT_GRACE_DAYS = 3;
export const RENT_REMIND_BEFORE_DAYS = 3;

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
  /** 与此住所连通的地图服务点（如 poi:v_room），在这些入口也视为身处住所 */
  poiIds: z.array(z.string().min(1)).optional(),
  /** 产权形态：H10 胶囊公寓为租住（rented），恶土拖车与买断公寓为自有（owned） */
  tenure: HomeTenureSchema.default("owned"),
  /** 租住公寓每期租金与水电物业费（欧元） */
  rentAmount: z.number().int().min(0).optional(),
  /** 租住公寓账单周期（天），默认 30 天 */
  rentPeriodDays: z.number().int().min(1).max(90).optional(),
  note: z.string().min(1).max(120),
  source: z.string().min(1),
});
export type HomeDef = z.infer<typeof HomeDefSchema>;
export const HomeCatalogSchema = z.array(HomeDefSchema);

/** 能买下的公寓：一次付清，不收房租；人在对应地点或出租/公寓 POI 时均可购置。数据在 content 包的 safehouses.ts */
export const ApartmentDefSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  name: z.string().min(1).max(24),
  /** 地点表里的 id */
  location: z.string().min(1),
  /** 对应的地图服务点（rent / apartment POI，如 poi:japantown、poi:dlc6_apart_wbr_jpn） */
  poiIds: z.array(z.string().min(1)).optional(),
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
  tenure: HomeTenureSchema.default("owned"),
  rentAmount: z.number().int().min(0).optional(),
  rentPeriodDays: z.number().int().min(1).max(90).optional(),
  /** 本期房租水电缴清截止时刻（游戏分钟）；租住住所必填，自有住所省略 */
  rentPaidUntil: z.number().int().optional(),
  /** 是否因欠租超宽限期被物业电子锁锁门并停水电 */
  locked: z.boolean().default(false),
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
    id: z.string().min(1).describe("住所稳定 id（lose 填已有住所 id）"),
    name: z.string().min(1).max(24).optional(),
    location: z.string().min(1).optional(),
    reason: z.string().trim().min(1).max(80),
  })
  .describe(
    "住所变化：剧情里新得/借住落脚点写 gain（写 id、name、location），抄家暴露或退掉写 lose",
  );
export type HomeCommand = z.infer<typeof HomeCommandSchema>;

/** 只能由代码发出：建档时给开局住所、界面买房或缴纳租住房租解锁门禁 */
export const SafehouseInternalSchemas = {
  "safehouse.seed": z.object({
    type: z.literal("safehouse.seed"),
    id: z.string().min(1),
    name: z.string().min(1),
    location: z.string().min(1),
    tenure: HomeTenureSchema.optional(),
    rentAmount: z.number().int().min(0).optional(),
    rentPeriodDays: z.number().int().min(1).max(90).optional(),
  }),
  "safehouse.payRent": z.object({
    type: z.literal("safehouse.payRent"),
    id: z.string().min(1),
  }),
};
export type SafehouseInternal = z.infer<
  (typeof SafehouseInternalSchemas)[keyof typeof SafehouseInternalSchemas]
>;
