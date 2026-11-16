import type { Draft } from "immer";
import type { ApplyOutcome, Command } from "../../kernel/system";
import type { WorldState } from "../../kernel/world";
import { agreedQuote, checkNarratedPurchase, registeredParty } from "../commerce";
import { type EconomyState, MONEY_CAP, SERVICES } from "../economy";
// biome-ignore lint/style/noRestrictedImports: NPC 入口经 perceived 反向初始化 inventory，读取独立 schema 避免循环。
import { NPC_GEAR_MAX, type NpcState } from "../npc/schema";
import type { WorldClockState } from "../world";
import {
  applyItem,
  currentStock,
  itemCatalog,
  markSold,
  sellValue,
  shopList,
  stockOf,
  withWorldObjects,
} from "./apply";
import { moodLock, moodPrice, shopMood } from "./mood";
import {
  carriedItemCounts,
  type InventoryState,
  InventoryStateSchema,
  type ItemDef,
  type Shop,
  type TradeCommand,
} from "./schema";

export type TradeRequest = Pick<TradeCommand, "action" | "item" | "service" | "with" | "offer">;
type SavedQuote = Extract<ReturnType<typeof agreedQuote>, { ok: true }>["quote"];
type Counterparty = {
  id: string;
  name: string;
  location: string | null;
  shop?: Shop;
  npc?: NpcState["npcs"][string];
};
export type TradeQuote =
  | {
      ok: true;
      price: number;
      label: string;
      counterparty: string;
      party: Counterparty;
      shop?: Shop;
      item?: ItemDef;
      left?: number;
      quote: SavedQuote;
    }
  | { ok: false; reason: string; price?: number };

/** 稳定 ID 优先；名字只接受唯一匹配，绝不从玩家所在店铺猜交易对象。 */
function counterparty(
  world: WorldState,
  data: Readonly<Record<string, unknown>>,
  id: string,
): Counterparty | string {
  const shops = shopList(data);
  const npcs = Object.values((world.slices.npc as NpcState).npcs);
  const shop = shops.find((s) => s.id === id);
  const npc = npcs.find((n) => n.id === id);
  const party = registeredParty(world, id);
  const exact: Counterparty[] = [
    ...(shop ? [{ id: shop.id, name: shop.name, location: shop.location, shop }] : []),
    ...(npc ? [{ id: npc.id, name: npc.name, location: npc.location, npc }] : []),
    ...(party && !shop && !npc ? [party] : []),
  ];
  if (exact.length === 1) return exact[0] as Counterparty;
  if (exact.length > 1) return `交易对象 ${id} 的身份不唯一`;
  const matches: Counterparty[] = [
    ...shops
      .filter((s) => s.name === id || s.keeper === id)
      .map((s) => ({ id: s.id, name: s.name, location: s.location, shop: s })),
    ...npcs
      .filter((n) => n.name === id || n.alias === id)
      .map((n) => ({ id: n.id, name: n.name, location: n.location, npc: n })),
  ];
  return matches.length === 1
    ? (matches[0] as Counterparty)
    : matches.length > 1
      ? `交易对象 ${id} 不明确，请使用店铺或人物 id`
      : `没有登记交易对象 ${id}，需先确认真实身份与所在地点`;
}

