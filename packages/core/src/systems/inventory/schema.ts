import { z } from "zod";
import { type Attribute, AttributeSchema, type WeaponConcealment, type WeaponNoise } from "../dice";
import { RaritySchema, ServiceSchema } from "../economy";

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
    /** 非武器大件的粗略携带负担，不是公斤；普通小物不填，首次登记时定下。 */
    carryUnits: z.number().int().min(0).max(40).optional(),
    /** 武器类别；武器必须写 */
    category: WeaponCategorySchema.optional(),
    /** 远程武器的类型；近战武器不写 */
    weaponType: WeaponTypeSchema.optional(),
    /** 显式覆盖该武器开放的改装槽位；未填写时由 defaultWeaponSlots 按类别与体系推导 */
    modSlots: z.array(ModSlotSchema).optional(),
    /** 出厂或剧情自带的预装改装件：槽位 -> 改装件 id */
    preInstalledMods: z.partialRecord(ModSlotSchema, z.string().min(1)).optional(),
    /** 自带且不可随手拆下的锁定改装槽位 */
    lockedModSlots: z.array(ModSlotSchema).optional(),
    /** 服装穿在哪一格；服装必须写 */
    clothingSlot: ClothingSlotSchema.optional(),
    /** 改装件装在武器的哪个位置；改装件必须写 */
    modSlot: ModSlotSchema.optional(),
    /** 改装件能装到哪些类别的武器上；改装件必须写 */
    modFits: z.array(WeaponCategorySchema).min(1).optional(),
    /** 改装件适用的武器技术体系（威能/技术/智能）；不写表示兼容该类别的全部远程体系 */
    modTypes: z.array(WeaponTypeSchema).min(1).optional(),
    /** 改装件或特殊武器对隐蔽度档位的修正（如长消音器或大型狙击镜 +1） */
    concealmentShift: z.number().int().min(-3).max(3).optional(),
    /** 是否内置或加装了自主智能靶向握把/校准模块（可替代手部智能连接义体） */
    grantsSmartLink: z.boolean().optional(),
    /** 拿着它角色真的能做到什么；写给模型 */
    ability: z.string().min(1).optional(),
    /** 固定内容关联；取得载体不等于已经阅读。 */
    chipContentId: z.string().min(1).optional(),
    /** 具有实际读写能力的设备。 */
    chipDevice: z.enum(["reader", "reader-writer"]).optional(),
    /** 可以接收副本的真实存储载体。 */
    chipStorage: z.boolean().optional(),
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
      if (item.category !== undefined) {
        const allowedSlots = defaultWeaponSlots(item);
        if (MELEE.has(item.category) && item.modSlots?.some((s) => s !== "plugin")) {
          report("近战武器只能开放 plugin 槽位");
        }
        if (item.preInstalledMods !== undefined) {
          for (const [slot, modId] of Object.entries(item.preInstalledMods)) {
            if (modId !== undefined && !allowedSlots.includes(slot as ModSlot)) {
              report(`预装改装件的槽位 ${slot} 未对该武器开放`);
            }
          }
        }
        if (item.lockedModSlots !== undefined) {
          for (const slot of item.lockedModSlots) {
            if (!allowedSlots.includes(slot)) {
              report(`锁定槽位 ${slot} 未对该武器开放`);
            }
          }
        }
      }
    } else {
      if (item.category !== undefined || item.weaponType !== undefined) {
        report("只有武器才写类别和类型");
      }
      if (
        item.modSlots !== undefined ||
        item.preInstalledMods !== undefined ||
        item.lockedModSlots !== undefined
      ) {
        report("只有武器才写改装槽位、预装或锁定改装");
      }
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
    } else {
      if (item.modSlot !== undefined || item.modFits !== undefined) {
        report("只有改装件才写位置和适用武器");
      }
      if (item.modTypes !== undefined) {
        report("只有改装件才写适用武器类型");
      }
    }
    if ((item.kind === "healing" || item.kind === "grenade") && item.charges === undefined) {
      report("治疗品和手雷必须写明使用次数");
    }
    if (item.kind === "healing" && item.healPercent === undefined) report("治疗品必须写明回复比例");
  });
