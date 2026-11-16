import type { Draft } from "immer";
import type { ApplyOutcome } from "../../kernel/system";
import {
  DISCOUNT_FACTORS,
  discounted,
  type EconomyState,
  type Rarity,
  SERVICES,
} from "../economy";
import {
  CLOTHING_SLOT_LABELS,
  type ClothingSlot,
  type InventoryState,
  ItemCatalogSchema,
  type ItemCommand,
  type ItemDef,
  ItemDefSchema,
  type ItemKind,
  MOD_SLOT_LABELS,
  type PartsCommand,
  type QuickSlotName,
  SELL_RATE,
  type Shop,
  ShopListSchema,
  type TradeCommand,
  WEAPON_CATEGORY_LABELS,
} from "./schema";

type Inventory = Draft<InventoryState>;

const ok = (...notes: string[]): ApplyOutcome => ({ ok: true, notes });
const fail = (reason: string): ApplyOutcome => ({ ok: false, reason });

/** 将旧存档武器槽里的武器统一并入背包并清空历史槽位指针 */
function absorbLegacyWeapons(draft: Inventory): void {
  let changed = draft.active !== null;
  for (let i = 0; i < draft.weapons.length; i++) {
    const w = draft.weapons[i];
    if (w !== null && w !== undefined) {
      put(draft, w);
      draft.weapons[i] = null;
      changed = true;
    }
  }
  if (changed) draft.active = null;
}

const catalogs = new WeakMap<object, ReadonlyMap<string, ItemDef>>();
const extendedCatalogs = new WeakMap<object, WeakMap<object, Readonly<Record<string, unknown>>>>();

/** 各系统使用同一份已保存的物件定义，读档后名称和能力不会丢失。 */
export function withWorldObjects(
  data: Readonly<Record<string, unknown>>,
  objects: InventoryState["objects"],
): Readonly<Record<string, unknown>> {
  if (Object.keys(objects).length === 0) return data;
  let cache = extendedCatalogs.get(objects);
  if (!cache) { cache = new WeakMap(); extendedCatalogs.set(objects, cache); }
  const cached = cache.get(data);
  if (cached) return cached;
  const base = Array.isArray(data.items) ? data.items.filter((item) => !objects[item.id]) : [];
  const merged = { ...data, items: [...base, ...Object.values(objects).map((o) => o.definition)] };
  cache.set(data, merged);
  return merged;
}

/** 读取并校验物品表，同一份数据只校验一次；没有物品表时报错，不用空表代替 */
export function itemCatalog(data: Readonly<Record<string, unknown>>): ReadonlyMap<string, ItemDef> {
  const raw = data.items;
  if (typeof raw !== "object" || raw === null) {
    throw new Error("结算环境里没有物品表（data.items）");
  }
  const cached = catalogs.get(raw);
  if (cached) return cached;
  const catalog = new Map<string, ItemDef>();
  for (const item of ItemCatalogSchema.parse(raw)) {
    if (catalog.has(item.id)) throw new Error(`物品表里的 id 重复：${item.id}`);
    catalog.set(item.id, item);
  }
  catalogs.set(raw, catalog);
  return catalog;
}

export function quickSlotFor(kind: ItemKind): QuickSlotName | undefined {
  return kind === "healing" || kind === "grenade" ? kind : undefined;
}

function put(draft: Inventory, id: string): void {
  draft.backpack[id] = (draft.backpack[id] ?? 0) + 1;
}

/** 存放箱和后备箱进出：只动背包，改装件跟着武器 id 留着 */
export function stashMove(draft: Inventory, action: "out" | "in", id: string, now = 0, location: string | null = null): ApplyOutcome {
  if (action === "in") {
    if (draft.objects[id]?.holder === "player") return fail("这件物品已经随身携带");
    put(draft, id);
    moveObject(draft, id, "player", null, now, "从存放处取回");
    return { ok: true, notes: [] };
  }
  absorbLegacyWeapons(draft);
  if (!take(draft, id)) return fail(`背包里没有 ${id}`);
  moveObject(draft, id, "stash", location, now, "放入存放处");
  return ok();
}

function moveObject(draft: Inventory, id: string, holder: string, location: string | null, now: number, reason: string): void {
  const object = draft.objects[id];
  if (!object) return;
  if (object.holder === "consumed" && holder !== "consumed") return;
  object.holder = holder;
  object.location = location;
  object.changedAt = now;
  object.lastChange = reason.slice(0, 240);
}

