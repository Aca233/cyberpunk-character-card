import type { AssetId } from "../../assets";

/**
 * 物品和人物的原作图（第八节第 1 条：优先用原作素材）：
 * 武器优先使用对应型号及不朽涂装，物品使用 item_icons，义体使用 cw_*，头像使用 avatars 图集。
 * 缺少专图的物品使用同类示意图，并在映射旁注明；未收录的人物与义体由调用处处理。
 */

/** 人物 id → 原作头像 */
const PORTRAITS: Readonly<Record<string, AssetId>> = {
  judy: "portrait.judy",
  regina: "portrait.regina",
  viktor: "portrait.viktor",
  jackie: "portrait.jackie",
  rogue: "portrait.rogue",
  wakako: "portrait.wakako",
  misty: "portrait.misty",
  dex: "portrait.dex",
  padre: "portrait.padre",
  panam: "portrait.panam",
  river: "portrait.river",
  kerry: "portrait.kerry",
};

/** 物品 id（武器、义体）→ 原作物品图 */
const ITEM_ART: Readonly<Record<string, AssetId>> = {
  // 治疗品、手雷与食品
  "health-booster": "itemArt.healthBooster",
  // 本作虚构药物，借用原作稳定剂注射器作为示意图。
  "psycho-suppressant": "itemArt.psychoSuppressant",
  errata: "weaponArt.errata",
  maxdoc: "itemArt.maxdoc",
  "maxdoc-mk2": "itemArt.maxdoc",
  "bounce-back": "itemArt.bounceBack",
  "frag-grenade": "itemArt.frag",
  "emp-grenade": "itemArt.emp",
  "incendiary-grenade": "itemArt.incendiary",
  flashbang: "itemArt.flashbang",
  "recon-grenade": "itemArt.recon",
  nicola: "itemArt.nicola",
  hawtdawg: "itemArt.hawtdawg",
  coffee: "itemArt.coffee",
  "black-lace": "itemArt.blackLace",
  glitter: "itemArt.glitter",
  "strix-silencer": "itemArt.strixSilencer",
  "alecto-silencer": "itemArt.alectoSilencer",
  "kanetsugu-scope": "itemArt.kanetsuguScope",
  "gaki-scope": "itemArt.gakiScope",
  shard: "itemArt.shard",
  "saika-scope": "itemArt.saikaScope",
  "nomad-duster": "itemArt.nomadDuster",
  shigure: "weaponArt.shigure",
  // 通用服装使用同类原作服装示意图；插件共用原作改装件图标。
  "street-jacket": "itemArt.streetJacket",
  "corpo-suit": "itemArt.corpoSuit",
  "techie-coverall": "itemArt.techieCoverall",
  "netrunner-suit": "itemArt.netrunnerSuit",
  "big-mag": "itemArt.mod",
  "kneel-mod": "itemArt.mod",
  "bleedout-mod": "itemArt.mod",
  "parallax-mod": "itemArt.mod",
  "smart-target-mod": "itemArt.mod",
  "smart-link-module": "itemArt.mod",
  "kinetic-weight-mod": "itemArt.mod",
  "arc-coil-mod": "itemArt.mod",
  // 通用保安制服借用军用科技制服，工牌借用原作通行卡作为示意图。
  "security-uniform": "itemArt.securityUniform",
  "corpo-badge": "itemArt.corpoBadge",
  // 武器
  "pipe-wrench": "weaponArt.pipeWrench",
  // 解包素材中未找到胁差专图，使用同类刀剑图示。
  wakizashi: "weaponArt.katana",
  "neurotoxin-knife": "weaponArt.neurotoxinKnife",
  "butchers-cleaver": "weaponArt.butchersCleaver",
  "cattle-prod": "weaponArt.cattleProd",
  pride: "weaponArt.pride",
  "ba-xing-chong": "weaponArt.baXingChong",
  "sir-john": "weaponArt.sirJohn",
  "doom-doom": "weaponArt.doomDoom",
  "widow-maker": "weaponArt.widowMaker",
  fenrir: "weaponArt.fenrir",
  "problem-solver": "weaponArt.problemSolver",
  "shingen-prototype": "weaponArt.shingenPrototype",
  yinglong: "weaponArt.yinglong",
  erebus: "weaponArt.erebus",
  "her-majesty": "weaponArt.herMajesty",
  "comrades-hammer": "weaponArt.comradesHammer",
  "jinchu-maru": "weaponArt.jinchuMaru",
  byakko: "weaponArt.byakko",
  breakthrough: "weaponArt.breakthrough",
  ofive: "weaponArt.ofive",
  lizzie: "weaponArt.lizzie",
  "dying-night": "weaponArt.dyingNight",
  crash: "weaponArt.crash",
  archangel: "weaponArt.archangel",
  chaos: "weaponArt.chaos",
  kongou: "weaponArt.kongou",
  "plan-b": "weaponArt.planB",
  nowaki: "weaponArt.nowaki",
  rasetsu: "weaponArt.rasetsu",
  kaiken: "weaponArt.kaiken",
  punknife: "weaponArt.punknife",
  razor: "weaponArt.razor",
  claw: "weaponArt.claw",
  "cut-o-matic": "weaponArt.cutOMatic",
  "tire-iron": "weaponArt.tireIron",
  tamayura: "weaponArt.tamayura",
  grit: "weaponArt.grit",
  ticon: "weaponArt.ticon",
  kappa: "weaponArt.kappa",
  metel: "weaponArt.metel",
  guillotine: "weaponArt.guillotine",
  warden: "weaponArt.warden",
  senkoh: "weaponArt.senkoh",
  umbra: "weaponArt.umbra",
  kyubi: "weaponArt.kyubi",
  hercules: "weaponArt.hercules",
  pozhar: "weaponArt.pozhar",
  kolac: "weaponArt.kolac",
  unity: "weaponArt.unity",
  lexington: "weaponArt.lexington",
  nue: "weaponArt.nue",
  liberty: "weaponArt.liberty",
  omaha: "weaponArt.omaha",
  kenshin: "weaponArt.kenshin",
  yukimura: "weaponArt.yukimura",
  chao: "weaponArt.chao",
  nova: "weaponArt.nova",
  overture: "weaponArt.overture",
  burya: "weaponArt.burya",
  saratoga: "weaponArt.saratoga",
  pulsar: "weaponArt.pulsar",
  shingen: "weaponArt.shingen",
  dian: "weaponArt.dian",
  copperhead: "weaponArt.copperhead",
  ajax: "weaponArt.ajax",
  masamune: "weaponArt.masamune",
  sidewinder: "weaponArt.sidewinder",
  osprey: "weaponArt.osprey",
  carnage: "weaponArt.carnage",
  satara: "weaponArt.satara",
  igla: "weaponArt.igla",
  tactician: "weaponArt.tactician",
  zhuo: "weaponArt.zhuo",
  achilles: "weaponArt.achilles",
  ashura: "weaponArt.ashura",
  grad: "weaponArt.grad",
  nekomata: "weaponArt.nekomata",
  ma70: "weaponArt.ma70",
  defender: "weaponArt.defender",
  knife: "weaponArt.knife",
  machete: "weaponArt.machete",
  kukri: "weaponArt.kukri",
  tomahawk: "weaponArt.tomahawk",
  katana: "weaponArt.katana",
  "baseball-bat": "weaponArt.baseballBat",
  crowbar: "weaponArt.crowbar",
  "steel-pipe": "weaponArt.steelPipe",
  knuckles: "weaponArt.knuckles",
  baton: "weaponArt.baton",
  kanabo: "weaponArt.kanabo",
  sledgehammer: "weaponArt.sledgehammer",
  "la-chingona-dorada": "weaponArt.laChingonaDorada",
  guts: "weaponArt.guts",
  "malorian-3516": "weaponArt.malorian3516",
  skippy: "weaponArt.skippy",
  satori: "weaponArt.satori",
  overwatch: "weaponArt.overwatch",
  // 义体
  "ram-upgrade": "cyberArt.ramUpgrade",
  "limbic-enhancement": "cyberArt.limbicEnhancement",
  "visual-cortex-support": "cyberArt.visualCortexSupport",
  "mechatronic-core": "cyberArt.mechatronicCore",
  "kiroshi-mk1": "cyberArt.kiroshiMk1",
  "kiroshi-mk2": "cyberArt.kiroshiMk2",
  "kiroshi-clairvoyant": "cyberArt.kiroshiClairvoyant",
  nanorelays: "cyberArt.nanorelays",
  neofiber: "cyberArt.neofiber",
  "synaptic-accelerator": "cyberArt.synapticAccelerator",
  "reflex-tuner": "cyberArt.reflexTuner",
  kerenzikov: "cyberArt.kerenzikov",
  "militech-paraline": "cyberArt.militechParaline",
  "biotech-sigma": "cyberArt.biotechSigma",
  "raven-microcyber": "cyberArt.ravenMicrocyber",
  "zetatech-sandevistan": "cyberArt.zetatechSandevistan",
  "dynalar-sandevistan": "cyberArt.dynalarSandevistan",
  "moore-berserk": "cyberArt.mooreBerserk",
  "netwatch-netdriver": "cyberArt.netwatchNetdriver",
  biomonitor: "cyberArt.biomonitor",
  "syn-lungs": "cyberArt.synLungs",
  "blood-pump": "cyberArt.bloodPump",
  "second-heart": "cyberArt.secondHeart",
  "subdermal-armor": "cyberArt.subdermalArmor",
  "fireproof-coating": "cyberArt.fireproofCoating",
  "grounding-plating": "cyberArt.groundingPlating",
  "optical-camo": "cyberArt.opticalCamo",
  "titanium-bones": "cyberArt.titaniumBones",
  "dense-marrow": "cyberArt.denseMarrow",
  "bionic-joints": "cyberArt.bionicJoints",
  "epimorphic-skeleton": "cyberArt.epimorphicSkeleton",
  "clutch-padding": "cyberArt.clutchPadding",
  "smart-link": "cyberArt.smartLink",
  "ballistic-coprocessor": "cyberArt.ballisticCoprocessor",
  "gorilla-arms": "cyberArt.gorillaArms",
  "mantis-blades": "cyberArt.mantisBlades",
  "maxtac-mantis-blades": "cyberArt.mantisBlades",
  monowire: "cyberArt.monowire",
  "projectile-launch-system": "cyberArt.projectileLaunchSystem",
  "fortified-ankles": "cyberArt.fortifiedAnkles",
  "reinforced-tendons": "cyberArt.reinforcedTendons",
  "jenkins-tendons": "cyberArt.jenkinsTendons",
  // 用户 2026-10-31："怎么没图片"：补的 2.0 义体，图名照原作 TweakDB 的 iconPath；同一张原作图的直接复用
  "ex-disk": "cyberArt.exDisk",
  "memory-boost": "cyberArt.ramUpgrade",
  "camillo-ram-manager": "cyberArt.camilloRamManager",
  "self-ice": "cyberArt.selfIce",
  "newton-module": "cyberArt.newtonModule",
  bioconductor: "cyberArt.bioconductor",
  "burnout-buffer": "cyberArt.burnoutBuffer",
  "kerenzikov-boost-system": "cyberArt.kerenzikovBoost",
  "quantum-tuner": "cyberArt.quantumTuner",
  "kiroshi-doomsayer": "cyberArt.kiroshiMk2",
  "kiroshi-stalker": "cyberArt.kiroshiStalker",
  "kiroshi-oracle": "cyberArt.kiroshiClairvoyant",
  "kiroshi-sentry": "cyberArt.kiroshiMk2",
  "atomic-sensors": "cyberArt.atomicSensors",
  "tyrosine-injector": "cyberArt.tyrosineInjector",
  stabber: "cyberArt.stabber",
  "adrenaline-converter": "cyberArt.adrenalineConverter",
  "arasaka-deck": "cyberArt.arasakaDeck",
  "tetratronic-rippler": "cyberArt.tetratronicRippler",
  "militech-canto": "cyberArt.militechCanto",
  "qiant-warp-dancer": "cyberArt.qiantWarpDancer",
  "militech-falcon": "cyberArt.militechFalcon",
  "militech-apogee": "cyberArt.militechApogee",
  "biodyne-berserk": "cyberArt.biodyneBerserk",
  "zetatech-berserk": "cyberArt.zetatechBerserk",
  "militech-berserk": "cyberArt.militechBerserk",
  threatevac: "cyberArt.threatEvac",
  "adrenaline-booster": "cyberArt.adrenalineBooster",
  "heal-on-kill": "cyberArt.healOnKill",
  "feedback-circuit": "cyberArt.feedbackCircuit",
  microrotors: "cyberArt.microrotors",
  "black-mamba": "cyberArt.blackMamba",
  "cogito-lattice": "cyberArt.cogitoLattice",
  "nano-plating": "cyberArt.nanoPlating",
  painducer: "cyberArt.painducer",
  proxishield: "cyberArt.proxiShield",
  countershell: "cyberArt.countershell",
  rangeguard: "cyberArt.rangeGuard",
  carapace: "cyberArt.carapace",
  defenzikov: "cyberArt.defenzikov",
  "shock-n-awe": "cyberArt.shockNAwe",
  "pain-editor": "cyberArt.painEditor",
  "universal-booster": "cyberArt.universalBooster",
  "spring-joints": "cyberArt.bionicJoints",
  "feen-x": "cyberArt.feenX",
  "ram-recoup": "cyberArt.ramRecoup",
  scarab: "cyberArt.scarab",
  "scar-coalescer": "cyberArt.scarCoalescer",
  "kinetic-frame": "cyberArt.kineticFrame",
  "para-bellum": "cyberArt.paraBellum",
  "shock-absorber": "cyberArt.clutchPadding",
  microgenerator: "cyberArt.microgenerator",
  "handle-wrap": "cyberArt.handleWrap",
  "lynx-paws": "cyberArt.lynxPaws",
  "electromag-recycler": "cyberArt.feedbackCircuit",
  "immovable-force": "cyberArt.ballisticCoprocessor",
  chitin: "cyberArt.chitin",
  "leeroy-ligament-system": "cyberArt.leeroyLigament",
  "rara-avis": "cyberArt.paraBellum",
};

