import type { Draft } from "immer";
import type { ApplyOutcome } from "../../kernel/system";
import {
  type InventoryState,
  ItemCatalogSchema,
  type ItemCommand,
  type ItemDef,
  type ItemKind,
  type QuickSlotName,
  SELL_RATE,
  type Shop,
  ShopListSchema,
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

function lose(draft: Inventory, def: ItemDef): ApplyOutcome {
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
  return fail(`身上没有 ${def.name}`);
}

function equip(draft: Inventory, def: ItemDef, slot: number | undefined): ApplyOutcome {
  const quick = quickSlotFor(def.kind);
  if (quick) return equipQuick(draft, def, quick);
  if (def.kind !== "weapon") return fail(`${def.name} 不能装到装备栏（服装栏在 M2a 加入）`);

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
  }
}

/** 扣一次快捷栏次数；指定 id 时要求快捷栏里正好是这件 */
export function spend(draft: Inventory, slot: QuickSlotName, id?: string): ApplyOutcome {
  const held = draft[slot];
  if (!held || (id !== undefined && held.id !== id)) return fail("快捷栏里没有这件物品");
  if (held.charges < 1) return fail("次数用完了，休整或场景结束后恢复");
  held.charges -= 1;
  return ok(`剩 ${held.charges} / ${held.max} 次`);
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