function take(draft: Inventory, id: string): boolean {
  const count = draft.backpack[id] ?? 0;
  if (count < 1) return false;
  if (count === 1) Reflect.deleteProperty(draft.backpack, id);
  else draft.backpack[id] = count - 1;
  return true;
}

/** 快捷栏的东西放回背包，没恢复的次数记下来 */
function stow(draft: Inventory, slot: QuickSlotName): void {
  const held = draft[slot];
  if (!held) return;
  put(draft, held.id);
  if (held.charges < held.max) draft.depleted[held.id] = held.charges;
  draft[slot] = null;
}

export function applyItem(
  draft: Inventory,
  command: ItemCommand,
  catalog: ReadonlyMap<string, ItemDef>,
  now = 0,
  location: string | null = null,
): ApplyOutcome {
  let def = catalog.get(command.id) ?? draft.objects[command.id]?.definition;
  if (command.definition !== undefined) {
    if (command.action !== "gain") return fail("只有首次获得物件时才能登记定义");
    if (def || draft.objects[command.id]) return fail("已有物件不可重新定义，直接使用原 id");
    if (command.definition.id !== command.id) return fail("物件定义的 id 必须与取得的 id 一致");
    if (!command.origin) return fail("新物件必须说明真实来源 origin");
    const parsed = ItemDefSchema.safeParse(command.definition);
    if (!parsed.success) return fail("新物件定义不完整");
    def = parsed.data;
    draft.objects[def.id] = {
      definition: def, origin: command.origin, holder: "world", location,
      changedAt: now, lastChange: command.reason.slice(0, 240),
    };
  }
  if (!def) return fail(`未登记物件 ${command.id}：首次取得需提供 definition 与 origin`);
  const object = draft.objects[def.id];
  if (command.action === "gain" && object) {
    if (object.holder === "player") return fail("这件独立物件已经属于玩家，不能重复获得");
    if (object.holder === "consumed") return fail("这件物件已经耗尽，不能凭空重新获得");
    if (object.holder === "stash") return fail("物件在存放处，请通过取回操作转移");
    if (object.location !== null && object.location !== location) return fail("这件物件仍在别处，不能隔空取得");
  }
  switch (command.action) {
    case "gain":
      put(draft, def.id);
      autoQuick(draft, def);
      moveObject(draft, def.id, "player", null, now, command.reason);
      return ok(def.iconic ? `获得不朽物品：${def.name}` : `获得 ${def.name}`);
    case "lose": {
      const result = lose(draft, def);
      if (result.ok) moveObject(draft, def.id, command.recipient ?? "world", location, now, command.reason);
      return result;
    }
    case "equip":
      return equip(draft, def);
    case "unequip":
      return unequip(draft, def);
    case "use": {
      const result = use(draft, def);
      if (result.ok && def.kind === "consumable") moveObject(draft, def.id, "consumed", location, now, command.reason);
      return result;
    }
  }
}

/** 丢了最后一把武器时，装在上面的改装件跟着没了 */
function lose(draft: Inventory, def: ItemDef): ApplyOutcome {
  absorbLegacyWeapons(draft);
  const outcome = loseOne(draft, def);
  const gone = outcome.ok && def.kind === "weapon" && (draft.backpack[def.id] ?? 0) < 1;
  if (gone) Reflect.deleteProperty(draft.tuned, def.id);
  if (!gone || draft.mods[def.id] === undefined) return outcome;
  Reflect.deleteProperty(draft.mods, def.id);
  return ok(`失去 ${def.name}，装在上面的改装件一起没了`);
}

function loseOne(draft: Inventory, def: ItemDef): ApplyOutcome {
  if (take(draft, def.id)) return ok(`失去 ${def.name}`);
  const quick = quickSlotFor(def.kind);
  if (quick && draft[quick]?.id === def.id) {
    draft[quick] = null;
    return ok(`失去 ${def.name}`);
  }
  if (def.clothingSlot && draft.clothing[def.clothingSlot] === def.id) {
    Reflect.deleteProperty(draft.clothing, def.clothingSlot);
    return ok(`失去 ${def.name}`);
  }
  return fail(`身上没有 ${def.name}`);
}

function equip(draft: Inventory, def: ItemDef): ApplyOutcome {
  const quick = quickSlotFor(def.kind);
  if (quick) return equipQuick(draft, def, quick);
  if (def.clothingSlot) return wear(draft, def, def.clothingSlot);
  if (def.kind !== "weapon") return fail(`${def.name} 不能装到装备栏`);
  // 武器放进背包直接可用；兼容旧存档和开局先 gain 再 equip 的流水
  absorbLegacyWeapons(draft);
  if ((draft.backpack[def.id] ?? 0) < 1) return fail(`背包里没有 ${def.name}`);
  return ok();
}