export type ItemDef = z.infer<typeof ItemDefSchema>;

export const ItemCatalogSchema = z.array(ItemDefSchema);

/** 商店：开在某个地点，有自己的货架和价格；身份与开局备货持久保存。数据在 content 包的 shops.ts */
export const ShopSchema = z.object({
  id: z.string().min(1).max(80),
  /** 店名，例如“威尔逊的枪店” */
  name: z.string().min(1).max(80),
  /** 店主；给叙事模型写场面用 */
  keeper: z.string().min(1).max(20),
  /** 已登记店主的人物卡 id。 */
  keeperNpc: z.string().min(1).optional(),
  /** 可以代班经营的明确店员；无位置记录不等于已确认离场。 */
  serviceNpcs: z.array(z.string().min(1)).max(12).default([]),
  /** 地点表里的 id：玩家在这里时才能进店 */
  location: z.string().min(1),
  note: z.string().max(120).default(""),
  /** 乘在物品表参考价上的系数 */
  priceFactor: z.number().min(0.5).max(2).default(1),
  /** 黑市货：便宜，但可能来路不明，由叙事模型在剧情里兑现 */
  blackMarket: z.boolean().default(false),
  /** 开局货架上的物品 id；后续以实际库存为准 */
  shelf: z.array(z.string().min(1)).min(1),
  initialStock: z.record(z.string(), z.number().int().min(0)).optional(),
  supply: z
    .object({
      supplier: z.string().min(1).max(120),
      origin: z.string().min(1).max(240),
      route: z.array(z.string().min(1)).min(1).max(20),
      leadMinutes: z.number().int().min(1),
      items: z.array(z.string().min(1)).optional(),
    })
    .optional(),
});
export type Shop = z.infer<typeof ShopSchema>;
export const ShopListSchema = z.array(ShopSchema);

export const MerchantStateSchema = z.object({
  definition: ShopSchema,
  initializedAt: z.number().int(),
  stock: z.record(z.string(), z.number().int().min(0)),
  open: z.boolean(),
  closureReason: z.string().nullable(),
});
export type MerchantState = z.infer<typeof MerchantStateSchema>;

export const ShopBusinessCommandSchema = z.strictObject({
  type: z.literal("shopBusiness"),
  shop: z.string().min(1).max(80),
  action: z.enum(["open", "close", "staff"]),
  keeperNpc: z.string().min(1).optional(),
  serviceNpcs: z.array(z.string().min(1)).max(12).optional(),
  reason: z.string().min(1).max(240),
  evidence: z
    .string()
    .min(2)
    .max(500)
    .describe("本轮正文中真实营业变化或人员接替的原话；不能凭空关闭所有同城区商店"),
  sourceEvent: z
    .string()
    .min(1)
    .optional()
    .describe("来自城市事件时写已存在的事件 id，evidence 引用该事件事实"),
});
export type ShopBusinessCommand = z.infer<typeof ShopBusinessCommandSchema>;

export const SupplyOrderSchema = z.object({
  id: z.string().min(1),
  shop: z.string().min(1),
  item: z.string().min(1),
  quantity: z.number().int().min(1),
  supplier: z.string().min(1),
  origin: z.string().min(1),
  route: z.array(z.string().min(1)).min(1),
  createdAt: z.number().int(),
  dueAt: z.number().int(),
  status: z.enum(["pending", "delayed", "delivered", "cancelled"]),
  remainingMinutes: z.number().int().min(0),
  delayReason: z.string().nullable(),
  requestedBy: z.enum(["store", "player"]),
  uncollected: z.number().int().min(0),
  deliveredAt: z.number().int().nullable(),
  cancelReason: z.string().nullable(),
});
export type SupplyOrder = z.infer<typeof SupplyOrderSchema>;
export const ShopOrderCommandSchema = z.strictObject({
  type: z.literal("shopOrder"),
  action: z.enum(["place", "cancel"]),
  id: z.string().min(1).max(160),
  shop: z.string().min(1).max(80),
  item: z.string().min(1).optional(),
  quantity: z.number().int().min(1).max(50).optional(),
  evidence: z
    .string()
    .min(2)
    .max(500)
    .describe(
      "引用本轮正文中店方接受订货或同意取消的原话；单方面要求不算。到货付款，不预扣订金、不生成债务",
    ),
});
export type ShopOrderCommand = z.infer<typeof ShopOrderCommandSchema>;

