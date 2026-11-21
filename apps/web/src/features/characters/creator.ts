import {
  type Board,
  type BoardModule,
  BoardModuleSchema,
  BoardSchema,
  boardIssues,
  type CharacterCard,
  CharacterCardSchema,
  cyberwareRules,
  humanityRules,
  type Loadout,
  loadoutText,
  PAST_MAX,
  ProseBlockSchema,
  pickLoadouts,
  pickStartLocation,
  SKILL_MAX,
  type WorkshopPack,
  WorkshopPackSchema,
} from "@cp/core";
import type { BoardData } from "../../api/client";
import { appearanceFilledCount } from "./appearance";

const { TOLERANCE_EFFECTS, TOLERANCE_LABELS } = humanityRules;

/**
 * 2077 赛博档案工作台核心纯逻辑 + 创意工坊底座（Workshop-Ready Foundation）
 * 无点数上限束缚，仅受槽位容量与义体神经负荷（人性值 × 耐受档位）约束。
 */

/** 创建空白角色主板 */
export function emptyBoard(): Board {
  return BoardSchema.parse({});
}

/** 建档时 pickLoadouts 会给这张卡发哪几套行装（和服务端同一个函数、同一张表，建卡界面看到的就是开局拿到的） */
export function pickedLoadouts(card: CharacterCard, data?: Pick<BoardData, "loadouts">): Loadout[] {
  const table = data?.loadouts ?? [];
  if (table.length === 0) return [];
  const ids = pickLoadouts(loadoutText(card), table, "street-kid");
  return ids.flatMap((id) => table.find((l) => l.id === id) ?? []);
}

// ———— 出身分类、默认行装与自带免费义体计算 ————

export type OriginEcosystem = "corpo" | "street" | "net" | "badlands" | "custom";

export const ORIGIN_ECOSYSTEM_LABELS: Readonly<Record<OriginEcosystem, string>> = {
  corpo: "巨企与体制",
  street: "街头与暗巷",
  net: "佣兵与潜网",
  badlands: "恶土与荒原",
  custom: "自定义与模组",
};

export function originEcosystem(m: BoardModule): OriginEcosystem {
  if (m.custom) return "custom";
  if (m.tags.includes("恶土") || m.tags.includes("走私") || m.id === "nomad") return "badlands";
  if (m.tags.includes("潜网") || m.tags.includes("黑客") || m.tags.includes("佣兵")) return "net";
  if (
    m.tags.includes("巨企") ||
    m.tags.includes("公司") ||
    m.tags.includes("警察") ||
    m.id === "corpo"
  ) {
    return "corpo";
  }
  return "street";
}

export type PastTheme = "all" | "street" | "corpo" | "badlands" | "net" | "custom";

export const PAST_THEME_LABELS: Readonly<Record<PastTheme, string>> = {
  all: "全部履历",
  street: "街头风波",
  corpo: "巨企暗战",
  badlands: "荒原旧事",
  net: "潜网异闻",
  custom: "自定义与模组",
};

export function pastTheme(m: BoardModule): Exclude<PastTheme, "all"> {
  if (m.custom) return "custom";
  if (m.tags.includes("恶土") || m.tags.includes("走私")) return "badlands";
  if (m.tags.includes("潜网") || m.tags.includes("黑客")) return "net";
  if (m.tags.includes("巨企") || m.tags.includes("公司")) return "corpo";
  return "street";
}

export type TraitFilter = "all" | "innate" | "craft" | "past" | "custom";

export const TRAIT_FILTER_LABELS: Readonly<Record<TraitFilter, string>> = {
  all: "全部特质",
  innate: "性格禀赋",
  craft: "实战专长",
  past: "过往履历",
  custom: "自定义与模组",
};

export function traitCategory(m: BoardModule): Exclude<TraitFilter, "all"> {
  if (m.custom) return "custom";
  if (m.slot === "past") return "past";
  if (m.tags.includes("禀赋")) return "innate";
  return "craft";
}

export type SkillDomain = "all" | "innate" | "combat" | "tech" | "social" | "custom";

export const SKILL_DOMAIN_LABELS: Readonly<Record<SkillDomain, string>> = {
  all: "全部特质",
  innate: "性格禀赋",
  combat: "战斗技法",
  tech: "潜入与技术",
  social: "交涉与生存",
  custom: "自定义与模组",
};

