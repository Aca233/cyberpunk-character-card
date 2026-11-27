import { z } from "zod";
import {
  type ArmSide,
  ArmSideSchema,
  ChassisProfileSchema,
  type CyberwareCategoryId,
  CyberwareCategoryIdSchema,
  type CyberwareDef,
  CyberwareDefenseSchema,
  CyberwareSlotSchema,
  checkCyberwareInstall,
  cyberwareCategoryOf,
  cyberwareExclusiveGroup,
  ExclusiveGroupSchema,
} from "../systems/cyberware/schema";
import { type Rarity, RaritySchema } from "../systems/economy/schema";
import { type ItemDef, ItemDefSchema } from "../systems/inventory/schema";
import { type LedgerKind, NpcCardSchema } from "../systems/npc/schema";

/**
 * 角色主板：出身、过往、本事三类插槽各插几块模块，再加负面经历、开局义体与开局行装。
 * 义体取消死板部位格数上限，仅按物理互斥组（ExclusiveGroup）约束。
 */

export const PAST_MIN = 0;
export const PAST_MAX = 5;
export const SKILL_MIN = 0;
export const SKILL_MAX = 10;
export const FLAW_MAX = 6;
/** 防极端畸形 JSON 的安全上限，不再以死板格数限制正常自由搭配 */
export const START_CYBERWARE_MAX = 64;
export const START_WEAPONS_MAX = 64;
export const START_ITEMS_MAX = 64;

export const BOARD_SLOTS = ["origin", "past", "skill", "flaw"] as const;
export const BoardSlotSchema = z.enum(BOARD_SLOTS);
export type BoardSlot = z.infer<typeof BoardSlotSchema>;

export const BOARD_SLOT_LABELS: Readonly<Record<BoardSlot, string>> = {
  origin: "出身",
  past: "过往",
  skill: "特质",
  flaw: "负面缺陷",
};

/** 赛博朋克 2077 命牌（大阿卡那 22 张塔罗牌）——角色气质锚点，对应全部 22 张内置原作塔罗牌 */
export const TAROT_CARDS = [
  "fool",
  "magician",
  "highpriestess",
  "empress",
  "emperor",
  "hierophant",
  "lovers",
  "chariot",
  "strength",
  "hermit",
  "wheeloffortune",
  "justice",
  "hangman",
  "death",
  "temperance",
  "devil",
  "tower",
  "star",
  "moon",
  "sun",
  "judgement",
  "world",
] as const;
export const TarotCardSchema = z.enum(TAROT_CARDS);
export type TarotCard = z.infer<typeof TarotCardSchema>;

export const TAROT_LABELS: Readonly<Record<TarotCard, string>> = {
  fool: "愚者",
  magician: "魔术师",
  highpriestess: "女祭司",
  empress: "女皇",
  emperor: "皇帝",
  hierophant: "教皇",
  lovers: "恋人",
  chariot: "战车",
  strength: "力量",
  hermit: "隐者",
  wheeloffortune: "命运之轮",
  justice: "正义",
  hangman: "倒吊人",
  death: "死神",
  temperance: "节制",
  devil: "恶魔",
  tower: "高塔",
  star: "星星",
  moon: "月亮",
  sun: "太阳",
  judgement: "审判",
  world: "世界",
};

export interface TarotMeta {
  readonly label: string;
  readonly english: string;
  readonly roman: string;
  readonly vibe: string;
  readonly prompt: string;
}

