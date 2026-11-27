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

/** 臂部安装侧别：左臂、右臂、双臂同款 */
export const ARM_SIDES = ["left", "right", "both"] as const;
export const ArmSideSchema = z.enum(ARM_SIDES);
export type ArmSide = z.infer<typeof ArmSideSchema>;

export const ARM_SIDE_LABELS: Readonly<Record<ArmSide, string>> = {
  left: "左臂",
  right: "右臂",
  both: "双臂同款",
};

/** 上层 8 个核心物理主位（一坑一物） */
export const CORE_SLOT_IDS = [
  "chassis",
  "cyberdeck",
  "spineDrive",
  "optics",
  "leftArm",
  "rightArm",
  "legDrive",
  "skinArmor",
] as const;
export const CoreSlotIdSchema = z.enum(CORE_SLOT_IDS);
export type CoreSlotId = z.infer<typeof CoreSlotIdSchema>;

export const CORE_SLOT_LABELS: Readonly<Record<CoreSlotId, string>> = {
  chassis: "躯体底盘",
  cyberdeck: "网络接入仓",
  spineDrive: "脊柱主驱",
  optics: "主义眼",
  leftArm: "左臂",
  rightArm: "右臂",
  legDrive: "腿部驱动",
  skinArmor: "表皮主甲",
};

/** 下层 5 个扩展与外观分区（4 个有限人体空间功能区 + 1 个零承载外观生活区） */
export const EXTENSION_ZONE_IDS = [
  "neural",
  "sensory",
  "torso",
  "extremities",
  "lifestyle",
] as const;
export const ExtensionZoneIdSchema = z.enum(EXTENSION_ZONE_IDS);
export type ExtensionZoneId = z.infer<typeof ExtensionZoneIdSchema>;

export const EXTENSION_ZONE_LABELS: Readonly<Record<ExtensionZoneId, string>> = {
  neural: "脑机与神经",
  sensory: "面容与感官",
  torso: "躯干与防护",
  extremities: "手掌与足部",
  lifestyle: "外观与生活",
};

/** 货架/自建统一归类：7 类核心硬件 + 5 类扩展与外观 */
export const CYBERWARE_CATEGORY_IDS = [
  "chassis",
  "cyberdeck",
  "spineDrive",
  "optics",
  "arms",
  "legDrive",
  "skinArmor",
  ...EXTENSION_ZONE_IDS,
] as const;
export const CyberwareCategoryIdSchema = z.enum(CYBERWARE_CATEGORY_IDS);
export type CyberwareCategoryId = z.infer<typeof CyberwareCategoryIdSchema>;

export const CYBERWARE_CATEGORY_LABELS: Readonly<Record<CyberwareCategoryId, string>> = {
  chassis: "躯体底盘",
  cyberdeck: "网络接入仓",
  spineDrive: "脊柱主驱",
  optics: "主义眼",
  arms: "手臂义肢/武装",
  legDrive: "腿部驱动",
  skinArmor: "表皮主甲",
  ...EXTENSION_ZONE_LABELS,
};

/** 兼容旧引用：保留 CyberwareSectionId 指向新版分区 */
export const CYBERWARE_SECTION_IDS = [...CYBERWARE_SLOTS, "lifestyle", "fbc"] as const;
export type CyberwareSectionId = (typeof CYBERWARE_SECTION_IDS)[number];

export const SECTION_LABELS: Readonly<Record<CyberwareSectionId, string>> = {
  ...SLOT_LABELS,
  lifestyle: "外观与生活",
  fbc: "躯体底盘",
};

/** 义体主动提供的专项防护能力（替代按固定 ID 判断的电磁/热能/防黑冰集合） */
export const CYBERWARE_DEFENSES = ["surge", "thermal", "ice"] as const;
export const CyberwareDefenseSchema = z.enum(CYBERWARE_DEFENSES);
export type CyberwareDefense = z.infer<typeof CyberwareDefenseSchema>;

/** 全身义体（FBC）底盘的承载与躯干/四肢扩容配置 */
export const ChassisProfileSchema = z.object({
  hardCap: z.number().int().min(30).max(150),
  safeCap: z.number().int().min(0).max(120),
  /** 是否属于高压重装战甲（常驻超载压迫状态） */
  constantOverload: z.boolean().optional(),
  /** 躯干与防护区额外格数（默认 +2） */
  torsoBonus: z.number().int().min(0).max(6).optional(),
  /** 手掌与足部区额外格数（默认 +1） */
  extremityBonus: z.number().int().min(0).max(6).optional(),
});
export type ChassisProfile = z.infer<typeof ChassisProfileSchema>;

