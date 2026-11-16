import { cyberwareRules } from "@cp/core";
import { cyberware } from "./cyberware";
import { poiRipperdocs } from "./merchant-sites";

/**
 * 义体医生：维克多的货最全、价钱公道；歌舞伎市场的黑市医生便宜两成，但货来路不明。
 * 维克多肯赊账，黑市医生只收现钱；实际货物与服务条件以持续保存的诊所状态为准。
 * 针眼是本作自创人物；地图诊所的开局备货是本作设定，不是原作库存复刻。
 */
export const ripperdocs = cyberwareRules.RipperdocListSchema.parse([
  {
    id: "viktor",
    name: "维克多",
    keeperNpc: "viktor",
    location: "vik-clinic",
    note: "老派义体医生，手艺好、收价公道，不卖来路不明的货",
    shelf: cyberware.filter((c) => !c.iconic).map((c) => c.id),
    credit: 20000,
  },
  {
    id: "needle",
    name: "针眼",
    location: "kabuki-market",
    note: "歌舞伎市场里摆摊的黑市义体医生，不问来路，也不保修",
    priceFactor: 0.8,
    blackMarket: true,
    shelf: [
      "kiroshi-mk1",
      "kiroshi-mk2",
      "militech-paraline",
      "biotech-sigma",
      "raven-microcyber",
      "zetatech-sandevistan",
      "kerenzikov",
      "subdermal-armor",
      "optical-camo",
      "smart-link",
      "reinforced-tendons",
      "gorilla-arms",
      "mantis-blades",
      "monowire",
    ],
  },
  ...poiRipperdocs,
]);
