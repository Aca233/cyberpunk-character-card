import { cyberwareRules, inventoryRules, worldRules } from "@cp/core";
import { SERVICE_POINTS, type ServicePoint } from "./mapShapes";

type ShopKind = "gun" | "melee" | "clothes" | "meds" | "food" | "bar" | "netrunner";

/** 原作地点/店名来自生成表；货架、数量与供货合同是本作的确定性开局条件。 */
const SHOP_SEEDS: Record<
  ShopKind,
  {
    name: string;
    keeper: string;
    stock: Record<string, number>;
    services: string[];
    leadMinutes: number;
  }
> = {
  gun: {
    name: "武器店",
    keeper: "武器商贩",
    stock: {
      unity: 2,
      lexington: 2,
      nova: 1,
      saratoga: 1,
      "frag-grenade": 4,
      "strix-silencer": 2,
      "kanetsugu-scope": 2,
      "smart-target-mod": 1,
    },
    services: [],
    leadMinutes: 720,
  },
  melee: {
    name: "近战武器店",
    keeper: "近战武器商贩",
    stock: {
      knife: 3,
      machete: 2,
      "baseball-bat": 2,
      knuckles: 2,
      "bleedout-mod": 2,
      "kinetic-weight-mod": 2,
    },
    services: [],
    leadMinutes: 720,
  },
  clothes: {
    name: "服装店",
    keeper: "服装商贩",
    stock: { "street-jacket": 3, "nomad-duster": 1, "techie-coverall": 2, "corpo-suit": 1 },
    services: [],
    leadMinutes: 1440,
  },
  meds: {
    name: "药店",
    keeper: "药品商贩",
    stock: { maxdoc: 6, "bounce-back": 6, "health-booster": 3 },
    services: [],
    leadMinutes: 480,
  },
  food: {
    name: "食品摊",
    keeper: "食品商贩",
    stock: { hawtdawg: 12, nicola: 12, coffee: 12 },
    services: ["meal", "drink"],
    leadMinutes: 180,
  },
  bar: {
    name: "酒吧",
    keeper: "酒保",
    stock: { nicola: 12, coffee: 8 },
    services: ["meal", "drink"],
    leadMinutes: 360,
  },
  netrunner: {
    name: "黑客商店",
    keeper: "黑客商贩",
    stock: {
      "netrunner-suit": 2,
      "emp-grenade": 3,
      "recon-grenade": 3,
      shard: 4,
      glitter: 2,
      "smart-target-mod": 1,
      "smart-link-module": 1,
    },
    services: [],
    leadMinutes: 720,
  },
};

function shopKind(kind: string): kind is ShopKind {
  return Object.hasOwn(SHOP_SEEDS, kind);
}

/** 只合并经过核对的两个原作经营者；不按同名、距离或街区猜测其他入口。 */
const KNOWN_POIS: Readonly<Record<string, string>> = {
  wat_lch_gunsmith_01: "wilson",
  wat_lch_ripperdoc_01: "viktor",
};

function merchantId(point: ServicePoint): string {
  return (
    KNOWN_POIS[point.id] ??
    `${point.kind === "ripperdoc" ? "r" : "m"}-${point.id.replaceAll("_", "-")}`
  );
}

const SUPPLY_HUBS: Readonly<Record<string, string>> = {
  watson: "kabuki-market",
  westbrook: "japantown",
  heywood: "coyote-cojo",
  santo_domingo: "corpo-plaza",
  city_center: "corpo-plaza",
  pacifica: "badlands",
  dogtown: "dogtown",
};

