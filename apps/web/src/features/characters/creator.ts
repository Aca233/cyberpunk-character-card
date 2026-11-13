import {
  ATTRIBUTE_BASE,
  ATTRIBUTE_CREATE_MAX,
  type Board,
  type BoardModule,
  BoardModuleSchema,
  BoardSchema,
  boardBudget,
  boardIssues,
  CASH_TIER_INFO,
  type CharacterCard,
  CharacterCardSchema,
  type Combo,
  cyberwareRules,
  humanityRules,
  type LifepathEntry,
  type Loadout,
  loadoutText,
  ProseBlockSchema,
  pickLoadouts,
  pickStartLocation,
  REFUND_MAX,
  RELATION_INFO,
  SKILL_MAX,
  TOLERANCE_LEVELS,
  type WorkshopPack,
  WorkshopPackSchema,
} from "@cp/core";
import type { BoardData, Difficulty } from "../../api/client";

const { HUMANITY_MAX, TOLERANCE_FACTOR } = humanityRules;

/**
 * CK3「自定义统治者」风格角色创建逻辑 + 创意工坊底座（Workshop-Ready Foundation）
 */

export const STEPS = [
  { id: "origin", label: "出身与身份" },
  { id: "past", label: "过往经历" },
  { id: "people", label: "旧识 (可选)" },
  { id: "skills", label: "核心特长" },
  { id: "cyberware", label: "义体 (可选)" },
  { id: "person", label: "角色特写" },
  { id: "review", label: "档案确认" },
] as const;
export type StepId = (typeof STEPS)[number]["id"];

export function stepIndex(id: StepId): number {
  return STEPS.findIndex((s) => s.id === id);
}

export function budgetKind(step: StepId): "background" | null {
  if (step === "past" || step === "people" || step === "skills" || step === "cyberware") {
    return "background";
  }
  return null;
}

// ———— CK3 按战局难度划分的统一定制点数上限 ————

export const DIFFICULTY_BUDGET: Readonly<Record<Difficulty, number>> = {
  streetLegend: 24,
  nightCity: 17,
  deathCity: 12,
};

export interface UnifiedBudget {
  /** 当前难度给定的标准定制点数上限（24 / 17 / 12） */
  readonly limit: number;
  /** 正面特质（出身 + 专长 + 履历）花费的点数 */
  readonly traitSpent: number;
  /** 选购义体 + 高耐受花费的点数 */
  readonly cyberwareSpent: number;
  /** 高好感人脉花费的点数 */
  readonly peopleSpent: number;
  /** 开局行装（私房金库/黑金 + 额外武器 + 额外载具）花费的点数 */
  readonly kitSpent: number;
  /** 各项正面开销总计 */
  readonly grossSpent: number;
  /** 负面缺陷、低耐受与一贫如洗合计返还的点数 */
  readonly refund: number;
  /** 负面缺陷超出上限未计入的点数 */
  readonly wastedRefund: number;
  /** 净消耗点数（grossSpent - refund） */
  readonly netSpent: number;
  /** 距离难度上限还剩多少点（负数表示超出难度预算的点数） */
  readonly remaining: number;
  /** 是否超出当前难度预算（进入 CK3 传奇沙盒超限开局模式，不阻塞保存） */
  readonly overLimit: boolean;
}

/** 建档时 pickLoadouts 会给这张卡发哪几套行装（和服务端同一个函数、同一张表，建卡界面看到的就是开局拿到的） */
export function pickedLoadouts(card: CharacterCard, data?: Pick<BoardData, "loadouts">): Loadout[] {
  const table = data?.loadouts ?? [];
  if (table.length === 0) return [];
  const ids = pickLoadouts(loadoutText(card), table, "street-kid");
  return ids.flatMap((id) => table.find((l) => l.id === id) ?? []);
}

