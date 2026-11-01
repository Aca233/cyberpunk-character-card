import { describe, expect, it } from "vitest";
import { PlayerActionSchema } from "../../actions";
import { movePlace, placeBookText } from "./places";
import { type SavedPlace, WorldClockStateSchema } from "./schema";

/** 地图上拖剧情地点（places-plan 第二期，用户定的 2026-10-30）：不调用模型，只改 place: 的坐标 */
const data: Readonly<Record<string, unknown>> = {
  mapAreas: {
    districts: [
      { id: "watson", name: "沃森", label: [25, 25], points: "0,0 50,0 50,50 0,50" },
      { id: "westbrook", name: "威斯特布鲁克", label: [75, 25], points: "50,0 100,0 100,50 50,50" },
    ],
    subdistricts: [],
    centers: { 沃森: { x: 25, y: 25 }, 威斯特布鲁克: { x: 75, y: 25 } },
    kinds: [],
  },
};

const place = (p: Partial<SavedPlace> & Pick<SavedPlace, "id" | "name">): SavedPlace => ({
  district: "沃森",
  x: 20,
  y: 20,
  rough: true,
  firstSeenAt: 0,
  visitedAt: 0,
  ...p,
});

function clock() {
  return WorldClockStateSchema.parse({
    location: "place:1",
    deadlines: [],
    scene: 1,
    sceneStartedAt: 0,
    places: [
      place({ id: "place:1", name: "地下诊所" }),
      place({ id: "place:2", name: "天台", parent: "place:1" }),
      place({ id: "poi:clinic", name: "原作诊所", rough: false }),
    ],
  });
}

describe("movePlace（地图上拖剧情地点）", () => {
  it("改坐标、记 movedAt，rough 照旧；挂在下面的场景点跟着走", () => {
    const c = clock();
    const out = movePlace(c, { id: "place:1", x: 30.123, y: 40 }, data, 99);
    expect(out.ok).toBe(true);
    expect(c.places[0]).toMatchObject({ x: 30.12, y: 40, movedAt: 99, rough: true });
    expect(c.places[1]).toMatchObject({ x: 30.12, y: 40 });
    expect(c.places[1]?.movedAt).toBeUndefined();
    expect(placeBookText(c, data)).toContain("玩家在地图上放的位置");
  });

  it("原作店、场景点、不认识的 id、拖出城区：拒收，坐标不变", () => {
    const c = clock();
    const before = JSON.stringify(c);
    expect(movePlace(c, { id: "poi:clinic", x: 30, y: 30 }, data, 1).ok).toBe(false);
    expect(movePlace(c, { id: "place:2", x: 30, y: 30 }, data, 1).ok).toBe(false);
    expect(movePlace(c, { id: "place:9", x: 30, y: 30 }, data, 1).ok).toBe(false);
    expect(movePlace(c, { id: "place:1", x: 70, y: 20 }, data, 1).ok).toBe(false);
    expect(JSON.stringify(c)).toBe(before);
  });

  it("界面操作的写法：坐标要在 0–100 之间", () => {
    const ok = PlayerActionSchema.safeParse({ type: "movePlace", id: "place:1", x: 3, y: 4 });
    expect(ok.success).toBe(true);
    const bad = PlayerActionSchema.safeParse({ type: "movePlace", id: "place:1", x: 101, y: 4 });
    expect(bad.success).toBe(false);
  });
});