/** 货架、正文和执行入口共用报价；checkFunds:false 用于展示仍可询价但暂时买不起的货。 */
export function quoteTrade(
  world: WorldState,
  data: Readonly<Record<string, unknown>>,
  request: TradeRequest,
  options: { checkFunds?: boolean } = {},
): TradeQuote {
  const party = counterparty(world, data, request.with);
  if (typeof party === "string") return { ok: false, reason: party };
  const location = (world.slices.world as WorldClockState).location;
  if (location === null || party.location !== location)
    return { ok: false, reason: `不在${party.name}的交易地点，不能隔空交付` };
  if (party.npc?.alive === false) return { ok: false, reason: `${party.name}已经死亡，无法交易` };
  const shop = party.shop;
  const inventory = InventoryStateSchema.parse(world.slices.inventory);
  const catalog = itemCatalog(withWorldObjects(data, inventory.objects));
  const item =
    request.action === "service" || request.item === undefined
      ? undefined
      : catalog.get(request.item);
  const service = request.service === undefined ? undefined : SERVICES[request.service];
  if (request.action === "service" ? !service : !item)
    return {
      ok: false,
      reason: request.action === "service" ? "服务不存在" : `未登记物件 ${request.item ?? ""}`,
    };
  const match = agreedQuote(world, {
    seller: party.id,
    kind: request.action === "service" ? "service" : "item",
    action: request.action,
    target: request.action === "service" ? (request.service as string) : (item?.id as string),
    ...(request.offer ? { offer: request.offer } : {}),
  });
  if (!match.ok) return match;
  const mood = shop ? shopMood(world, data, shop) : undefined;
  const base =
    request.action === "service"
      ? service?.price
      : request.action === "sell"
        ? item && sellValue(item)
        : item?.price === undefined
          ? undefined
          : shop
            ? moodPrice(Math.max(10, Math.round((item.price * shop.priceFactor) / 10) * 10), mood)
            : item.price;
  const price = match.quote?.price ?? base;
  if (
    price === undefined ||
    price < 0 ||
    (price === 0 && !match.quote) ||
    !Number.isSafeInteger(price)
  )
    return { ok: false, reason: "这笔交易没有有效现金报价；赠与使用实际物件转交" };
  const fail = (reason: string): TradeQuote => ({ ok: false, reason, price });
  if (price > MONEY_CAP) return fail("这笔报价超过当前单笔现金结算额度，尚不能交付");
  if (shop) {
    const locked = moodLock(mood);
    if (locked) return fail(`${shop.name}拒绝交易：${locked}`);
  }
  let left: number | undefined;
  if (item) {
    const object = inventory.objects[item.id];
    if (request.action === "buy") {
      if (
        object &&
        object.holder !== party.id &&
        (!shop?.keeperNpc || object.holder !== shop.keeperNpc)
      )
        return fail(`${item.name}不属于${party.name}，不能从别人的持有记录取得`);
      const holder = object ? (world.slices.npc as NpcState).npcs[object.holder] : undefined;
      if (holder && !holder.body?.gear.includes(item.id))
        return fail(`${holder.name}已经不再带着${item.name}，现有归属记录不能证明能够交付`);
      const objectLocation = object ? (holder?.location ?? object.location) : null;
      if (objectLocation !== null && objectLocation !== location)
        return fail(`${item.name}仍在别处，不能隔空取得`);
      if (shop) {
        const returned = inventory.shopReturns[shop.id]?.[item.id] ?? 0;
        const onShelf = shop.shelf.includes(item.id);
        if (!onShelf && returned < 1) return fail(`${shop.name}没有这件货，不能凭物品目录生成商品`);
        const stock = currentStock(inventory.shopStock[shop.id], world.time);
        left = object
          ? 1
          : returned + (onShelf ? Math.max(0, stockOf(item) - (stock?.sold[item.id] ?? 0)) : 0);
        if (left < 1) return fail(`${shop.name}的${item.name}这一批卖完了，等补货`);
      } else if (party.npc) {
        if (!party.npc.body?.gear.includes(item.id))
          return fail(`${party.name}并未持有${item.name}`);
        left = 1;
      } else if (!object) return fail(`${party.name}没有这件实物的持有记录，不能凭目录出货`);
    } else if (request.action === "sell") {
      const carried = carriedItemCounts(inventory).get(item.id) ?? 0;
      if (carried < 1 || (object && object.holder !== "player"))
        return fail(`背包里没有${item.name}；穿着的衣服或快捷栏里的药/雷先脱下`);
      if (carried === 1 && Object.values(inventory.mods[item.id] ?? {}).length > 0)
        return fail(`${item.name}上还装着改装件，先拆下来再卖`);
      if (party.npc?.body?.gear.includes(item.id))
        return fail(`${party.name}已有同款装备，目前无法将另一件合并到其持有记录`);
      if (party.npc && (party.npc.body?.gear.length ?? 0) >= NPC_GEAR_MAX)
        return fail(`${party.name}当前无法再接收装备，交易尚不能交付`);
      if (!shop && !party.npc && !object)
        return fail("无人物装备记录的交易对象只能接收已经登记的独立物件");
    }
  }
  const eddies = (world.slices.economy as EconomyState).eddies;
  if (request.action !== "sell" && options.checkFunds !== false && price > eddies)
    return fail(`欧元不够：${item?.name ?? service?.label}要 ${price}，身上只有 ${eddies}`);
  return {
    ok: true,
    price,
    label: item?.name ?? (service?.label as string),
    counterparty: party.id,
    party,
    ...(shop ? { shop } : {}),
    ...(item ? { item } : {}),
    ...(left === undefined ? {} : { left }),
    quote: match.quote,
  };
}