/** 计算开局行装定制（资金档位 + 随身武器 + 专属载具）的点数开销与返还 */
export function kitPoints(
  card: CharacterCard,
  data?: Pick<BoardData, "weapons" | "vehicles" | "loadouts">,
): { readonly spent: number; readonly refund: number } {
  const board = card.board;
  const kit = board?.kit ?? { cashTier: "standard" as const, weapons: [], vehicle: null };
  const cashPts = CASH_TIER_INFO[kit.cashTier].points;
  const weaponPts = kit.weapons.reduce((sum, id) => {
    const found = data?.weapons?.find((w) => w.id === id);
    return sum + (found?.points ?? 1);
  }, 0);
  const free = new Set(pickedLoadouts(card, data).flatMap((l) => l.vehicles ?? []));
  let vehiclePts = 0;
  if (kit.vehicle && !free.has(kit.vehicle)) {
    const found = data?.vehicles?.find((v) => v.id === kit.vehicle);
    vehiclePts = found?.points ?? 2;
  }
  return {
    spent: Math.max(0, cashPts) + weaponPts + vehiclePts,
    refund: Math.max(0, -cashPts),
  };
}

/** CK3 统一定制点数池结算：汇总特质、义体、耐受、人脉、行装与负面返还 */
export function unifiedBudget(
  card: CharacterCard,
  difficulty: Difficulty = "nightCity",
  data?: Pick<BoardData, "weapons" | "vehicles" | "loadouts">,
): UnifiedBudget {
  const limit = DIFFICULTY_BUDGET[difficulty] ?? 17;
  const board = card.board;
  if (!board) {
    return {
      limit,
      traitSpent: 0,
      cyberwareSpent: 0,
      peopleSpent: 0,
      kitSpent: 0,
      grossSpent: 0,
      refund: 0,
      wastedRefund: 0,
      netSpent: 0,
      remaining: limit,
      overLimit: false,
    };
  }
  const tolerancePts = TOLERANCE_LEVELS[board.tolerance].points;
  const traitModules = [...(board.origin ? [board.origin] : []), ...board.pasts, ...board.skills];
  const traitSpent = traitModules.reduce((sum, m) => sum + m.points, 0);
  const cyberwareSpent =
    board.cyberware.reduce((sum, c) => sum + c.points, 0) + Math.max(0, tolerancePts);
  const peopleSpent = board.acquaintances.reduce(
    (sum, a) => sum + RELATION_INFO[a.relation].points,
    0,
  );
  const kit = kitPoints(card, data);
  const grossSpent = traitSpent + cyberwareSpent + peopleSpent + kit.spent;
  const rawFlaws = board.flaws.reduce((sum, m) => sum + m.points, 0);
  const cappedFlaws = Math.min(REFUND_MAX, rawFlaws);
  const refund = cappedFlaws + Math.max(0, -tolerancePts) + kit.refund;
  const netSpent = grossSpent - refund;
  const remaining = limit - netSpent;
  return {
    limit,
    traitSpent,
    cyberwareSpent,
    peopleSpent,
    kitSpent: kit.spent,
    grossSpent,
    refund,
    wastedRefund: Math.max(0, rawFlaws - REFUND_MAX),
    netSpent,
    remaining,
    overLimit: remaining < 0,
  };
}

// ———— 出身分类、默认行装与自带免费义体计算 ————

export type OriginEcosystem = "corpo" | "street" | "net" | "badlands" | "custom";

