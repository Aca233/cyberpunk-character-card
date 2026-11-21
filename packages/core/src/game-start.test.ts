import { describe, expect, it } from "vitest";
import { type GameContent, newGameWorld, projectState } from "./game";
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
      opening: "test-open",
      ...(startLocation === undefined ? {} : { startLocation }),
    },
    content,
  );
  return { world, clock: WorldClockStateSchema.parse(world.slices.world) };
}

describe("建档时选开局地点", () => {
  it("没选的照旧从开场自带的地点开始，没有记下的地点（旧存档同此）", () => {
    const { clock } = startAt();
    expect(clock.location).toBe("home-bar");
    expect(clock.places).toEqual([]);
  });

  it("选原作固定地点：换过去，不推进时间、不换场景", () => {
    const { world, clock } = startAt("vapt");
    expect(clock.location).toBe("vapt");
    expect(clock.places).toEqual([]);
    expect(world.time).toBe(START);
    expect(clock.scene).toBe(0);
    expect(clock.sceneStartedAt).toBe(START);
  });

  it("选原作服务点：记下地点，坐标和类别照原作", () => {
    const { world, clock } = startAt("poi:rd_c");
    expect(clock.location).toBe("poi:rd_c");
    expect(clock.places[0]).toMatchObject({
      id: "poi:rd_c",
      kind: "ripperdoc",
      x: 40,
      y: 40,
      visitedAt: START,
    });
    expect(world.time).toBe(START);
  });

  it("选原作地标：记下地点，城区和街区按地图形状定", () => {
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

describe("开局神经耐受、自定义义体快照与载具替换", () => {
  const richContent: GameContent = {
    ...content,
    cyberware: [
      {
        id: "base-optics",
        name: "岐路司光学义眼",
        slot: "eyes",
        rarity: "common",
        price: 1000,
        humanityCost: 4,
        ability: "基础义眼扫描",
        armor: false,
        accelerator: false,
        iconic: false,
      },
      {
        id: "subdermal-armour",
        name: "皮下护甲",
        slot: "integumentary",
        rarity: "rare",
        price: 3000,
        humanityCost: 12,
        ability: "基础装甲",
        armor: true,
        accelerator: false,
        iconic: false,
      },
    ],
    vehicles: [
      {
        id: "origin-car",
        name: "出身旧车",
        maker: "霆威",
        class: "economy",
        speed: 2,
        seats: 4,
        price: 5000,
      },
      {
        id: "custom-bike",
        name: "草薙刃 CT-3X",
        maker: "Yaiba",
        class: "moto",
        speed: 4,
        seats: 2,
        price: 22000,
      },
    ],
    loadouts: [
      {
        id: "nomad-kit",
        label: "流浪者行装",
        kind: "origin",
        keywords: [],
        gear: [],
        cyberware: ["base-optics"],
        vehicles: ["origin-car"],
        eddies: 500,
      },
    ],
  };

  it("开局写入定性神经耐受，自定义义体自包含生效，专属载具替换出身载具", () => {
    const customChrome = {
      id: "custom-blade-1",
      name: "自制热能爪",
      humanityCost: 8,
      slot: "arms" as const,
      ability: "高温切割",
      custom: true,
    };
    const world = newGameWorld(
      {
        startTime: START,
        opening: "test-open",
        loadouts: ["nomad-kit"],
        board: {
          cyberware: ["subdermal-armour", "custom-blade-1"],
          customCyberware: [customChrome],
          tolerance: "low",
          kit: { cashTier: "standard", weapons: [], vehicle: "custom-bike" },
          people: [],
          acquaintances: [],
        },
      },
      richContent,
    );
    const view = projectState(world, [], {
      cyberware: [
        ...(richContent.cyberware ?? []),
        {
          id: "custom-blade-1",
          name: "自制热能爪",
          slot: "arms",
          rarity: "rare",
          price: 0,
          humanityCost: 8,
          ability: "高温切割",
          armor: false,
          accelerator: false,
          iconic: false,
        },
      ],
      vehicles: richContent.vehicles ?? [],
    });
    expect(view.humanity.tolerance).toBe("low");
    expect(view.humanity.stage).toBe("steady");
    expect(view.cyberware.map((c) => c.id)).toContain("custom-blade-1");
    expect(view.travel.vehicles.map((v) => v.model)).toEqual(["custom-bike"]);
  });
});
