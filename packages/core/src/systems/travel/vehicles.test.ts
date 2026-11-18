import { describe, expect, it } from "vitest";
import { PlayerActionSchema } from "../../actions";
import { newGameWorld } from "../../game";
import { fixedRng } from "../../kernel/rng";
import type { Command } from "../../kernel/system";
import type { WorldState } from "../../kernel/world";
import { InventoryStateSchema } from "../inventory";
import { registry } from "../registry";
import { WorldClockStateSchema } from "../world";
import { routeOptions, tripWorldOf } from "./apply";
import { TravelStateSchema, VehicleCommandSchema } from "./schema";

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
  vehicle?: string,
): WorldState {
  const result = registry.applyCommands(
    world,
    [{ type: "travel", to, mode, ...(vehicle ? { vehicle } : {}) }],
    {
      ...context,
      facts: { travel: { to, mode, encounter: null, ...(vehicle ? { vehicle } : {}) } },
    },
  );
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

  it("驾车后车辆随行；步行后车辆留在原地且不能远程驾驶或取放", () => {
    let world = run(start(), { type: "vehicle.grant", model: "test-car", reason: "测试" });
    const id = carId(world);
    world = run(world, { type: "item", action: "gain", id: "keepsake", reason: "测试物品" });
    world = run(world, {
      type: "itemPlace",
      action: "leave",
      item: "keepsake",
      where: id,
      reason: "放进车里",
    });

    world = travel(world, "b", "car");
    expect(TravelStateSchema.parse(world.slices.travel).vehicles[0]).toMatchObject({
      id,
      location: "b",
    });
    expect(InventoryStateSchema.parse(world.slices.inventory).placed).toMatchObject([
      { item: "keepsake", kind: "vehicle", target: id, location: "b", count: 1 },
    ]);
    world = travel(world, "c", "walk");
    expect(WorldClockStateSchema.parse(world.slices.world).location).toBe("c");
    expect(TravelStateSchema.parse(world.slices.travel).vehicles[0]?.location).toBe("b");
    expect(
      routeOptions(tripWorldOf(world), context.data, "a").find((route) => route.mode === "car")
        ?.blocked,
    ).toContain("当前位置没有可驾驶车辆");

    const remoteTrunk = registry.applyCommands(
      world,
      [{ type: "itemPlace", action: "take", item: "keepsake", where: id, reason: "取出" }],
      context,
    );
    expect(remoteTrunk.results[0]?.result.ok).toBe(false);
    expect(InventoryStateSchema.parse(remoteTrunk.world.slices.inventory).backpack).toEqual({});
  });

  it("一辆车在场时自动驾驶；多辆时拒绝猜车，点名后只移动指定车辆", () => {
    let world = run(start(), { type: "vehicle.grant", model: "test-car", reason: "第一辆车" });
    const firstId = carId(world);
    world = travel(world, "b", "car");
    expect(TravelStateSchema.parse(world.slices.travel).trips.at(-1)?.vehicle).toBe(firstId);
    world = travel(world, "a", "car", firstId);
    world = run(world, { type: "vehicle.grant", model: "test-car", reason: "备用车" });
    const secondId = TravelStateSchema.parse(world.slices.travel).vehicles[1]?.id;
    expect(secondId).toBeDefined();
    const preview = routeOptions(tripWorldOf(world), context.data, "c").find(
      (route) => route.mode === "car",
    );
    expect(preview?.blocked).toContain("多辆可用车辆");
    const ambiguous = registry.applyCommands(
      world,
      [{ type: "travel", to: "c", mode: "car" }],
      context,
    );
    expect(ambiguous.results[0]?.result.ok).toBe(false);
    expect(TravelStateSchema.parse(ambiguous.world.slices.travel).vehicles).toMatchObject([
      { id: firstId, location: "a" },
      { id: secondId, location: "a" },
    ]);

    world = travel(world, "c", "car", secondId);
    expect(TravelStateSchema.parse(world.slices.travel).vehicles).toMatchObject([
      { id: firstId, location: "a" },
      { id: secondId, location: "c" },
    ]);
  });

  it.each([
    { label: "异地", remote: true, wrecked: false },
    { label: "报废", remote: false, wrecked: true },
  ])("点名的车辆处于$label状态时不改动任何车辆", ({ remote, wrecked }) => {
    let world = run(start(), { type: "vehicle.grant", model: "test-car", reason: "异地候选" });
    const remoteVehicleId = carId(world);
    world = run(world, { type: "vehicle.grant", model: "test-car", reason: "在场候选" });
    const present = TravelStateSchema.parse(world.slices.travel).vehicles[1]?.id;
    if (!present) throw new Error("第二辆车未创建");
    if (wrecked) {
      world = run(world, { type: "vehicle", action: "wreck", vehicle: present, reason: "报废" });
    }
    if (remote)
      world = {
        ...world,
        slices: {
          ...world.slices,
          travel: {
            ...TravelStateSchema.parse(world.slices.travel),
            vehicles: TravelStateSchema.parse(world.slices.travel).vehicles.map((v) =>
              v.id === remoteVehicleId ? { ...v, location: "b" } : v,
            ),
          },
        },
      };
    const before = world;
    const target = remote ? remoteVehicleId : present;
    const result = registry.applyCommands(
      world,
      [{ type: "travel", to: "c", mode: "car", vehicle: target }],
      context,
    );
    expect(result.results[0]?.result.ok).toBe(false);
    expect(result.world).toBe(before);
  });

  it("同一现场多辆车辆的维修、损坏、追逐和弃车都要求点名", () => {
    let world = run(start(), { type: "vehicle.grant", model: "test-car", reason: "第一辆" });
    world = run(world, { type: "vehicle", action: "damage", reason: "弄坏第一辆" });
    world = run(world, { type: "vehicle.grant", model: "test-car", reason: "第二辆" });
    world = run(world, {
      type: "vehicle",
      action: "damage",
      vehicle: "test-car-2",
      reason: "弄坏第二辆",
    });
    for (const action of ["repair", "damage", "chase", "abandon"] as const) {
      const result = registry.applyCommands(
        world,
        [
          {
            type: "vehicle",
            action,
            reason: "现场有多辆",
            ...(action === "chase" ? { stake: "damage" } : {}),
          },
        ],
        context,
      );
      expect(result.results[0]?.result).toMatchObject({
        ok: false,
        reason: expect.stringContaining("多辆候选车辆"),
      });
      expect(result.world).toBe(world);
    }
  });

  it("旧的强制选车接口已移除", () => {
    expect(
      VehicleCommandSchema.safeParse({
        type: "vehicle",
        action: "select",
        vehicle: "test-car-1",
        reason: "旧入口",
      }).success,
    ).toBe(false);
    expect(PlayerActionSchema.safeParse({ type: "selectVehicle", id: "test-car-1" }).success).toBe(
      false,
    );
  });

  it("车辆数量没有任意上限", () => {
    let world = start();
    for (let i = 0; i < 7; i++)
      world = run(world, { type: "vehicle.grant", model: "test-car", reason: `取得车辆 ${i + 1}` });
    expect(TravelStateSchema.parse(world.slices.travel).vehicles).toHaveLength(7);
  });
});

