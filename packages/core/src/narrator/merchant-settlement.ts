import type { ApplyBatchResult, ApplyContext, Command } from "../kernel/system";
import type { WorldState } from "../kernel/world";
import { EconomyStateSchema, isBigSpend } from "../systems/economy/schema";
import { registry } from "../systems/registry";
import { autoMove, tripFact, tripWorldOf } from "../systems/travel";
import { formatGameTime, WorldClockStateSchema, withSavedPlaces } from "../systems/world";
import {
  type BigSpend,
  type BuyProposal,
  BuyProposalSchema,
  type PurchaseQuote,
  purchaseQuote,
  type TransactionIntent,
} from "./stages";

export interface PreparedPurchase {
  readonly proposal: BuyProposal;
  readonly quote: PurchaseQuote;
  readonly journey?: string;
}

function purchaseCommand(p: BuyProposal, q: PurchaseQuote): Command {
  const reason = "已授权交易的只读核验";
  if (p.serviceOrder && p.serviceAction)
    return {
      type: "cyberware.service",
      action: p.serviceAction,
      id: p.serviceOrder,
      request:
        p.serviceAction === "book"
          ? {
              action: p.operation ?? "install",
              doc: p.with,
              id: p.cyberware,
              part: p.part,
              replace: p.replace,
              disposition: p.disposition,
              tradeIn: p.tradeIn,
              credit: p.credit,
              offer: p.offer,
            }
          : undefined,
      scheduledAt: p.scheduledAt,
      startAt: p.startAt,
      reason,
      evidence: reason,
    };
  if (p.cyberware !== undefined || p.operation === "repay")
    return {
      type: "cyberware",
      action: p.operation ?? "install",
      doc: p.with,
      id: p.cyberware,
      replace: p.replace,
      tradeIn: p.tradeIn,
      credit: p.credit,
      offer: p.offer,
      part: p.part,
      disposition: p.disposition,
      startAt: p.startAt,
      reason,
    };
  if (q.ok && !q.settlement) return { type: "vehicle", action: "buy", model: p.item, reason };
  return {
    type: "trade",
    action: p.service ? "service" : (p.action ?? "buy"),
    item: p.item,
    service: p.service,
    with: p.with,
    offer: p.offer,
    reason,
  };
}

/** 仅在玩家明确要先到某处时预看抵达状态，真正移动仍须正文与抽取落地。 */
function atDestination(
  world: WorldState,
  data: Readonly<Record<string, unknown>>,
  raw: string,
): WorldState {
  return applyMovement(
    world,
    { type: "world", location: raw, activity: "travel" },
    {
      rng: { roll: () => 1 },
      data,
    },
  ).world;
}

/** 按指令原有先后移动，不能把第二家店的出行挪到第一笔交易之前。 */
function applyMovement(world: WorldState, command: Command, ctx: ApplyContext): ApplyBatchResult {
  if (command.type !== "world" || typeof command.location !== "string")
    return registry.applyCommands(world, [command], ctx);
  // 首访 poi: 也先在临时状态解析地点；不能只认识已经存过档的地点。
  const located = registry.applyCommands(world, [{ ...command, time: world.time }], ctx);
  if (!located.results[0]?.result.ok) return located;
  const target = WorldClockStateSchema.parse(located.world.slices.world).location;
  if (!target) return registry.applyCommands(world, [command], ctx);
  const data = withSavedPlaces(ctx.data ?? {}, located.world);
  const move = autoMove(tripWorldOf(world), data, target);
  if (move.kind === "none") return registry.applyCommands(world, [command], ctx);
  const statedAt = typeof command.time === "number" ? command.time : world.time;
  if (move.kind === "near")
    return registry.applyCommands(
      world,
      [
        {
          ...command,
          time: Math.max(statedAt, world.time + move.minutes),
        },
      ],
      ctx,
    );
  const travel = registry.applyCommands(
    world,
    [{ type: "travel", to: target, mode: move.trip.route.mode }],
    {
      ...ctx,
      data,
      facts: { ...ctx.facts, travel: tripFact(move.trip) },
    },
  );
  if (!travel.results[0]?.result.ok)
    return { ...travel, results: travel.results.map((r) => ({ ...r, command })) };
  // 用原始地点数据登记首访地点，再保留正文描述的额外经过时间。
  const arrival = registry.applyCommands(
    travel.world,
    [{ ...command, time: Math.max(statedAt, travel.world.time) }],
    ctx,
  );
  if (!arrival.results[0]?.result.ok) return { world, patches: [], results: arrival.results };
  return {
    world: arrival.world,
    patches: [...travel.patches, ...arrival.patches],
    results: [...travel.results, ...arrival.results],
  };
}

