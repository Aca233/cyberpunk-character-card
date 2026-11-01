import { describe, expect, it } from "vitest";
import { type GameContent, newGameWorld } from "./game";
import { WorldClockStateSchema } from "./systems/world/schema";

/**
 * 开局地点（用户定的，2026-10-30："可以选择地点开局"，开局地点"在地图上选择"）。
 * 用一张手搭的小地图测，不读 content 包：沃森占左上四分之一，一个街区、一家服务点、一个地标
 */
const mapData: Readonly<Record<string, unknown>> = {
  mapAreas: {
    districts: [{ id: "watson", name: "沃森", label: [25, 25], points: "0,0 50,0 50,50 0,50" }],
    subdistricts: [
      {
        id: "kabuki",
        name: "歌舞伎町",
        district: "watson",
        label: [20, 20],
        points: "0,0 25,0 25,25 0,25",
      },
    ],
    centers: { 沃森: { x: 25, y: 25 }, 恶土: { x: 50, y: 90 } },
    kinds: [{ id: "ripperdoc", name: "义体医生" }],
  },
  servicePoints: [
    { id: "rd_c", kind: "ripperdoc", name: null, district: "watson", sub: null, x: 40, y: 40 },
  ],
  radar: [{ id: "ft:kabuki_market", name: "歌舞伎町市场", kind: null, x: 12, y: 12 }],
};

const content: GameContent = {
  locations: [
    { id: "home-bar", name: "开场酒吧", district: "沃森", x: 20, y: 20 },
    { id: "vapt", name: "V 的公寓", district: "沃森", x: 15, y: 15 },
  ],
  openings: [
    {
      id: "test-open",
      title: "测试开场",
      location: "home-bar",
      premise: "从开场酒吧开始。",
      gear: [],
      deadlines: [],
    },
  ],
  mapData,
};

const START = 1000;

function startAt(startLocation?: string) {
  const world = newGameWorld(
    {
      startTime: START,
      difficulty: "nightCity",
      opening: "test-open",
      ...(startLocation === undefined ? {} : { startLocation }),
    },
    content,
  );
  return { world, clock: WorldClockStateSchema.parse(world.slices.world) };
}

describe("建档时选开局地点", () => {
  it("没选的照旧从开场自带的地点开始，地点簿是空的（旧存档同此）", () => {
    const { clock } = startAt();
    expect(clock.location).toBe("home-bar");
    expect(clock.places).toEqual([]);
  });

  it("选常用地点：换过去，不推进时间、不换场景", () => {
    const { world, clock } = startAt("vapt");
    expect(clock.location).toBe("vapt");
    expect(clock.places).toEqual([]);
    expect(world.time).toBe(START);
    expect(clock.scene).toBe(0);
    expect(clock.sceneStartedAt).toBe(START);
  });

  it("选原作服务点：记进地点簿，坐标照原作，不标大概位置", () => {
    const { world, clock } = startAt("poi:rd_c");
    expect(clock.location).toBe("poi:rd_c");
    expect(clock.places[0]).toMatchObject({ id: "poi:rd_c", rough: false, x: 40, y: 40 });
    expect(world.time).toBe(START);
  });

  it("选原作地标：记进地点簿，城区和街区按地图形状定", () => {
    const { clock } = startAt("ft:kabuki_market");
    expect(clock.location).toBe("ft:kabuki_market");
    expect(clock.places[0]).toMatchObject({
      id: "ft:kabuki_market",
      district: "沃森",
      sub: "歌舞伎町",
    });
  });

  it("不认识的原作地点建不了档", () => {
    expect(() => startAt("poi:nope")).toThrow();
  });
});
