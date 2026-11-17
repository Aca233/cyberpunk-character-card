import { describe, expect, it } from "vitest";
import { type GameContent, newGameWorld } from "../../game";
import { fixedRng } from "../../kernel/rng";
import { type Command, createRegistry } from "../../kernel/system";
import type { WorldState } from "../../kernel/world";
import { CyberwareDefSchema, CyberwareStateSchema } from "../cyberware";
import { InventoryStateSchema } from "../inventory";
import { registry, systems } from "../registry";
import { SafehouseStateSchema } from "../safehouse";
import { WorldClockStateSchema } from "../world";
import { TravelStateSchema, VehicleDefSchema } from "./schema";

const partId = "loose-eye";
const data = {
  locations: [
    { id: "a", name: "甲地", district: "沃森", x: 10, y: 10 },
    { id: "b", name: "乙地", district: "沃森", x: 20, y: 10 },
  ],
  items: [{ id: "keepsake", name: "纪念品", kind: "misc" as const, iconic: false }],
  cyberware: [
    CyberwareDefSchema.parse({
      id: "field-eye",
      name: "现场义眼",
      slot: "eyes",
      rarity: "rare",
      price: 1000,
      humanityCost: 0,
      ability: "看见热源",
    }),
  ],
  vehicles: [
    VehicleDefSchema.parse({
      id: "test-car",
      name: "测试车",
      class: "economy",
      speed: 3,
      seats: 4,
      trunk: 4,
      price: 1000,
    }),
  ],
};
const context = () => ({
  data,
  rng: fixedRng([]),
  facts: { tradeNarrative: "你拿到了这枚义眼。" },
});

function run(world: WorldState, command: Command): WorldState {
  const result = registry.applyCommands(world, [command], context());
  expect(result.results[0]?.result).toMatchObject({ ok: true });
  return result.world;
}

function setup(): WorldState {
  let world = newGameWorld({ startTime: 1000, startLocation: "a" }, data);
  world = run(world, { type: "vehicle.grant", model: "test-car", reason: "测试车辆" });
  world = run(world, { type: "item", action: "gain", id: "keepsake", reason: "随身物品" });
  return run(world, {
    type: "cyberware.part",
    action: "record",
    part: partId,
    model: "field-eye",
    holder: "player",
    source: "亲手交付实物",
    evidence: "你拿到了这枚义眼",
  });
}

function vehicle(world: WorldState) {
  const car = TravelStateSchema.parse(world.slices.travel).vehicles[0];
  if (!car) throw new Error("车辆未创建");
  return car;
}

function stash(world: WorldState, action: "store" | "take", item: string): Command {
  return { type: "stash", action, item, where: vehicle(world).id, reason: "后备箱存取" };
}

