import { z } from "zod";
import { RaritySchema } from "../economy";

/** 义体部位，按原作分类；每个部位能装几件见 SLOT_CAPACITY */
export const CYBERWARE_SLOTS = [
  "frontalCortex",
  "eyes",
  "nervous",
  "os",
  "circulatory",
  "integumentary",
  "skeleton",
  "hands",
  "arms",
  "legs",
] as const;
export const CyberwareSlotSchema = z.enum(CYBERWARE_SLOTS);
export type CyberwareSlot = z.infer<typeof CyberwareSlotSchema>;

export const SLOT_LABELS: Readonly<Record<CyberwareSlot, string>> = {
  frontalCortex: "额叶皮质",
  eyes: "义眼与面甲",
  nervous: "神经系统",
  os: "操作系统",
  circulatory: "循环系统",
  integumentary: "表皮防护",
  skeleton: "骨骼",
  hands: "手掌",
  arms: "手臂",
  legs: "腿部",
};

/** 界面与叙事统一分区：10 个身体核心解剖部位 + 独立的「日常与感官」「全身躯壳」 */
export const CYBERWARE_SECTION_IDS = [...CYBERWARE_SLOTS, "lifestyle", "fbc"] as const;
export type CyberwareSectionId = (typeof CYBERWARE_SECTION_IDS)[number];

export const SECTION_LABELS: Readonly<Record<CyberwareSectionId, string>> = {
  ...SLOT_LABELS,
  lifestyle: "日常与感官",
  fbc: "全身躯壳",
};

const LIFESTYLE_SENSORY_IDS = new Set([
  "audio-suite",
  "chemo-olfactory-filter",
  "jaw-stash-implant",
  "chroma-iris-overlay",
  "voice-modulator",
  "sleep-skip-regulator",
  "braindance-recorder",
  "tactile-nerve-amp",
  "neural-sync-bridge",
  "endorphin-micro-pump",
  "mr-studd",
  "midnight-lady",
  "synth-pheromone-glands",
  "chemskin-pigment",
  "light-tattoo-circuit",
  "thermo-comfort-weave",
]);

/**
 * 物理互斥组：只拦截现实人体解剖/接口层面真正无法并存的硬件，不再用固定部位总格数一刀切。
 * - cyberdeck（主网络接入仓，限 1）与 spineDrive（脊柱加速/狂暴主驱，限 1）互不互斥，允许双中枢并行（以高压神经负荷为代价）；
 * - armMount（重型臂部义肢/武装，限 2）支持左右双臂自由混搭；
 * - legDrive（腿部肌腱/骨架主驱，限 1）与脚掌/暗格等附挂件不互斥；
 * - optics（主义眼模组，限 1）与面部面板、音频、嗅觉、声带等感官义体不互斥；
 * - skinArmor（全覆式表皮主甲，限 1）与光学迷彩、涂层、时尚皮肤、走私腔不互斥；
 * - fullBorg（全身义体框架 FBC，限 1）与 intimateCore（核心亲密义体，限 1）各限 1 套。
 */
export const EXCLUSIVE_GROUPS = [
  "cyberdeck",
  "spineDrive",
  "optics",
  "armMount",
  "legDrive",
  "skinArmor",
  "fullBorg",
  "intimateCore",
] as const;
export const ExclusiveGroupSchema = z.enum(EXCLUSIVE_GROUPS);
export type ExclusiveGroup = z.infer<typeof ExclusiveGroupSchema>;

export const EXCLUSIVE_GROUP_LIMIT: Readonly<Record<ExclusiveGroup, number>> = {
  cyberdeck: 1,
  spineDrive: 1,
  optics: 1,
  armMount: 2,
  legDrive: 1,
  skinArmor: 1,
  fullBorg: 1,
  intimateCore: 1,
};

export const EXCLUSIVE_GROUP_LABELS: Readonly<Record<ExclusiveGroup, string>> = {
  cyberdeck: "主网络接入仓",
  spineDrive: "脊柱加速/狂暴主驱",
  optics: "主义眼模组",
  armMount: "重型臂部武装/义肢",
  legDrive: "腿部肌腱/骨架主驱",
  skinArmor: "全覆式表皮主甲",
  fullBorg: "全身义体框架（FBC）",
  intimateCore: "核心亲密义体",
};