/** 穿上一件服装：同一格的旧衣服放回背包 */
function wear(draft: Inventory, def: ItemDef, slot: ClothingSlot): ApplyOutcome {
  if (draft.clothing[slot] === def.id) return fail(`${def.name} 已经穿着了`);
  if (!take(draft, def.id)) return fail(`背包里没有 ${def.name}`);
  const old = draft.clothing[slot];
  if (old !== undefined) put(draft, old);
  draft.clothing[slot] = def.id;
  return ok(
    `穿上 ${def.name}（${CLOTHING_SLOT_LABELS[slot]}）${old === undefined ? "" : "，换下的放回背包"}`,
  );
}

function equipQuick(draft: Inventory, def: ItemDef, slot: QuickSlotName): ApplyOutcome {
  // 物品栏精简（用户定的方案 A）：拿到时已自动放进快捷栏，开局随后的 equip 不再算失败，否则旧存档重放开局会读档失败
  if (draft[slot]?.id === def.id) return ok(`${def.name} 已经在快捷栏`);
  if (!take(draft, def.id)) return fail(`背包里没有 ${def.name}`);
  stow(draft, slot);
  const max = def.charges ?? 1;
  const charges = draft.depleted[def.id] ?? max;
  Reflect.deleteProperty(draft.depleted, def.id);
  draft[slot] = { id: def.id, charges, max };
  return ok(`${def.name} 放进快捷栏，剩 ${charges} / ${max} 次`);
}

/** 物品栏精简（用户定的方案 A）：快捷栏不再让玩家手动摆，拿到治疗品或手雷时对应的格空着就自动放进去 */
export function autoQuick(draft: Inventory, def: ItemDef): void {
  const slot = quickSlotFor(def.kind);
  if (!slot || draft[slot] !== null) return;
  if (!take(draft, def.id)) return;
  const max = def.charges ?? 1;
  const charges = draft.depleted[def.id] ?? max;
  Reflect.deleteProperty(draft.depleted, def.id);
  draft[slot] = { id: def.id, charges, max };
}

function unequip(draft: Inventory, def: ItemDef): ApplyOutcome {
  if (def.kind === "weapon") {
    absorbLegacyWeapons(draft);
    if ((draft.backpack[def.id] ?? 0) >= 1) return ok();
    return fail(`没有带着 ${def.name}`);
  }
  const quick = quickSlotFor(def.kind);
  if (quick && draft[quick]?.id === def.id) {
    stow(draft, quick);
    return ok(`${def.name} 放回背包`);
  }
  if (def.clothingSlot && draft.clothing[def.clothingSlot] === def.id) {
    Reflect.deleteProperty(draft.clothing, def.clothingSlot);
    put(draft, def.id);
    return ok(`脱下 ${def.name}，放回背包`);
  }
  return fail(`没有装备 ${def.name}`);
}

function use(draft: Inventory, def: ItemDef): ApplyOutcome {
  switch (def.kind) {
    case "healing":
      return fail("治疗品用 heal 指令（source: maxdoc）结算");
    case "grenade":
      return spend(draft, "grenade", def.id);
    case "consumable":
      return take(draft, def.id) ? ok(`用掉 ${def.name}`) : fail(`背包里没有 ${def.name}`);
    case "misc":
      return (draft.backpack[def.id] ?? 0) > 0 ? ok(`使用 ${def.name}`) : fail(`背包里没有 ${def.name}`);
    case "weapon":
    case "clothing":
      return fail(`${def.name} 不是一次性物品`);
    case "mod":
      return fail(`${def.name} 是改装件，在装备栏里装到武器上`);
  }
}

/** 扣一次快捷栏次数；指定 id 时要求快捷栏里正好是这件 */
export function spend(draft: Inventory, slot: QuickSlotName, id?: string, now = 0): ApplyOutcome {
  const held = draft[slot];
  if (!held || (id !== undefined && held.id !== id)) return fail("快捷栏里没有这件物品");
  if (held.charges < 1) {
    if (!take(draft, held.id)) return fail("这份补给已经耗尽，需要实际取得补充品");
    held.charges = held.max;
  }
  held.charges -= 1;
  if (held.charges === 0) moveObject(draft, held.id, "consumed", null, now, "这份补给已经耗尽");
  return { ok: true, notes: [`剩 ${held.charges} / ${held.max} 次`] };
}