describe("后备箱与随身物品一致性", () => {
  it("普通物品按数量往返，货物只存在车辆本身，不镜像到安全屋库存", () => {
    let world = setup();
    world = run(world, { type: "item", action: "gain", id: "keepsake", reason: "第二件" });
    world = run(world, stash(world, "store", "keepsake"));
    world = run(world, stash(world, "store", "keepsake"));
    expect(vehicle(world).cargo).toEqual({ keepsake: 2 });
    expect(InventoryStateSchema.parse(world.slices.inventory).backpack.keepsake).toBeUndefined();
    expect(SafehouseStateSchema.parse(world.slices.safehouse).stash).toEqual({});

    world = run(world, stash(world, "take", "keepsake"));
    expect(vehicle(world).cargo).toEqual({ keepsake: 1 });
    expect(InventoryStateSchema.parse(world.slices.inventory).backpack.keepsake).toBe(1);
    world = run(world, stash(world, "take", "keepsake"));
    expect(vehicle(world).cargo).toEqual({});
    expect(InventoryStateSchema.parse(world.slices.inventory).backpack.keepsake).toBe(2);
  });

  it("实体义体保留独立身份，存入后随车抵达，取出后恢复随身归属", () => {
    let world = setup();
    const carId = vehicle(world).id;
    world = run(world, stash(world, "store", partId));
    expect(vehicle(world).cargo).toEqual({ [partId]: 1 });
    expect(CyberwareStateSchema.parse(world.slices.cyberware).parts[partId]).toMatchObject({
      id: partId,
      holder: `stash:${carId}`,
      location: "a",
    });
    world = run(world, { type: "travel", to: "b", mode: "car" });
    expect(vehicle(world).location).toBe("b");
    expect(CyberwareStateSchema.parse(world.slices.cyberware).parts[partId]?.location).toBe("b");
    world = run(world, stash(world, "take", partId));
    expect(vehicle(world).cargo).toEqual({});
    expect(CyberwareStateSchema.parse(world.slices.cyberware).parts[partId]).toMatchObject({
      id: partId,
      model: "field-eye",
      holder: "player",
      location: null,
    });
    expect(Object.keys(CyberwareStateSchema.parse(world.slices.cyberware).parts)).toEqual([partId]);
    expect(InventoryStateSchema.parse(world.slices.inventory).backpack[partId]).toBeUndefined();
  });

  it("目录外独立物件随车移动位置，不能在异地通过 item gain 领取", () => {
    let world = run(setup(), {
      type: "item",
      action: "gain",
      id: "unique-token",
      reason: "撿起有名字的铜牌",
      definition: {
        id: "unique-token",
        name: "安娜刻字的铜牌",
        kind: "misc",
        iconic: false,
      },
      origin: "在甲地从安娜手中接过",
    });
    const carId = vehicle(world).id;
    world = run(world, stash(world, "store", "unique-token"));
    expect(
      InventoryStateSchema.parse(world.slices.inventory).objects["unique-token"],
    ).toMatchObject({
      holder: "stash",
      location: "a",
      origin: "在甲地从安娜手中接过",
    });

    world = run(world, { type: "travel", to: "b", mode: "car" });
    expect(vehicle(world)).toMatchObject({
      id: carId,
      location: "b",
      cargo: { "unique-token": 1 },
    });
    expect(
      InventoryStateSchema.parse(world.slices.inventory).objects["unique-token"],
    ).toMatchObject({
      holder: "stash",
      location: "b",
    });

    world = run(world, { type: "travel", to: "a", mode: "walk" });
    expect(WorldClockStateSchema.parse(world.slices.world).location).toBe("a");
    expect(vehicle(world).location).toBe("b");
    const claim = registry.applyCommands(
      world,
      [{ type: "item", action: "gain", id: "unique-token", reason: "尝试隔空取回" }],
      context(),
    );
    expect(claim.results[0]?.result.ok).toBe(false);
    expect(claim.world).toEqual(world);
    expect(
      InventoryStateSchema.parse(claim.world.slices.inventory).objects["unique-token"],
    ).toMatchObject({
      holder: "stash",
      location: "b",
    });
  });

  it.each([
    ["inventory", "store", "keepsake"],
    ["inventory", "take", "keepsake"],
    ["cyberware", "store", partId],
    ["cyberware", "take", partId],
  ] as const)("%s 的 %s 后续结算失败时，车辆货物和实物状态一起回滚", (systemId, action, item) => {
    let before = setup();
    if (action === "take") before = run(before, stash(before, "store", item));
    const failing = createRegistry(
      systems.map((system) =>
        system.id === systemId
          ? {
              ...system,
              apply(draft, command, ctx) {
                const outcome = system.apply(draft, command, ctx);
                return outcome.ok ? { ok: false as const, reason: "模拟物品转移失败" } : outcome;
              },
            }
          : system,
      ),
    );
    const result = failing.applyCommands(before, [stash(before, action, item)], context());
    expect(result.results[0]?.result).toEqual({ ok: false, reason: "模拟物品转移失败" });
    expect(result.world).toEqual(before);
    expect(result.patches).toEqual([]);
  });
});

describe("开局赠车位置", () => {
  it("行装赠车停在最终选择的 startLocation，而不是开场默认地点", () => {
    const content: GameContent = {
      ...data,
      openings: [
        {
          id: "test-open",
          title: "测试开场",
          location: "a",
          premise: "出发",
          gear: [],
          deadlines: [],
        },
      ],
      loadouts: [
        {
          id: "driver",
          label: "司机行装",
          kind: "origin",
          keywords: [],
          gear: [],
          vehicles: ["test-car"],
        },
      ],
    };
    const world = newGameWorld(
      { startTime: 1000, opening: "test-open", loadouts: ["driver"], startLocation: "b" },
      content,
    );
    expect(WorldClockStateSchema.parse(world.slices.world).location).toBe("b");
    expect(vehicle(world)).toMatchObject({ location: "b", cargo: {}, stolen: false });
    expect(TravelStateSchema.parse(world.slices.travel).activeVehicleId).toBe(vehicle(world).id);
    expect(world.time).toBe(1000);
  });
});
