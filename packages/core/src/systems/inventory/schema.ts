import { z } from "zod";
import { type Attribute, AttributeSchema } from "../dice";
import { DiscountSchema, RaritySchema, ServiceSchema } from "../economy";

export const ItemKindSchema = z.enum([
  "weapon",
  "healing",
  "grenade",
  "consumable",
  "clothing",
  "mod",
  "misc",
]);
export type ItemKind = z.infer<typeof ItemKindSchema>;

export const ITEM_KIND_LABELS: Readonly<Record<ItemKind, string>> = {
  weapon: "武器",
  healing: "治疗品",
  grenade: "手雷",
  consumable: "消耗品",
  clothing: "服装",
  mod: "改装件",
  misc: "杂物",
};

/** 服装的 6 格，照原作；服装只影响身份和伪装，不提供护甲 */
export const ClothingSlotSchema = z.enum(["head", "face", "outer", "inner", "legs", "feet"]);
export type ClothingSlot = z.infer<typeof ClothingSlotSchema>;

export const CLOTHING_SLOT_LABELS: Readonly<Record<ClothingSlot, string>> = {
  head: "头部",
  face: "面部",
  outer: "外套",
  inner: "内衣",
  legs: "腿部",
  feet: "鞋子",
};

/** 武器类别，按原作 */
export const WeaponCategorySchema = z.enum([
  "pistol",
  "revolver",
  "smg",
  "assaultRifle",
  "shotgun",
  "precisionRifle",
  "sniperRifle",
  "lmg",
  "blade",
  "blunt",
]);
export type WeaponCategory = z.infer<typeof WeaponCategorySchema>;

export const WEAPON_CATEGORY_LABELS: Readonly<Record<WeaponCategory, string>> = {
  pistol: "手枪",
  revolver: "左轮手枪",
  smg: "冲锋枪",
  assaultRifle: "突击步枪",
  shotgun: "霰弹枪",
  precisionRifle: "精准步枪",
  sniperRifle: "狙击步枪",
  lmg: "轻机枪",
  blade: "刀剑",
  blunt: "钝器",
};

/** 改装件装在武器的哪个位置：枪口（消音器）、瞄准镜、插件；每个位置装一件 */
export const ModSlotSchema = z.enum(["muzzle", "scope", "plugin"]);
export type ModSlot = z.infer<typeof ModSlotSchema>;

export const MOD_SLOT_LABELS: Readonly<Record<ModSlot, string>> = {
  muzzle: "枪口",
  scope: "瞄准镜",
  plugin: "插件",
};

/** 远程武器的类型：威能（跳弹）、技术（蓄力穿墙）、智能（子弹追踪，要手部装智能连接） */
export const WeaponTypeSchema = z.enum(["power", "tech", "smart"]);
export type WeaponType = z.infer<typeof WeaponTypeSchema>;

export const WEAPON_TYPE_LABELS: Readonly<Record<WeaponType, string>> = {
  power: "威能",
  tech: "技术",
  smart: "智能",
};

const MELEE: ReadonlySet<WeaponCategory> = new Set(["blade", "blunt"]);

/** 武器用哪项属性检定（照原作 2.0）：技术武器用技术，智能武器用智能，其余按类别 */
export function weaponAttribute(category: WeaponCategory, type?: WeaponType): Attribute {
  if (type === "tech") return "tech";
  if (type === "smart") return "intelligence";
  switch (category) {
    case "shotgun":
    case "lmg":
    case "blunt":
      return "body";
    case "blade":
    case "assaultRifle":
    case "smg":
      return "reflexes";
    case "pistol":
    case "revolver":
    case "precisionRifle":
    case "sniperRifle":
      return "cool";
  }
}

