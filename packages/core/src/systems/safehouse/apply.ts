import type { Draft } from "immer";
import { settleHousingRentBill } from "../../district-laws";
import type { ApplyOutcome, SystemContext, TimeSpan } from "../../kernel/system";
import { type CyberwareState, cyberwareCatalog } from "../cyberware";
import { rulingFact } from "../dice";
import type { EconomyState } from "../economy";
import { type InventoryState, itemCatalog, type PlacedKind, placedHolderTag } from "../inventory";
import type { NpcState } from "../npc";
import { type TravelState, vehicleCatalog } from "../travel";
import { locationCatalog, type WorldClockState } from "../world";
import {
  ApartmentCatalogSchema,
  type ApartmentDef,
  type Home,
  HomeCatalogSchema,
  type HomeCommand,
  type HomeDef,
  type ItemPlaceCommand,
  RENT_DEFAULT_PERIOD_DAYS,
  RENT_GRACE_DAYS,
  type SafehouseInternal,
  type SafehouseState,
} from "./schema";

const MINUTES_PER_DAY = 1440;

const fail = (reason: string): ApplyOutcome => ({ ok: false, reason });

type ResolvedTarget = {
  readonly kind: PlacedKind;
  readonly target: string;
  readonly location: string | null;
  readonly label: string;
};

function placeName(data: Readonly<Record<string, unknown>>, id: string | null): string {
  if (id === null) return "未知地点";
  return locationCatalog(data).get(id)?.name ?? id;
}

