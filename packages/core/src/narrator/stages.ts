import { z } from "zod";
import { effectiveTurns, type LogRecord } from "../kernel/turnlog";
import type { WorldState } from "../kernel/world";
import { TurnInputSchema } from "../schemas/turn";
import { CharacterStateSchema, effectiveAttribute } from "../systems/character/schema";
import { ATTRIBUTE_LABELS, CheckProposalSchema } from "../systems/dice";
import {
  DiscountSchema,
  discounted,
  EconomyStateSchema,
  isBigSpend,
  SERVICES,
  ServiceSchema,
} from "../systems/economy/schema";
import { itemCatalog } from "../systems/inventory/apply";
import { JobsStateSchema } from "../systems/jobs/schema";
import { WorldClockStateSchema } from "../systems/world/schema";
import { type Gate, GateProposalSchema } from "./block";

/**
 * 一轮分五步：① 判断 → ② 拼上下文 → ③ 写正文 → ④ 抽取 → ⑤ 核对。
 * 这里放 ① 和 ⑤ 的格式、门槛判定、旧记忆候选；调模型和结算在 turn.ts
 */

/** ① 判断里玩家这一轮要花的钱：只写买什么，价钱由代码查表 */
export const BuyProposalSchema = z
  .object({
    item: z.string().min(1).optional().describe("买物品写物品表里的 id"),
    service: ServiceSchema.optional().describe(
      "买服务写：meal 吃一顿，drink 一杯酒，lodging 住一晚，cab 打车，info 买情报，medical 街头诊所看伤，fine 交罚款，favor 打点",
    ),
    discount: DiscountSchema.default("none").describe(
      "讲价讲下来多少：none 没有，small 小，large 大",
    ),
  })
  .refine((b) => (b.item === undefined) !== (b.service === undefined), {
    message: "item 和 service 写一个",
  });
export type BuyProposal = z.infer<typeof BuyProposalSchema>;

/** ① 判断的格式，只用来生成说明；check、gate 和 buy 另外逐条校验 */
export const JudgeDocSchema = z.object({
  read: z
    .string()
    .nullable()
    .describe("一句话说出你对玩家意图的理解，用“你想……”开头；场外提问写 null"),
  ooc: z
    .boolean()
    .describe("玩家跳出角色在场外提问（问规则、问可行性、问现状），不是让角色行动时写 true"),
  check: CheckProposalSchema.nullable().describe("结果真不确定、需要掷骰时给出；不需要时写 null"),
  gate: GateProposalSchema.nullable().describe("属性达标就直接成功的门槛；没有写 null"),
  buy: BuyProposalSchema.nullable().describe(
    "玩家这一轮要掏钱买东西或买服务时写买什么，不写价钱；不花钱写 null",
  ),
  recall: z
    .array(z.string())
    .describe("从【可调的旧记忆】里原样抄这一轮用得上的标题，最多 3 条，按从旧到新排；没有写 []"),
});

const JudgeShapeSchema = z.object({
  read: z.string().nullable().optional().catch(undefined),
  ooc: z.boolean().optional().catch(undefined),
  check: z.unknown().optional(),
  gate: z.unknown().optional(),
  buy: z.unknown().optional(),
  recall: z.array(z.unknown()).optional().catch(undefined),
});
export type JudgeShape = z.infer<typeof JudgeShapeSchema>;

export type JudgeShapeResult =
  | { readonly ok: true; readonly judge: JudgeShape }
  | { readonly ok: false; readonly error: string };

export function readJudgeShape(value: unknown): JudgeShapeResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, error: "判断要是一个 JSON 对象" };
  }
  const parsed = JudgeShapeSchema.safeParse(value);
  return parsed.success ? { ok: true, judge: parsed.data } : { ok: false, error: "字段类型不对" };
}

export const MAX_RECALL = 3;

/** 门槛由代码直接判定，不掷骰 */
export interface GateResult {
  readonly gate: Gate;
  /** 角色这项属性的当前值（算上义体加成） */
  readonly value: number;
  readonly met: boolean;
}

