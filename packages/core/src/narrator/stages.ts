import { z } from "zod";
import type { WorldState } from "../kernel/world";
import type { NarratedPurchase } from "../systems/commerce/quotes";
import { quoteCyberware } from "../systems/cyberware/quote";
import { cyberwareSettlement, quoteCyberwareService } from "../systems/cyberware/service";
import { EconomyStateSchema, isBigSpend, ServiceSchema } from "../systems/economy/schema";
import { gunsmithSettlement, quoteGunsmith } from "../systems/inventory/gunsmith";
import { quoteTrade } from "../systems/inventory/trade";
import { vehicleCatalog } from "../systems/travel/vehicles";

/**
 * 一轮核心流程：① 判断（记忆调度与定性物理/社会裁决）→ ② 拼上下文 → ③ 写正文 → ④ 抽取。
 * 这里放 ① 的 JSON 结构、大额消费确认；定性物理硬约束校验在 pipeline.ts
 */

/** 判断只识别玩家明确授权的交易，价格由共同报价函数计算。 */
export const BuyProposalSchema = z
  .object({
    item: z.string().min(1).optional().describe("买卖物品写物品表里的 id，买车写车型 id"),
    action: z.enum(["buy", "sell"]).optional().describe("普通物品买入或卖出；不写时为 buy"),
    cyberware: z
      .string()
      .min(1)
      .optional()
      .describe("安装、拆卸或修理的义体 id；不与 item/service 同写"),
    with: z
      .string()
      .min(1)
      .optional()
      .describe("实际交易对方的商店/人物 id；义体服务写医生 id。不能因为在店里就猜第一家"),
    destination: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe("仅玩家明确先前往某处再成交时写目标地点 id；不能为了交易擅自补出行"),
    offer: z.string().min(1).optional().describe("沿用已谈妥报价时写报价 id"),
    operation: z.enum(["buy", "install", "remove", "repair", "repay"]).optional(),
    part: z
      .string()
      .min(1)
      .optional()
      .describe("已持有的未安装义体实物 ID，安装或维修自带件时填写"),
    disposition: z
      .enum(["keep", "sell", "scrap"])
      .optional()
      .describe("玩家授权的旧件去向：保留、出售、报废"),
    startAt: z
      .number()
      .int()
      .optional()
      .describe("本轮已确认的开始游戏分钟，由共同报价供给正文与抽取"),
    serviceOrder: z.string().min(1).optional().describe("义体服务订单 id；普通一次完成操作不填"),
    serviceAction: z.enum(["book", "start", "complete", "resume", "cancel"]).optional(),
    scheduledAt: z.number().int().optional().describe("预约开始游戏分钟，仅预约操作填写"),
    replace: z.string().min(1).optional().describe("玩家明确同意拆下的旧义体 id"),
    tradeIn: z.boolean().optional().describe("玩家明确同意出售旧件时才为 true"),
    credit: z.boolean().optional().describe("玩家明确申请赊账时才为 true"),
    service: ServiceSchema.optional().describe(
      "买服务写：meal 吃一顿，drink 一杯酒，lodging 住一晚，cab 打车，info 买情报，medical 街头诊所看伤，fine 交罚款，favor 打点",
    ),
    gunsmith: z
      .enum(["install", "detach", "tune", "convert"])
      .optional()
      .describe("枪匠工坊服务类型；不与 item/service/cyberware 同写"),
    weapon: z.string().min(1).optional().describe("枪匠工坊改装或精调的随身武器 id"),
    mod: z.string().min(1).optional().describe("枪匠工坊安装或拆除的改装件 id"),
    slot: z.enum(["muzzle", "scope", "plugin"]).optional().describe("枪匠工坊拆除或精工固锁的槽位"),
    source: z
      .enum(["shelf", "backpack"])
      .optional()
      .describe("枪匠安装改装件的来源：shelf 商店货架购买，backpack 玩家背包自带件"),
    lock: z.boolean().optional().describe("是否在安装时顺带由枪匠精工固锁该槽位"),
    conversion: z
      .enum(["smart-link", "precision-lock"])
      .optional()
      .describe("枪匠结构改造类型：smart-link 智能靶向联锁，precision-lock 槽位精工固锁"),
  })
  .refine(
    (b) =>
      [b.item, b.service, b.cyberware, b.gunsmith].filter((v) => v !== undefined).length ===
      (b.operation === "repay" || (b.serviceAction && b.serviceAction !== "book") ? 0 : 1),
    {
      message: "item、service、cyberware、gunsmith 写一个；还款只写 operation:repay 与 with",
    },
  )
  .refine((b) => b.action !== "sell" || b.item !== undefined, {
    message: "action:sell 仅用于普通物品；义体拆卸写 operation:remove",
  })
  .refine(
    (b) => b.operation === undefined || b.operation === "repay" || b.cyberware !== undefined,
    { message: "buy、install、remove、repair 需要指定 cyberware" },
  )
  .refine((b) => b.gunsmith === undefined || b.weapon !== undefined, {
    message: "枪匠工坊服务需要指定随身武器 weapon",
  })
  .refine((b) => (b.serviceAction !== undefined) === (b.serviceOrder !== undefined), {
    message: "服务订单操作必须同时给出 serviceOrder 与 serviceAction",
  });