function resolveWhere(
  state: SafehouseState,
  command: ItemPlaceCommand,
  ctx: SystemContext,
): ResolvedTarget | string {
  const world = ctx.read<WorldClockState>("world");
  const here = world.location;
  const startLoc =
    typeof ctx.facts.actionStartLocation === "string" ? ctx.facts.actionStartLocation : null;
  const movedThisTurn =
    Boolean(ctx.facts.travel) || (startLoc !== null && here !== null && startLoc !== here);
  const blocked = rulingFact(ctx.facts)?.kind === "blocked";

  const reachable = (targetLoc: string | null, allowStopover = false): boolean => {
    if (targetLoc === null) return false;
    if (targetLoc === here || targetLoc === startLoc) return true;
    return allowStopover && movedThisTurn && !blocked;
  };

  const travel = ctx.read<TravelState>("travel");
  const models = vehicleCatalog(ctx.data);
  const npcs = ctx.read<NpcState>("npc").npcs;
  const inv = ctx.read<InventoryState>("inventory");
  const cyber = ctx.read<CyberwareState>("cyberware");
  const locations = locationCatalog(ctx.data);
  const where = command.where;

  if (where === undefined) {
    if (command.action === "take") {
      const part = cyber.parts[command.item];
      if (part) {
        const home = state.homes.find(
          (h) =>
            part.holder === `home:${h.id}` &&
            (homeAt(h, here, ctx.data) ||
              homeAt(h, startLoc, ctx.data) ||
              reachable(h.location, true)),
        );
        if (home) {
          if (home.locked) return `${home.name}因欠缴房租水电已被电子锁门，缴清后才能进门存取`;
          return { kind: "home", target: home.id, location: home.location, label: home.name };
        }
        const car = travel.vehicles.find(
          (v) =>
            part.holder === `vehicle:${v.id}` &&
            reachable(v.location, movedThisTurn && !v.abandoned),
        );
        if (car) {
          return {
            kind: "vehicle",
            target: car.id,
            location: car.location,
            label: models.get(car.model)?.name ?? car.model,
          };
        }
        if (part.holder.startsWith("place:") && reachable(part.location, movedThisTurn)) {
          const placeId = part.holder.slice("place:".length);
          return {
            kind: "place",
            target: placeId,
            location: part.location,
            label: placeName(ctx.data, placeId),
          };
        }
      }
      const candidates = inv.placed.filter((p) => p.item === command.item);
      const isAtHere = (p: (typeof candidates)[number]): boolean => {
        if (p.kind === "home") {
          const h = state.homes.find((x) => x.id === p.target);
          if (h && homeAt(h, here, ctx.data)) return true;
        }
        return p.location !== null && p.location === here;
      };
      const isAtStart = (p: (typeof candidates)[number]): boolean => {
        if (p.kind === "home") {
          const h = state.homes.find((x) => x.id === p.target);
          if (h && homeAt(h, startLoc, ctx.data)) return true;
        }
        return p.location !== null && p.location === startLoc;
      };
      const match =
        candidates.find(isAtHere) ??
        candidates.find(isAtStart) ??
        candidates.find(
          (p) =>
            movedThisTurn &&
            !blocked &&
            (p.kind === "home" ||
              (p.kind === "vehicle" && !travel.vehicles.find((v) => v.id === p.target)?.abandoned)),
        );
      if (match) {
        const home = match.kind === "home" ? state.homes.find((h) => h.id === match.target) : null;
        if (home?.locked) {
          return `${home.name}因欠缴房租水电已被电子锁门，缴清后才能进门存取`;
        }
        const car =
          match.kind === "vehicle" ? travel.vehicles.find((v) => v.id === match.target) : null;
        const npc = match.kind === "npc" ? npcs[match.target] : null;
        const label =
          home?.name ??
          (car ? (models.get(car.model)?.name ?? car.model) : undefined) ??
          npc?.name ??
          placeName(ctx.data, match.target);
        return { kind: match.kind, target: match.target, location: match.location, label };
      }
      return "附近没有记录着这件留置物品";
    }
    const localHome =
      state.homes.find((h) => homeAt(h, here, ctx.data)) ??
      (startLoc !== null ? state.homes.find((h) => homeAt(h, startLoc, ctx.data)) : undefined);
    if (localHome) {
      if (localHome.locked)
        return `${localHome.name}因欠缴房租水电已被电子锁门，缴清后才能进门存取`;
      return {
        kind: "home",
        target: localHome.id,
        location: localHome.location,
        label: localHome.name,
      };
    }
    if (here !== null) {
      return { kind: "place", target: here, location: here, label: placeName(ctx.data, here) };
    }
    return "当前位置未知，无法确认物品留在哪里";
  }

  const home = state.homes.find((h) => h.id === where || h.name === where);
  if (home) {
    if (home.locked) return `${home.name}因欠缴房租水电已被电子锁门，缴清后才能进门存取`;
    const canReachHome =
      homeAt(home, here, ctx.data) ||
      homeAt(home, startLoc, ctx.data) ||
      reachable(home.location, true);
    if (!canReachHome) return `人不在${home.name}，也没在这轮顺路回去`;
    return { kind: "home", target: home.id, location: home.location, label: home.name };
  }

  const car =
    travel.vehicles.find((v) => v.id === where) ??
    (() => {
      const matched = travel.vehicles.filter(
        (v) => !v.abandoned && models.get(v.model)?.name === where,
      );
      return matched.length === 1 ? matched[0] : undefined;
    })();
  if (car) {
    const carLabel = models.get(car.model)?.name ?? car.model;
    if (command.action === "leave" && (car.abandoned || car.condition === "wrecked")) {
      return `${carLabel}已报废或弃置，不能再往里放东西`;
    }
    if (!reachable(car.location, movedThisTurn && !car.abandoned)) {
      return `${carLabel}不在现场，够不着`;
    }
    return { kind: "vehicle", target: car.id, location: car.location, label: carLabel };
  }

  const npc = Object.values(npcs).find((n) => n.id === where || n.name === where);
  if (npc) {
    if (npc.location !== null && !reachable(npc.location, false)) {
      return `${npc.name}不在这里`;
    }
    return { kind: "npc", target: npc.id, location: npc.location ?? here, label: npc.name };
  }

  const locEntry = locations.get(where) ?? [...locations.values()].find((l) => l.name === where);
  if (locEntry) {
    if (!reachable(locEntry.id, movedThisTurn)) return `不在${locEntry.name}`;
    return { kind: "place", target: locEntry.id, location: locEntry.id, label: locEntry.name };
  }

  if (here !== null) {
    return { kind: "place", target: here, location: here, label: where };
  }
  return `找不到要留置或取回的位置 ${where}`;
}

