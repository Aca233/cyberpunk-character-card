import type { Draft } from "immer";
import type { ApplyOutcome } from "../../kernel/system";
import { DISCOUNT_FACTORS, discounted, type EconomyState, SERVICES } from "../economy";
import {
  CLOTHING_SLOT_LABELS,
  type ClothingSlot,
  type InventoryState,
  ItemCatalogSchema,
  type ItemCommand,
  type ItemDef,
  type ItemKind,
  MOD_SLOT_LABELS,
  type QuickSlotName,
  SELL_RATE,
  type Shop,
  ShopListSchema,
  type TradeCommand,
  WEAPON_CATEGORY_LABELS,
} from "./schema";

export const WEAPON_SLOTS = 3;

type Inventory = Draft<InventoryState>;

const ok = (...notes: string[]): ApplyOutcome => ({ ok: true, notes });
const fail = (reason: string): ApplyOutcome => ({ ok: false, reason });

const catalogs = new WeakMap<object, ReadonlyMap<string, ItemDef>>();

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
export function stashMove(draft: Inventory, action: "out" | "in", id: string): ApplyOutcome {
  if (action === "in") {
    put(draft, id);
    return { ok: true, notes: [] };
  }
  return take(draft, id) ? { ok: true, notes: [] } : { ok: false, reason: `背包里没有 ${id}` };
}

function take(draft: Inventory, id: string): boolean {
  const count = draft.backpack[id] ?? 0;
  if (count < 1) return false;
  if (count === 1) Reflect.deleteProperty(draft.backpack, id);
  else draft.backpack[id] = count - 1;
  return true;
}

function firstWeapon(draft: Inventory): number | null {
  const index = draft.weapons.findIndex((w) => w !== null);
  return index >= 0 ? index : null;
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
): ApplyOutcome {
  const def = catalog.get(command.id);
  if (!def) return fail(`物品表里没有 ${command.id}`);
  switch (command.action) {
    case "gain":
      put(draft, def.id);
      return ok(def.iconic ? `获得不朽物品：${def.name}` : `获得 ${def.name}`);
    case "lose":
      return lose(draft, def);
    case "equip":
      return equip(draft, def, command.slot);
    case "unequip":
      return unequip(draft, def);
    case "use":
      return use(draft, def);
  }
}

/** 丢了最后一把武器时，装在上面的改装件跟着没了 */
function lose(draft: Inventory, def: ItemDef): ApplyOutcome {
  const outcome = loseOne(draft, def);
  const gone =
    outcome.ok &&
    def.kind === "weapon" &&
    !draft.weapons.includes(def.id) &&
    (draft.backpack[def.id] ?? 0) < 1;
  if (!gone || draft.mods[def.id] === undefined) return outcome;
  Reflect.deleteProperty(draft.mods, def.id);
  return ok(`失去 ${def.name}，装在上面的改装件一起没了`);
}