/** 细分核心特质所在领域，便于角色创建时按流派快速挑选 */
export function skillDomain(m: BoardModule): Exclude<SkillDomain, "all"> {
  if (m.custom) return "custom";
  if (m.tags.includes("禀赋")) return "innate";
  if (
    m.tags.includes("战斗") ||
    m.tags.includes("枪") ||
    m.tags.includes("近战") ||
    m.tags.includes("格斗")
  ) {
    return "combat";
  }
  if (m.tags.includes("潜入") || m.tags.includes("技术") || m.tags.includes("黑客")) {
    return "tech";
  }
  return "social";
}

/** 随机补满：从特质库里（只抽禀赋和专长，不抽履历）随机补到 target 项 */
export function rollTraits(
  board: Board,
  modules: readonly BoardModule[],
  random: () => number,
  target = 3,
): Board {
  const taken = new Set([...board.pasts, ...board.skills].map((m) => m.id));
  const pool = modules.filter((m) => m.slot === "skill" && !m.custom && !taken.has(m.id));
  const skills = [...board.skills];
  while (skills.length < Math.min(target, SKILL_MAX) && pool.length > 0) {
    const [picked] = pool.splice(Math.floor(random() * pool.length), 1);
    if (picked) skills.push(picked);
  }
  return { ...board, skills };
}

/** 随机补满：从过往履历库里随机补到 target 项 */
export function rollPasts(
  board: Board,
  modules: readonly BoardModule[],
  random: () => number,
  target = 2,
): Board {
  const taken = new Set(board.pasts.map((m) => m.id));
  const pool = modules.filter((m) => m.slot === "past" && !m.custom && !taken.has(m.id));
  const pasts = [...board.pasts];
  while (pasts.length < Math.min(target, PAST_MAX) && pool.length > 0) {
    const [picked] = pool.splice(Math.floor(random() * pool.length), 1);
    if (picked) pasts.push(picked);
  }
  return { ...board, pasts };
}

/** 预览某一项出身自带的开局资金、默认出生点与标配清单（用于出身卡片直显） */
export function originPreview(
  origin: BoardModule,
  data?: Pick<BoardData, "loadouts" | "names">,
): {
  readonly eddies: number;
  readonly locationId: string;
  readonly extras: readonly string[];
} {
  const table = data?.loadouts ?? [];
  const sampleCard = {
    origin: origin.label,
    board: BoardSchema.parse({ origin }),
  } as unknown as CharacterCard;
  const picked = pickedLoadouts(sampleCard, { loadouts: table });
  const eddies = picked.reduce((sum, l) => sum + (l.eddies ?? 0), 0);
  const locationId = pickStartLocation(loadoutText(sampleCard), table, "megabuilding-h10");
  const extras: string[] = [];
  const primaryWeapon = picked.flatMap((l) => l.gear).find((g) => g.slot === 1);
  if (primaryWeapon) {
    const wName = data?.names?.[primaryWeapon.id];
    if (wName) extras.push(wName);
  }
  const hasDeck = picked.some((l) => (l.cyberware ?? []).includes("militech-paraline"));
  const hasVehicle = picked.some((l) => (l.vehicles ?? []).length > 0);
  if (hasDeck) extras.push("自带接入仓");
  if (hasVehicle) extras.push("自带载具");
  return { eddies, locationId, extras };
}

export interface DefaultLoadoutSummary {
  readonly baseEddies: number;
  readonly finalEddies: number;
  readonly gearNames: readonly string[];
  readonly freeVehicleIds: readonly string[];
  readonly freeVehicleNames: readonly string[];
  readonly labels: readonly string[];
}

/** 按出身与行装表返回该角色的自由沙盘默认出生点锚点 id */
export function defaultStartLocationFor(
  card: CharacterCard,
  data?: Pick<BoardData, "loadouts">,
  fallback = "megabuilding-h10",
): string {
  return pickStartLocation(loadoutText(card), data?.loadouts ?? [], fallback);
}

