// 由本机解包目录的 _unpack/build_map.py 生成（读原作 2.x 游戏文件），不要手改
// 原作依据：base/entities/cameras/3dmap/3dmap_view.ent 里世界地图的城区悬停区域
// 坐标：底图宽、高的百分比；底图范围 X -3900..3900、Y -3700..4100（米，X 向东、Y 向北）
export interface DistrictShape {
  readonly id: string;
  readonly name: string;
  readonly label: readonly [number, number];
  readonly points: string;
}
export interface SubdistrictShape {
  readonly id: string;
  readonly district: string;
  readonly name: string;
  readonly label: readonly [number, number];
  readonly points: string;
}
export const DISTRICT_SHAPES: readonly DistrictShape[] = [
  {
    id: "watson",
    name: "沃森",
    label: [28.7, 23.7],
    points:
      "7.98,29.89 10.18,17.28 18.38,11.77 23.12,11.51 30.57,6.54 35.94,4.43 39.28,4.92 41.96,5.79 44.82,7.70 45.31,11.35 49.79,21.67 46.73,24.78 46.74,26.78 46.31,27.89 44.14,29.83 39.05,32.49 37.81,34.33 37.69,36.94 36.51,40.56 35.36,42.14 22.45,42.37 19.06,33.31",
  },
  {
    id: "westbrook",
    name: "威斯特布鲁克",
    label: [48.9, 40.7],
    points:
      "57.10,49.23 61.90,55.08 62.49,58.94 54.61,60.39 48.16,56.18 47.91,56.53 40.26,51.33 39.63,47.97 36.32,46.06 35.36,42.14 36.51,40.56 37.69,36.94 37.81,34.33 39.05,32.49 44.14,29.83 46.31,27.89 46.74,26.78 46.73,24.78 49.79,21.67 50.78,24.16 55.08,29.47 55.30,30.92 57.00,31.61 57.72,33.29 60.74,36.27 64.32,37.02 63.87,45.39",
  },
  {
    id: "city_center",
    name: "市政中心",
    label: [29.4, 48.2],
    points:
      "27.65,53.98 28.68,56.36 30.27,57.56 33.44,57.41 35.28,55.64 35.78,53.41 37.32,52.00 35.30,50.30 37.59,46.77 36.32,46.06 35.36,42.14 22.45,42.37 17.82,45.15 14.77,42.27 11.16,46.03 14.54,49.23 14.48,53.66",
  },
  {
    id: "heywood",
    name: "海伍德",
    label: [23.5, 61.3],
    points:
      "32.82,71.32 45.02,54.35 40.26,51.33 39.63,47.97 37.59,46.77 35.30,50.30 37.32,52.00 35.86,53.23 35.52,55.12 34.88,56.16 34.04,57.06 32.28,57.68 29.78,57.34 28.98,56.71 27.81,54.96 27.65,53.98 14.48,53.66 15.52,62.78 17.18,66.06 20.14,67.73 21.22,70.57",
  },
  {
    id: "santo_domingo",
    name: "圣多明戈",
    label: [48.5, 70.8],
    points:
      "54.61,60.39 48.16,56.18 47.91,56.53 45.02,54.35 32.82,71.32 33.06,72.56 34.71,73.63 36.33,76.17 39.70,79.43 43.08,81.79 45.32,83.08 50.68,82.79 52.36,85.96 55.62,86.93 56.63,86.05 57.76,83.55 59.80,81.60 60.18,80.48 60.77,80.31 62.18,78.01 62.62,71.92 65.08,62.84 64.52,61.26 62.49,58.94",
  },
  {
    id: "pacifica",
    name: "太平洲",
    label: [15.8, 78.7],
    points:
      "27.44,80.20 30.52,77.33 31.24,75.40 31.47,75.87 34.49,75.14 35.97,76.30 36.24,76.06 34.35,73.30 33.06,72.57 32.81,71.31 24.26,70.89 18.91,71.67 14.29,68.33 9.61,74.10 3.79,80.07 8.86,87.54 9.83,86.43 11.67,88.14 17.00,87.17 18.98,86.24 18.74,85.80 20.90,84.35 22.93,81.95 23.55,82.44 23.31,82.20 23.72,82.10 23.20,81.62 23.66,81.01 24.11,81.48 24.37,81.01 25.14,81.16 26.70,79.41",
  },
  {
    id: "dogtown",
    name: "狗镇",
    label: [27.7, 85.5],
    points:
      "16.98,87.18 15.09,89.09 17.20,90.81 20.70,94.95 33.06,88.03 39.47,79.59 37.10,76.86 34.53,75.13 31.52,75.94 31.27,75.43 30.54,77.33 28.41,79.61 27.33,80.13 26.66,79.48 24.91,81.29 24.39,80.99 24.11,81.49 23.66,81.02 23.20,81.60 23.71,82.09 23.31,82.20 23.48,82.51 22.93,81.95 20.13,85.22 18.74,85.82 19.00,86.25",
  },
];
export const SUBDISTRICT_SHAPES: readonly SubdistrictShape[] = [
  {
    id: "kabuki",
    district: "watson",
    name: "歌舞伎区",
    label: [37.0, 30.5],
    points:
      "33.60,39.94 36.51,40.56 37.69,36.94 37.81,34.33 39.05,32.49 40.36,31.51 39.48,26.83 39.93,25.58 38.04,23.63 32.70,26.04 34.24,28.96",
  },
  {
    id: "little_china",
    district: "watson",
    name: "小唐人街",
    label: [27.2, 35.9],
    points:
      "22.45,42.37 35.36,42.14 36.51,40.56 33.60,39.94 34.24,28.96 33.29,27.67 29.55,28.38 28.08,28.03 19.06,33.31",
  },
  {
    id: "northside",
    district: "watson",
    name: "北区",
    label: [36.2, 14.4],
    points:
      "33.29,27.67 32.70,26.04 38.04,23.63 39.93,25.58 39.48,26.83 40.36,31.51 44.14,29.83 46.31,27.89 46.73,24.78 49.79,21.67 45.31,11.35 44.82,7.70 41.96,5.79 35.94,4.43 30.57,6.54 23.12,11.51 18.38,11.77 21.14,16.11 20.45,16.55 22.07,19.08 23.32,19.06 28.08,28.03 29.55,28.38",
  },
  {
    id: "arasaka_waterfront",
    district: "watson",
    name: "荒坂海滨",
    label: [16.8, 24.6],
    points:
      "19.07,33.39 28.08,28.03 23.32,19.06 22.08,19.07 20.45,16.55 21.14,16.11 18.38,11.77 10.18,17.28 7.98,29.89",
  },
  {
    id: "japan_town",
    district: "westbrook",
    name: "日本街",
    label: [42.6, 41.7],
    points:
      "36.32,46.06 39.63,47.97 40.26,51.33 44.51,54.05 46.28,50.68 47.38,46.25 49.09,45.01 49.32,43.87 48.64,42.24 49.48,41.98 49.30,41.15 49.74,41.04 48.72,36.34 47.38,36.54 47.71,34.42 48.82,32.81 47.62,26.48 46.85,25.84 46.31,27.89 44.14,29.83 39.05,32.49 37.81,34.33 37.69,36.94 36.51,40.56 35.36,42.14",
  },
  {
    id: "charter_hill",
    district: "westbrook",
    name: "宪章山",
    label: [54.6, 54.5],
    points:
      "48.16,56.18 54.61,60.39 62.49,58.94 61.90,55.08 57.13,49.29 53.37,49.13 49.67,46.65 49.05,44.97 47.38,46.25 46.28,50.68 44.51,54.05 47.91,56.53",
  },
  {
    id: "north_oak",
    district: "westbrook",
    name: "北橡区",
    label: [56.5, 41.8],
    points:
      "49.05,44.97 49.67,46.65 53.37,49.13 57.13,49.29 63.87,45.39 64.32,37.02 60.74,36.27 57.72,33.29 57.00,31.61 55.30,30.92 55.08,29.47 50.78,24.16 49.79,21.67 46.73,24.78 48.63,30.52 48.82,32.81 47.71,34.42 47.38,36.54 48.72,36.34 49.74,41.04 49.30,41.15 49.48,41.98 48.64,42.24 49.32,43.87",
  },
  {
    id: "corpo_plaza",
    district: "city_center",
    name: "公司广场",
    label: [32.1, 47.0],
    points:
      "28.68,56.36 30.27,57.56 33.44,57.41 35.28,55.64 35.78,53.41 37.32,52.00 35.30,50.30 37.59,46.77 36.32,46.06 35.36,42.14 28.03,42.46 27.62,47.97 27.48,48.48 26.68,48.44 26.47,53.95 27.65,53.98",
  },
  {
    id: "downtown",
    district: "city_center",
    name: "市中心",
    label: [21.6, 48.7],
    points:
      "14.48,53.66 26.47,53.95 26.68,48.44 27.52,48.50 28.03,42.46 22.45,42.37 17.82,45.15 14.77,42.27 11.16,46.03 14.54,49.23",
  },
  {
    id: "glen",
    district: "heywood",
    name: "谷地区",
    label: [30.0, 65.1],
    points:
      "24.11,70.59 32.82,71.32 36.72,65.89 35.67,62.29 34.88,56.16 33.44,57.41 31.08,57.69 28.98,56.71 27.65,53.98 24.36,53.90",
  },
  {
    id: "vista_del_rey",
    district: "heywood",
    name: "丽景区",
    label: [39.5, 55.5],
    points:
      "35.67,62.29 36.72,65.89 45.02,54.35 40.26,51.33 39.63,47.97 37.59,46.77 35.30,50.30 37.32,52.00 35.86,53.23 34.88,56.16",
  },
  {
    id: "wellspring",
    district: "heywood",
    name: "美泉区",
    label: [19.8, 58.6],
    points: "21.22,70.57 24.11,70.59 24.36,53.90 14.48,53.66 15.52,62.78 17.18,66.06 20.14,67.73",
  },
  {
    id: "arroyo",
    district: "santo_domingo",
    name: "河谷区",
    label: [43.6, 67.0],
    points:
      "43.50,81.91 45.65,79.38 42.18,76.93 44.27,75.70 46.28,73.02 46.73,73.34 55.64,60.39 53.69,60.01 45.02,54.35 32.82,71.32 33.06,72.56 34.71,73.63 36.33,76.17 39.70,79.43",
  },
  {
    id: "rancho_coronado",
    district: "santo_domingo",
    name: "科罗纳多农场",
    label: [54.8, 74.9],
    points:
      "42.18,76.93 45.65,79.38 43.50,81.91 45.32,83.08 50.68,82.79 52.36,85.96 55.62,86.93 62.18,78.01 62.62,71.91 65.08,62.84 64.52,61.26 62.49,58.94 55.64,60.39 46.73,73.34 46.28,73.02 44.27,75.70",
  },
  {
    id: "coastview",
    district: "pacifica",
    name: "海景区",
    label: [22.7, 76.1],
    points:
      "27.44,80.20 30.52,77.33 31.24,75.40 31.47,75.87 34.49,75.14 35.97,76.30 36.24,76.06 34.35,73.30 33.06,72.57 32.81,71.31 24.26,70.89 18.91,71.67 15.50,77.11 20.84,84.30 22.93,81.95 23.55,82.44 23.20,81.62 23.66,81.01 24.11,81.48 24.37,81.01 25.14,81.16 26.70,79.41",
  },
  {
    id: "west_wind_estate",
    district: "pacifica",
    name: "西风庄园",
    label: [11.4, 80.9],
    points:
      "9.84,86.44 11.63,88.15 16.98,87.18 18.98,86.26 18.73,85.82 20.89,84.35 15.62,77.18 19.05,71.59 14.28,68.34 3.82,80.09 8.88,87.54",
  },
];

