import { z } from "zod";
import {
  type CyberwareDef,
  CyberwareSlotSchema,
  SLOT_CAPACITY,
  SLOT_LABELS,
} from "../systems/cyberware/schema";
import { AttributeSchema } from "../systems/dice/schema";
import {
  HUMANITY_MAX,
  TOLERANCE_FACTOR,
  type Tolerance,
  ToleranceSchema,
} from "../systems/humanity/schema";
import type { LedgerKind } from "../systems/npc/schema";

/**
 * 角色主板：出身、过往、本事三类插槽各插几块模块，再加负面经历、开局义体、开局行装和义体耐受。
 * 模块自由组合，只保留各类插槽数量与义体部位容量约束。
 */

export const PAST_MIN = 0;
export const PAST_MAX = 5;
export const SKILL_MIN = 0;
export const SKILL_MAX = 10;
export const FLAW_MAX = 6;
/**
 * 开局义体不再限总数（用户 2026-10-31："怎么装的义体数量有限制的"，选了「去掉总数上限」）：
 * 只受每个部位的原作格数限制；这里是全部格数加起来，只防异常数据
 */
export const START_CYBERWARE_MAX = Object.values(SLOT_CAPACITY).reduce((sum, n) => sum + n, 0);

export const BOARD_SLOTS = ["origin", "past", "skill", "flaw"] as const;
export const BoardSlotSchema = z.enum(BOARD_SLOTS);
export type BoardSlot = z.infer<typeof BoardSlotSchema>;

export const BOARD_SLOT_LABELS: Readonly<Record<BoardSlot, string>> = {
  origin: "出身",
  past: "过往",
  skill: "特质",
  flaw: "负面缺陷",
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
  /** 做哪些属性的检定时算有利条件 */
  checks: z.array(AttributeSchema).max(2).default([]),
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
  summary: line(200).optional(),
  custom: z.boolean().optional(),
  packId: z.string().trim().max(60).optional(),
});
export type StartCyberware = z.infer<typeof StartCyberwareSchema>;

/** 开局启动资金档位 */
export const CASH_TIERS = ["broke", "standard", "stash", "windfall"] as const;
export const CashTierSchema = z.enum(CASH_TIERS);
export type CashTier = z.infer<typeof CashTierSchema>;

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
    eddiesDelta: 2500,
    desc: "额外携带 2,500 欧元私房钱",
  },
  windfall: {
    label: "巨额黑金",
    eddiesDelta: 6000,
    desc: "额外携带 6,000 欧元黑金",
  },
};

/** 开局行装定制：资金档位、额外选购的随身武器（最多 2 把）与专属载具 */
export const StartKitSchema = z.object({
  cashTier: CashTierSchema.default("standard"),
  weapons: z.array(z.string().trim().min(1).max(60)).max(2).default([]),
  vehicle: z.string().trim().min(1).max(60).nullable().default(null),
});
export type StartKit = z.infer<typeof StartKitSchema>;

export const RELATIONS = ["nod", "friend", "owesYou", "youOwe", "ex", "grudge"] as const;
export const RelationKindSchema = z.enum(RELATIONS);
export type RelationKind = z.infer<typeof RelationKindSchema>;

export interface RelationInfo {
  readonly label: string;
  /** 开局好感 */
  readonly affinity: number;
  /** 开局记一条人情或仇 */
  readonly ledger?: LedgerKind;
  /** 开局写一句关系笔记 */
  readonly note: boolean;
}

export const RELATION_INFO: Readonly<Record<RelationKind, RelationInfo>> = {
  nod: { label: "点头之交", affinity: 5, note: false },
  friend: { label: "老朋友", affinity: 30, note: true },
  owesYou: { label: "他欠你人情", affinity: 15, ledger: "owesYou", note: false },
  youOwe: { label: "你欠他人情", affinity: 10, ledger: "youOwe", note: false },
  ex: { label: "前任", affinity: 10, note: true },
  grudge: { label: "旧仇", affinity: -30, ledger: "grudge", note: false },
};

export const ACQUAINTANCE_MAX = 100;
export const ACQUAINTANCE_NOTE_CHARS = 60;

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
});
export type Acquaintance = z.infer<typeof AcquaintanceSchema>;

