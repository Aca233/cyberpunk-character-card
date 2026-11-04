import {
  ATTRIBUTE_BASE,
  ATTRIBUTE_CREATE_MAX,
  ATTRIBUTE_POINTS,
  type Board,
  type BoardModule,
  BoardSchema,
  boardBudget,
  boardCombos,
  boardIssues,
  type CharacterCard,
  CharacterCardSchema,
  type Combo,
  type LifepathEntry,
  ProseBlockSchema,
  pointsSpent,
  SKILL_MAX,
} from "@cp/core";

/**
 * 分步捏人（docs/creator-plan.md，用户定的 2026-10-30："重做捏人系统吧"，方向是分步引导）：
 * 步骤、本地草稿、检查项、联动预告。这里只放不带界面的逻辑，规则本身照旧用 core 的
 */

/**
 * 8 步：出身 → 过往 → 旧识 → 特长 → 义体 → 属性 → 角色特写 → 档案确认
 * （旧识与义体标记为可选；全部步骤均可自由无阻切换）
 */
export const STEPS = [
  { id: "origin", label: "出身与身份" },
  { id: "past", label: "过往经历" },
  { id: "people", label: "旧识 (可选)" },
  { id: "skills", label: "核心特长" },
  { id: "cyberware", label: "义体 (可选)" },
  { id: "attributes", label: "属性分配" },
  { id: "person", label: "角色特写" },
  { id: "review", label: "档案确认" },
] as const;
export type StepId = (typeof STEPS)[number]["id"];

export function stepIndex(id: StepId): number {
  return STEPS.findIndex((s) => s.id === id);
}

/** 点数条：背景点只在过往、旧识、本事、义体几步显示，属性点只在属性那步显示（计划"已定"） */
export function budgetKind(step: StepId): "background" | "attributes" | null {
  if (step === "past" || step === "people" || step === "skills" || step === "cyberware") {
    return "background";
  }
  if (step === "attributes") return "attributes";
  return null;
}

// ———— 本地草稿（计划"界面形式"：中途关掉页面，下次回来接着捏） ————

const DRAFT_KEY = "cp.creatorDraft";

export interface CreatorDraft {
  readonly card: CharacterCard;
  readonly step: StepId;
  /** 走到过的最远一步：进度栏只能点回走过的步 */
  readonly reached: number;
  readonly startLocation: string;
  /** 生命路径已经用掉的重掷次数（共 REROLLS 次）；旧草稿没有，按 0 */
  readonly rerolls: number;
  readonly savedAt: string;
}

/** 生命路径共可重掷 3 次，用完也能从卡片墙手挑（用户定的，2026-10-30） */
export const REROLLS = 3;

/** 只给还没进角色库的新角色存草稿；已保存的角色改了不存（关页面时浏览器会提醒） */
/** 返回是否存上了：存不下（隐私模式、空间满）时界面不能再写"草稿自动存在本机" */
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
    // 同上
  }
}

const isStep = (v: unknown): v is StepId => STEPS.some((s) => s.id === v);

/**
 * 读草稿：坏的、旧版本的直接当没有。草稿可能没填完，所以不用 CharacterCardSchema 校验，
 * 只要字段类型对、主板能解析，就和空白卡合起来
 */
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
    // 属性取整数，夹在起步值和创建上限之间（3 起步、单项最高 6）；不是数字就用空白卡的
    const attr = (key: keyof CharacterCard["attributes"]) => {
      const v = attrs[key];
      if (typeof v !== "number" || !Number.isFinite(v)) return blank.attributes[key];
      return Math.max(ATTRIBUTE_BASE, Math.min(ATTRIBUTE_CREATE_MAX, Math.round(v)));
    };
    // 锁定区块只认合法的区块名，去重
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
      startLocation: typeof d.startLocation === "string" ? d.startLocation : "",
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

// ———— 第 7 步的检查项：没过的链回对应那一步 ————

export interface Check {
  readonly step: StepId;
  readonly text: string;
  /** 不挡保存，只是提醒 */
  readonly soft?: boolean;
}

/** boardIssues 的文字按开头的插槽名归到对应那一步 */
function issueStep(text: string): StepId {
  if (text.includes("出身")) return "origin";
  if (text.includes("旧识")) return "people";
  if (text.includes("过往")) return "past";
  if (text.includes("负面经历")) return "past";
  if (text.includes("义体")) return "cyberware";
  return "skills";
}

