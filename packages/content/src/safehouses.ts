import { safehouseRules } from "@cp/core";

/**
 * 开局住所：按出身模块给一处，有床、存放箱和衣柜，不收房租。
 * H10 的公寓是原作里 V 的住处；按出身分到别处是本作改编
 */
export const homes = safehouseRules.HomeCatalogSchema.parse([
  {
    id: "home-h10",
    origin: "default",
    name: "H10 的公寓",
    location: "megabuilding-h10",
    poiIds: ["poi:v_room"],
    tenure: "rented",
    rentAmount: 1200,
    rentPeriodDays: 30,
    note: "超级摩天楼 H10 里租住的小公寓（每 30 天水电房租 1,200€）：床、衣柜、存放箱，窗外是沃森区的霓虹与高架桥",
    source: "原作依据 2.1（V 在 H10 的公寓）",
  },
  {
    id: "home-nomad-trailer",
    origin: "nomad",
    origins: ["nomad", "origin-badlands-smuggler", "origin-badlands-tech", "origin-badlands-scout"],
    name: "恶土营地的拖车",
    location: "badlands",
    tenure: "owned",
    note: "停在城外营地边上的旧拖车：免房租，一张床、一个上锁的箱子，但偏远进城要开车",
    source: "本作改编",
  },
  {
    id: "home-corpo-flat",
    origin: "corpo",
    origins: ["corpo", "origin-corpo-pr", "origin-corpo-counterintel"],
    name: "公司公寓",
    location: "corpo-plaza",
    tenure: "rented",
    rentAmount: 2500,
    rentPeriodDays: 30,
    note: "市政中心公司配租的小公寓（每 30 天物业杂费 2,500€），干净、冷清，门禁记着你什么时候进出",
    source: "本作改编",
  },
]);

/**
 * 能买下的公寓：原作 2.0 起在 EZ 地产一次付清买下，与地图 4 处 rent / apartment POI 精确绑定。
 */
export const apartments = safehouseRules.ApartmentCatalogSchema.parse([
  {
    id: "apartment-northside",
    name: "北区汽车旅馆公寓",
    location: "poi:nid",
    poiIds: ["poi:nid", "poi:dlc6_apart_wat_nid"],
    price: 10_000,
    note: "沃森北区汽车旅馆改造的单间：简陋但隐蔽，有床、存放箱与独立门锁，适合避风头",
    source: "原作依据 2.0（北区公寓，EZ 地产售价 10,000）",
  },
  {
    id: "apartment-japantown",
    name: "日本街公寓",
    location: "japantown",
    poiIds: ["poi:japantown", "poi:dlc6_apart_wbr_jpn"],
    price: 30_000,
    note: "日本街霓虹招牌后面的一间小公寓：床、存放箱、衣柜，楼下一整夜都是夜市的声音",
    source: "原作依据 2.0（日本街公寓，EZ 地产售价 30,000）",
  },
  {
    id: "apartment-glen",
    name: "格伦复式公寓",
    location: "coyote-cojo",
    poiIds: ["poi:glen", "poi:dlc6_apart_hey_gle"],
    price: 40_000,
    note: "海伍德格伦区的挑高复式公寓：宽敞书架、咖啡机与台球桌，视野开阔且私密",
    source: "原作依据 2.0（格伦公寓，EZ 地产售价 40,000）",
  },
  {
    id: "apartment-corpo-plaza",
    name: "公司广场公寓",
    location: "corpo-plaza",
    poiIds: ["poi:city_centre", "poi:dlc6_apart_cct_dtn"],
    price: 110_000,
    note: "市政中心高层的大公寓，落地窗、门禁和保安齐全，住在这里说明你已经混出了头",
    source: "原作依据 2.0（公司广场公寓，EZ 地产售价 110,000）",
  },
]);
