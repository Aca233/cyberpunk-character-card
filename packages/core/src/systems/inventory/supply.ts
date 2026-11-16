import type { Draft } from "immer";
import type { ApplyOutcome, SystemContext } from "../../kernel/system";
import { tradeEvidence } from "../commerce";
import { type LogisticsState, routeBlocked } from "../logistics";
import { formatGameTime, merchantAt, type WorldClockState } from "../world";
import { itemCatalog, shopList, stockOf } from "./apply";
import { ensureMerchant, shopUnavailable } from "./merchants";
import type { InventoryState, ItemDef, Shop, ShopOrderCommand, SupplyOrder } from "./schema";

function createOrder(
  draft: Draft<InventoryState>,
  id: string,
  shop: Shop,
  item: string,
  quantity: number,
  now: number,
  requestedBy: SupplyOrder["requestedBy"],
): void {
  const supply = shop.supply;
  if (!supply) return;
  draft.supplyOrders[id] = {
    id,
    shop: shop.id,
    item,
    quantity,
    supplier: supply.supplier,
    origin: supply.origin,
    route: [...supply.route],
    createdAt: now,
    dueAt: now + supply.leadMinutes,
    status: "pending",
    remainingMinutes: supply.leadMinutes,
    delayReason: null,
    requestedBy,
    uncollected: requestedBy === "player" ? quantity : 0,
    deliveredAt: null,
    cancelReason: null,
  };
}

/** 只为真实供货关系的已售缺口下单，已有在途货不重复订；独立实物不能批量复制。 */
export function replenishAfterSale(
  draft: Draft<InventoryState>,
  shop: Shop,
  def: ItemDef,
  now: number,
  routes: LogisticsState,
): void {
  const merchant = draft.merchants[shop.id];
  if (
    !merchant ||
    !shop.supply ||
    draft.objects[def.id] ||
    !(shop.supply.items ?? shop.shelf).includes(def.id)
  )
    return;
  const incoming = Object.values(draft.supplyOrders)
    .filter(
      (o) =>
        o.shop === shop.id &&
        o.item === def.id &&
        (o.status === "pending" || o.status === "delayed"),
    )
    .reduce((n, o) => n + o.quantity, 0);
  const target = shop.initialStock?.[def.id] ?? stockOf(def);
  const missing = target - (merchant.stock[def.id] ?? 0) - incoming;
  if (missing <= 0) return;
  let id: string;
  do {
    id = `supply:${shop.id}:${draft.nextSupply++}`;
  } while (draft.supplyOrders[id]);
  createOrder(draft, id, shop, def.id, missing, now, "store");
  progressSupplies(draft, now, routes);
}

/** 封锁变化会立即暂停/恢复剩余路程；时间只完成已经存在的订单，不重新抽货。 */
export function progressSupplies(
  draft: Draft<InventoryState>,
  now: number,
  routes: LogisticsState,
): void {
  for (const order of Object.values(draft.supplyOrders)) {
    if (order.status !== "pending" && order.status !== "delayed") continue;
    const blocked = routeBlocked(routes, order.route);
    if (blocked && (order.status === "delayed" || blocked.at <= order.dueAt)) {
      if (order.status === "pending")
        order.remainingMinutes = Math.max(1, order.dueAt - Math.max(order.createdAt, blocked.at));
      order.status = "delayed";
      order.delayReason = `${blocked.location}：${blocked.reason}`;
      continue;
    }
    if (order.status === "delayed") {
      order.status = "pending";
      order.dueAt = now + Math.max(1, order.remainingMinutes);
      order.delayReason = null;
      continue;
    }
    order.remainingMinutes = Math.max(0, order.dueAt - now);
    if (order.dueAt > now) continue;
    const merchant = draft.merchants[order.shop];
    if (!merchant) continue;
    // 若同名模板后来被确认为独立实物，不让供货把它复制出来。
    if (draft.objects[order.item]) {
      order.status = "cancelled";
      order.cancelReason = "该物件已登记为独立实物，批量供货条件不成立";
      continue;
    }
    merchant.stock[order.item] = (merchant.stock[order.item] ?? 0) + order.quantity;
    order.status = "delivered";
    order.deliveredAt = order.dueAt;
    order.remainingMinutes = 0;
  }
}