export function applyItemPlace(
  draft: Draft<SafehouseState>,
  command: ItemPlaceCommand,
  ctx: SystemContext,
): ApplyOutcome {
  const resolved = resolveWhere(draft, command, ctx);
  if (typeof resolved === "string") return fail(resolved);

  const cyber = ctx.read<CyberwareState>("cyberware");
  const physical = cyber.parts[command.item];
  const inv = ctx.read<InventoryState>("inventory");
  const itemName =
    command.definition?.name ??
    (physical
      ? cyberwareCatalog(ctx.data).get(physical.model)?.name
      : (itemCatalog(ctx.data).get(command.item)?.name ??
        inv.objects[command.item]?.definition.name)) ??
    command.item;

  if (physical) {
    if (command.source === "worn" || command.source === "quick") {
      return fail("未安装义体不在穿着或快捷栏中，无法从该来源存放");
    }
    return {
      ok: true,
      notes: [
        command.action === "leave"
          ? `把${itemName}留在${resolved.label}（${command.reason}）`
          : `从${resolved.label}拿回${itemName}（${command.reason}）`,
      ],
      emit: [
        {
          type: "cyberware.place",
          part: command.item,
          action: command.action,
          holder: placedHolderTag(resolved.kind, resolved.target),
          location: resolved.location,
        },
      ],
    };
  }

  const count = command.count ?? 1;
  const qty = count > 1 ? `×${count}` : "";
  return {
    ok: true,
    notes: [
      command.action === "leave"
        ? `把${itemName}${qty}留在${resolved.label}（${command.reason}）`
        : `从${resolved.label}拿回${itemName}${qty}（${command.reason}）`,
    ],
    emit: [
      {
        type: "inventory.place",
        action: command.action,
        item: command.item,
        count,
        kind: resolved.kind,
        target: resolved.target,
        location: resolved.location,
        ...(command.source !== undefined ? { source: command.source } : {}),
        ...(command.note !== undefined ? { note: command.note } : {}),
        reason: command.reason,
        ...(command.definition !== undefined ? { definition: command.definition } : {}),
        ...(command.origin !== undefined ? { origin: command.origin } : {}),
      },
    ],
  };
}

export function applyHome(
  draft: Draft<SafehouseState>,
  command: HomeCommand,
  ctx: SystemContext,
): ApplyOutcome {
  if (command.action === "gain") {
    const here = ctx.read<WorldClockState>("world").location;
    const location = command.location ?? here;
    if (location === null) return fail("新增住所需要明确所在地点");
    const name = command.name ?? command.id;
    if (draft.homes.some((h) => h.id === command.id)) return { ok: true, notes: [] };
    draft.homes.push({
      id: command.id,
      name,
      location,
      since: ctx.now,
      tenure: "owned",
      locked: false,
    });
    return { ok: true, notes: [`新住处：${name}（${command.reason}）`] };
  }
  const index = draft.homes.findIndex((h) => h.id === command.id || h.name === command.id);
  if (index < 0) return fail(`没有叫 ${command.id} 的住所`);
  const [removed] = draft.homes.splice(index, 1);
  return { ok: true, notes: [`失去住处：${removed?.name ?? command.id}（${command.reason}）`] };
}

export function seedHome(
  draft: Draft<SafehouseState>,
  command: Extract<SafehouseInternal, { type: "safehouse.seed" }>,
  now: number,
): ApplyOutcome {
  if (draft.homes.some((h) => h.id === command.id)) return { ok: true, notes: [] };
  const tenure = command.tenure ?? "owned";
  const periodDays = command.rentPeriodDays ?? RENT_DEFAULT_PERIOD_DAYS;
  const entry: Home = {
    id: command.id,
    name: command.name,
    location: command.location,
    since: now,
    tenure,
    locked: false,
    ...(tenure === "rented"
      ? {
          rentAmount: command.rentAmount ?? 1200,
          rentPeriodDays: periodDays,
          rentPaidUntil: now + periodDays * MINUTES_PER_DAY,
        }
      : {}),
  };
  draft.homes.push(entry);
  return { ok: true, notes: [`住处：${command.name}`] };
}