const DEFAULT_FBC_CHASSIS_PROFILE: ChassisProfile = {
  hardCap: 70,
  safeCap: 48,
  torsoBonus: 2,
  extremityBonus: 1,
};

/**
 * 物理互斥组：
 * - 上层 8 核心主位（含装植减缩 capacityCore 与接入仓/脊柱主驱互斥）；
 * - 扩展区仅保留 5 组直觉 100% 明确的同类器官互斥。
 */
export const EXCLUSIVE_GROUPS = [
  "cyberdeck",
  "spineDrive",
  "capacityCore",
  "optics",
  "armMount",
  "legDrive",
  "skinArmor",
  "fullBorg",
  "intimateCore",
  "skinStealth",
  "painOverride",
  "footTread",
  "exoskeletonFrame",
] as const;
export const ExclusiveGroupSchema = z.enum(EXCLUSIVE_GROUPS);
export type ExclusiveGroup = z.infer<typeof ExclusiveGroupSchema>;

export const EXCLUSIVE_GROUP_LIMIT: Readonly<Record<ExclusiveGroup, number>> = {
  cyberdeck: 1,
  spineDrive: 1,
  capacityCore: 1,
  optics: 1,
  armMount: 2,
  legDrive: 1,
  skinArmor: 1,
  fullBorg: 1,
  intimateCore: 1,
  skinStealth: 1,
  painOverride: 1,
  footTread: 1,
  exoskeletonFrame: 1,
};

export const EXCLUSIVE_GROUP_LABELS: Readonly<Record<ExclusiveGroup, string>> = {
  cyberdeck: "网络接入仓",
  spineDrive: "脊柱主驱",
  capacityCore: "神经扩容主控",
  optics: "主义眼",
  armMount: "手臂义肢/武装",
  legDrive: "腿部驱动",
  skinArmor: "表皮主甲",
  fullBorg: "躯体底盘（FBC）",
  intimateCore: "核心亲密义体",
  skinStealth: "表皮隐匿层",
  painOverride: "痛觉覆写",
  footTread: "足底主改",
  exoskeletonFrame: "承重外骨骼",
};

/** 5 组可供自建义体选择的明确同类器官互斥 */
export const EXTENSION_EXCLUSIVE_GROUPS: readonly ExclusiveGroup[] = [
  "skinStealth",
  "painOverride",
  "footTread",
  "exoskeletonFrame",
  "intimateCore",
];

export interface ExclusiveProbe {
  readonly id: string;
  readonly name: string;
  readonly slot: CyberwareSlot;
  readonly exclusiveGroup?: ExclusiveGroup | undefined;
  readonly category?: CyberwareCategoryId | undefined;
  readonly armSide?: ArmSide | undefined;
  readonly defaultArmSide?: ArmSide | undefined;
  readonly armor?: boolean | undefined;
  readonly accelerator?: boolean | undefined;
  readonly deckTraits?: readonly string[] | undefined;
  readonly deckProfile?: string | undefined;
}

/** 推断一件义体所属的物理互斥组；优先读声明字段，自定义件按分类/部位特征兜底。 */
export function cyberwareExclusiveGroup(def: ExclusiveProbe): ExclusiveGroup | null {
  if (def.exclusiveGroup) return def.exclusiveGroup;
  if (def.category === "chassis") return "fullBorg";
  if (def.category === "cyberdeck") return "cyberdeck";
  if (def.category === "optics") return "optics";
  if (def.category === "arms") return "armMount";
  if (def.category === "legDrive") return "legDrive";
  if (def.category === "skinArmor") return "skinArmor";
  if (def.slot === "os") {
    if ((def.deckTraits && def.deckTraits.length > 0) || def.deckProfile) return "cyberdeck";
    if (def.accelerator || def.category === "spineDrive") return "spineDrive";
    return null;
  }
  if (def.slot === "arms") return "armMount";
  if (def.slot === "integumentary") return def.armor ? "skinArmor" : null;
  return null;
}