// 原作依据：base/worlds/03_night_city/_compiled/default/03_night_city.poimappins（2.x 本体），
// 图钉种类取自 mappinData.typedVariant；类别名取自文本库 UI-MappinTypes-*。不含往日之影的狗镇图钉
export type MapPoiKind =
  | "fixer"
  | "ripperdoc"
  | "gun"
  | "melee"
  | "netrunner"
  | "clothes"
  | "meds"
  | "junk"
  | "food"
  | "bar"
  | "apartment"
  | "rent"
  | "autofixer";
export interface MapPoiKindInfo {
  readonly id: MapPoiKind;
  readonly name: string;
  readonly source: string;
}
export const MAP_POI_KINDS: readonly MapPoiKindInfo[] = [
  { id: "fixer", name: "中间人", source: "text:UI-MappinTypes-Fixer" },
  { id: "ripperdoc", name: "义体医生", source: "text:UI-MappinTypes-RipperdocServicePoint" },
  { id: "gun", name: "武器店", source: "text:UI-MappinTypes-GunServicePoint" },
  { id: "melee", name: "近战武器商贩", source: "text:UI-MappinTypes-MeleeServicePoint" },
  { id: "netrunner", name: "网络黑客", source: "text:UI-MappinTypes-NetTrainerServicePoint" },
  { id: "clothes", name: "服装", source: "text:UI-MappinTypes-ClothingServicePoint" },
  { id: "meds", name: "医疗点", source: "text:UI-MappinTypes-MedicineServicePoint" },
  { id: "junk", name: "垃圾商店", source: "text:UI-MappinTypes-JunkServicePoint" },
  { id: "food", name: "饮食", source: "text:UI-MappinTypes-FoodServicePoint" },
  { id: "bar", name: "酒吧", source: "text:UI-MappinTypes-BarServicePoint" },
  { id: "apartment", name: "公寓", source: "text:UI-MappinTypes-Apartment" },
  { id: "rent", name: "公寓出租", source: "text:UI-MappinTypes-ApartmentToPurchase" },
  { id: "autofixer", name: "好车中间人终端", source: "text:UI-MappinTypes-CarForPurchase" },
];
export interface MapPoi {
  readonly id: string;
  readonly kind: MapPoiKind;
  readonly x: number;
  readonly y: number;
  readonly sub: string | null;
}
export const MAP_POIS: readonly MapPoi[] = [
  { id: "v_room", kind: "apartment", x: 32.3, y: 36.3, sub: "little_china" },
  { id: "kerry_villa", kind: "apartment", x: 51.7, y: 38.7, sub: "north_oak" },
  { id: "nomad_camp_01", kind: "apartment", x: 94.1, y: 57.3, sub: null },
  { id: "nomad_camp_02", kind: "apartment", x: 72.9, y: 23.7, sub: null },
  { id: "river_trailer_park", kind: "apartment", x: 65.8, y: 59.2, sub: null },
  { id: "judys_apartment", kind: "apartment", x: 38.5, y: 28.7, sub: "kabuki" },
  { id: "dlc6_apart_cct_dtn", kind: "apartment", x: 29.4, y: 48.0, sub: "corpo_plaza" },
  { id: "dlc6_apart_hey_gle", kind: "apartment", x: 30.4, y: 65.0, sub: "glen" },
  { id: "dlc6_apart_wat_nid", kind: "apartment", x: 30.7, y: 24.0, sub: "northside" },
  { id: "dlc6_apart_wbr_jpn", kind: "apartment", x: 39.9, y: 40.0, sub: "japan_town" },
  { id: "wat_lch_clothingshop_01", kind: "clothes", x: 30.4, y: 30.7, sub: "little_china" },
  { id: "wat_lch_foodshop_02", kind: "food", x: 25.3, y: 37.8, sub: "little_china" },
  { id: "wat_lch_foodshop_03", kind: "bar", x: 28.9, y: 39.7, sub: "little_china" },
  { id: "wat_lch_gunsmith_01", kind: "gun", x: 31.4, y: 35.7, sub: "little_china" },
  { id: "wat_lch_melee_01", kind: "melee", x: 31.7, y: 35.4, sub: "little_china" },
  { id: "wat_nid_clothingshop_01", kind: "clothes", x: 25.7, y: 20.5, sub: "northside" },
  { id: "wat_nid_foodshop_01", kind: "food", x: 25.5, y: 17.4, sub: "northside" },
  { id: "wat_nid_foodshop_02", kind: "bar", x: 28.0, y: 24.1, sub: "northside" },
  { id: "wat_nid_gunsmith_01", kind: "gun", x: 25.8, y: 17.6, sub: "northside" },
  { id: "wat_nid_medicstore_01", kind: "meds", x: 29.7, y: 25.9, sub: "northside" },
  { id: "wat_nid_ripperdoc_01", kind: "ripperdoc", x: 28.3, y: 22.0, sub: "northside" },
  { id: "wat_kab_foodshop_01", kind: "food", x: 35.0, y: 26.6, sub: "kabuki" },
  { id: "wat_kab_foodshop_02", kind: "bar", x: 35.0, y: 32.4, sub: "kabuki" },
  { id: "wat_kab_foodshop_03", kind: "food", x: 34.2, y: 27.1, sub: "kabuki" },
  { id: "wat_kab_foodshop_04", kind: "bar", x: 36.8, y: 35.2, sub: "kabuki" },
  { id: "wat_kab_gun_trainer_01", kind: "gun", x: 34.5, y: 26.3, sub: "kabuki" },
  { id: "wat_kab_gunsmith_02", kind: "gun", x: 39.3, y: 24.3, sub: "northside" },
  { id: "wat_kab_junkshop_01", kind: "junk", x: 36.9, y: 34.1, sub: "kabuki" },
  { id: "wat_kab_netrunner_01", kind: "netrunner", x: 34.9, y: 26.4, sub: "kabuki" },
  { id: "wat_kab_ripperdoc_01", kind: "ripperdoc", x: 36.7, y: 34.0, sub: "kabuki" },
  { id: "wat_kab_ripperdoc_02", kind: "ripperdoc", x: 36.0, y: 25.0, sub: "kabuki" },
  { id: "wat_kab_ripperdoc_03", kind: "ripperdoc", x: 34.1, y: 27.6, sub: "kabuki" },
  { id: "wat_lch_melee_02", kind: "melee", x: 25.7, y: 36.5, sub: "little_china" },
  { id: "wat_lch_foodshop_01", kind: "bar", x: 31.4, y: 39.6, sub: "little_china" },
  { id: "wat_kab_medicstore_01", kind: "meds", x: 37.8, y: 29.8, sub: "kabuki" },
  { id: "wat_nid_medicstore_02", kind: "meds", x: 25.2, y: 17.4, sub: "northside" },
  { id: "wat_kab_clothingshop_01", kind: "clothes", x: 35.6, y: 30.1, sub: "kabuki" },
  { id: "wat_lch_medicstore_01", kind: "meds", x: 28.2, y: 36.5, sub: "little_china" },
  { id: "wbr_hil_clothingshop_01", kind: "clothes", x: 47.1, y: 53.0, sub: "charter_hill" },
  { id: "wbr_hil_foodshop_01", kind: "bar", x: 46.7, y: 53.2, sub: "charter_hill" },
  { id: "wbr_hil_ripperdoc_01", kind: "ripperdoc", x: 49.5, y: 53.2, sub: "charter_hill" },
  { id: "wbr_jpn_foodshop_05", kind: "food", x: 37.6, y: 30.5, sub: "kabuki" },
  { id: "wbr_jpn_foodshop_05_japantown", kind: "food", x: 42.6, y: 36.2, sub: "japan_town" },
  { id: "wat_lch_ripperdoc_01", kind: "ripperdoc", x: 30.2, y: 36.8, sub: "little_china" },
  { id: "cct_cpz_foodstore_01", kind: "bar", x: 30.5, y: 56.7, sub: "corpo_plaza" },
  { id: "cct_cpz_clothingstore_02", kind: "clothes", x: 29.8, y: 56.2, sub: "corpo_plaza" },
  { id: "cct_cpz_foodstore_02", kind: "food", x: 30.2, y: 56.5, sub: "corpo_plaza" },
  { id: "cct_cpz_medicstore_01", kind: "meds", x: 35.5, y: 49.6, sub: "corpo_plaza" },
  { id: "std_rcr_cloth_01", kind: "clothes", x: 53.3, y: 71.4, sub: "rancho_coronado" },
  { id: "std_rcr_foodshop_01", kind: "food", x: 54.2, y: 73.4, sub: "rancho_coronado" },
  { id: "std_rcr_guns_01", kind: "gun", x: 57.3, y: 80.8, sub: "rancho_coronado" },
  { id: "std_rcr_medic_01", kind: "meds", x: 55.6, y: 71.1, sub: "rancho_coronado" },
  { id: "hey_rey_netrunner_01_mp", kind: "netrunner", x: 39.0, y: 57.5, sub: "vista_del_rey" },
  { id: "hey_rey_03_food", kind: "food", x: 38.2, y: 55.3, sub: "vista_del_rey" },
  { id: "hey_rey_food_02", kind: "bar", x: 39.8, y: 53.7, sub: "vista_del_rey" },
  { id: "hey_rey_food_04", kind: "food", x: 38.7, y: 61.1, sub: "vista_del_rey" },
  { id: "hey_rey_guns_01", kind: "gun", x: 38.4, y: 61.6, sub: "vista_del_rey" },
  { id: "cct_dtn_cloth_01", kind: "clothes", x: 25.8, y: 51.5, sub: "downtown" },
  { id: "cct_dtn_food_01", kind: "bar", x: 29.2, y: 47.8, sub: "corpo_plaza" },
  { id: "cct_dtn_food_02", kind: "bar", x: 25.2, y: 53.1, sub: "downtown" },
  { id: "cct_dtn_guns_01", kind: "gun", x: 27.3, y: 49.7, sub: "corpo_plaza" },
  { id: "cct_dtn_medic_01", kind: "meds", x: 25.9, y: 47.7, sub: "downtown" },
  { id: "cct_dtn_ripdoc_01", kind: "ripperdoc", x: 19.0, y: 47.5, sub: "downtown" },
  { id: "hey_spr_ripperdoc_01", kind: "ripperdoc", x: 19.7, y: 64.4, sub: "wellspring" },
  { id: "hey_spr_medic_01", kind: "meds", x: 22.0, y: 64.6, sub: "wellspring" },
  { id: "hey_spr_food_01", kind: "food", x: 19.1, y: 59.5, sub: "wellspring" },
  { id: "hey_spr_cloth_01", kind: "clothes", x: 18.7, y: 61.1, sub: "wellspring" },
  { id: "hey_spr_guns_01", kind: "gun", x: 19.2, y: 60.6, sub: "wellspring" },
  { id: "wbr_jpn_guns_01", kind: "gun", x: 44.1, y: 33.9, sub: "japan_town" },
  { id: "wbr_jpn_ws_melee_01", kind: "melee", x: 45.7, y: 45.3, sub: "japan_town" },
  { id: "wbr_jpn_cloth_01", kind: "clothes", x: 41.2, y: 36.7, sub: "japan_town" },
  { id: "wbr_jpn_food_01", kind: "food", x: 41.6, y: 40.7, sub: "japan_town" },
  { id: "wbr_jpn_food_02", kind: "food", x: 41.1, y: 42.6, sub: "japan_town" },
  { id: "wbr_jpn_food_03", kind: "food", x: 41.7, y: 41.7, sub: "japan_town" },
  { id: "wbr_jpn_food_04", kind: "food", x: 43.8, y: 45.1, sub: "japan_town" },
  { id: "wbr_jpn_junk_01", kind: "junk", x: 41.4, y: 41.6, sub: "japan_town" },
  { id: "wbr_jpn_junk_02", kind: "junk", x: 42.1, y: 42.2, sub: "japan_town" },
  { id: "wbr_jpn_junk_03", kind: "junk", x: 50.6, y: 31.6, sub: "north_oak" },
  { id: "wbr_jpn_medic_01", kind: "meds", x: 44.4, y: 34.2, sub: "japan_town" },
  { id: "wbr_jpn_netrun_01", kind: "netrunner", x: 45.5, y: 35.0, sub: "japan_town" },
  { id: "wbr_jpn_netrun_02", kind: "netrunner", x: 43.8, y: 45.2, sub: "japan_town" },
  { id: "wbr_jpn_ripdoc_01", kind: "ripperdoc", x: 40.8, y: 41.4, sub: "japan_town" },
  { id: "wbr_jpn_netrunner_02", kind: "ripperdoc", x: 42.6, y: 42.4, sub: "japan_town" },
  { id: "wbr_jpn_tech_01", kind: "junk", x: 41.3, y: 40.8, sub: "japan_town" },
  { id: "pac_cvi_clothing_01", kind: "clothes", x: 18.3, y: 85.1, sub: "west_wind_estate" },
  { id: "pac_cvi_food_01", kind: "food", x: 25.3, y: 77.1, sub: "coastview" },
  { id: "pac_cvi_medic_01", kind: "meds", x: 25.6, y: 76.9, sub: "coastview" },
  { id: "pac_cvi_tech_01", kind: "netrunner", x: 25.5, y: 77.2, sub: "coastview" },
  { id: "hey_gle_food_01", kind: "food", x: 27.9, y: 68.6, sub: "glen" },
  { id: "hey_gle_food_02", kind: "bar", x: 30.5, y: 66.7, sub: "glen" },
  { id: "hey_gle_guns_01", kind: "gun", x: 25.7, y: 65.6, sub: "glen" },
  { id: "hey_rey_food_01", kind: "bar", x: 33.9, y: 65.4, sub: "glen" },
  { id: "std_arr_cloth_01", kind: "clothes", x: 37.0, y: 72.6, sub: "arroyo" },
  { id: "std_arr_food_01", kind: "bar", x: 40.7, y: 65.4, sub: "arroyo" },
  { id: "std_arr_food_02", kind: "food", x: 37.4, y: 67.4, sub: "arroyo" },
  { id: "std_arr_guns_01", kind: "gun", x: 37.2, y: 72.9, sub: "arroyo" },
  { id: "std_arr_medic_01", kind: "meds", x: 37.1, y: 72.7, sub: "arroyo" },
  { id: "std_arr_rippdoc_01", kind: "ripperdoc", x: 36.3, y: 68.9, sub: "arroyo" },
  { id: "std_arr_melee_01", kind: "melee", x: 43.4, y: 77.1, sub: "rancho_coronado" },
  { id: "bls_ina_se1_clothingshop_01", kind: "clothes", x: 65.5, y: 59.8, sub: null },
  { id: "bls_ina_se1_foodshop_01", kind: "bar", x: 71.0, y: 62.8, sub: null },
  { id: "bls_ina_se1_foodshop_02", kind: "food", x: 65.4, y: 59.6, sub: null },
  { id: "bls_ina_se1_foodshop_03", kind: "food", x: 69.0, y: 70.5, sub: null },
  { id: "bls_ina_se_gunsmith_02", kind: "gun", x: 71.5, y: 62.5, sub: null },
  { id: "bls_ina_se1_gunsmith_01", kind: "gun", x: 94.0, y: 57.3, sub: null },
  { id: "bls_ina_se1_gunsmith_01b", kind: "gun", x: 73.0, y: 23.6, sub: null },
  { id: "bls_ina_se1_junkshop_01", kind: "junk", x: 67.8, y: 74.0, sub: null },
  { id: "bls_ina_se1_medicstore_01", kind: "meds", x: 94.2, y: 78.0, sub: null },
  { id: "bls_ina_se1_ripperdoc_01", kind: "ripperdoc", x: 94.1, y: 57.5, sub: null },
  { id: "bls_ina_se1_ripperdoc_01b", kind: "ripperdoc", x: 73.3, y: 23.4, sub: null },
  { id: "hey_gle_junkshop_01", kind: "junk", x: 26.4, y: 60.0, sub: "glen" },
  { id: "wat_fixer", kind: "fixer", x: 35.4, y: 32.5, sub: "kabuki" },
  { id: "hey_fixer", kind: "fixer", x: 26.9, y: 68.9, sub: "glen" },
  { id: "cct_fixer", kind: "fixer", x: 24.7, y: 47.7, sub: "downtown" },
  { id: "std_fixer", kind: "fixer", x: 55.3, y: 82.8, sub: "rancho_coronado" },
  { id: "bls_fixer", kind: "fixer", x: 80.9, y: 62.8, sub: null },
  { id: "wbr_fixer", kind: "fixer", x: 41.4, y: 42.0, sub: "japan_town" },
  { id: "cct_cpz_foodstore_01_duplicate_hill", kind: "bar", x: 48.7, y: 49.8, sub: "charter_hill" },
  { id: "std_arr_food_03", kind: "food", x: 36.9, y: 72.6, sub: "arroyo" },
  { id: "wat_fixer_intercom", kind: "fixer", x: 35.1, y: 32.2, sub: "kabuki" },
  { id: "std_rcr_ripperdoc_01", kind: "ripperdoc", x: 57.5, y: 80.5, sub: "rancho_coronado" },
  { id: "hey_rey_junkshop_01", kind: "junk", x: 38.9, y: 50.9, sub: "vista_del_rey" },
  { id: "pac_wwd_guns_01", kind: "gun", x: 18.7, y: 83.4, sub: "west_wind_estate" },
  { id: "pac_wwd_medic_01", kind: "ripperdoc", x: 16.6, y: 84.6, sub: "west_wind_estate" },
  { id: "pac_wwd_ripperdoc_01", kind: "melee", x: 17.5, y: 84.2, sub: "west_wind_estate" },
  { id: "std_arr_food_04", kind: "food", x: 43.1, y: 62.1, sub: "arroyo" },
  { id: "wat_awf_food_01", kind: "bar", x: 21.7, y: 29.9, sub: "arasaka_waterfront" },
  { id: "wbr_jpn_cloth_02", kind: "clothes", x: 41.4, y: 40.9, sub: "japan_town" },
  { id: "city_centre", kind: "rent", x: 29.5, y: 48.0, sub: "corpo_plaza" },
  { id: "glen", kind: "rent", x: 30.4, y: 65.1, sub: "glen" },
  { id: "japantown", kind: "rent", x: 39.9, y: 39.9, sub: "japan_town" },
  { id: "nid", kind: "rent", x: 30.7, y: 24.0, sub: "northside" },
  { id: "autofixer_spot_04", kind: "autofixer", x: 69.0, y: 70.4, sub: null },
  { id: "autofixer_spot_05", kind: "autofixer", x: 94.2, y: 78.2, sub: null },
  { id: "autofixer_spot_06", kind: "autofixer", x: 92.5, y: 72.3, sub: null },
  { id: "autofixer_spot_07", kind: "autofixer", x: 71.8, y: 62.4, sub: null },
  { id: "autofixer_spot_08", kind: "autofixer", x: 65.5, y: 60.0, sub: null },
  { id: "autofixer_spot_09", kind: "autofixer", x: 59.7, y: 65.5, sub: "rancho_coronado" },
  { id: "autofixer_spot_10", kind: "autofixer", x: 54.1, y: 63.9, sub: "rancho_coronado" },
  { id: "autofixer_spot_11", kind: "autofixer", x: 46.4, y: 76.8, sub: "rancho_coronado" },
  { id: "autofixer_spot_12", kind: "autofixer", x: 48.1, y: 77.6, sub: "rancho_coronado" },
  { id: "autofixer_spot_13", kind: "autofixer", x: 42.6, y: 62.0, sub: "arroyo" },
  { id: "autofixer_spot_15", kind: "autofixer", x: 45.3, y: 33.9, sub: "japan_town" },
  { id: "autofixer_spot_16", kind: "autofixer", x: 31.0, y: 28.1, sub: "northside" },
  { id: "autofixer_spot_19", kind: "autofixer", x: 25.9, y: 64.3, sub: "glen" },
  { id: "autofixer_spot_17_fixed", kind: "autofixer", x: 25.8, y: 77.1, sub: "coastview" },
];
