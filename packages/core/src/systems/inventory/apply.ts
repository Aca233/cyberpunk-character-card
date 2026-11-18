import type { Draft } from "immer";
import type { ApplyOutcome } from "../../kernel/system";
import type { Rarity } from "../economy";
import type { NpcState } from "../npc";
import {
  CLOTHING_SLOT_LABELS,
  type ClothingSlot,
  canAttachMod,
  defaultWeaponSlots,
  type InventoryInternal,
  type InventoryState,
  ItemCatalogSchema,
  type ItemCommand,
  type ItemDef,
  ItemDefSchema,
  type ItemKind,
  MOD_SLOT_LABELS,
  type ModSlot,
  type PartsCommand,
  type PlacedKind,
  type QuickSlotName,
  SELL_RATE,
  type Shop,
  ShopListSchema,
  type WeaponInstanceState,
} from "./schema";

type Inventory = Draft<InventoryState>;

const ok = (...notes: string[]): ApplyOutcome => ({ ok: true, notes });
const fail = (reason: string): ApplyOutcome => ({ ok: false, reason });

function nextWeaponInstanceId(draft: Inventory, baseId: string): string {
  let candidate = `wpn:${baseId}:${draft.nextWeaponSeq}`;
  draft.nextWeaponSeq += 1;
  while (draft.objects[candidate] !== undefined) {
    candidate = `wpn:${baseId}:${draft.nextWeaponSeq}`;
    draft.nextWeaponSeq += 1;
  }
  return candidate;
}

export function isCleanWeaponState(
  ws: Pick<WeaponInstanceState, "mods" | "lockedSlots" | "tunedRarity" | "smartLink">,
): boolean {
  return (
    Object.values(ws.mods).every((v) => v === undefined) &&
    ws.lockedSlots.length === 0 &&
    ws.tunedRarity === undefined &&
    !ws.smartLink
  );
}

export function cloneWeaponState(ws: WeaponInstanceState): WeaponInstanceState {
  return {
    baseId: ws.baseId,
    mods: { ...ws.mods },
    lockedSlots: [...ws.lockedSlots],
    ...(ws.tunedRarity !== undefined ? { tunedRarity: ws.tunedRarity } : {}),
    ...(ws.smartLink ? { smartLink: true } : {}),
  };
}

export function defaultInstanceStateFromDef(def: ItemDef): WeaponInstanceState | undefined {
  if (def.kind !== "weapon") return undefined;
  const hasPre =
    def.preInstalledMods !== undefined && Object.values(def.preInstalledMods).some(Boolean);
  const hasLocked = def.lockedModSlots !== undefined && def.lockedModSlots.length > 0;
  if (!hasPre && !hasLocked) return undefined;
  return {
    baseId: def.id,
    mods: { ...(def.preInstalledMods ?? {}) },
    lockedSlots: [...(def.lockedModSlots ?? [])],
  };
}

function validateWeaponState(
  weaponDef: ItemDef,
  ws: WeaponInstanceState,
  catalog: ReadonlyMap<string, ItemDef>,
  requireExactBase = false,
): string | null {
  if (weaponDef.kind !== "weapon" || weaponDef.category === undefined) {
    return "只有武器才能附带改装状态";
  }
  if (ws.smartLink && weaponDef.weaponType !== "smart") {
    return `${weaponDef.name} 不是智能武器，不能附带智能靶向联锁改造`;
  }
  if (requireExactBase && ws.baseId !== weaponDef.id) {
    return `weaponState.baseId "${ws.baseId}" 必须与模板武器 "${weaponDef.id}" 一致`;
  }
  if (ws.baseId !== weaponDef.id && catalog.get(ws.baseId)?.kind !== "weapon") {
    return `weaponState.baseId "${ws.baseId}" 不是有效的武器模板`;
  }
  const allowedSlots = defaultWeaponSlots(weaponDef);
  for (const slot of ws.lockedSlots) {
    if (!allowedSlots.includes(slot)) {
      return `${weaponDef.name} 没有${MOD_SLOT_LABELS[slot]}槽位`;
    }
  }
  for (const [slot, modId] of Object.entries(ws.mods)) {
    if (modId === undefined) continue;
    const modDef = catalog.get(modId);
    if (!modDef) return `改装件 ${modId} 不存在`;
    const check = canAttachMod(weaponDef, modDef, ws, { ignoreLock: true });
    if (!check.ok) return check.reason;
    if (check.slot !== slot) {
      return `${modDef.name} 只能装到${MOD_SLOT_LABELS[check.slot]}，不能装到${MOD_SLOT_LABELS[slot as ModSlot]}`;
    }
  }
  return null;
}