export const ORIGIN_ECOSYSTEM_LABELS: Readonly<Record<OriginEcosystem, string>> = {
  corpo: "巨企与机构",
  street: "街头与地下",
  net: "潜网与边缘",
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

export type TraitFilter = "all" | "innate" | "craft" | "past" | "custom";

export const TRAIT_FILTER_LABELS: Readonly<Record<TraitFilter, string>> = {
  all: "全部特质",
  innate: "身心禀赋",
  craft: "专长技艺",
  past: "旧履历",
  custom: "自定义与模组",
};

export function traitCategory(m: BoardModule): Exclude<TraitFilter, "all"> {
  if (m.custom) return "custom";
  if (m.slot === "past") return "past";
  if (m.tags.includes("禀赋")) return "innate";
  return "craft";
}

/** 随机补满：从特质库里（只抽禀赋和专长，不抽旧履历）随机补到 target 项 */
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

export interface DefaultLoadoutSummary {
  readonly baseEddies: number;
  readonly finalEddies: number;
  readonly gearNames: readonly string[];
  readonly freeVehicleIds: readonly string[];
  readonly freeVehicleNames: readonly string[];
  readonly freePrograms: readonly string[];
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

/** 切换出身时清理已被新出身免费附带的武器与载具，避免重复占点或界面卡死 */
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
  // 若玩家在 OS 槽自选了义体（例如斯安威斯坦），检查开局是否仍有可用接入仓；无接入仓时不展示废程序
  const rawPrograms = [...new Set(picked.flatMap((l) => l.programs ?? []))];
  const catalog = data?.cyberware ?? [];
  const chosenOs = (card.board?.cyberware ?? []).filter((c) => {
    const def = catalog.find((x) => x.id === c.id);
    return (def?.slot ?? c.slot) === "os";
  });
  let freePrograms = rawPrograms;
  if (chosenOs.length > 0 && catalog.length > 0) {
    const maxSlots = chosenOs.reduce(
      (max, c) => Math.max(max, catalog.find((x) => x.id === c.id)?.programSlots ?? 0),
      0,
    );
    freePrograms = maxSlots > 0 ? rawPrograms.slice(0, maxSlots) : [];
  }
  return {
    baseEddies,
    finalEddies,
    gearNames,
    freeVehicleIds: vehicles,
    freeVehicleNames: vehicles.map(name),
    freePrograms: freePrograms.map(name),
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
        source: `${loadout.label}标配 · 0 点`,
        replaced: chosenInSlot(def.slot) >= cap,
      });
    }
  }
  return out;
}

/** 建卡界面的真实开局人性消耗（含未被顶替的自带义体 + 自选义体，按耐受档位折算），与进场后一致 */
export function totalStartHumanityCost(
  card: CharacterCard,
  data?: Pick<BoardData, "cyberware" | "loadouts" | "names">,
): number {
  const board = card.board;
  if (!board) return 0;
  const inherentRaw = inherentCyberware(card, data)
    .filter((c) => !c.replaced)
    .reduce((sum, c) => sum + c.humanityCost, 0);
  const chosenRaw = board.cyberware.reduce((sum, c) => sum + c.humanityCost, 0);
  return Math.min(
    HUMANITY_MAX,
    Math.round((inherentRaw + chosenRaw) * TOLERANCE_FACTOR[board.tolerance]),
  );
}

// ———— 创意工坊底座：本地自定义模块池 & 目录合并管线 ————

const LOCAL_CUSTOM_MODULES_KEY = "cp.workshop.localModules";

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
  } catch {
    // 隐私模式或空间已满时忽略
  }
  return next;
}

export function removeLocalCustomModule(id: string): BoardModule[] {
  const next = loadLocalCustomModules().filter((m) => m.id !== id);
  try {
    localStorage.setItem(LOCAL_CUSTOM_MODULES_KEY, JSON.stringify(next));
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

export interface CreatorDraft {
  readonly card: CharacterCard;
  readonly step: StepId;
  readonly reached: number;
  readonly startLocation: string;
  readonly rerolls: number;
  readonly savedAt: string;
}

export const REROLLS = 3;

export function saveDraft(draft: Omit<CreatorDraft, "savedAt">): boolean {
  try {
    localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({ ...draft, savedAt: new Date().toISOString() }),
    );
    return true;
  } catch {
    return false;
  }
}

export function clearDraft(): void {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    // ignore
  }
}

const isStep = (v: unknown): v is StepId => STEPS.some((s) => s.id === v);

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
    const attrs = (card.attributes ?? {}) as Record<string, unknown>;
    const attr = (key: keyof CharacterCard["attributes"]) => {
      const v = attrs[key];
      if (typeof v !== "number" || !Number.isFinite(v)) return blank.attributes[key];
      return Math.max(ATTRIBUTE_BASE, Math.min(ATTRIBUTE_CREATE_MAX, Math.round(v)));
    };
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
      scene: text("scene"),
      greeting: text("greeting"),
      examples: text("examples"),
      locked,
      attributes: {
        body: attr("body"),
        reflexes: attr("reflexes"),
        tech: attr("tech"),
        intelligence: attr("intelligence"),
        cool: attr("cool"),
      },
      board: board.data,
    };
    return {
      card: merged,
      step: isStep(d.step) ? d.step : "origin",
      reached:
        typeof d.reached === "number" && Number.isFinite(d.reached)
          ? Math.max(0, Math.min(STEPS.length - 1, Math.floor(d.reached)))
          : 0,
      startLocation:
        typeof d.startLocation === "string" ? d.startLocation : (board.data.startLocation ?? ""),
      rerolls:
        typeof d.rerolls === "number" && Number.isFinite(d.rerolls)
          ? Math.max(0, Math.min(REROLLS, Math.floor(d.rerolls)))
          : 0,
      savedAt: typeof d.savedAt === "string" ? d.savedAt : "",
    };
  } catch {
    return null;
  }
}

