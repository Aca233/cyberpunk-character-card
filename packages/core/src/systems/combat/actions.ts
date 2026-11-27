import { z } from "zod";
import { type Command, defineAction } from "../../kernel/system";
import { HealthStateSchema } from "../health";
import { WorldClockStateSchema } from "../world";
import { CombatStateSchema } from "./schema";

/** 战后在当前地点拾取倒地/阵亡敌人身上的单件战利品 */
export const LootCombatItemActionSchema = z.strictObject({
  type: z.literal("lootCombatItem"),
  from: z.string().min(1).max(80),
  item: z.string().min(1).max(120),
});

/** 战后一键拾取当前地点指定目标或全部未拾取战利品 */
export const LootCombatAllActionSchema = z.strictObject({
  type: z.literal("lootCombatAll"),
  from: z.string().min(1).max(80).optional(),
});

export const combatActions = {
  lootCombatItem: defineAction({
    schema: LootCombatItemActionSchema,
    commands: (action, { world }) => {
      const combat = CombatStateSchema.parse(world.slices.combat);
      if (combat.active) return "交战中拾取战利品需要在行动里描述";
      const health = HealthStateSchema.parse(world.slices.health);
      if (health.condition !== "up") return "当前伤势过重，无法自行搜刮战利品";
      const here = WorldClockStateSchema.parse(world.slices.world).location;
      const entry = combat.groundLoot.find(
        (l) => l.from === action.from && l.location === here && l.items.includes(action.item),
      );
      if (!entry) return "这里已经找不到这件战利品了";
      return [{ type: "combat", action: "loot", target: entry.from, item: action.item }];
    },
  }),
  lootCombatAll: defineAction({
    schema: LootCombatAllActionSchema,
    commands: (action, { world }) => {
      const combat = CombatStateSchema.parse(world.slices.combat);
      if (combat.active) return "交战中拾取战利品需要在行动里描述";
      const health = HealthStateSchema.parse(world.slices.health);
      if (health.condition !== "up") return "当前伤势过重，无法自行搜刮战利品";
      const here = WorldClockStateSchema.parse(world.slices.world).location;
      const targets = combat.groundLoot.filter(
        (l) =>
          l.location === here &&
          l.items.length > 0 &&
          (action.from === undefined || l.from === action.from),
      );
      const commands: Command[] = targets.flatMap((entry) =>
        entry.items.map((item) => ({
          type: "combat",
          action: "loot",
          target: entry.from,
          item,
        })),
      );
      if (commands.length === 0) return "当前地点没有可拾取的战利品";
      return commands;
    },
  }),
};
