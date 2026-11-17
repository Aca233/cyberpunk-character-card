import { describe, expect, it } from "vitest";
import { newGameWorld } from "../../game";
import { fixedRng } from "../../kernel/rng";
import type { Command } from "../../kernel/system";
import type { WorldState } from "../../kernel/world";
import { InventoryStateSchema } from "../inventory";
import { registry } from "../registry";
import { WorldClockStateSchema } from "../world";
import { routeOptions, tripWorldOf } from "./apply";
import { TravelStateSchema } from "./schema";

const locations = [
  { id: "a", name: "甲地", district: "沃森", x: 10, y: 10, metro: true },
  { id: "b", name: "乙地", district: "沃森", x: 20, y: 10, metro: true },
  { id: "c", name: "丙地", district: "沃森", x: 30, y: 10, metro: true },
];

const context = {
  rng: fixedRng([]),
  data: {
    locations,
    items: [{ id: "keepsake", name: "旧车里的纪念品", kind: "misc", iconic: false }],
    vehicles: [
      {
        id: "test-car",
        name: "测试车",
        class: "economy",
        speed: 3,
        seats: 4,
        trunk: 4,
        price: 1000,
      },
    ],
  },
};

function start(location = "a"): WorldState {
  return newGameWorld({ startTime: 1000, startLocation: location }, { locations });
}

function run(world: WorldState, command: Command): WorldState {
  const result = registry.applyCommands(world, [command], context);
  expect(result.results[0]?.result, JSON.stringify(result.results[0]?.result)).toMatchObject({
    ok: true,
  });
  return result.world;
}

function travel(
  world: WorldState,
  to: string,
  mode: "walk" | "car" | "taxi" | "metro",
): WorldState {
  const result = registry.applyCommands(world, [{ type: "travel", to, mode }], {
    ...context,
    facts: { travel: { to, mode, encounter: null } },
  });
  expect(result.results[0]?.result).toMatchObject({ ok: true });
  return result.world;
}

function carId(world: WorldState): string {
  const vehicle = TravelStateSchema.parse(world.slices.travel).vehicles[0];
  if (!vehicle) throw new Error("车辆未创建");
  return vehicle.id;
}

describe("车辆位置与使用", () => {
  it.each(["taxi", "metro"] as const)("乘坐 %s 不会把停放的车辆带走", (mode) => {
    let world = run(start(), { type: "vehicle.grant", model: "test-car", reason: "测试" });
    world = run(world, { type: "money", delta: 1000, reason: "测试路费" });
    world = travel(world, "b", mode);
    expect(WorldClockStateSchema.parse(world.slices.world).location).toBe("b");
    expect(TravelStateSchema.parse(world.slices.travel).vehicles[0]?.location).toBe("a");
  });

  it("驾车后车辆随行；步行后车辆留在原地且不能远程驾驶或访问后备箱", () => {
    let world = run(start(), { type: "vehicle.grant", model: "test-car", reason: "测试" });
    const id = carId(world);
    world = run(world, { type: "item", action: "gain", id: "keepsake", reason: "测试物品" });
    world = run(world, {
      type: "stash",
      action: "store",
      item: "keepsake",
      where: id,
      reason: "放进后备箱",
    });

    world = travel(world, "b", "car");
    expect(TravelStateSchema.parse(world.slices.travel).vehicles[0]).toMatchObject({
      id,
      location: "b",
      cargo: { keepsake: 1 },
    });
    world = travel(world, "c", "walk");
    expect(WorldClockStateSchema.parse(world.slices.world).location).toBe("c");
    expect(TravelStateSchema.parse(world.slices.travel).vehicles[0]?.location).toBe("b");
    expect(
      routeOptions(tripWorldOf(world), context.data, "a").find((route) => route.mode === "car")
        ?.blocked,
    ).toContain("没有选中停在当前位置");

    const remoteTrunk = registry.applyCommands(
      world,
      [{ type: "stash", action: "take", item: "keepsake", where: id, reason: "取出" }],
      context,
    );
    expect(remoteTrunk.results[0]?.result.ok).toBe(false);
    expect(InventoryStateSchema.parse(remoteTrunk.world.slices.inventory).backpack).toEqual({});
  });

  it("必须在身边选车；选中的车跟随驾驶", () => {
    let world = run(start(), { type: "vehicle.grant", model: "test-car", reason: "第一辆车" });
    const firstId = carId(world);
    world = travel(world, "b", "walk");
    world = run(world, { type: "vehicle.grant", model: "test-car", reason: "第二辆车" });
    const travelState = TravelStateSchema.parse(world.slices.travel);
    const secondId = travelState.vehicles[1]?.id;
    expect(secondId).toBeDefined();
    expect(travelState.activeVehicleId).toBe(firstId);

    const farSelection = registry.applyCommands(
      world,
      [{ type: "vehicle", action: "select", vehicle: firstId, reason: "选择远处车辆" }],
      context,
    );
    expect(farSelection.results[0]?.result).toMatchObject({
      ok: false,
      reason: expect.stringContaining("不在身边"),
    });

    world = run(world, {
      type: "vehicle",
      action: "select",
      vehicle: secondId,
      reason: "换成停在这里的车",
    });
    world = travel(world, "c", "car");
    expect(TravelStateSchema.parse(world.slices.travel).vehicles).toMatchObject([
      { id: firstId, location: "a" },
      { id: secondId, location: "c" },
    ]);
  });
});