// ———— 检查项（CK3 沙盒超限模式：仅拦截缺姓名、代词、出身或重复模块） ————

export interface Check {
  readonly step: StepId;
  readonly text: string;
  readonly soft?: boolean;
}

function issueStep(text: string): StepId {
  if (text.includes("出身")) return "origin";
  if (text.includes("旧识")) return "people";
  if (text.includes("过往")) return "past";
  if (text.includes("负面")) return "past";
  if (text.includes("义体")) return "cyberware";
  return "skills";
}

const FIELD_STEP: Partial<Record<keyof CharacterCard, StepId>> = {
  origin: "origin",
  board: "skills",
  name: "origin",
  alias: "origin",
  pronoun: "origin",
  look: "person",
  past: "person",
  personality: "person",
  voice: "person",
  skills: "person",
  scene: "review",
  greeting: "review",
  examples: "review",
};

export function creatorChecks(card: CharacterCard): Check[] {
  const checks: Check[] = [];
  const covered = new Set<string>();
  if (card.name.trim() === "") {
    checks.push({ step: "origin", text: "尚未填写角色姓名" });
    covered.add("name");
  }
  if (card.pronoun.trim() === "") {
    checks.push({ step: "origin", text: "尚未设定人称代词" });
    covered.add("pronoun");
  }
  if (card.board) {
    const issues = boardIssues(card.board);
    for (const text of issues) checks.push({ step: issueStep(text), text });
    if (issues.length > 0) covered.add("board");
    if (issues.some((text) => issueStep(text) === "origin")) covered.add("origin");
  }
  const parsed = CharacterCardSchema.safeParse(card);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (typeof key === "string" && covered.has(key)) continue;
      if (checks.some((c) => c.text === issue.message)) continue;
      const step =
        (typeof key === "string" ? FIELD_STEP[key as keyof CharacterCard] : undefined) ?? "review";
      checks.push({ step, text: issue.message });
    }
  }
  return checks;
}

// ———— 兼容辅助函数 ————

export function originLean(
  originId: string,
  lifepath: readonly LifepathEntry[],
  modules: readonly BoardModule[],
  limit = 3,
): BoardModule[] {
  return lifepath
    .filter((e) => (e.weights[originId] ?? 1) > 1)
    .sort((a, b) => (b.weights[originId] ?? 1) - (a.weights[originId] ?? 1))
    .flatMap((e) => modules.filter((m) => m.id === e.id && m.slot === "past"))
    .slice(0, limit);
}

export function originNever(
  originId: string,
  lifepath: readonly LifepathEntry[],
  modules: readonly BoardModule[],
): BoardModule[] {
  return lifepath
    .filter((e) => e.weights[originId] === 0)
    .flatMap((e) => modules.filter((m) => m.id === e.id && m.slot === "past"));
}

function placed(board: Board): BoardModule[] {
  return [...(board.origin ? [board.origin] : []), ...board.pasts, ...board.skills, ...board.flaws];
}

export interface ComboHint {
  readonly combo: Combo;
  readonly need: string;
  readonly candidates: readonly BoardModule[];
}

export function comboHints(
  board: Board,
  combos: readonly Combo[],
  modules: readonly BoardModule[],
): ComboHint[] {
  const have = placed(board);
  const plugged = new Set(have.map((m) => m.id));
  const free =
    board.skills.length < SKILL_MAX
      ? modules.filter((m) => m.slot === "skill" && !plugged.has(m.id))
      : [];
  const hits = (need: string, list: readonly BoardModule[]) =>
    list.filter((m) => m.id === need || m.tags.includes(need));
  const out: ComboHint[] = [];
  for (const combo of combos) {
    const missing = combo.requires.filter((need) => hits(need, have).length === 0);
    if (missing.length !== 1) continue;
    const need = missing[0];
    if (need === undefined) continue;
    const candidates = hits(need, free).filter((c) => {
      const used = new Set<string>([c.id]);
      for (const n of combo.requires) for (const m of hits(n, have)) used.add(m.id);
      return used.size >= 2;
    });
    if (candidates.length > 0) out.push({ combo, need, candidates });
  }
  return out;
}