/** 缴纳租住公寓一期水电房租：扣款并延展截止期，若已锁门同步解除锁门 */
export function payHomeRent(
  draft: Draft<SafehouseState>,
  command: Extract<SafehouseInternal, { type: "safehouse.payRent" }>,
  ctx: SystemContext,
): ApplyOutcome {
  const home = draft.homes.find((h) => h.id === command.id);
  if (!home) return fail(`没有叫 ${command.id} 的住所`);
  if (home.tenure !== "rented") return fail(`${home.name}是买断自有房产，不需要交房租`);
  const amount = home.rentAmount ?? 1200;
  const periodDays = home.rentPeriodDays ?? RENT_DEFAULT_PERIOD_DAYS;
  const eddies = ctx.read<EconomyState>("economy").eddies;
  const settled = settleHousingRentBill(home.name, amount, eddies);
  if (!settled.paid) return fail(settled.summary);
  const base = Math.max(ctx.now, home.rentPaidUntil ?? ctx.now);
  home.rentPaidUntil = base + periodDays * MINUTES_PER_DAY;
  home.locked = false;
  return {
    ok: true,
    notes: [settled.summary],
    emit: [{ type: "money", delta: -amount, reason: `缴纳${home.name}房租水电` }],
  };
}

/** 时间推进时检查租住公寓是否逾期超出宽限期，超期自动电子锁门断水电 */
export function tickSafehouse(draft: Draft<SafehouseState>, span: TimeSpan): void {
  const graceMinutes = RENT_GRACE_DAYS * MINUTES_PER_DAY;
  for (const home of draft.homes) {
    if (home.tenure !== "rented" || home.rentPaidUntil === undefined) continue;
    if (span.to >= home.rentPaidUntil + graceMinutes) {
      home.locked = true;
    }
  }
}

/** 能买下的公寓表；数据表里没有时为空 */
export function apartmentList(data: Readonly<Record<string, unknown>>): readonly ApartmentDef[] {
  const parsed = ApartmentCatalogSchema.safeParse(data.apartments);
  return parsed.success ? parsed.data : [];
}

/** 开局住所目录表；用于校验与住所连通的地图 POI 入口 */
export function homeCatalog(data: Readonly<Record<string, unknown>>): readonly HomeDef[] {
  const parsed = HomeCatalogSchema.safeParse(data.homes);
  return parsed.success ? parsed.data : [];
}

/** 玩家是否在某套可购公寓的对应地点或出租/公寓 POI */
export function apartmentAt(def: ApartmentDef, location: string | null | undefined): boolean {
  if (location == null) return false;
  return def.location === location || (def.poiIds?.includes(location) ?? false);
}

/** 玩家是否在某处已拥有住所的对应地点或连通 POI */
export function homeAt(
  home: { readonly id: string; readonly location: string },
  location: string | null | undefined,
  data: Readonly<Record<string, unknown>>,
): boolean {
  if (location == null) return false;
  if (home.location === location) return true;
  const homeDef = homeCatalog(data).find((d) => d.id === home.id);
  if (homeDef?.poiIds?.includes(location)) return true;
  const aptDef = apartmentList(data).find((d) => d.id === home.id);
  if (aptDef?.poiIds?.includes(location)) return true;
  return false;
}

/** 这处公寓为什么买不了；能买时为 undefined。同一个地点只算一处住所 */
export function apartmentLocked(
  homes: readonly { readonly id: string; readonly name: string; readonly location: string }[],
  def: ApartmentDef,
): string | undefined {
  if (homes.some((h) => h.id === def.id)) return `${def.name}已经是你的了`;
  const there = homes.find(
    (h) => h.location === def.location || (def.poiIds?.includes(h.location) ?? false),
  );
  if (there) return `这里已经有${there.name}，不用再买一处`;
  return undefined;
}