const LEG_DRIVE_IDS = new Set([
  "prosthetic-legs",
  "fortified-ankles",
  "reinforced-tendons",
  "jenkins-tendons",
  "leeroy-ligament-system",
  "badlands-runner-legs",
  "anchor-hydraulic-legs",
]);

export interface ExclusiveProbe {
  readonly id: string;
  readonly name: string;
  readonly slot: CyberwareSlot;
  readonly exclusiveGroup?: ExclusiveGroup | undefined;
  readonly armor?: boolean | undefined;
  readonly accelerator?: boolean | undefined;
  readonly deckTraits?: readonly string[] | undefined;
  readonly deckProfile?: string | undefined;
}

const MAIN_OPTICS_IDS = new Set([
  "kiroshi-mk1",
  "kiroshi-mk2",
  "kiroshi-clairvoyant",
  "kiroshi-doomsayer",
  "kiroshi-stalker",
  "kiroshi-oracle",
  "kiroshi-sentry",
  "kiroshi-cockatrice",
  "arasaka-optics",
  "militech-thermal-optics",
  "zetatech-net-optics",
  "street-mod-optics",
]);

/** 推断一件义体所属的物理互斥组；返回 null 表示不互斥、可自由叠加。 */
export function cyberwareExclusiveGroup(def: ExclusiveProbe): ExclusiveGroup | null {
  if (def.exclusiveGroup) return def.exclusiveGroup;
  if (def.slot === "os") {
    if ((def.deckTraits && def.deckTraits.length > 0) || def.deckProfile) return "cyberdeck";
    if (def.accelerator || def.id.includes("berserk") || def.id.includes("sandevistan")) {
      return "spineDrive";
    }
    return null;
  }
  if (def.slot === "eyes") {
    return MAIN_OPTICS_IDS.has(def.id) || def.id.startsWith("kiroshi-") ? "optics" : null;
  }
  if (def.slot === "arms") return "armMount";
  if (def.slot === "legs") return LEG_DRIVE_IDS.has(def.id) ? "legDrive" : null;
  if (def.slot === "integumentary") return def.armor ? "skinArmor" : null;
  return null;
}

/** 按常识归类一件义体在界面中的直觉分区：全身义体化(FBC) 归「全身躯壳」，生活/外观/感官/亲密归「日常与感官」，其余按解剖部位展示。 */
export function cyberwareSectionOf(def: ExclusiveProbe): CyberwareSectionId {
  const group = cyberwareExclusiveGroup(def);
  if (group === "fullBorg") return "fbc";
  if (LIFESTYLE_SENSORY_IDS.has(def.id)) return "lifestyle";
  return def.slot;
}

export type CyberwareConflictResult<T extends ExclusiveProbe = ExclusiveProbe> =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly group: ExclusiveGroup;
      readonly limit: number;
      readonly label: string;
      readonly blockers: readonly T[];
    };

const SINGLE_ARM_IDS = new Set([
  "projectile-launch-system",
  "thermal-projectile-launch",
  "electric-projectile-launch",
  "toxic-projectile-launch",
  "tech-utility-arm",
  "surgical-prosthetic-arm",
]);

/** 判断臂部义体默认是单臂装配（如射弹发射器、工程/医疗义臂）还是双臂成对（如猩猩手臂、螳螂刀、单分子线）。 */
export function isSingleArmCyberware(id: string): boolean {
  return SINGLE_ARM_IDS.has(id) || id.includes("projectile-launch");
}

