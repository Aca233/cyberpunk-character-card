import { describe, expect, it } from "vitest";
import { createPlace, placesText, resolveLocation, withPlaces } from "./places";
import {
  locationCatalog,
  type SavedPlace,
  type WorldClockState,
  WorldClockStateSchema,
} from "./schema";

/**
 * 统一的地点（用户定的"统一为地点"，2026-11-02）：location 只有 id 和 {name, in, note?} 两种写法，
 * 提示词只有一段【地点】。用一张手搭的小地图测，不读 content 包：沃森在左上、威斯特布鲁克在右上
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
    { id: "rd_c", kind: "ripperdoc", name: null, district: "watson", sub: null, x: 40, y: 40 },
  ],
  radar: [
    { id: "ft:kabuki_market", name: "歌舞伎町市场", kind: null, x: 12, y: 12 },
    { id: "poi:rd_a", name: "植入不求人", kind: "ripperdoc", x: 10, y: 10 },
  ],
  locations: [{ id: "vapt", name: "V 的公寓", district: "沃森", x: 15, y: 15 }],
};

function fresh(location: string | null = null): WorldClockState {
  return WorldClockStateSchema.parse({ location, deadlines: [], scene: 0, sceneStartedAt: 0 });
}

describe("location 写 {name, in} 建新地点", () => {
  it("建 place:N，坐标在城区里，玩家到了那里", () => {
    const clock = fresh();
    const out = createPlace(clock, { name: "老王面馆", in: "沃森", note: "通宵营业" }, data, 100);
    expect(out.ok).toBe(true);
    const entry = clock.places[0];
    expect(entry).toMatchObject({
      id: "place:1",
      name: "老王面馆",
      district: "沃森",
      note: "通宵营业",
      firstSeenAt: 100,
      visitedAt: 100,
    });
    expect(entry?.x).toBeLessThanOrEqual(50);
    expect(entry?.y).toBeLessThanOrEqual(50);
    expect(clock.location).toBe("place:1");
  });

  it("同名的用原来那一条", () => {
    const clock = fresh();
    createPlace(clock, { name: "老王面馆", in: "沃森" }, data, 100);
    clock.location = null;
    createPlace(clock, { name: "  老王面馆 ", in: "沃森" }, data, 200);
    expect(clock.places).toHaveLength(1);
    expect(clock.places[0]?.visitedAt).toBe(200);
    expect(clock.location).toBe("place:1");
  });

  it("名字对得上原作地点时用原作那一条，不另建", () => {
    const clock = fresh();
    expect(createPlace(clock, { name: "V 的公寓", in: "沃森" }, data, 0).ok).toBe(true);
    expect(clock.places).toEqual([]);
    expect(clock.location).toBe("vapt");
  });

  it("城区写错拒收", () => {
    const clock = fresh();
    const out = createPlace(clock, { name: "某处", in: "火星" }, data, 0);
    expect(out.ok).toBe(false);
    expect(clock.places).toEqual([]);
  });

  it("没有地图数据时拒收", () => {
    expect(createPlace(fresh(), { name: "某处", in: "沃森" }, {}, 0).ok).toBe(false);
  });

  it("旧存档没有 places：读出来是空的，照样能建", () => {
    expect(fresh().places).toEqual([]);
    const old = {
      location: null,
      deadlines: [],
      scene: 0,
      sceneStartedAt: 0,
    } as unknown as WorldClockState;
    expect(createPlace(old, { name: "老地方", in: "沃森" }, data, 0).ok).toBe(true);
    expect(old.places).toHaveLength(1);
  });

  it("旧存档里的 near、parent、tempScene、alias、rough、movedAt 读档时丢掉", () => {
    const clock = WorldClockStateSchema.parse({
      location: null,
      deadlines: [],
      scene: 0,
      sceneStartedAt: 0,
      places: [
        {
          id: "place:1",
          name: "天台",
          district: "沃森",
          near: "vapt",
          parent: "vapt",
          tempScene: 0,
          alias: "楼顶",
          rough: true,
          movedAt: 5,
          x: 15,
          y: 15,
          firstSeenAt: 0,
          visitedAt: 0,
        },
      ],
    });
    const entry = clock.places[0] as Record<string, unknown>;
    for (const key of ["near", "parent", "tempScene", "alias", "rough", "movedAt"]) {
      expect(entry[key]).toBeUndefined();
    }
  });
});

describe('新地点贴路面（用户定的"先贴路面"，2026-10-30）', () => {
  it("玩家就在这个城区时从玩家脚下找最近的路边", () => {
    const roads = { ...data, roadSpots: [16, 15, 40, 40] };
    const clock = fresh("vapt");
    createPlace(clock, { name: "楼下面馆", in: "沃森" }, roads, 0);
    expect(clock.places[0]).toMatchObject({ x: 16, y: 15 });
  });

  it("路边不在这个城区里就不用，退回玩家脚下", () => {
    const roads = { ...data, roadSpots: [55, 15] };
    const clock = fresh("vapt");
    createPlace(clock, { name: "楼下面馆", in: "沃森" }, roads, 0);
    expect(clock.places[0]).toMatchObject({ x: 15, y: 15 });
  });

  it("玩家不在这个城区时从城区中心找", () => {
    const clock = fresh("vapt");
    createPlace(clock, { name: "海边仓库", in: "威斯特布鲁克" }, data, 0);
    expect(clock.places[0]).toMatchObject({ district: "威斯特布鲁克", x: 75, y: 25 });
  });
});

describe("location 写 id", () => {
  it("poi:、ft: 第一次去时记下来，坐标照原作", () => {
    const clock = fresh();
    const poi = resolveLocation(clock, "poi:rd_c", data, 5);
    expect(poi.ok).toBe(true);
    expect(clock.places[0]).toMatchObject({
      id: "poi:rd_c",
      kind: "ripperdoc",
      district: "沃森",
      x: 40,
      y: 40,
      visitedAt: 5,
    });
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

  it("中文名对得上的换成 id，对不上的有地图数据时自动落点建 place:N，无地图数据时照旧存中文名", () => {
    const clock = fresh();
    expect(resolveLocation(clock, "V 的公寓", data, 0)).toEqual({ ok: true, id: "vapt" });
    const placed = resolveLocation(clock, "沃森 · 无名小巷", data, 5);
    expect(placed).toMatchObject({ ok: true, id: "place:1" });
    expect(clock.places[0]).toMatchObject({
      id: "place:1",
      name: "无名小巷",
      district: "沃森",
      visitedAt: 5,
    });
    // 再次写同一自由文本时复用已建地点，不重复落点
    expect(resolveLocation(clock, "沃森 · 无名小巷", data, 10)).toEqual({
      ok: true,
      id: "place:1",
    });
    expect(clock.places).toHaveLength(1);
    expect(resolveLocation(fresh(), "未知偏僻地", {}, 0)).toEqual({
      ok: true,
      id: "未知偏僻地",
    });
  });

  it("指定 sub 街区时落点在目标街区内并持久保存 sub", () => {
    const clock = fresh();
    const out = createPlace(clock, { name: "暗网黑市", in: "沃森", sub: "歌舞伎町" }, data, 20);
    expect(out.ok).toBe(true);
    expect(clock.places[0]).toMatchObject({
      name: "暗网黑市",
      district: "沃森",
      sub: "歌舞伎町",
    });
    expect(clock.places[0]?.x).toBeLessThanOrEqual(25);
    expect(clock.places[0]?.y).toBeLessThanOrEqual(25);
  });

  it("ft: 地铁站首次访问记下 metro: true 并透传给 locationCatalog", () => {
    const metroData = {
      ...data,
      radar: [
        ...(data.radar as Record<string, unknown>[]),
        { id: "ft:metro_kabuki", name: "歌舞伎町地铁站", kind: "地铁站", x: 18, y: 18 },
      ],
    };
    const clock = fresh();
    expect(resolveLocation(clock, "ft:metro_kabuki", metroData, 10)).toMatchObject({
      ok: true,
      id: "ft:metro_kabuki",
    });
    expect(clock.places[0]).toMatchObject({ id: "ft:metro_kabuki", metro: true });
    expect(locationCatalog(withPlaces(metroData, clock.places)).get("ft:metro_kabuki")?.metro).toBe(
      true,
    );
  });
});

describe("并进地点表", () => {
  it("没有记下的原样返回；有条目时并进 locations 和 radar，带类别", () => {
    expect(withPlaces(data, [])).toBe(data);
    const clock = fresh();
    createPlace(clock, { name: "老王面馆", in: "沃森" }, data, 0);
    resolveLocation(clock, "poi:rd_c", data, 1);
    const merged = withPlaces(data, clock.places);
    expect(locationCatalog(merged).get("place:1")).toMatchObject({ district: "沃森" });
    expect(locationCatalog(merged).get("poi:rd_c")).toMatchObject({ kind: "ripperdoc" });
    const radar = merged.radar as { id: string; kind: string | null }[];
    expect(radar.some((a) => a.id === "place:1")).toBe(true);
    expect(radar.find((a) => a.id === "poi:rd_c")?.kind).toBe("ripperdoc");
    // 同一批地点再并一次用缓存
    expect(withPlaces(data, clock.places)).toBe(merged);
  });
});

describe("【地点】", () => {
  it("原作固定地点全列，附近的带方位、距离和类别", () => {
    const text = placesText(fresh("vapt"), data) ?? "";
    expect(text).toContain("- vapt：V 的公寓（沃森，你在这里）");
    expect(text).toContain("- ft:kabuki_market：歌舞伎町市场（沃森，西北 330 米）");
    expect(text).toContain("- poi:rd_a：植入不求人（沃森，义体医生，西北 550 米）");
  });

  it("同一个地方只列一次", () => {
    const clock = fresh("vapt");
    resolveLocation(clock, "poi:rd_a", data, 1);
    clock.location = "vapt";
    const text = placesText(clock, withPlaces(data, clock.places)) ?? "";
    expect(text.split("poi:rd_a：")).toHaveLength(2);
  });

  it("最近去过的列 20 条，最近的在前，多的只给个数", () => {
    const places: SavedPlace[] = Array.from({ length: 25 }, (_, i) => ({
      id: `place:${i + 1}`,
      name: `地方${i + 1}`,
      district: "沃森",
      x: 10,
      y: 10,
      firstSeenAt: i,
      visitedAt: i,
    }));
    const text = placesText({ location: null, places }, data) ?? "";
    const lines = text.split("\n").filter((l) => l.startsWith("- place:"));
    expect(lines).toHaveLength(20);
    expect(lines[0]).toContain("place:25");
    expect(text).not.toContain("place:1：");
    expect(text).toContain("另有 5 处");
    // 原作固定地点照样列
    expect(text).toContain("- vapt：");
  });

  it("现在的位置是表外中文名时提醒把 location 写成 {name, in}", () => {
    const text = placesText({ location: "沃森 · 无名小巷", places: [] }, data);
    expect(text).toContain('{"name": "沃森 · 无名小巷", "in": "城区"}');
  });
});
