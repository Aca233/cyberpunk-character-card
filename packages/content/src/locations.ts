import { worldRules } from "@cp/core";

/** 常用地点：界面显示中文名，模型换地点时优先用这些 id；表外的地点模型直接写中文名 */
export const locations = worldRules.LocationCatalogSchema.parse([
  {
    id: "lizzies-bar",
    name: "丽姿酒吧",
    district: "沃森",
    note: "歌舞伎区的超梦酒吧，莫克斯帮罩着",
    zone: "gang",
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
    zone: "gang",
  },
  {
    id: "coyote-cojo",
    name: "野狼酒吧",
    district: "海伍德",
    note: "瓦伦蒂诺帮附近的老街坊酒吧",
    zone: "gang",
  },
  {
    id: "corpo-plaza",
    name: "公司广场",
    district: "市中心",
    note: "荒坂塔下的公司区",
    zone: "corp",
  },
  {
    id: "grand-imperial-mall",
    name: "大帝国商场",
    district: "太平洲",
    note: "废弃商场，巫毒帮出没",
    zone: "gang",
  },
  { id: "dogtown", name: "狗镇", district: "狗镇", note: "军阀统治的封闭区" },
  { id: "badlands", name: "恶土", district: "恶土", note: "城外的荒漠，游牧帮派的地方" },
]);