const shopLists = new WeakMap<object, readonly Shop[]>();

/** 读取并校验商店表；没有时是空表 */
export function shopList(data: Readonly<Record<string, unknown>>): readonly Shop[] {
  const raw = data.shops;
  if (typeof raw !== "object" || raw === null) return [];
  const cached = shopLists.get(raw);
  if (cached) return cached;
  const list = ShopListSchema.parse(raw);
  shopLists.set(raw, list);
  return list;
}

/** 这一轮人在哪家店里：回合流程把店 id 和游戏时间放进事实 shop，叙事模型写的买卖据此占库存 */
export interface ShopHere {
  readonly id: string;
  readonly name: string;
  readonly shelf: readonly string[];
  readonly at: number;
}

export function shopHere(
  fact: unknown,
  data: Readonly<Record<string, unknown>>,
): ShopHere | undefined {
  if (typeof fact !== "object" || fact === null) return undefined;
  const { id, at } = fact as { id?: unknown; at?: unknown };
  if (typeof id !== "string" || typeof at !== "number") return undefined;
  const shop = shopList(data).find((s) => s.id === id);
  return shop ? { id, name: shop.name, shelf: shop.shelf, at } : undefined;
}

/** 货架上的一件：价格按店的系数折算到十位；locked 是不卖的原因 */
export interface ShopItem {
  readonly def: ItemDef;
  readonly price: number;
  readonly locked: string | null;
  /** 这一批还剩几件 */
  readonly left: number;
}

/** 商店每 3 个游戏日补一次货 */
export const RESTOCK_MINUTES = 3 * 1440;

/** 一家店这一批的已卖记录 */
export interface ShopStock {
  readonly restockedAt: number;
  readonly sold: Readonly<Record<string, number>>;
}

/** 每批进几件（本作改编）：治疗品和手雷 5，普通和没标稀有度的 3，uncommon 2，rare 及以上 1 */
export function stockOf(def: ItemDef): number {
  if (quickSlotFor(def.kind)) return 5;
  if (def.rarity === undefined || def.rarity === "common") return 3;
  if (def.rarity === "uncommon") return 2;
  return 1;
}

/** 这一批还没满 3 天就返回已卖记录；满了算补满，返回 undefined */
export function currentStock(stock: ShopStock | undefined, now: number): ShopStock | undefined {
  return stock !== undefined && now - stock.restockedAt < RESTOCK_MINUTES ? stock : undefined;
}

/** 这一批卖过货时，下次补满的游戏时间；没卖过返回 null */
export function restockDue(stock: ShopStock | undefined, now: number): number | null {
  const current = currentStock(stock, now);
  return current === undefined ? null : current.restockedAt + RESTOCK_MINUTES;
}

/** 买走一件记进这一批；上一批已经补满时，从这次起算新的一批 */
export function markSold(draft: Inventory, shop: string, item: string, at: number): ApplyOutcome {
  const entry = draft.shopStock[shop];
  if (entry === undefined || at - entry.restockedAt >= RESTOCK_MINUTES) {
    draft.shopStock[shop] = { restockedAt: at, sold: { [item]: 1 } };
  } else {
    entry.sold[item] = (entry.sold[item] ?? 0) + 1;
  }
  return { ok: true, notes: [], emit: [] };
}

export function shopShelf(
  shop: Shop,
  catalog: ReadonlyMap<string, ItemDef>,
  stock?: ShopStock,
): ShopItem[] {
  return shop.shelf.flatMap((id) => {
    const def = catalog.get(id);
    if (!def || def.price === undefined) return [];
    const left = Math.max(0, stockOf(def) - (stock?.sold[id] ?? 0));
    const locked = def.iconic
      ? "不朽物品只从剧情获得"
      : (left === 0 ? "这一批卖完了，等补货" : null);
    const price = Math.max(10, Math.round((def.price * shop.priceFactor) / 10) * 10);
    return [{ def, price, locked, left }];
  });
}

/** 卖给商店给多少：参考价的两成，舍到十位；不朽物品和没有标价的不收，返回 0 */
export function sellValue(def: ItemDef): number {
  if (def.iconic || def.price === undefined) return 0;
  return Math.floor((def.price * SELL_RATE) / 10) * 10;
}