/** 返回义体的成对/单双侧装配提示文案（用于创角、局内义体页与诊所明确告知玩家是单手还是双手生效）。 */
export function cyberwareMountHint(
  def: ExclusiveProbe,
  installedArmCount = 0,
): { readonly badge: string; readonly detail: string } | null {
  const group = cyberwareExclusiveGroup(def);
  if (group === "armMount") {
    const single = isSingleArmCyberware(def.id);
    if (installedArmCount >= 2) {
      return {
        badge: "左右臂混搭",
        detail: "左右双臂各自搭载一套义臂（2/2）",
      };
    }
    if (single) {
      return {
        badge: "单臂装配",
        detail: "默认装于单侧手臂，另一只手臂仍可加装第 2 件混搭",
      };
    }
    return {
      badge: "双臂成对",
      detail: "单装时默认双臂成对生效；再装第 2 件臂部义体时自动改为左右臂混搭",
    };
  }
  if (group === "optics") {
    return {
      badge: "双眼成对",
      detail: "主视觉义眼模组（双目成对生效，不占用耳/鼻/虹膜等感官件）",
    };
  }
  if (group === "legDrive") {
    return {
      badge: "双腿成对",
      detail: "双腿成套驱动改造（不占用脚掌静音/腿侧暗格等附挂件）",
    };
  }
  return null;
}

/** 检查装入 candidate 是否与已装义体发生物理互斥冲突。 */
export function cyberwareConflicts<T extends ExclusiveProbe>(
  candidate: ExclusiveProbe,
  installed: readonly T[],
): CyberwareConflictResult<T> {
  const group = cyberwareExclusiveGroup(candidate);
  if (!group) return { ok: true };
  const blockers = installed.filter(
    (item) => item.id !== candidate.id && cyberwareExclusiveGroup(item) === group,
  );
  const limit = EXCLUSIVE_GROUP_LIMIT[group];
  if (blockers.length >= limit) {
    return {
      ok: false,
      group,
      limit,
      label: EXCLUSIVE_GROUP_LABELS[group],
      blockers,
    };
  }
  return { ok: true };
}

export interface LoadProbe extends ExclusiveProbe {
  readonly humanityCost: number;
  readonly iconic?: boolean | undefined;
}

export interface CyberwareLoadProfile {
  readonly totalCount: number;
  readonly zeroLoadCount: number;
  readonly activeLoadScore: number;
  readonly dualCore: boolean;
  readonly fullBorg: string | null;
  readonly heavyNames: readonly string[];
  readonly tier: "light" | "standard" | "heavy" | "extreme";
  readonly label: string;
  readonly tone: "ok" | "warn" | "bad";
  readonly summary: string;
}

/**
 * 纯事实神经负荷分析：只基于角色实际装在身上的完好义体，不依赖抽象的“低/中/高耐受”属性。
 * 零负荷生活/时尚/感官/亲密义体不增加神经压迫；双中枢并发、全身义体化（FBC）与高负荷军用重器会如实标出。
 */
export function cyberwareLoadProfile(installed: readonly LoadProbe[]): CyberwareLoadProfile {
  let zeroLoadCount = 0;
  let score = 0;
  let hasDeck = false;
  let hasSpine = false;
  let fullBorg: string | null = null;
  const heavyNames: string[] = [];

  for (const item of installed) {
    const group = cyberwareExclusiveGroup(item);
    if (group === "cyberdeck") hasDeck = true;
    if (group === "spineDrive") hasSpine = true;
    if (group === "fullBorg") fullBorg = item.name;
    if (item.humanityCost <= 0) {
      zeroLoadCount += 1;
    } else {
      score += item.humanityCost;
    }
    if (item.humanityCost >= 10 || item.iconic || group === "fullBorg") {
      heavyNames.push(item.name);
    }
  }

  const dualCore = hasDeck && hasSpine;
  const effectiveScore = score + (dualCore ? 14 : 0);

  const tier: CyberwareLoadProfile["tier"] =
    fullBorg !== null || effectiveScore >= 65 || (dualCore && effectiveScore >= 48)
      ? "extreme"
      : dualCore || effectiveScore >= 40 || heavyNames.length >= 3
        ? "heavy"
        : effectiveScore >= 16
          ? "standard"
          : "light";

  const label =
    tier === "extreme"
      ? "极限超载"
      : tier === "heavy"
        ? "高压重改"
        : tier === "standard"
          ? "常规镀铬"
          : "轻度负荷";

  const tone: CyberwareLoadProfile["tone"] =
    tier === "extreme" ? "bad" : tier === "heavy" ? "warn" : "ok";

  const facts: string[] = [];
  if (fullBorg) facts.push(`全身义体化「${fullBorg}」`);
  if (dualCore) facts.push("双中枢并行（接入仓 + 脊柱加速/狂暴）");
  if (heavyNames.length > 0) {
    const shown = heavyNames.filter((n) => n !== fullBorg).slice(0, 4);
    if (shown.length > 0) facts.push(`高压重器：${shown.join("、")}`);
  }
  if (zeroLoadCount > 0 && facts.length === 0) {
    facts.push(`含 ${zeroLoadCount} 件零神经负荷生活/感官改造`);
  }

  const summary =
    tier === "extreme"
      ? `${facts.join("；")}——神经系统长期处于极限压榨状态，连开加速、双中枢并发、重伤失血、情感重创或长期断药/缺调校极易诱发真实赛博精神病症状。`
      : tier === "heavy"
        ? `${facts.join("；")}——重度实战改造，常态可控但高烈度连续压榨或严重刺激时易起神经排异与感官噪点，需要定期医生调校或备免疫抑制剂。`
        : tier === "standard"
          ? "常规佣兵级义体负荷，日常同步平稳，仅在强黑客攻脑、重伤休克或剧烈精神创伤时可能起波澜。"
          : installed.length === 0
            ? "未安装额外义体，纯原生肉身神经。"
            : "轻度或零负荷生活/感官改造，日常几乎无神经排异负担。";

  return {
    totalCount: installed.length,
    zeroLoadCount,
    activeLoadScore: effectiveScore,
    dualCore,
    fullBorg,
    heavyNames,
    tier,
    label,
    tone,
    summary,
  };
}

