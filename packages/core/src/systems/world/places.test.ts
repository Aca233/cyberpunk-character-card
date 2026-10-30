import { describe, expect, it } from "vitest";
import { applyPlace, placeBookText, resolveLocation, withPlaces } from "./places";
import {
  locationCatalog,
  type PlaceCommand,
  type SavedPlace,
  type WorldClockState,
  WorldClockStateSchema,
} from "./schema";

/**
 * 地点簿（places-plan §四、§五、§八、§九、§十三②）。
 * 用一张手搭的小地图测，不读 content 包：沃森在左上、威斯特布鲁克在右上，各一个街区
 */
const data: Readonly<Record<string, unknown>> = {
  mapAreas: {
    districts: [
      { id: "watson", name: "沃森", label: [25, 25], points: "0,0 50,0 50,50 0,50" },
      { id: "westbrook", name: "威斯特布鲁克", label: [75, 25], points: "50,0 100,0 100,50 50,50" },
    ],
    subdistricts: [
      {
        id: "kabuki",
        name: "歌舞伎町",
        district: "watson",
        label: [20, 20],
        points: "0,0 25,0 25,25 0,25",
      },
      {
        id: "japantown",
        name: "日本町",
        district: "westbrook",
        label: [70, 20],
        points: "50,0 75,0 75,25 50,25",
      },
    ],
    centers: { 沃森: { x: 25, y: 25 }, 威斯特布鲁克: { x: 75, y: 25 }, 恶土: { x: 50, y: 90 } },
    kinds: [{ id: "ripperdoc", name: "义体医生" }],
  },
  servicePoints: [
    {
      id: "rd_a",
      kind: "ripperdoc",
      name: "植入不求人",
      district: "watson",
      sub: "kabuki",
      x: 10,
      y: 10,
    },
    { id: "rd_b", kind: "ripperdoc", name: null, district: "watson", sub: "kabuki", x: 22, y: 10 },
    { id: "rd_c", kind: "ripperdoc", name: null, district: "watson", sub: null, x: 40, y: 40 },
  ],
  radar: [
    { id: "ft:kabuki_market", name: "歌舞伎町市场", kind: null, x: 12, y: 12 },
    { id: "poi:rd_a", name: "植入不求人", kind: "义体医生", x: 10, y: 10 },
  ],
  locations: [{ id: "vapt", name: "V 的公寓", district: "沃森", x: 15, y: 15 }],
};

function fresh(location: string | null = null): WorldClockState {
  return WorldClockStateSchema.parse({ location, deadlines: [], scene: 0, sceneStartedAt: 0 });
}

const place = (fields: Omit<PlaceCommand, "type">): PlaceCommand => ({ type: "place", ...fields });

describe("place 建新地点（§四）", () => {
  it("建在街区里，标大概位置，玩家到了那里", () => {
    const clock = fresh();
    const out = applyPlace(
      clock,
      place({ name: "老王面馆", district: "沃森", sub: "歌舞伎町" }),
      data,
      100,
    );
    expect(out.ok).toBe(true);
    const entry = clock.places[0];
    expect(entry?.id).toBe("place:1");
    expect(entry?.rough).toBe(true);
    expect(entry?.sub).toBe("歌舞伎町");
    expect(entry?.x).toBeLessThan(25);
    expect(entry?.y).toBeLessThan(25);
    expect(clock.location).toBe("place:1");
  });

  it("同名的用原来那一条", () => {
    const clock = fresh();
    applyPlace(clock, place({ name: "老王面馆", district: "沃森" }), data, 100);
    applyPlace(clock, place({ name: "  老王面馆 ", district: "沃森" }), data, 200);
    expect(clock.places).toHaveLength(1);
    expect(clock.places[0]?.visitedAt).toBe(200);
  });

  it("城区写错拒收，街区写错丢掉", () => {
    const clock = fresh();
    expect(applyPlace(clock, place({ name: "某处", district: "火星" }), data, 0).ok).toBe(false);
    applyPlace(clock, place({ name: "小巷", district: "沃森", sub: "日本町" }), data, 0);
    expect(clock.places[0]?.sub).toBeUndefined();
    expect(clock.places[0]?.district).toBe("沃森");
  });

  it("heard 只记下，不换位置", () => {
    const clock = fresh("vapt");
    applyPlace(clock, place({ name: "传说中的酒吧", district: "沃森", heard: true }), data, 0);
    expect(clock.location).toBe("vapt");
    expect(clock.places[0]?.visitedAt).toBeNull();
  });

  it("from + dir + dist：相对周边里的点推坐标（§十三②）", () => {
    const clock = fresh("vapt");
    applyPlace(
      clock,
      place({ name: "黑市摊", district: "沃森", from: "ft:kabuki_market", dir: "北", dist: "近" }),
      data,
      0,
    );
    // 近 = 100 米 ≈ 1.28 个百分点，北是 y 变小
    expect(clock.places[0]?.x).toBeCloseTo(12, 1);
    expect(clock.places[0]?.y).toBeCloseTo(10.72, 1);
  });
});