/** 本作改编的少量授权寄售，不声称是原作商贩的精确货架。 */
const CHIP_CONSIGNMENTS: Readonly<Record<string, Record<string, number>>> = {
  wat_lch_foodshop_02: {
    "shard-h10-laundry-book": 3,
    "shard-h10-balcony-garden": 2,
    "shard-h10-rental-checklist": 3,
  },
  wat_kab_foodshop_01: {
    "shard-stall-supper-cookbook": 3,
    "shard-stall-account-book": 2,
  },
  wat_kab_foodshop_02: {
    "shard-stage-wardrobe-guide": 3,
    "shard-afterhours-adult-review": 2,
    "shard-night-magazine": 2,
  },
  wat_nid_foodshop_02: {
    "shard-japantown-b-side": 2,
    "shard-small-stage": 2,
  },
  hey_gle_food_02: {
    "shard-cojo-open-mic": 3,
    "shard-second-shift-letters": 2,
  },
  std_arr_food_01: {
    "shard-second-shift-letters": 3,
    "shard-stall-account-book": 2,
  },
  cct_cpz_foodstore_02: {
    "shard-counter-paperwork-guide": 3,
    "shard-office-exit-zine": 2,
  },
  pac_cvi_food_01: {
    "shard-coast-screening-notes": 3,
    "shard-umbrella-repair-book": 3,
  },
  bls_ina_se1_foodshop_01: {
    "shard-route-packing-book": 3,
    "shard-used-car-check-assist": 1,
  },
};

const NETRUNNER_CHIPS: Readonly<Record<string, Record<string, number>>> = {
  watson: {
    "shard-service-assist": 2,
    "shard-stall-account-book": 2,
    "shard-counter-phrase-assist": 1,
  },
  westbrook: {
    "shard-counter-phrase-assist": 2,
    "shard-stage-wardrobe-guide": 2,
  },
  heywood: {
    "shard-pantry-scale-assist": 1,
    "shard-courtyard-recipes": 2,
    "shard-counter-phrase-assist": 1,
  },
  pacifica: {
    "shard-water-pump-assist": 1,
    "shard-umbrella-repair-book": 3,
    "shard-coast-screening-notes": 2,
  },
  dogtown: {
    "shard-water-pump-assist": 2,
    "shard-reuse-parts-catalog": 3,
    "shard-route-packing-book": 2,
  },
  badlands: {
    "shard-used-car-check-assist": 2,
    "shard-water-pump-assist": 1,
    "shard-route-packing-book": 3,
  },
};

function regionalChipStock(point: ServicePoint): Record<string, number> {
  if (point.kind !== "netrunner") return CHIP_CONSIGNMENTS[point.id] ?? {};
  return {
    "chip-reader-writer": 2,
    "blank-shard": 6,
    "shard-repair-notes": 2,
    ...(NETRUNNER_CHIPS[point.district ?? "badlands"] ?? {}),
    ...(point.id === "wbr_jpn_netrun_02" ? { "shard-umbrella-repair-book": 2 } : {}),
  };
}

export const poiShops = inventoryRules.ShopListSchema.parse(
  SERVICE_POINTS.flatMap((point) => {
    if (!shopKind(point.kind) || KNOWN_POIS[point.id]) return [];
    const seed = SHOP_SEEDS[point.kind];
    const location = `poi:${point.id}`;
    const hub = SUPPLY_HUBS[point.district ?? ""] ?? "badlands";
    const chipStock = regionalChipStock(point);
    const stock = { ...seed.stock, ...chipStock };
    return [
      {
        id: merchantId(point),
        name: point.name ?? seed.name,
        keeper: seed.keeper,
        location,
        note: `地点与店名依据原作服务点；开局备货和区域供货合同为本作设定，成交与运输会改变库存。${Object.keys(chipStock).length ? "本店另有少量本作原创芯片寄售，各片按封套的授权发行来源供货；可只问价或看标签，购买不自动阅读播放。" : ""}`,
        shelf: Object.keys(stock),
        initialStock: stock,
        supply: {
          supplier: `supply-${point.district ?? "badlands"}-${point.kind}`,
          origin: `本作开局合同：${hub} 的${seed.name}补给配送点${Object.keys(chipStock).length ? "和本区作者授权芯片寄售发行点" : ""}；只按已登记订单发货`,
          route: [hub, location],
          leadMinutes: seed.leadMinutes,
        },
      },
    ];
  }),
);

