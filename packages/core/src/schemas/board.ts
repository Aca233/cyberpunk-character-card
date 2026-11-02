import { z } from "zod";
import { type CyberwareDef, SLOT_CAPACITY, SLOT_LABELS } from "../systems/cyberware/schema";
import { AttributeSchema } from "../systems/dice/schema";
import {
  HUMANITY_MAX,
  TOLERANCE_FACTOR,
  type Tolerance,
  ToleranceSchema,
} from "../systems/humanity/schema";
import type { LedgerKind } from "../systems/npc/schema";

/**
 * 角色主板：出身、过往、本事三类插槽各插几块模块，再加负面经历、开局义体和义体耐受。
 * 模块用背景点买，负面经历返还点数；预算只在创建时结算，进入剧情后不再有点数
 */

/** 背景点：和属性点分开结算 */
export const BACKGROUND_POINTS = 12;
/** 负面经历合计最多返还这么多 */
export const REFUND_MAX = 6;
export const PAST_MIN = 3;
export const PAST_MAX = 5;
export const SKILL_MIN = 3;
export const SKILL_MAX = 6;
export const FLAW_MAX = 4;
/**
 * 开局义体不再限总数（用户 2026-10-31："怎么装的义体数量有限制的"，选了「去掉总数上限」）：
 * 只受每个部位的原作格数和背景点限制；这里是全部格数加起来，只防异常数据
 */
export const START_CYBERWARE_MAX = Object.values(SLOT_CAPACITY).reduce((sum, n) => sum + n, 0);

export const BOARD_SLOTS = ["origin", "past", "skill", "flaw"] as const;
export const BoardSlotSchema = z.enum(BOARD_SLOTS);
export type BoardSlot = z.infer<typeof BoardSlotSchema>;

export const BOARD_SLOT_LABELS: Readonly<Record<BoardSlot, string>> = {
  origin: "出身",
  past: "过往",
  skill: "本事",
  flaw: "负面经历",
};

/** 每类模块的标价范围：出身不另收点数（自写的强出身最多 2 点），负面经历的点数是返还 */
export const MODULE_POINTS: Readonly<Record<BoardSlot, readonly [number, number]>> = {
  origin: [0, 2],
  past: [1, 4],
  skill: [1, 4],
  flaw: [1, 4],
};

const line = (max: number) => z.string().trim().max(max);

/** 模块带出的人物：开档后自动生成人物卡 */
export const ModulePersonSchema = z.object({
  name: z.string().trim().min(1).max(20),
  role: line(80).default(""),
});

export const BoardModuleSchema = z.object({
  /** 模块库里的 id；自己写的模块以 custom- 开头 */
  id: z.string().trim().min(1).max(40),
  slot: BoardSlotSchema,
  label: z.string().trim().min(1, "模块要有名字").max(24),
  /** 花多少背景点；负面经历是返还多少 */
  points: z.number().int().min(0).max(4),
  /** 标签：联动和检定加成按标签判断 */
  tags: z.array(z.string().trim().min(1).max(12)).max(6).default([]),
  /** 这块模块让角色能做到什么；叙事模型据此判断行动是否可行 */
  ability: line(200).default(""),
  /** 剧情钩子：叙事模型可以拿来做文章的线头 */
  hook: line(200).default(""),
  people: z.array(ModulePersonSchema).max(2).default([]),
  /** 做哪些属性的检定时算有利条件 */
  checks: z.array(AttributeSchema).max(2).default([]),
  /** 玩家自己写的模块 */
  custom: z.boolean().default(false),
});
export type BoardModule = z.infer<typeof BoardModuleSchema>;

/** 开局义体的快照：点数和人性消耗由服务端按义体表重算，不信任客户端 */
export const StartCyberwareSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(40),
  // 传说件开局 5 点（用户 2026-10-31 选了"全部放开"）
  points: z.number().int().min(1).max(5),
  humanityCost: z.number().int().min(0).max(20),
});
export type StartCyberware = z.infer<typeof StartCyberwareSchema>;

