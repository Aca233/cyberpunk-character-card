import { describe, expect, it } from "vitest";
import { newGameWorld } from "../../game";
import { fixedRng } from "../../kernel/rng";
import type { Command } from "../../kernel/system";
import type { WorldState } from "../../kernel/world";
import { registry } from "../registry";

const locations = [
  { id: "a", name: "甲地", district: "沃森", x: 10, y: 10 },
  { id: "b", name: "乙地", district: "沃森", x: 20, y: 10 },
];

const gig = {
  id: "test-race",
  kind: "race",
  name: "测试赛",
  opponent: "测试对手",
  location: "b",
  tier: "street",
  stake: 0,
  purse: 1000,
  note: "测试用赛车",
  source: "测试",
};

const context = {
  rng: fixedRng([]),
  data: {
    locations,
    sidegigs: [gig],
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

function start(location: string): WorldState {
  return newGameWorld({ startTime: 1000, startLocation: location }, { locations });
}

function run(world: WorldState, command: Command) {
  return registry.applyCommands(world, [command], context);
}

function travel(world: WorldState, to: string, mode: "walk" | "car") {
  return run(world, { type: "travel", to, mode });
}

describe("赛车报名与车辆位置", () => {
  it("异地车辆不能报名；把自有车开到赛场后可以报名", () => {
    let world = run(start("a"), {
      type: "vehicle.grant",
      model: "test-car",
      reason: "测试车辆",
    }).world;
    world = travel(world, "b", "walk").world;

    const remote = run(world, { type: "sidegig", action: "enter", id: gig.id });
    expect(remote.results[0]?.result.ok).toBe(false);

    world = travel(world, "a", "walk").world;
    const drove = travel(world, "b", "car");
    expect(drove.results[0]?.result.ok).toBe(true);
    const entered = run(drove.world, { type: "sidegig", action: "enter", id: gig.id });
    expect(entered.results[0]?.result.ok).toBe(true);
  });

  it("偷来的车在场且唯一时可参赛", () => {
    const stolen = run(start("b"), {
      type: "vehicle",
      action: "steal",
      model: "test-car",
      witnesses: 0,
      reason: "测试偷车",
    });
    expect(stolen.results[0]?.result.ok).toBe(true);

    const entered = run(stolen.world, { type: "sidegig", action: "enter", id: gig.id });
    expect(entered.results[0]?.result.ok).toBe(true);
    expect((entered.world.slices.sidegigs as { active: { vehicle?: string } }).active.vehicle).toBe(
      "test-car-1",
    );
  });

  it("多辆车在场时拒绝猜参赛车；点名后登记本次车辆", () => {
    let world = run(start("b"), {
      type: "vehicle.grant",
      model: "test-car",
      reason: "第一辆",
    }).world;
    world = run(world, { type: "vehicle.grant", model: "test-car", reason: "第二辆" }).world;
    const ambiguous = run(world, { type: "sidegig", action: "enter", id: gig.id });
    expect(ambiguous.results[0]?.result).toMatchObject({
      ok: false,
      reason: expect.stringContaining("多辆可用车辆"),
    });
    const explicit = run(world, {
      type: "sidegig",
      action: "enter",
      id: gig.id,
      vehicle: "test-car-2",
    });
    expect(explicit.results[0]?.result.ok).toBe(true);
    expect(
      (explicit.world.slices.sidegigs as { active: { vehicle?: string } }).active.vehicle,
    ).toBe("test-car-2");
  });
});