/** 归类一件义体在 v2 体系中的直觉分区（7 类核心硬件或 5 类扩展/外观） */
export function cyberwareCategoryOf(def: ExclusiveProbe): CyberwareCategoryId {
  if (def.category) return def.category;
  const group = cyberwareExclusiveGroup(def);
  if (group === "fullBorg") return "chassis";
  if (group === "cyberdeck") return "cyberdeck";
  if (group === "spineDrive" || group === "capacityCore") return "spineDrive";
  if (group === "optics") return "optics";
  if (group === "armMount") return "arms";
  if (group === "legDrive") return "legDrive";
  if (group === "skinArmor") return "skinArmor";
  if (group === "intimateCore") return "lifestyle";
  if (def.slot === "eyes") return "sensory";
  if (def.slot === "frontalCortex" || def.slot === "nervous") return "neural";
  if (def.slot === "hands" || def.slot === "legs") return "extremities";
  return "torso";
}

export function cyberwareExtensionZone(def: ExclusiveProbe): ExtensionZoneId | null {
  const cat = cyberwareCategoryOf(def);
  return (EXTENSION_ZONE_IDS as readonly string[]).includes(cat) ? (cat as ExtensionZoneId) : null;
}

export function isLifestyleCyberware(def: ExclusiveProbe): boolean {
  return cyberwareCategoryOf(def) === "lifestyle";
}

/** 4 个功能扩展区的真实人体空间上限；外观与生活不设格数上限（返回 null） */
export function extensionZoneLimit(
  zone: ExtensionZoneId,
  fbc: boolean | ChassisProfile | null,
): number | null {
  const torsoBonus = typeof fbc === "boolean" ? (fbc ? 2 : 0) : fbc ? (fbc.torsoBonus ?? 2) : 0;
  const extremityBonus =
    typeof fbc === "boolean" ? (fbc ? 1 : 0) : fbc ? (fbc.extremityBonus ?? 1) : 0;
  switch (zone) {
    case "neural":
      return 4;
    case "sensory":
      return 3;
    case "torso":
      return 5 + torsoBonus;
    case "extremities":
      return 4 + extremityBonus;
    case "lifestyle":
      return null;
  }
}