/** 单把定制武器的实例状态：挂载在 WorldObject.weaponState 上 */
export const WeaponInstanceStateSchema = z.object({
  /** 目录模板 ID（如 "liberty"）；用于图标映射 itemArtOf(baseId)、商店识别与拆光还原 */
  baseId: z.string().min(1),
  /** 已安装的改装件：槽位 -> 改装件目录 ID */
  mods: z.partialRecord(ModSlotSchema, z.string().min(1)).default({}),
  /** 无法在战外随手拆下的槽位（如枪匠焊死/定制组件、不朽武器固有改装） */
  lockedSlots: z.array(ModSlotSchema).default([]),
  /** 枪匠加装的内置智能靶向联锁握把/模组 */
  smartLink: z.boolean().optional(),
});
export type WeaponInstanceState = z.infer<typeof WeaponInstanceStateSchema>;

export interface WeaponStateView {
  readonly baseId: string;
  readonly mods: Readonly<Partial<Record<ModSlot, string>>>;
  readonly lockedSlots: readonly ModSlot[];
  readonly smartLink: boolean;
}

/** 将内部武器实例状态投影为视图层的只读结构 */
export function projectWeaponState(ws: WeaponInstanceState | undefined): WeaponStateView | null {
  if (!ws) return null;
  return {
    baseId: ws.baseId,
    mods: ws.mods,
    lockedSlots: ws.lockedSlots,
    smartLink: ws.smartLink ?? false,
  };
}

export const WorldObjectKindSchema = z.enum(["story", "customized", "supply"]);
export type WorldObjectKind = z.infer<typeof WorldObjectKindSchema>;

/** 剧情物件、定制武器或已拆封补给；定义、来历、归属与余量随实物保存。 */
export const WorldObjectSchema = z.object({
  kind: WorldObjectKindSchema.default("story"),
  definition: ItemDefSchema,
  /** 已拆封补给等目录物件的模板身份；剩余用量始终属于当前独立实物。 */
  baseId: z.string().min(1).optional(),
  origin: z.string().min(1).max(240),
  holder: z.string().min(1),
  location: z.string().nullable(),
  changedAt: z.number().int(),
  lastChange: z.string().min(1).max(240),
  remaining: z.number().int().min(0).nullable(),
  weaponState: WeaponInstanceStateSchema.optional(),
  /** 实际复制来源；副本仍引用同一内容身份。 */
  copiedFrom: z.string().min(1).optional(),
});
export type WorldObject = z.infer<typeof WorldObjectSchema>;

const QuickSlotSchema = z
  .object({
    id: z.string().min(1),
    charges: z.number().int().min(0),
    max: z.number().int().min(1),
  })
  .nullable();

export const PlacedKindSchema = z.enum(["home", "vehicle", "place", "npc"]);
export type PlacedKind = z.infer<typeof PlacedKindSchema>;

/** 玩家明确留在某处或托人保管的物品/物件记录 */
export const PlacedItemSchema = z.object({
  item: z.string().min(1),
  count: z.number().int().min(1).default(1),
  kind: PlacedKindSchema,
  target: z.string().min(1),
  location: z.string().nullable().default(null),
  note: z.string().min(1).max(120).optional(),
  since: z.number().int(),
});
export type PlacedItem = z.infer<typeof PlacedItemSchema>;

