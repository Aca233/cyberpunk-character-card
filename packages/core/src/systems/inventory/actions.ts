import { z } from "zod";
import { type Command, defineAction } from "../../kernel/system";
import type { WorldState } from "../../kernel/world";
import { HealthStateSchema } from "../health";
import { itemCatalog } from "./apply";
import { GunsmithActionSchema, type GunsmithCommand, quoteGunsmith } from "./gunsmith";
import { availableQuickSupply, InventoryStateSchema } from "./schema";
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

/** 改装件：attach 从背包装到武器上，detach 拆下放回背包 */
export const ModWeaponActionSchema = z.strictObject({
  type: z.literal("modWeapon"),
  action: z.enum(["attach", "detach"]),
  weapon: z.string().min(1).max(64),
  mod: z.string().min(1).max(64),
});

/** 穿搭方案：保存当前 6 格穿着、一键整套换装或删除方案 */
export const OutfitPresetActionSchema = z.strictObject({
  type: z.literal("outfitPreset"),
  action: z.enum(["save", "apply", "delete"]),
  id: z.string().min(1).max(40).optional(),
  name: z.string().min(1).max(20).optional(),
});

/** 非战斗使用急救绷带包（处理浅伤）或战地止血凝露（处理浅/轻伤） */
export const UseFieldAidActionSchema = z.strictObject({
  type: z.literal("useFieldAid"),
  id: z.enum(["med-kit", "hemostatic-gel"]),
});

/** 在商店买一件，放进背包；传 forNpc 时直接为身边同行搭档购入配装 */
export const BuyItemActionSchema = z.strictObject({
  type: z.literal("buyItem"),
  shop: z.string().min(1).max(80),
  id: z.string().min(1).max(64),
  forNpc: z.string().min(1).max(64).optional(),
});

/** 把背包里的一件卖给商店 */
export const SellItemActionSchema = z.strictObject({
  type: z.literal("sellItem"),
  shop: z.string().min(1).max(80),
  id: z.string().min(1).max(64),
});

type ShopAction = z.infer<typeof BuyItemActionSchema> | z.infer<typeof SellItemActionSchema>;

const CompanionGearProbeSchema = z
  .object({
    npcs: z
      .record(
        z.string(),
        z.object({
          id: z.string(),
          name: z.string(),
          alive: z.boolean().default(true),
          met: z.boolean().default(false),
          following: z.boolean().default(false),
          body: z
            .object({
              gear: z.array(z.string()).default([]),
            })
            .optional(),
        }),
      )
      .default({}),
  })
  .catch({ npcs: {} });

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
  if (!quote.ok) return quote.reason;

  if (action.type === "buyItem" && action.forNpc) {
    const npc = CompanionGearProbeSchema.parse(world.slices.npc ?? {}).npcs[action.forNpc];
    if (!npc?.met || !npc.alive) return "找不到这位在场的同伴";
    if (!npc.following) return `${npc.name}当前没有与你同行，先结伴同行再为其配装`;
    const gear = npc.body?.gear ?? [];
    if (gear.includes(action.id)) return `${npc.name}身上已经有这件装备了`;
    if (gear.length >= 12) return `${npc.name}的随身装备栏已满（最多 12 件）`;
    const out: Command[] = [];
    if (quote.price > 0) {
      out.push({
        type: "money",
        delta: -quote.price,
        reason: `在${quote.party.name}为同行同伴${npc.name}购入${quote.label}`,
      });
    }
    out.push({ type: "npcGear", id: npc.id, action: "add", item: action.id });
    return out;
  }

  return [command];
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
      const inventory = InventoryStateSchema.parse(world.slices.inventory);
      const def = inventory.objects[action.id]?.definition ?? itemCatalog(data).get(action.id);
      if (def?.kind !== "healing") return "这件物品不是治疗品";
      const held = inventory.healing;
      const current = held?.id === action.id;
      if (!current && (inventory.backpack[action.id] ?? 0) < 1) {
        return "背包里没有这件治疗品";
      }
      const available = current
        ? availableQuickSupply(inventory, "healing")
        : (inventory.objects[action.id]?.remaining ?? def.charges ?? 1) > 0;
      if (!available) return "这份补给已经耗尽，需要实际取得补充品";
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
  modWeapon: defineAction({
    schema: ModWeaponActionSchema,
    commands: (action, { world }) => {
      if (inCombat(world)) return "战斗中来不及改装武器";
      return [
        { type: "inventory.mod", action: action.action, weapon: action.weapon, mod: action.mod },
      ];
    },
  }),
  outfitPreset: defineAction({
    schema: OutfitPresetActionSchema,
    commands: (action, { world }) => {
      if (action.action === "apply" && inCombat(world)) {
        return "战斗中来不及整套换装，请在行动里描述";
      }
      return [
        {
          type: "inventory.outfit",
          action: action.action,
          ...(action.id ? { id: action.id } : {}),
          ...(action.name ? { name: action.name } : {}),
        },
      ];
    },
  }),
  useFieldAid: defineAction({
    schema: UseFieldAidActionSchema,
    commands: (action, { world }) => {
      if (inCombat(world)) return "交战中来不及自行包扎，请在行动里描述";
      const health = HealthStateSchema.parse(world.slices.health);
      if (health.condition !== "up") return "当前伤势过重，无法自行包扎";
      const inventory = InventoryStateSchema.parse(world.slices.inventory);
      if ((inventory.backpack[action.id] ?? 0) < 1) {
        return action.id === "med-kit" ? "背包里没有急救绷带包" : "背包里没有战地止血凝露";
      }
      const allowedTiers = action.id === "hemostatic-gel" ? ["graze", "heavy"] : ["graze"];
      const target = health.injuries.find((i) => !i.treated && allowedTiers.includes(i.tier));
      if (!target) {
        return action.id === "med-kit"
          ? "当前没有未处理的表皮擦伤（重创需用止血凝露应急或去诊所清创）"
          : "当前没有可自行封口的擦伤或重创（致命伤仍需找医生救治）";
      }
      return [
        {
          type: "item",
          action: "use",
          id: action.id,
          reason:
            action.id === "med-kit" ? "使用急救绷带包处理表皮伤口" : "使用战地止血凝露封口止血",
        },
        { type: "health.treat", id: target.id },
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
  gunsmith: defineAction({
    schema: GunsmithActionSchema,
    commands: (action, { world, data }) => {
      if (inCombat(world)) return "战斗中无法进行枪匠工坊改装";
      const command: GunsmithCommand = {
        ...action,
        reason: "通过枪匠工坊完成定制服务",
      };
      const quoted = quoteGunsmith(world, data, command);
      if (!quoted.ok) return quoted.reason;
      if (quoted.quote.blocked) return quoted.quote.blocked;
      return [command];
    },
  }),
};
