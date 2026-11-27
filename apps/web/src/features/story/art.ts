import { cyberware as CONTENT_CYBERWARE, items as CONTENT_ITEMS } from "@cp/content";
import type { cyberwareRules, inventoryRules, PlayerView } from "@cp/core";
import type { AssetId } from "../../assets";
import {
  deleteCustomImageDataUrl,
  type GearArtId,
  setCustomImageDataUrl,
} from "../../assets/customArt";
import { ASSET_IDS } from "../../assets/ids.gen";

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
  "charles-bucks": "portrait.charlesBucks",
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
  "sandra-dorsett": "portrait.sandraDorsett",
  "arthur-jenkins": "portrait.arthurJenkins",
  "anthony-gilchrist": "portrait.anthonyGilchrist",
  "chang-hoon-nam": "portrait.changHoonNam",
  "lina-malina": "portrait.linaMalina",
  "rachel-casich": "portrait.rachelCasich",
  "joss-kutcher": "portrait.jossKutcher",
  "zane-jagger": "portrait.zaneJagger",
  "purple-force": "portrait.purpleForce",
  "farida-nazeri": "portrait.faridaNazeri",
  "anthony-anderson": "portrait.anthonyAnderson",
  "nina-kraviz": "portrait.ninaKraviz",
  "robert-rainwater": "portrait.robertRainwater",
};