/** 物品表的一条；数据在 content 包的 items.ts，结算时通过 ctx.data.items 传入 */
export const ItemDefSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    kind: ItemKindSchema,
    /** 武器用哪项属性检定 */
    attribute: AttributeSchema.optional(),
    /** 治疗品和手雷：休整或场景结束时恢复的使用次数 */
    charges: z.number().int().min(1).optional(),
    /** 治疗品：每次回复生命上限的百分之几 */
    healPercent: z.number().int().min(1).max(100).optional(),
    /** 不朽物品（原作的 Iconic）：只能从剧情获得 */
    iconic: z.boolean().default(false),
    /** 不朽武器的专属内心声音：拿在武器栏里时，它用什么口吻在脑子里说话；写给模型 */
    voice: z.string().min(1).max(80).optional(),
    price: z.number().int().min(0).optional(),
    rarity: RaritySchema.optional(),
    /** 武器类别；武器必须写 */
    category: WeaponCategorySchema.optional(),
    /** 远程武器的类型；近战武器不写 */
    weaponType: WeaponTypeSchema.optional(),
    /** 服装穿在哪一格；服装必须写 */
    clothingSlot: ClothingSlotSchema.optional(),
    /** 改装件装在武器的哪个位置；改装件必须写 */
    modSlot: ModSlotSchema.optional(),
    /** 改装件能装到哪些类别的武器上；改装件必须写 */
    modFits: z.array(WeaponCategorySchema).min(1).optional(),
    /** 拿着它角色真的能做到什么；写给模型 */
    ability: z.string().min(1).optional(),
    /** 官方文本库里的出处，例如 text:Gameplay-Weapons-Melee-DisplayName-Preset_Katana */
    source: z
      .string()
      .regex(/^text:\S+$/)
      .optional(),
  })
  .superRefine((item, ctx) => {
    const report = (message: string) =>
      ctx.addIssue({ code: "custom", message: `${item.id}：${message}` });
    if (item.kind === "weapon") {
      if (item.category === undefined) report("武器必须写明类别");
      else if (MELEE.has(item.category) && item.weaponType !== undefined) {
        report("近战武器没有威能、技术、智能之分");
      } else if (item.attribute !== weaponAttribute(item.category, item.weaponType)) {
        report(`按类别和类型应该用${weaponAttribute(item.category, item.weaponType)}检定`);
      }
    } else if (item.category !== undefined || item.weaponType !== undefined) {
      report("只有武器才写类别和类型");
    }
    if (item.kind === "clothing" && item.clothingSlot === undefined)
      report("服装必须写明穿在哪一格");
    if (item.kind !== "clothing" && item.clothingSlot !== undefined) report("只有服装才写格子");
    if (item.voice !== undefined && !(item.iconic && item.kind === "weapon")) {
      report("只有不朽武器才有专属内心声音");
    }
    if (item.kind === "mod") {
      if (item.modSlot === undefined || item.modFits === undefined) {
        report("改装件必须写明装在哪个位置、配哪些武器");
      } else if (item.modSlot !== "plugin" && item.modFits.some((c) => MELEE.has(c))) {
        report("近战武器只能装插件，没有枪口和瞄准镜");
      }
    } else if (item.modSlot !== undefined || item.modFits !== undefined) {
      report("只有改装件才写位置和适用武器");
    }
    if ((item.kind === "healing" || item.kind === "grenade") && item.charges === undefined) {
      report("治疗品和手雷必须写明使用次数");
    }
    if (item.kind === "healing" && item.healPercent === undefined) report("治疗品必须写明回复比例");
  });
export type ItemDef = z.infer<typeof ItemDefSchema>;

export const ItemCatalogSchema = z.array(ItemDefSchema);

const QuickSlotSchema = z
  .object({
    id: z.string().min(1),
    charges: z.number().int().min(0),
    max: z.number().int().min(1),
  })
  .nullable();

export const InventoryStateSchema = z.object({
  /** 3 个武器格，按 1/2/3 切换 */
  weapons: z.array(z.string().min(1).nullable()).length(3),
  /** 当前手持的武器格（从 0 起），空手时为 null */
  active: z.number().int().min(0).max(2).nullable(),
  healing: QuickSlotSchema,
  grenade: QuickSlotSchema,
  /** 背包：物品 id → 数量 */
  backpack: z.record(z.string(), z.number().int().min(1)),
  /** 从快捷栏卸下时还没恢复的次数，防止换装刷次数 */
  depleted: z.record(z.string(), z.number().int().min(0)),
  /** 身上穿着的服装：格子 → 物品 id */
  clothing: z.partialRecord(ClothingSlotSchema, z.string().min(1)).default({}),
  /** 存下的整套外观：格子 → 物品 id；没存过时为空 */
  outfit: z.partialRecord(ClothingSlotSchema, z.string().min(1)).default({}),
  /** 武器上装着的改装件：武器 id → 位置 → 改装件 id；同一种武器的几把共用一份 */
  mods: z.record(z.string(), z.partialRecord(ModSlotSchema, z.string().min(1))).default({}),
});
export type InventoryState = z.infer<typeof InventoryStateSchema>;

