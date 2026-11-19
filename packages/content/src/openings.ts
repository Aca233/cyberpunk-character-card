import type { GameOpening } from "@cp/core";
import { locations } from "./locations";
import { DISTRICT_SHAPES } from "./mapShapes.gen";
import { RADAR_ANCHORS } from "./radar";
import { DISTRICT_LAWS, NIGHT_CITY_SLICES } from "./slices";

/** 新存档默认用的自由沙盘开场 */
export const DEFAULT_OPENING = "sandbox-2077";

export const openings: readonly GameOpening[] = [
  {
    // 2077 自由沙盘开局：《边缘行者》已是旧闻，不强加任何主线芯片委托或倒计时
    id: "sandbox-2077",
    title: "夜之城自由沙盘",
    location: "megabuilding-h10",
    cast: [
      "qiao-night",
      "noah-night",
      "sleeve-shop-keeper",
      "judy",
      "regina",
      "viktor",
      "jackie",
      "misty",
      "rogue",
      "wakako",
      "dex",
      "padre",
      "panam",
      "river",
      "kerry",
      "dino",
      "el-capitan",
      "dakota",
      "mr-hands",
      "takemura",
      "evelyn",
      "hanako",
      "yorinobu",
      "saburo",
      "hellman",
      "t-bug",
      "dum-dum",
      "royce",
      "placide",
      "brigitte",
      "mama-welles",
      "meredith",
      "claire",
      "nix",
      "lizzy-wizzy",
      "smasher",
      "saul",
      "mitch",
      "carol",
      "songbird",
      "reed",
      "myers",
      "hansen",
      "alex",
    ],
    premise: `这是一场 2077 年初夜之城自由沙盘开局：没有强塞给玩家的预设芯片死线或必接任务，城市照自己的逻辑运转，各方中间人、帮派与巨企各怀盘算。
《边缘行者》里的事已经过去了，是街头的旧闻：大卫、丽贝卡、曼恩一伙和中间人法拉第都死了，有人提起时照旧闻写，他们不会出场。
第一轮直接从玩家当前所在地点的一个具体瞬间切进去：感官噪音、气味、街角摊贩/过路人或旧识的动静。绝不写干巴巴的背景综述，不要列选项，也不要反问玩家想做什么；玩家的第一句话已经写了在做什么或说什么，就顺着它接着往下推。
如玩家主动打听活计、联系中间人或撞上现场麻烦，可通过正常的委托/人际机制自然生出差事（jobOffer），不要硬塞线性剧本。`,
    gear: [],
    eddies: 0,
    cyberware: [],
    deadlines: [],
    jobs: [],
  },
];

export interface OpeningContext {
  /** 开场游戏时间（分钟），用于匹配时段生活切片 */
  readonly timeMinutes?: number;
  /** 角色卡身份一句话摘要 */
  readonly origin?: string;
  /** 角色名下安全屋名字 */
  readonly homes?: readonly string[];
  /** 开局已建立关系的旧识 */
  readonly acquaintances?: readonly { readonly name: string; readonly relation?: string }[];
}

const DISTRICT_NAME_TO_ID: Readonly<Record<string, string>> = {
  沃森: "watson",
  沃森区: "watson",
  威斯特布鲁克: "westbrook",
  威斯布鲁克: "westbrook",
  市政中心: "city-center",
  海伍德: "heywood",
  圣多明戈: "santo-domingo",
  太平洲: "pacifica",
  狗镇: "dogtown",
  恶土: "badlands",
};

const SHAPE_ID_TO_LAW_ID: Readonly<Record<string, string>> = {
  city_center: "city-center",
  santo_domingo: "santo-domingo",
};

type Pt = readonly [number, number];

function parsePoly(raw: string): readonly Pt[] {
  return raw
    .trim()
    .split(/\s+/)
    .map((pair) => {
      const [x, y] = pair.split(",").map(Number);
      return [x ?? 0, y ?? 0] as const;
    });
}

const DISTRICT_POLYS = DISTRICT_SHAPES.map((shape) => ({
  id: SHAPE_ID_TO_LAW_ID[shape.id] ?? shape.id,
  poly: parsePoly(shape.points),
}));

function pointInPoly(poly: readonly Pt[], x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (!a || !b) continue;
    if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) {
      hit = !hit;
    }
  }
  return hit;
}

function districtIdOf(locationId: string): string {
  const known = locations.find((l) => l.id === locationId);
  if (known) return DISTRICT_NAME_TO_ID[known.district] ?? "watson";
  const anchor = RADAR_ANCHORS.find((a) => a.id === locationId);
  if (anchor) {
    const found = DISTRICT_POLYS.find((d) => pointInPoly(d.poly, anchor.x, anchor.y));
    return found?.id ?? "badlands";
  }
  return "watson";
}

function periodOf(timeMinutes: number | undefined): "dawn" | "day" | "dusk" | "night" | "any" {
  if (timeMinutes === undefined) return "any";
  const mins = ((Math.floor(timeMinutes) % 1440) + 1440) % 1440;
  const hour = Math.floor(mins / 60);
  if (hour >= 5 && hour < 9) return "dawn";
  if (hour >= 9 && hour < 17) return "day";
  if (hour >= 17 && hour < 20) return "dusk";
  return "night";
}

/** 地图锚点的说法：没有原作店名的服务点只有类别名，写成“一处义体医生”这样，不编店名 */
function anchorWords(id: string): string {
  const anchor = RADAR_ANCHORS.find((a) => a.id === id);
  if (!anchor) return id;
  return anchor.kind !== null && anchor.name === anchor.kind ? `一处${anchor.kind}` : anchor.name;
}

/**
 * 自由沙盘动态开场设定：
 * 根据玩家开局所选地点（或出身默认地点）所属城区注入安检/执法/穿衣法则与夜之城街头切片，
 * 并带上角色身份定位、名下住所与已建立关系的旧识，供首轮叙事直接使用。
 */
export function openingPremise(
  id: string | undefined,
  startLocation?: string | undefined,
  context?: OpeningContext,
): string | undefined {
  const opening = id === undefined ? undefined : openings.find((o) => o.id === id);
  if (!opening) return undefined;
  const hereId = startLocation ?? opening.location;
  const hereName = anchorWords(hereId);
  const districtId = districtIdOf(hereId);
  const law = DISTRICT_LAWS[districtId];
  const period = periodOf(context?.timeMinutes);
  const slice =
    NIGHT_CITY_SLICES.find(
      (s) => s.district === districtId && (s.period === period || s.period === "any"),
    ) ?? NIGHT_CITY_SLICES.find((s) => s.district === districtId);

  const lines: string[] = [
    opening.premise,
    `当前开局地点：${hereName}（地点 ${hereId}，所属城区：${law?.name ?? districtId}）。第一轮直接从${hereName}的一个具体瞬间切进去。`,
  ];
  if (law) lines.push(`城区治安与安检法则：${law.lawSummary}`);
  if (slice) lines.push(`街头生活气息参考（自然融入氛围即可，不必照抄）：${slice.text}`);
  if (context?.origin) lines.push(`主角此刻身份：${context.origin}`);
  if (context?.homes && context.homes.length > 0) {
    lines.push(`名下可落脚的安全屋：${context.homes.join("、")}`);
  }
  if (context?.acquaintances && context.acquaintances.length > 0) {
    const rels = context.acquaintances
      .map((a) => (a.relation ? `${a.name}（${a.relation}）` : a.name))
      .join("、");
    lines.push(`城里本来就认识的旧识：${rels}`);
  }
  return lines.join("\n");
}