export const InventoryStateSchema = z.object({
  objects: z.record(z.string(), WorldObjectSchema).default({}),
  /** 明确留在家中、车里、现场或交由他人保管的物品 */
  placed: z.array(PlacedItemSchema).default([]),
  merchants: z.record(z.string(), MerchantStateSchema).default({}),
  supplyOrders: z.record(z.string(), SupplyOrderSchema).default({}),
  nextSupply: z.number().int().min(1).default(1),
  /** 确定性定制武器实例序号（wpn:<baseId>:<seq>） */
  nextWeaponSeq: z.number().int().min(1).default(1),
  /** 已拆封补给的独立实物序号（supply:<baseId>:<seq>）。 */
  nextSupplyInstanceSeq: z.number().int().min(1).default(1),
  healing: QuickSlotSchema,
  grenade: QuickSlotSchema,
  /** 背包：物品 id → 数量 */
  backpack: z.record(z.string(), z.number().int().min(1)),
  /** 最近明确的持用事实：null 未明确，空数组已收起；不另设武器装备槽。 */
  heldWeapons: z.array(z.string().min(1)).max(2).nullable().default(null),
  /** 身上穿着的服装：格子 → 物品 id */
  clothing: z.partialRecord(ClothingSlotSchema, z.string().min(1)).default({}),
  /** 拆解得来的零件（保留作可选扩展，默认 0） */
  parts: z.number().int().min(0).default(0),
});
export type InventoryState = z.infer<typeof InventoryStateSchema>;

/** 只记录正文已经发生的拔出、换用或收起，不替玩家选择武器。 */
export const WeaponHoldCommandSchema = z
  .object({
    type: z.literal("weaponHold"),
    weapons: z.array(z.string().min(1)).max(2),
    reason: z.string().min(1).max(160),
  })
  .describe(
    "正文明确改变玩家持用武器时记录最终仍在手中的全部武器 id；已明确收起全部写空数组，未发生变化不发。只能引用随身武器，不把攻击意图当成已经拔出，不因停火或切场自动清空。",
  );
export type WeaponHoldCommand = z.infer<typeof WeaponHoldCommandSchema>;

/** 模型使用：{"type": "item", "action": "gain", "id": "...", "reason": "..."} */
export const ItemCommandSchema = z
  .object({
    type: z.literal("item"),
    action: z.enum(["gain", "lose", "use", "equip", "unequip"]),
    id: z.string().min(1),
    reason: z.string().min(1),
    definition: ItemDefSchema.optional().describe(
      "首次获得目录外独立物件时写完整定义，definition.id 必须等于 id；不要重新定义已有物件",
    ),
    origin: z
      .string()
      .min(1)
      .max(240)
      .optional()
      .describe("首次出现的物件从哪里来、此前属于谁；必须依据已发生的事实"),
    weaponState: WeaponInstanceStateSchema.optional().describe(
      "获得带预装改装的武器时可附带其改装状态；改装件 id 必须真实存在且兼容该武器",
    ),
    recipient: z
      .string()
      .min(1)
      .max(80)
      .optional()
      .describe("lose 转交物件时写接收者；没写表示留在当前地点"),
    /** 所有武器统一放进背包；保留可选槽位参数以免开局数据调用出错 */
    slot: z.number().int().min(1).max(3).optional(),
  })
  .describe(
    "物品：gain 获得、lose 失去、use 使用、equip 穿戴、unequip 脱下。目录外物件首次 gain 写 definition 和 origin，此后始终复用同一 id。use 只消耗一次性物品；用钥匙、工具等不发 use。",
  );
export type ItemCommand = z.infer<typeof ItemCommandSchema>;