export const TAROT_INFO: Readonly<Record<TarotCard, TarotMeta>> = {
  fool: {
    label: "愚者",
    english: "THE FOOL",
    roman: "0",
    vibe: "明知深渊在前仍纵身跃入、靠本能与好运改写开局的冒险者",
    prompt: "愚者（不畏未知、敢拿命压上第一局，用直觉和锐气撞开夜之城的大门）",
  },
  magician: {
    label: "魔术师",
    english: "THE MAGICIAN",
    roman: "I",
    vibe: "化腐朽为利器、用改装与巧计改写胜算的操盘手",
    prompt: "魔术师（精于工具、改装与布局，总能用非对称手段破局）",
  },
  highpriestess: {
    label: "女祭司",
    english: "THE HIGH PRIESTESS",
    roman: "II",
    vibe: "洞察底层暗流、冷静拆解情报与秘密的观测者",
    prompt: "女祭司（深沉敏锐、看穿表象之下的暗流与隐秘规律）",
  },
  empress: {
    label: "女皇",
    english: "THE EMPRESS",
    roman: "III",
    vibe: "自带气场与人情网络、在铁血街头护住自己人的掌舵者",
    prompt: "女皇（从容丰沛、重情重义且极富掌控力，靠人脉与魅力立足）",
  },
  emperor: {
    label: "皇帝",
    english: "THE EMPEROR",
    roman: "IV",
    vibe: "信奉铁腕与秩序、用实力和规矩压住全场的霸权者",
    prompt: "皇帝（冷硬威严、寸步不让，习惯以权威、纪律与强硬手段定夺局面）",
  },
  hierophant: {
    label: "教皇",
    english: "THE HIEROPHANT",
    roman: "V",
    vibe: "恪守老派行规与师承、以信誉和原则说话的守道者",
    prompt: "教皇（尊崇规矩、传承与街头信誉，宁可吃亏也不破自己的底线）",
  },
  lovers: {
    label: "恋人",
    english: "THE LOVERS",
    roman: "VI",
    vibe: "在忠诚与抉择间燃烧、愿为重要之人押上一切的赴约者",
    prompt: "恋人（重羁绊与默契，每次关键选择都牵动人心与宿命）",
  },
  chariot: {
    label: "战车",
    english: "THE CHARIOT",
    roman: "VII",
    vibe: "高速突破、抢占先手、从不踩刹车的猎手",
    prompt: "战车（锋利决断、永远向前推进、在速度与险境里掌控局面）",
  },
  strength: {
    label: "力量",
    english: "STRENGTH",
    roman: "VIII",
    vibe: "硬骨头、以肉身与意志扛住失控的压迫感",
    prompt: "力量（逆境中不退步、靠硬骨头与克制的爆发力压场）",
  },
  hermit: {
    label: "隐者",
    english: "THE HERMIT",
    roman: "IX",
    vibe: "远离喧嚣与站队、独自在暗处打磨真相的独行客",
    prompt: "隐者（寡言自持、冷眼旁观都市喧嚣，只信自己亲手验证过的真相）",
  },
  wheeloffortune: {
    label: "命运之轮",
    english: "WHEEL OF FORTUNE",
    roman: "X",
    vibe: "顺势借力、在风云突变与赌局翻盘中稳坐庄家席",
    prompt: "命运之轮（敏于局势拐点、敢赌变数，总能在混乱洗牌里捞出筹码）",
  },
  justice: {
    label: "正义",
    english: "JUSTICE",
    roman: "XI",
    vibe: "恩怨分明、一笔一划清算黑账的冷面裁决者",
    prompt: "正义（讲究等价清算、眼里容不得模糊账，该还的债必定连本带利讨回）",
  },
  hangman: {
    label: "倒吊人",
    english: "THE HANGED MAN",
    roman: "XII",
    vibe: "敢以退为进、忍常人所不能忍、换个角度看穿死局的破壁者",
    prompt: "倒吊人（甘愿承受代价以换取逆转视角，越是绝境越能保持反常的清醒）",
  },
  death: {
    label: "死神",
    english: "DEATH",
    roman: "XIII",
    vibe: "干脆利落地斩断旧账与退路、从灰烬中重生的终结者",
    prompt: "死神（果决冷冽、不恋过往，每一步都在终结旧秩序并逼出蜕变）",
  },
  temperance: {
    label: "节制",
    english: "TEMPERANCE",
    roman: "XIV",
    vibe: "在镀铬狂潮与人性底线间精准拿捏分寸的调和者",
    prompt: "节制（克制冷静、擅长在钢丝上维持平衡，不被怒火或义体躁动吞噬）",
  },
  devil: {
    label: "恶魔",
    english: "THE DEVIL",
    roman: "XV",
    vibe: "看透欲望与筹码、敢与魔鬼签契约并反咬一口的野心家",
    prompt: "恶魔（洞悉贪婪与人性弱点，不避黑暗交易，善于用欲望和利益套牢对手）",
  },
  tower: {
    label: "高塔",
    english: "THE TOWER",
    roman: "XVI",
    vibe: "把虚伪秩序连根掀翻、在爆破与废墟中撕开口子的叛逆者",
    prompt: "高塔（炽烈颠覆、厌恶腐朽高墙，走到哪就把虚伪的铁幕掀到哪）",
  },
  star: {
    label: "星星",
    english: "THE STAR",
    roman: "XVII",
    vibe: "即便身处暗夜仍仰望自由与远方、留着一口微光的追梦人",
    prompt: "星星（历经泥泞仍保有一线清澈与希冀，向往夜之城霓虹之外的天空）",
  },
  moon: {
    label: "月亮",
    english: "THE MOON",
    roman: "XVIII",
    vibe: "游走阴影、擅长伪装与反杀的孤狼与魅影",
    prompt: "月亮（危险、莫测、善藏锋芒，游走于夜之城阴影与谎言之间）",
  },
  sun: {
    label: "太阳",
    english: "THE SUN",
    roman: "XIX",
    vibe: "轰轰烈烈活出名堂、把名字刻进大人物酒单的耀眼传奇",
    prompt: "太阳（张扬炽热、坦荡耀眼，要干就干一票让整座夜之城记住的大事）",
  },
  judgement: {
    label: "审判",
    english: "JUDGEMENT",
    roman: "XX",
    vibe: "从旧日余烬中苏醒、迎向最终清算与自我救赎的觉醒者",
    prompt: "审判（背负过往回响、面对命运召唤绝不逃避，以行动完成自我清算）",
  },
  world: {
    label: "世界",
    english: "THE WORLD",
    roman: "XXI",
    vibe: "历经百战已见全貌、把整座都市棋盘尽收眼底的圆融老手",
    prompt: "世界（沉稳通透、视野宏阔，早已看清夜之城浮沉规律并自成闭环）",
  },
};

