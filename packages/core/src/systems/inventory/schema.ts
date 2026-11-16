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
    /** 治疗品和手雷：一份实际补给内的可用数量 */
    charges: z.number().int().min(1).optional(),
    /** 治疗品：每次回复生命上限的百分之几 */
    healPercent: z.number().int().min(1).max(100).optional(),
    /** 不朽物品（原作的 Iconic）：只能从剧情获得 */
    iconic: z.boolean().default(false),
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

/** 剧情中出现的独立物件；定义、来历和归属随存档保存，不受静态目录限制。 */
export const WorldObjectSchema = z.object({
  definition: ItemDefSchema,
  origin: z.string().min(1).max(240),
  holder: z.string().min(1),
  location: z.string().nullable(),
  changedAt: z.number().int(),
  lastChange: z.string().min(1).max(240),
  remaining: z.number().int().min(0).nullable(),
});

const QuickSlotSchema = z
  .object({
    id: z.string().min(1),
    charges: z.number().int().min(0),
    max: z.number().int().min(1),
  })
  .nullable();

export const InventoryStateSchema = z.object({
  objects: z.record(z.string(), WorldObjectSchema).default({}),
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
  /** 拆解得来的零件，用来给武器升稀有度；旧存档默认 0 */
  parts: z.number().int().min(0).default(0),
  /** 升过稀有度的武器：武器 id → 现在的稀有度；同一种武器的几把共用一份 */
  tuned: z.record(z.string(), RaritySchema).default({}),
  /** 各家店这一批卖掉了多少：店 id -> 这一批从什么时候算起、每件卖了几个；满 3 个游戏日补满 */
  shopStock: z
    .record(
      z.string(),
      z.object({
        restockedAt: z.number().int(),
        sold: z.record(z.string(), z.number().int().min(1)),
      }),
    )
    .default({}),
});
export type InventoryState = z.infer<typeof InventoryStateSchema>;

