import { z } from "zod";
import { type Command, defineAction } from "../../kernel/system";
import type { WorldState } from "../../kernel/world";
import { CharacterStateSchema } from "../character";
import { EconomyStateSchema } from "../economy";
import { HealthStateSchema } from "../health";
import { currentStock, itemCatalog, sellValue, shopList, shopShelf } from "./apply";
import { moodLock, moodPrice, shopMood } from "./mood";
import { InventoryStateSchema } from "./schema";

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
  shop: z.string().min(1).max(40),
  id: z.string().min(1).max(64),
});

/** 把背包里的一件卖给商店 */
export const SellItemActionSchema = z.strictObject({
  type: z.literal("sellItem"),
  shop: z.string().min(1).max(40),
  id: z.string().min(1).max(64),
});

type ShopAction = z.infer<typeof BuyItemActionSchema> | z.infer<typeof SellItemActionSchema>;

/** 商店的买卖：人要在店里；买的要在货架上、肯卖，卖的只收背包里的 */
function shopCommands(
  world: WorldState,
  action: ShopAction,
  data: Readonly<Record<string, unknown>>,
): Command[] | string {
  const shop = shopList(data).find((s) => s.id === action.shop);
  if (!shop) return `没有叫 ${action.shop} 的商店`;
  const here = (world.slices.world as { location?: unknown } | undefined)?.location;
  if (here !== shop.location) return `不在${shop.name}，先去那里`;
  const catalog = itemCatalog(data);
  if (action.type === "sellItem") {
    const def = catalog.get(action.id);
    if (!def) return `物品表里没有 ${action.id}`;
    const inventory = InventoryStateSchema.parse(world.slices.inventory);
    const carried =
      (inventory.backpack[def.id] ?? 0) + inventory.weapons.filter((w) => w === def.id).length;
    if (carried < 1) return `背包里没有${def.name}；穿着的衣服或快捷栏里的药/雷先脱下`;
    const lastOne = carried === 1 && Object.values(inventory.mods[def.id] ?? {}).length > 0;
    if (lastOne) {
      return `${def.name}上还装着改装件，先拆下来再卖`;
    }
    const value = sellValue(def);
    if (value <= 0)
      return def.iconic ? `${def.name}是不朽物品，不卖` : `${shop.name}不收${def.name}`;
    return [
      { type: "item", action: "lose", id: def.id, reason: `卖给${shop.name}` },
      { type: "money", delta: value, reason: `${shop.name}收购${def.name}` },
    ];
  }
  const streetCred = CharacterStateSchema.parse(world.slices.character).streetCred;
  const held = InventoryStateSchema.parse(world.slices.inventory);
  const stock = currentStock(held.shopStock[shop.id], world.time);
  const item = shopShelf(shop, catalog, streetCred, stock).find((i) => i.def.id === action.id);
  if (!item) return `${shop.name}的货架上没有这件`;
  // 势力态度影响店价（用户 2026-10-31 选的「势力进机制」）：和货架上显示的一样算
  const mood = shopMood(world, data, shop);
  const locked = moodLock(mood) ?? item.locked;
  if (locked) return `${shop.name}不卖${item.def.name}：${locked}`;
  const price = moodPrice(item.price, mood);
  const eddies = EconomyStateSchema.parse(world.slices.economy).eddies;
  if (price > eddies) return `欧元不够：${item.def.name}要 ${price}，身上只有 ${eddies}`;
  return [
    { type: "money", delta: -price, reason: `在${shop.name}买${item.def.name}` },
    { type: "item", action: "gain", id: item.def.id, reason: `在${shop.name}买下` },
    { type: "inventory.sold", shop: shop.id, item: item.def.id, at: world.time },
  ];
}

function inCombat(world: WorldState): boolean {
  return Boolean((world.slices.combat as { active?: unknown } | undefined)?.active);
}

/** 装备栏、工作台和商店的操作：只翻成指令，统一由操作入口结算 */
export const inventoryActions = {
  useHealing: defineAction({
    schema: UseHealingActionSchema,
    commands: (action, { world, data }) => {
      if (inCombat(world)) return "战斗中治疗要花一个动作，在行动里使用";
      const def = itemCatalog(data).get(action.id);
      if (def?.kind !== "healing") return "这件物品不是治疗品";
      const inventory = InventoryStateSchema.parse(world.slices.inventory);
      const held = inventory.healing;
      const current = held?.id === action.id;
      if (!current && (inventory.backpack[action.id] ?? 0) < 1) {
        return "背包里没有这件治疗品";
      }
      const charges = current ? held.charges : (inventory.depleted[action.id] ?? def.charges ?? 1);
      if (charges < 1) return "次数用完了，休整或场景结束后恢复";
      const health = HealthStateSchema.parse(world.slices.health);
      if (health.condition !== "up") return "当前无法自行治疗，需要别人救治";
      const ceiling =
        health.hp * 100 < health.max * 30 ? Math.floor(health.max * 0.29) : health.max;
      if (health.hp >= ceiling) return "已达到当前治疗上限，不消耗次数";
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
