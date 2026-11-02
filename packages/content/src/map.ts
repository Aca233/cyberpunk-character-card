/**
 * 地图坐标：底图 night_city_roads（2048×2048，正方形）宽、高的百分比，左上角是 0,0，北在上。
 * 底图和坐标都从游戏文件算出来（原作依据 2.x 游戏文件），不是目测：
 *   底图：base\entities\cameras\3dmap\ 里世界地图用的道路、道路边界、轻轨、地形、崖壁网格，俯视烘焙成一张图
 *   地点：任务日志里的地图图钉（gameJournal*MapPin）的世界坐标取中位数
 *   城区中心：3dmap_view.ent 里城区悬停轮廓（gameStaticTriggerAreaComponent）离边界最远的点
 * 画框：世界 X -3900..3900 → 0..100，世界 Y 4100..-3700 → 0..100。
 * 生成脚本在本机解包目录（build_map.py），游戏素材不进仓库，只提交算出来的数字。
 * metro：附近有没有 NCART 轻轨站（原作依据 2.1 加的轻轨；具体哪些地方有站待核对）。
 */
export interface MapSpot {
  readonly x: number;
  readonly y: number;
  readonly metro: boolean;
}

export const MAP_SPOTS: Readonly<Record<string, MapSpot>> = {
  "lizzies-bar": { x: 34.7, y: 32.5, metro: true },
  afterlife: { x: 31.3, y: 39.4, metro: true },
  /** 只有 1 个图钉 */
  "kabuki-market": { x: 34.2, y: 27.4, metro: true },
  "megabuilding-h10": { x: 32.3, y: 36.3, metro: true },
  "vik-clinic": { x: 30.2, y: 37.0, metro: true },
  /** 待核对：没找到餐馆的图钉，先放在 H10 旁边 */
  "tom-diner": { x: 33.1, y: 37.4, metro: true },
  japantown: { x: 42.5, y: 42.2, metro: true },
  "coyote-cojo": { x: 33.9, y: 65.4, metro: true },
  "corpo-plaza": { x: 32.8, y: 52.8, metro: true },
  "grand-imperial-mall": { x: 19.9, y: 79.6, metro: false },
  /** 狗镇轮廓的中心 */
  dogtown: { x: 27.7, y: 85.5, metro: false },
  /** 待核对：恶土的图钉散布 3 公里，取的中位数 */
  badlands: { x: 67.9, y: 74.9, metro: false },
  /**
   * 坐标取自原作服务点 wat_fixer（servicePoints.gen.ts），离医疗中心站约 340 米。
   * 这里只是个普通地点：地图不再画中间人图钉，瑞吉娜本人按她现在在哪画（用户 2026-11-02："都是npc"）
   */
  "regina-office": { x: 35.4, y: 32.5, metro: true },
  /** 坐标取自原作服务点 wbr_fixer；扭扭街数据终端没有坐标，所以没用它。离门罗街和萨根街站约 340 米。同上，只是普通地点 */
  "wakako-pachinko": { x: 41.4, y: 42.0, metro: true },
  /** 原作服务点 kerry_villa（北橡区），旁边的数据终端在 52.8, 38.8；最近的地铁站约 670 米，算没站 */
  "kerry-estate": { x: 51.7, y: 38.7, metro: false },
};

/**
 * 坐标直接取自路线表里某个服务点的地点：查路程时当作那个锚点，按精确路面算
 * （用户定的，2026-11-01；不用为这几处重跑 build_route_table.py）
 */
export const ROUTE_ALIASES: Readonly<Record<string, string>> = {
  "regina-office": "poi:wat_fixer",
  "wakako-pachinko": "poi:wbr_fixer",
  "kerry-estate": "poi:kerry_villa",
};

/** 城区中心：新地点没坐标时先放在这里，玩家可以拖到准确位置 */
export const DISTRICT_CENTERS: Readonly<
  Record<string, { readonly x: number; readonly y: number }>
> = {
  沃森: { x: 28.7, y: 23.7 },
  市政中心: { x: 29.4, y: 48.2 },
  威斯特布鲁克: { x: 48.9, y: 40.7 },
  海伍德: { x: 23.5, y: 61.3 },
  圣多明戈: { x: 48.5, y: 70.8 },
  太平洲: { x: 15.8, y: 78.7 },
  狗镇: { x: 27.7, y: 85.5 },
  /** 恶土没有城区轮廓，用图钉中位数 */
  恶土: { x: 67.9, y: 74.9 },
};