export function collectOrderedItem(draft: Draft<InventoryState>, shop: string, item: string): void {
  const waiting = Object.values(draft.supplyOrders).find(
    (o) =>
      o.shop === shop &&
      o.item === item &&
      o.status === "delivered" &&
      o.requestedBy === "player" &&
      o.uncollected > 0,
  );
  if (waiting) waiting.uncollected -= 1;
}

export function applyShopOrder(
  draft: Draft<InventoryState>,
  command: ShopOrderCommand,
  ctx: SystemContext,
): ApplyOutcome {
  if (!tradeEvidence(ctx.facts, command.evidence))
    return { ok: false, reason: "订货或取消缺少店方实际同意的证据" };
  const shop = shopList(ctx.data).find((s) => s.id === command.shop);
  if (!shop) return { ok: false, reason: "没有这家经营场所" };
  const location = ctx.read<WorldClockState>("world").location;
  if (!location || !merchantAt(ctx.data, shop.id, shop.location, location))
    return { ok: false, reason: "尚未在这家店落实订货条件" };
  const existing = draft.supplyOrders[command.id];
  if (command.action === "cancel") {
    if (!existing || existing.shop !== shop.id || existing.requestedBy !== "player")
      return { ok: false, reason: "没有这笔玩家订货" };
    if (
      existing.status === "cancelled" ||
      (existing.status === "delivered" && existing.uncollected === 0)
    )
      return { ok: false, reason: "订单已取消或已经取完，不能重复取消" };
    existing.status = "cancelled";
    existing.cancelReason = command.evidence;
    existing.uncollected = 0;
    return {
      ok: true,
      notes: ["店方已同意取消；未预收货款，不生成退款；已经到店的实物仍留在店里"],
    };
  }
  if (existing) return { ok: false, reason: "订货 id 已存在，不能重复下单" };
  if (!command.item || !command.quantity) return { ok: false, reason: "订货需要明确商品与数量" };
  const supply = shop.supply;
  if (!supply || !(supply.items ?? shop.shelf).includes(command.item))
    return { ok: false, reason: "这家店没有该商品的已知供货关系，不能承诺凭空到货" };
  const catalog = itemCatalog(ctx.data);
  if (!catalog.has(command.item) || draft.objects[command.item])
    return { ok: false, reason: "这不是可按现有合同订购的普通商品" };
  const world = { time: ctx.now, slices: { npc: ctx.read("npc") } };
  const unavailable = shopUnavailable(world, shop, ctx.data);
  if (unavailable) return { ok: false, reason: unavailable };
  const merchant = ensureMerchant(draft, shop, catalog, ctx.now);
  if (!merchant.open) return { ok: false, reason: merchant.closureReason ?? "商店当前停业" };
  createOrder(
    draft,
    command.id,
    merchant.definition,
    command.item,
    command.quantity,
    ctx.now,
    "player",
  );
  progressSupplies(draft, ctx.now, ctx.read<LogisticsState>("logistics"));
  return {
    ok: true,
    notes: ["店方接受订货，货源与运输条件已保存；到货后按实际报价付款取货，当前未扣款"],
  };
}

export function supplyOrderLines(state: InventoryState, shopIds?: ReadonlySet<string>): string[] {
  return Object.values(state.supplyOrders)
    .filter(
      (o) =>
        (!shopIds || shopIds.has(o.shop)) &&
        (o.status === "pending" ||
          o.status === "delayed" ||
          (o.status === "delivered" && o.uncollected > 0)),
    )
    .map(
      (o) =>
        `${o.id} ${o.shop}：${o.item}×${o.quantity}，供货方 ${o.supplier}，来源 ${o.origin}；${o.status === "delayed" ? `运输受阻：${o.delayReason}` : o.status === "delivered" ? `已到店，玩家尚有 ${o.uncollected} 件未付款取走` : `预计 ${formatGameTime(o.dueAt)} 到店`}；路径 ${o.route.join(" → ")}`,
    );
}