describe("车辆留置与弃车", () => {
  it("允许连车带物直接弃车，车和车内留置物品继续留在世界里（且不进新车）", () => {
    let world = run(start(), { type: "vehicle.grant", model: "test-car", reason: "原车" });
    const oldId = carId(world);
    world = run(world, { type: "item", action: "gain", id: "keepsake", reason: "随身物品" });
    world = run(world, {
      type: "itemPlace",
      action: "leave",
      item: "keepsake",
      where: oldId,
      reason: "放进旧车",
    });

    world = run(world, { type: "vehicle", action: "abandon", vehicle: oldId, reason: "甩掉热车" });
    expect(TravelStateSchema.parse(world.slices.travel).vehicles[0]?.abandoned).toBe(true);
    expect(InventoryStateSchema.parse(world.slices.inventory).placed).toMatchObject([
      { item: "keepsake", kind: "vehicle", target: oldId, location: "a", count: 1 },
    ]);

    world = run(world, { type: "vehicle.grant", model: "test-car", reason: "同款新车" });
    const newId = TravelStateSchema.parse(world.slices.travel).vehicles[1]?.id;
    expect(newId).toBeDefined();
    expect(newId).not.toBe(oldId);

    const take = registry.applyCommands(
      world,
      [{ type: "itemPlace", action: "take", item: "keepsake", where: newId, reason: "查看新车" }],
      context,
    );
    expect(take.results[0]?.result.ok).toBe(false);
    expect(
      InventoryStateSchema.parse(take.world.slices.inventory).backpack.keepsake,
    ).toBeUndefined();
  });

  it("报废车只能在现场取物，不能继续存入", () => {
    let world = run(start(), { type: "vehicle.grant", model: "test-car", reason: "测试" });
    const id = carId(world);
    world = run(world, { type: "item", action: "gain", id: "keepsake", reason: "测试物品" });
    world = run(world, {
      type: "itemPlace",
      action: "leave",
      item: "keepsake",
      where: id,
      reason: "放进车里",
    });
    world = run(world, { type: "vehicle", action: "wreck", vehicle: id, reason: "事故" });

    const store = registry.applyCommands(
      world,
      [
        {
          type: "itemPlace",
          action: "leave",
          item: "keepsake",
          where: id,
          reason: "再存入",
        },
      ],
      context,
    );
    expect(store.results[0]?.result.ok).toBe(false);
    world = run(world, {
      type: "itemPlace",
      action: "take",
      item: "keepsake",
      where: id,
      reason: "事故后取出",
    });
    expect(InventoryStateSchema.parse(world.slices.inventory).backpack.keepsake).toBe(1);
    expect(InventoryStateSchema.parse(world.slices.inventory).placed).toEqual([]);
  });
});