/** 切换出身时清理已被新出身免费附带的武器与载具，避免重复配置 */
export function pruneKitForOrigin(
  card: CharacterCard,
  nextBoard: Board,
  data?: Pick<BoardData, "loadouts">,
): Board {
  const picked = pickedLoadouts({ ...card, board: nextBoard }, data);
  if (picked.length === 0) return nextBoard;
  const freeGear = new Set(picked.flatMap((l) => l.gear.map((g) => g.id)));
  const freeVehicles = new Set(picked.flatMap((l) => l.vehicles ?? []));
  const nextWeapons = nextBoard.kit.weapons.filter((id) => !freeGear.has(id));
  const nextVehicle =
    nextBoard.kit.vehicle && freeVehicles.has(nextBoard.kit.vehicle) ? null : nextBoard.kit.vehicle;
  if (
    nextWeapons.length === nextBoard.kit.weapons.length &&
    nextVehicle === nextBoard.kit.vehicle
  ) {
    return nextBoard;
  }
  return {
    ...nextBoard,
    kit: { ...nextBoard.kit, weapons: nextWeapons, vehicle: nextVehicle },
  };
}

/** 展示出身自带的开局默认行装（和建档时实际发的同一份） */
export function originDefaultLoadout(
  card: CharacterCard,
  data?: Pick<BoardData, "loadouts" | "names" | "cyberware">,
): DefaultLoadoutSummary {
  const picked = pickedLoadouts(card, data);
  const name = (id: string) => data?.names?.[id] ?? id;
  const baseEddies = picked.reduce((sum, l) => sum + (l.eddies ?? 0), 0);
  const cashTier = card.board?.kit?.cashTier ?? "standard";
  const finalEddies =
    cashTier === "broke"
      ? 0
      : baseEddies + (cashTier === "stash" ? 2500 : cashTier === "windfall" ? 6000 : 0);
  const vehicles = [...new Set(picked.flatMap((l) => l.vehicles ?? []))];
  const seenGear = new Set<string>();
  const gearNames = picked.flatMap((l) =>
    l.gear.flatMap((g) => {
      if (seenGear.has(g.id)) return [];
      seenGear.add(g.id);
      return [name(g.id)];
    }),
  );
  return {
    baseEddies,
    finalEddies,
    gearNames,
    freeVehicleIds: vehicles,
    freeVehicleNames: vehicles.map(name),
    labels: picked.map((l) => l.label),
  };
}

export interface InherentCyberwareItem {
  readonly id: string;
  readonly name: string;
  readonly slot: string;
  readonly humanityCost: number;
  readonly source: string;
  /** 玩家在同一部位装满了自选义体：开局时自带件会被换下，不占人性 */
  readonly replaced: boolean;
}

/**
 * 出身与黑客履历自带的免费义体（来自开局行装表，如岐路司义眼 Mk.1、军用科技平行线接入仓）：
 * 自动显示在中央 CyberDoll 上，未被同部位自选义体顶替时计入建卡人性条
 */
export function inherentCyberware(
  card: CharacterCard,
  data?: Pick<BoardData, "cyberware" | "loadouts" | "names">,
): InherentCyberwareItem[] {
  const board = card.board;
  if (!board?.origin) return [];
  const chosenIds = new Set(board.cyberware.map((c) => c.id));
  const defOf = (id: string) => data?.cyberware.find((c) => c.id === id);
  const slotOf = (id: string, fallback?: string) => defOf(id)?.slot ?? fallback;
  const chosenInSlot = (slot: string) =>
    board.cyberware.filter((c) => slotOf(c.id, c.slot) === slot).length;
  const out: InherentCyberwareItem[] = [];
  for (const loadout of pickedLoadouts(card, data)) {
    for (const id of loadout.cyberware ?? []) {
      const def = defOf(id);
      if (!def || chosenIds.has(id) || out.some((o) => o.id === id)) continue;
      const cap = (cyberwareRules.SLOT_CAPACITY as Readonly<Record<string, number>>)[def.slot] ?? 1;
      out.push({
        id,
        name: data?.names?.[id] ?? def.name,
        slot: def.slot,
        humanityCost: def.humanityCost,
        source: `${loadout.label}标配`,
        replaced: chosenInSlot(def.slot) >= cap,
      });
    }
  }
  return out;
}

export interface ToleranceSummary {
  readonly tolerance: Board["tolerance"];
  readonly label: string;
  readonly tone: "ok" | "warn";
  readonly note: string;
}

/** 根据所选义体神经耐受档位返回定性标签、色彩倾向与神经说明（不折算数字人性值） */
export function toleranceSummary(tolerance: Board["tolerance"]): ToleranceSummary {
  return {
    tolerance,
    label: TOLERANCE_LABELS[tolerance],
    tone: tolerance === "low" ? "warn" : "ok",
    note: TOLERANCE_EFFECTS[tolerance],
  };
}

