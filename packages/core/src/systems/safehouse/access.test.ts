import { describe, expect, it } from "vitest";
import { newGameWorld } from "../../game";
import { fixedRng } from "../../kernel/rng";
import type { WorldState } from "../../kernel/world";
import { InventoryStateSchema } from "../inventory";
import { registry } from "../registry";
import { TravelStateSchema } from "../travel";
import { WorldClockStateSchema } from "../world";

const locations = [
  { id: "a", name: "甲地", district: "沃森", x: 10, y: 10 },
  { id: "b", name: "乙地", district: "沃森", x: 20, y: 10 },
];
const extraItems = Array.from({ length: 5 }, (_, i) => ({
  id: `token-${i}`,
  name: `铜牌 ${i}`,
  kind: "misc" as const,
  iconic: false,
}));
const data = {
  locations,
  items: [
    { id: "token", name: "铜牌", kind: "misc", iconic: false },
    { id: "coat", name: "皮夹克", kind: "clothing", clothingSlot: "outer", iconic: false },
    ...extraItems,
  ],
  vehicles: [{ id: "test-car", name: "测试车", class: "economy", speed: 3, seats: 4, price: 1000 }],
};
const context = () => ({ data, rng: fixedRng([]) });
const vehicleId = "test-car-1";

function setup(stored: boolean): WorldState {
  const initial = newGameWorld({ startTime: 1000, startLocation: "a" }, { locations });
  const result = registry.applyCommands(
    initial,
    [
      { type: "vehicle.grant", model: "test-car", reason: "测试" },
      { type: "item", action: "gain", id: "token", reason: "随身物品" },
      ...(stored
        ? [
            {
              type: "itemPlace",
              action: "leave",
              item: "token",
              where: vehicleId,
              reason: "放进车里",
            },
          ]
        : []),
    ],
    context(),
  );
  expect(result.results.every((entry) => entry.result.ok)).toBe(true);
  return result.world;
}

function locate(world: WorldState, player: string | null, vehicle: string | null): WorldState {
  const travel = TravelStateSchema.parse(world.slices.travel);
  return {
    ...world,
    slices: {
      ...world.slices,
      world: { ...WorldClockStateSchema.parse(world.slices.world), location: player },
      travel: {
        ...travel,
        vehicles: travel.vehicles.map((v) => ({ ...v, location: vehicle })),
      },
    },
  };
}

it("同一回合可以把多件物品留进现场车辆，并支持穿戴物品自动脱下留下", () => {
  const before = setup(false);
  const commands = [
    ...extraItems.map(({ id }) => ({
      type: "item" as const,
      action: "gain" as const,
      id,
      reason: "带在身上",
    })),
    ...extraItems.map(({ id }) => ({
      type: "itemPlace" as const,
      action: "leave" as const,
      item: id,
      where: vehicleId,
      reason: "放进车里",
    })),
    { type: "item" as const, action: "gain" as const, id: "coat", reason: "穿上外套" },
    { type: "item" as const, action: "equip" as const, id: "coat", reason: "穿在身上" },
    {
      type: "itemPlace" as const,
      action: "leave" as const,
      item: "coat",
      where: vehicleId,
      reason: "顺手把外套留在车里",
    },
  ];
  const result = registry.applyCommands(before, commands, context());

  expect(result.results.every((entry) => entry.result.ok)).toBe(true);
  const inv = InventoryStateSchema.parse(result.world.slices.inventory);
  expect(inv.clothing.outer).toBeUndefined();
  expect(inv.placed.filter((p) => p.kind === "vehicle" && p.target === vehicleId)).toHaveLength(6);
});

it("回家拿枪换衣再出门可在同一回合内完成", () => {
  const initial = newGameWorld({ startTime: 1000, startLocation: "b" }, { locations });
  const seeded = registry.applyCommands(
    initial,
    [
      { type: "safehouse.seed", id: "home-a", name: "甲地出租屋", location: "a" },
      { type: "item", action: "gain", id: "token", reason: "初始" },
      { type: "itemPlace", action: "leave", item: "token", where: "home-a", reason: "留在家里" },
    ],
    context(),
  ).world;
  const moved = registry.applyCommands(
    seeded,
    [
      { type: "world", activity: "回家拿东西再回乙地", location: "b" },
      { type: "itemPlace", action: "take", item: "token", where: "home-a", reason: "回家拿上" },
    ],
    { ...context(), facts: { actionStartLocation: "b" } },
  );
  expect(moved.results.every((r) => r.result.ok)).toBe(true);
  expect(InventoryStateSchema.parse(moved.world.slices.inventory).backpack.token).toBe(1);
});

describe("未移动且位置不符时不能隔空从车里取放", () => {
  for (const action of ["leave", "take"] as const) {
    it.each([
      { label: "双方位置未知", player: null, vehicle: null },
      { label: "玩家位置未知", player: null, vehicle: "a" },
      { label: "车辆位置未知", player: "a", vehicle: null },
    ])(`$label 时不能 ${action}`, ({ player, vehicle }) => {
      const before = locate(setup(action === "take"), player, vehicle);
      const snapshot = JSON.stringify(before);
      const narrative = registry.applyCommands(
        before,
        [{ type: "itemPlace", action, item: "token", where: vehicleId, reason: "尝试留置或取回" }],
        context(),
      );
      expect(narrative.results[0]?.result.ok).toBe(false);
      expect(narrative.world).toBe(before);
      expect(narrative.patches).toEqual([]);
      expect(JSON.stringify(before)).toBe(snapshot);
    });
  }
});
