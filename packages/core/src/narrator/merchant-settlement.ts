import type { ApplyBatchResult, ApplyContext, Command } from "../kernel/system";
import type { WorldState } from "../kernel/world";
import { EconomyStateSchema, isBigSpend } from "../systems/economy/schema";
import { registry } from "../systems/registry";
import { autoMove, tripFact, tripWorldOf } from "../systems/travel";
import { locationCatalog, WorldClockStateSchema, withSavedPlaces } from "../systems/world";
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
}

function purchaseCommand(p: BuyProposal, q: PurchaseQuote): Command {
  const reason = "已授权交易的只读核验";
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
  const places = withSavedPlaces(data, world);
  const catalog = locationCatalog(places);
  const to = catalog.get(raw) ?? [...catalog.values()].find((p) => p.name === raw);
  if (!to || WorldClockStateSchema.parse(world.slices.world).location === to.id) return world;
  const move = autoMove(tripWorldOf(world), places, to.id);
  const ctx: ApplyContext = { rng: { roll: () => 1 }, data: places };
  if (move.kind === "trip")
    return registry.applyCommands(
      world,
      [{ type: "travel", to: to.id, mode: move.trip.route.mode }],
      {
        ...ctx,
        facts: { travel: tripFact(move.trip) },
      },
    ).world;
  return registry.applyCommands(
    world,
    [
      {
        type: "world",
        location: to.id,
        activity: "travel",
        time: world.time + (move.kind === "near" ? move.minutes : 0),
      },
    ],
    ctx,
  ).world;
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
    if (proposal.destination) preview = atDestination(preview, data, proposal.destination);
    if (purchases.length === 0) eddies = EconomyStateSchema.parse(preview.slices.economy).eddies;
    let quote = purchaseQuote(preview, data, proposal);
    if (quote.ok) {
      const trial = registry.applyCommands(preview, [purchaseCommand(proposal, quote)], {
        rng: { roll: () => 1 },
        data,
      });
      const failure = trial.results.find((r) => !r.result.ok)?.result;
      if (failure && !failure.ok) quote = { ok: false, reason: failure.reason };
      else preview = trial.world;
    }
    purchases.push({ proposal, quote });
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
        : command.type === "vehicle" && command.action === "buy"
          ? { item: command.model }
          : undefined;
  if (!raw) return undefined;
  const parsed = BuyProposalSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

/** 交易自己交付钱货；同轮单列同物件或同金额的条目不能再执行一次。 */
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

/** 授权只供一次成功成交消费；重算/回滚从头配对，不在共享 facts 上保存可变计数。 */
export function applyMerchantCommands(
  world: WorldState,
  commands: readonly Command[],
  ctx: ApplyContext,
  purchases: readonly PreparedPurchase[],
): ApplyBatchResult {
  let current = world;
  const patches: ApplyBatchResult["patches"][number][] = [];
  const results: ApplyBatchResult["results"][number][] = [];
  const remaining = [...purchases];
  for (const command of commands) {
    let reason: string | undefined;
    let facts = ctx.facts ?? {};
    let authorized = -1;
    const proposal = commandProposal(command);
    if (duplicateSettlement(command, purchases, commands)) {
      reason = "交易已统一处理钱货，不能另列相同物件或金额重复结算";
    } else if (proposal) {
      // 在真实执行位置重报价，不能因预看了目的地就隔空拿货，也不能临时换价或借款。
      for (const [i, candidate] of remaining.entries()) {
        if (!candidate.quote.ok) continue;
        const actual = purchaseQuote(current, ctx.data ?? {}, {
          ...proposal,
          destination: candidate.proposal.destination,
        });
        if (actual.ok && actual.quoteKey === candidate.quote.quoteKey) {
          authorized = i;
          break;
        }
      }
      const chosen = remaining[authorized]?.quote;
      if (!chosen?.ok) {
        const actual = purchaseQuote(current, ctx.data ?? {}, proposal);
        reason = !actual.ok
          ? actual.reason
          : "成交对象、金额或次数未经本轮确认，不能重复成交或改变条款";
      } else facts = { ...ctx.facts, tradeQuote: chosen.settlement };
    }
    if (reason) {
      results.push({ command, result: { ok: false, reason } });
      continue;
    }
    const applied = registry.applyCommands(current, [command], { ...ctx, facts });
    current = applied.world;
    patches.push(...applied.patches);
    results.push(...applied.results);
    if (authorized >= 0 && applied.results[0]?.result.ok) remaining.splice(authorized, 1);
  }
  return { world: current, patches, results };
}
