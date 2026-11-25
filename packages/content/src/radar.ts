/**
 * 周边雷达的锚点（places-plan §十三①，用户同意写入，2026-10-30）：【地点】一节每轮按玩家坐标挑最近的几个列出来。
 * 来源：原作固定地点（有坐标的）、原作服务点 SERVICE_POINTS（id 写 poi:<id>）、有坐标的原作地标 FAST_TRAVEL_POINTS（id 写 ft:<id>，本作约定）。
 * 存档记下的地点由 world 系统的 data 钩子并进来。坐标都是底图百分比。
 */
import { FAST_TRAVEL_POINTS } from "./fastTravel";
import { locations } from "./locations";
// 经 mapShapes.ts 去掉了中间人一类（用户 2026-11-02："地图上不要搞专门的中间人了，都是npc"）
import { SERVICE_POINTS, type ServicePointKind } from "./mapShapes";

export interface RadarAnchor {
  readonly id: string;
  /** 显示名：原作名字；服务点没有名字时用类别名（§十三①），不编店名 */
  readonly name: string;
  /** 类别名，例如“义体医生”“地铁站”；第 ① 层地点是 null */
  readonly kind: string | null;
  /** 原作标定的城区 id（如 watson、badlands、dogtown）；优先用于边界点归属，免受多边形误差影响 */
  readonly district?: string | null;
  /** 原作标定的街区 id（如 corpo_plaza、wellspring）；可为空 */
  readonly sub?: string | null;
  readonly x: number;
  readonly y: number;
}

/** 服务点类别的中文名，照原作地图图例文字（UI-MappinTypes-*，与 mapShapes.gen.ts 的 MAP_POI_KINDS 同一份） */
const KIND_NAMES: Readonly<Record<ServicePointKind, string>> = {
  ripperdoc: "义体医生",
  gun: "武器店",
  melee: "近战武器商贩",
  netrunner: "网络黑客",
  clothes: "服装",
  meds: "医疗点",
  junk: "垃圾商店",
  food: "饮食",
  bar: "酒吧",
  apartment: "公寓",
  rent: "公寓出租",
  autofixer: "好车中间人终端",
};

export const RADAR_ANCHORS: readonly RadarAnchor[] = [
  ...locations.flatMap((l) =>
    l.x === undefined || l.y === undefined
      ? []
      : [{ id: l.id, name: l.name, kind: null, x: l.x, y: l.y }],
  ),
  ...SERVICE_POINTS.map((p) => ({
    id: `poi:${p.id}`,
    name: p.name ?? KIND_NAMES[p.kind],
    kind: KIND_NAMES[p.kind],
    district: p.district,
    sub: p.sub,
    x: p.x,
    y: p.y,
  })),
  ...FAST_TRAVEL_POINTS.flatMap((f) =>
    f.x === null || f.y === null
      ? []
      : [
          {
            id: `ft:${f.id}`,
            name: f.name,
            kind: f.kind === "metro" ? "地铁站" : "地标",
            district: f.district,
            sub: f.sub,
            x: f.x,
            y: f.y,
          },
        ],
  ),
];
