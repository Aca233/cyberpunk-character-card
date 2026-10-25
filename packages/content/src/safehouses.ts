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
    note: "超级摩天楼 H10 里的一间小公寓：床、衣柜、存放箱，窗外是沃森",
    source: "原作依据 2.1（V 在 H10 的公寓）",
  },
  {
    id: "home-h10-kid",
    origin: "street-kid",
    name: "H10 的公寓",
    location: "megabuilding-h10",
    note: "在沃森长大的人住回老地方：H10 里的一间小公寓，楼下的人多半认识你",
    source: "原作依据 2.1（V 在 H10 的公寓）；按出身分配本作改编",
  },
  {
    id: "home-nomad-trailer",
    origin: "nomad",
    name: "恶土营地的拖车",
    location: "badlands",
    note: "停在城外营地边上的旧拖车：一张床、一个上锁的箱子，进城要开车",
    source: "本作改编",
  },
  {
    id: "home-corpo-flat",
    origin: "corpo",
    name: "公司公寓",
    location: "corpo-plaza",
    note: "市政中心公司配的小公寓，干净、冷清，门禁记着你什么时候进出",
    source: "本作改编",
  },
]);