/** 黑客硬件的定性特化：隐蔽、群控扩散、强攻烧毁、黑墙、网监溯源、防黑冰、散热回复 */
export const DECK_TRAITS = [
  "stealth",
  "spread",
  "combat",
  "blackwall",
  "netwatch",
  "antiIce",
  "recovery",
] as const;
export const DeckTraitSchema = z.enum(DECK_TRAITS);
export type DeckTrait = z.infer<typeof DeckTraitSchema>;

export const DECK_TRAIT_LABELS: Readonly<Record<DeckTrait, string>> = {
  stealth: "隐蔽渗透",
  spread: "群控扩散",
  combat: "强攻烧毁",
  blackwall: "黑墙异质协议",
  netwatch: "网监溯源",
  antiIce: "防黑冰",
  recovery: "散热缓冲",
};

/** 行为芯片统一四态模型（玩家与 NPC 共用）：清醒 / 玩偶托管 / 改装协议 / 芯片异常 */
export const BehaviorChipModeSchema = z.enum(["off", "doll", "protocol", "glitch"]);
export type BehaviorChipMode = z.infer<typeof BehaviorChipModeSchema>;

export const BEHAVIOR_CHIP_MODE_LABELS: Readonly<Record<BehaviorChipMode, string>> = {
  off: "清醒",
  doll: "玩偶托管",
  protocol: "改装协议",
  glitch: "芯片异常",
};

/** 设备本身的固定行为与记忆条件；职业称呼不等于实际安装。 */
export const BehaviorChipProfileSchema = z.object({
  purpose: z.string().trim().min(1).max(160),
  awareness: z.enum(["present", "absent"]).default("absent"),
  recall: z.enum(["retained", "none"]).default("none"),
  logging: z.enum(["none", "local-summary"]).default("local-summary"),
  safeword: z.string().trim().min(1).max(40).optional(),
});
export type BehaviorChipProfile = z.infer<typeof BehaviorChipProfileSchema>;

export const BehaviorChipStateSchema = z.object({
  mode: BehaviorChipModeSchema,
  protocol: z.string().trim().min(1).max(120).nullable().default(null),
  /** 由外置行为协议芯片驱动时记录对应载体 id；现场直刷协议为 null */
  carrier: z.string().min(1).nullable().default(null),
  since: z.number().int(),
  memoryGap: z.boolean().default(false),
  lastControl: z
    .object({
      from: z.number().int(),
      to: z.number().int().nullable(),
      mode: BehaviorChipModeSchema.optional(),
    })
    .optional(),
  /** 日志是设备摘要，不是超梦、亲历记忆或全知客户档案。 */
  logs: z
    .array(
      z.object({
        id: z.string().min(1),
        text: z.string().trim().min(1).max(240),
        at: z.number().int(),
        reviewedAt: z.number().int().nullable(),
      }),
    )
    .default([]),
});
export type BehaviorChipState = z.infer<typeof BehaviorChipStateSchema>;