export function judgeGate(world: WorldState, gate: Gate): GateResult {
  const character = CharacterStateSchema.parse(world.slices.character);
  const value = effectiveAttribute(character, gate.attribute);
  return { gate, value, met: value >= gate.value };
}

export function gateText(result: GateResult): string {
  const label = ATTRIBUTE_LABELS[result.gate.attribute];
  return result.met
    ? `【门槛】${label}要 ${result.gate.value}，角色是 ${result.value}：达标，这件事直接办成，不掷骰`
    : `【门槛】${label}要 ${result.gate.value}，角色是 ${result.value}：没达标，这条路现在走不通；让世界或人物拒绝，或者让玩家付出别的代价换一条路`;
}

/** 要玩家先确认的大额花费 */
export interface BigSpend {
  readonly label: string;
  readonly price: number;
  /** 身上现有的欧元 */
  readonly eddies: number;
}

/** 一次花掉超过存款一半且超过 1,000 欧元时返回；查不到价钱、不卖的东西不拦，交给结算 */
export function bigSpend(
  world: WorldState,
  data: Readonly<Record<string, unknown>>,
  buy: BuyProposal,
): BigSpend | undefined {
  const { eddies } = EconomyStateSchema.parse(world.slices.economy);
  let label: string;
  let base: number;
  if (buy.service !== undefined) {
    label = SERVICES[buy.service].label;
    base = SERVICES[buy.service].price;
  } else {
    const def =
      data.items === undefined || buy.item === undefined
        ? undefined
        : itemCatalog(data).get(buy.item);
    if (!def || def.iconic || def.price === undefined) return undefined;
    label = def.name;
    base = def.price;
  }
  const price = discounted(base, buy.discount);
  return isBigSpend(price, eddies) ? { label, price, eddies } : undefined;
}

/** 一次跳过这么多分钟以上算长时间跳过（睡觉、等到天黑、长途移动） */
export const LONG_SKIP = 120;

/** 长时间跳过中间最早到期的事：没回应的期限、还没超期的委托；没有时为 undefined */
export function skipStop(
  world: WorldState,
  to: number,
): { readonly at: number; readonly label: string } | undefined {
  if (to - world.time < LONG_SKIP) return undefined;
  const clock = WorldClockStateSchema.parse(world.slices.world);
  const jobs = JobsStateSchema.parse(world.slices.jobs);
  const points = [
    ...clock.deadlines
      .filter((d) => d.handledAt === null)
      .map((d) => ({ at: d.due, label: d.label })),
    ...jobs.jobs.flatMap((j) =>
      j.status === "active" && !j.overdue && j.due !== null
        ? [{ at: j.due, label: `委托「${j.title}」` }]
        : [],
    ),
  ];
  return points.filter((p) => p.at > world.time && p.at < to).sort((a, b) => a.at - b.at)[0];
}

/** 可调的旧记忆：热层以外的旧轮次；M3 换成状态库和扩展层检索 */
export interface Memory {
  readonly title: string;
  readonly text: string;
}

const MAX_CANDIDATES = 40;
const MEMORY_CHARS = 400;

function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return [...flat].length > max ? `${[...flat].slice(0, max).join("")}…` : flat;
}

/** 已经掉出最近 hot 轮的回合，每轮一个标题；场外提问和未定稿的不算 */
export function recallCandidates(records: readonly LogRecord[], hot: number): Memory[] {
  const turns = effectiveTurns(records).filter((t) => {
    if (t.ooc === true || t.unsettled !== undefined) return false;
    const input = TurnInputSchema.safeParse(t.input);
    return !(input.success && input.data.mode === "ooc");
  });
  return turns
    .slice(0, Math.max(0, turns.length - hot))
    .slice(-MAX_CANDIDATES)
    .map((t) => ({
      title: `第 ${t.seq} 轮${t.title ? ` ${t.title}` : ""}：${oneLine(t.read ?? t.text, 24)}`,
      text: oneLine(t.text, MEMORY_CHARS),
    }));
}

