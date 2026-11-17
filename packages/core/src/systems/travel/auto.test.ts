import { describe, expect, it } from "vitest";
import { applyWorld, locationCatalog, WorldClockStateSchema } from "../world";
import { autoMove, planTrip, routeOptions, type TripWorld } from "./apply";
import { TravelStateSchema } from "./schema";

/**
 * 模型直接在 world 里写 location（用户定的"自动转"，2026-10-30）：500 米内走过去，更远的转成出行。
 * 没有路线表，按底图直线算（1 个百分点当 1 单位 100 米，同 tripDistance 没有路线表时）
 */
const data: Readonly<Record<string, unknown>> = {
  locations: [
    { id: "a", name: "甲地", district: "沃森", x: 10, y: 10 },
    { id: "b", name: "乙地", district: "沃森", x: 12, y: 10 },
    { id: "c", name: "丙地", district: "威斯特布鲁克", x: 60, y: 10 },
  ],
};

function world(eddies: number, location: string | null = "a"): TripWorld {
  return {
    now: 12 * 60,
    scene: 0,
    location,
    heat: 0,
    cred: 0,
    eddies,
    inCombat: false,
    travel: TravelStateSchema.parse({
      trips: [],
      encounterScene: null,
      encounter: null,
      vehicles: [],
      activeVehicleId: null,
      nextVehicleId: 1,
    }),
  };
}

/** 首访原作地点的测试数据（places-plan 第二期）：店和地标只有原始定义，存档里还没记下 */
const anchorData: Readonly<Record<string, unknown>> = {
  ...data,
  mapAreas: {
    districts: [{ id: "watson", name: "沃森", label: [25, 25], points: "0,0 50,0 50,50 0,50" }],
    subdistricts: [],
    centers: { 沃森: { x: 25, y: 25 } },
    kinds: [{ id: "ripperdoc", name: "义体医生" }],
  },
  servicePoints: [
    {
      id: "clinic",
      name: "测试诊所",
      kind: "ripperdoc",
      district: "watson",
      sub: null,
      x: 20,
      y: 10,
    },
  ],
  radar: [{ id: "ft:market", name: "测试市集", kind: null, x: 22, y: 10 }],
  routes: {
    anchors: [
      { id: "a", rough: false },
      { id: "poi:clinic", rough: false },
      { id: "ft:market", rough: false },
    ],
    meters: [1000, 1200, 200],
  },
};

describe("首次去原作地点（places-plan 第二期）", () => {
  it.each(["poi:clinic", "ft:market"])("%s：预览不登记，到达才记下地点", (id) => {
    const w = world(1000);
    const before = JSON.stringify({ w, data: anchorData });
    const route = routeOptions(w, anchorData, id).find((r) => r.mode === "taxi");
    expect(route).toBeDefined();
    expect(route?.blocked).toBeUndefined();
    const plan = planTrip(w, anchorData, { to: id, mode: "taxi" });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.trip.route).toEqual(route);
    expect(plan.trip.to.id).toBe(id);
    expect(JSON.stringify({ w, data: anchorData })).toBe(before);
    expect(locationCatalog(anchorData).has(id)).toBe(false);

    const clock = WorldClockStateSchema.parse({
      location: w.location,
      deadlines: [],
      scene: w.scene,
      sceneStartedAt: w.now,
    });
    const out = applyWorld(
      clock,
      {
        type: "world",
        activity: "travel",
        location: id,
        time: plan.trip.arriveAt,
      },
      w.now,
      anchorData,
    );
    expect(out.ok).toBe(true);
    expect(clock.location).toBe(id);
    expect(clock.places).toHaveLength(1);
    expect(clock.places[0]).toMatchObject({ id, visitedAt: plan.trip.arriveAt });
  });
});

describe("autoMove（用户定的自动转出行、500 米内步行）", () => {
  it("500 米内算走过去，用时按步行算", () => {
    expect(autoMove(world(0), data, "b")).toEqual({ kind: "near", to: "b", minutes: 4 });
  });

  it("中文名也认得", () => {
    expect(autoMove(world(0), data, " 乙地 ")).toMatchObject({ kind: "near", to: "b" });
  });

  it("远处转成出行：没车没站、钱够就打车", () => {
    const move = autoMove(world(1000), data, "c");
    expect(move.kind).toBe("trip");
    if (move.kind !== "trip") return;
    expect(move.trip.to.id).toBe("c");
    expect(move.trip.route.mode).toBe("taxi");
    expect(move.trip.route.cost).toBeGreaterThan(0);
    // 自动转的出行不抽路上偶遇（正文已经写完了）
    expect(move.trip.encounter).toBeNull();
  });

  it("钱不够打车就走路", () => {
    const move = autoMove(world(0), data, "c");
    expect(move.kind === "trip" && move.trip.route.mode).toBe("walk");
  });

  it("不认识的地点、已经在这里、现在的位置不在地图上：照旧直接换位置", () => {
    expect(autoMove(world(0), data, "沃森 · 无名小巷")).toEqual({ kind: "none" });
    expect(autoMove(world(0), data, "a")).toEqual({ kind: "none" });
    expect(autoMove(world(0, null), data, "c")).toEqual({ kind: "none" });
  });
});