/** 兼容旧调用：按旧分区 id 返回归属 */
export function cyberwareSectionOf(def: ExclusiveProbe): CyberwareSectionId {
  const group = cyberwareExclusiveGroup(def);
  if (group === "fullBorg") return "fbc";
  if (isLifestyleCyberware(def)) return "lifestyle";
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

/** 判断臂部义体默认是单臂装配（如射弹发射器、工程/医疗义臂）还是双臂成对。 */
export function isSingleArmCyberware(
  def?: { readonly defaultArmSide?: ArmSide | undefined } | null,
): boolean {
  return def?.defaultArmSide === "left" || def?.defaultArmSide === "right";
}

/** 臂部义体默认装配侧别（无显式指定时）：优先读 defaultArmSide，否则默认双臂同款 */
export function defaultArmSideFor(
  def?: { readonly defaultArmSide?: ArmSide | undefined } | null,
): ArmSide {
  return def?.defaultArmSide ?? "both";
}

/**
 * 为已安装列表中的臂部义体解析真实左/右/双臂归属：
 * - 显式写了 armSide 时严格按 armSide；
 * - 未写时：单件单臂型默认 defaultArmSide（左臂），单件成对型默认 both，两件无标记臂件按顺序分给 left / right。
 */
export function resolveArmSides<T extends ExclusiveProbe>(
  installed: readonly T[],
): ReadonlyMap<string, ArmSide> {
  const arms = installed.filter((item) => cyberwareExclusiveGroup(item) === "armMount");
  const out = new Map<string, ArmSide>();
  if (arms.length === 0) return out;
  if (arms.length === 1) {
    const only = arms[0];
    if (only) out.set(only.id, only.armSide ?? defaultArmSideFor(only));
    return out;
  }
  let leftTaken = false;
  let rightTaken = false;
  for (const item of arms) {
    if (item.armSide) {
      out.set(item.id, item.armSide);
      if (item.armSide === "left" || item.armSide === "both") leftTaken = true;
      if (item.armSide === "right" || item.armSide === "both") rightTaken = true;
    }
  }
  for (const item of arms) {
    if (out.has(item.id)) continue;
    if (!leftTaken) {
      out.set(item.id, "left");
      leftTaken = true;
    } else if (!rightTaken) {
      out.set(item.id, "right");
      rightTaken = true;
    } else {
      out.set(item.id, "right");
    }
  }
  return out;
}

/** 同款手臂武器元素变体分组（由数据字段 variantGroup + variantKey 驱动，工坊自建同样适用） */
export const ELEMENT_VARIANT_KEYS = ["physical", "thermal", "electric", "toxic"] as const;
export const ElementVariantKeySchema = z.enum(ELEMENT_VARIANT_KEYS);
export type ElementVariantKey = z.infer<typeof ElementVariantKeySchema>;

export const ELEMENT_VARIANT_LABELS: Readonly<Record<ElementVariantKey, string>> = {
  physical: "常规",
  thermal: "热能",
  electric: "电磁",
  toxic: "化学",
};

export interface VariantFoldEntry<T> {
  readonly active: T;
  readonly groupId?: string | undefined;
  readonly variants?: readonly { readonly key: ElementVariantKey; readonly item: T }[] | undefined;
}

/** 按数据字段 variantGroup + variantKey 将同族元素变体折叠为单张主卡 */
export function foldCyberwareVariants<
  T extends {
    readonly id: string;
    readonly variantGroup?: string | undefined;
    readonly variantKey?: ElementVariantKey | undefined;
  },
>(
  items: readonly T[],
  options?: {
    readonly disabled?: boolean | undefined;
    readonly chosen?: Readonly<Record<string, ElementVariantKey>> | undefined;
    readonly isPreferred?: ((item: T) => boolean) | undefined;
  },
): VariantFoldEntry<T>[] {
  if (options?.disabled) return items.map((active) => ({ active }));
  const grouped = new Map<string, { readonly key: ElementVariantKey; readonly item: T }[]>();
  for (const item of items) {
    if (!item.variantGroup || !item.variantKey) continue;
    const list = grouped.get(item.variantGroup) ?? [];
    list.push({ key: item.variantKey, item });
    grouped.set(item.variantGroup, list);
  }
  const out: VariantFoldEntry<T>[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const groupId = item.variantGroup;
    if (!groupId || !item.variantKey) {
      out.push({ active: item });
      continue;
    }
    if (seen.has(groupId)) continue;
    seen.add(groupId);
    const variants = [...(grouped.get(groupId) ?? [])].sort(
      (a, b) => ELEMENT_VARIANT_KEYS.indexOf(a.key) - ELEMENT_VARIANT_KEYS.indexOf(b.key),
    );
    if (variants.length <= 1) {
      out.push({ active: item });
      continue;
    }
    const preferred = options?.isPreferred
      ? variants.find((v) => options.isPreferred?.(v.item))
      : undefined;
    const chosenKey = options?.chosen?.[groupId] ?? preferred?.key ?? "physical";
    const active = variants.find((v) => v.key === chosenKey)?.item ?? variants[0]?.item ?? item;
    out.push({ active, groupId, variants });
  }
  return out;
}

/** 返回义体的成对/单双侧装配提示文案 */
export function cyberwareMountHint(
  def: ExclusiveProbe,
  installedArmCount = 0,
): { readonly badge: string; readonly detail: string } | null {
  const group = cyberwareExclusiveGroup(def);
  if (group === "armMount") {
    if (def.armSide) {
      return {
        badge: ARM_SIDE_LABELS[def.armSide],
        detail:
          def.armSide === "both"
            ? "左右双臂成套装配（按 1 套承载计）"
            : `仅装于${ARM_SIDE_LABELS[def.armSide]}（单臂按 60% 承载计）`,
      };
    }
    const single = isSingleArmCyberware(def);
    if (installedArmCount >= 2) {
      return {
        badge: "左右臂混搭",
        detail: "左右双臂各自搭载一套义臂",
      };
    }
    if (single) {
      return {
        badge: "单臂装配",
        detail: "默认装于单侧手臂，另一只手臂仍可加装第 2 件",
      };
    }
    return {
      badge: "双臂同款",
      detail: "可装单臂（60% 承载）或双臂同款（100% 承载）",
    };
  }
  if (group === "optics") {
    return {
      badge: "双眼成对",
      detail: "主视觉义眼模组（双目成对生效）",
    };
  }
  if (group === "legDrive") {
    return {
      badge: "双腿成对",
      detail: "双腿成套驱动改造",
    };
  }
  return null;
}

function armSideOverlaps(a: ArmSide, b: ArmSide): boolean {
  if (a === "both" || b === "both") return true;
  return a === b;
}

/** 检查装入 candidate 是否与已装义体发生物理互斥冲突。 */
export function cyberwareConflicts<T extends ExclusiveProbe>(
  candidate: ExclusiveProbe,
  installed: readonly T[],
): CyberwareConflictResult<T> {
  const group = cyberwareExclusiveGroup(candidate);
  if (!group) return { ok: true };

  // 装植减缩器（capacityCore）与网络接入仓、脊柱主驱互相排斥
  if (group === "capacityCore") {
    const blockers = installed.filter((item) => {
      if (item.id === candidate.id) return false;
      const g = cyberwareExclusiveGroup(item);
      return g === "capacityCore" || g === "cyberdeck" || g === "spineDrive";
    });
    if (blockers.length > 0) {
      return {
        ok: false,
        group: "capacityCore",
        limit: 1,
        label: "主控总线（装植减缩器不可与接入仓或脊柱主驱并存）",
        blockers,
      };
    }
    return { ok: true };
  }
  if (group === "cyberdeck" || group === "spineDrive") {
    const capBlockers = installed.filter(
      (item) => item.id !== candidate.id && cyberwareExclusiveGroup(item) === "capacityCore",
    );
    if (capBlockers.length > 0) {
      return {
        ok: false,
        group: "capacityCore",
        limit: 1,
        label: "神经扩容主控（装植减缩器占据主控总线，需先卸下才能装接入仓或脊柱主驱）",
        blockers: capBlockers,
      };
    }
  }

  // 手臂左右侧真实独立判定
  if (group === "armMount" && candidate.armSide) {
    const sides = resolveArmSides(installed);
    const blockers = installed.filter((item) => {
      if (item.id === candidate.id || cyberwareExclusiveGroup(item) !== "armMount") return false;
      const existingSide = sides.get(item.id) ?? defaultArmSideFor(item);
      return armSideOverlaps(candidate.armSide as ArmSide, existingSide);
    });
    if (blockers.length > 0) {
      return {
        ok: false,
        group: "armMount",
        limit: 1,
        label: ARM_SIDE_LABELS[candidate.armSide],
        blockers,
      };
    }
    return { ok: true };
  }

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
  readonly capacityBonus?: number | undefined;
  readonly safeLineBonus?: number | undefined;
  readonly chassisProfile?: ChassisProfile | undefined;
}

/** 计算单件义体在当前装配侧别下的实际神经承载 */
export function effectiveCyberwareLoad(
  item: Pick<
    LoadProbe,
    "id" | "slot" | "humanityCost" | "exclusiveGroup" | "category" | "armSide" | "defaultArmSide"
  >,
  resolvedArmSide?: ArmSide,
): number {
  if (item.humanityCost <= 0 || isLifestyleCyberware({ ...item, name: item.id })) return 0;
  const group = cyberwareExclusiveGroup({ ...item, name: item.id });
  if (group === "armMount") {
    const side = resolvedArmSide ?? item.armSide ?? defaultArmSideFor(item);
    if (side === "left" || side === "right") {
      return Math.max(1, Math.round(item.humanityCost * 0.6));
    }
  }
  return item.humanityCost;
}

export const DUAL_CORE_LOAD_PENALTY = 12;

export interface CyberwareLoadProfile {
  readonly totalCount: number;
  readonly zeroLoadCount: number;
  readonly activeLoadScore: number;
  readonly safeCap: number;
  readonly hardCap: number;
  readonly overloaded: boolean;
  readonly dualCore: boolean;
  readonly dualCorePenalty: number;
  readonly hasCapacityCore: boolean;
  readonly stabilizerBonus: number;
  readonly fullBorg: string | null;
  readonly fullBorgId: string | null;
  readonly chassisLabel: string;
  readonly zoneCounts: Readonly<Record<ExtensionZoneId, number>>;
  readonly zoneLimits: Readonly<Record<ExtensionZoneId, number | null>>;
  readonly heavyNames: readonly string[];
  readonly tier: "light" | "standard" | "heavy" | "extreme";
  readonly label: string;
  readonly tone: "ok" | "warn" | "bad";
  /** 仅当存在高负荷/超载风险（双中枢 / FBC / 超安全线）时给出直白原因，平常为 null */
  readonly alertReason: string | null;
  readonly summary: string;
}

/**
 * 纯事实三段式神经承载分析（全数据驱动）：
 * - 外观与生活件永远 0 承载、不占功能空间；
 * - 单臂 60%、双臂同款 100%、左右异构混搭 120%；
 * - 双中枢并行（接入仓 + 脊柱主驱）额外吃 +12 承载；
 * - 神经扩容件由 capacityBonus / safeLineBonus 驱动；稳定件由 safeLineBonus 驱动；
 * - FBC 全身躯壳由 chassisProfile 驱动（未填时采用标准双子星档位 48/70）。
 */
export function cyberwareLoadProfile(installed: readonly LoadProbe[]): CyberwareLoadProfile {
  let zeroLoadCount = 0;
  let score = 0;
  let hasDeck = false;
  let hasSpine = false;
  let hasCapacityCore = false;
  let capacityBonus = 0;
  let capacitySafeBonus = 0;
  let stabilizerBonus = 0;
  let fullBorg: string | null = null;
  let fullBorgId: string | null = null;
  let fbcProfile: ChassisProfile | null = null;
  const heavyNames: string[] = [];
  const armSides = resolveArmSides(installed);
  const zoneCounts: Record<ExtensionZoneId, number> = {
    neural: 0,
    sensory: 0,
    torso: 0,
    extremities: 0,
    lifestyle: 0,
  };

  for (const item of installed) {
    const group = cyberwareExclusiveGroup(item);
    if (group === "cyberdeck") hasDeck = true;
    if (group === "spineDrive") hasSpine = true;
    if (group === "capacityCore") {
      hasCapacityCore = true;
      capacityBonus += item.capacityBonus ?? 20;
      capacitySafeBonus += item.safeLineBonus ?? 18;
    } else {
      if (item.capacityBonus) capacityBonus += item.capacityBonus;
      if (item.safeLineBonus) stabilizerBonus += item.safeLineBonus;
    }
    if (group === "fullBorg") {
      fullBorg = item.name;
      fullBorgId = item.id;
      fbcProfile = item.chassisProfile ?? DEFAULT_FBC_CHASSIS_PROFILE;
    }
    const zone = cyberwareExtensionZone(item);
    if (zone) zoneCounts[zone] += 1;

    const itemLoad = effectiveCyberwareLoad(item, armSides.get(item.id));
    if (itemLoad <= 0) {
      zeroLoadCount += 1;
    } else {
      score += itemLoad;
    }
    if (itemLoad >= 10 || item.iconic || group === "fullBorg") {
      heavyNames.push(item.name);
    }
  }

  const dualCore = hasDeck && hasSpine;
  const dualCorePenalty = dualCore ? DUAL_CORE_LOAD_PENALTY : 0;
  const effectiveScore = score + dualCorePenalty;

  const constantOverload = Boolean(fbcProfile?.constantOverload);
  const hardCap = fbcProfile ? fbcProfile.hardCap : 50 + capacityBonus;
  const baseSafe = fbcProfile ? fbcProfile.safeCap : 38 + capacitySafeBonus;
  const safeCap = Math.min(hardCap, baseSafe + stabilizerBonus);
  const overloaded = effectiveScore > safeCap || constantOverload;

  const hasFbc = fbcProfile !== null;
  const zoneLimits: Record<ExtensionZoneId, number | null> = {
    neural: extensionZoneLimit("neural", fbcProfile),
    sensory: extensionZoneLimit("sensory", fbcProfile),
    torso: extensionZoneLimit("torso", fbcProfile),
    extremities: extensionZoneLimit("extremities", fbcProfile),
    lifestyle: null,
  };

  const tier: CyberwareLoadProfile["tier"] =
    constantOverload ||
    effectiveScore >= hardCap ||
    (hasFbc && effectiveScore > safeCap) ||
    (dualCore && effectiveScore > safeCap)
      ? "extreme"
      : overloaded || dualCore || hasFbc
        ? "heavy"
        : effectiveScore >= 16
          ? "standard"
          : "light";

  const label =
    tier === "extreme"
      ? "极限红线"
      : tier === "heavy"
        ? "超载红线"
        : tier === "standard"
          ? "平稳"
          : "轻载";

  const tone: CyberwareLoadProfile["tone"] =
    tier === "extreme" ? "bad" : tier === "heavy" ? "warn" : "ok";

  const reasons: string[] = [];
  if (fullBorg) reasons.push(`全身义体化「${fullBorg}」`);
  if (dualCore) reasons.push("双中枢并行");
  if (effectiveScore > safeCap && !constantOverload) {
    reasons.push(`超出安全线（${effectiveScore}/${safeCap}）`);
  }
  const shownHeavy = heavyNames.filter((n) => n !== fullBorg).slice(0, 2);
  if (shownHeavy.length > 0 && reasons.length === 0 && (tier === "heavy" || tier === "extreme")) {
    reasons.push(`高压重器（${shownHeavy.join("、")}）`);
  }

  const alertReason = reasons.length > 0 ? reasons.join(" · ") : null;

  const chassisLabel = fullBorg
    ? fullBorg
    : hasCapacityCore
      ? "原生血肉 · 装植减缩扩容"
      : "原生血肉";

  const summary =
    tier === "extreme"
      ? `${alertReason ?? "神经承载已抵极限"}——连续开加速、重伤、遭黑客攻脑或断药时极易诱发耳鸣、鼻血与失控症状。`
      : tier === "heavy"
        ? `${alertReason ?? "进入超载红线"}——高强度行动或压榨神经时可能出现排异反应。`
        : installed.length === 0
          ? "纯原生肉身，未安装额外义体。"
          : "日常同步平稳，无额外神经压迫负担。";

  return {
    totalCount: installed.length,
    zeroLoadCount,
    activeLoadScore: effectiveScore,
    safeCap,
    hardCap,
    overloaded,
    dualCore,
    dualCorePenalty,
    hasCapacityCore,
    stabilizerBonus,
    fullBorg,
    fullBorgId,
    chassisLabel,
    zoneCounts,
    zoneLimits,
    heavyNames,
    tier,
    label,
    tone,
    alertReason,
    summary,
  };
}

export type CyberwareInstallCheck<T extends LoadProbe = LoadProbe> =
  | {
      readonly ok: true;
      readonly nextLoad: CyberwareLoadProfile;
      readonly entersOverload: boolean;
    }
  | {
      readonly ok: false;
      readonly kind: "conflict" | "zoneFull" | "capacityFull";
      readonly reason: string;
      readonly blockers?: readonly T[] | undefined;
      readonly zone?: ExtensionZoneId | undefined;
      readonly shortfall?: number | undefined;
      readonly nextLoad?: CyberwareLoadProfile | undefined;
    };

/**
 * 统一三道安装校验（创角、诊所报价、手术安装共用）：
 * 1. 物理互斥（8 核心主位 / 左右臂 / 装植减缩器 / 5 组同类器官）；
 * 2. 4 个功能扩展区的真实人体空间上限（外观生活区无上限）；
 * 3. 三段式神经承载硬顶（0 承载外观件永远不被硬顶拦截）。
 */
export function checkCyberwareInstall<T extends LoadProbe>(
  candidate: LoadProbe,
  installed: readonly T[],
  options?: { readonly ignoreIds?: readonly string[] },
): CyberwareInstallCheck<T> {
  const ignore = new Set(options?.ignoreIds ?? []);
  const remaining = installed.filter((item) => item.id !== candidate.id && !ignore.has(item.id));

  const conflict = cyberwareConflicts(candidate, remaining);
  if (!conflict.ok) {
    return {
      ok: false,
      kind: "conflict",
      reason: `「${conflict.label}」已有 ${conflict.blockers.map((b) => b.name).join("、")}，需先替换或卸下`,
      blockers: conflict.blockers,
    };
  }

  const nextList: LoadProbe[] = [...remaining, candidate];
  const nextLoad = cyberwareLoadProfile(nextList);

  const zone = cyberwareExtensionZone(candidate);
  if (zone) {
    const limit = nextLoad.zoneLimits[zone];
    if (limit !== null && nextLoad.zoneCounts[zone] > limit) {
      return {
        ok: false,
        kind: "zoneFull",
        zone,
        reason: `「${EXTENSION_ZONE_LABELS[zone]}」物理空间已满（${limit}/${limit}），需先卸下同区旧件${nextLoad.fullBorg ? "" : "或换装 FBC 全身躯壳"}`,
        nextLoad,
      };
    }
  }

  const currentLoad = cyberwareLoadProfile(remaining);
  const addedLoad = nextLoad.activeLoadScore - currentLoad.activeLoadScore;
  if (addedLoad > 0 && nextLoad.activeLoadScore > nextLoad.hardCap) {
    const shortfall = nextLoad.activeLoadScore - nextLoad.hardCap;
    return {
      ok: false,
      kind: "capacityFull",
      shortfall,
      reason: `神经承载已达生理上限（超出 ${shortfall} 点，上限 ${nextLoad.hardCap}），需先卸下现有组件，或改用装植减缩 / FBC 躯体底盘`,
      nextLoad,
    };
  }

  return {
    ok: true,
    nextLoad,
    entersOverload: nextLoad.overloaded && !currentLoad.overloaded,
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
  /** 物理互斥组（不写时由 cyberwareExclusiveGroup 按分类与部位特征兜底推断） */
  exclusiveGroup: ExclusiveGroupSchema.optional(),
  /** v2 显式归类（核心主位 / 4 功能扩展区 / 外观生活） */
  category: CyberwareCategoryIdSchema.optional(),
  /** 手臂义体默认装配侧别（单臂型写 left，成对型不填或写 both） */
  defaultArmSide: ArmSideSchema.optional(),
  /** 神经承载硬上限扩容值（如装植减缩器 +20） */
  capacityBonus: z.number().int().min(1).max(40).optional(),
  /** 神经安全线提升值（如免疫抑制泵/稳态阻尼器 +4，装植减缩器 +18） */
  safeLineBonus: z.number().int().min(1).max(30).optional(),
  /** 全身义体（FBC）底盘的专属承载与空间配置 */
  chassisProfile: ChassisProfileSchema.optional(),
  /** 同族元素变体折叠分组 id（如 gorilla-arms） */
  variantGroup: z.string().min(1).max(60).optional(),
  /** 元素变体键（physical / thermal / electric / toxic） */
  variantKey: ElementVariantKeySchema.optional(),
  /** 是否提供手部智能武器数据联锁（如智能连接、虎爪帮纹身） */
  smartLink: z.boolean().optional(),
  /** 额外增加的随身大件携带上限（如钛金骨骼、负重脊柱架、Σ 外骨骼、龙骑兵底盘 +1） */
  carryBonus: z.number().int().min(1).max(3).optional(),
  /** 专项防护能力（surge 抗电磁短路 / thermal 抗高温燃烧 / ice 自我防黑冰） */
  defenses: z.array(CyberwareDefenseSchema).optional(),
  behaviorChip: BehaviorChipProfileSchema.optional(),
  /** 自建或扩展义体指定的内置官方图标 ID（如 cyberArt.mantisBlades），可随存档与工坊共享 */
  art: z.string().trim().min(1).max(80).optional(),
  /** 本地上传的轻量图标缩略图（data:image/...，前端压缩至长边 ≤ 256px） */
  customImage: z
    .string()
    .trim()
    .max(180_000)
    .regex(/^data:image\/(?:png|jpeg|webp|gif);base64,/i, "仅支持 PNG/JPEG/WebP/GIF 图片")
    .optional(),
});
export type CyberwareDef = z.infer<typeof CyberwareDefSchema>;

export const CyberwareCatalogSchema = z.array(CyberwareDefSchema);

/** 义体医生：开在某个地点，有自己的货架和价格；不以声望等级锁定货物。 */
export const RipperdocSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1).max(20),
  /** 医生本人的人物卡 id；已确认死亡或在别处时不能亲自服务 */
  keeperNpc: z.string().min(1).optional(),
  /** 诊所明确归属的势力 id（医生未单独标势力时生效，用于势力调价与拒诊） */
  faction: z.string().min(1).optional(),
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
  armSide: ArmSideSchema.optional().describe(
    "手臂义体装配侧别：left 左臂、right 右臂、both 双臂同款",
  ),
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
        /** 手臂义体的安装侧别（left 左臂 / right 右臂 / both 双臂同款） */
        armSide: ArmSideSchema.optional(),
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
  armSide: ArmSideSchema.optional(),
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