/** 模型使用：{"type": "item", "action": "gain", "id": "...", "reason": "..."} */
export const ItemCommandSchema = z
  .object({
    type: z.literal("item"),
    action: z.enum(["gain", "lose", "use", "equip", "unequip"]),
    id: z.string().min(1),
    reason: z.string().min(1),
    definition: ItemDefSchema.optional().describe("首次获得目录外独立物件时写完整定义，definition.id 必须等于 id；不要重新定义已有物件"),
    origin: z.string().min(1).max(240).optional().describe("首次出现的物件从哪里来、此前属于谁；必须依据已发生的事实"),
    recipient: z.string().min(1).max(80).optional().describe("lose 转交物件时写接收者；没写表示留在当前地点"),
    /** 历史存档兼容字段；所有武器统一放进背包，不再使用武器栏槽位 */
    slot: z.number().int().min(1).max(3).optional(),
  })
  .describe(
    "物品：gain 获得、lose 失去、use 使用、equip 穿戴、unequip 脱下。目录外物件首次 gain 写 definition 和 origin，此后始终复用同一 id。use 只消耗一次性物品；用钥匙、工具等不发 use。",
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

/** 只能由代码发出：其他系统消耗实际携带的补给 */
export const InventoryInternalSchemas = {
  "inventory.spend": z.object({ type: z.literal("inventory.spend"), slot: QuickSlotNameSchema }),
  /** 界面里在商店货架上买走一件：记进这一批的已卖数量 */
  "inventory.sold": z.object({
    type: z.literal("inventory.sold"),
    shop: z.string().min(1),
    item: z.string().min(1),
    at: z.number().int(),
  }),
  /** 界面动作：save 把身上穿着的存成整套外观，wear 照存下的一次换好 */
  "inventory.outfit": z.object({
    type: z.literal("inventory.outfit"),
    action: z.enum(["save", "wear"]),
  }),
  /** 安全屋系统发出：out 从背包拿走一件放进存放箱或后备箱，in 拿回背包；武器的改装件留着 */
  "inventory.stash": z.object({
    type: z.literal("inventory.stash"),
    action: z.enum(["out", "in"]),
    id: z.string().min(1),
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
  /** 店主的人物卡 id；有卡时见过面、好感够了，没到街头声望门槛的货也肯卖 */
  keeperNpc: z.string().min(1).optional(),
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

/** 模型使用：剧情里得到或花掉零件 */
export const PartsCommandSchema = z
  .object({
    type: z.literal("parts"),
    delta: z.number().int().min(-60).max(60),
    reason: z.string().min(1),
  })
  .describe(
    "零件：搜刮、拆了场景里的设备、别人送的写正数，剧情里花掉写负数；玩家自己拆解和给武器升级在界面上做，不写这个",
  );
export type PartsCommand = z.infer<typeof PartsCommandSchema>;

/** 默认从容携带的随身大件上限（长枪、重武器、大号砍刀/长钝器） */
export const BASE_BULKY_LIMIT = 2;

/** 未损坏时可额外多带 1 件大件的承重骨骼义体 */
const LOAD_BEARING_CYBERWARE = new Set(["titanium-bones"]);

/**
 * 武器隐蔽度（Concealment）：
 * - pocket（贴身可藏）：手枪（可藏进西装/礼服内）
 * - coat（风衣遮蔽）：左轮、冲锋枪、短钝器（穿外套/夹克可藏匿）
 * - open（显眼长械）：突击步枪、霰弹枪、精准步枪、武士刀（无法藏进衣服，高安保区上街即被盘查）
 * - heavy（重型军火）：狙击步枪、轻机枪（平时放后备箱）
 */
/** 可藏入袖口、靴筒或口袋里的紧凑武器（小刀与指虎），不算街头长枪也不算大件 */
const POCKET_MELEE_WEAPONS = new Set([
  "knife",
  "kaiken",
  "punknife",
  "neurotoxin-knife",
  "knuckles",
]);

/** 大衣或随身包可遮掩的中短兵刃与工具 */
const COAT_MELEE_WEAPONS = new Set([
  "butchers-cleaver",
  "kukri",
  "wakizashi",
  "tire-iron",
  "pipe-wrench",
  "baton",
  "sir-john",
]);

export function weaponConcealment(
  category: WeaponCategory | undefined,
  id?: string,
): "pocket" | "coat" | "open" | "heavy" {
  if (id !== undefined && POCKET_MELEE_WEAPONS.has(id)) return "pocket";
  if (id !== undefined && COAT_MELEE_WEAPONS.has(id)) return "coat";
  switch (category) {
    case "pistol":
      return "pocket";
    case "revolver":
    case "smg":
      return "coat";
    case "assaultRifle":
    case "shotgun":
    case "precisionRifle":
    case "blade":
    case "blunt":
      return "open";
    case "sniperRifle":
    case "lmg":
      return "heavy";
    default:
      return "pocket";
  }
}

/** 是否属于沉重显眼的大件装备（长枪、重武器、大号砍刀/战斧/长钝器） */
export function isBulkyItem(def: Pick<ItemDef, "id" | "kind" | "category"> | undefined): boolean {
  if (def?.kind !== "weapon") return false;
  const c = weaponConcealment(def.category, def.id);
  return c === "open" || c === "heavy";
}

export function isHeavyWeapon(category: WeaponCategory | undefined, id?: string): boolean {
  const c = weaponConcealment(category, id);
  return c === "open" || c === "heavy";
}

/** 根据已安装且未损坏的承重骨骼义体计算从容携带大件上限 */
export function bulkyLimit(cyberware?: {
  readonly installed?: readonly { readonly id: string }[];
  readonly brokenChrome?: readonly string[];
}): number {
  if (!cyberware?.installed?.length) return BASE_BULKY_LIMIT;
  const broken = new Set(cyberware.brokenChrome ?? []);
  const bonus = cyberware.installed.filter(
    (c) => LOAD_BEARING_CYBERWARE.has(c.id) && !broken.has(c.id),
  ).length;
  return BASE_BULKY_LIMIT + bonus;
}

/** 合并背包与旧存档武器槽里的随身物品数量（旧武器槽条目排在前面） */
export function carriedItemCounts(
  state: Pick<InventoryState, "backpack" | "weapons">,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const w of state.weapons) {
    if (w !== null) counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  for (const [id, count] of Object.entries(state.backpack)) {
    if (count > 0) counts.set(id, (counts.get(id) ?? 0) + count);
  }
  return counts;
}

/** 身上所有随身武器的去重 id 列表（兼容旧存档武器槽 + 当前背包） */
export function carriedWeaponIds(
  state: Pick<InventoryState, "backpack" | "weapons">,
  catalog: ReadonlyMap<string, ItemDef>,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of carriedItemCounts(state).keys()) {
    if (!seen.has(id) && catalog.get(id)?.kind === "weapon") {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

const CONCEALMENT_RANK: Readonly<Record<"pocket" | "coat" | "open" | "heavy", number>> = {
  pocket: 0,
  coat: 1,
  open: 2,
  heavy: 3,
};

/** 计算随身携带隐蔽度与大件软超重状态 */
export function loadoutSummary(
  state: Pick<InventoryState, "weapons" | "backpack">,
  catalog: ReadonlyMap<string, ItemDef>,
  cyberware?: {
    readonly installed?: readonly { readonly id: string }[];
    readonly brokenChrome?: readonly string[];
  },
) {
  let bulkyCount = 0;
  const bulkyItems: string[] = [];
  let hasHeavy = false;
  let profile: "pocket" | "coat" | "open" | "heavy" = "pocket";
  for (const [weaponId, count] of carriedItemCounts(state)) {
    const def = catalog.get(weaponId);
    if (def?.kind !== "weapon") continue;
    const conc = weaponConcealment(def.category, def.id);
    if (conc === "heavy") hasHeavy = true;
    if (CONCEALMENT_RANK[conc] > CONCEALMENT_RANK[profile]) {
      profile = conc;
    }
    if (isBulkyItem(def)) {
      bulkyCount += count;
      bulkyItems.push(count > 1 ? `${def.name}×${count}` : def.name);
    }
  }
  const bulkyMax = bulkyLimit(cyberware);
  return {
    bulkyCount,
    bulkyMax,
    bulkyOverloaded: bulkyCount > bulkyMax,
    bulkyItems,
    hasHeavyWeapon: hasHeavy,
    concealment: profile,
  };
}