/** 整套外观：save 记下身上穿着的；wear 照记下的换好，外观里没有的格子脱下放回背包。
 * 缺的件既没穿着也不在背包里时整套不换，免得换到一半 */
export function applyOutfit(
  draft: Inventory,
  action: "save" | "wear",
  catalog: ReadonlyMap<string, ItemDef>,
): ApplyOutcome {
  const name = (id: string) => catalog.get(id)?.name ?? id;
  const slots = Object.keys(CLOTHING_SLOT_LABELS) as ClothingSlot[];
  const pieces = (from: Partial<Record<ClothingSlot, string>>) =>
    slots.flatMap((slot) => {
      const id = from[slot];
      return id === undefined ? [] : [{ slot, id }];
    });
  if (action === "save") {
    const worn = pieces(draft.clothing);
    if (worn.length === 0) return fail("身上没穿衣服，没有能存的外观");
    draft.outfit = {};
    for (const { slot, id } of worn) draft.outfit[slot] = id;
    return ok(`存下整套外观：${worn.map((p) => name(p.id)).join("、")}`);
  }
  const wanted = pieces(draft.outfit);
  if (wanted.length === 0) return fail("还没存过整套外观");
  const missing = wanted.filter(
    (p) => draft.clothing[p.slot] !== p.id && (draft.backpack[p.id] ?? 0) < 1,
  );
  if (missing.length > 0) {
    return fail(`整套外观缺 ${missing.map((p) => name(p.id)).join("、")}：没穿着，背包里也没有`);
  }
  for (const slot of slots) {
    const current = draft.clothing[slot];
    if (current !== undefined && current !== draft.outfit[slot]) {
      Reflect.deleteProperty(draft.clothing, slot);
      put(draft, current);
    }
  }
  for (const { slot, id } of wanted) {
    if (draft.clothing[slot] === id) continue;
    take(draft, id);
    draft.clothing[slot] = id;
  }
  return ok(`换上整套外观：${wanted.map((p) => name(p.id)).join("、")}`);
}

/** 改装件：attach 从背包装到一把武器上，同位置的旧件放回背包；detach 拆下放回背包。
 * 武器要在武器格或背包里 */
export function applyMod(
  draft: Inventory,
  action: "attach" | "detach",
  weaponId: string,
  modId: string,
  catalog: ReadonlyMap<string, ItemDef>,
): ApplyOutcome {
  const weapon = catalog.get(weaponId);
  const mod = catalog.get(modId);
  if (weapon?.kind !== "weapon" || weapon.category === undefined) {
    return fail(`物品表里没有武器 ${weaponId}`);
  }
  if (mod?.kind !== "mod" || mod.modSlot === undefined) return fail(`物品表里没有改装件 ${modId}`);
  absorbLegacyWeapons(draft);
  if ((draft.backpack[weaponId] ?? 0) < 1) {
    return fail(`身上没有 ${weapon.name}`);
  }
  const slot = mod.modSlot;
  const fitted = draft.mods[weaponId];
  if (action === "detach") {
    if (fitted?.[slot] !== modId) return fail(`${weapon.name} 上没装 ${mod.name}`);
    Reflect.deleteProperty(fitted, slot);
    if (Object.keys(fitted).length === 0) Reflect.deleteProperty(draft.mods, weaponId);
    put(draft, modId);
    return ok(`从 ${weapon.name} 上拆下 ${mod.name}，放回背包`);
  }
  if (!mod.modFits?.includes(weapon.category)) {
    return fail(`${mod.name} 装不到${WEAPON_CATEGORY_LABELS[weapon.category]}上`);
  }
  if (fitted?.[slot] === modId) return fail(`${weapon.name} 上已经装着 ${mod.name}`);
  if (!take(draft, modId)) return fail(`背包里没有 ${mod.name}`);
  const old = fitted?.[slot];
  if (old !== undefined) put(draft, old);
  draft.mods[weaponId] = { ...fitted, [slot]: modId };
  return ok(
    `${mod.name} 装到 ${weapon.name} 的${MOD_SLOT_LABELS[slot]}${old === undefined ? "" : "，换下的放回背包"}`,
  );
}

/**
 * 买卖：价钱查表，讲价按折扣档；物品在这里进出背包，钱发一条 money 由欧元系统结算。
 * 卖出按商店收购价（参考价两成）再乘讲价档的反向：讲价讲得好卖得更贵，最多参考价三成
 */
