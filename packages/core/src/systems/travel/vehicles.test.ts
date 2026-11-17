import { describe, expect, it } from "vitest";
import { newGameWorld } from "../../game";
import { fixedRng } from "../../kernel/rng";
import type { Command } from "../../kernel/system";
import type { WorldState } from "../../kernel/world";
import { InventoryStateSchema } from "../inventory";
import { registry } from "../registry";
import { TravelStateSchema } from "./schema";

const context = {
  rng: fixedRng([]),
  data: {
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

function run(world: WorldState, command: Command): WorldState {
  const result = registry.applyCommands(world, [command], context);
  expect(result.results[0]?.result).toMatchObject({ ok: true });
  return result.world;
}

describe("车辆的持久身份", () => {
  it("丢弃旧车后取得同型号新车，不继承旧车后备箱里的物品", () => {
    let world = run(newGameWorld({ startTime: 1000 }), {
      type: "vehicle.grant",
      model: "test-car",
      reason: "原车",
    });
    const oldId = TravelStateSchema.parse(world.slices.travel).vehicles[0]?.id;
    world = run(world, { type: "item", action: "gain", id: "keepsake", reason: "随身物品" });
    world = run(world, {
      type: "stash",
      action: "store",
      item: "keepsake",
      where: oldId,
      reason: "放入旧车",
    });
    world = run(world, { type: "vehicle", action: "abandon", vehicle: oldId, reason: "弃车" });
    world = run(JSON.parse(JSON.stringify(world)), {
      type: "vehicle.grant",
      model: "test-car",
      reason: "取得同款新车",
    });
    const newId = TravelStateSchema.parse(world.slices.travel).vehicles[0]?.id;
    expect(newId).not.toBe(oldId);
    const take = registry.applyCommands(
      world,
      [{ type: "stash", action: "take", item: "keepsake", where: newId, reason: "查看新车" }],
      context,
    );
    expect(take.results[0]?.result.ok).toBe(false);
    expect(InventoryStateSchema.parse(take.world.slices.inventory).backpack).toEqual({});
  });
});