/**
 * CharacterCardSchema 报错的字段归到哪一步：保存按钮按 schema 禁用，检查项要和它一致，
 * 不能显示"都齐了"按钮却是灰的（2026-10-30 审查定的）。没列的字段归档案确认这一步
 */
const FIELD_STEP: Partial<Record<keyof CharacterCard, StepId>> = {
  origin: "origin",
  board: "skills",
  attributes: "attributes",
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
  // 上面已经用人话报过的字段，schema 再报同一个字段就不重复列
  const covered = new Set<string>();
  if (card.name.trim() === "") {
    checks.push({ step: "origin", text: "尚未命名" });
    covered.add("name");
  }
  if (card.pronoun.trim() === "") {
    checks.push({ step: "origin", text: "尚未设定代词" });
    covered.add("pronoun");
  }
  if (card.board) {
    const issues = boardIssues(card.board);
    for (const text of issues) checks.push({ step: issueStep(text), text });
    if (issues.length > 0) covered.add("board");
    // 有主板时出身文字跟着出身模块走：插槽空着已经报过，schema 再报"出身不能为空"就重复了（2026-10-31 浏览器检查发现）
    if (issues.some((text) => issueStep(text) === "origin")) covered.add("origin");
  }
  const spent = pointsSpent(card.attributes);
  if (spent > ATTRIBUTE_POINTS) {
    checks.push({ step: "attributes", text: `属性点超额分配 ${spent - ATTRIBUTE_POINTS} 点` });
    covered.add("attributes");
  } else if (spent < ATTRIBUTE_POINTS) {
    checks.push({
      step: "attributes",
      text: `尚有 ${ATTRIBUTE_POINTS - spent} 点属性点待分配`,
      soft: true,
    });
  }
  // 其余 schema 报错（出身名空着、字段超长之类）原样列出，按字段链回对应那一步
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

// ———— 第 1 步：出身会让哪些过往更容易掷到 ————

/** 生命路径表里这个出身权重大于 1 的过往，权重高的在前（rollLifepath 没写的出身按 1） */
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

/** 这个出身完全掷不到的过往（权重写成 0） */
export function originNever(
  originId: string,
  lifepath: readonly LifepathEntry[],
  modules: readonly BoardModule[],
): BoardModule[] {
  return lifepath
    .filter((e) => e.weights[originId] === 0)
    .flatMap((e) => modules.filter((m) => m.id === e.id && m.slot === "past"));
}

// ———— 第 4 步：联动预告 ————

function placed(board: Board): BoardModule[] {
  return [...(board.origin ? [board.origin] : []), ...board.pasts, ...board.skills, ...board.flaws];
}

export interface ComboHint {
  readonly combo: Combo;
  /** 差的那一项：模块 id 或标签 */
  readonly need: string;
  /** 插上任意一块就能凑成的本事模块 */
  readonly candidates: readonly BoardModule[];
}

/**
 * 差一块就能凑成的联动（计划第 4 步："再插一块『枪法』→ 解锁 XX"）：
 * 判法和 core 的 boardCombos 一样，每一项都要有模块对上、至少两块不同的模块参与；只看本事模块能不能补上
 */
export function comboHints(
  board: Board,
  combos: readonly Combo[],
  modules: readonly BoardModule[],
): ComboHint[] {
  const have = placed(board);
  const plugged = new Set(have.map((m) => m.id));
  // 本事插满了就没有候选（上限照 core 的 SKILL_MAX，不写死）
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

/** 背景点还剩多少（点数条和卡片上的"点不够"用） */
export function backgroundLeft(board: Board): number {
  return boardBudget(board).remaining;
}

// ———— 第 5 步：属性靠哪些本事、一键推荐分配 ————

type AttrKey = keyof CharacterCard["attributes"];
const ATTR_KEYS: readonly AttrKey[] = ["body", "reflexes", "tech", "intelligence", "cool"];

/**
 * 每项属性有哪些插着的模块靠它（模块的 checks：做这项检定时算有利条件）。
 * 计划第 5 步："每项属性标出你插的本事里有几块靠它"；过往的 checks 也算，但推荐时只算半块
 */
export function attributeReliance(board: Board): Record<AttrKey, BoardModule[]> {
  const out = Object.fromEntries(ATTR_KEYS.map((k) => [k, [] as BoardModule[]])) as Record<
    AttrKey,
    BoardModule[]
  >;
  for (const m of [...board.skills, ...board.pasts]) {
    for (const a of m.checks) out[a as AttrKey]?.push(m);
  }
  return out;
}

/**
 * 一键推荐：把 7 点按本事靠哪项分下去。每次给"靠它的分量 ÷ 已经加了几点"最高的那项加 1，
 * 单项不过创建上限；一块本事都没写 checks 时就平均分。只是推荐，玩家照样能再改
 */
export function recommendAttributes(board: Board): CharacterCard["attributes"] {
  const reliance = attributeReliance(board);
  const weight = (k: AttrKey) =>
    reliance[k].reduce((sum, m) => sum + (m.slot === "skill" ? 1 : 0.5), 0) + 0.1;
  const values = Object.fromEntries(ATTR_KEYS.map((k) => [k, ATTRIBUTE_BASE])) as Record<
    AttrKey,
    number
  >;
  for (let i = 0; i < ATTRIBUTE_POINTS; i++) {
    let best: AttrKey | null = null;
    let score = -1;
    for (const k of ATTR_KEYS) {
      if (values[k] >= ATTRIBUTE_CREATE_MAX) continue;
      const s = weight(k) / (values[k] - ATTRIBUTE_BASE + 1);
      if (s > score) {
        score = s;
        best = k;
      }
    }
    if (!best) break;
    values[best] += 1;
  }
  return values;
}

// ———— 出身流派初始构筑预设（用户 2026-11-04："角色的属性/装备构建"） ————

export type OriginKey = "street-kid" | "nomad" | "corpo";
export const ORIGIN_KEYS: readonly OriginKey[] = ["street-kid", "nomad", "corpo"];

export interface OriginPreset {
  readonly originId: string;
  readonly name: string;
  readonly summary: string;
  readonly pasts: readonly string[];
  readonly skills: readonly string[];
  readonly attributes: CharacterCard["attributes"];
}

export const ORIGIN_PRESETS: Record<OriginKey, OriginPreset> = {
  "street-kid": {
    originId: "street-kid",
    name: "街头小子·街霸突击",
    summary: "体魄与反应双精通，精通街头肉搏与黑诊所急救，解锁【铁笼凶兽】与【暗巷医者】特长联动",
    pasts: ["gang-runner", "clinic-apprentice", "pit-fighter"],
    skills: ["brawling", "lockpick", "streetwise"],
    attributes: { body: 5, reflexes: 5, tech: 3, intelligence: 4, cool: 5 },
  },
  nomad: {
    originId: "nomad",
    name: "流浪者·恶土游侠",
    summary: "技术与体魄兼备，精通恶劣环境驾驶、机械拆修与智能武器改装，解锁【职业车手】特长联动",
    pasts: ["smuggler", "merc-crew", "clinic-apprentice"],
    skills: ["driving", "mechanic", "smart-weapon-mod"],
    attributes: { body: 5, reflexes: 4, tech: 6, intelligence: 3, cool: 4 },
  },
  corpo: {
    originId: "corpo",
    name: "企业员工·特工谍影",
    summary:
      "极高镇定与网络智力，熟稔企业博弈谈判、快速网络入侵与安防破解，解锁【潜网幽灵】特长联动",
    pasts: ["arasaka-ex", "gang-runner", "clinic-apprentice"],
    skills: ["corpo-negotiation", "quickhacking", "lockpick"],
    attributes: { body: 3, reflexes: 4, tech: 4, intelligence: 5, cool: 6 },
  },
};

export function isOriginPreset(originId: string, board: Board): boolean {
  const preset = ORIGIN_PRESETS[originId as OriginKey] as OriginPreset | undefined;
  if (!preset) return false;
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
  combos: readonly Combo[],
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

  const baseBoard: Board = card.board ?? {
    origin: null,
    pasts: [],
    skills: [],
    flaws: [],
    cyberware: [],
    tolerance: "normal",
    combos: [],
    acquaintances: [],
  };

  const newBoard: Board = {
    ...baseBoard,
    origin: originMod ?? baseBoard.origin,
    pasts: pastMods,
    skills: skillMods,
    combos: [],
  };

  const calculatedCombos = boardCombos(newBoard, combos).map(({ requires: _, ...c }) => c);
  newBoard.combos = calculatedCombos;

  return {
    ...card,
    origin: originMod?.label ?? card.origin,
    attributes: { ...preset.attributes },
    board: newBoard,
  };
}