export function applyTrade(
  draft: Inventory,
  command: TradeCommand,
  catalog: ReadonlyMap<string, ItemDef>,
  economy: EconomyState,
  shop?: ShopHere,
  now = 0,
  location: string | null = null,
): ApplyOutcome {
  if (command.action === "service") {
    const service = command.service;
    if (service === undefined) return fail("买服务要写 service");
    const def = SERVICES[service];
    const price = discounted(def.price, command.discount);
    if (price > economy.eddies) {
      return fail(`欧元不够：${def.label}要 ${price}，身上只有 ${economy.eddies}`);
    }
    return {
      ok: true,
      notes: [],
      emit: [{ type: "money", delta: -price, reason: `${def.label}（${command.with}）` }],
    };
  }
  const id = command.item;
  if (id === undefined) return fail("买卖物品要写 item");
  const def = catalog.get(id);
  if (!def) return fail(`物品表里没有 ${id}`);
  if (command.action === "buy") {
    const object = draft.objects[def.id];
    if (object && (object.holder === "player" || object.holder === "consumed" || object.holder === "stash")) return fail("这件独立物件并不在卖方手中");
    if (object && object.location !== null && object.location !== location) return fail("这件物件仍在别处");
    if (def.iconic) return fail(`${def.name}是不朽物品，只能从剧情获得，没人卖`);
    if (def.price === undefined) return fail(`${def.name}没有标价，不能买`);
    const price = discounted(def.price, command.discount);
    if (price > economy.eddies) {
      return fail(`欧元不够：${def.name}要 ${price}，身上只有 ${economy.eddies}`);
    }
    // 人在店里、买的是这家货架上的东西：和界面买一样占这一批的库存
    if (shop?.shelf.includes(def.id)) {
      const stock = currentStock(draft.shopStock[shop.id], shop.at);
      if (stockOf(def) - (stock?.sold[def.id] ?? 0) < 1) {
        return fail(`${shop.name}的${def.name}这一批卖完了，等补货`);
      }
      markSold(draft, shop.id, def.id, shop.at);
    }
    draft.backpack[def.id] = (draft.backpack[def.id] ?? 0) + 1;
    autoQuick(draft, def);
    moveObject(draft, def.id, "player", null, now, `向${command.with}买下：${command.reason}`);
    return {
      ok: true,
      notes: [`得到${def.name}（从${command.with}那里买的）`],
      emit: [{ type: "money", delta: -price, reason: `向${command.with}买${def.name}` }],
    };
  }
  if (def.iconic) return fail(`${def.name}是不朽物品，不卖`);
  absorbLegacyWeapons(draft);
  if ((draft.backpack[def.id] ?? 0) < 1)
    return fail(`背包里没有${def.name}；穿着的衣服或快捷栏里的药/雷先脱下`);
  const base = sellValue(def);
  if (base <= 0) return fail(`${def.name}没有标价，卖不出去`);
  const bonus = 2 - DISCOUNT_FACTORS[command.discount];
  const price = Math.min(
    Math.floor(((def.price ?? 0) * 0.3) / 10) * 10,
    Math.round((base * bonus) / 10) * 10,
  );
  const left = (draft.backpack[def.id] ?? 0) - 1;
  if (left > 0) draft.backpack[def.id] = left;
  else delete draft.backpack[def.id];
  moveObject(draft, def.id, command.with, location, now, `卖给${command.with}：${command.reason}`);
  // 卖掉最后一把时升级记录跟着清掉，免得下次买到同款带着升过的稀有度
  if (def.kind === "weapon" && left < 1) {
    Reflect.deleteProperty(draft.tuned, def.id);
  }
  return {
    ok: true,
    notes: [`卖掉${def.name}（卖给${command.with}）`],
    emit: [{ type: "money", delta: price, reason: `卖给${command.with}：${def.name}` }],
  };
}

/** 物品现在的稀有度：升过的按升过的，没写稀有度的按普通 */
export function rarityOf(def: ItemDef, tuned: Readonly<Record<string, Rarity>>): Rarity {
  return tuned[def.id] ?? def.rarity ?? "common";
}

export function applyParts(draft: Inventory, command: PartsCommand): ApplyOutcome {
  if (command.delta === 0) return ok();
  if (draft.parts + command.delta < 0) {
    return fail(`零件不够：有 ${draft.parts} 个，要 ${-command.delta} 个`);
  }
  draft.parts += command.delta;
  return ok(
    `零件 ${command.delta > 0 ? "+" : "−"}${Math.abs(command.delta)}（${command.reason}），现有 ${draft.parts}`,
  );
}