/** 联动：几块模块的标签或 id 凑齐时触发，带来新能力和钩子；预设的写在 content 的 combos.ts */
export const ComboSchema = z.object({
  id: z.string().trim().min(1).max(40),
  label: z.string().trim().min(1).max(24),
  /** 每一项要有一块模块的 id 或标签对上；至少要两块不同的模块参与 */
  requires: z.array(z.string().trim().min(1)).min(2).max(4),
  ability: line(200),
  hook: line(200).default(""),
});
export type Combo = z.infer<typeof ComboSchema>;

/** 角色卡上记着的联动：存卡时服务端按联动表重算 */
export const BoardComboSchema = ComboSchema.omit({ requires: true });
export type BoardCombo = z.infer<typeof BoardComboSchema>;

/** 生命路径表的一条：过往模块 id 和按出身的权重，没写的出身按 1 */
export const LifepathEntrySchema = z.object({
  id: z.string().min(1),
  weights: z.record(z.string(), z.number().min(0)).default({}),
  /**
   * 跟这段经历沾边的代价（负面经历模块 id）：掷到这段后提出来让玩家选接不接
   * （docs/creator-plan.md 第 2 步："给出 1–2 个跟这段经历沾边的代价"）。过往和负面经历的标签对不上，只能逐条写
   */
  costs: z.array(z.string().min(1)).max(2).default([]),
});
export type LifepathEntry = z.infer<typeof LifepathEntrySchema>;

/**
 * 旧识的关系：捏人第 3 步给认识的人挑一种。
 * 用户定的关系表（2026-10-30，docs/creator-plan.md）：点头之交 +5；老朋友 +30、关系笔记、花 2 点；
 * 他欠你人情 +15、花 2 点；你欠他人情 +10；前任 +10、关系笔记；旧仇 −30。负面关系不花也不返背景点
 */
export const RELATIONS = ["nod", "friend", "owesYou", "youOwe", "ex", "grudge"] as const;
export const RelationKindSchema = z.enum(RELATIONS);
export type RelationKind = z.infer<typeof RelationKindSchema>;

export interface RelationInfo {
  readonly label: string;
  /** 开局好感 */
  readonly affinity: number;
  /** 花多少背景点 */
  readonly points: number;
  /** 开局记一条人情或仇 */
  readonly ledger?: LedgerKind;
  /** 开局写一句关系笔记 */
  readonly note: boolean;
}

export const RELATION_INFO: Readonly<Record<RelationKind, RelationInfo>> = {
  nod: { label: "点头之交", affinity: 5, points: 0, note: false },
  friend: { label: "老朋友", affinity: 30, points: 2, note: true },
  owesYou: { label: "他欠你人情", affinity: 15, points: 2, ledger: "owesYou", note: false },
  youOwe: { label: "你欠他人情", affinity: 10, points: 0, ledger: "youOwe", note: false },
  ex: { label: "前任", affinity: 10, points: 0, note: true },
  grudge: { label: "旧仇", affinity: -30, points: 0, ledger: "grudge", note: false },
};

/**
 * 旧识最多记这么多人：用户说"无数个"，这里只防异常数据。
 * 原作人物补到 40 多个（用户 2026-11-02："把所有能预设好的角色都预设好"），再加模块带出的人（每块最多 2 个），40 不够用，放到 100
 */
export const ACQUAINTANCE_MAX = 100;
/** 每个旧识"是什么事"的一句话 */
export const ACQUAINTANCE_NOTE_CHARS = 60;