export const BehaviorChipTermsSchema = z.object({
  device: z.string().min(1).describe("实际已安装的行为芯片型号 id（如 doll-behavior-chip）"),
  action: z.enum(["mode", "log", "review"]),
  mode: BehaviorChipModeSchema.optional().describe(
    "四态切换：off 清醒、doll 玩偶托管、protocol 改装协议、glitch 芯片故障/被骇",
  ),
  protocol: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .optional()
    .describe("mode=protocol 时写入当前刷入的协议名或芯片（如格斗/潜行/情绪屏蔽协议）"),
  carrier: z.string().min(1).optional().describe("可选：驱动该协议的外置行为协议芯片载体 id"),
  log: z.string().min(1).optional().describe("一段实际设备摘要的稳定 id；重复记录不改原文"),
  text: z.string().trim().min(1).max(240).optional().describe("实际记录到的摘要，不写未取得的想法"),
  reason: z.string().trim().min(1).max(240).optional().describe("可选：触发切换或故障的具体原因"),
});
export type BehaviorChipTerms = z.infer<typeof BehaviorChipTermsSchema>;

export const BehaviorChipCommandSchema = BehaviorChipTermsSchema.extend({
  type: z.literal("cyberware.behavior"),
}).describe(
  "玩家本人已安装行为芯片的四态切换（off/doll/protocol/glitch）、设备摘要记录与查阅；不替玩家自动安装或替玩家做情感决定。安全词随时切回 off。",
);
export type BehaviorChipCommand = z.infer<typeof BehaviorChipCommandSchema>;

/** 义体表的一条；数据在 content 包的 cyberware.ts */
export const CyberwareDefSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  slot: CyberwareSlotSchema,
  rarity: RaritySchema,
  /** 义体医生的参考价，含安装费 */
  price: z.number().int().min(0),
  /** 装着时人性上限降低多少 */
  humanityCost: z.number().int().min(0).max(20),
  /** 装上后角色真的能做到什么；写给模型，也显示在侧栏 */
  ability: z.string().min(1),
  /** 护甲义体：提供身体防护，具体承受能力与覆盖部位按现场与装备描述判断 */
  armor: z.boolean().default(false),
  /**
   * 黑客硬件的定性特化方向；操作系统义体写了这一项才算网络接入仓，
   * 额叶皮质等义体写了则作为脑部黑客配件并入接入仓的特化。
   */
  deckTraits: z.array(DeckTraitSchema).optional(),
  /** 接入仓或黑客配件的档次与定位，一句话；写给模型，也显示在侧栏 */
  deckProfile: z.string().min(1).max(60).optional(),
  /** 接入仓可同时插装的程序芯片槽数（操作系统义体专用；未填时按档次推算） */
  deckSlots: z.number().int().min(2).max(8).optional(),
  /** 加速义体（斯安威斯坦）：生死瞬间可以开，按现场时距和设备能力加速行动 */
  accelerator: z.boolean().default(false),
  /** 不朽义体（原作的 Iconic）；稀有标签不替代真实货源与交易意愿 */
  iconic: z.boolean().default(false),
  /** 物理互斥组（不写时由 cyberwareExclusiveGroup 按解剖特征自动推断） */
  exclusiveGroup: ExclusiveGroupSchema.optional(),
  behaviorChip: BehaviorChipProfileSchema.optional(),
});
export type CyberwareDef = z.infer<typeof CyberwareDefSchema>;

export const CyberwareCatalogSchema = z.array(CyberwareDefSchema);