export function materializeWeapon(
  draft: Inventory,
  def: ItemDef,
  ws: WeaponInstanceState,
  origin: string,
  lastChange: string,
  now: number,
): string {
  const instanceId = nextWeaponInstanceId(draft, ws.baseId);
  draft.objects[instanceId] = {
    kind: "customized",
    definition: { ...def, id: instanceId },
    origin: origin.slice(0, 240),
    holder: "player",
    location: null,
    changedAt: now,
    lastChange: lastChange.slice(0, 240),
    remaining: null,
    weaponState: cloneWeaponState(ws),
  };
  return instanceId;
}

export function foldBackWeapon(draft: Inventory, instanceId: string): boolean {
  const obj = draft.objects[instanceId];
  if (obj?.kind !== "customized" || obj.holder !== "player" || !obj.weaponState) {
    return false;
  }
  if (
    obj.definition.iconic ||
    obj.definition.preInstalledMods !== undefined ||
    obj.definition.lockedModSlots !== undefined
  ) {
    return false;
  }
  if (!isCleanWeaponState(obj.weaponState)) return false;
  if (!take(draft, instanceId)) return false;
  put(draft, obj.weaponState.baseId);
  Reflect.deleteProperty(draft.objects, instanceId);
  return true;
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
  if (!cache) {
    cache = new WeakMap();
    extendedCatalogs.set(objects, cache);
  }
  const cached = cache.get(data);
  if (cached) return cached;
  const base = Array.isArray(data.items) ? data.items.filter((item) => !objects[item.id]) : [];
  const merged = {
    ...data,
    worldObjects: objects,
    items: [...base, ...Object.values(objects).map((o) => o.definition)],
  };
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

export function putToBackpack(draft: Inventory, id: string): void {
  draft.backpack[id] = (draft.backpack[id] ?? 0) + 1;
}
const put = putToBackpack;

export function placedHolderTag(kind: PlacedKind, target: string): string {
  return kind === "npc" ? target : `${kind}:${target}`;
}

function takeFromPlayer(draft: Inventory, id: string, count: number): boolean {
  let available = draft.backpack[id] ?? 0;
  for (const slot of Object.keys(draft.clothing) as ClothingSlot[]) {
    if (draft.clothing[slot] === id) available += 1;
  }
  for (const slot of ["healing", "grenade"] as const) {
    if (draft[slot]?.id === id) available += 1;
  }
  if (available < count) return false;
  let left = count;
  while (left > 0 && take(draft, id)) left -= 1;
  for (const slot of Object.keys(draft.clothing) as ClothingSlot[]) {
    if (left <= 0) break;
    if (draft.clothing[slot] === id) {
      Reflect.deleteProperty(draft.clothing, slot);
      left -= 1;
    }
  }
  for (const slot of ["healing", "grenade"] as const) {
    if (left <= 0) break;
    const held = draft[slot];
    if (held?.id === id) {
      if (held.charges < held.max) draft.depleted[id] = held.charges;
      const obj = draft.objects[id];
      if (obj) obj.remaining = held.charges;
      draft[slot] = null;
      left -= 1;
    }
  }
  return left === 0;
}

function mergePlaced(
  draft: Inventory,
  entry: {
    readonly item: string;
    readonly count: number;
    readonly kind: PlacedKind;
    readonly target: string;
    readonly location: string | null;
    readonly note?: string | undefined;
    readonly since: number;
  },
): void {
  const existing = draft.placed.find(
    (p) => p.item === entry.item && p.kind === entry.kind && p.target === entry.target,
  );
  if (existing) {
    existing.count += entry.count;
    existing.location = entry.location;
    if (entry.note !== undefined) existing.note = entry.note;
    existing.since = entry.since;
    return;
  }
  draft.placed.push({
    item: entry.item,
    count: entry.count,
    kind: entry.kind,
    target: entry.target,
    location: entry.location,
    ...(entry.note !== undefined ? { note: entry.note } : {}),
    since: entry.since,
  });
}

/** 留置或取回：支持从背包/穿戴/快捷栏直接留下，或把现场物体直接放进车/家/某人处。 */
export function applyPlaceItem(
  draft: Inventory,
  command: Extract<InventoryInternal, { type: "inventory.place" }>,
  catalog: ReadonlyMap<string, ItemDef>,
  now = 0,
): ApplyOutcome {
  const { action, item: id, count, kind, target, location, note, reason } = command;
  const holder = placedHolderTag(kind, target);
  const summary = (note ?? reason ?? (action === "leave" ? "留在别处" : "取回随身")).slice(0, 240);

  if (action === "leave") {
    if (command.definition !== undefined) {
      if (catalog.has(id) || draft.objects[id]) return fail("已有物件不可重新定义，直接使用原 id");
      if (command.definition.id !== id) return fail("物件定义的 id 必须与物品 id 一致");
      const parsed = ItemDefSchema.safeParse(command.definition);
      if (!parsed.success) return fail("新物件定义不完整");
      const def = parsed.data;
      const initialWs = defaultInstanceStateFromDef(def);
      if (initialWs) {
        const wsError = validateWeaponState(def, initialWs, catalog);
        if (wsError) return fail(wsError);
      }
      draft.objects[id] = {
        kind: "story",
        definition: def,
        origin: command.origin ?? summary,
        holder,
        location,
        changedAt: now,
        lastChange: summary,
        remaining: def.charges ?? null,
        ...(initialWs ? { weaponState: initialWs } : {}),
      };
      mergePlaced(draft, { item: id, count, kind, target, location, note, since: now });
      return ok();
    }
    const def = catalog.get(id) ?? draft.objects[id]?.definition;
    if (!def) return fail(`未登记物件 ${id}：首次留置需提供 definition 与 origin`);
    const object = draft.objects[id];
    if (object && count > 1) return fail("独立物件每次只能留置 1 件");
    if (object && object.holder !== "player") {
      if (object.holder === "consumed") return fail("这件物件已经耗尽");
      if (object.holder === holder) return fail("这件物件已经留在那里了");
      if (
        object.holder === "world" &&
        (object.location === null || location === null || object.location === location)
      ) {
        moveObject(draft, id, holder, location, now, summary);
        mergePlaced(draft, { item: id, count, kind, target, location, note, since: now });
        return ok();
      }
      return fail("玩家没有随身携带这件物件");
    }
    if (!takeFromPlayer(draft, id, count)) return fail(`身上没有足够的${def.name}`);
    moveObject(draft, id, holder, location, now, summary);
    mergePlaced(draft, { item: id, count, kind, target, location, note, since: now });
    return ok();
  }

  const index = draft.placed.findIndex(
    (p) => p.item === id && p.kind === kind && p.target === target,
  );
  const entry = index >= 0 ? draft.placed[index] : undefined;
  if (!entry || entry.count < count) return fail(`指定位置没有足够的 ${id}`);
  if (entry.count === count) draft.placed.splice(index, 1);
  else entry.count -= count;
  const def = catalog.get(id) ?? draft.objects[id]?.definition;
  for (let i = 0; i < count; i += 1) put(draft, id);
  if (def) autoQuick(draft, def);
  moveObject(draft, id, "player", null, now, summary);
  return ok();
}

export function relocateVehiclePlaced(draft: Inventory, vehicle: string, location: string): void {
  for (const entry of draft.placed) {
    if (entry.kind === "vehicle" && entry.target === vehicle) entry.location = location;
  }
  const tag = `vehicle:${vehicle}`;
  for (const object of Object.values(draft.objects)) {
    if (object.holder === tag) object.location = location;
  }
}

function moveObject(
  draft: Inventory,
  id: string,
  holder: string,
  location: string | null,
  now: number,
  reason: string,
): void {
  const object = draft.objects[id];
  if (!object) return;
  if (object.holder === "consumed" && holder !== "consumed") return;
  object.holder = holder;
  object.location = location;
  object.changedAt = now;
  object.lastChange = reason.slice(0, 240);
}

export function takeFromBackpack(draft: Inventory, id: string): boolean {
  const count = draft.backpack[id] ?? 0;
  if (count < 1) return false;
  if (count === 1) Reflect.deleteProperty(draft.backpack, id);
  else draft.backpack[id] = count - 1;
  return true;
}
const take = takeFromBackpack;

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
  npcs: NpcState["npcs"] = {},
): ApplyOutcome {
  let def = catalog.get(command.id) ?? draft.objects[command.id]?.definition;
  if (command.weaponState !== undefined && command.action !== "gain") {
    return fail("只有获得物品时才能指定 weaponState");
  }
  if (command.definition !== undefined) {
    if (command.action !== "gain") return fail("只有首次获得物件时才能登记定义");
    if (def || draft.objects[command.id]) return fail("已有物件不可重新定义，直接使用原 id");
    if (command.definition.id !== command.id) return fail("物件定义的 id 必须与取得的 id 一致");
    if (!command.origin) return fail("新物件必须说明真实来源 origin");
    const parsed = ItemDefSchema.safeParse(command.definition);
    if (!parsed.success) return fail("新物件定义不完整");
    def = parsed.data;
    const initialWs = command.weaponState ?? defaultInstanceStateFromDef(def);
    if (initialWs) {
      const wsError = validateWeaponState(def, initialWs, catalog);
      if (wsError) return fail(wsError);
    }
    draft.objects[def.id] = {
      kind: "story",
      definition: def,
      origin: command.origin,
      holder: "world",
      location,
      changedAt: now,
      lastChange: command.reason.slice(0, 240),
      remaining: def.charges ?? null,
      ...(initialWs ? { weaponState: cloneWeaponState(initialWs) } : {}),
    };
  }
  if (!def) return fail(`未登记物件 ${command.id}：首次取得需提供 definition 与 origin`);
  const object = draft.objects[def.id];
  if (command.action === "gain" && command.definition === undefined) {
    if (object && command.weaponState !== undefined) {
      return fail("已有独立物件不能重新指定 weaponState");
    }
    if (!object) {
      const initialWs = command.weaponState ?? defaultInstanceStateFromDef(def);
      if (initialWs) {
        const wsError = validateWeaponState(def, initialWs, catalog, true);
        if (wsError) return fail(wsError);
        if (!isCleanWeaponState(initialWs)) {
          const instanceId = materializeWeapon(
            draft,
            def,
            initialWs,
            command.origin ?? command.reason,
            command.reason,
            now,
          );
          put(draft, instanceId);
          return {
            ok: true,
            notes: [def.iconic ? `获得不朽物品：${def.name}` : `获得 ${def.name}`],
            emit: [],
          };
        }
      }
    }
  }
  const fromNpc = object
    ? Object.values(npcs).find((n) => n.id === object.holder || n.name === object.holder)
    : undefined;
  const toNpc = command.recipient
    ? Object.values(npcs).find((n) => n.id === command.recipient || n.name === command.recipient)
    : undefined;
  if (command.action === "lose" && toNpc) {
    if (toNpc.location !== null && toNpc.location !== location)
      return fail(`${toNpc.name}不在这里，不能隔空交付物品`);
    if (toNpc.body?.gear.includes(def.id))
      return fail(`${toNpc.name}已经持有同款物品，不能把另一件合并丢失`);
  }
  if (command.action === "gain" && object) {
    if (object.holder === "player") return fail("这件独立物件已经属于玩家，不能重复获得");
    if (object.holder === "consumed") return fail("这件物件已经耗尽，不能凭空重新获得");
    if (
      object.holder.startsWith("home:") ||
      object.holder.startsWith("vehicle:") ||
      object.holder.startsWith("place:")
    ) {
      return fail("这件物件留在了别处，在现场用 itemPlace take 取回");
    }
    const sourceLocation = fromNpc?.location ?? object.location;
    if (sourceLocation !== null && sourceLocation !== location)
      return fail("这件物件仍在别处，不能隔空取得");
    if (fromNpc && !fromNpc.body?.gear.includes(def.id))
      return fail("原持有人已不再带着这件物件，无法转交");
  }
  switch (command.action) {
    case "gain":
      put(draft, def.id);
      autoQuick(draft, def);
      moveObject(draft, def.id, "player", null, now, command.reason);
      return {
        ok: true,
        notes: [def.iconic ? `获得不朽物品：${def.name}` : `获得 ${def.name}`],
        emit: fromNpc ? [{ type: "npcGear", id: fromNpc.id, action: "remove", item: def.id }] : [],
      };
    case "lose": {
      const result = lose(draft, def);
      if (result.ok)
        moveObject(
          draft,
          def.id,
          toNpc?.id ?? command.recipient ?? "world",
          location,
          now,
          command.reason,
        );
      return result.ok && toNpc
        ? { ...result, emit: [{ type: "npcGear", id: toNpc.id, action: "add", item: def.id }] }
        : result;
    }
    case "equip":
      return equip(draft, def);
    case "unequip":
      return unequip(draft, def);
    case "use": {
      const result = use(draft, def);
      if (result.ok && def.kind === "consumable")
        moveObject(draft, def.id, "consumed", location, now, command.reason);
      return result;
    }
  }
}

