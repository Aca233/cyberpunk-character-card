import { z } from "zod";
import { type Command, defineAction } from "../../kernel/system";
import type { WorldState } from "../../kernel/world";
import { HealthStateSchema } from "../health";
import { itemCatalog } from "./apply";
import { InventoryStateSchema } from "./schema";
import { quoteTrade } from "./trade";

/** 从背包装上一件：治疗品和手雷进快捷栏，服装穿到对应的格子；武器进背包即可直接使用 */
export const EquipItemActionSchema = z.strictObject({
  type: z.literal("equipItem"),
  id: z.string().min(1).max(64),
});

/** 非战斗时直接使用治疗品；投掷和其他情境性使用仍走行动回合。 */
export const UseHealingActionSchema = z.strictObject({
  type: z.literal("useHealing"),
  id: z.string().min(1).max(64),
});

/** 把穿着的服装脱下放回背包 */
export const UnequipItemActionSchema = z.strictObject({
  type: z.literal("unequipItem"),
  id: z.string().min(1).max(64),
});

/** 整套外观：save 存下身上穿着的，wear 照存下的一次换好 */
export const OutfitActionSchema = z.strictObject({
  type: z.literal("outfit"),
  action: z.enum(["save", "wear"]),
});

/** 改装件：attach 从背包装到武器上，detach 拆下放回背包 */
export const ModWeaponActionSchema = z.strictObject({
  type: z.literal("modWeapon"),
  action: z.enum(["attach", "detach"]),
  weapon: z.string().min(1).max(64),
  mod: z.string().min(1).max(64),
});

/** 在商店买一件，放进背包 */
export const BuyItemActionSchema = z.strictObject({
  type: z.literal("buyItem"),
  shop: z.string().min(1).max(80),
  id: z.string().min(1).max(64),
});

/** 把背包里的一件卖给商店 */
export const SellItemActionSchema = z.strictObject({
  type: z.literal("sellItem"),
  shop: z.string().min(1).max(80),
  id: z.string().min(1).max(64),
});

type ShopAction = z.infer<typeof BuyItemActionSchema> | z.infer<typeof SellItemActionSchema>;

/** 商店的买卖：人要在店里；买的要在货架上、肯卖，卖的只收背包里的 */
function shopCommands(
  world: WorldState,
  action: ShopAction,
  data: Readonly<Record<string, unknown>>,
): Command[] | string {
  const command = {
    type: "trade",
    action: action.type === "buyItem" ? "buy" : "sell",
    item: action.id,
    with: action.shop,
    reason: "通过商店面板完成交易",
  } as const;
  const quote = quoteTrade(world, data, command);
  return quote.ok ? [command] : quote.reason;
}

function inCombat(world: WorldState): boolean {
  return Boolean((world.slices.combat as { active?: unknown } | undefined)?.active);
}

/** 装备栏、工作台和商店的操作：只翻成指令，统一由操作入口结算 */
export const inventoryActions = {
  useHealing: defineAction({
    schema: UseHealingActionSchema,
    commands: (action, { world, data }) => {
      if (inCombat(world)) return "交战中治疗需要结合掩护和当前处境，请在行动里描述";
      const def = itemCatalog(data).get(action.id);
      if (def?.kind !== "healing") return "这件物品不是治疗品";
      const inventory = InventoryStateSchema.parse(world.slices.inventory);
      const held = inventory.healing;
      const current = held?.id === action.id;
      if (!current && (inventory.backpack[action.id] ?? 0) < 1) {
        return "背包里没有这件治疗品";
      }
      const charges = current ? held.charges : (inventory.depleted[action.id] ?? def.charges ?? 1);
      if (charges < 1 && (inventory.backpack[action.id] ?? 0) < (current ? 1 : 2))
        return "这份补给已经耗尽，需要实际取得补充品";
      const health = HealthStateSchema.parse(world.slices.health);
      if (health.condition !== "up") return "当前无法自行治疗，需要别人救治";
      if (health.injuries.length === 0 || health.painSuppressed)
        return "当前不需要再次使用急救药剂";
      const commands: Command[] = [];
      if (!current) {
        commands.push({
          type: "item",
          action: "equip",
          id: action.id,
          reason: "使用背包里的治疗品",
        });
      }
      commands.push({ type: "heal", source: "maxdoc" });
      return commands;
    },
  }),
  // 战斗里换装备要花一个动作，只能在行动里说
  equipItem: defineAction({
    schema: EquipItemActionSchema,
    commands: (action, { world, data }) => {
      if (inCombat(world)) return "战斗中换装备要花一个动作，在行动里写";
      const def = itemCatalog(data).get(action.id);
      if (def?.kind === "weapon") return "武器放进背包即可直接使用，无需装武器槽";
      return [
        {
          type: "item",
          action: "equip",
          id: action.id,
          reason: "在装备栏里换",
        },
      ];
    },
  }),
  unequipItem: defineAction({
    schema: UnequipItemActionSchema,
    commands: (action, { world, data }) => {
      if (inCombat(world)) return "战斗中换装备要花一个动作，在行动里写";
      const def = itemCatalog(data).get(action.id);
      if (def?.kind === "weapon") return "武器已在随身背包里，无需单独收起";
      return [{ type: "item", action: "unequip", id: action.id, reason: "在装备栏里换" }];
    },
  }),
  outfit: defineAction({
    schema: OutfitActionSchema,
    commands: (action, { world }) => {
      if (inCombat(world)) return "战斗中换装备要花一个动作，在行动里写";
      return [{ type: "inventory.outfit", action: action.action }];
    },
  }),
  modWeapon: defineAction({
    schema: ModWeaponActionSchema,
    commands: (action, { world }) => {
      if (inCombat(world)) return "战斗中来不及改装武器";
      return [
        { type: "inventory.mod", action: action.action, weapon: action.weapon, mod: action.mod },
      ];
    },
  }),
  buyItem: defineAction({
    schema: BuyItemActionSchema,
    commands: (action, { world, data }) => shopCommands(world, action, data),
  }),
  sellItem: defineAction({
    schema: SellItemActionSchema,
    commands: (action, { world, data }) => shopCommands(world, action, data),
  }),
};
