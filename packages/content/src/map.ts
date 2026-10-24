/**
 * 地图坐标：原作底图 world_map（1008×1016）宽、高的百分比，左上角是 0,0。
 * 全部待校准：先照原作地图目测填的大概位置，开发时在 /dev/calibrate 对齐来生、荒坂塔、丽姿酒吧等地标后改准。
 * metro：附近有没有 NCART 轻轨站（原作依据 2.1 加的轻轨；具体哪些地方有站待核对）。
 */
export interface MapSpot {
  readonly x: number;
  readonly y: number;
  readonly metro: boolean;
}

export const MAP_SPOTS: Readonly<Record<string, MapSpot>> = {
  "lizzies-bar": { x: 51, y: 24, metro: true },
  afterlife: { x: 44, y: 31, metro: true },
  "kabuki-market": { x: 52, y: 22, metro: true },
  "megabuilding-h10": { x: 46, y: 33, metro: true },
  "vik-clinic": { x: 46.5, y: 32, metro: true },
  "tom-diner": { x: 43.5, y: 34, metro: true },
  japantown: { x: 58, y: 41, metro: true },
  "coyote-cojo": { x: 48, y: 60, metro: true },
  "corpo-plaza": { x: 43, y: 46, metro: true },
  "grand-imperial-mall": { x: 31, y: 74, metro: false },
  dogtown: { x: 25, y: 78, metro: false },
  badlands: { x: 85, y: 62, metro: false },
};

/** 城区中心：新地点没坐标时先放在这里，玩家可以拖到准确位置（待校准） */
export const DISTRICT_CENTERS: Readonly<
  Record<string, { readonly x: number; readonly y: number }>
> = {
  沃森: { x: 44, y: 26 },
  市政中心: { x: 44, y: 46 },
  威斯特布鲁克: { x: 61, y: 40 },
  海伍德: { x: 46, y: 60 },
  圣多明戈: { x: 62, y: 66 },
  太平洲: { x: 30, y: 72 },
  狗镇: { x: 25, y: 78 },
  恶土: { x: 85, y: 62 },
};
