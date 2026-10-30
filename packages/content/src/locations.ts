import { worldRules } from "@cp/core";
import { MAP_SPOTS } from "./map";

/** 常用地点：界面显示中文名，模型换地点时优先用这些 id；表外的地点模型直接写中文名 */
const table = [
  {
    id: "lizzies-bar",
    name: "丽姿酒吧",
    district: "沃森",
    note: "歌舞伎区的超梦酒吧，莫克斯帮罩着",
  },
  { id: "afterlife", name: "来生酒吧", district: "沃森", note: "佣兵和中间人的老地方" },
  {
    id: "kabuki-market",
    name: "歌舞伎市场",
    district: "沃森",
    note: "摊贩、黑市义体和面馆挤在一起",
  },
  {
    id: "megabuilding-h10",
    name: "超级摩天楼 H10",
    district: "沃森",
    note: "上万人住的公寓楼，楼下有商店和诊所",
  },
  { id: "vik-clinic", name: "维克多的诊所", district: "沃森", note: "义体医生维克多开的小诊所" },
  { id: "tom-diner", name: "汤姆饭店", district: "沃森", note: "沃森的老式餐馆，适合约人谈事" },
  {
    id: "japantown",
    name: "日本街",
    district: "威斯特布鲁克",
    note: "霓虹、夜市和虎爪帮的地盘",
  },
  {
    id: "coyote-cojo",
    name: "野狼酒吧",
    district: "海伍德",
    note: "瓦伦蒂诺帮附近的老街坊酒吧",
  },
  {
    id: "corpo-plaza",
    name: "公司广场",
    district: "市政中心",
    note: "荒坂塔下的公司区",
  },
  {
    id: "grand-imperial-mall",
    name: "大帝国商场",
    district: "太平洲",
    note: "废弃商场，巫毒帮出没",
  },
  { id: "dogtown", name: "狗镇", district: "狗镇", note: "军阀统治的封闭区" },
  // 下面三处给原作人物当常驻地点（用户定的补卡）；名字和说明照本机文本库，2026-10-29 查。没有坐标，暂不上地图
  {
    // 文本库 journal-codex-locations-Regina_hq：歌舞伎区刃集团摩天楼的顶层，离丽姿酒吧不远
    id: "regina-office",
    name: "瑞吉娜·琼斯的办公室",
    district: "沃森",
    note: "歌舞伎区一栋摩天楼的整个顶层，中间人瑞吉娜在这里打理生意",
  },
  {
    // 文本库 fastTravel WakakosPachinkoParlor，和歌子词条：扭扭街的一家柏青哥店
    id: "wakako-pachinko",
    name: "和歌子的柏青哥店",
    district: "威斯特布鲁克",
    note: "日本街扭扭街上的柏青哥店，中间人冈田和歌子在噪声里谈生意",
  },
  {
    // 文本库 fastTravel Kerry_Estate 和对应地点词条：北橡区，设计师操刀，很多房间空着
    id: "kerry-estate",
    name: "克里·欧罗迪恩的别墅",
    district: "威斯特布鲁克",
    note: "北橡区的豪宅，一墙古董吉他，很多房间像没人进去过",
  },
  { id: "badlands", name: "恶土", district: "恶土", note: "城外的荒漠，游牧帮派的地方" },
];

/** 地图坐标在 map.ts，这里合进地点表 */
export const locations = worldRules.LocationCatalogSchema.parse(
  table.map((l) => ({ ...l, ...MAP_SPOTS[l.id] })),
);