/** 模型使用：实际交付；报价与按钮共用，议价引用已登记的条件。 */
export const TradeCommandSchema = z
  .strictObject({
    type: z.literal("trade"),
    action: z
      .enum(["buy", "sell", "service"])
      .describe("buy 买物品，sell 卖物品，service 买服务（含超梦按次与成年从业者服务）"),
    item: z.string().min(1).optional().describe("buy 和 sell 写物品表里的 id"),
    service: ServiceSchema.optional().describe(
      "service 写：meal 吃一顿，drink 一杯酒，lodging 住一晚，cab 打车，info 买情报，medical 看伤，fine 罚款，favor 打点，bd-session 店内超梦，adult-service 成年从业者服务；后两项必须引用完整条件的 offer",
    ),
    offer: z
      .string()
      .min(1)
      .max(80)
      .optional()
      .describe("引用已谈妥报价的 id；省略时使用同条件有效报价或当前店价"),
    with: z
      .string()
      .min(1)
      .max(80)
      .describe("实际交易对象的稳定店铺 id、人物 id 或已登记经营者 id；店内私人买卖写人物 id"),
    reason: z.string().min(1),
  })
  .refine(
    (t) =>
      t.action === "service"
        ? t.service !== undefined && t.item === undefined
        : t.item !== undefined && t.service === undefined,
    {
      message: "buy 和 sell 只写 item，service 只写 service",
    },
  )
  .describe(
    "已经同意且实际交付的买卖；仅询价、计划或尚未落实的赊账不发。钱、货或地点不成立时整笔不生效，不另发同笔 item 或 money",
  );
export type TradeCommand = z.infer<typeof TradeCommandSchema>;

export const QuickSlotNameSchema = z.enum(["healing", "grenade"]);
export type QuickSlotName = z.infer<typeof QuickSlotNameSchema>;

/** 当前补给可用时保留当前实物；耗尽后只查找同模板的实际随身备用包。 */
export function availableQuickSupply(
  state: Pick<InventoryState, "healing" | "grenade" | "backpack" | "objects">,
  slot: QuickSlotName,
): NonNullable<InventoryState[QuickSlotName]> | null {
  const held = state[slot];
  if (!held) return null;
  const object = state.objects[held.id];
  if (held.charges > 0 && (!object || object.holder === "player")) return held;
  const baseId = object?.baseId ?? held.id;
  for (const [id, count] of Object.entries(state.backpack)) {
    if (count < 1) continue;
    const candidate = state.objects[id];
    if ((candidate?.baseId ?? id) !== baseId) continue;
    if (candidate && candidate.holder !== "player") continue;
    const max = candidate?.definition.charges ?? held.max;
    const charges = candidate?.remaining ?? max;
    if (charges > 0) return { id, charges, max };
  }
  return null;
}

