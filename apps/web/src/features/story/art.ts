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
  takemura: "portrait.takemura",
  hanako: "portrait.hanako",
  yorinobu: "portrait.yorinobu",
  smasher: "portrait.smasher",
  myers: "portrait.myers",
  hansen: "portrait.hansen",
  meredith: "portrait.meredith",
  "bryce-mosley": "portrait.bryceMosley",
  songbird: "portrait.songbird",
  reed: "portrait.reed",
  alex: "portrait.alex",
  dino: "portrait.dino",
  "el-capitan": "portrait.elCapitan",
  "mr-hands": "portrait.mrHands",
  dakota: "portrait.dakota",
  evelyn: "portrait.evelyn",
  "t-bug": "portrait.tBug",
  "mama-welles": "portrait.mamaWelles",
  claire: "portrait.claire",
  nix: "portrait.nix",
  saul: "portrait.saul",
  mitch: "portrait.mitch",
  carol: "portrait.carol",
  placide: "portrait.placide",
  brigitte: "portrait.brigitte",
  wilson: "portrait.wilson",
  fingers: "portrait.fingers",
  "cassius-ryder": "portrait.cassiusRyder",
  "jefferson-peralez": "portrait.jeffersonPeralez",
  "elizabeth-peralez": "portrait.elizabethPeralez",
  delamain: "portrait.delamain",
  "blue-moon": "portrait.blueMoon",
  "lizzy-wizzy": "portrait.lizzyWizzy",
  "mr-blue-eyes": "portrait.mrBlueEyes",
  ozob: "portrait.ozob",
  "coach-fred": "portrait.coachFred",
  scorpion: "portrait.scorpion",
  cassidy: "portrait.cassidy",
  nancy: "portrait.nancy",
  emmerick: "portrait.emmerick",
  weyland: "portrait.weyland",
  pepe: "portrait.pepe",
  kirk: "portrait.kirk",
  "red-menace": "portrait.redMenace",
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
  // 新增日常消耗品复用相近原作示意图。
  "synth-cigs": "itemArt.glitter",
  "real-liquor": "itemArt.nicola",
  "black-lace": "itemArt.blackLace",
  glitter: "itemArt.glitter",
  "strix-silencer": "itemArt.strixSilencer",
  "alecto-silencer": "itemArt.alectoSilencer",
  "kanetsugu-scope": "itemArt.kanetsuguScope",
  "gaki-scope": "itemArt.gakiScope",
  "saika-scope": "itemArt.saikaScope",
  // 芯片、超梦卷轴与神经读写硬件
  "chip-reader-writer": "cyberArt.exDisk",
  "bd-portable-player": "cyberArt.kiroshiMk1",
  "bd-editor-wreath": "cyberArt.visualCortexSupport",
  "blank-shard": "itemArt.shard",
  "shard-bd-nc-night-drift": "itemArt.shard",
  "shard-bd-us-cracks-live": "itemArt.shard",
  "shard-bd-lizzies-velvet": "itemArt.shard",
  "shard-bd-clouds-dream-suite": "itemArt.shard",
  "shard-bd-konpeki-suite-raw": "itemArt.shard",
  "shard-bd-clouds-vip-raw": "itemArt.shard",
  "shard-bd-kabuki-ambush-raw": "itemArt.shard",
  "shard-bd-scav-xbd-moth": "itemArt.shard",
  "shard-intel-kabuki-rumors": "itemArt.shard",
  "shard-intel-clouds-manual": "itemArt.shard",
  "shard-intel-ncpd-scanner": "itemArt.shard",
  "shard-daemon-militech-cred": "itemArt.shard",
  "shard-daemon-arasaka-backdoor": "itemArt.shard",
  "shard-skill-translator": "itemArt.shard",
  "shard-skill-trauma-field": "itemArt.shard",
  "shard-skill-tactical-reload": "itemArt.shard",
  "shard-skill-lockbypass": "itemArt.shard",
  "shard-behavior-doll-combat": "itemArt.shard",
  "shard-behavior-social-mask": "itemArt.shard",
  "doll-behavior-chip": "cyberArt.ramUpgrade",
  "braindance-recorder": "cyberArt.visualCortexSupport",
  "nomad-duster": "itemArt.nomadDuster",
  shigure: "weaponArt.shigure",
  // 通用服装使用同类原作服装示意图；插件共用原作改装件图标。
  "street-jacket": "itemArt.streetJacket",
  "corpo-suit": "itemArt.corpoSuit",
  "techie-coverall": "itemArt.techieCoverall",
  "netrunner-suit": "itemArt.netrunnerSuit",
  // 扩充衣着按风格复用同类原作服装示意图。
  "street-beanie": "itemArt.streetJacket",
  "nomad-headwrap": "itemArt.nomadDuster",
  "tactical-helmet": "itemArt.securityUniform",
  "mirror-shades": "itemArt.streetJacket",
  "corpo-glasses": "itemArt.corpoSuit",
  "tech-goggles": "itemArt.techieCoverall",
  "respirator-mask": "itemArt.securityUniform",
  "kimono-haori": "itemArt.corpoSuit",
  "neon-pvc-jacket": "itemArt.streetJacket",
  "long-trenchcoat": "itemArt.nomadDuster",
  "work-apron": "itemArt.techieCoverall",
  "club-dress": "itemArt.corpoSuit",
  "street-tee": "itemArt.streetJacket",
  "silk-shirt": "itemArt.corpoSuit",
  "turtleneck-knit": "itemArt.corpoSuit",
  "cargo-pants": "itemArt.techieCoverall",
  "tailored-slacks": "itemArt.corpoSuit",
  "leather-pants": "itemArt.streetJacket",
  "combat-boots": "itemArt.securityUniform",
  "street-sneakers": "itemArt.streetJacket",
  "dress-shoes": "itemArt.corpoSuit",
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
  // 新增日常与工具类杂物复用相近原作示意图。
  "holo-phone": "itemArt.shard",
  "tool-kit": "itemArt.mod",
  "med-kit": "itemArt.maxdoc",
  "lockpick-set": "itemArt.mod",
  "ncpd-badge": "itemArt.corpoBadge",
  "tarot-deck": "itemArt.shard",
  "rosary-beads": "itemArt.shard",
  "gold-chain": "itemArt.corpoBadge",
  "cigar-case": "itemArt.hawtdawg",
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
  // 补齐既有漏配义体与本次扩充的 50 件新义体（全部映射到原作解包 cyberArt.*）
  "maneuvering-system": "cyberArt.nanorelays",
  "metabolic-editor": "cyberArt.reverseMetabolic",
  "prosthetic-arms": "cyberArt.powerGrip",
  "prosthetic-legs": "cyberArt.skeletonShock",
  "songbird-military-netrunning": "cyberArt.militechCanto",
  "chrome-compressor": "cyberArt.osCapacityBooster",
  axolotl: "cyberArt.holographicCamo",
  "ram-reallocator": "cyberArt.fastAccessMemory",
  "cox2-optimizer": "cyberArt.bioconductor",
  "peripheral-inverse": "cyberArt.proxiShield",
  revulsor: "cyberArt.nervousDischarge",
  "deep-field-visual": "cyberArt.visualCortexSupport",
  "isometric-stabilizer": "cyberArt.powerGrip",
  "kiroshi-cockatrice": "cyberArt.eyesCriticalIconic",
  "adreno-trigger": "cyberArt.adrenalineConverter",
  "cellular-adapter": "cyberArt.resistancesBooster",
  // 新增额叶 / 面部 / 神经
  "neural-translator": "cyberArt.fastAccessMemory",
  "mood-stabilizer": "cyberArt.painReductor",
  "black-ice-sniffer": "cyberArt.reversePowerInductor",
  "behavioral-faceplate": "cyberArt.faceplate",
  "arasaka-optics": "cyberArt.kiroshiAlt1",
  "militech-thermal-optics": "cyberArt.kiroshiAlt2",
  "zetatech-net-optics": "cyberArt.kiroshiAlt3",
  "street-mod-optics": "cyberArt.kiroshiMk1",
  "biometric-polygraph-optics": "cyberArt.kiroshiClairvoyant",
  "voice-modulator": "cyberArt.tyrosineV2",
  "sleep-skip-regulator": "cyberArt.skeletonEsns",
  // 新增操作系统
  "fuyutsuki-deck": "cyberArt.fuyutsukiDeck",
  "seocho-deck": "cyberArt.seochoDeck",
  "biodyne-deck": "cyberArt.biodyneDeck",
  "stephenson-deck": "cyberArt.stephensonDeck",
  "arasaka-sandevistan": "cyberArt.arasakaSandevistan",
  "animals-berserk": "cyberArt.animalsBerserk",
  // 新增循环 / 表皮 / 骨骼
  "toxin-cleanser": "cyberArt.toxinCleanser",
  "auto-suppressant-injector": "cyberArt.resistancesBooster",
  "personal-sound-silencer": "cyberArt.soundSilencer",
  "smuggler-cavity": "cyberArt.heatBooster",
  "chrome-plating-skin": "cyberArt.metalSkin",
  "holo-disguise-weave": "cyberArt.holographicCamo",
  "cargo-spine-frame": "cyberArt.skeletonBoneMarrow",
  "shock-disperser-ribs": "cyberArt.skeletonCharge",
  // 新增手部 / 手臂 / 腿部
  "tyger-claws-tattoo": "cyberArt.tygerTattoo",
  "power-grip": "cyberArt.powerGrip",
  "tech-diagnostic-palm": "cyberArt.circulatoryMicrogen",
  "palm-jammer": "cyberArt.nervousDischarge",
  "precision-manipulators": "cyberArt.skeletonEnhancedTissue",
  "concealed-razor-knuckles": "cyberArt.handleWrap",
  "thermal-gorilla-arms": "cyberArt.gorillaArms",
  "electric-gorilla-arms": "cyberArt.gorillaArms",
  "toxic-gorilla-arms": "cyberArt.gorillaArms",
  "thermal-mantis-blades": "cyberArt.mantisBlades",
  "electric-mantis-blades": "cyberArt.mantisBlades",
  "toxic-mantis-blades": "cyberArt.mantisBlades",
  "thermal-monowire": "cyberArt.monowire",
  "electric-monowire": "cyberArt.monowire",
  "toxic-monowire": "cyberArt.monowire",
  "thermal-projectile-launch": "cyberArt.projectileLaunchSystem",
  "electric-projectile-launch": "cyberArt.projectileLaunchSystem",
  "toxic-projectile-launch": "cyberArt.projectileLaunchSystem",
  "tech-utility-arm": "cyberArt.armRotor",
  "surgical-prosthetic-arm": "cyberArt.bloodDepleter",
  "mag-grip-legs": "cyberArt.skeletonShock",
  "anchor-hydraulic-legs": "cyberArt.fortifiedAnkles",
  "drop-damper-legs": "cyberArt.reinforcedTendons",
  "badlands-runner-legs": "cyberArt.jenkinsTendons",
  "holster-calf-legs": "cyberArt.lynxPaws",
};