const line = (max: number) => z.string().trim().max(max);

/** 模块带出的人物：开档后自动生成人物卡 */
export const ModulePersonSchema = z.object({
  name: z.string().trim().min(1).max(20),
  role: line(80).default(""),
});

export const BoardModuleSchema = z.object({
  /** 模块库里的 id；自己写的模块以 custom- 开头，工坊模块带 pack 前缀 */
  id: z.string().trim().min(1).max(60),
  slot: BoardSlotSchema,
  label: z.string().trim().min(1, "模块要有名字").max(24),
  /** 标签：分类筛选和检定加成按标签判断 */
  tags: z.array(z.string().trim().min(1).max(12)).max(6).default([]),
  /** 这块模块让角色能做到什么；叙事模型据此判断行动是否可行 */
  ability: line(200).default(""),
  /** 剧情钩子：叙事模型可以拿来做文章的线头 */
  hook: line(200).default(""),
  people: z.array(ModulePersonSchema).max(2).default([]),
  /** 玩家自己写或来自社区创意工坊的模块 */
  custom: z.boolean().default(false),
  /** 创意工坊底座：所属模组包 id（本地自建为 "local"） */
  packId: z.string().trim().max(60).optional(),
  /** 创意工坊底座：创作者署名 */
  author: z.string().trim().max(40).optional(),
});
export type BoardModule = z.infer<typeof BoardModuleSchema>;

