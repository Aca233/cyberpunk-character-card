import { z } from "zod";
import { AttributeSchema } from "../dice";

export const ItemKindSchema = z.enum([
  "weapon",
  "healing",
  "grenade",
  "consumable",
  "clothing",
  "misc",
]);
export type ItemKind = z.infer<typeof ItemKindSchema>;

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
    /** 标志性物品：只能从剧情获得 */
    iconic: z.boolean().default(false),
    price: z.number().int().min(0).optional(),
  })
  .superRefine((item, ctx) => {
    const report = (message: string) =>
      ctx.addIssue({ code: "custom", message: `${item.id}：${message}` });
    if (item.kind === "weapon" && item.attribute === undefined) report("武器必须写明用哪项属性");
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
export const ItemCommandSchema = z.object({
  type: z.literal("item"),
  action: z.enum(["gain", "lose", "use", "equip", "unequip"]),
  id: z.string().min(1),
  reason: z.string().min(1),
  /** equip 武器时指定第几格（1–3） */
  slot: z.number().int().min(1).max(3).optional(),
});
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