// ———— 创意工坊底座：本地自定义模块池 & 目录合并管线 ————

const LOCAL_CUSTOM_MODULES_KEY = "cp.workshop.localModules";
export const LOCAL_MODULES_EVENT = "cp.workshop.localModules";

function emitLocalModulesEvent(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(LOCAL_MODULES_EVENT));
  }
}

export function loadLocalCustomModules(): BoardModule[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(LOCAL_CUSTOM_MODULES_KEY) ?? "[]");
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((item) => {
      const parsed = BoardModuleSchema.safeParse(item);
      return parsed.success ? [{ ...parsed.data, custom: true }] : [];
    });
  } catch {
    return [];
  }
}

export function saveLocalCustomModule(module: BoardModule): BoardModule[] {
  const current = loadLocalCustomModules().filter((m) => m.id !== module.id);
  const next = [{ ...module, custom: true, packId: module.packId ?? "local" }, ...current].slice(
    0,
    100,
  );
  try {
    localStorage.setItem(LOCAL_CUSTOM_MODULES_KEY, JSON.stringify(next));
    emitLocalModulesEvent();
  } catch {
    // 隐私模式或空间已满时忽略
  }
  return next;
}

export function removeLocalCustomModule(id: string): BoardModule[] {
  const next = loadLocalCustomModules().filter((m) => m.id !== id);
  try {
    localStorage.setItem(LOCAL_CUSTOM_MODULES_KEY, JSON.stringify(next));
    emitLocalModulesEvent();
  } catch {
    // ignore
  }
  return next;
}

/** 将官方目录与本地自定义池 / 创意工坊模组包按 id 去重合并 */
export function mergeCreatorCatalog(
  base: BoardData,
  extraModules: readonly BoardModule[],
  packs: readonly WorkshopPack[] = [],
): BoardData {
  const seen = new Set(base.modules.map((m) => m.id));
  const mergedModules: BoardModule[] = [...base.modules];
  const allExtra = [...extraModules, ...packs.flatMap((p) => p.modules)];
  for (const m of allExtra) {
    if (!seen.has(m.id)) {
      seen.add(m.id);
      mergedModules.push({ ...m, custom: true });
    }
  }
  return {
    ...base,
    modules: mergedModules,
  };
}

export function exportLocalWorkshopPack(
  title = "我的夜之城自定义扩展包",
  author = "本地玩家",
): WorkshopPack {
  return WorkshopPackSchema.parse({
    id: `wk-local-${Date.now().toString(36)}`,
    title,
    author,
    description: "包含自定义出身背景、角色特质与负面缺陷的创意工坊扩展包",
    modules: loadLocalCustomModules(),
  });
}

// ———— 本地草稿 ————

const DRAFT_KEY = "cp.creatorDraft";
export const CHARACTER_DRAFT_EVENT = "cp.creatorDraft";

function emitDraftEvent(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(CHARACTER_DRAFT_EVENT));
  }
}

export interface CreatorDraft {
  readonly card: CharacterCard;
  readonly startLocation: string;
  readonly savedAt: string;
  readonly characterId?: string | null;
  readonly original?: string;
  readonly sample?: boolean;
}

export function saveDraft(draft: Omit<CreatorDraft, "savedAt">): boolean {
  try {
    localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({ ...draft, savedAt: new Date().toISOString() }),
    );
    emitDraftEvent();
    return true;
  } catch {
    return false;
  }
}

export function clearDraft(): void {
  try {
    localStorage.removeItem(DRAFT_KEY);
    emitDraftEvent();
  } catch {
    // ignore
  }
}