const SHOP_POI_ICONS: Readonly<Record<string, AssetId>> = {
  gun: "map.poi.gun",
  melee: "map.poi.melee",
  clothes: "map.poi.clothes",
  meds: "map.poi.meds",
  food: "map.poi.food",
  bar: "map.poi.bar",
  ripperdoc: "map.poi.ripperdoc",
  netrunner: "map.poi.netrunner",
};

/** 商店 / 诊所类型 → 原作地图 POI 图标，未知类型回落到通用商贩 */
export function shopPoiIconOf(kind: string | null | undefined): AssetId {
  return (kind ? SHOP_POI_ICONS[kind] : undefined) ?? "interaction.vendor";
}

export function portraitOf(npc: string | null | undefined): AssetId | undefined {
  return npc ? PORTRAITS[npc] : undefined;
}

/** 从物化武器实例 ID（wpn:<baseId>:<seq>）提取基础模板 ID */
export function baseWeaponIdOf(id: string): string {
  const match = /^wpn:([^:]+):\d+$/.exec(id);
  return match?.[1] ?? id;
}

export function itemArtOf(item: string | null | undefined): AssetId | undefined {
  if (!item) return undefined;
  return ITEM_ART[item] ?? ITEM_ART[baseWeaponIdOf(item)];
}

