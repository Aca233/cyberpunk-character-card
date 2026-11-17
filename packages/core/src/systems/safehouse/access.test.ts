import { describe, expect, it } from "vitest";
import { applyPlayerAction } from "../../actions";
import { newGameWorld } from "../../game";
import { fixedRng } from "../../kernel/rng";
import type { WorldState } from "../../kernel/world";
import { registry } from "../registry";
import { TravelStateSchema } from "../travel";
import { WorldClockStateSchema } from "../world";
import { safehouseView } from "./view";

const locations = [{ id: "a", name: "甲地", district: "沃森", x: 10, y: 10 }];
const data = {
  locations,
  items: [{ id: "token", name: "铜牌", kind: "misc", iconic: false }],
  vehicles: [
    { id: "test-car", name: "测试车", class: "economy", speed: 3, seats: 4, trunk: 4, price: 1000 },
  ],
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
        ? [{ type: "stash", action: "store", item: "token", where: vehicleId, reason: "存入" }]
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

describe("后备箱必须确认车辆与玩家处于同一已知地点", () => {
  for (const action of ["store", "take"] as const) {
    it.each([
      { label: "双方位置未知", player: null, vehicle: null },
      { label: "玩家位置未知", player: null, vehicle: "a" },
      { label: "车辆位置未知", player: "a", vehicle: null },
    ])(`$label 时不显示后备箱，按钮和正文都不能 ${action}`, ({ player, vehicle }) => {
      const before = locate(setup(action === "take"), player, vehicle);
      const snapshot = JSON.stringify(before);
      expect(safehouseView({ world: before, data, records: [] }).trunks).toEqual([]);
      const request = { type: "stash" as const, action, item: "token", where: vehicleId };
      expect(applyPlayerAction(before, request, context()).ok).toBe(false);
      const narrative = registry.applyCommands(
        before,
        [{ ...request, reason: "尝试存取" }],
        context(),
      );
      expect(narrative.results[0]?.result.ok).toBe(false);
      expect(narrative.world).toBe(before);
      expect(narrative.patches).toEqual([]);
      expect(JSON.stringify(before)).toBe(snapshot);
      const internal = registry.applyCommands(
        before,
        [
          {
            type: "vehicle.stash",
            action,
            vehicle: vehicleId,
            item: "token",
          },
        ],
        context(),
      );
      expect(internal.results[0]?.result.ok).toBe(false);
      expect(internal.world).toBe(before);
      expect(internal.patches).toEqual([]);
    });
  }
});