/** 开局义体的快照：官方件由服务端按义体表重算，自定义/工坊件支持自包含快照兜底 */
export const StartCyberwareSchema = z.object({
  id: z.string().min(1).max(60),
  name: z.string().min(1).max(40),
  humanityCost: z.number().int().min(0).max(20),
  /** 创意工坊/自定义义体自包含快照字段 */
  slot: CyberwareSlotSchema.optional(),
  rarity: RaritySchema.optional(),
  summary: line(200).optional(),
  ability: line(200).optional(),
  armor: z.boolean().optional(),
  accelerator: z.boolean().optional(),
  deckProfile: line(60).optional(),
  exclusiveGroup: ExclusiveGroupSchema.optional(),
  /** v2 显式归类（核心主位 / 4 功能扩展区 / 外观生活） */
  category: CyberwareCategoryIdSchema.optional(),
  /** 手臂义体装配侧别（left / right / both） */
  armSide: ArmSideSchema.optional(),
  defaultArmSide: ArmSideSchema.optional(),
  capacityBonus: z.number().int().min(1).max(40).optional(),
  safeLineBonus: z.number().int().min(1).max(30).optional(),
  chassisProfile: ChassisProfileSchema.optional(),
  smartLink: z.boolean().optional(),
  carryBonus: z.number().int().min(1).max(3).optional(),
  defenses: z.array(CyberwareDefenseSchema).optional(),
  /** 指定内置官方图标 ID（如 cyberArt.mantisBlades） */
  art: z.string().trim().min(1).max(80).optional(),
  /** 本地上传的轻量图标缩略图（data:image/...） */
  customImage: z
    .string()
    .trim()
    .max(180_000)
    .regex(/^data:image\/(?:png|jpeg|webp|gif);base64,/i, "仅支持 PNG/JPEG/WebP/GIF 图片")
    .optional(),
  custom: z.boolean().optional(),
  packId: z.string().trim().max(60).optional(),
});
export type StartCyberware = z.infer<typeof StartCyberwareSchema>;

/** 开局启动资金档位 */
export const CASH_TIERS = ["broke", "standard", "stash", "windfall", "mogul"] as const;
export const CashTierSchema = z.enum(CASH_TIERS);
export type CashTier = z.infer<typeof CashTierSchema>;

/** 创角自定义启动资金上限（欧元） */
export const CUSTOM_EDDIES_MAX = 9_999_999;

export const CASH_TIER_INFO: Readonly<
  Record<
    CashTier,
    {
      readonly label: string;
      readonly eddiesDelta: number;
      readonly desc: string;
    }
  >
> = {
  broke: {
    label: "一贫如洗",
    eddiesDelta: 0,
    desc: "开局账户归零，从身无分文开始",
  },
  standard: {
    label: "出身标配",
    eddiesDelta: 0,
    desc: "按所选出身背景发放标准启动资金",
  },
  stash: {
    label: "私房金库",
    eddiesDelta: 10_000,
    desc: "额外携带 10,000 欧元私房钱，足够置办罕见义体或趁手装备",
  },
  windfall: {
    label: "巨额黑金",
    eddiesDelta: 35_000,
    desc: "额外携带 35,000 欧元黑金，足以开局购车、置业或装稀有义体",
  },
  mogul: {
    label: "财阀黑卡",
    eddiesDelta: 100_000,
    desc: "额外携带 100,000 欧元离岸黑金，直抵夜之城顶级消费门槛",
  },
};

export const StartKitItemSchema = z.object({
  id: z.string().trim().min(1).max(60),
  count: z.number().int().min(1).max(20).default(1),
});
export type StartKitItem = z.infer<typeof StartKitItemSchema>;

/** 开局行装定制：资金档位、自定义启动资金、随身武器（无数量限制）、随身物品、自建武器/物品快照与专属载具 */
export const StartKitSchema = z.object({
  cashTier: CashTierSchema.default("standard"),
  /** 自定义启动资金（非空时直接覆盖档位与出身基准） */
  customEddies: z.number().int().min(0).max(CUSTOM_EDDIES_MAX).nullable().default(null),
  weapons: z.array(z.string().trim().min(1).max(60)).max(START_WEAPONS_MAX).default([]),
  items: z.array(StartKitItemSchema).max(START_ITEMS_MAX).default([]),
  /** 自建武器与物品的自包含定义快照：不依赖官方物品目录也能正常进局、重放与分享 */
  customItems: z.array(ItemDefSchema).max(START_ITEMS_MAX).default([]),
  vehicle: z.string().trim().min(1).max(60).nullable().default(null),
});
export type StartKit = z.infer<typeof StartKitSchema>;