/** 一个旧识：id 是原作人物的 id，或模块带出的人（boardPeople 生成的 board- 开头的 id） */
export const AcquaintanceSchema = z.object({
  id: z.string().trim().min(1).max(60),
  /** 显示用的名字快照；建档按 id 对人 */
  name: z.string().trim().min(1).max(20),
  relation: RelationKindSchema,
  /** 是什么事；不写由一键成稿补，补不上就按关系名写 */
  note: line(ACQUAINTANCE_NOTE_CHARS).default(""),
});
export type Acquaintance = z.infer<typeof AcquaintanceSchema>;

export const BoardSchema = z.object({
  origin: BoardModuleSchema.nullable().default(null),
  pasts: z.array(BoardModuleSchema).max(PAST_MAX).default([]),
  skills: z.array(BoardModuleSchema).max(SKILL_MAX).default([]),
  flaws: z.array(BoardModuleSchema).max(FLAW_MAX).default([]),
  cyberware: z.array(StartCyberwareSchema).max(START_CYBERWARE_MAX).default([]),
  tolerance: ToleranceSchema.default("normal"),
  combos: z.array(BoardComboSchema).max(6).default([]),
  /** 捏人第 3 步选的旧识；旧卡没有 */
  acquaintances: z.array(AcquaintanceSchema).max(ACQUAINTANCE_MAX).default([]),
});
export type Board = z.infer<typeof BoardSchema>;

/** 义体耐受档位：高耐受花点数换更低的人性消耗和一个钩子，低耐受返还点数 */
export const TOLERANCE_LEVELS: Readonly<
  Record<Tolerance, { readonly label: string; readonly points: number; readonly hook: string }>
> = {
  low: {
    label: "低耐受",
    points: -2,
    hook: "身体排斥义体：装一件就要难受好几天，义体医生看了你的病历都皱眉",
  },
  normal: { label: "普通", points: 0, hook: "" },
  high: {
    label: "高耐受",
    points: 3,
    hook: "身体对义体来者不拒，有公司的研究员很想知道为什么",
  },
};

/**
 * 开局义体的点数：普通 1、罕见 2、稀有 3、史诗 4、传说 5；标志性的仍要进剧情后找义体医生
 * （原来只放普通和罕见，用户 2026-10-31 嫌"怎么只有这么少义体"，选了"全部放开"）
 */
export const START_CYBERWARE_POINTS: Readonly<Record<string, number>> = {
  common: 1,
  uncommon: 2,
  rare: 3,
  epic: 4,
  legendary: 5,
};

/** 插在主板上的全部模块，按插槽顺序 */
export function boardModules(board: Board): BoardModule[] {
  return [...(board.origin ? [board.origin] : []), ...board.pasts, ...board.skills, ...board.flaws];
}

export interface BoardBudget {
  readonly total: number;
  /** 模块、开局义体和高耐受花掉的 */
  readonly spent: number;
  /** 负面经历（截到上限）和低耐受返还的 */
  readonly refund: number;
  /** 负面经历超出返还上限、没算进来的点数 */
  readonly wasted: number;
  readonly remaining: number;
}

export function boardBudget(board: Board): BoardBudget {
  const tolerance = TOLERANCE_LEVELS[board.tolerance].points;
  const modules = [...(board.origin ? [board.origin] : []), ...board.pasts, ...board.skills];
  const spent =
    modules.reduce((sum, m) => sum + m.points, 0) +
    board.cyberware.reduce((sum, c) => sum + c.points, 0) +
    Math.max(0, tolerance) +
    // 旧识：老朋友、他欠你人情各花 2 点，负面关系不返（用户定的关系表，2026-10-30）
    board.acquaintances.reduce((sum, a) => sum + RELATION_INFO[a.relation].points, 0);
  const flaws = board.flaws.reduce((sum, m) => sum + m.points, 0);
  const refund = Math.min(REFUND_MAX, flaws) + Math.max(0, -tolerance);
  return {
    total: BACKGROUND_POINTS,
    spent,
    refund,
    wasted: Math.max(0, flaws - REFUND_MAX),
    remaining: BACKGROUND_POINTS - spent + refund,
  };
}

