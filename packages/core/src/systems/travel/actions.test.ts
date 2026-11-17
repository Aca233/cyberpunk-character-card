import { describe, expect, it } from "vitest";
import { applyPlayerAction, PlayerActionSchema } from "../../actions";
import { newGameWorld } from "../../game";
import { fixedRng } from "../../kernel/rng";
import { parseLog, replay, serializeRecord } from "../../kernel/turnlog";
import type { WorldState } from "../../kernel/world";
import { CombatStateSchema } from "../combat";
import { registry } from "../registry";
import { WorldClockStateSchema } from "../world";
import { type OwnedVehicle, TravelStateSchema } from "./schema";
import { activeVehicle } from "./vehicles";
import { travelView } from "./view";

const data = {
  locations: [
    { id: "a", name: "甲地", district: "沃森", x: 10, y: 10 },
    { id: "b", name: "乙地", district: "沃森", x: 20, y: 10 },
  ],
  items: [{ id: "keepsake", name: "纪念品", kind: "misc", iconic: false }],
  vehicles: [
    { id: "test-car", name: "测试车", class: "economy", speed: 3, seats: 4, trunk: 4, price: 1000 },
  ],
};
const context = () => ({ data, rng: fixedRng([]) });
const secondId = "test-car-2";
const action = { type: "selectVehicle" as const, id: secondId };

function setup(): WorldState {
  const world = newGameWorld(
    { startTime: 1000, startLocation: "a" },
    { locations: data.locations },
  );
  const result = registry.applyCommands(
    world,
    [
      { type: "vehicle.grant", model: "test-car", reason: "原车" },
      { type: "vehicle.grant", model: "test-car", reason: "备用车" },
      { type: "money", delta: 1000, reason: "随身现金" },
      { type: "item", action: "gain", id: "keepsake", reason: "随身纪念品" },
      { type: "stash", action: "store", item: "keepsake", where: secondId, reason: "放入备用车" },
    ],
    context(),
  );
  expect(result.results.every((entry) => entry.result.ok)).toBe(true);
  return result.world;
}

function updateCar(world: WorldState, change: Partial<OwnedVehicle>): WorldState {
  const travel = TravelStateSchema.parse(world.slices.travel);
  return {
    ...world,
    slices: {
      ...world.slices,
      travel: {
        ...travel,
        vehicles: travel.vehicles.map((vehicle) =>
          vehicle.id === secondId ? { ...vehicle, ...change } : vehicle,
        ),
      },
    },
  };
}

function at(world: WorldState, location: string | null): WorldState {
  return {
    ...world,
    slices: {
      ...world.slices,
      world: { ...WorldClockStateSchema.parse(world.slices.world), location },
    },
  };
}