/** 失去整件武器（含其已安装改装件） */
function lose(draft: Inventory, def: ItemDef): ApplyOutcome {
  const ws = draft.objects[def.id]?.weaponState;
  const hadMods = ws !== undefined && Object.values(ws.mods).some((m) => m !== undefined);
  const outcome = loseOne(draft, def);
  if (outcome.ok && hadMods) {
    return ok(`失去 ${def.name}（连同所装改装件）`);
  }
  return outcome;
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

function hasCarriedWeapon(draft: Inventory, weaponId: string): boolean {
  if ((draft.backpack[weaponId] ?? 0) >= 1) return true;
  return Object.entries(draft.backpack).some(
    ([id, count]) =>
      count >= 1 &&
      draft.objects[id]?.kind === "customized" &&
      draft.objects[id]?.weaponState?.baseId === weaponId,
  );
}

function equip(draft: Inventory, def: ItemDef): ApplyOutcome {
  const quick = quickSlotFor(def.kind);
  if (quick) return equipQuick(draft, def, quick);
  if (def.clothingSlot) return wear(draft, def, def.clothingSlot);
  if (def.kind !== "weapon") return fail(`${def.name} 不能装到装备栏`);
  if (!hasCarriedWeapon(draft, def.id)) return fail(`背包里没有 ${def.name}`);
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
  const charges = draft.objects[def.id]?.remaining ?? draft.depleted[def.id] ?? max;
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
  const charges = draft.objects[def.id]?.remaining ?? draft.depleted[def.id] ?? max;
  Reflect.deleteProperty(draft.depleted, def.id);
  draft[slot] = { id: def.id, charges, max };
}

function unequip(draft: Inventory, def: ItemDef): ApplyOutcome {
  if (def.kind === "weapon") {
    if (hasCarriedWeapon(draft, def.id)) return ok();
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
      return (draft.backpack[def.id] ?? 0) > 0
        ? ok(`使用 ${def.name}`)
        : fail(`背包里没有 ${def.name}`);
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
  const object = draft.objects[held.id];
  if (object) object.remaining = held.charges;
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

/** 每批进几件（本作改编）：治疗品和手雷 5，普通和没标稀有度的 3，uncommon 2，rare 及以上 1 */
export function stockOf(def: ItemDef): number {
  if (quickSlotFor(def.kind)) return 5;
  if (def.rarity === undefined || def.rarity === "common") return 3;
  if (def.rarity === "uncommon") return 2;
  return 1;
}

/** 未另行约定时的收购参考价；没有标价则须先谈妥报价。 */
export function sellValue(def: ItemDef): number {
  if (def.price === undefined) return 0;
  return Math.floor((def.price * SELL_RATE) / 10) * 10;
}

/** 改装件：attach 从背包装到武器上（必要时按需物化为独立实例），同位置的旧件放回背包；detach 拆下放回背包并在空净时折叠还原 */
export function applyMod(
  draft: Inventory,
  action: "attach" | "detach",
  weaponId: string,
  modId: string,
  catalog: ReadonlyMap<string, ItemDef>,
  now = 0,
): ApplyOutcome {
  const obj = draft.objects[weaponId];
  const weapon = obj?.definition ?? catalog.get(weaponId);
  const mod = catalog.get(modId);
  if (weapon?.kind !== "weapon" || weapon.category === undefined) {
    return fail(`物品表里没有武器 ${weaponId}`);
  }
  if (mod?.kind !== "mod" || mod.modSlot === undefined) {
    return fail(`物品表里没有改装件 ${modId}`);
  }
  if ((draft.backpack[weaponId] ?? 0) < 1 || (obj && obj.holder !== "player")) {
    return fail(`身上没有 ${weapon.name}`);
  }
  const slot = mod.modSlot;
  if (action === "detach") {
    const fitted = obj?.weaponState?.mods;
    if (!obj?.weaponState || fitted?.[slot] !== modId) {
      return fail(`${weapon.name} 上没装 ${mod.name}`);
    }
    if (obj.weaponState.lockedSlots.includes(slot)) {
      return fail(`${weapon.name} 的${MOD_SLOT_LABELS[slot]}已锁定，需前往枪匠工坊改动`);
    }
    Reflect.deleteProperty(obj.weaponState.mods, slot);
    put(draft, modId);
    obj.changedAt = now;
    obj.lastChange = `拆下 ${mod.name}`;
    foldBackWeapon(draft, weaponId);
    return ok(`从 ${weapon.name} 上拆下 ${mod.name}，放回背包`);
  }
  const check = canAttachMod(weapon, mod, obj?.weaponState);
  if (!check.ok) return fail(check.reason);
  if (obj?.weaponState?.mods[slot] === modId) {
    return fail(`${weapon.name} 上已经装着 ${mod.name}`);
  }
  if (!take(draft, modId)) return fail(`背包里没有 ${mod.name}`);
  if (obj) {
    if (!obj.weaponState) {
      obj.weaponState = {
        baseId: weapon.id,
        mods: { ...(weapon.preInstalledMods ?? {}) },
        lockedSlots: [...(weapon.lockedModSlots ?? [])],
      };
    }
    const old = obj.weaponState.mods[slot];
    if (old !== undefined) put(draft, old);
    obj.weaponState.mods[slot] = modId;
    obj.changedAt = now;
    obj.lastChange = `加装 ${mod.name}`;
    return ok(
      `${mod.name} 装到 ${weapon.name} 的${MOD_SLOT_LABELS[slot]}${old === undefined ? "" : "，换下的放回背包"}`,
    );
  }
  if (!take(draft, weaponId)) {
    put(draft, modId);
    return fail(`身上没有 ${weapon.name}`);
  }
  const initialWs: WeaponInstanceState = {
    baseId: weapon.id,
    mods: { ...(weapon.preInstalledMods ?? {}), [slot]: modId },
    lockedSlots: [...(weapon.lockedModSlots ?? [])],
  };
  const instanceId = materializeWeapon(
    draft,
    weapon,
    initialWs,
    `由${weapon.name}加装改装件定制`,
    `加装 ${mod.name}`,
    now,
  );
  put(draft, instanceId);
  return ok(`${mod.name} 装到 ${weapon.name} 的${MOD_SLOT_LABELS[slot]}`);
}

/** 物品现在的稀有度：精调过的按精调档位，没写稀有度的按普通 */
export function rarityOf(
  def: ItemDef,
  weaponState?: Pick<WeaponInstanceState, "tunedRarity">,
): Rarity {
  return weaponState?.tunedRarity ?? def.rarity ?? "common";
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