/** 模型使用：{"type": "item", "action": "gain", "id": "...", "reason": "..."} */
export const ItemCommandSchema = z
  .object({
    type: z.literal("item"),
    action: z.enum(["gain", "lose", "use", "equip", "unequip"]),
    id: z.string().min(1),
    reason: z.string().min(1),
    /** equip 武器时指定第几格（1–3） */
    slot: z.number().int().min(1).max(3).optional(),
  })
  .describe(
    "物品：gain 获得、lose 失去、use 使用、equip 装备（武器写 slot 1–3）、unequip 卸下；id 必须是物品表或物品栏里有的",
  );
export type ItemCommand = z.infer<typeof ItemCommandSchema>;

/** 模型使用：买卖，价钱由代码查表；物品按物品表的参考价，服务按服务价目表 */
export const TradeCommandSchema = z
  .object({
    type: z.literal("trade"),
    action: z
      .enum(["buy", "sell", "service"])
      .describe("buy 买物品，sell 卖物品，service 买服务（吃住、打车、情报、看伤、罚款、打点）"),
    item: z.string().min(1).optional().describe("buy 和 sell 写物品表里的 id"),
    service: ServiceSchema.optional().describe(
      "service 写：meal 吃一顿，drink 一杯酒，lodging 住一晚，cab 打车，info 买情报，medical 街头诊所看伤，fine 交罚款，favor 打点、请人帮个小忙",
    ),
    discount: DiscountSchema.default("none").describe(
      "讲价讲下来多少：none 没有，small 小，large 大",
    ),
    with: z.string().min(1).max(40).describe("和谁交易"),
    reason: z.string().min(1),
  })
  .refine((t) => (t.action === "service" ? t.service !== undefined : t.item !== undefined), {
    message: "buy 和 sell 写 item，service 写 service",
  })
  .describe("买卖：只写买什么、讲价档，不写价钱；钱不够时整条不生效");
export type TradeCommand = z.infer<typeof TradeCommandSchema>;

export const QuickSlotNameSchema = z.enum(["healing", "grenade"]);
export type QuickSlotName = z.infer<typeof QuickSlotNameSchema>;

/** 只能由代码发出：其他系统扣快捷栏次数、休整后恢复次数 */
export const InventoryInternalSchemas = {
  "inventory.spend": z.object({ type: z.literal("inventory.spend"), slot: QuickSlotNameSchema }),
  "inventory.recharge": z.object({ type: z.literal("inventory.recharge") }),
  /** 界面动作：save 把身上穿着的存成整套外观，wear 照存下的一次换好 */
  "inventory.outfit": z.object({
    type: z.literal("inventory.outfit"),
    action: z.enum(["save", "wear"]),
  }),
  /** 界面动作：把背包里的改装件装到武器上，或拆下放回背包 */
  "inventory.mod": z.object({
    type: z.literal("inventory.mod"),
    action: z.enum(["attach", "detach"]),
    weapon: z.string().min(1),
    mod: z.string().min(1),
  }),
};
export type InventoryInternal = z.infer<
  (typeof InventoryInternalSchemas)[keyof typeof InventoryInternalSchemas]
>;

/** 商店：开在某个地点，有自己的货架和价格；高稀有度的货随街头声望解锁。数据在 content 包的 shops.ts */
export const ShopSchema = z.object({
  id: z.string().min(1).max(40),
  /** 店名，例如“威尔逊的枪店” */
  name: z.string().min(1).max(24),
  /** 店主；给叙事模型写场面用 */
  keeper: z.string().min(1).max(20),
  /** 地点表里的 id：玩家在这里时才能进店 */
  location: z.string().min(1),
  note: z.string().max(120).default(""),
  /** 乘在物品表参考价上的系数 */
  priceFactor: z.number().min(0.5).max(2).default(1),
  /** 黑市货：便宜，但可能来路不明，由叙事模型在剧情里兑现 */
  blackMarket: z.boolean().default(false),
  /** 货架上的物品 id；不朽物品和没有标价的放上来也不卖 */
  shelf: z.array(z.string().min(1)).min(1),
  /** 各稀有度要多少级街头声望才肯卖；没写的稀有度不设门槛 */
  credGates: z.partialRecord(RaritySchema, z.number().int().min(0).max(50)).default({}),
});
export type Shop = z.infer<typeof ShopSchema>;
export const ShopListSchema = z.array(ShopSchema);

/** 卖给商店的回收价：最多按参考价的两成（从店里买来的转卖上限），防低买高卖 */
export const SELL_RATE = 0.2;