export function loadDraft(blank: CharacterCard): CreatorDraft | null {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? "null");
    if (typeof raw !== "object" || raw === null) return null;
    const d = raw as Record<string, unknown>;
    const card = d.card as Record<string, unknown> | undefined;
    if (typeof card !== "object" || card === null) return null;
    const board = BoardSchema.safeParse(card.board);
    if (!board.success) return null;
    const text = (key: keyof CharacterCard) =>
      typeof card[key] === "string" ? (card[key] as string) : (blank[key] as string);
    const locked = Array.isArray(card.locked)
      ? [
          ...new Set(
            card.locked.flatMap((b) => {
              const ok = ProseBlockSchema.safeParse(b);
              return ok.success ? [ok.data] : [];
            }),
          ),
        ]
      : [];
    const merged: CharacterCard = {
      ...blank,
      name: text("name"),
      alias: text("alias"),
      pronoun: text("pronoun"),
      origin: text("origin"),
      look: text("look"),
      past: text("past"),
      personality: text("personality"),
      voice: text("voice"),
      skills: text("skills"),
      ...(typeof card.portrait === "string" && card.portrait.trim() !== ""
        ? { portrait: card.portrait }
        : {}),
      locked,
      board: board.data,
    };
    return {
      card: merged,
      startLocation:
        typeof d.startLocation === "string" ? d.startLocation : (board.data.startLocation ?? ""),
      savedAt: typeof d.savedAt === "string" ? d.savedAt : "",
      characterId: typeof d.characterId === "string" ? d.characterId : null,
      original: typeof d.original === "string" ? d.original : "",
      sample: d.sample === true,
    };
  } catch {
    return null;
  }
}

// ———— 档案就绪检查与五步引导工作台状态 ————

export type CheckTarget = "identity" | "origin" | "build" | "cyber" | "people" | "kit" | "person";

export interface Check {
  readonly target: CheckTarget;
  readonly text: string;
}

export type CreatorCheck = Check;

function issueTarget(text: string): CheckTarget {
  if (text.includes("出身")) return "origin";
  if (text.includes("旧识")) return "people";
  if (text.includes("义体")) return "cyber";
  if (
    text.includes("行装") ||
    text.includes("武器") ||
    text.includes("载具") ||
    text.includes("落脚") ||
    text.includes("地点")
  ) {
    return "kit";
  }
  return "build";
}

const FIELD_TARGET: Partial<Record<keyof CharacterCard, CheckTarget>> = {
  origin: "origin",
  board: "build",
  name: "identity",
  alias: "identity",
  pronoun: "identity",
  look: "person",
  past: "person",
  personality: "person",
  voice: "person",
  skills: "person",
};

export function creatorChecks(card: CharacterCard): Check[] {
  const checks: Check[] = [];
  const covered = new Set<string>();
  if (card.name.trim() === "") {
    checks.push({ target: "identity", text: "尚未填写角色姓名" });
    covered.add("name");
  }
  if (card.pronoun.trim() === "") {
    checks.push({ target: "identity", text: "尚未设定人称代词" });
    covered.add("pronoun");
  }
  if (card.board) {
    const issues = boardIssues(card.board);
    for (const text of issues) checks.push({ target: issueTarget(text), text });
    if (issues.length > 0) covered.add("board");
    if (issues.some((text) => issueTarget(text) === "origin")) covered.add("origin");
  }
  const parsed = CharacterCardSchema.safeParse(card);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (typeof key === "string" && covered.has(key)) continue;
      if (checks.some((c) => c.text === issue.message)) continue;
      const target =
        (typeof key === "string" ? FIELD_TARGET[key as keyof CharacterCard] : undefined) ??
        "person";
      checks.push({ target, text: issue.message });
    }
  }
  return checks;
}

export type CreatorStepId = "identity" | "appearance" | "traits" | "cyberware" | "connections";

export interface CreatorStepMeta {
  readonly id: CreatorStepId;
  readonly index: number;
  readonly code: string;
  readonly label: string;
  readonly title: string;
  readonly lead: string;
}

export const CREATOR_STEPS: readonly CreatorStepMeta[] = [
  {
    id: "identity",
    index: 1,
    code: "01",
    label: "身份与出身",
    title: "公民铭牌、2077 命牌与出身背景",
    lead: "确立夜之城档案称谓、挑选 2077 命牌气质，并决定出身背景与初始家底、自带义体及默认落脚点。",
  },
  {
    id: "appearance",
    index: 2,
    code: "02",
    label: "体貌定制",
    title: "BIOMETRIC SCAN · 七部位物理体貌定制",
    lead: "零输入点选体型、发型发色、面容年龄、眼眸义眼、面部义体线、伤疤纹身与妆容毛发，实时合成外貌档案与立绘依据。",
  },
  {
    id: "traits",
    index: 3,
    code: "03",
    label: "履历与特质",
    title: "过往履历、核心特质与负面缺陷",
    lead: "分栏勾选过往履历、性格禀赋与实战专长，或挂载处境短板；三层互不冲突，自由组合。",
  },
  {
    id: "cyberware",
    index: 4,
    code: "04",
    label: "义体与行装",
    title: "义体拓扑装配、神经耐受与开局行装",
    lead: "在十个身体部位装配义体并调控生理耐受，同时敲定启动资金、随身武器与专属座驾。",
  },
  {
    id: "connections",
    index: 5,
    code: "05",
    label: "旧识与落脚点",
    title: "夜之城旧识网络与开局落脚点",
    lead: "建立与夜之城核心人物或自建旧识的交集，并在全城地图上选定开局切入点。",
  },
];

