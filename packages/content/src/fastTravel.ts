import {
  type FastTravelPoint,
  FAST_TRAVEL_POINTS as RAW_FAST_TRAVEL_POINTS,
} from "./fastTravel.gen";

/**
 * 原作 2.x 坐标覆写表：补全 fastTravel.gen.ts 中因流式扇区未挂 markerRef 而缺坐标的关键地标，
 * 参照 servicePoints.gen.ts 与 map.ts 中已核实的同址图钉坐标（不手改 .gen.ts）。
 */
const FAST_TRAVEL_COORDS: Readonly<Record<string, readonly [number, number]>> = {
  // ── 狗镇 6 处核心地标（参照 cz_* 服务点与 mq300_safehouse）──
  combat_zone_stadium_dataterm_01: [31.7, 78.7], // EBM 沛卓石化体育场（cz_stadium_* 31.4-32.2, 78.1-79.2）
  combat_zone_golden_pacific_dataterm_01: [29.4, 82.8], // 富丽太平洋（cz_fixer / cz_heavy_hearts 29.5-29.7, 82.6-83.0）
  combat_zone_luxor_high_01: [25.5, 84.3], // 庐客爽山庄健康水疗馆（cz_monument_av_ripperdoc_farida 25.5, 84.2）
  combat_zone_squat_dataterm_01: [21.3, 85.3], // 克雷斯街（mq300_safehouse 21.3, 85.3）
  combat_zone_longshore_stacks_dataterm_01: [19.4, 86.8], // 长滩堆料场（cz_con_* 18.8-19.8, 86.6-87.1）
  combat_zone_terra_cognita_dataterm_01: [29.2, 85.1], // 已知领域（cz_monument_av_* 29.1-29.3, 85.1）
  // ── 城区核心地标（参照同街区固定地点坐标）──
  wbr_jpn_dataterm_12: [41.7, 42.3], // 扭扭街（map.ts jig-jig-street）
  wat_lch_dataterm_08: [31.6, 36.1], // 埃利森广场（小唐人街 H10 周边）
  wat_kab_dataterm_11: [34.5, 29.6], // 松木交叉路口（歌舞伎区中部）
  wat_kab_dataterm_12: [33.6, 30.8], // 埃仑街（歌舞伎区西侧）
  std_arr_dataterm_09: [42.1, 69.8], // 传道海滨（河谷区西岸）
  std_rcr_dataterm_11: [53.2, 74.5], // 伍德黑文街（科罗纳多农场东侧）
  // ── 恶土关键据点（参照 bls_* 服务点实测坐标）──
  bls_nth_dataterm_01: [71.2, 62.7], // 日落汽车旅馆（bls_ina_se1_foodshop_01 71.0, 62.8）
  bls_nth_dataterm_02: [69.0, 70.4], // 梅德斯基加油站（autofixer_spot_04 / foodshop_03 69.0, 70.4）
  bls_nth_dataterm_04: [80.9, 62.8], // 石脊山（bls_fixer 80.9, 62.8）
  bls_nth_dataterm_05: [36.2, 11.4], // 油田（北部油田荒地）
  bls_nth_dataterm_08: [58.6, 61.5], // 大坝（圣多明戈东侧水坝）
  bls_nth_dataterm_10: [87.4, 51.2], // 夜游鬼营地（北部恶土东北）
  bls_nth_dataterm_11: [92.5, 72.3], // 阳光汽车旅馆（autofixer_spot_06 92.5, 72.3）
  bls_nth_dataterm_15: [65.6, 59.5], // 埃奇伍德农场（拖车公园周边 65.5, 59.6）
  bls_sth_dataterm_01: [67.8, 92.5], // 边防检查站（南部恶土国境线）
  bls_sth_dataterm_03: [74.2, 79.4], // 太阳能发电站（南部恶土中部）
  bls_sth_dataterm_04: [67.8, 74.0], // 蛋白质农场（bls_ina_se1_junkshop_01 67.8, 74.0）
  bls_sth_dataterm_06: [94.2, 78.1], // 探戈岭汽车旅馆（autofixer_spot_05 / medicstore_01 94.2, 78.0）
};

/**
 * 原作 2.x 内部废弃/无对应可落地实景的占位或重复记录（如旧测试名 Kabuki7Alley、偏远无设施高速路口），
 * 明确剔除，避免出现不可到达的空壳地标。
 */
const EXCLUDED_FAST_TRAVEL_IDS: ReadonlySet<string> = new Set([
  "InlandAvenueGasStation",
  "Kabuki7Alley",
  "KabukiLittleMacao",
  "WatsonCentral",
  "bls_nth_dataterm_07",
  "bls_nth_dataterm_09",
  "bls_nth_dataterm_12",
  "bls_nth_dataterm_13",
  "bls_nth_dataterm_14",
  "bls_nth_dataterm_16",
  "bls_nth_dataterm_17",
  "bls_sth_dataterm_02",
  "bls_sth_dataterm_05",
  "bls_sth_dataterm_08",
  "bls_sth_dataterm_09",
  "bls_sth_dataterm_10",
  "bls_sth_dataterm_11",
  "bls_sth_dataterm_12",
]);

export type { FastTravelPoint };

/** 有效可落地地标列表：已补齐 24 处核心狗镇/城区/恶土地标坐标，剔除 18 处无效/荒郊占位点 */
export const FAST_TRAVEL_POINTS: readonly FastTravelPoint[] = RAW_FAST_TRAVEL_POINTS.flatMap(
  (pt) => {
    if (EXCLUDED_FAST_TRAVEL_IDS.has(pt.id)) return [];
    const override = FAST_TRAVEL_COORDS[pt.id];
    if (override) {
      return [{ ...pt, x: override[0], y: override[1] }];
    }
    if (pt.x === null || pt.y === null) return [];
    return [pt];
  },
);