export type BuyProposal = z.infer<typeof BuyProposalSchema>;

/** 一项代表一次单件交易；多笔或多件按玩家授权的实际顺序逐项列出。 */
export const TransactionIntentSchema = z.union([
  BuyProposalSchema,
  z.array(BuyProposalSchema).min(1),
]);
export type TransactionIntent = z.infer<typeof TransactionIntentSchema>;

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

/** 敌方网络黑客对玩家反制破解的独立裁决；没有敌方黑客反制时写 null */
export const CounterHackRulingSchema = z.object({
  outcome: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .describe("敌方黑客这次反制或快速破解的结果：穿过防线、被自我 ICE 挡下还是被切断链路"),
  harm: z
    .enum(["none", "graze", "heavy", "lethal"])
    .describe("敌方这次快速破解对玩家造成的真实神经伤害档位；被挡下或未受伤写 none"),
  reason: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .describe("基于双方接入仓档次、完好自我 ICE、链路距离与现场干扰的定性依据"),
});
export type CounterHackRuling = z.infer<typeof CounterHackRulingSchema>;

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
  counterHack: CounterHackRulingSchema.nullable()
    .optional()
    .describe(
      "仅当在场敌方网络黑客本轮对玩家发起攻击或控制破解时填写（独立裁决是否穿过自我 ICE 与造成的真实神经伤害）；没有敌方黑客反制时写 null",
    ),
  buy: TransactionIntentSchema.nullable().describe(
    "玩家明确授权买入、卖出、服务、安装、拆卸、维修或还款时填写；一笔写对象，多笔或多件按实际顺序逐件列数组，不写价钱。询价、砍价或未同意成交写 null",
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
  counterHack: z.unknown().optional(),
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

export function counterHackText(counterHack: CounterHackRuling): string {
  const harm =
    counterHack.harm === "none"
      ? "（未造成神经损伤）"
      : `（真实神经伤害档位：${counterHack.harm}）`;
  return `【敌方黑客反制】${harm}：${counterHack.outcome}（依据：${counterHack.reason}）。按此独立裁决写入正文与 npcHack，不改写玩家主行动裁决。`;
}

/** 要玩家先确认的大额花费 */
export interface BigSpend {
  readonly label: string;
  readonly price: number;
  /** 身上现有的欧元 */
  readonly eddies: number;
  /** 服务端绑定确认的具体交易与金额，不向界面新增字段。 */
  readonly quoteKey: string;
}

export type PurchaseQuote =
  | {
      readonly ok: true;
      readonly label: string;
      readonly price: number;
      readonly quoteKey: string;
      readonly detail: string;
      readonly settlement?: NarratedPurchase;
    }
  | { readonly ok: false; readonly reason: string };

/** 与货架和成交共用报价；只读，不因查询价格而交付、扣款或消费报价。 */
export function purchaseQuote(
  world: WorldState,
  data: Readonly<Record<string, unknown>>,
  buy: BuyProposal,
): PurchaseQuote {
  if (buy.serviceAction && buy.serviceOrder) {
    const request =
      buy.serviceAction === "book" && buy.with
        ? {
            action: buy.operation ?? "install",
            doc: buy.with,
            id: buy.cyberware,
            part: buy.part,
            replace: buy.replace,
            disposition: buy.disposition,
            tradeIn: buy.tradeIn,
            credit: buy.credit,
            offer: buy.offer,
          }
        : undefined;
    const result = quoteCyberwareService(world, data, {
      action: buy.serviceAction,
      id: buy.serviceOrder,
      request,
      scheduledAt: buy.scheduledAt,
      startAt: buy.startAt,
    });
    if (!result.ok) return result;
    return {
      ok: true,
      label: result.quote?.name ?? `义体服务 ${buy.serviceOrder}`,
      price: result.price,
      detail: result.detail,
      settlement: result.settlement,
      quoteKey: JSON.stringify(["cyberware.service", result.settlement, buy.destination]),
    };
  }
  if (buy.cyberware !== undefined || buy.operation === "repay") {
    if (!buy.with) return { ok: false, reason: "义体交易需要明确医生" };
    const result = quoteCyberware(world, data, {
      action: buy.operation ?? "install",
      doc: buy.with,
      id: buy.cyberware,
      replace: buy.replace,
      tradeIn: buy.tradeIn,
      credit: buy.credit,
      offer: buy.offer,
      part: buy.part,
      disposition: buy.disposition,
      startAt: buy.startAt,
    });
    if (!result.ok) return result;
    const q = result.quote;
    if (q.blocked) return { ok: false, reason: q.blocked };
    return {
      ok: true,
      label: q.name,
      price: q.cash,
      quoteKey: JSON.stringify([
        "cyberware",
        q.doc,
        q.action,
        q.id,
        q.price,
        q.tradeIn,
        q.total,
        q.cash,
        q.credit,
        q.receive,
        q.replaces?.id,
        buy.tradeIn === true,
        buy.credit === true,
        q.offer,
        buy.destination,
        q.part,
        q.disposition,
        q.providerId,
        q.startsAt,
        q.endsAt,
        q.stockRevision,
        q.debtDue,
      ]),
      detail: `${q.docName} ${q.name}：${q.action === "remove" && q.disposition === "sell" ? `经玩家明确授权拆卸回收，玩家所得 ${q.receive} 欧元` : `应付 ${q.total} 欧元，本次现金 ${q.cash}${q.credit ? `、赊欠 ${q.credit}` : ""}`}${q.replaces ? `；已授权旧件 ${q.replaces.name} 去向 ${q.disposition}` : ""}${q.part ? `；自带实物 ${q.part}` : ""}${q.offer ? `；报价 ${q.offer}` : ""}；服务人员 ${q.provider}；起止 ${q.startsAt}—${q.endsAt}，正文使用此时刻，不能再次累加耗时`,
      settlement: cyberwareSettlement(q, {
        action: q.action,
        doc: q.doc,
        replace: buy.replace,
        credit: buy.credit,
      }),
    };
  }
  if (buy.gunsmith !== undefined) {
    if (!buy.with) return { ok: false, reason: "枪匠服务需要明确商店" };
    if (!buy.weapon) return { ok: false, reason: "枪匠服务需要明确随身武器" };
    const result = quoteGunsmith(world, data, {
      shop: buy.with,
      action: buy.gunsmith,
      weapon: buy.weapon,
      mod: buy.mod,
      slot: buy.slot,
      source: buy.source,
      replace: buy.replace,
      lock: buy.lock,
      conversion: buy.conversion,
      offer: buy.offer,
    });
    if (!result.ok) return result;
    const q = result.quote;
    if (q.blocked) return { ok: false, reason: q.blocked };
    return {
      ok: true,
      label: q.label,
      price: q.total,
      quoteKey: JSON.stringify([
        "gunsmith",
        q.shop,
        q.action,
        q.weapon,
        q.mod,
        q.slot,
        q.source,
        q.replaces?.id,
        q.lock,
        q.conversion,
        q.tunedRarity,
        q.total,
        q.offer,
        buy.destination,
      ]),
      detail: `${q.shopName} ${q.label}：应付 ${q.total} 欧元（配件费 ${q.partsFee}，工时费 ${q.serviceFee}）${q.replaces ? `；换下 ${q.replaces.name} 退回背包` : ""}${q.offer ? `；报价 ${q.offer}` : ""}`,
      settlement: gunsmithSettlement(q),
    };
  }
  if (buy.item !== undefined && vehicleCatalog(data).has(buy.item)) {
    if (buy.action === "sell") return { ok: false, reason: "车辆出售尚未实现，不能按购车结算" };
    const car = vehicleCatalog(data).get(buy.item) as { name: string; price: number };
    const price = car.price;
    return {
      ok: true,
      label: car.name,
      price,
      quoteKey: JSON.stringify(["vehicle", "buy", buy.item, price, buy.destination]),
      detail: `${car.name}：${price} 欧元`,
    };
  }
  if (!buy.with)
    return { ok: false, reason: "交易对方尚未确定；先询价，不能直接付款或凭目录取得商品" };
  const action = buy.service ? "service" : (buy.action ?? "buy");
  const q = quoteTrade(world, data, {
    action,
    item: buy.item,
    service: buy.service,
    with: buy.with,
    offer: buy.offer,
  });
  if (!q.ok) return q;
  return {
    ok: true,
    label: q.label,
    price: action === "sell" ? 0 : q.price,
    quoteKey: JSON.stringify([
      buy.service ? "service" : "item",
      action,
      q.counterparty,
      buy.service ?? buy.item,
      q.price,
      q.quote?.id,
      buy.destination,
    ]),
    detail: `${q.party.name} ${q.label}：${action === "sell" ? "卖出后玩家所得" : "最终对价"} ${q.price} 欧元${q.left !== undefined ? `；现货 ${q.left}` : ""}${q.quote ? `；报价 ${q.quote.id}` : ""}`,
    settlement: {
      seller: q.counterparty,
      kind: buy.service ? "service" : "item",
      action,
      target: buy.service ?? buy.item ?? "",
      price: q.price,
    },
  };
}

/** 一次花掉超过存款一半且超过 1,000 欧元时返回；查不到价钱、不卖的东西不拦，交给结算 */
export function bigSpend(
  world: WorldState,
  data: Readonly<Record<string, unknown>>,
  buy: BuyProposal,
): BigSpend | undefined {
  const { eddies } = EconomyStateSchema.parse(world.slices.economy);
  const quote = purchaseQuote(world, data, buy);
  return quote.ok && isBigSpend(quote.price, eddies)
    ? { label: quote.label, price: quote.price, eddies, quoteKey: quote.quoteKey }
    : undefined;
}

/** 一条旧记忆：标题给判断原样抄，正文给写正文；候选池和扩展层检索在 retrieve.ts */
export interface Memory {
  readonly title: string;
  readonly text: string;
}