describe("车辆后备箱", () => {
  it("有货物时不能弃车；取空后才能弃车，同款新车不继承旧货物", () => {
    let world = run(start(), { type: "vehicle.grant", model: "test-car", reason: "原车" });
    const oldId = carId(world);
    world = run(world, { type: "item", action: "gain", id: "keepsake", reason: "随身物品" });
    world = run(world, {
      type: "stash",
      action: "store",
      item: "keepsake",
      where: oldId,
      reason: "放入旧车",
    });

    const blocked = registry.applyCommands(
      world,
      [{ type: "vehicle", action: "abandon", vehicle: oldId, reason: "弃车" }],
      context,
    );
    expect(blocked.results[0]?.result.ok).toBe(false);
    expect(blocked.world).toEqual(world);

    world = run(world, {
      type: "stash",
      action: "take",
      item: "keepsake",
      where: oldId,
      reason: "取回",
    });
    expect(TravelStateSchema.parse(world.slices.travel).vehicles[0]?.cargo).toEqual({});
    expect(InventoryStateSchema.parse(world.slices.inventory).backpack.keepsake).toBe(1);
    world = run(world, { type: "vehicle", action: "abandon", vehicle: oldId, reason: "弃车" });
    world = run(world, { type: "vehicle.grant", model: "test-car", reason: "同款新车" });
    const newId = carId(world);
    expect(newId).not.toBe(oldId);

    const take = registry.applyCommands(
      world,
      [{ type: "stash", action: "take", item: "keepsake", where: newId, reason: "查看新车" }],
      context,
    );
    expect(take.results[0]?.result.ok).toBe(false);
    expect(InventoryStateSchema.parse(take.world.slices.inventory).backpack.keepsake).toBe(1);
  });

  it("报废车只能在现场取物，不能继续存入", () => {
    let world = run(start(), { type: "vehicle.grant", model: "test-car", reason: "测试" });
    const id = carId(world);
    world = run(world, { type: "item", action: "gain", id: "keepsake", reason: "测试物品" });
    world = run(world, {
      type: "stash",
      action: "store",
      item: "keepsake",
      where: id,
      reason: "放入后备箱",
    });
    world = run(world, { type: "vehicle", action: "wreck", vehicle: id, reason: "事故" });

    const selection = registry.applyCommands(
      world,
      [{ type: "vehicle", action: "select", vehicle: id, reason: "选择报废车" }],
      context,
    );
    expect(selection.results[0]?.result).toMatchObject({
      ok: false,
      reason: expect.stringContaining("已经报废"),
    });

    const store = registry.applyCommands(
      world,
      [{ type: "stash", action: "store", item: "keepsake", where: id, reason: "再存入" }],
      context,
    );
    expect(store.results[0]?.result.ok).toBe(false);
    world = run(world, {
      type: "stash",
      action: "take",
      item: "keepsake",
      where: id,
      reason: "事故后取出",
    });
    expect(InventoryStateSchema.parse(world.slices.inventory).backpack.keepsake).toBe(1);
    expect(TravelStateSchema.parse(world.slices.travel).vehicles[0]?.cargo).toEqual({});
  });
});