describe("车辆页直接选用车辆", () => {
  it("切换到身边的另一辆车，只改选中身份，叙事和按钮共享结果", () => {
    const before = setup();
    const snapshot = JSON.stringify(before);
    const result = applyPlayerAction(before, PlayerActionSchema.parse(action), context());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    expect(result.world).toEqual({
      ...before,
      slices: {
        ...before.slices,
        travel: { ...TravelStateSchema.parse(before.slices.travel), activeVehicleId: secondId },
      },
    });
    const narrative = registry.applyCommands(
      before,
      [{ type: "vehicle", action: "select", vehicle: secondId, reason: "换车" }],
      context(),
    );
    expect(narrative.world).toEqual(result.world);
    expect(JSON.stringify(before)).toBe(snapshot);
    expect(travelView({ world: result.world, data, records: [] }).vehicles).toMatchObject([
      { id: "test-car-1", selected: false },
      { id: secondId, selected: true, here: true },
    ]);
  });

  it("同地点的受损车仍可选用，不把选择当成修车", () => {
    const before = updateCar(setup(), { condition: "damaged" });
    const result = applyPlayerAction(before, action, context());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    expect(TravelStateSchema.parse(result.world.slices.travel)).toMatchObject({
      activeVehicleId: secondId,
      vehicles: [{ condition: "intact" }, { condition: "damaged" }],
    });
    expect(result.world.time).toBe(before.time);
    expect(result.world.slices.economy).toEqual(before.slices.economy);
  });

  it.each([
    { label: "异地", vehicle: { location: "b" }, playerLocation: "a", reason: "不在身边" },
    {
      label: "报废",
      vehicle: { condition: "wrecked" as const },
      playerLocation: "a",
      reason: "报废",
    },
    { label: "车辆位置未知", vehicle: { location: null }, playerLocation: "a", reason: "未知" },
    { label: "双方位置未知", vehicle: { location: null }, playerLocation: null, reason: "未知" },
    { label: "玩家位置未知", vehicle: {}, playerLocation: null, reason: "未知" },
  ])(
    "$label 时按钮与叙事选车都拒绝，保留原选用车辆和货物",
    ({ vehicle, playerLocation, reason }) => {
      const before = at(updateCar(setup(), vehicle), playerLocation);
      const snapshot = JSON.stringify(before);
      const result = applyPlayerAction(before, action, context());
      expect(result).toMatchObject({ ok: false, reason: expect.stringContaining(reason) });
      const narrative = registry.applyCommands(
        before,
        [{ type: "vehicle", action: "select", vehicle: secondId, reason: "换车" }],
        context(),
      );
      expect(narrative.results[0]?.result).toMatchObject({
        ok: false,
        reason: expect.stringContaining(reason),
      });
      expect(narrative.world).toBe(before);
      expect(JSON.stringify(before)).toBe(snapshot);
    },
  );

  it("车辆和玩家位置都未知时不视为在身边，也不能作为当前可驾驶车辆", () => {
    const world = at(updateCar(setup(), { location: null }), null);
    const travel = TravelStateSchema.parse(world.slices.travel);
    expect(activeVehicle(travel.vehicles, secondId, null)).toBeUndefined();
    expect(
      travelView({ world, data, records: [] }).vehicles.find((v) => v.id === secondId)?.here,
    ).toBe(false);
  });

  it("战斗中不能通过车辆页直接换车", () => {
    const world = setup();
    const before: WorldState = {
      ...world,
      slices: {
        ...world.slices,
        combat: {
          ...CombatStateSchema.parse(world.slices.combat),
          active: { startedAt: 1000, district: "沃森", location: "a", foes: [] },
        },
      },
    };
    expect(applyPlayerAction(before, action, context())).toEqual({
      ok: false,
      reason: "战斗中换车需要结合当前处境，请在行动里描述",
    });
    expect(TravelStateSchema.parse(before.slices.travel).activeVehicleId).toBe("test-car-1");
  });

  it("不存在的车辆不能选用，请求不接受额外字段", () => {
    const before = setup();
    expect(applyPlayerAction(before, { ...action, id: "missing-car" }, context())).toMatchObject({
      ok: false,
      reason: expect.stringContaining("名下没有"),
    });
    expect(PlayerActionSchema.safeParse({ ...action, location: "b" }).success).toBe(false);
  });

  it("日志重放和 JSON 存档恢复后仍选用同一辆车，货物与停车地保留", () => {
    const before = setup();
    const result = applyPlayerAction(before, action, context());
    if (!result.ok) throw new Error(result.reason);
    const log = serializeRecord({
      kind: "action",
      seq: 0,
      at: "2026-11-17T00:00:00.000Z",
      requestId: "select-vehicle-test",
      action,
      commands: [...result.commands],
      notes: [...result.notes],
      patches: [...result.patches],
    });
    const restored: WorldState = JSON.parse(
      JSON.stringify(replay({ nextSeq: 0, world: before }, parseLog(log).records)),
    );
    expect(restored).toEqual(result.world);
    const travel = TravelStateSchema.parse(restored.slices.travel);
    expect(activeVehicle(travel.vehicles, travel.activeVehicleId, "a")).toMatchObject({
      id: secondId,
      location: "a",
      cargo: { keepsake: 1 },
    });
  });
});