/** 武器 ID 与副标题 → 右下角 HUD 用的高对比 2077 单色武器轮廓剪影 */
export function weaponHudIconOf(id: string, subLabel?: string): AssetId {
  const low = baseWeaponIdOf(id).toLowerCase();
  if (
    low.includes("knife") ||
    low.includes("cleaver") ||
    low === "blue-fang" ||
    low === "fang" ||
    low === "headhunter" ||
    low === "stinger"
  ) {
    return "weapon.knife";
  }
  if (subLabel?.includes("刀剑")) {
    if (
      low.includes("katana") ||
      low === "wakizashi" ||
      low === "errata" ||
      low === "jinchu-maru" ||
      low === "byakko" ||
      low === "satori" ||
      low === "scalpel"
    ) {
      return "weapon.katana";
    }
    return "weapon.longBlade";
  }
  if (subLabel?.includes("钝器")) {
    return low.includes("hammer") || low.includes("sasquatch") ? "weapon.hammer" : "weapon.club";
  }
  if (subLabel?.includes("左轮手枪")) {
    return subLabel.includes("技术") ? "weapon.revolverTech" : "weapon.revolverPower";
  }
  if (subLabel?.includes("手枪")) {
    return "weapon.pistolPower";
  }
  if (subLabel?.includes("冲锋枪")) {
    return subLabel.includes("智能") ? "weapon.smgSmart" : "weapon.smgPower";
  }
  if (subLabel?.includes("精准步枪") || subLabel?.includes("突击步枪")) {
    return subLabel.includes("技术") ? "weapon.riflePrecisionTech" : "weapon.riflePrecision";
  }
  if (subLabel?.includes("狙击步枪")) {
    return subLabel.includes("智能") ? "weapon.sniperSmart" : "weapon.sniper";
  }
  if (subLabel?.includes("霰弹枪")) {
    if (subLabel.includes("智能")) return "weapon.shotgunSmart";
    if (subLabel.includes("技术")) return "weapon.shotgunDoubleTech";
    return "weapon.shotgunPower";
  }
  if (subLabel?.includes("轻机枪")) {
    return "weapon.lightMachine";
  }
  return "weapon.pistol";
}