/** ⑤ 核对的一行 */
export type PatchLine =
  | { readonly op: "keep"; readonly n: number }
  | { readonly op: "drop"; readonly n: number; readonly reason: string }
  | {
      readonly op: "fix";
      readonly n: number;
      readonly fields: Readonly<Record<string, string | number>>;
      readonly reason: string;
    };

const PATCH_BLOCK = /<patch>([\s\S]*?)(?:<\/patch>|$)/;
const PATCH_LINE = /^(keep|drop|fix)\s+(\d+)\s*([^;；]*?)\s*(?:[;；]\s*(.*))?$/;

/** 解析 <patch> 块；没有块时返回 undefined，认不出的行跳过 */
export function parsePatch(text: string): PatchLine[] | undefined {
  const block = PATCH_BLOCK.exec(text);
  if (!block) return undefined;
  const out: PatchLine[] = [];
  for (const raw of (block[1] ?? "").split("\n")) {
    const m = PATCH_LINE.exec(raw.trim());
    if (!m) continue;
    const n = Number(m[2]);
    const reason = (m[4] ?? "").trim();
    if (m[1] === "keep") out.push({ op: "keep", n });
    else if (m[1] === "drop") out.push({ op: "drop", n, reason: reason || "正文里没有依据" });
    else {
      const fields: Record<string, string | number> = {};
      for (const pair of (m[3] ?? "").split(/\s+/)) {
        const eq = pair.indexOf("=");
        if (eq <= 0) continue;
        const value = pair.slice(eq + 1).replace(/^["']|["']$/g, "");
        fields[pair.slice(0, eq)] = /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : value;
      }
      if (Object.keys(fields).length > 0) out.push({ op: "fix", n, fields, reason });
    }
  }
  return out;
}

/** 档位从轻到重；fix 只能往轻里改 */
const LADDERS: readonly (readonly string[])[] = [
  ["graze", "heavy", "lethal"],
  ["small", "medium", "large"],
  ["few", "some", "lots"],
];

/** 这些字段决定“是什么、对谁”，核对不能改 */
const FIXED_FIELDS = new Set(["type", "action", "id", "target", "npc", "from", "source", "kind"]);

export type FixResult =
  | { readonly ok: true; readonly value: Record<string, unknown> }
  | { readonly ok: false; readonly reason: string };

/** 按核对的 fix 改一条提议：只能改已有的字段，档位只能降、数值只能往 0 靠 */
export function applyFix(
  original: Readonly<Record<string, unknown>>,
  fields: Readonly<Record<string, string | number>>,
): FixResult {
  const next: Record<string, unknown> = { ...original };
  for (const [key, value] of Object.entries(fields)) {
    if (FIXED_FIELDS.has(key)) return { ok: false, reason: `核对不能改 ${key}` };
    if (!(key in original)) return { ok: false, reason: `核对不能加新字段 ${key}` };
    const old = original[key];
    if (typeof old === "number" && typeof value === "number") {
      const sameSide = value === 0 || Math.sign(value) === Math.sign(old);
      if (!sameSide || Math.abs(value) > Math.abs(old)) {
        return { ok: false, reason: `${key} 只能往小改（原来 ${old}，核对写 ${value}）` };
      }
      next[key] = value;
      continue;
    }
    if (typeof old === "string" && typeof value === "string") {
      const ladder = LADDERS.find((l) => l.includes(old));
      if (!ladder?.includes(value) || ladder.indexOf(value) > ladder.indexOf(old)) {
        return { ok: false, reason: `${key} 只能把档位往轻里改（原来 ${old}，核对写 ${value}）` };
      }
      next[key] = value;
      continue;
    }
    return { ok: false, reason: `${key} 不能这样改` };
  }
  return { ok: true, value: next };
}