/** 统一计算角色开局实际启动资金（建卡预览与建档结算共用） */
export function resolveStartEddies(
  baseEddies: number,
  kit?: Pick<StartKit, "cashTier" | "customEddies">,
): number {
  if (!kit) return baseEddies;
  if (typeof kit.customEddies === "number") return kit.customEddies;
  if (kit.cashTier === "broke") return 0;
  return baseEddies + CASH_TIER_INFO[kit.cashTier].eddiesDelta;
}

export const RELATIONS = ["nod", "friend", "owesYou", "youOwe", "ex", "grudge"] as const;
export const RelationKindSchema = z.enum(RELATIONS);
export type RelationKind = z.infer<typeof RelationKindSchema>;

export interface RelationInfo {
  readonly label: string;
  /** 开局记一条人情或仇 */
  readonly ledger?: LedgerKind;
  /** 开局写一句关系笔记 */
  readonly note: boolean;
}

export const RELATION_INFO: Readonly<Record<RelationKind, RelationInfo>> = {
  nod: { label: "点头之交", note: true },
  friend: { label: "老朋友", note: true },
  owesYou: { label: "他欠你人情", ledger: "owesYou", note: true },
  youOwe: { label: "你欠他人情", ledger: "youOwe", note: true },
  ex: { label: "前任", note: true },
  grudge: { label: "旧仇", ledger: "grudge", note: true },
};

export const ACQUAINTANCE_MAX = 100;
export const ACQUAINTANCE_NOTE_CHARS = 60;
export const CUSTOM_NPCS_MAX = 60;
export const NPC_OVERRIDES_MAX = 80;

/** 一个旧识：id 是原作人物的 id、模块带出的人（board- 开头）或玩家自定义/工坊人物（custom- 开头） */
export const AcquaintanceSchema = z.object({
  id: z.string().trim().min(1).max(60),
  /** 显示用的名字快照；建档按 id 对人 */
  name: z.string().trim().min(1).max(20),
  relation: RelationKindSchema,
  /** 是什么事；不写由一键成稿补，补不上就按关系名写 */
  note: line(ACQUAINTANCE_NOTE_CHARS).default(""),
  /** 自定义/工坊旧识的身份简介（开局自动生成人物卡时使用） */
  role: line(80).optional(),
  custom: z.boolean().optional(),
  packId: z.string().trim().max(60).optional(),
  /** 工坊人物卡目录中的人物；按 NPC 卡片载入，不生成通用自定义旧识快照。 */
  catalogNpc: z.boolean().optional(),
});
export type Acquaintance = z.infer<typeof AcquaintanceSchema>;

export const BoardSchema = z.object({
  origin: BoardModuleSchema.nullable().default(null),
  /** 赛博朋克 2077 命牌（角色气质锚点） */
  tarot: TarotCardSchema.optional(),
  pasts: z.array(BoardModuleSchema).max(PAST_MAX).default([]),
  skills: z.array(BoardModuleSchema).max(SKILL_MAX).default([]),
  flaws: z.array(BoardModuleSchema).max(FLAW_MAX).default([]),
  cyberware: z.array(StartCyberwareSchema).max(START_CYBERWARE_MAX).default([]),
  acquaintances: z.array(AcquaintanceSchema).max(ACQUAINTANCE_MAX).default([]),
  /** 自建完整 NPC 人物卡快照（自包含，不依赖本地缓存即可进局、重放与分享） */
  customNpcs: z.array(NpcCardSchema).max(CUSTOM_NPCS_MAX).default([]),
  /** 对原作/工坊已有 NPC 的角色级覆写卡面（按 id 匹配，支持一键恢复默认） */
  npcOverrides: z.array(NpcCardSchema).max(NPC_OVERRIDES_MAX).default([]),
  /** 开局行装定制：资金档位、自定义启动资金、随身武器/物品、自建快照与专属载具 */
  kit: StartKitSchema.default({
    cashTier: "standard",
    customEddies: null,
    weapons: [],
    items: [],
    customItems: [],
    vehicle: null,
  }),
  /** 开局地图锚点 */
  startLocation: z.string().trim().min(1).max(80).optional(),
});
export type Board = z.infer<typeof BoardSchema>;

