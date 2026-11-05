import { describe, expect, it } from "vitest";
import { applyPlayerAction } from "../../actions";
import { fixedRng } from "../../kernel/rng";
import { HealthStateSchema } from "../health";
import { registry } from "../registry";
import { InventoryStateSchema } from "./schema";

const data = {
  items: [
    {
      id: "maxdoc",
      name: "复面康",
      kind: "healing",
      charges: 3,
      healPercent: 30,
      iconic: false,
    },
  ],
};

function commands(hp: number, charges = 2, combat = false) {
  const base = registry.initialWorld(0);
  const world = {
    ...base,
    slices: {
      ...base.slices,
      health: { ...HealthStateSchema.parse(base.slices.health), hp, max: 100 },
      inventory: {
        ...InventoryStateSchema.parse(base.slices.inventory),
        healing: { id: "maxdoc", charges, max: 3 },
      },
      combat: { active: combat ? {} : null },
    },
  };
  return registry.actionCommands({ type: "useHealing", id: "maxdoc" }, { world, data });
}

describe("物品栏直接治疗", () => {
  it("非战斗时调用治疗结算", () => {
    expect(commands(50)).toEqual([{ type: "heal", source: "maxdoc" }]);
  });
  it("备用治疗品先装备再治疗，耗尽时不切换", () => {
    const base = registry.initialWorld(0);
    const inventory = {
      ...InventoryStateSchema.parse(base.slices.inventory),
      backpack: { maxdoc: 1 },
    };
    const world = {
      ...base,
      slices: {
        ...base.slices,
        health: { ...HealthStateSchema.parse(base.slices.health), hp: 50, max: 100 },
        inventory,
      },
    };
    const action = { type: "useHealing", id: "maxdoc" };
    expect(registry.actionCommands(action, { world, data })).toEqual([
      { type: "item", action: "equip", id: "maxdoc", reason: "使用背包里的治疗品" },
      { type: "heal", source: "maxdoc" },
    ]);
    expect(
      typeof registry.actionCommands(action, {
        world: {
          ...world,
          slices: {
            ...world.slices,
            inventory: { ...inventory, depleted: { maxdoc: 0 } },
          },
        },
        data,
      }),
    ).toBe("string");
  });
  it("备用治疗品实际回血并扣次，不修改输入世界", () => {
    const base = registry.initialWorld(0);
    const world = {
      ...base,
      slices: {
        ...base.slices,
        health: { ...HealthStateSchema.parse(base.slices.health), hp: 50, max: 100 },
        inventory: {
          ...InventoryStateSchema.parse(base.slices.inventory),
          backpack: { maxdoc: 1 },
          depleted: { maxdoc: 2 },
        },
      },
    };
    const before = JSON.parse(JSON.stringify(world));
    const result = applyPlayerAction(
      world,
      { type: "useHealing", id: "maxdoc" },
      { rng: fixedRng([]), data },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    expect(HealthStateSchema.parse(result.world.slices.health).hp).toBe(80);
    const inventory = InventoryStateSchema.parse(result.world.slices.inventory);
    expect(inventory.healing).toEqual({ id: "maxdoc", charges: 1, max: 3 });
    expect(inventory.backpack.maxdoc).toBeUndefined();
    expect(inventory.depleted.maxdoc).toBeUndefined();
    expect(world).toEqual(before);
  });
  it("满血或重伤上限时拒绝浪费次数", () => {
    expect(typeof commands(100)).toBe("string");
    expect(typeof commands(29)).toBe("string");
  });
  it("次数耗尽或战斗中拒绝直接治疗", () => {
    expect(typeof commands(50, 0)).toBe("string");
    expect(typeof commands(50, 2, true)).toBe("string");
  });
});