/** 一条 trade 连同人物装备、钱和报价消耗，在 registry 的同一事务内生效。 */
export function applyTrade(
  draft: Draft<InventoryState>,
  command: TradeCommand,
  world: WorldState,
  data: Readonly<Record<string, unknown>>,
  facts: Readonly<Record<string, unknown>> = {},
): ApplyOutcome {
  const quoted = quoteTrade(world, data, command);
  if (!quoted.ok) return quoted;
  const changed = checkNarratedPurchase(facts, {
    seller: quoted.counterparty,
    kind: command.action === "service" ? "service" : "item",
    action: command.action,
    target: quoted.item?.id ?? (command.service as string),
    price: quoted.price,
  });
  if (changed) return { ok: false, reason: changed };
  const emitted: Command[] = [];
  const item = quoted.item;
  if (item) {
    const npcs = (world.slices.npc as NpcState).npcs;
    const location = (world.slices.world as WorldClockState).location;
    const object = draft.objects[item.id];
    const result = applyItem(
      draft,
      {
        type: "item",
        action: command.action === "buy" ? "gain" : "lose",
        id: item.id,
        ...(command.action === "sell" ? { recipient: quoted.counterparty } : {}),
        reason: command.reason,
      },
      itemCatalog(withWorldObjects(data, draft.objects)),
      world.time,
      location,
      npcs,
    );
    if (!result.ok) return result;
    emitted.push(...(result.emit ?? []));
    if (!object && quoted.party.npc)
      emitted.push({
        type: "npcGear",
        id: quoted.party.npc.id,
        action: command.action === "buy" ? "remove" : "add",
        item: item.id,
      });
    if (quoted.shop) {
      const shopId = quoted.shop.id;
      if (command.action === "buy") {
        const returned = draft.shopReturns[shopId]?.[item.id] ?? 0;
        if (returned > 0) {
          if (returned === 1) Reflect.deleteProperty(draft.shopReturns[shopId] as object, item.id);
          else (draft.shopReturns[shopId] as Record<string, number>)[item.id] = returned - 1;
        } else markSold(draft, shopId, item.id, world.time);
      } else {
        if (!draft.shopReturns[shopId]) draft.shopReturns[shopId] = {};
        const returns = draft.shopReturns[shopId] as Record<string, number>;
        returns[item.id] = (returns[item.id] ?? 0) + 1;
      }
    }
  }
  if (quoted.price > 0)
    emitted.push({
      type: "money",
      delta: command.action === "sell" ? quoted.price : -quoted.price,
      reason: `${quoted.party.name}：${quoted.label}，${command.reason}`,
    });
  if (quoted.quote) emitted.push({ type: "commerce.used", id: quoted.quote.id });
  return {
    ok: true,
    notes: [
      `${command.action === "sell" ? "卖出" : command.action === "buy" ? "取得" : "支付"}${quoted.label}，${quoted.price} 欧元（${quoted.party.name}）`,
    ],
    emit: emitted,
  };
}