/** 创建时允许选取的官方义体稀有度；标志性的仍要进剧情后找义体医生 */
export const START_CYBERWARE_RARITIES: ReadonlySet<string> = new Set([
  "common",
  "uncommon",
  "rare",
  "epic",
  "legendary",
]);

/** 插在主板上的全部模块，按插槽顺序 */
export function boardModules(board: Board): BoardModule[] {
  return [...(board.origin ? [board.origin] : []), ...board.pasts, ...board.skills, ...board.flaws];
}

/** 主板哪里不合规矩；空数组表示通过模块校验，不限制点数或要求特质数量下限。 */
export function boardIssues(board: Board): string[] {
  const issues: string[] = [];
  if (!board.origin) issues.push("出身插槽还空着");
  const placed: [BoardSlot, readonly BoardModule[]][] = [
    ["origin", board.origin ? [board.origin] : []],
    ["past", board.pasts],
    ["skill", board.skills],
    ["flaw", board.flaws],
  ];
  const seen = new Set<string>();
  for (const [slot, list] of placed) {
    for (const m of list) {
      if (m.slot !== slot) {
        issues.push(
          `「${m.label}」是${BOARD_SLOT_LABELS[m.slot]}模块，不能插在${BOARD_SLOT_LABELS[slot]}插槽`,
        );
      }
      if (seen.has(m.id)) issues.push(`「${m.label}」插了不止一次`);
      seen.add(m.id);
    }
  }
  const ids = new Set<string>();
  for (const c of board.cyberware) {
    if (ids.has(c.id)) issues.push(`开局义体「${c.name}」选了不止一次`);
    ids.add(c.id);
  }
  const known = new Set<string>();
  for (const a of board.acquaintances) {
    if (known.has(a.id)) issues.push(`旧识「${a.name}」选了不止一次`);
    known.add(a.id);
  }
  return issues;
}

export interface BoardTables {
  readonly cyberware: readonly CyberwareDef[];
}

/**
 * 存角色卡前在服务端调一次：按义体表重算开局义体的快照（自定义/工坊义体支持自包含快照兜底）
 */