export function backgroundLeft(board: Board): number {
  return boardBudget(board).remaining;
}

// ———— 出身流派初始构筑预设（基于特质、身手与职业专长，不设属性点） ————

export type OriginKey = "street-kid" | "nomad" | "corpo";
export const ORIGIN_KEYS: readonly OriginKey[] = ["street-kid", "nomad", "corpo"];

export interface OriginPreset {
  readonly originId: string;
  readonly name: string;
  readonly summary: string;
  readonly pasts: readonly string[];
  readonly skills: readonly string[];
}

export const ORIGIN_PRESETS: Record<OriginKey, OriginPreset> = {
  "street-kid": {
    originId: "street-kid",
    name: "街霸突击构筑",
    summary: "近身肉搏、黑市门路、安防破拆，外加痛觉钝化",
    pasts: [],
    skills: ["brawling", "lockpick", "streetwise", "pain-editor-nerve"],
  },
  nomad: {
    originId: "nomad",
    name: "恶土游侠构筑",
    summary: "恶劣环境驾驶、机械拆修与智能武器改装，外加孤狼信条",
    pasts: [],
    skills: ["driving", "mechanic", "smart-weapon-mod", "lone-wolf"],
  },
  corpo: {
    originId: "corpo",
    name: "特工谍影构筑",
    summary: "企业博弈谈判、快速网络入侵与安防破解，外加绝对冷静",
    pasts: [],
    skills: ["corpo-negotiation", "quickhacking", "lockpick", "ice-veins"],
  },
};

export function isOriginPreset(originId: string, board: Board): boolean {
  const preset = ORIGIN_PRESETS[originId as OriginKey] as OriginPreset | undefined;
  if (!preset || board.origin?.id !== preset.originId) return false;
  const currentPastIds = board.pasts.map((p) => p.id).sort();
  const presetPastIds = [...preset.pasts].sort();
  if (currentPastIds.length !== presetPastIds.length) return false;
  if (!currentPastIds.every((id, idx) => id === presetPastIds[idx])) return false;

  const currentSkillIds = board.skills.map((s) => s.id).sort();
  const presetSkillIds = [...preset.skills].sort();
  if (currentSkillIds.length !== presetSkillIds.length) return false;
  if (!currentSkillIds.every((id, idx) => id === presetSkillIds[idx])) return false;

  return true;
}

export function isAnyOriginPreset(board: Board): boolean {
  return Object.keys(ORIGIN_PRESETS).some((id) => isOriginPreset(id, board));
}

export function applyOriginPreset(
  originId: string,
  card: CharacterCard,
  modules: readonly BoardModule[],
  _combos: readonly Combo[] = [],
): CharacterCard {
  const preset = ORIGIN_PRESETS[originId as OriginKey] as OriginPreset | undefined;
  if (!preset) return card;

  const originMod = modules.find((m) => m.id === originId && m.slot === "origin");
  const pastMods = preset.pasts
    .map((id) => modules.find((m) => m.id === id && m.slot === "past"))
    .filter((m): m is BoardModule => Boolean(m));
  const skillMods = preset.skills
    .map((id) => modules.find((m) => m.id === id && m.slot === "skill"))
    .filter((m): m is BoardModule => Boolean(m));

  if (
    !originMod ||
    pastMods.length !== preset.pasts.length ||
    skillMods.length !== preset.skills.length
  ) {
    return card;
  }

  const baseBoard: Board = card.board ?? BoardSchema.parse({});

  const newBoard: Board = {
    ...baseBoard,
    origin: originMod ?? baseBoard.origin,
    pasts: pastMods,
    skills: skillMods,
    combos: [],
  };

  return {
    ...card,
    origin: originMod?.label ?? card.origin,
    board: newBoard,
  };
}
