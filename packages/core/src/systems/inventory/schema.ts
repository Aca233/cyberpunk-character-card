import { z } from "zod";
import { type Attribute, AttributeSchema } from "../dice";
import { RaritySchema } from "../economy";

export const ItemKindSchema = z.enum([
  "weapon",
  "healing",
  "grenade",
  "consumable",
  "clothing",
  "misc",
]);
export type ItemKind = z.infer<typeof ItemKindSchema>;

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
    price: z.number().int().min(0).optional(),
    rarity: RaritySchema.optional(),
    /** 武器类别；武器必须写 */
    category: WeaponCategorySchema.optional(),
    /** 远程武器的类型；近战武器不写 */
    weaponType: WeaponTypeSchema.optional(),
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

export const QuickSlotNameSchema = z.enum(["healing", "grenade"]);
export type QuickSlotName = z.infer<typeof QuickSlotNameSchema>;

/** 只能由代码发出：其他系统扣快捷栏次数、休整后恢复次数 */
export const InventoryInternalSchemas = {
  "inventory.spend": z.object({ type: z.literal("inventory.spend"), slot: QuickSlotNameSchema }),
  "inventory.recharge": z.object({ type: z.literal("inventory.recharge") }),
};
export type InventoryInternal = z.infer<
  (typeof InventoryInternalSchemas)[keyof typeof InventoryInternalSchemas]
>;