/** 开局义体占掉的人性上限，按耐受档位折算 */
export function boardHumanityCost(board: Board): number {
  const raw = board.cyberware.reduce((sum, c) => sum + c.humanityCost, 0);
  return Math.min(HUMANITY_MAX, Math.round(raw * TOLERANCE_FACTOR[board.tolerance]));
}

/** 主板哪里不合规矩；空数组表示可以保存 */
export function boardIssues(board: Board): string[] {
  const issues: string[] = [];
  if (!board.origin) issues.push("出身插槽还空着");
  if (board.pasts.length < PAST_MIN) {
    issues.push(`过往至少插 ${PAST_MIN} 块，现在 ${board.pasts.length} 块`);
  }
  if (board.skills.length < SKILL_MIN) {
    issues.push(`本事至少插 ${SKILL_MIN} 块，现在 ${board.skills.length} 块`);
  }
  const placed: [BoardSlot, readonly BoardModule[]][] = [
    ["origin", board.origin ? [board.origin] : []],
    ["past", board.pasts],
    ["skill", board.skills],
    ["flaw", board.flaws],
  ];
  const seen = new Set<string>();
  for (const [slot, list] of placed) {
    const [min, max] = MODULE_POINTS[slot];
    for (const m of list) {
      if (m.slot !== slot) {
        issues.push(
          `「${m.label}」是${BOARD_SLOT_LABELS[m.slot]}模块，不能插在${BOARD_SLOT_LABELS[slot]}插槽`,
        );
      }
      if (m.points < min || m.points > max) {
        issues.push(`${BOARD_SLOT_LABELS[slot]}模块「${m.label}」的点数要在 ${min}–${max} 之间`);
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
  const budget = boardBudget(board);
  if (budget.remaining < 0) {
    issues.push(
      `背景点超支 ${-budget.remaining} 点：花了 ${budget.spent}，返还 ${budget.refund}，共有 ${budget.total}`,
    );
  }
  return issues;
}

/** 主板触发了哪些联动 */
export function boardCombos(board: Board, combos: readonly Combo[]): Combo[] {
  const modules = boardModules(board);
  return combos.filter((combo) => {
    const used = new Set<string>();
    for (const need of combo.requires) {
      const hits = modules.filter((m) => m.id === need || m.tags.includes(need));
      if (hits.length === 0) return false;
      for (const m of hits) used.add(m.id);
    }
    return used.size >= 2;
  });
}

/** 生命路径掷一段过往：按出身加权，已经插着的不再出 */
export function rollLifepath(
  board: Board,
  table: readonly LifepathEntry[],
  modules: readonly BoardModule[],
  random: () => number,
): BoardModule | null {
  const taken = new Set(board.pasts.map((m) => m.id));
  const origin = board.origin?.id ?? "";
  const pool = table.flatMap((entry) => {
    const module = modules.find((m) => m.id === entry.id && m.slot === "past");
    const weight = entry.weights[origin] ?? 1;
    return module && weight > 0 && !taken.has(module.id) ? [{ module, weight }] : [];
  });
  const total = pool.reduce((sum, p) => sum + p.weight, 0);
  let roll = random() * total;
  for (const p of pool) {
    roll -= p.weight;
    if (roll < 0) return p.module;
  }
  return pool.at(-1)?.module ?? null;
}

/** 随机插满：过往补到必填的块数 */
export function fillPasts(
  board: Board,
  table: readonly LifepathEntry[],
  modules: readonly BoardModule[],
  random: () => number,
): Board {
  let next = board;
  while (next.pasts.length < PAST_MIN) {
    const rolled = rollLifepath(next, table, modules, random);
    if (!rolled) break;
    next = { ...next, pasts: [...next.pasts, rolled] };
  }
  return next;
}

/** 一条代价：哪块负面经历，因为哪几段过往沾边 */
export interface LifepathCost {
  readonly module: BoardModule;
  readonly from: readonly BoardModule[];
}

/**
 * 已插的过往按生命路径表提出的代价（docs/creator-plan.md 第 2 步：掷完过往后给出沾边的代价，
 * "接受，换 N 点"）。同一块负面经历被几段过往提到只列一次，按过往的顺序排；已经接受的也列着，方便撤回
 */
export function lifepathCosts(
  board: Board,
  table: readonly LifepathEntry[],
  modules: readonly BoardModule[],
): LifepathCost[] {
  const costs = new Map<string, { module: BoardModule; from: BoardModule[] }>();
  for (const past of board.pasts) {
    const entry = table.find((e) => e.id === past.id);
    for (const id of entry?.costs ?? []) {
      const module = modules.find((m) => m.id === id && m.slot === "flaw");
      if (!module) continue;
      const had = costs.get(id);
      if (had) had.from.push(past);
      else costs.set(id, { module, from: [past] });
    }
  }
  return [...costs.values()];
}

export interface BoardTables {
  readonly cyberware: readonly CyberwareDef[];
  readonly combos: readonly Combo[];
}

/**
 * 存角色卡前在服务端调一次：按义体表重算开局义体的快照（没有的、标志性的、
 * 同一部位超过 SLOT_CAPACITY 格数的都不收；稀有以上 2026-10-31 起也能装），按联动表重算联动；之后预算和简介按快照算
 */
export function normalizeBoard(
  board: Board,
  tables: BoardTables,
): { readonly ok: true; readonly board: Board } | { readonly ok: false; readonly error: string } {
  const catalog = tables.cyberware;
  // 每个部位按原作格数装（用户 2026-10-31："为什么每个地方的义体只能选一个"），超过格数才不收
  const slots = new Map<string, number>();
  const cyberware: StartCyberware[] = [];
  for (const { id } of board.cyberware) {
    const def = catalog.find((c) => c.id === id);
    if (!def) return { ok: false, error: `义体表里没有 ${id}` };
    const points = START_CYBERWARE_POINTS[def.rarity];
    if (def.iconic || points === undefined) {
      return { ok: false, error: `${def.name}不能在创建时装，进剧情后找义体医生` };
    }
    const taken = (slots.get(def.slot) ?? 0) + 1;
    if (taken > SLOT_CAPACITY[def.slot]) {
      return {
        ok: false,
        error: `${SLOT_LABELS[def.slot]}最多装 ${SLOT_CAPACITY[def.slot]} 件`,
      };
    }
    slots.set(def.slot, taken);
    cyberware.push({ id: def.id, name: def.name, points, humanityCost: def.humanityCost });
  }
  const combos = boardCombos(board, tables.combos).map(({ requires: _, ...combo }) => combo);
  return { ok: true, board: { ...board, cyberware, combos } };
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
    ...boardModules(board).map(moduleLine),
    ...board.combos.map(
      (c) => `- 联动「${c.label}」；能力：${c.ability}${c.hook ? `；钩子：${c.hook}` : ""}`,
    ),
  ];
  const tolerance = TOLERANCE_LEVELS[board.tolerance];
  if (board.tolerance !== "normal") {
    lines.push(
      `- 义体耐受：${tolerance.label}，义体的人性消耗 ×${TOLERANCE_FACTOR[board.tolerance]}；钩子：${tolerance.hook}`,
    );
  }
  if (board.cyberware.length > 0) {
    lines.push(`- 开局义体：${board.cyberware.map((c) => c.name).join("、")}`);
  }
  for (const a of board.acquaintances) {
    lines.push(
      `- 旧识「${a.name}」：${RELATION_INFO[a.relation].label}${a.note ? `；${a.note}` : ""}`,
    );
  }
  return ["主板（能力是角色已经能做到的事，钩子是剧情可以用的线头）：", ...lines].join("\n");
}