/** 义体医生：开在某个地点，有自己的货架和价格；不以声望等级锁定货物。 */
export const RipperdocSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1).max(20),
  /** 医生本人的人物卡 id；已确认死亡或在别处时不能亲自服务 */
  keeperNpc: z.string().min(1).optional(),
  /** 已登记、可在这间诊所提供同类服务的其他医生 */
  serviceNpcs: z.array(z.string().min(1)).default([]),
  /** 地点表里的 id：玩家在这里时才能找他 */
  location: z.string().min(1),
  note: z.string().max(120).default(""),
  /** 乘在义体表参考价上的系数 */
  priceFactor: z.number().min(0.5).max(2).default(1),
  /** 黑市来源标签；不自动推断故障、追踪器或惩罚 */
  blackMarket: z.boolean().default(false),
  /** 货架上的义体 id；标签不替代实际货源 */
  shelf: z.array(z.string().min(1)).min(1),
  initialStock: z.record(z.string(), z.number().int().min(0)).optional(),
  equipment: z.array(z.string().min(1)).default(["surgery"]),
  serviceMinutes: z
    .object({
      install: z.number().int().min(1).default(60),
      remove: z.number().int().min(1).default(30),
      repair: z.number().int().min(1).default(30),
    })
    .default({ install: 60, remove: 30, repair: 30 }),
  /** 目录价中安装服务的份额；自带件只支付这一部分 */
  serviceRate: z.number().min(0).max(1).default(0.2),
  /** 最多肯赊多少欧元；0 是不赊账 */
  credit: z.number().int().min(0).max(100_000).default(0),
  creditDays: z.number().int().min(1).nullable().default(null),
});
export type Ripperdoc = z.infer<typeof RipperdocSchema>;
export const RipperdocListSchema = z.array(RipperdocSchema);

/** 旧件折价回收：最多按参考价的两成，防低买高卖 */
export const TRADE_IN_RATE = 0.2;
/** 修理打坏的义体按参考价的几成收钱 */
export const REPAIR_RATE = 0.3;
/** 每笔已发生的欠款；只有明确约定期限时才记对应期限事件。 */
export const RipperdocDebtSchema = z.object({
  doc: z.string().min(1),
  docName: z.string().min(1),
  amount: z.number().int().min(1),
  due: z.number().int().nullable(),
  /** 对应的期限 id */
  deadline: z.string().min(1).nullable(),
});
export type RipperdocDebt = z.infer<typeof RipperdocDebtSchema>;

export const CyberwarePartSchema = z.object({
  id: z.string().min(1),
  model: z.string().min(1),
  holder: z.string().min(1),
  location: z.string().nullable(),
  condition: z.enum(["intact", "damaged", "scrapped"]),
  source: z.string().min(1),
  at: z.number().int(),
});
export type CyberwarePart = z.infer<typeof CyberwarePartSchema>;

export const ClinicStateSchema = z.object({
  definition: RipperdocSchema,
  stock: z.record(z.string(), z.number().int().min(0)),
  initializedAt: z.number().int(),
  revision: z.number().int().min(0),
  open: z.boolean(),
  reason: z.string(),
  staff: z.array(z.string()),
  equipment: z.array(z.string()),
});
export type ClinicState = z.infer<typeof ClinicStateSchema>;

export const CyberwareTermsSchema = z.object({
  action: z.enum(["buy", "install", "remove", "repair", "repay"]),
  doc: z.string().min(1).max(100),
  id: z.string().min(1).optional(),
  part: z
    .string()
    .min(1)
    .optional()
    .describe("自带的未安装实物 ID；不能把型号目录当成自己已持有的零件"),
  replace: z.string().min(1).optional().describe("玩家选定换下的已装型号；满槽不能自行选择"),
  disposition: z
    .enum(["keep", "sell", "scrap"])
    .optional()
    .describe("旧件明确去向：保留、出售或报废；必须有玩家授权"),
  tradeIn: z
    .boolean()
    .optional()
    .describe("只有玩家同意出售旧件时为 true，与 disposition:sell 一致"),
  credit: z.boolean().optional(),
  offer: z.string().min(1).optional(),
  startAt: z
    .number()
    .int()
    .optional()
    .describe("已经确认的服务开始游戏分钟；结束时刻由服务时长确定，不能重复增加耗时"),
});
export type CyberwareTerms = z.infer<typeof CyberwareTermsSchema>;

