import { cyberwareRules, inventoryRules, worldRules } from "@cp/core";
import { SERVICE_POINTS, type ServicePoint } from "./mapShapes";

type ShopKind = "gun" | "melee" | "clothes" | "meds" | "food" | "bar" | "junk" | "netrunner";

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
      tamayura: 2,
      grit: 1,
      kappa: 1,
      nova: 1,
      saratoga: 1,
      guillotine: 2,
      shigure: 1,
      nowaki: 1,
      umbra: 1,
      kyubi: 1,
      pozhar: 1,
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
      kaiken: 2,
      punknife: 3,
      "neurotoxin-knife": 1,
      "butchers-cleaver": 2,
      razor: 2,
      machete: 2,
      claw: 1,
      "cut-o-matic": 1,
      "baseball-bat": 2,
      knuckles: 2,
      "cattle-prod": 1,
      "bleedout-mod": 2,
      "kinetic-weight-mod": 2,
    },
    services: [],
    leadMinutes: 720,
  },
  clothes: {
    name: "服装店",
    keeper: "服装商贩",
    stock: {
      "street-beanie": 3,
      "tactical-helmet": 1,
      "mirror-shades": 3,
      "corpo-glasses": 2,
      "respirator-mask": 2,
      "street-jacket": 3,
      "nomad-duster": 1,
      "techie-coverall": 2,
      "corpo-suit": 1,
      "neon-pvc-jacket": 2,
      "long-trenchcoat": 1,
      "club-dress": 1,
      "street-tee": 4,
      "silk-shirt": 2,
      "turtleneck-knit": 2,
      "cargo-pants": 3,
      "tailored-slacks": 2,
      "leather-pants": 2,
      "combat-boots": 3,
      "street-sneakers": 3,
      "dress-shoes": 2,
    },
    services: [],
    leadMinutes: 1440,
  },
  meds: {
    name: "药店",
    keeper: "药品商贩",
    stock: { maxdoc: 6, "bounce-back": 6, "health-booster": 3, "med-kit": 4 },
    services: [],
    leadMinutes: 480,
  },
  food: {
    name: "食品摊",
    keeper: "食品商贩",
    stock: { hawtdawg: 12, nicola: 12, coffee: 12, "synth-cigs": 8 },
    services: ["meal", "drink"],
    leadMinutes: 180,
  },
  bar: {
    name: "酒吧",
    keeper: "酒保",
    stock: { nicola: 12, coffee: 8, "real-liquor": 6, "synth-cigs": 6, "cigar-case": 2 },
    services: ["meal", "drink"],
    leadMinutes: 360,
  },
  junk: {
    name: "杂货摊",
    keeper: "杂货商贩",
    stock: {
      "blank-shard": 6,
      "tool-kit": 2,
      "lockpick-set": 2,
      "holo-phone": 2,
      "tarot-deck": 2,
      "rosary-beads": 3,
      "gold-chain": 1,
      "cigar-case": 1,
      "tire-iron": 2,
      "pipe-wrench": 2,
      crowbar: 2,
      "steel-pipe": 3,
      "synth-cigs": 6,
      nicola: 8,
      coffee: 8,
      "street-beanie": 2,
      "mirror-shades": 2,
      "respirator-mask": 1,
      "work-apron": 1,
    },
    services: [],
    leadMinutes: 720,
  },
  netrunner: {
    name: "黑客商店",
    keeper: "黑客商贩",
    stock: {
      "netrunner-suit": 2,
      "emp-grenade": 3,
      "recon-grenade": 3,
      glitter: 2,
      "smart-target-mod": 1,
      "smart-link-module": 1,
      "qh-sonic-shock": 2,
      "qh-cripple-movement": 2,
      "qh-short-circuit": 1,
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

/** 本作改编的少量街头商铺寄售芯片，不声称是原作商贩的精确货架。 */
const CHIP_CONSIGNMENTS: Readonly<Record<string, Record<string, number>>> = {
  wat_lch_foodshop_02: {
    "shard-intel-ncpd-scanner": 2,
    "shard-bd-nc-night-drift": 2,
  },
  wat_kab_foodshop_01: {
    "shard-intel-kabuki-rumors": 3,
  },
  wat_kab_foodshop_02: {
    "shard-bd-us-cracks-live": 2,
    "shard-intel-kabuki-rumors": 2,
  },
  cct_cpz_foodstore_02: {
    "shard-intel-clouds-manual": 2,
    "shard-skill-translator": 1,
  },
};

const NETRUNNER_CHIPS: Readonly<Record<string, Record<string, number>>> = {
  watson: {
    "shard-skill-lockbypass": 2,
    "shard-skill-translator": 1,
    "shard-intel-ncpd-scanner": 2,
    "qh-memory-wipe": 1,
  },
  westbrook: {
    "shard-skill-translator": 2,
    "shard-intel-clouds-manual": 2,
    "shard-bd-clouds-dream-suite": 1,
    "qh-memory-wipe": 1,
  },
  heywood: {
    "shard-skill-tactical-reload": 1,
    "shard-skill-trauma-field": 1,
    "qh-contagion": 1,
  },
  pacifica: {
    "shard-skill-lockbypass": 2,
    "shard-daemon-militech-cred": 1,
    "qh-contagion": 1,
  },
  dogtown: {
    "shard-skill-tactical-reload": 2,
    "shard-skill-trauma-field": 2,
    "shard-daemon-arasaka-backdoor": 1,
    "qh-memory-wipe": 1,
    "qh-contagion": 1,
  },
  badlands: {
    "shard-skill-trauma-field": 2,
    "shard-skill-lockbypass": 1,
    "qh-contagion": 1,
  },
};

function regionalChipStock(point: ServicePoint): Record<string, number> {
  if (point.kind !== "netrunner") return CHIP_CONSIGNMENTS[point.id] ?? {};
  return {
    "chip-reader-writer": 2,
    "blank-shard": 6,
    ...(NETRUNNER_CHIPS[point.district ?? "badlands"] ?? {}),
  };
}

/** 狗镇黑市军火（含往日之影军规枪械与流出的限量不朽武器），常规城区武器店不上架不朽武器 */
const DOGTOWN_ICONIC_WEAPONS: readonly string[] = [
  "osprey",
  "lizzie",
  "widow-maker",
  "fenrir",
  "problem-solver",
  "shingen-prototype",
  "yinglong",
  "erebus",
  "malorian-3516",
  "skippy",
  "comrades-hammer",
  "jinchu-maru",
  "errata",
  "breakthrough",
  "ofive",
  "sir-john",
];

let dogtownGunCounter = 0;

/** 狗镇/高端军火区特供武器（含往日之影军规枪械），让全目录非不朽量产武器均可经区域军火商买到 */
function regionalWeaponStock(point: ServicePoint): Record<string, number> {
  if (point.kind !== "gun") return {};
  if (point.district === "dogtown") {
    const idx = dogtownGunCounter++;
    const chunkSize = Math.ceil(DOGTOWN_ICONIC_WEAPONS.length / 2);
    const start = (idx % 2) * chunkSize;
    const iconicChunk = Object.fromEntries(
      DOGTOWN_ICONIC_WEAPONS.slice(start, start + chunkSize).map((id) => [id, 1]),
    );
    return {
      ticon: 1,
      metel: 1,
      warden: 1,
      senkoh: 1,
      hercules: 1,
      kolac: 1,
      rasetsu: 1,
      "tactical-helmet": 1,
      ...iconicChunk,
    };
  }
  if (point.district === "city_center" || point.district === "westbrook") {
    return { ticon: 1, senkoh: 1, warden: 1, rasetsu: 1 };
  }
  if (point.district === "pacifica" || point.district === null) {
    return { metel: 1, kolac: 1, hercules: 1 };
  }
  return {};
}

const NON_RESTOCK_CHIPS = new Set(["shard-daemon-militech-cred", "shard-daemon-arasaka-backdoor"]);

export const poiShops = inventoryRules.ShopListSchema.parse(
  SERVICE_POINTS.flatMap((point) => {
    if (!shopKind(point.kind) || KNOWN_POIS[point.id]) return [];
    const seed = SHOP_SEEDS[point.kind];
    const location = `poi:${point.id}`;
    const hub = SUPPLY_HUBS[point.district ?? ""] ?? "badlands";
    const chipStock = regionalChipStock(point);
    const weaponStock = regionalWeaponStock(point);
    const stock = { ...seed.stock, ...weaponStock, ...chipStock };
    const shelf = Object.keys(stock);
    const supplyItems = shelf.filter((id) => !NON_RESTOCK_CHIPS.has(id));
    return [
      {
        id: merchantId(point),
        name: point.name ?? seed.name,
        keeper: seed.keeper,
        location,
        note: `地点与店名依据原作服务点；开局备货和区域供货合同为本作设定，成交与运输会改变库存。${Object.keys(chipStock).length ? "本店另有少量本作原创芯片寄售，各片按封套的授权发行来源供货；可只问价或看标签，购买不自动阅读播放。" : ""}`,
        shelf,
        initialStock: stock,
        supply: {
          supplier: `supply-${point.district ?? "badlands"}-${point.kind}`,
          origin: `本作开局合同：${hub} 的${seed.name}补给配送点${Object.keys(chipStock).length ? "和本区作者授权芯片寄售发行点" : ""}；只按已登记订单发货`,
          route: [hub, location],
          leadMinutes: seed.leadMinutes,
          ...(supplyItems.length < shelf.length ? { items: supplyItems } : {}),
        },
      },
    ];
  }),
);

/** 狗镇黑市诊所（往日之影）专属限量不朽义体清单：常规城区诊所不上架不朽义体，仅狗镇军规黑市渠道流转 */
const DOGTOWN_ICONIC_CHROME: readonly string[] = [
  "maxtac-mantis-blades",
  "netwatch-netdriver",
  "electromag-recycler",
  "immovable-force",
  "chitin",
  "leeroy-ligament-system",
  "rara-avis",
  "chrome-compressor",
  "axolotl",
  "cox2-optimizer",
  "peripheral-inverse",
  "revulsor",
  "deep-field-visual",
  "isometric-stabilizer",
  "kiroshi-cockatrice",
  "adreno-trigger",
  "cellular-adapter",
  "militech-canto",
];

/** 少量常规备货，按开局区域供货选型；狗镇黑市诊所按诊所分摊少量限量不朽义体供货。 */
function clinicShelf(point: ServicePoint, dogtownIndex: number): string[] {
  if (point.district === "city_center" || point.district === "westbrook") {
    return [
      "kiroshi-mk2",
      "arasaka-optics",
      "biometric-polygraph-optics",
      "behavioral-faceplate",
      "mood-stabilizer",
      "bioconductor",
      "visual-cortex-support",
      "militech-paraline",
      "seocho-deck",
      "stephenson-deck",
      "arasaka-sandevistan",
      "chrome-plating-skin",
      "holo-disguise-weave",
      "smart-link",
      "precision-manipulators",
    ];
  }
  if (point.district === "dogtown") {
    const base = [
      "kiroshi-mk2",
      "militech-thermal-optics",
      "behavioral-faceplate",
      "neofiber",
      "subdermal-armor",
      "personal-sound-silencer",
      "auto-suppressant-injector",
      "biotech-sigma",
      "reinforced-tendons",
      "mag-grip-legs",
      "thermal-gorilla-arms",
      "electric-mantis-blades",
      "toxic-projectile-launch",
    ];
    // 将 18 件狗镇不朽义体均匀分摊至狗镇 4 家黑市诊所（百灵鸟个人军用改造除外）
    const chunkSize = Math.ceil(DOGTOWN_ICONIC_CHROME.length / 4);
    const start = (dogtownIndex % 4) * chunkSize;
    return [...base, ...DOGTOWN_ICONIC_CHROME.slice(start, start + chunkSize)];
  }
  if (point.district === "pacifica" || point.district === null) {
    return [
      "kiroshi-mk1",
      "street-mod-optics",
      "neofiber",
      "sleep-skip-regulator",
      "subdermal-armor",
      "toxin-cleanser",
      "cargo-spine-frame",
      "biotech-sigma",
      "animals-berserk",
      "reinforced-tendons",
      "badlands-runner-legs",
      "anchor-hydraulic-legs",
      "tech-utility-arm",
      "surgical-prosthetic-arm",
    ];
  }
  return [
    "kiroshi-mk1",
    "zetatech-net-optics",
    "ram-upgrade",
    "neural-translator",
    "black-ice-sniffer",
    "newton-module",
    "nanorelays",
    "voice-modulator",
    "fuyutsuki-deck",
    "biodyne-deck",
    "smuggler-cavity",
    "shock-disperser-ribs",
    "smart-link",
    "tyger-claws-tattoo",
    "power-grip",
    "tech-diagnostic-palm",
    "palm-jammer",
    "drop-damper-legs",
  ];
}

let dogtownClinicCounter = 0;

export const poiRipperdocs = cyberwareRules.RipperdocListSchema.parse(
  SERVICE_POINTS.filter((point) => point.kind === "ripperdoc" && !KNOWN_POIS[point.id]).map(
    (point) => {
      const idx = point.district === "dogtown" ? dogtownClinicCounter++ : 0;
      const shelf = clinicShelf(point, idx);
      const isDogtown = point.district === "dogtown";
      return {
        id: merchantId(point),
        name: point.name ?? "义体医生",
        location: `poi:${point.id}`,
        note: isDogtown
          ? "狗镇黑市义体诊所：常备军规及少量渠道流出的限量不朽义体，只收现钱、售完即止。"
          : "地点与医生名依据原作服务点；开局备货和手术设备为本作设定，现存义体按实际交付减少。",
        ...(isDogtown ? { blackMarket: true } : {}),
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
    braindanceDevice: { playback: true, analysis: [] },
    braindanceWorks: ["bd-nc-night-drift", "bd-us-cracks-live"],
    source:
      "歌舞伎市场阿岚芯片小铺；店内配有基础商业超梦试看设备，支持沉浸体验店内商业卷轴（不支持三层轨道编辑分析）。",
  },
  {
    merchant: "lizzies-bar-bd",
    kind: "bar",
    locations: ["lizzies-bar"],
    services: ["bd-session", "drink"],
    braindanceDevice: { playback: true, analysis: ["visual", "audio", "thermal"] },
    braindanceWorks: [
      "bd-lizzies-velvet",
      "bd-clouds-dream-suite",
      "bd-konpeki-suite-raw",
      "bd-clouds-vip-raw",
    ],
    source:
      "丽姿酒吧（莫克斯帮据点）：楼上提供莫克斯感官调谐超梦包厢点播，地下室配备朱迪的专业超梦调谐工作站，支持视觉/音频/热感三层轨道扫描。",
  },
  {
    merchant: "jigjig-xbd-stall",
    kind: "netrunner",
    locations: ["jig-jig-street"],
    services: [],
    source: "扭扭街暗巷灰舌黑市摊位，私售地下黑超梦（XBD）、调查原片与加密/行为协议芯片。",
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
