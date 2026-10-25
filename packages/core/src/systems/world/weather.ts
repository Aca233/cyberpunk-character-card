import { periodOf } from "./apply";

/**
 * 天气：不存状态，按时间（每 6 小时一段）、季节和城区由代码算，同一段时间同一片地方天气不变。
 * 本作改编：原作有晴、雨、雾、酸雨（污染雨）和恶土沙尘暴，各天气的比例和季节分布是自定的，试玩后再调
 */
export type Weather = "clear" | "cloudy" | "rain" | "fog" | "acidRain" | "sandstorm";

/** 一段天气多长（分钟） */
export const WEATHER_BLOCK = 360;

const NOTES: Readonly<Record<Weather, string>> = {
  clear: "天气好，视野开阔，远处也看得清",
  cloudy: "阴天，烟雾和云压得很低",
  rain: "路面湿滑、霓虹倒影，雨声盖住脚步，远处看不清",
  fog: "能见度低，适合摸近，远程不好瞄",
  acidRain: "刺皮肤、蚀漆面，街上人少，都躲在雨棚下",
  sandstorm: "十米外看不清，车跑不快，扫描和远程都受影响",
};

type Season = "wet" | "dry" | "mild";
type Region = "city" | "coast" | "badlands";

/** 各季节、各片区的权重 */
const TABLES: Readonly<
  Record<Region, Readonly<Record<Season, readonly (readonly [Weather, number])[]>>>
> = {
  city: {
    wet: [
      ["clear", 3],
      ["cloudy", 3],
      ["rain", 4],
      ["fog", 1],
      ["acidRain", 1],
    ],
    dry: [
      ["clear", 7],
      ["cloudy", 2],
      ["fog", 1],
    ],
    mild: [
      ["clear", 5],
      ["cloudy", 3],
      ["rain", 2],
      ["fog", 1],
      ["acidRain", 1],
    ],
  },
  coast: {
    wet: [
      ["clear", 2],
      ["cloudy", 3],
      ["rain", 4],
      ["fog", 3],
      ["acidRain", 1],
    ],
    dry: [
      ["clear", 6],
      ["cloudy", 2],
      ["fog", 3],
    ],
    mild: [
      ["clear", 4],
      ["cloudy", 3],
      ["rain", 2],
      ["fog", 3],
      ["acidRain", 1],
    ],
  },
  badlands: {
    wet: [
      ["clear", 4],
      ["cloudy", 3],
      ["rain", 2],
      ["sandstorm", 1],
    ],
    dry: [
      ["clear", 6],
      ["cloudy", 1],
      ["sandstorm", 3],
    ],
    mild: [
      ["clear", 5],
      ["cloudy", 2],
      ["rain", 1],
      ["sandstorm", 2],
    ],
  },
};

const COAST: ReadonlySet<string> = new Set(["太平洲"]);
const BADLANDS: ReadonlySet<string> = new Set(["恶土"]);

function seasonOf(minutes: number): Season {
  const month = new Date(minutes * 60000).getUTCMonth() + 1;
  if (month >= 11 || month <= 3) return "wet";
  if (month >= 6 && month <= 9) return "dry";
  return "mild";
}

function regionOf(district: string | null): Region {
  if (district !== null && BADLANDS.has(district)) return "badlands";
  if (district !== null && COAST.has(district)) return "coast";
  return "city";
}

/** 0 到 1 之间、由整数定下的数 */
function unit(n: number): number {
  let x = (n ^ 0x9e3779b9) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

const REGION_SEED: Readonly<Record<Region, number>> = { city: 0, coast: 1, badlands: 2 };

export function weatherKind(minutes: number, district: string | null): Weather {
  const region = regionOf(district);
  const table = TABLES[region][seasonOf(minutes)];
  const block = Math.floor(minutes / WEATHER_BLOCK);
  const total = table.reduce((sum, [, w]) => sum + w, 0);
  let roll = unit(block * 3 + REGION_SEED[region]) * total;
  for (const [kind, w] of table) {
    roll -= w;
    if (roll < 0) return kind;
  }
  return "clear";
}

export function weatherAt(minutes: number, district: string | null) {
  const kind = weatherKind(minutes, district);
  const period = periodOf(minutes);
  const night = period === "night" || period === "dusk";
  const label =
    kind === "clear"
      ? night
        ? "晴夜"
        : "晴天"
      : { cloudy: "阴天", rain: "下雨", fog: "起雾", acidRain: "酸雨", sandstorm: "沙尘暴" }[kind];
  return {
    kind,
    label,
    note: NOTES[kind],
    /** 这段天气到几点（游戏分钟） */
    until: (Math.floor(minutes / WEATHER_BLOCK) + 1) * WEATHER_BLOCK,
  };
}