export function normalizeBoard(
  board: Board,
  tables: BoardTables,
): { readonly ok: true; readonly board: Board } | { readonly ok: false; readonly error: string } {
  const catalog = tables.cyberware;
  const placed: (CyberwareDef & { readonly armSide?: ArmSide | undefined })[] = [];
  const cyberware: StartCyberware[] = [];
  for (const item of board.cyberware) {
    const def = catalog.find((c) => c.id === item.id);
    if (!def) {
      // 创意工坊/自定义义体自包含快照兜底：按物理互斥、分区空间与神经承载硬顶校验
      if (item.custom && item.slot) {
        const rarity: Rarity = item.rarity ?? "rare";
        const isLifestyle = item.category === "lifestyle";
        const humanityCost = isLifestyle ? 0 : item.humanityCost;
        const probe: CyberwareDef & { readonly armSide?: ArmSide | undefined } = {
          id: item.id,
          name: item.name,
          slot: item.slot,
          rarity,
          price: 0,
          humanityCost,
          ability: item.ability || item.summary || "自定义义体模块",
          armor: Boolean(item.armor),
          accelerator: Boolean(item.accelerator),
          iconic: false,
          ...(item.deckProfile ? { deckProfile: item.deckProfile, deckTraits: [] } : {}),
          ...(item.exclusiveGroup ? { exclusiveGroup: item.exclusiveGroup } : {}),
          ...(item.category ? { category: item.category } : {}),
          ...(item.armSide ? { armSide: item.armSide } : {}),
          ...(item.defaultArmSide ? { defaultArmSide: item.defaultArmSide } : {}),
          ...(item.capacityBonus !== undefined ? { capacityBonus: item.capacityBonus } : {}),
          ...(item.safeLineBonus !== undefined ? { safeLineBonus: item.safeLineBonus } : {}),
          ...(item.chassisProfile ? { chassisProfile: item.chassisProfile } : {}),
          ...(item.smartLink ? { smartLink: true } : {}),
          ...(item.carryBonus !== undefined ? { carryBonus: item.carryBonus } : {}),
          ...(item.defenses ? { defenses: item.defenses } : {}),
        };
        const check = checkCyberwareInstall(probe, placed);
        if (!check.ok) {
          return { ok: false, error: check.reason };
        }
        placed.push(probe);
        cyberware.push({ ...item, rarity, humanityCost });
        continue;
      }
      return { ok: false, error: `义体表里没有 ${item.id}` };
    }
    if (def.iconic || !START_CYBERWARE_RARITIES.has(def.rarity)) {
      return { ok: false, error: `${def.name}不能在创建时装，进剧情后找义体医生` };
    }
    const probe = item.armSide ? { ...def, armSide: item.armSide } : def;
    const check = checkCyberwareInstall(probe, placed);
    if (!check.ok) {
      return { ok: false, error: check.reason };
    }
    const group = cyberwareExclusiveGroup(def);
    const category: CyberwareCategoryId = cyberwareCategoryOf(def);
    placed.push(probe);
    cyberware.push({
      id: def.id,
      name: def.name,
      humanityCost: def.humanityCost,
      slot: def.slot,
      rarity: def.rarity,
      category,
      ...(def.ability ? { ability: def.ability } : {}),
      ...(def.armor ? { armor: true } : {}),
      ...(def.accelerator ? { accelerator: true } : {}),
      ...(def.deckProfile ? { deckProfile: def.deckProfile } : {}),
      ...(group ? { exclusiveGroup: group } : {}),
      ...(def.defaultArmSide ? { defaultArmSide: def.defaultArmSide } : {}),
      ...(def.capacityBonus !== undefined ? { capacityBonus: def.capacityBonus } : {}),
      ...(def.safeLineBonus !== undefined ? { safeLineBonus: def.safeLineBonus } : {}),
      ...(def.chassisProfile ? { chassisProfile: def.chassisProfile } : {}),
      ...(def.smartLink ? { smartLink: true } : {}),
      ...(def.carryBonus !== undefined ? { carryBonus: def.carryBonus } : {}),
      ...(def.defenses ? { defenses: def.defenses } : {}),
      ...(item.art || def.art ? { art: item.art ?? def.art } : {}),
      ...(item.customImage || def.customImage
        ? { customImage: item.customImage ?? def.customImage }
        : {}),
      ...(item.armSide && group === "armMount" ? { armSide: item.armSide } : {}),
      ...(item.custom ? { custom: true, ...(item.packId ? { packId: item.packId } : {}) } : {}),
    });
  }
  return { ok: true, board: { ...board, cyberware } };
}

