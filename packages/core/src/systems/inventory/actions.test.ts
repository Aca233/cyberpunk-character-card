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
const partialId = "supply:maxdoc:1";
const partialSupply = (remaining: number) => ({
  kind: "supply",
  definition: { ...data.items[0], id: partialId },
  baseId: "maxdoc",
  origin: "拆封后保留的补给",
  holder: remaining > 0 ? "player" : "consumed",
  location: null,
  changedAt: 0,
  lastChange: "使用补给",
  remaining,
});

const injury = {
  id: "inj1",
  part: "left-arm",
  tier: "heavy",
  cause: "玻璃划伤",
  at: 0,
  healsAt: null,
  treated: false,
  source: "injury",
};

function commands(hurt: boolean, charges = 2, combat = false, suppressed = false) {
  const base = registry.initialWorld(0);
  const world = {
    ...base,
    slices: {
      ...base.slices,
      health: {
        ...HealthStateSchema.parse(base.slices.health),
        injuries: hurt ? [injury] : [],
        painSuppressed: suppressed,
      },
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
    expect(commands(true)).toEqual([{ type: "heal", source: "maxdoc" }]);
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
        health: { ...HealthStateSchema.parse(base.slices.health), injuries: [injury] },
        inventory,
      },
    };
    const action = { type: "useHealing", id: "maxdoc" };
    expect(registry.actionCommands(action, { world, data })).toEqual([
      { type: "item", action: "equip", id: "maxdoc", reason: "使用背包里的治疗品" },
      { type: "heal", source: "maxdoc" },
    ]);
    expect(
      typeof registry.actionCommands(
        { ...action, id: partialId },
        {
          world: {
            ...world,
            slices: {
              ...world.slices,
              inventory: {
                ...inventory,
                backpack: { [partialId]: 1 },
                objects: { [partialId]: partialSupply(0) },
              },
            },
          },
          data,
        },
      ),
    ).toBe("string");
  });
  it("备用治疗品镇痛并消耗实物余量，不修改输入世界", () => {
    const base = registry.initialWorld(0);
    const world = {
      ...base,
      slices: {
        ...base.slices,
        health: { ...HealthStateSchema.parse(base.slices.health), injuries: [injury] },
        inventory: {
          ...InventoryStateSchema.parse(base.slices.inventory),
          backpack: { [partialId]: 1 },
          objects: { [partialId]: partialSupply(2) },
        },
      },
    };
    const before = JSON.parse(JSON.stringify(world));
    const result = applyPlayerAction(
      world,
      { type: "useHealing", id: partialId },
      { rng: fixedRng([]), data },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    expect(HealthStateSchema.parse(result.world.slices.health)).toMatchObject({
      painSuppressed: true,
      injuries: [injury],
    });
    const inventory = InventoryStateSchema.parse(result.world.slices.inventory);
    expect(inventory.healing).toEqual({ id: partialId, charges: 1, max: 3 });
    expect(inventory.backpack[partialId]).toBeUndefined();
    expect(inventory.objects[partialId]?.remaining).toBe(1);
    expect(world).toEqual(before);
  });
  it("无伤或已有镇痛效果时不重复消耗", () => {
    expect(typeof commands(false)).toBe("string");
    expect(typeof commands(true, 2, false, true)).toBe("string");
  });
  it("次数耗尽或战斗中拒绝直接治疗", () => {
    expect(typeof commands(true, 0)).toBe("string");
    expect(typeof commands(true, 2, true)).toBe("string");
  });
});