/** 只能由代码发出：其他系统消耗实际携带的补给、留置与车辆同步 */
export const InventoryInternalSchemas = {
  /** 资料系统：向真实空白载体写入固定内容，不新增物品或复制其他资产。 */
  "inventory.chipWrite": z.strictObject({
    type: z.literal("inventory.chipWrite"),
    destination: z.string().min(1),
    contentId: z.string().min(1),
    source: z.string().min(1).optional(),
    reason: z.string().min(1).max(240),
  }),
  "inventory.spend": z.object({ type: z.literal("inventory.spend"), slot: QuickSlotNameSchema }),
  /** 安全屋/留置系统发出：把随身物品（或现场物体）留在指定位置，或从该位置拿回随身 */
  "inventory.place": z.strictObject({
    type: z.literal("inventory.place"),
    action: z.enum(["leave", "take"]),
    item: z.string().min(1),
    count: z.number().int().min(1).default(1),
    source: z.enum(["backpack", "worn", "quick"]).optional(),
    kind: PlacedKindSchema,
    target: z.string().min(1),
    location: z.string().nullable(),
    note: z.string().min(1).max(120).optional(),
    reason: z.string().min(1).optional(),
    definition: ItemDefSchema.optional(),
    origin: z.string().min(1).max(240).optional(),
  }),
  /** 车辆系统发出：随车留置的物品和独立物件随车更新所在地点 */
  "inventory.relocateVehicle": z.strictObject({
    type: z.literal("inventory.relocateVehicle"),
    vehicle: z.string().min(1),
    location: z.string().min(1),
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

/** 按武器类别、技术体系和显式覆盖推导允许安装的改装槽位列表 */
export function defaultWeaponSlots(
  def: Pick<ItemDef, "kind" | "category" | "weaponType" | "modSlots">,
): readonly ModSlot[] {
  if (def.kind !== "weapon" || def.category === undefined) return [];
  if (def.modSlots !== undefined) return [...def.modSlots];
  if (MELEE.has(def.category)) return ["plugin"];
  if (def.weaponType === "smart") return ["plugin"];
  if (def.weaponType === "tech") return ["scope", "plugin"];
  switch (def.category) {
    case "pistol":
    case "revolver":
    case "smg":
    case "assaultRifle":
    case "precisionRifle":
      return ["muzzle", "scope", "plugin"];
    case "shotgun":
    case "lmg":
    case "sniperRifle":
      return ["scope", "plugin"];
    case "blade":
    case "blunt":
      return ["plugin"];
  }
}

export type ModAttachCheck =
  | { readonly ok: true; readonly slot: ModSlot }
  | { readonly ok: false; readonly reason: string };

/** 唯一校验真源：判断改装件能否装入指定武器及实例当前状态 */
export function canAttachMod(
  weaponDef: Pick<ItemDef, "id" | "name" | "kind" | "category" | "weaponType" | "modSlots">,
  modDef: Pick<ItemDef, "id" | "name" | "kind" | "modSlot" | "modFits" | "modTypes">,
  weaponState?: Pick<WeaponInstanceState, "lockedSlots">,
  options?: { readonly ignoreLock?: boolean },
): ModAttachCheck {
  if (weaponDef.kind !== "weapon" || weaponDef.category === undefined) {
    return { ok: false, reason: `${weaponDef.name} 不是武器` };
  }
  if (modDef.kind !== "mod" || modDef.modSlot === undefined) {
    return { ok: false, reason: `${modDef.name} 不是改装件` };
  }
  const slot = modDef.modSlot;
  const allowedSlots = defaultWeaponSlots(weaponDef);
  if (!allowedSlots.includes(slot)) {
    if (MELEE.has(weaponDef.category)) {
      return {
        ok: false,
        reason: `${weaponDef.name} 是近战武器，没有${MOD_SLOT_LABELS[slot]}槽位`,
      };
    }
    if (weaponDef.weaponType === "tech" && slot === "muzzle") {
      return {
        ok: false,
        reason: `${weaponDef.name} 是技术电磁武器，不支持常规枪口消音器`,
      };
    }
    if (weaponDef.weaponType === "smart") {
      return {
        ok: false,
        reason: `${weaponDef.name} 是智能制导武器，没有${MOD_SLOT_LABELS[slot]}槽位`,
      };
    }
    return { ok: false, reason: `${weaponDef.name} 没有${MOD_SLOT_LABELS[slot]}槽位` };
  }
  if (!modDef.modFits?.includes(weaponDef.category)) {
    return {
      ok: false,
      reason: `${modDef.name} 装不到${WEAPON_CATEGORY_LABELS[weaponDef.category]}上`,
    };
  }
  if (
    modDef.modTypes !== undefined &&
    (weaponDef.weaponType === undefined || !modDef.modTypes.includes(weaponDef.weaponType))
  ) {
    return {
      ok: false,
      reason: `${modDef.name} 不兼容${weaponDef.weaponType ? WEAPON_TYPE_LABELS[weaponDef.weaponType] : "该"}武器体系`,
    };
  }
  if (!options?.ignoreLock && weaponState?.lockedSlots.includes(slot)) {
    return {
      ok: false,
      reason: `${weaponDef.name} 的${MOD_SLOT_LABELS[slot]}已锁定，需前往枪匠工坊改动`,
    };
  }
  return { ok: true, slot };
}

/** 是否属于沉重显眼的大件装备（长枪、重武器、大号砍刀/战斧/长钝器） */
export function isBulkyItem(
  def: Pick<ItemDef, "id" | "kind" | "category"> | undefined,
  baseId?: string,
): boolean {
  if (def?.kind !== "weapon") return false;
  const c = weaponConcealment(def.category, baseId ?? def.id);
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

/** 随身背包内的物品数量映射 */
export function carriedItemCounts(state: Pick<InventoryState, "backpack">): Map<string, number> {
  const counts = new Map<string, number>();
  for (const [id, count] of Object.entries(state.backpack)) {
    if (count > 0) counts.set(id, count);
  }
  return counts;
}

/** 身上所有随身武器的去重 id 列表（含未改装模板 id 与已物化定制实例 id） */
export function carriedWeaponIds(
  state: Pick<InventoryState, "backpack">,
  catalog: ReadonlyMap<string, ItemDef>,
): string[] {
  const out: string[] = [];
  for (const id of carriedItemCounts(state).keys()) {
    if (catalog.get(id)?.kind === "weapon") {
      out.push(id);
    }
  }
  return out;
}

/** 持用引用只保留实际随身数量；物品离身后不会被下一轮继续使用。 */
export function carriedHeldWeaponIds(
  state: Pick<InventoryState, "backpack" | "objects" | "heldWeapons">,
  catalog: ReadonlyMap<string, ItemDef>,
): string[] | null {
  if (state.heldWeapons === null) return null;
  const used = new Map<string, number>();
  return state.heldWeapons.filter((id) => {
    const def = catalog.get(id) ?? state.objects[id]?.definition;
    const count = (used.get(id) ?? 0) + 1;
    if (def?.kind !== "weapon" || count > (state.backpack[id] ?? 0)) return false;
    if (state.objects[id] && state.objects[id]?.holder !== "player") return false;
    used.set(id, count);
    return true;
  });
}

/** 普通持握条件：长枪与大号近战武器占双手；具体伤势仍由当前物理约束裁定。 */
export function weaponHands(def: ItemDef, baseId = def.id): 1 | 2 {
  if (def.kind !== "weapon") return 1;
  if (def.category === "pistol" || def.category === "revolver") return 1;
  if (def.category === "blade" || def.category === "blunt") {
    return isBulkyItem(def, baseId) ? 2 : 1;
  }
  return 2;
}

/** 用固定粗单位描述体积与负担；不把证件、信物和普通穿着逐件称重。 */
export function itemCarryUnits(def: ItemDef, baseId = def.id): number {
  if (def.kind !== "weapon") return def.carryUnits ?? 0;
  if (isBulkyItem(def, baseId)) return 4;
  return (def.category === "blade" || def.category === "blunt") &&
    weaponConcealment(def.category, baseId) === "pocket"
    ? 1
    : 2;
}

const CONCEALMENT_ORDER: readonly WeaponConcealment[] = ["pocket", "coat", "open", "heavy"];
const CONCEALMENT_RANK: Readonly<Record<WeaponConcealment, number>> = {
  pocket: 0,
  coat: 1,
  open: 2,
  heavy: 3,
};

/** 计算考虑改装件体积修正后的有效隐蔽度 */
export function effectiveConcealment(
  def: Pick<ItemDef, "id" | "kind" | "category" | "concealmentShift">,
  weaponState: Pick<WeaponInstanceState, "baseId" | "mods"> | undefined,
  catalog: ReadonlyMap<string, Pick<ItemDef, "id" | "concealmentShift">>,
): WeaponConcealment {
  const base = weaponConcealment(def.category, weaponState?.baseId ?? def.id);
  if (def.kind !== "weapon") return base;
  let shift = def.concealmentShift ?? 0;
  if (weaponState) {
    for (const [slot, modId] of Object.entries(weaponState.mods)) {
      if (!modId) continue;
      const modDef = catalog.get(modId);
      const modShift =
        modDef?.concealmentShift ??
        (slot === "muzzle" || modId === "saika-scope" || modId === "gaki-scope" ? 1 : 0);
      shift += modShift;
    }
  }
  const baseRank = CONCEALMENT_RANK[base];
  const maxRank = base === "heavy" ? 3 : 2;
  const rank = Math.max(0, Math.min(maxRank, baseRank + shift));
  return CONCEALMENT_ORDER[rank] ?? base;
}

/** 计算武器当前声学特征：近战与装配消音枪口改装件的兼容武器为 silent，其余枪械为 loud */
export function effectiveWeaponNoise(
  def: Pick<ItemDef, "kind" | "category">,
  weaponState: Pick<WeaponInstanceState, "mods"> | undefined,
  catalog: ReadonlyMap<string, Pick<ItemDef, "modSlot">>,
): WeaponNoise {
  if (def.kind !== "weapon" || def.category === undefined) return "loud";
  if (MELEE.has(def.category)) return "silent";
  const muzzleId = weaponState?.mods.muzzle;
  if (muzzleId !== undefined && catalog.get(muzzleId)?.modSlot === "muzzle") {
    return "silent";
  }
  return "loud";
}

/** 判断武器自身或已装改装件/枪匠联锁改造是否自带智能靶向联锁能力 */
export function weaponGrantsSmartLink(
  def: Pick<ItemDef, "grantsSmartLink">,
  weaponState: Pick<WeaponInstanceState, "mods" | "smartLink"> | undefined,
  catalog: ReadonlyMap<string, Pick<ItemDef, "grantsSmartLink">>,
): boolean {
  if (def.grantsSmartLink || weaponState?.smartLink) return true;
  if (!weaponState) return false;
  for (const modId of Object.values(weaponState.mods)) {
    if (modId && catalog.get(modId)?.grantsSmartLink) return true;
  }
  return false;
}

/** 计算随身携带隐蔽度与大件软超重状态 */
export function loadoutSummary(
  state: Pick<InventoryState, "backpack" | "objects">,
  catalog: ReadonlyMap<string, ItemDef>,
  cyberware?: {
    readonly installed?: readonly { readonly id: string }[];
    readonly brokenChrome?: readonly string[];
  },
) {
  let bulkyCount = 0;
  const bulkyItems: string[] = [];
  let hasHeavy = false;
  let profile: WeaponConcealment = "pocket";
  let carryUnits = 0;
  const carryItems: string[] = [];
  for (const [weaponId, count] of carriedItemCounts(state)) {
    const obj = state.objects[weaponId];
    const def = obj?.definition ?? catalog.get(weaponId);
    if (!def) continue;
    const units = itemCarryUnits(def, obj?.weaponState?.baseId);
    carryUnits += units * count;
    if (units > 0) carryItems.push(count > 1 ? `${def.name}×${count}` : def.name);
    if (def.kind !== "weapon") continue;
    const conc = effectiveConcealment(def, obj?.weaponState, catalog);
    if (conc === "heavy") hasHeavy = true;
    if (CONCEALMENT_RANK[conc] > CONCEALMENT_RANK[profile]) {
      profile = conc;
    }
    if (isBulkyItem(def, obj?.weaponState?.baseId)) {
      bulkyCount += count;
      bulkyItems.push(count > 1 ? `${def.name}×${count}` : def.name);
    }
  }
  const bulkyMax = bulkyLimit(cyberware);
  const carryMax = bulkyMax * 4 + 2;
  const carryLevel =
    carryUnits > carryMax + 4
      ? ("overloaded" as const)
      : carryUnits > carryMax
        ? ("burdened" as const)
        : ("light" as const);
  return {
    bulkyCount,
    bulkyMax,
    bulkyOverloaded: bulkyCount > bulkyMax,
    bulkyItems,
    hasHeavyWeapon: hasHeavy,
    concealment: profile,
    carryUnits,
    carryMax,
    carryLevel,
    carryLabel:
      carryLevel === "overloaded" ? "严重超载" : carryLevel === "burdened" ? "有负担" : "轻装",
    carryItems,
  };
}
