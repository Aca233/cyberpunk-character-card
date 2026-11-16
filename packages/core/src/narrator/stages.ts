import { z } from "zod";
import type { WorldState } from "../kernel/world";
import {
  DiscountSchema,
  discounted,
  EconomyStateSchema,
  isBigSpend,
  SERVICES,
  ServiceSchema,
} from "../systems/economy/schema";
import { itemCatalog } from "../systems/inventory/apply";
import { vehicleCatalog } from "../systems/travel/vehicles";

/**
 * 一轮核心流程：① 判断（记忆调度与定性物理/社会裁决）→ ② 拼上下文 → ③ 写正文 → ④ 抽取。
 * 这里放 ① 的 JSON 结构、大额消费确认；定性物理硬约束校验在 pipeline.ts
 */

/** ① 判断里玩家这一轮要花的钱：只写买什么，价钱由代码查表 */
export const BuyProposalSchema = z
  .object({
    item: z.string().min(1).optional().describe("买物品写物品表里的 id，买车写车型 id"),
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

/** ① 判断里的定性物理与社会因果裁决；日常闲聊写 null */
export const JudgeRulingSchema = z.object({
  kind: z
    .enum(["possible", "costly", "blocked"])
    .describe(
      "possible 条件充分可顺畅做成；costly 做得到但要付出代价/受挫/引发冲突；blocked 受物理、权限、气隙、装备或现实常识阻断而做不到",
    ),
  outcome: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .describe("一句话定性写明这一轮现实会怎么回应：怎么成、付出什么代价，或被什么具体阻拦卡住"),
  harm: z
    .enum(["none", "graze", "heavy", "lethal"])
    .describe(
      "玩家角色本轮客观面临的最高身体伤害风险：none 无伤，graze 擦伤磕碰，heavy 重击/中枪，lethal 致命绝境",
    ),
  limb: z
    .boolean()
    .optional()
    .describe("仅在刀刃、霰弹枪、爆炸、重型机械等真可能当场断肢的致命场面写 true；其余不写"),
  reason: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .describe(
      "定性因果依据：基于哪些在场装备、伤势、地形、目击者、权限或人物立场作出此裁决，不写数字",
    ),
});
export type JudgeRuling = z.infer<typeof JudgeRulingSchema>;

/** 主动设备只响应玩家的明确使用意图；模型判断不能因危险擅自替玩家启动。 */
export function accelerationRequested(
  input: { text: string; sandevistan?: boolean | undefined },
  deviceName?: string,
): boolean {
  if (input.sandevistan === true) return true;
  const named = /斯安.{0,2}斯坦|远地点|飞隼|沙坦|时间加速|子弹时间|神经超频|加速义体/;
  return input.text.split(/[，。；！\n]/).some((clause) => {
    if (!named.test(clause) && !(deviceName && clause.includes(deviceName))) return false;
    if (
      /(?:不|别|没|未|不要|不用|无需|停止|关闭|关掉|取消|能否|是否|能不能|可以|如果|假如|曾经|上次|刚才)|[吗？?]/.test(
        clause,
      )
    )
      return false;
    return /开|启动|发动|激活|使用|用|借助|超频/.test(clause);
  });
}

/** ① 判断的格式，同时用于原生 JSON Schema 约束与说明生成；ruling 和 buy 另外逐条校验 */
export const JudgeDocSchema = z.object({
  read: z
    .string()
    .nullable()
    .describe("一句话说出你对玩家意图的理解，用“你想……”开头；场外提问写 null"),
  ooc: z
    .boolean()
    .describe("玩家跳出角色在场外提问（问规则、问可行性、问现状），不是让角色行动时写 true"),
  ruling: JudgeRulingSchema.nullable().describe(
    "平时日常对话、吃喝赶路、普通观察写 null；只有发生物理碰撞、潜入越界、黑客入侵、武装冲突或违背常识阻断时才给定性裁决",
  ),
  buy: BuyProposalSchema.nullable().describe(
    "玩家这一轮要掏钱买东西或买服务时写买什么，不写价钱；不花钱写 null",
  ),
  recall: z
    .array(z.string())
    .describe("从【可调的旧记忆】里原样抄这一轮用得上的标题，最多 3 条，按从旧到新排；没有写 []"),
  foes: z
    .string()
    .nullable()
    .describe(
      "在场的对手或防备你的人（敌人、安保、黑客、要应付或试探的人）这一轮打算干什么、会怎么反制玩家，一句话，只给写正文的一步看；没有对手写 null",
    ),
  sandevistan: z
    .boolean()
    .optional()
    .describe(
      "只有【当前状态】列有可用的「加速义体」时才可能写 true：当玩家明确要求开启/使用加速神经（含“开斯安威斯坦”“斯安慰斯坦”“远地点”“飞隼”“沙坦”“时间加速”“子弹时间”“神经超频”等），且是角色当前实际行动意图时写 true；不能因为危险替玩家自动开启；否则或未装/损坏/ooc 一律写 false",
    ),
});

const JudgeShapeSchema = z.object({
  read: z.string().nullable().optional().catch(undefined),
  ooc: z.boolean().optional().catch(undefined),
  ruling: z.unknown().optional(),
  buy: z.unknown().optional(),
  recall: z.array(z.unknown()).optional().catch(undefined),
  foes: z.string().nullable().optional().catch(undefined),
  sandevistan: z.boolean().optional().catch(undefined),
});
export type JudgeShape = z.infer<typeof JudgeShapeSchema>;

export type JudgeShapeResult =
  | { readonly ok: true; readonly judge: JudgeShape }
  | { readonly ok: false; readonly error: string };

export function readJudgeShape(value: unknown): JudgeShapeResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, error: "判断要是一个 JSON 对象" };
  }
  // 缺少关键控制字段不能按“没有风险/没有交易”处理，也不能把修复出的空对象当成功。
  if (
    !("ooc" in value) ||
    typeof value.ooc !== "boolean" ||
    !("ruling" in value) ||
    value.ruling === undefined ||
    !("buy" in value) ||
    value.buy === undefined
  ) {
    return { ok: false, error: "判断必须明确给出 ooc（布尔值）、ruling 和 buy（无则写 null）" };
  }
  const parsed = JudgeShapeSchema.safeParse(value);
  return parsed.success ? { ok: true, judge: parsed.data } : { ok: false, error: "字段类型不对" };
}

export const MAX_RECALL = 3;

export function rulingText(ruling: JudgeRuling): string {
  const lead =
    ruling.kind === "blocked"
      ? "【物理/现实阻断】这条路现在走不通"
      : ruling.kind === "costly"
        ? "【条件与代价】做得到，但有硬代价或冲突"
        : "【物理可行】条件到位，可以直接发生";
  const harm =
    ruling.harm === "none"
      ? "（无身体创伤）"
      : `（可能身体受损档位：${ruling.harm}${ruling.limb ? "，存在断肢风险" : ""}）`;
  return `${lead}${harm}：${ruling.outcome}（依据：${ruling.reason}）。按现实因果照写，不提数值和规则词。`;
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
  } else if (buy.item !== undefined && vehicleCatalog(data).has(buy.item)) {
    const car = vehicleCatalog(data).get(buy.item) as { name: string; price: number };
    label = car.name;
    base = car.price;
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

/** 一条旧记忆：标题给判断原样抄，正文给写正文；候选池和扩展层检索在 retrieve.ts */
export interface Memory {
  readonly title: string;
  readonly text: string;
}