const TARGET_STEP_MAP: Readonly<Record<CheckTarget, CreatorStepId>> = {
  identity: "identity",
  origin: "identity",
  build: "traits",
  cyber: "cyberware",
  kit: "cyberware",
  people: "connections",
  person: "appearance",
};

/** 将核验问题目标映射到五步引导工作台对应步骤 */
export function stepForCheckTarget(target: CheckTarget): CreatorStepId {
  return TARGET_STEP_MAP[target];
}

export interface StepProgressItem {
  readonly id: CreatorStepId;
  readonly ready: boolean;
  readonly filled: boolean;
  readonly badge: string;
  readonly issueCount: number;
}

export type StepProgressMap = Readonly<Record<CreatorStepId, StepProgressItem>>;

/** 计算五步引导工作台每一步的完成态、阻塞项与摘要计数 */
export function stepProgress(
  card: CharacterCard,
  data?: Pick<BoardData, "cyberware" | "loadouts" | "names">,
): StepProgressMap {
  const checks = creatorChecks(card);
  const issueCounts: Record<CreatorStepId, number> = {
    identity: 0,
    appearance: 0,
    traits: 0,
    cyberware: 0,
    connections: 0,
  };
  for (const c of checks) {
    issueCounts[stepForCheckTarget(c.target)] += 1;
  }

  const board = card.board ?? emptyBoard();
  const identityReady = issueCounts.identity === 0;
  const bioCount = appearanceFilledCount(board.appearance);
  const appearanceFilled = bioCount > 0 || card.look.trim() !== "";
  const traitsCount = board.pasts.length + board.skills.length + board.flaws.length;

  const inherentCount = inherentCyberware(card, data).filter((c) => !c.replaced).length;
  const chromeCount = board.cyberware.length + inherentCount;
  const tol = toleranceSummary(board.tolerance);
  const kitTouched =
    board.kit.cashTier !== "standard" || board.kit.weapons.length > 0 || board.kit.vehicle !== null;

  const peopleCount = board.acquaintances.length;
  const hasStartLoc = Boolean(board.startLocation);
  const connectionsFilled = peopleCount > 0 || hasStartLoc;

  return {
    identity: {
      id: "identity",
      ready: identityReady,
      filled: identityReady,
      badge: identityReady ? (board.origin?.label ?? "已填") : `待填 ${issueCounts.identity} 项`,
      issueCount: issueCounts.identity,
    },
    appearance: {
      id: "appearance",
      ready: issueCounts.appearance === 0,
      filled: appearanceFilled,
      badge: bioCount > 0 ? `${bioCount}/7 项` : card.look.trim() ? "已写外貌" : "可选",
      issueCount: issueCounts.appearance,
    },
    traits: {
      id: "traits",
      ready: issueCounts.traits === 0,
      filled: traitsCount > 0,
      badge: traitsCount > 0 ? `${traitsCount} 项` : "可选",
      issueCount: issueCounts.traits,
    },
    cyberware: {
      id: "cyberware",
      ready: issueCounts.cyberware === 0,
      filled: board.cyberware.length > 0 || board.tolerance !== "normal" || kitTouched,
      badge: `${tol.label}${chromeCount > 0 ? ` · ${chromeCount}件` : ""}`,
      issueCount: issueCounts.cyberware,
    },
    connections: {
      id: "connections",
      ready: issueCounts.connections === 0,
      filled: connectionsFilled,
      badge: connectionsFilled
        ? `${peopleCount} 位旧识${hasStartLoc ? " · 已定点" : ""}`
        : "默认起点",
      issueCount: issueCounts.connections,
    },
  };
}