function loseOne(draft: Inventory, def: ItemDef): ApplyOutcome {
  if (take(draft, def.id)) return ok(`失去 ${def.name}`);
  const slot = draft.weapons.indexOf(def.id);
  if (slot >= 0) {
    draft.weapons[slot] = null;
    if (draft.active === slot) draft.active = firstWeapon(draft);
    return ok(`失去 ${def.name}`);
  }
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

function equip(draft: Inventory, def: ItemDef, slot: number | undefined): ApplyOutcome {
  const quick = quickSlotFor(def.kind);
  if (quick) return equipQuick(draft, def, quick);
  if (def.clothingSlot) return wear(draft, def, def.clothingSlot);
  if (def.kind !== "weapon") return fail(`${def.name} 不能装到装备栏`);

  const target = slot === undefined ? undefined : slot - 1;
  const current = draft.weapons.indexOf(def.id);
  if (current >= 0) {
    if (target === undefined || target === current) {
      draft.active = current;
      return ok(`切换到 ${def.name}`);
    }
    const other = draft.weapons[target] ?? null;
    draft.weapons[target] = def.id;
    draft.weapons[current] = other;
    draft.active = target;
    return ok(`${def.name} 换到第 ${target + 1} 格`);
  }

  if ((draft.backpack[def.id] ?? 0) < 1) return fail(`背包里没有 ${def.name}`);
  const free = target ?? draft.weapons.indexOf(null);
  if (free < 0) return fail(`${WEAPON_SLOTS} 个武器格都满了，先卸下一把或指定格子`);
  take(draft, def.id);
  const old = draft.weapons[free] ?? null;
  if (old !== null) put(draft, old);
  draft.weapons[free] = def.id;
  draft.active = free;
  return ok(
    old === null
      ? `${def.name} 装到第 ${free + 1} 格`
      : `${def.name} 装到第 ${free + 1} 格，换下的放回背包`,
  );
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
  if (draft[slot]?.id === def.id) return fail(`${def.name} 已经在快捷栏`);
  if (!take(draft, def.id)) return fail(`背包里没有 ${def.name}`);
  stow(draft, slot);
  const max = def.charges ?? 1;
  const charges = draft.depleted[def.id] ?? max;
  Reflect.deleteProperty(draft.depleted, def.id);
  draft[slot] = { id: def.id, charges, max };
  return ok(`${def.name} 放进快捷栏，剩 ${charges} / ${max} 次`);
}

function unequip(draft: Inventory, def: ItemDef): ApplyOutcome {
  const slot = draft.weapons.indexOf(def.id);
  if (slot >= 0) {
    draft.weapons[slot] = null;
    put(draft, def.id);
    if (draft.active === slot) draft.active = firstWeapon(draft);
    return ok(`${def.name} 放回背包`);
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
    case "misc":
      return take(draft, def.id) ? ok(`用掉 ${def.name}`) : fail(`背包里没有 ${def.name}`);
    case "weapon":
    case "clothing":
      return fail(`${def.name} 不是一次性物品`);
    case "mod":
      return fail(`${def.name} 是改装件，在装备栏里装到武器上`);
  }
}

/** 扣一次快捷栏次数；指定 id 时要求快捷栏里正好是这件 */
export function spend(draft: Inventory, slot: QuickSlotName, id?: string): ApplyOutcome {
  const held = draft[slot];
  if (!held || (id !== undefined && held.id !== id)) return fail("快捷栏里没有这件物品");
  if (held.charges < 1) return fail("次数用完了，休整或场景结束后恢复");
  held.charges -= 1;
  // 战斗系统听这个信号记快捷动作
  return { ok: true, notes: [`剩 ${held.charges} / ${held.max} 次`], signals: ["combat.quick"] };
}

/** 休整或场景结束：快捷栏次数回满 */
export function recharge(draft: Inventory): ApplyOutcome {
  for (const slot of ["healing", "grenade"] as const) {
    const held = draft[slot];
    if (held) held.charges = held.max;
  }
  draft.depleted = {};
  return ok();
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

/** 货架上的一件：价格按店的系数折算到十位；locked 是不卖的原因 */
export interface ShopItem {
  readonly def: ItemDef;
  readonly price: number;
  readonly locked: string | null;
}

export function shopShelf(
  shop: Shop,
  catalog: ReadonlyMap<string, ItemDef>,
  streetCred: number,
): ShopItem[] {
  return shop.shelf.flatMap((id) => {
    const def = catalog.get(id);
    if (!def || def.price === undefined) return [];
    const gate = def.rarity === undefined ? undefined : shop.credGates[def.rarity];
    const locked = def.iconic
      ? "不朽物品只从剧情获得"
      : gate !== undefined && streetCred < gate
        ? `街头声望 ${gate} 级才肯卖`
        : null;
    const price = Math.max(10, Math.round((def.price * shop.priceFactor) / 10) * 10);
    return [{ def, price, locked }];
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
  if (!draft.weapons.includes(weaponId) && (draft.backpack[weaponId] ?? 0) < 1) {
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
    if (def.iconic) return fail(`${def.name}是不朽物品，只能从剧情获得，没人卖`);
    if (def.price === undefined) return fail(`${def.name}没有标价，不能买`);
    const price = discounted(def.price, command.discount);
    if (price > economy.eddies) {
      return fail(`欧元不够：${def.name}要 ${price}，身上只有 ${economy.eddies}`);
    }
    draft.backpack[def.id] = (draft.backpack[def.id] ?? 0) + 1;
    return {
      ok: true,
      notes: [`得到${def.name}（从${command.with}那里买的）`],
      emit: [{ type: "money", delta: -price, reason: `向${command.with}买${def.name}` }],
    };
  }
  if (def.iconic) return fail(`${def.name}是不朽物品，不卖`);
  if ((draft.backpack[def.id] ?? 0) < 1) return fail(`背包里没有${def.name}；装备着的先卸下`);
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
  return {
    ok: true,
    notes: [`卖掉${def.name}（卖给${command.with}）`],
    emit: [{ type: "money", delta: price, reason: `卖给${command.with}：${def.name}` }],
  };
}