/** 物品 id（武器、义体）→ 原作物品图 */
const ITEM_ART: Readonly<Record<string, AssetId>> = {
  // 治疗品、手雷与食品
  "health-booster": "itemArt.healthBooster",
  // 本作虚构药物，借用原作稳定剂注射器作为示意图。
  "psycho-suppressant": "itemArt.psychoSuppressant",
  errata: "weaponArt.errata",
  maxdoc: "itemArt.maxdoc",
  "maxdoc-mk2": "itemArt.maxdocMk2",
  "maxdoc-mk3": "itemArt.maxdocMk3",
  "bounce-back": "itemArt.bounceBack",
  "bounce-back-mk2": "itemArt.bounceBackMk2",
  "frag-grenade": "itemArt.frag",
  "smoke-grenade": "itemArt.smokeGrenade",
  "emp-grenade": "itemArt.emp",
  "incendiary-grenade": "itemArt.incendiary",
  flashbang: "itemArt.flashbang",
  "recon-grenade": "itemArt.recon",
  nicola: "itemArt.nicola",
  hawtdawg: "itemArt.hawtdawg",
  coffee: "itemArt.coffee",
  "synth-cigs": "itemArt.synthCigs",
  "real-liquor": "itemArt.realLiquor",
  "hemostatic-gel": "itemArt.hemostaticGel",
  "adrenaline-shot": "itemArt.adrenalineShot",
  "black-lace": "itemArt.blackLace",
  glitter: "itemArt.glitter",
  "strix-silencer": "itemArt.strixSilencer",
  "alecto-silencer": "itemArt.alectoSilencer",
  "cetus-silencer": "itemArt.cetusSilencer",
  "xc10-sniper-silencer": "itemArt.sniperSilencer",
  "rc7-compensator": "itemArt.rc7Compensator",
  "rc7-strigoi-brake": "itemArt.strigoiBrake",
  "militech-heavy-brake": "itemArt.heavyBrake",
  "kanetsugu-scope": "itemArt.kanetsuguScope",
  "add-vantage-scope": "itemArt.vantageScope",
  "smart-assist-optic": "itemArt.smartOptic",
  "handyman-thermal-scope": "itemArt.thermalScope",
  "arasaka-weakpoint-scope": "itemArt.weakpointScope",
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
  // 全 6 部位服装一对一官方专图（含防弹战术、潜网、帮派、公司高定与不朽装）
  "street-jacket": "itemArt.streetJacket",
  "corpo-suit": "itemArt.corpoSuit",
  "techie-coverall": "itemArt.techieCoverall",
  "netrunner-suit": "itemArt.netrunnerSuit",
  "street-beanie": "itemArt.streetBeanie",
  "nomad-headwrap": "itemArt.nomadHeadwrap",
  "tactical-helmet": "itemArt.tacticalHelmet",
  "nomad-welding-cap": "itemArt.nomadWeldingCap",
  "fixer-fedora": "itemArt.fixerFedora",
  "balaclava-hood": "itemArt.balaclavaHood",
  "netrunner-cooling-crown": "itemArt.netrunnerCoolingCrown",
  "ncpd-riot-helmet": "itemArt.ncpdRiotHelmet",
  "arasaka-kabuto-helm": "itemArt.arasakaKabutoHelm",
  "maxtac-visor-helmet": "itemArt.maxtacVisorHelmet",
  "mirror-shades": "itemArt.mirrorShades",
  "corpo-glasses": "itemArt.corpoGlasses",
  "tech-goggles": "itemArt.techGoggles",
  "respirator-mask": "itemArt.respiratorMask",
  "corpo-smart-specs": "itemArt.corpoSmartSpecs",
  "militech-gas-mask": "itemArt.militechGasMask",
  "netrunner-infovisor": "itemArt.netrunnerInfovisor",
  "thermal-tactical-visor": "itemArt.thermalTacticalVisor",
  "optical-scrambler-mask": "itemArt.opticalScramblerMask",
  "johnny-aviators": "itemArt.johnnyAviators",
  "kimono-haori": "itemArt.kimonoHaori",
  "neon-pvc-jacket": "itemArt.neonPvcJacket",
  "long-trenchcoat": "itemArt.longTrenchcoat",
  "work-apron": "itemArt.workApron",
  "club-dress": "itemArt.clubDress",
  "tyger-bomber-jacket": "itemArt.tygerBomberJacket",
  "mox-neon-bolero": "itemArt.moxNeonBolero",
  "valentino-gold-jacket": "itemArt.valentinoGoldJacket",
  "maelstrom-spike-vest": "itemArt.maelstromSpikeVest",
  "ncpd-patrol-vest": "itemArt.ncpdPatrolVest",
  "hazmat-overcoat": "itemArt.hazmatOvercoat",
  "arasaka-plate-vest": "itemArt.arasakaPlateVest",
  "aldecaldo-rally-jacket": "itemArt.aldecaldoRallyJacket",
  "arasaka-executive-coat": "itemArt.arasakaExecutiveCoat",
  "netwatch-trenchcoat": "itemArt.netwatchTrenchcoat",
  "militech-heavy-rig": "itemArt.militechHeavyRig",
  "trauma-response-armor": "itemArt.traumaResponseArmor",
  "stealth-assassin-coat": "itemArt.stealthAssassinCoat",
  "edgerunner-jacket": "itemArt.edgerunnerJacket",
  "samurai-jacket": "itemArt.samuraiJacket",
  "street-tee": "itemArt.streetTee",
  "silk-shirt": "itemArt.silkShirt",
  "turtleneck-knit": "itemArt.turtleneckKnit",
  "samurai-tour-tee": "itemArt.samuraiTourTee",
  "kevlar-undershirt": "itemArt.kevlarUndershirt",
  "solo-compression-top": "itemArt.soloCompressionTop",
  "thermal-stealth-liner": "itemArt.thermalStealthLiner",
  "mil-netrunner-suit": "itemArt.milNetrunnerSuit",
  "cargo-pants": "itemArt.cargoPants",
  "tailored-slacks": "itemArt.tailoredSlacks",
  "leather-pants": "itemArt.leatherPants",
  "nomad-reinforced-pants": "itemArt.nomadReinforcedPants",
  "tactical-knee-pants": "itemArt.tacticalKneePants",
  "netrunner-weave-pants": "itemArt.netrunnerWeavePants",
  "yorinobu-formal-slacks": "itemArt.yorinobuFormalSlacks",
  "combat-boots": "itemArt.combatBoots",
  "street-sneakers": "itemArt.streetSneakers",
  "dress-shoes": "itemArt.dressShoes",
  "rocker-studded-boots": "itemArt.rockerStuddedBoots",
  "netrunner-ground-boots": "itemArt.netrunnerGroundBoots",
  "silent-stalker-boots": "itemArt.silentStalkerBoots",
  "militech-exo-boots": "itemArt.militechExoBoots",
  // 武器插件各自独立专图
  "big-mag": "itemArt.modBigMag",
  "kneel-mod": "itemArt.modKneel",
  "bleedout-mod": "itemArt.modBleedout",
  "parallax-mod": "itemArt.modParallax",
  "smart-target-mod": "itemArt.modSmartTarget",
  "smart-link-module": "itemArt.modSmartLink",
  "kinetic-weight-mod": "itemArt.modKineticWeight",
  "arc-coil-mod": "itemArt.modArcCoil",
  "quick-reload-grip": "itemArt.modQuickReload",
  "ap-core-mod": "itemArt.modApCore",
  "pyro-rounds-mod": "itemArt.modPyroRounds",
  "toxin-coat-mod": "itemArt.modToxinCoat",
  "emp-rounds-mod": "itemArt.modEmpRounds",
  "thermal-edge-mod": "itemArt.modThermalEdge",
  "swiss-cheese-mod": "itemArt.modSwissCheese",
  "zero-recoil-stabilizer": "itemArt.modZeroRecoil",
  // 制服、证件与日常/战术渗透装备各自专图
  "security-uniform": "itemArt.securityUniform",
  "corpo-badge": "itemArt.corpoBadge",
  "holo-phone": "itemArt.holoPhone",
  "tool-kit": "itemArt.toolKit",
  "med-kit": "itemArt.medKit",
  "lockpick-set": "itemArt.lockpickSet",
  "ncpd-badge": "itemArt.ncpdBadge",
  "tarot-deck": "itemArt.tarotDeck",
  "rosary-beads": "itemArt.rosaryBeads",
  "gold-chain": "itemArt.goldChain",
  "cigar-case": "itemArt.cigarCase",
  "tactical-chest-rig": "itemArt.tacticalChestRig",
  "heavy-duffel-pack": "itemArt.heavyDuffelPack",
  "signal-jammer": "itemArt.signalJammer",
  "thermal-monocular": "itemArt.thermalMonocular",
  "optical-cloak": "itemArt.opticalCloak",
  "glass-cutter": "itemArt.glassCutter",
  "mag-grapple-kit": "itemArt.magGrappleKit",
  "faraday-pouch": "itemArt.faradayPouch",
  "ice-breaker-spike": "itemArt.iceBreakerSpike",
  "cloned-keycard": "itemArt.clonedKeycard",
  "relay-beacon": "itemArt.relayBeacon",
  // 武器
  "sor-22": "weaponArt.sor22",
  "kyubi-mod-x": "weaponArt.kyubiModX",
  "mk31-hmg": "weaponArt.mk31Hmg",
  "defender-mil-spec": "weaponArt.defenderMilSpec",
  "kenshin-spec-ops": "weaponArt.kenshinSpecOps",
  "overture-heavy": "weaponArt.overtureHeavy",
  "shingen-tac": "weaponArt.shingenTac",
  "senkoh-spec": "weaponArt.senkohSpec",
  "ajax-mil-spec": "weaponArt.ajaxMilSpec",
  crusher: "weaponArt.crusher",
  "thermal-katana-mil": "weaponArt.thermalKatanaMil",
  "gorilla-maul": "weaponArt.gorillaMaul",
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
  // 世界观扩展义体（感官音频 / 时尚生活 / 亲密共感 / 工具暗格 / 外骨骼与 FBC）
  "audio-suite": "cyberArt.atomicSensors",
  "chemo-olfactory-filter": "cyberArt.toxinCleanser",
  "jaw-stash-implant": "cyberArt.faceplate",
  "chroma-iris-overlay": "cyberArt.kiroshiAlt3",
  "tactile-nerve-amp": "cyberArt.tyrosineV2",
  "neural-sync-bridge": "cyberArt.bioconductor",
  "endorphin-micro-pump": "cyberArt.adrenalineBooster",
  "mr-studd": "cyberArt.universalBooster",
  "midnight-lady": "cyberArt.universalBooster",
  "synth-pheromone-glands": "cyberArt.reverseMetabolic",
  "chemskin-pigment": "cyberArt.holographicCamo",
  "light-tattoo-circuit": "cyberArt.tygerTattoo",
  "thermo-comfort-weave": "cyberArt.heatBooster",
  "linear-frame-sigma": "cyberArt.epimorphicSkeleton",
  "gemini-fbc-frame": "cyberArt.metalSkin",
  "dragoon-fbc-chassis": "cyberArt.chitin",
  "tool-hand-fingers": "cyberArt.powerGrip",
  "hidden-personal-link": "cyberArt.smartLink",
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

const VALID_ASSET_ID_SET: ReadonlySet<string> = new Set(ASSET_IDS);

function asValidAssetId(id: string | null | undefined): AssetId | undefined {
  if (!id) return undefined;
  return VALID_ASSET_ID_SET.has(id) ? (id as AssetId) : undefined;
}

interface CustomGearArtRecord {
  readonly art?: AssetId | undefined;
  readonly customImage?: string | undefined;
  readonly fallback?: AssetId | undefined;
}

const customGearArt = new Map<string, CustomGearArtRecord>();

/** 武器类别 → 同类默认官方图标（自建武器未选图时自动兜底） */
const DEFAULT_WEAPON_ART: Readonly<Record<string, AssetId>> = {
  pistol: "weaponArt.unity",
  revolver: "weaponArt.overture",
  smg: "weaponArt.shigure",
  assaultRifle: "weaponArt.copperhead",
  shotgun: "weaponArt.carnage",
  precisionRifle: "weaponArt.achilles",
  sniperRifle: "weaponArt.nekomata",
  lmg: "weaponArt.defender",
  blade: "weaponArt.katana",
  blunt: "weaponArt.baseballBat",
};

/** 服装部位 → 同类默认官方图标 */
const DEFAULT_CLOTHING_ART: Readonly<Record<string, AssetId>> = {
  head: "itemArt.tacticalHelmet",
  face: "itemArt.mirrorShades",
  outer: "itemArt.streetJacket",
  inner: "itemArt.streetTee",
  legs: "itemArt.cargoPants",
  feet: "itemArt.combatBoots",
};

/** 改装槽位 → 同类默认官方图标 */
const DEFAULT_MOD_ART: Readonly<Record<string, AssetId>> = {
  muzzle: "itemArt.strixSilencer",
  scope: "itemArt.kanetsuguScope",
  plugin: "itemArt.modBigMag",
};

/** 义体分类 / 槽位 → 同类默认官方图标 */
const DEFAULT_CYBERWARE_ART: Readonly<Record<string, AssetId>> = {
  chassis: "cyberArt.metalSkin",
  cyberdeck: "cyberArt.militechParaline",
  spineDrive: "cyberArt.dynalarSandevistan",
  optics: "cyberArt.kiroshiMk1",
  arms: "cyberArt.mantisBlades",
  legDrive: "cyberArt.reinforcedTendons",
  skinArmor: "cyberArt.subdermalArmor",
  neural: "cyberArt.bioconductor",
  sensory: "cyberArt.atomicSensors",
  torso: "cyberArt.biomonitor",
  extremities: "cyberArt.smartLink",
  lifestyle: "cyberArt.tygerTattoo",
  os: "cyberArt.militechParaline",
  eyes: "cyberArt.kiroshiMk1",
  legs: "cyberArt.reinforcedTendons",
  integumentary: "cyberArt.subdermalArmor",
  frontalCortex: "cyberArt.bioconductor",
  nervous: "cyberArt.kerenzikov",
  circulatory: "cyberArt.biomonitor",
  skeleton: "cyberArt.titaniumBones",
  hands: "cyberArt.smartLink",
};

export function fallbackItemArtFor(info: {
  readonly kind?: string | null | undefined;
  readonly category?: string | null | undefined;
  readonly clothingSlot?: string | null | undefined;
  readonly modSlot?: string | null | undefined;
}): AssetId {
  if (info.kind === "weapon") {
    return (info.category ? DEFAULT_WEAPON_ART[info.category] : undefined) ?? "weaponArt.unity";
  }
  if (info.kind === "clothing") {
    return (
      (info.clothingSlot ? DEFAULT_CLOTHING_ART[info.clothingSlot] : undefined) ??
      "itemArt.streetJacket"
    );
  }
  if (info.kind === "healing") return "itemArt.maxdoc";
  if (info.kind === "grenade") return "itemArt.frag";
  if (info.kind === "mod") {
    return (info.modSlot ? DEFAULT_MOD_ART[info.modSlot] : undefined) ?? "itemArt.modBigMag";
  }
  if (info.kind === "consumable") return "itemArt.nicola";
  return "itemArt.toolKit";
}

export function fallbackCyberwareArtFor(info: {
  readonly category?: string | null | undefined;
  readonly slot?: string | null | undefined;
}): AssetId {
  return (
    (info.category ? DEFAULT_CYBERWARE_ART[info.category] : undefined) ??
    (info.slot ? DEFAULT_CYBERWARE_ART[info.slot] : undefined) ??
    "cyberArt.biomonitor"
  );
}

/** 登记单个自建武器/物品的图标信息（支持官方图、本地上传图与同类自动兜底） */
export function registerCustomItemArt(item: {
  readonly id: string;
  readonly kind?: string | null | undefined;
  readonly category?: string | null | undefined;
  readonly clothingSlot?: string | null | undefined;
  readonly modSlot?: string | null | undefined;
  readonly art?: string | null | undefined;
  readonly customImage?: string | null | undefined;
}): void {
  const validArt = asValidAssetId(item.art);
  const customImage =
    typeof item.customImage === "string" && item.customImage.startsWith("data:image/")
      ? item.customImage
      : undefined;
  if (customImage) setCustomImageDataUrl(item.id, customImage);
  else deleteCustomImageDataUrl(item.id);
  const fallback =
    ITEM_ART[item.id] === undefined &&
    (item.kind || item.category || item.clothingSlot || item.modSlot)
      ? fallbackItemArtFor(item)
      : undefined;
  if (validArt || customImage || fallback) {
    customGearArt.set(item.id, { art: validArt, customImage, fallback });
  } else {
    customGearArt.delete(item.id);
  }
}

/** 登记单个自建义体的图标信息（支持官方图、本地上传图与同类自动兜底） */
export function registerCustomCyberwareArt(cw: {
  readonly id: string;
  readonly category?: string | null | undefined;
  readonly slot?: string | null | undefined;
  readonly art?: string | null | undefined;
  readonly customImage?: string | null | undefined;
}): void {
  const validArt = asValidAssetId(cw.art);
  const customImage =
    typeof cw.customImage === "string" && cw.customImage.startsWith("data:image/")
      ? cw.customImage
      : undefined;
  if (customImage) setCustomImageDataUrl(cw.id, customImage);
  else deleteCustomImageDataUrl(cw.id);
  const fallback =
    ITEM_ART[cw.id] === undefined && (cw.category || cw.slot)
      ? fallbackCyberwareArtFor(cw)
      : undefined;
  if (validArt || customImage || fallback) {
    customGearArt.set(cw.id, { art: validArt, customImage, fallback });
  } else {
    customGearArt.delete(cw.id);
  }
}

/** 从局内 PlayerView 同步所有自建装备与义体的自定义图标，保证读档/跨设备打开即刻显示 */
export function syncCustomGearArtFromView(view: PlayerView | null | undefined): void {
  if (!view) return;
  for (const [id, detail] of Object.entries(view.inventory.details)) {
    const targetId = detail.baseId || id;
    if (ITEM_ART[targetId] && !detail.art && !detail.customImage) continue;
    registerCustomItemArt({
      id: targetId,
      kind: detail.kind,
      category: detail.category,
      clothingSlot: detail.clothingSlot,
      modSlot: detail.modSlot,
      art: detail.art,
      customImage: detail.customImage,
    });
  }
  for (const cw of view.cyberware) {
    if (ITEM_ART[cw.id] && !cw.art && !cw.customImage) continue;
    registerCustomCyberwareArt({
      id: cw.id,
      category: cw.category,
      slot: cw.slot,
      art: cw.art,
      customImage: cw.customImage,
    });
  }
}

export interface OfficialArtOption {
  readonly artId: AssetId;
  readonly label: string;
  readonly group: "weapon" | "item" | "cyberware";
  readonly subGroup: string;
}

let cachedOfficialArtOptions: readonly OfficialArtOption[] | undefined;

/** 构建去重后的官方 2077 装备与义体图标目录，供自建表单可视化挑选 */
export function officialGearArtOptions(): readonly OfficialArtOption[] {
  if (cachedOfficialArtOptions) return cachedOfficialArtOptions;
  const seen = new Set<AssetId>();
  const out: OfficialArtOption[] = [];

  for (const item of CONTENT_ITEMS as readonly inventoryRules.ItemDef[]) {
    const artId = ITEM_ART[item.id];
    if (!artId || seen.has(artId)) continue;
    seen.add(artId);
    const group: "weapon" | "item" = item.kind === "weapon" ? "weapon" : "item";
    const subGroup =
      item.kind === "weapon"
        ? (item.category ?? "pistol")
        : item.kind === "clothing"
          ? `clothing:${item.clothingSlot ?? "outer"}`
          : item.kind === "mod"
            ? `mod:${item.modSlot ?? "plugin"}`
            : item.kind;
    out.push({ artId, label: item.name, group, subGroup });
  }

  for (const cw of CONTENT_CYBERWARE as readonly cyberwareRules.CyberwareDef[]) {
    const artId = ITEM_ART[cw.id];
    if (!artId || seen.has(artId)) continue;
    seen.add(artId);
    out.push({
      artId,
      label: cw.name,
      group: "cyberware",
      subGroup: cw.category ?? cw.slot,
    });
  }

  cachedOfficialArtOptions = out;
  return out;
}

export function itemArtOf(item: string | null | undefined): GearArtId | undefined {
  if (!item) return undefined;
  const base = baseWeaponIdOf(item);
  const custom = customGearArt.get(item) ?? customGearArt.get(base);
  if (custom?.customImage) {
    const key = customGearArt.has(item) ? item : base;
    return setCustomImageDataUrl(key, custom.customImage);
  }
  if (custom?.art) return custom.art;
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
  return custom?.fallback;
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