/** 义体元素变体色标（热能 / 电磁 / 化学），用于在复用原作手臂图标时一眼区分属性版本 */
export type ItemElement = "thermal" | "electrical" | "chemical";

export const ITEM_ELEMENT_META: Readonly<
  Record<ItemElement, { readonly badge: string; readonly label: string }>
> = {
  thermal: { badge: "热", label: "热能" },
  electrical: { badge: "电", label: "电磁" },
  chemical: { badge: "毒", label: "化学" },
};

export function itemElementOf(item: string | null | undefined): ItemElement | undefined {
  if (!item) return undefined;
  const base = baseWeaponIdOf(item);
  if (base.startsWith("thermal-")) return "thermal";
  if (base.startsWith("electric-")) return "electrical";
  if (base.startsWith("toxic-")) return "chemical";
  return undefined;
}

const SHOP_POI_ICONS: Readonly<Record<string, AssetId>> = {
  gun: "map.poi.gun",
  melee: "map.poi.melee",
  clothes: "map.poi.clothes",
  meds: "map.poi.meds",
  food: "map.poi.food",
  bar: "map.poi.bar",
  junk: "map.poi.junk",
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

/** 从物化实例 ID（wpn:<baseId>:<seq> 或 chip:<baseId>:<seq>）提取基础模板 ID */
export function baseWeaponIdOf(id: string): string {
  const match = /^(?:wpn|chip):([^:]+):\d+$/.exec(id);
  return match?.[1] ?? id;
}

export function itemArtOf(item: string | null | undefined): AssetId | undefined {
  if (!item) return undefined;
  const base = baseWeaponIdOf(item);
  const exact = ITEM_ART[item] ?? ITEM_ART[base];
  if (exact) return exact;
  if (
    item.startsWith("chip:") ||
    item.startsWith("shard-") ||
    item.startsWith("carrier-") ||
    base.startsWith("shard-")
  ) {
    return "itemArt.shard";
  }
  return undefined;
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

export interface BackdropQuery {
  readonly location: string | null | undefined;
  readonly locationName?: string | null | undefined;
  readonly district?: string | null | undefined;
  readonly period?: "dawn" | "day" | "dusk" | "night" | undefined;
}

const LOCATION_BACKDROPS: Readonly<Record<string, AssetId>> = {
  "lizzies-bar": "backdrop.lizziesBar",
  afterlife: "backdrop.afterlife",
  "megabuilding-h10": "backdrop.megabuildingH10",
  "tom-diner": "backdrop.littleChina",
  japantown: "backdrop.japantown",
  "coyote-cojo": "backdrop.coyoteCojo",
  "corpo-plaza": "backdrop.corpoPlaza",
  "grand-imperial-mall": "backdrop.grandImperialMall",
  dogtown: "backdrop.dogtown",
  "regina-office": "backdrop.kabuki",
  "wakako-pachinko": "backdrop.wakakoPachinko",
  "kerry-estate": "backdrop.kerryEstate",
  badlands: "backdrop.badlands",
};

const KEYWORD_BACKDROPS: readonly (readonly [readonly string[], AssetId])[] = [
  [["丽姿", "lizzie"], "backdrop.lizziesBar"],
  [["来生", "afterlife"], "backdrop.afterlife"],
  [["h10", "超级摩天楼", "megabuilding"], "backdrop.megabuildingH10"],
  [["野狼", "coyote"], "backdrop.coyoteCojo"],
  [["和歌子", "柏青哥", "wakako", "pachinko"], "backdrop.wakakoPachinko"],
  [["克里", "别墅", "kerry"], "backdrop.kerryEstate"],
  [["荒坂塔", "arasaka tower", "arasaka_tower"], "backdrop.arasakaTower"],
  [["绀碧", "konpeki"], "backdrop.konpekiPlaza"],
  [["全食品", "all foods", "all_foods"], "backdrop.allFoods"],
  [["大帝国", "grand imperial"], "backdrop.grandImperialMall"],
  [["太平洲教堂", "巫毒", "chapel", "voodoo"], "backdrop.pacificaChapel"],
  [["达科塔", "dakota"], "backdrop.dakotaWorkshop"],
  [["船长", "capitan"], "backdrop.elCapitan"],
  [["神父", "padre"], "backdrop.padresDen"],
  [["扭扭街", "jig-jig", "jigjig", "jig_jig"], "backdrop.jigJigStreet"],
  [["油田", "oil field", "oil_field"], "backdrop.oilFields"],
  [["流浪者营地", "营地", "nomad camp", "nomads_camp"], "backdrop.nomadCamp"],
  [["日本街", "japantown", "japan_town"], "backdrop.japantown"],
  [["宪章山", "charter hill", "charter_hill"], "backdrop.charterHill"],
  [["北橡", "north oak", "north_oak"], "backdrop.northOak"],
  [["公司广场", "corpo plaza", "corpo_plaza"], "backdrop.corpoPlaza"],
  [["市中心", "downtown"], "backdrop.downtown"],
  [["谷地", "glen"], "backdrop.glen"],
  [["美泉", "wellspring"], "backdrop.wellsprings"],
  [["丽景", "vista del rey", "vista_del_rey"], "backdrop.vistaDelRey"],
  [["河谷", "阿罗约", "arroyo"], "backdrop.arroyo"],
  [["科罗纳多", "rancho coronado", "rancho_coronado"], "backdrop.ranchoCoronado"],
  [["海景", "coastview"], "backdrop.coastview"],
  [["西风庄园", "west wind", "west_wind"], "backdrop.westWind"],
  [["地铁", "ncart", "metro"], "backdrop.ncart"],
];

const DISTRICT_BACKDROPS: Readonly<Record<string, AssetId>> = {
  狗镇: "backdrop.dogtown",
  dogtown: "backdrop.dogtown",
  沃森: "backdrop.watson",
  watson: "backdrop.watson",
  威斯特布鲁克: "backdrop.westbrook",
  威斯布鲁克: "backdrop.westbrook",
  westbrook: "backdrop.westbrook",
  海伍德: "backdrop.heywood",
  heywood: "backdrop.heywood",
  市政中心: "backdrop.cityCenter",
  市中心: "backdrop.cityCenter",
  city_center: "backdrop.cityCenter",
  太平洲: "backdrop.pacifica",
  pacifica: "backdrop.pacifica",
  圣多明戈: "backdrop.santoDomingo",
  santo_domingo: "backdrop.santoDomingo",
  恶土: "backdrop.badlands",
  badlands: "backdrop.badlands",
};

/** 当前地点与时段 → 正文背景图；按固定地点 → 街区/地标关键词 → 城区 → 夜之城全景逐级匹配 */
export function backdropOf({ location, locationName, district, period }: BackdropQuery): AssetId {
  const isDay = period === "day" || period === "dawn";
  if (location === "kabuki-market") {
    return isDay ? "backdrop.watKabDay" : "backdrop.watKabNight";
  }
  if (location === "vik-clinic") {
    return isDay ? "backdrop.watLchDay" : "backdrop.watLchNight";
  }
  if (location) {
    const hit = LOCATION_BACKDROPS[location];
    if (hit) return hit;
  }

  const probe = `${location ?? ""} ${locationName ?? ""}`.toLowerCase();
  if (probe.trim()) {
    if (probe.includes("歌舞伎") || probe.includes("kabuki")) {
      return isDay ? "backdrop.watKabDay" : "backdrop.watKabNight";
    }
    if (
      probe.includes("小唐人街") ||
      probe.includes("little china") ||
      probe.includes("little_china")
    ) {
      return isDay ? "backdrop.watLchDay" : "backdrop.watLchNight";
    }
    if (probe.includes("北区") || probe.includes("northside")) {
      return isDay ? "backdrop.watNidDay" : "backdrop.watNidNight";
    }
    if (probe.includes("荒坂海滨") || probe.includes("waterfront")) {
      return isDay ? "backdrop.watAwfDay" : "backdrop.watAwfNight";
    }
    for (const [words, id] of KEYWORD_BACKDROPS) {
      if (words.some((w) => probe.includes(w))) return id;
    }
  }

  if (district) {
    const trimmed = district.trim();
    const byKey = DISTRICT_BACKDROPS[trimmed.toLowerCase()] ?? DISTRICT_BACKDROPS[trimmed];
    if (byKey) return byKey;
  }

  for (const [key, id] of Object.entries(DISTRICT_BACKDROPS)) {
    if (probe.includes(key)) return id;
  }

  return "menu.nightCity";
}