/** 创意工坊模组包标准协议（Workshop-Ready Foundation） */
export const WorkshopPackSchema = z.object({
  format: z.literal("cp2077-workshop-pack").default("cp2077-workshop-pack"),
  version: z.literal(1).default(1),
  id: z.string().trim().min(1).max(60),
  title: z.string().trim().min(1).max(40),
  author: z.string().trim().max(40).default(""),
  description: line(300).default(""),
  modules: z.array(BoardModuleSchema).max(200).default([]),
  cyberware: z.array(StartCyberwareSchema).max(100).default([]),
  acquaintances: z.array(AcquaintanceSchema).max(100).default([]),
});
export type WorkshopPack = z.infer<typeof WorkshopPackSchema>;

export const BoardSchema = z.object({
  origin: BoardModuleSchema.nullable().default(null),
  pasts: z.array(BoardModuleSchema).max(PAST_MAX).default([]),
  skills: z.array(BoardModuleSchema).max(SKILL_MAX).default([]),
  flaws: z.array(BoardModuleSchema).max(FLAW_MAX).default([]),
  cyberware: z.array(StartCyberwareSchema).max(START_CYBERWARE_MAX).default([]),
  tolerance: ToleranceSchema.default("normal"),
  acquaintances: z.array(AcquaintanceSchema).max(ACQUAINTANCE_MAX).default([]),
  /** 开局行装定制：资金档位、额外随身武器与专属载具 */
  kit: StartKitSchema.default({ cashTier: "standard", weapons: [], vehicle: null }),
  /** 开局地图锚点 */
  startLocation: z.string().trim().min(1).max(80).optional(),
});
export type Board = z.infer<typeof BoardSchema>;

/** 义体耐受档位：影响人性消耗倍率和剧情钩子 */
export const TOLERANCE_LEVELS: Readonly<
  Record<Tolerance, { readonly label: string; readonly hook: string }>
> = {
  low: {
    label: "低耐受",
    hook: "身体排斥义体：装一件就要难受好几天，义体医生看了你的病历都皱眉",
  },
  normal: { label: "普通", hook: "" },
  high: {
    label: "高耐受",
    hook: "身体对义体来者不拒，有公司的研究员很想知道为什么",
  },
};

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

/** 开局义体占掉的人性上限，按耐受档位折算 */
export function boardHumanityCost(board: Board): number {
  const raw = board.cyberware.reduce((sum, c) => sum + c.humanityCost, 0);
  return Math.min(HUMANITY_MAX, Math.round(raw * TOLERANCE_FACTOR[board.tolerance]));
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
  const slots = new Map<string, number>();
  const cyberware: StartCyberware[] = [];
  for (const item of board.cyberware) {
    const def = catalog.find((c) => c.id === item.id);
    if (!def) {
      // 创意工坊/自定义义体自包含快照兜底：不报错拦截
      if (item.custom && item.slot) {
        const taken = (slots.get(item.slot) ?? 0) + 1;
        if (taken > SLOT_CAPACITY[item.slot]) {
          return {
            ok: false,
            error: `${SLOT_LABELS[item.slot]}最多装 ${SLOT_CAPACITY[item.slot]} 件`,
          };
        }
        slots.set(item.slot, taken);
        cyberware.push(item);
        continue;
      }
      return { ok: false, error: `义体表里没有 ${item.id}` };
    }
    if (def.iconic || !START_CYBERWARE_RARITIES.has(def.rarity)) {
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
    cyberware.push({
      id: def.id,
      name: def.name,
      humanityCost: def.humanityCost,
      slot: def.slot,
    });
  }
  return { ok: true, board: { ...board, cyberware } };
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
  const lines = [...boardModules(board).map(moduleLine)];
  const tolerance = TOLERANCE_LEVELS[board.tolerance];
  if (board.tolerance !== "normal") {
    lines.push(
      `- 义体耐受：${tolerance.label}，义体的人性消耗 ×${TOLERANCE_FACTOR[board.tolerance]}；钩子：${tolerance.hook}`,
    );
  }
  if (board.cyberware.length > 0) {
    lines.push(`- 开局义体：${board.cyberware.map((c) => c.name).join("、")}`);
  }
  if (board.kit && board.kit.cashTier !== "standard") {
    lines.push(`- 开局财务状况：${CASH_TIER_INFO[board.kit.cashTier].label}`);
  }
  for (const a of board.acquaintances) {
    lines.push(
      `- 旧识「${a.name}」${a.role ? `（${a.role}）` : ""}：${RELATION_INFO[a.relation].label}${a.note ? `；${a.note}` : ""}`,
    );
  }
  return ["主板（能力是角色已经能做到的事，钩子是剧情可以用的线头）：", ...lines].join("\n");
}