export const CyberwareServiceSchema = z.object({
  id: z.string().min(1),
  terms: CyberwareTermsSchema,
  provider: z.string().min(1),
  providerName: z.string().min(1),
  scheduledAt: z.number().int(),
  startedAt: z.number().int().nullable(),
  endsAt: z.number().int(),
  remaining: z.number().int().min(0),
  status: z.enum(["booked", "active", "interrupted", "cancelled", "completed"]),
  price: z.number().int().min(0),
  cash: z.number().int().min(0),
  credit: z.number().int().min(0),
  receive: z.number().int().min(0),
  part: z.string().nullable(),
  oldPart: z.string().nullable(),
  reason: z.string(),
});
export type CyberwareService = z.infer<typeof CyberwareServiceSchema>;

export const CyberwareSupplySchema = z.object({
  id: z.string().min(1),
  doc: z.string().min(1),
  source: z.string().min(1),
  stock: z.record(z.string(), z.number().int().min(1)),
  route: z.array(z.string().min(1)),
  due: z.number().int(),
  remaining: z.number().int().min(0),
  checkedAt: z.number().int(),
  status: z.enum(["pending", "blocked", "arrived", "cancelled"]),
  reason: z.string(),
});

export const CyberwareStateSchema = z.object({
  behaviorChips: z.record(z.string(), BehaviorChipStateSchema).optional(),
  installed: z
    .array(
      z.object({
        id: z.string().min(1),
        slot: CyberwareSlotSchema,
        /** 装上时的游戏时间（分钟） */
        installedAt: z.number().int(),
      }),
    )
    .default([]),
  /** 已经结算过的事件 id；同一事件只结算一次 */
  settled: z.array(z.string()).default([]),
  debts: z.array(RipperdocDebtSchema).default([]),
  clinics: z.record(z.string(), ClinicStateSchema).default({}),
  parts: z.record(z.string(), CyberwarePartSchema).default({}),
  services: z.record(z.string(), CyberwareServiceSchema).default({}),
  supplies: z.record(z.string(), CyberwareSupplySchema).default({}),
  /** 最近一次开加速义体：设备 id 与启动时间 */
  boost: z
    .object({ id: z.string().min(1), lastAt: z.number().int() })
    .nullable()
    .default(null),
});
export type CyberwareState = z.infer<typeof CyberwareStateSchema>;

/** 模型和按钮共用的义体交易；成交金额由当前医生报价决定。 */
export const CyberwareCommandSchema = CyberwareTermsSchema.extend({
  type: z.literal("cyberware"),
  reason: z.string().min(1),
  /** 事件 id；带上后同一事件只结算一次 */
  event: z.string().min(1).optional(),
})
  .strict()
  .describe(
    "义体交易：buy 只买下实物；install 购买并安装或以 part 指定自带件；remove 按 disposition 拆下保留/出售/报废；repair 维修；repay 还款。简单服务完成时按共同起止时刻推进时间；复杂手术走 cyberware.service。旧件处置必须明确，不自动出售；成交不另写 money/trade。",
  );
export type CyberwareCommand = z.infer<typeof CyberwareCommandSchema>;

/** 只能由代码发出：开局自带的义体，不扣钱 */
export const InstallCyberwareSchema = z.object({
  type: z.literal("cyberware.install"),
  id: z.string().min(1),
});
export type InstallCyberware = z.infer<typeof InstallCyberwareSchema>;

/** 只能由代码发出：在义体医生那里赊账（add）或还清（repay） */
export const RipperdocDebtCommandSchema = z.object({
  type: z.literal("cyberware.debt"),
  action: z.enum(["add", "repay"]),
  doc: z.string().min(1),
  docName: z.string().min(1),
  /** add 时赊多少 */
  amount: z.number().int().min(1).optional(),
  /** add 时赊的是哪件义体的尾款 */
  item: z.string().min(1).optional(),
  due: z.number().int().nullable().optional(),
});
export type RipperdocDebtCommand = z.infer<typeof RipperdocDebtCommandSchema>;

/** 只能由代码发出：玩家主动开启已安装且可用的加速义体 */
export const BoostCommandSchema = z.object({
  type: z.literal("cyberware.boost"),
  id: z.string().min(1),
});
export type BoostCommand = z.infer<typeof BoostCommandSchema>;
