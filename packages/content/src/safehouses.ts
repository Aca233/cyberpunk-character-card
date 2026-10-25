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

/**
 * 能买下的公寓：原作 2.0 起在 EZ 地产一次付清买下，这里在那个地点的界面上买。
 * 北区（沃森）和格伦（海伍德）的公寓地点表里还没有，北区的价钱各处说法不一（5,000 或 10,000），先不放
 */
export const apartments = safehouseRules.ApartmentCatalogSchema.parse([
  {
    id: "apartment-japantown",
    name: "日本街公寓",
    location: "japantown",
    price: 30_000,
    note: "日本街霓虹招牌后面的一间小公寓：床、存放箱、衣柜，楼下一整夜都是夜市的声音",
    source: "原作依据 2.0（日本街公寓，EZ 地产售价 30,000）",
  },
  {
    id: "apartment-corpo-plaza",
    name: "公司广场公寓",
    location: "corpo-plaza",
    price: 110_000,
    note: "市政中心高层的大公寓，落地窗、门禁和保安齐全，住在这里说明你已经混出了头",
    source: "原作依据 2.0（公司广场公寓，EZ 地产售价 110,000）",
  },
]);
