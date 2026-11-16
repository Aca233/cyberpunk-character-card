import type { Draft } from "immer";
import type { ApplyOutcome, SystemContext } from "../../kernel/system";
import { tradeEvidence } from "../commerce";
import type { NpcState } from "../npc";
import { merchantAt, type WorldClockState } from "../world";
import { itemCatalog, shopList, stockOf } from "./apply";
import type { InventoryState, ItemDef, MerchantState, Shop, ShopBusinessCommand } from "./schema";

/** 初次展开只有确定的开局货源；以后读取已保存的身份、营业状态和现货。 */
export function merchantState(
  inventory: InventoryState,
  shop: Shop,
  catalog: ReadonlyMap<string, ItemDef>,
  now: number,
): MerchantState {
  return (
    inventory.merchants[shop.id] ?? {
      definition: shop,
      initializedAt: now,
      stock: Object.fromEntries(
        shop.shelf.flatMap((id) => {
          const def = catalog.get(id);
          return def ? [[id, shop.initialStock?.[id] ?? stockOf(def)]] : [];
        }),
      ),
      open: true,
      closureReason: null,
    }
  );
}

export function ensureMerchant(
  draft: Draft<InventoryState>,
  shop: Shop,
  catalog: ReadonlyMap<string, ItemDef>,
  now: number,
): Draft<MerchantState> {
  if (!draft.merchants[shop.id])
    draft.merchants[shop.id] = merchantState(draft, shop, catalog, now);
  return draft.merchants[shop.id] as Draft<MerchantState>;
}

const savedTables = new WeakMap<object, WeakMap<object, Readonly<Record<string, unknown>>>>();
export function withMerchants(
  data: Readonly<Record<string, unknown>>,
  merchants: InventoryState["merchants"],
): Readonly<Record<string, unknown>> {
  if (Object.keys(merchants).length === 0) return data;
  let tables = savedTables.get(merchants);
  if (!tables) {
    tables = new WeakMap();
    savedTables.set(merchants, tables);
  }
  const cached = tables.get(data);
  if (cached) return cached;
  const base = shopList(data);
  const known = new Set(base.map((s) => s.id));
  const shops = [
    ...base.map((s) => merchants[s.id]?.definition ?? s),
    ...Object.values(merchants)
      .filter((m) => !known.has(m.definition.id))
      .map((m) => m.definition),
  ];
  const result = { ...data, shops };
  tables.set(data, result);
  return result;
}

export function visitMerchants(draft: Draft<InventoryState>, ctx: SystemContext): void {
  const location = ctx.read<WorldClockState>("world").location;
  if (!location || ctx.data.items === undefined) return;
  const catalog = itemCatalog(ctx.data);
  for (const shop of shopList(ctx.data)) {
    if (merchantAt(ctx.data, shop.id, shop.location, location))
      ensureMerchant(draft, shop, catalog, ctx.now);
  }
}

export function applyShopBusiness(
  draft: Draft<InventoryState>,
  command: ShopBusinessCommand,
  ctx: SystemContext,
): ApplyOutcome {
  if (!tradeEvidence(ctx.facts, command.evidence))
    return { ok: false, reason: "营业变化缺少本轮实际证据" };
  const shop = shopList(ctx.data).find((s) => s.id === command.shop);
  if (!shop) return { ok: false, reason: "尚未登记这家经营场所" };
  if (command.action === "staff") {
    if (command.keeperNpc === undefined && command.serviceNpcs === undefined)
      return { ok: false, reason: "人员接替需要明确新人员" };
    const people = ctx.read<NpcState>("npc").npcs;
    if (
      [...(command.keeperNpc ? [command.keeperNpc] : []), ...(command.serviceNpcs ?? [])].some(
        (id) => !people[id]?.alive,
      )
    )
      return { ok: false, reason: "接替人员必须是已经登记的在世人物" };
  }
  const merchant = ensureMerchant(draft, shop, itemCatalog(ctx.data), ctx.now);
  if (command.action === "staff") {
    if (command.keeperNpc !== undefined) merchant.definition.keeperNpc = command.keeperNpc;
    if (command.serviceNpcs !== undefined)
      merchant.definition.serviceNpcs = [...command.serviceNpcs];
  } else {
    merchant.open = command.action === "open";
    merchant.closureReason = merchant.open ? null : command.reason;
  }
  return { ok: true, notes: [`${shop.name}：${command.reason}`] };
}