/** 在临时状态里依次核对库存、钱包和义体槽；不会写日志、调用模型或消耗正式随机流。 */
export function preparePurchases(
  world: WorldState,
  data: Readonly<Record<string, unknown>>,
  intent: TransactionIntent | undefined,
): {
  purchases: PreparedPurchase[];
  spend: BigSpend | undefined;
  confirmation: BigSpend | undefined;
} {
  let preview = world;
  const purchases: PreparedPurchase[] = [];
  let eddies = EconomyStateSchema.parse(world.slices.economy).eddies;
  for (const proposal of intent === undefined ? [] : Array.isArray(intent) ? intent : [intent]) {
    let journey: string | undefined;
    if (proposal.destination) {
      const before = preview;
      preview = atDestination(preview, data, proposal.destination);
      if (
        WorldClockStateSchema.parse(before.slices.world).location !==
        WorldClockStateSchema.parse(preview.slices.world).location
      ) {
        const cost =
          EconomyStateSchema.parse(before.slices.economy).eddies -
          EconomyStateSchema.parse(preview.slices.economy).eddies;
        journey = `先前往 ${proposal.destination}，出行耗时 ${preview.time - before.time} 分钟，路费 ${cost} 欧元，抵达 ${formatGameTime(preview.time)}。下列交易已按抵达后的余额核对；到达与路费由出行统一结算，不再另列扣款。`;
      }
    }
    if (purchases.length === 0) eddies = EconomyStateSchema.parse(preview.slices.economy).eddies;
    let quote: PurchaseQuote =
      proposal.startAt !== undefined &&
      proposal.startAt < preview.time &&
      (!proposal.serviceAction || ["book", "start", "resume"].includes(proposal.serviceAction))
        ? { ok: false, reason: "开始时间不能早于本轮实际可开始时刻；过去的手术只能按已有订单完成" }
        : purchaseQuote(preview, data, proposal);
    if (quote.ok) {
      const trial = registry.applyCommands(preview, [purchaseCommand(proposal, quote)], {
        rng: { roll: () => 1 },
        data,
        facts: { tradeNarrative: "已授权交易的只读核验", tradeQuote: quote.settlement },
      });
      const failure = trial.results.find((r) => !r.result.ok)?.result;
      if (failure && !failure.ok) quote = { ok: false, reason: failure.reason };
      else preview = trial.world;
    }
    purchases.push({ proposal, quote, ...(journey ? { journey } : {}) });
  }
  const valid = purchases.flatMap(({ quote }) => (quote.ok ? [quote] : []));
  const price = valid.reduce((total, q) => total + q.price, 0);
  const first = valid[0];
  const confirmation = first
    ? {
        label: valid.map((q) => q.label).join("、"),
        price,
        eddies,
        quoteKey:
          valid.length === 1 ? first.quoteKey : JSON.stringify(valid.map((q) => q.quoteKey)),
      }
    : undefined;
  // 是否负担得起已逐笔核对；先卖后买可能使总支出超过回合起始现金，仍需确认。
  const large = isBigSpend(price, eddies) || (price > eddies && isBigSpend(price, price));
  return { purchases, confirmation, spend: confirmation && large ? confirmation : undefined };
}