/** 将主板中的自包含自定义义体快照转成运行时 CyberwareDef（已存在于目录的按目录为准） */
export function customCyberwareDefs(
  snapshots: readonly StartCyberware[] | undefined,
  existingIds?: ReadonlySet<string>,
): CyberwareDef[] {
  if (!snapshots || snapshots.length === 0) return [];
  const seen = new Set(existingIds);
  const out: CyberwareDef[] = [];
  for (const item of snapshots) {
    if (!item.slot || seen.has(item.id)) continue;
    if (!/^[a-z0-9-]+$/.test(item.id)) continue;
    seen.add(item.id);
    const humanityCost = item.category === "lifestyle" ? 0 : item.humanityCost;
    out.push({
      id: item.id,
      name: item.name,
      slot: item.slot,
      rarity: item.rarity ?? "rare",
      price: 0,
      humanityCost,
      ability: item.ability || item.summary || "自定义义体模块",
      armor: Boolean(item.armor),
      accelerator: Boolean(item.accelerator),
      iconic: false,
      ...(item.deckProfile ? { deckProfile: item.deckProfile, deckTraits: [] } : {}),
      ...(item.exclusiveGroup ? { exclusiveGroup: item.exclusiveGroup } : {}),
      ...(item.category ? { category: item.category } : {}),
      ...(item.defaultArmSide ? { defaultArmSide: item.defaultArmSide } : {}),
      ...(item.capacityBonus !== undefined ? { capacityBonus: item.capacityBonus } : {}),
      ...(item.safeLineBonus !== undefined ? { safeLineBonus: item.safeLineBonus } : {}),
      ...(item.chassisProfile ? { chassisProfile: item.chassisProfile } : {}),
      ...(item.smartLink ? { smartLink: true } : {}),
      ...(item.carryBonus !== undefined ? { carryBonus: item.carryBonus } : {}),
      ...(item.defenses ? { defenses: item.defenses } : {}),
      ...(item.art ? { art: item.art } : {}),
      ...(item.customImage ? { customImage: item.customImage } : {}),
    });
  }
  return out;
}

/** 将主板行装中的自包含自建武器/物品快照转成运行时 ItemDef（已存在于目录的按目录为准） */
export function customItemDefs(
  snapshots: readonly ItemDef[] | undefined,
  existingIds?: ReadonlySet<string>,
): ItemDef[] {
  if (!snapshots || snapshots.length === 0) return [];
  const seen = new Set(existingIds);
  const out: ItemDef[] = [];
  for (const item of snapshots) {
    if (seen.has(item.id)) continue;
    if (!/^[a-z0-9-]+$/.test(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

function moduleLine(m: BoardModule): string {
  const people = m.people.map((p) => (p.role ? `${p.name}（${p.role}）` : p.name)).join("、");
  const parts = [
    `${BOARD_SLOT_LABELS[m.slot]}「${m.label}」${m.tags.length > 0 ? `〔${m.tags.join("、")}〕` : ""}`,
    m.ability && `${m.slot === "flaw" ? "处境" : "能力"}：${m.ability}`,
    m.hook && `钩子：${m.hook}`,
    people && `人物：${people}`,
  ];
  return `- ${parts.filter((p) => p !== "").join("；")}`;
}

/** 给模型看的主板：每块模块一行 */
export function boardBrief(board: Board): string {
  const lines = [
    ...(board.tarot ? [`- 命牌气质：${TAROT_INFO[board.tarot].prompt}`] : []),
    ...boardModules(board).map(moduleLine),
  ];
  if (board.cyberware.length > 0) {
    lines.push(`- 开局义体：${board.cyberware.map((c) => c.name).join("、")}`);
  }
  if (board.kit) {
    if (typeof board.kit.customEddies === "number") {
      lines.push(
        `- 开局财务状况：自定义启动资金 ${board.kit.customEddies.toLocaleString("en-US")} 欧元`,
      );
    } else if (board.kit.cashTier !== "standard") {
      lines.push(`- 开局财务状况：${CASH_TIER_INFO[board.kit.cashTier].label}`);
    }
  }
  for (const a of board.acquaintances) {
    lines.push(
      `- 旧识「${a.name}」${a.role ? `（${a.role}）` : ""}：${RELATION_INFO[a.relation].label}${a.note ? `；${a.note}` : ""}`,
    );
  }
  return ["主板（能力是角色已经能做到的事，钩子是剧情可以用的线头）：", ...lines].join("\n");
}