describe("place 带 kind 挑原作的店（§五）", () => {
  it("挑离玩家最近的，名字照原作，模型起的称呼当别名", () => {
    const clock = fresh("vapt");
    const cmd = place({ name: "街角诊所", district: "沃森", sub: "歌舞伎町", kind: "ripperdoc" });
    expect(applyPlace(clock, cmd, data, 0).ok).toBe(true);
    expect(clock.places[0]?.id).toBe("poi:rd_a");
    expect(clock.places[0]?.name).toBe("植入不求人");
    expect(clock.places[0]?.alias).toBe("街角诊所");
    expect(clock.places[0]?.rough).toBe(false);
    expect(clock.location).toBe("poi:rd_a");
    // 已经进地点簿的不再挑，换下一家；原作没名字的用街区 + 类别
    applyPlace(clock, place({ district: "沃森", sub: "歌舞伎町", kind: "ripperdoc" }), data, 1);
    expect(clock.places[1]?.id).toBe("poi:rd_b");
    expect(clock.places[1]?.name).toBe("歌舞伎町义体医生");
  });

  it("那一带没有这一类就拒收", () => {
    const clock = fresh();
    const out = applyPlace(clock, place({ district: "威斯特布鲁克", kind: "ripperdoc" }), data, 0);
    expect(out.ok).toBe(false);
  });

  it("别名也能按名字找到", () => {
    const clock = fresh("vapt");
    applyPlace(clock, place({ name: "街角诊所", district: "沃森", kind: "ripperdoc" }), data, 0);
    const got = resolveLocation(clock, "街角诊所", data, 1);
    expect(got).toEqual({ ok: true, id: "poi:rd_a" });
  });
});

describe("world 的 location（§九、§十三①）", () => {
  it("poi:、ft: 第一次去时记进地点簿，坐标照原作", () => {
    const clock = fresh();
    const poi = resolveLocation(clock, "poi:rd_c", data, 5);
    expect(poi.ok).toBe(true);
    expect(clock.places[0]).toMatchObject({ id: "poi:rd_c", rough: false, x: 40, y: 40 });
    resolveLocation(clock, "ft:kabuki_market", data, 6);
    expect(clock.places[1]).toMatchObject({
      id: "ft:kabuki_market",
      district: "沃森",
      sub: "歌舞伎町",
    });
  });

  it("不认识的 poi: 拒收", () => {
    expect(resolveLocation(fresh(), "poi:nope", data, 0).ok).toBe(false);
  });

  it("中文名对得上的换成 id，对不上的照旧存中文名", () => {
    const clock = fresh();
    expect(resolveLocation(clock, "V 的公寓", data, 0)).toEqual({ ok: true, id: "vapt" });
    expect(resolveLocation(clock, "沃森 · 无名小巷", data, 0)).toEqual({
      ok: true,
      id: "沃森 · 无名小巷",
    });
    expect(clock.places).toEqual([]);
  });

  it("旧存档没有 places：读出来是空的，照样能建", () => {
    const clock = fresh();
    expect(clock.places).toEqual([]);
    const old = {
      location: null,
      deadlines: [],
      scene: 0,
      sceneStartedAt: 0,
    } as unknown as WorldClockState;
    expect(applyPlace(old, place({ name: "老地方", district: "沃森" }), data, 0).ok).toBe(true);
    expect(old.places).toHaveLength(1);
  });
});

describe("并进地点表和提示词（§八）", () => {
  it("空簿原样返回；有条目时并进 locations 和 radar", () => {
    expect(withPlaces(data, [])).toBe(data);
    const clock = fresh();
    applyPlace(clock, place({ name: "老王面馆", district: "沃森" }), data, 0);
    const merged = withPlaces(data, clock.places);
    expect(locationCatalog(merged).get("place:1")).toMatchObject({ district: "沃森", rough: true });
    expect((merged.radar as { id: string }[]).some((a) => a.id === "place:1")).toBe(true);
    // 同一份地点簿再并一次用缓存
    expect(withPlaces(data, clock.places)).toBe(merged);
  });

  it("最多列 20 条，多的按城区折叠", () => {
    const places: SavedPlace[] = Array.from({ length: 25 }, (_, i) => ({
      id: `place:${i + 1}`,
      name: `地方${i + 1}`,
      district: "沃森",
      x: 10,
      y: 10,
      rough: true,
      firstSeenAt: i,
      visitedAt: null,
    }));
    const text = placeBookText({ location: null, places }, data) ?? "";
    expect(text.split("\n").filter((l) => l.startsWith("- place:"))).toHaveLength(20);
    expect(text).toContain("沃森还有 5 处");
    // 最近的在前
    expect(text).toContain("place:25");
    expect(text).not.toContain("place:1：");
  });

  it("现在的位置是表外中文名时提醒补 place", () => {
    const text = placeBookText({ location: "沃森 · 无名小巷", places: [] }, data);
    expect(text).toContain("附一条 place");
  });
});
