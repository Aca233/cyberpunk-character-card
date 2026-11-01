import { describe, expect, it } from "vitest";
import { applyWorld } from "./apply";
import { type WorldClockState, WorldClockStateSchema, WorldCommandSchema } from "./schema";

/**
 * world 的 location 直接写新地方（用户定的：新地点并进 location，place 只留给听说过的，2026-10-30）。
 * 手搭的小地图：沃森占左上四分之一
 */
const data: Readonly<Record<string, unknown>> = {
  mapAreas: {
    districts: [{ id: "watson", name: "沃森", label: [25, 25], points: "0,0 50,0 50,50 0,50" }],
    subdistricts: [],
    centers: { 沃森: { x: 25, y: 25 } },
    kinds: [],
  },
  locations: [{ id: "vapt", name: "V 的公寓", district: "沃森", x: 15, y: 15 }],
  roadSpots: [16, 15, 40, 40],
};

function fresh(): WorldClockState {
  return WorldClockStateSchema.parse({
    location: "vapt",
    deadlines: [],
    scene: 0,
    sceneStartedAt: 0,
  });
}

const world = (location: unknown) =>
  WorldCommandSchema.parse({ type: "world", activity: "travel", location });

describe("world 的 location 写 {name, in}", () => {
  it("建新地点，贴路面，标大概位置，玩家换过去", () => {
    const clock = fresh();
    const out = applyWorld(clock, world({ name: "老王面馆", in: "沃森" }), 0, data);
    expect(out.ok).toBe(true);
    expect(clock.places[0]).toMatchObject({
      id: "place:1",
      name: "老王面馆",
      district: "沃森",
      x: 16,
      y: 15,
      rough: true,
    });
    expect(clock.location).toBe("place:1");
  });

  it("同名的用原来那一条", () => {
    const clock = fresh();
    applyWorld(clock, world({ name: "老王面馆", in: "沃森" }), 0, data);
    applyWorld(clock, world("vapt"), 10, data);
    applyWorld(clock, world({ name: " 老王面馆", in: "沃森" }), 20, data);
    expect(clock.places).toHaveLength(1);
    expect(clock.location).toBe("place:1");
  });

  it("城区写错拒收", () => {
    const clock = fresh();
    expect(applyWorld(clock, world({ name: "某处", in: "火星" }), 0, data).ok).toBe(false);
    expect(clock.places).toEqual([]);
  });

  it("没写 in 的对象不收", () => {
    expect(
      WorldCommandSchema.safeParse({ type: "world", activity: "talk", location: { name: "某处" } })
        .success,
    ).toBe(false);
  });
});

describe("场景点挂在上级下面（用户定的，2026-10-30）", () => {
  it("坐标照上级，不贴路面，记下 parent", () => {
    const clock = fresh();
    const out = applyWorld(clock, world({ name: "天台", in: "沃森", parent: "vapt" }), 0, data);
    expect(out.ok).toBe(true);
    expect(clock.places[0]).toMatchObject({
      id: "place:1",
      name: "天台",
      parent: "vapt",
      x: 15,
      y: 15,
      rough: false,
    });
    expect(clock.location).toBe("place:1");
  });

  it("同一个上级下面同名的算同一处，上级写中文名也认", () => {
    const clock = fresh();
    applyWorld(clock, world({ name: "天台", in: "沃森", parent: "vapt" }), 0, data);
    applyWorld(clock, world("vapt"), 10, data);
    applyWorld(clock, world({ name: "天台", in: "沃森", parent: "V 的公寓" }), 20, data);
    expect(clock.places).toHaveLength(1);
    expect(clock.location).toBe("place:1");
  });
});