/** 少量常规备货，按开局区域供货选型；不声称是原作诊所的精确货架。 */
function clinicShelf(point: ServicePoint): string[] {
  if (point.district === "city_center" || point.district === "westbrook") {
    return [
      "kiroshi-mk2",
      "bioconductor",
      "visual-cortex-support",
      "militech-paraline",
      "smart-link",
    ];
  }
  if (point.district === "dogtown" || point.district === "pacifica" || point.district === null) {
    return ["kiroshi-mk1", "neofiber", "subdermal-armor", "biotech-sigma", "reinforced-tendons"];
  }
  return ["kiroshi-mk1", "ram-upgrade", "newton-module", "nanorelays", "smart-link"];
}

export const poiRipperdocs = cyberwareRules.RipperdocListSchema.parse(
  SERVICE_POINTS.filter((point) => point.kind === "ripperdoc" && !KNOWN_POIS[point.id]).map(
    (point) => {
      const shelf = clinicShelf(point);
      return {
        id: merchantId(point),
        name: point.name ?? "义体医生",
        location: `poi:${point.id}`,
        note: "地点与医生名依据原作服务点；开局备货和手术设备为本作设定，现存义体按实际交付减少。",
        shelf,
        initialStock: Object.fromEntries(shelf.map((id) => [id, 1])),
        equipment: ["surgery"],
      };
    },
  ),
);

/** 经营身份和所有已核对入口；同址不同经营项目仍有各自库存。 */
export const merchantSites = [
  {
    merchant: "sleeve-corner",
    kind: "netrunner",
    locations: ["kabuki-market"],
    services: ["bd-session"],
    braindanceDevice: { playback: true, analysis: ["observe", "audio"] },
    braindanceWorks: ["bd-night-market", "bd-rain-rooftop", "bd-small-stage"],
    source:
      "本作原创阿岚芯片小铺；与市场其他摊位分开库存，店内有普通超梦播放设备，开局持有这三部作品的授权店内放映副本，与出售的载体库存独立",
  },
  {
    merchant: "wilson",
    kind: "gun",
    locations: ["megabuilding-h10", "poi:wat_lch_gunsmith_01"],
    services: [],
    source: "Vendors.wat_lch_gunsmith_01 / 2nd Amendment：H10 威尔逊枪店",
  },
  {
    merchant: "kabuki-arms",
    kind: "mixed",
    locations: ["kabuki-market"],
    services: [],
    source: "本作自创阿涛摊位；未与原作 POI 合并",
  },
  {
    merchant: "japantown-arcade",
    kind: "mixed",
    locations: ["japantown"],
    services: ["meal", "drink"],
    source: "本作日本町聚合商街；未与单个原作店铺合并",
  },
  {
    merchant: "vik-pharmacy",
    kind: "meds",
    locations: ["vik-clinic", "poi:wat_lch_ripperdoc_01"],
    services: [],
    source: "本作维克多诊所药柜，随 Mappins.wat_lch_ripperdoc_01 的诊所入口",
  },
  {
    merchant: "viktor",
    kind: "ripperdoc",
    locations: ["vik-clinic", "poi:wat_lch_ripperdoc_01"],
    services: ["medical"],
    source: "Mappins.wat_lch_ripperdoc_01 / Viktor Vektor：维克多诊所",
  },
  {
    merchant: "needle",
    kind: "ripperdoc",
    locations: ["kabuki-market"],
    services: ["medical"],
    source: "本作自创针眼诊所；未与原作 POI 合并",
  },
  ...SERVICE_POINTS.flatMap((point) => {
    if (KNOWN_POIS[point.id] || (!shopKind(point.kind) && point.kind !== "ripperdoc")) return [];
    return [
      {
        merchant: merchantId(point),
        kind: point.kind,
        locations: [`poi:${point.id}`],
        services: point.kind === "ripperdoc" ? ["medical"] : SHOP_SEEDS[point.kind].services,
        source: `原作服务点 ${point.id}${point.nameSrc ? `；名称来源 ${point.nameSrc}` : "；原作未标明专名"}；备货为本作开局条件`,
      },
    ];
  }),
].map((site) => worldRules.MerchantSiteSchema.parse(site));
