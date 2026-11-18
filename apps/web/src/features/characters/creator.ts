import {
  ATTRIBUTE_BASE,
  ATTRIBUTE_CREATE_MAX,
  type Board,
  type BoardModule,
  BoardModuleSchema,
  BoardSchema,
  boardIssues,
  type CharacterCard,
  CharacterCardSchema,
  cyberwareRules,
  humanityRules,
  type LifepathEntry,
  type Loadout,
  loadoutText,
  PROSE_BLOCKS,
  ProseBlockSchema,
  pickLoadouts,
  pickStartLocation,
  SKILL_MAX,
  type WorkshopPack,
  WorkshopPackSchema,
} from "@cp/core";
import type { BoardData } from "../../api/client";

const { HUMANITY_MAX, STAGE_LABELS, TOLERANCE_FACTOR, humanityStage, isGlitchZone } = humanityRules;

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
  past: "过往履历",
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
    freePrograms: [],
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

export interface HumanityStageInfo {
  readonly stage: humanityRules.HumanityStage;
  readonly label: string;
  readonly tone: "ok" | "warn" | "danger";
  readonly glitchZone: boolean;
  readonly note: string;
}

/** 根据术后剩余人性返回阶段标签、色彩倾向与神经感知说明 */
export function humanityStageInfo(humanityNow: number): HumanityStageInfo {
  const clamped = Math.max(0, Math.min(HUMANITY_MAX, Math.round(humanityNow)));
  const stage = humanityStage(clamped);
  const label = STAGE_LABELS[stage];
  const glitchZone = isGlitchZone(clamped);
  if (stage === "stable") {
    return {
      stage,
      label,
      tone: "ok",
      glitchZone,
      note: "神经回路稳定，义体与肉身同步良好",
    };
  }
  if (stage === "detached") {
    return {
      stage,
      label,
      tone: "ok",
      glitchZone,
      note: "情绪略显抽离，感官偶尔泛起冷铁般的金属质感",
    };
  }
  if (stage === "unstable") {
    return {
      stage,
      label,
      tone: "warn",
      glitchZone,
      note: "进入神经感知失真区（<40）：义眼偶发红帧雪花，强刺激下易产生冲动",
    };
  }
  if (stage === "edge") {
    return {
      stage,
      label,
      tone: "danger",
      glitchZone,
      note: "赛博精神病边缘（<20）：视野重影与金属耳鸣频发，高压下易误判与短暂失控",
    };
  }
  return {
    stage,
    label,
    tone: "danger",
    glitchZone,
    note: "神经负荷临界（0）：躯壳濒临重度失控与断片，急需压制剂或卸除重型义体",
  };
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
  scene: "person",
  greeting: "person",
  examples: "person",
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

export type CreatorStepId = "identity" | "traits" | "chrome_kit" | "people_prose" | "review";

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
    title: "身份铭牌与出身背景",
    lead: "确立夜之城档案的基本称谓，并挑选或自创出身背景，决定初始家底、自带义体与默认落脚点。",
  },
  {
    id: "traits",
    index: 2,
    code: "02",
    label: "过往、特质与缺陷",
    title: "生命路径、核心特质与负面缺陷",
    lead: "掷一段契合出身的生命路径，挑选专长与身心禀赋，或挂载债主与宿敌等剧情钩子。",
  },
  {
    id: "chrome_kit",
    index: 3,
    code: "03",
    label: "义体与开局态势",
    title: "义体装配、行装定制与开局锚点",
    lead: "在十个身体部位装配开局义体并调控生理耐受，配置启动资金、武器座驾与出生位置。",
  },
  {
    id: "people_prose",
    index: 4,
    code: "04",
    label: "人脉与人设小传",
    title: "夜之城人脉网络与人设小传",
    lead: "结识原作人物或自创旧识，并手写或交由 AI 协同生成角色外貌、背景、性格与口吻。",
  },
  {
    id: "review",
    index: 5,
    code: "05",
    label: "档案总览与开局",
    title: "完整档案核验与战局接入",
    lead: "总览角色全部构筑、行装、人脉与小传，确认就绪后即可保存并直接接入夜之城。",
  },
];

const TARGET_STEP_MAP: Readonly<Record<CheckTarget, CreatorStepId>> = {
  identity: "identity",
  origin: "identity",
  build: "traits",
  cyber: "chrome_kit",
  kit: "chrome_kit",
  people: "people_prose",
  person: "people_prose",
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
    traits: 0,
    chrome_kit: 0,
    people_prose: 0,
    review: checks.length,
  };
  for (const c of checks) {
    issueCounts[stepForCheckTarget(c.target)] += 1;
  }

  const board = card.board ?? emptyBoard();
  const identityReady = issueCounts.identity === 0;
  const traitsCount = board.pasts.length + board.skills.length + board.flaws.length;

  const inherentCount = inherentCyberware(card, data).filter((c) => !c.replaced).length;
  const chromeCount = board.cyberware.length + inherentCount;
  const humanityNow = Math.max(0, HUMANITY_MAX - totalStartHumanityCost(card, data));
  const chromeKitFilled =
    board.cyberware.length > 0 ||
    board.kit.cashTier !== "standard" ||
    board.kit.weapons.length > 0 ||
    board.kit.vehicle !== null ||
    Boolean(board.startLocation);

  const proseCount = PROSE_BLOCKS.filter((b) => card[b].trim() !== "").length;
  const peopleCount = board.acquaintances.length;
  const peopleProseFilled = proseCount > 0 || peopleCount > 0;

  return {
    identity: {
      id: "identity",
      ready: identityReady,
      filled: identityReady,
      badge: identityReady ? (board.origin?.label ?? "已填") : `待填 ${issueCounts.identity} 项`,
      issueCount: issueCounts.identity,
    },
    traits: {
      id: "traits",
      ready: issueCounts.traits === 0,
      filled: traitsCount > 0,
      badge: traitsCount > 0 ? `${traitsCount} 项` : "可选",
      issueCount: issueCounts.traits,
    },
    chrome_kit: {
      id: "chrome_kit",
      ready: issueCounts.chrome_kit === 0,
      filled: chromeKitFilled,
      badge: `人性 ${humanityNow}${chromeCount > 0 ? ` · ${chromeCount}件` : ""}`,
      issueCount: issueCounts.chrome_kit,
    },
    people_prose: {
      id: "people_prose",
      ready: issueCounts.people_prose === 0,
      filled: peopleProseFilled,
      badge: peopleProseFilled ? `${peopleCount}人 · ${proseCount}/7段` : "可选",
      issueCount: issueCounts.people_prose,
    },
    review: {
      id: "review",
      ready: checks.length === 0,
      filled: checks.length === 0,
      badge: checks.length === 0 ? "可开局" : `待完善 ${checks.length} 项`,
      issueCount: checks.length,
    },
  };
}

// ———— 出身倾向与生命路径契合度辅助函数 ————

export type OriginAffinity = "lean" | "never" | null;

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

/** 查询模块在指定出身的生命路径中的契合度（权重 >1 为契合，=0 为冲突，其余为 null） */
export function originAffinity(
  originId: string | undefined,
  moduleId: string,
  lifepath: readonly LifepathEntry[],
): OriginAffinity {
  if (!originId) return null;
  const entry = lifepath.find((e) => e.id === moduleId);
  if (!entry) return null;
  const weight = entry.weights[originId];
  if (weight === undefined) return null;
  if (weight === 0) return "never";
  if (weight > 1) return "lean";
  return null;
}