function commandProposal(command: Command): BuyProposal | undefined {
  const raw =
    command.type === "trade"
      ? { ...command, action: command.action === "service" ? undefined : command.action }
      : command.type === "cyberware"
        ? {
            ...command,
            action: undefined,
            operation: command.action,
            cyberware: command.id,
            with: command.doc,
          }
        : command.type === "cyberware.service" && command.action !== "interrupt"
          ? {
              ...(typeof command.request === "object" && command.request !== null
                ? command.request
                : {}),
              action: undefined,
              operation: (command.request as Record<string, unknown> | undefined)?.action,
              cyberware: (command.request as Record<string, unknown> | undefined)?.id,
              with: (command.request as Record<string, unknown> | undefined)?.doc,
              serviceOrder: command.id,
              serviceAction: command.action,
              scheduledAt: command.scheduledAt,
              startAt: command.startAt,
            }
          : command.type === "vehicle" && command.action === "buy"
            ? { item: command.model }
            : undefined;
  if (!raw) return undefined;
  const parsed = BuyProposalSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

/** 交易自己交付钱货；同事件单列同物件或同金额的条目不能再执行一次。 */
function duplicateSettlement(
  command: Command,
  purchases: readonly PreparedPurchase[],
  commands: readonly Command[],
): boolean {
  const targets = new Set(
    purchases.flatMap(({ proposal }) =>
      proposal.item ? [`${proposal.action === "sell" ? "lose" : "gain"}:${proposal.item}`] : [],
    ),
  );
  for (const c of commands)
    if (c.type === "trade" && typeof c.item === "string")
      targets.add(`${c.action === "sell" ? "lose" : "gain"}:${c.item}`);
  if (command.type === "item" && (command.action === "gain" || command.action === "lose"))
    return typeof command.id === "string" && targets.has(`${command.action}:${command.id}`);
  if (command.type !== "money" || typeof command.delta !== "number") return false;
  const deltas = purchases.flatMap(({ quote }) => {
    if (!quote.ok) return [];
    const settlement = quote.settlement;
    return [
      settlement && (settlement.action === "sell" || settlement.action === "remove")
        ? settlement.price
        : -quote.price,
    ];
  });
  return (
    deltas.includes(command.delta) ||
    (deltas.length > 1 && deltas.reduce((a, b) => a + b, 0) === command.delta)
  );
}

export interface MerchantBatchResult extends ApplyBatchResult {
  readonly remaining: readonly number[];
  readonly failure?: string;
}

/** 单事件试算：首失败整组撤销；授权游标由调用方仅在提交事件时接收。 */
export function applyMerchantCommands(
  world: WorldState,
  commands: readonly Command[],
  ctx: ApplyContext,
  purchases: readonly PreparedPurchase[],
  available: readonly number[] = purchases.map((_, index) => index),
): MerchantBatchResult {
  let current = world;
  const patches: ApplyBatchResult["patches"][number][] = [];
  const results: ApplyBatchResult["results"][number][] = [];
  const remaining = [...available];
  const paired: PreparedPurchase[] = [];
  const rollback = (failedAt: number, reason: string): MerchantBatchResult => ({
    world,
    patches: [],
    remaining: available,
    failure: reason,
    results: commands.map((command, index) => ({
      command,
      result: {
        ok: false,
        reason:
          index === failedAt
            ? reason
            : index < failedAt
              ? `同一事件结算失败，已撤销本条：${reason}`
              : `同一事件前置步骤失败，本条未执行：${reason}`,
      },
    })),
  });
  for (const [commandIndex, command] of commands.entries()) {
    let executable = command;
    let reason: string | undefined;
    let facts = ctx.facts ?? {};
    let authorized = -1;
    const proposal = commandProposal(command);
    if (duplicateSettlement(command, paired, commands)) {
      reason = "交易已统一处理钱货，不能另列相同物件或金额重复结算";
    } else if (proposal) {
      // 在真实执行位置重报价，不能因预看了目的地就隔空拿货，也不能临时换价或借款。
      for (const [i, purchaseIndex] of remaining.entries()) {
        const candidate = purchases[purchaseIndex];
        if (!candidate?.quote.ok) continue;
        const actual = purchaseQuote(current, ctx.data ?? {}, {
          ...proposal,
          destination: candidate.proposal.destination,
          startAt: proposal.startAt ?? candidate.quote.settlement?.startsAt,
        });
        if (actual.ok && actual.quoteKey === candidate.quote.quoteKey) {
          authorized = i;
          if (
            (command.type === "cyberware" || command.type === "cyberware.service") &&
            command.startAt === undefined
          )
            executable = { ...command, startAt: actual.settlement?.startsAt };
          break;
        }
      }
      const chosenIndex = remaining[authorized];
      const chosen = chosenIndex === undefined ? undefined : purchases[chosenIndex]?.quote;
      if (!chosen?.ok) {
        const actual = purchaseQuote(current, ctx.data ?? {}, proposal);
        reason = !actual.ok
          ? actual.reason
          : "成交对象、金额或次数未经本轮确认，不能重复成交或改变条款";
      } else facts = { ...ctx.facts, tradeQuote: chosen.settlement };
    }
    if (reason) {
      return rollback(commandIndex, reason);
    }
    const applied = applyMovement(current, executable, { ...ctx, facts });
    const failure = applied.results.find(({ result }) => !result.ok)?.result;
    if (failure && !failure.ok) return rollback(commandIndex, failure.reason);
    current = applied.world;
    patches.push(...applied.patches);
    results.push(...applied.results);
    if (authorized >= 0 && applied.results[0]?.result.ok) {
      const used = remaining.splice(authorized, 1)[0];
      const purchase = used === undefined ? undefined : purchases[used];
      if (purchase) paired.push(purchase);
    }
  }
  // 显式重复扣款也可能写在成交之前；仅核对本事件真正配对的授权，不跨事件按金额猜因果。
  const duplicate = commands.findIndex((command) => duplicateSettlement(command, paired, commands));
  if (duplicate >= 0)
    return rollback(duplicate, "交易已统一处理钱货，不能另列相同物件或金额重复结算");
  return { world: current, patches, results, remaining };
}
