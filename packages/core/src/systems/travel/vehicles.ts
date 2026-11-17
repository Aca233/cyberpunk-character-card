import type { Draft } from "immer";
import type { ApplyOutcome, SystemContext } from "../../kernel/system";
import { rulingFact } from "../dice";
import { locationCatalog, WorldClockStateSchema } from "../world";
import {
  type OwnedVehicle,
  REPAIR_SHARE,
  type TravelState,
  VEHICLE_CONDITION_LABELS,
  VehicleCatalogSchema,
  type VehicleCommand,
  type VehicleDef,
  type VehicleGrant,
} from "./schema";

const catalogs = new WeakMap<object, ReadonlyMap<string, VehicleDef>>();

/** 读取并校验车型表；没有车型表时是空表 */
export function vehicleCatalog(
  data: Readonly<Record<string, unknown>>,
): ReadonlyMap<string, VehicleDef> {
  const raw = data.vehicles;
  if (typeof raw !== "object" || raw === null) return new Map();
  const cached = catalogs.get(raw);
  if (cached) return cached;
  const catalog = new Map(VehicleCatalogSchema.parse(raw).map((v) => [v.id, v] as const));
  catalogs.set(raw, catalog);
  return catalog;
}

/** 速度档折算开车的耗时：1 档最慢，5 档最快（本作改编） */
export const SPEED_FACTORS: Readonly<Record<number, number>> = {
  1: 1.3,
  2: 1.15,
  3: 1,
  4: 0.85,
  5: 0.7,
};
/** 受损的车开得慢一些 */
export const DAMAGED_FACTOR = 1.25;

/** 本次实际驾驶的车：明确点名，或现场同类可用车辆只有一辆时自动确定。 */
export function resolveVehicleAt<T extends OwnedVehicle>(
  vehicles: readonly T[],
  location: string | null,
  vehicle?: string,
  stolen?: boolean,
): { readonly ok: true; readonly vehicle: T } | { readonly ok: false; readonly reason: string } {
  if (location === null) return { ok: false, reason: "当前位置未知，无法确认车辆在场" };
  if (vehicle !== undefined) {
    const target = vehicles.find((v) => v.id === vehicle);
    if (!target) return { ok: false, reason: `名下没有 ${vehicle}` };
    if (target.location !== location) return { ok: false, reason: "指定车辆不在当前位置" };
    if (target.condition === "wrecked") return { ok: false, reason: "指定车辆已经报废，不能驾驶" };
    if (stolen !== undefined && target.stolen !== stolen)
      return {
        ok: false,
        reason: stolen ? "指定车辆不是偷来的车" : "指定车辆是偷来的车，请使用对应出行方式",
      };
    return { ok: true, vehicle: target };
  }
  const candidates = vehicles.filter(
    (v) =>
      v.location === location &&
      v.condition !== "wrecked" &&
      (stolen === undefined || v.stolen === stolen),
  );
  const only = candidates[0];
  if (candidates.length === 1 && only) return { ok: true, vehicle: only };
  return {
    ok: false,
    reason:
      candidates.length > 1
        ? "现场有多辆可用车辆，请在行动中点明要开的车辆"
        : "当前位置没有可驾驶车辆",
  };
}

/** 开这辆车时耗时乘的倍数 */
export function vehicleFactor(vehicle: OwnedVehicle, def: VehicleDef | undefined): number {
  const speed = SPEED_FACTORS[def?.speed ?? 3] ?? 1;
  return vehicle.condition === "damaged" ? speed * DAMAGED_FACTOR : speed;
}

const fail = (reason: string): ApplyOutcome => ({ ok: false, reason });

function nextId(draft: Draft<TravelState>, model: string): string {
  return `${model}-${draft.nextVehicleId++}`;
}

function currentLocation(ctx: SystemContext): string | null {
  return WorldClockStateSchema.parse(ctx.read("world")).location;
}

function locationName(ctx: SystemContext, id: string | null): string {
  if (id === null) return "未知地点";
  return locationCatalog(ctx.data).get(id)?.name ?? id;
}

export function grantVehicle(
  draft: Draft<TravelState>,
  command: VehicleGrant,
  ctx: SystemContext,
): ApplyOutcome {
  const def = vehicleCatalog(ctx.data).get(command.model);
  if (!def) return fail(`车型表里没有 ${command.model}`);
  const id = nextId(draft, def.id);
  draft.vehicles.push({
    id,
    model: def.id,
    condition: "intact",
    stolen: false,
    since: ctx.now,
    location: currentLocation(ctx),
    cargo: {},
  });
  return { ok: true, notes: [`有了一辆${def.name}（${command.reason}）`] };
}

export function applyVehicle(
  draft: Draft<TravelState>,
  command: VehicleCommand,
  ctx: SystemContext,
): ApplyOutcome {
  const catalog = vehicleCatalog(ctx.data);
  const name = (v: OwnedVehicle) => catalog.get(v.model)?.name ?? v.model;

  if (command.action === "buy" || command.action === "steal") {
    const def = catalog.get(command.model ?? "");
    if (!def) {
      return fail(
        `车型表里没有 ${command.model}；可选：${[...catalog.values()].map((v) => `${v.id}（${v.name}）`).join("、")}`,
      );
    }
    const owned = {
      id: nextId(draft, def.id),
      model: def.id,
      condition: "intact" as const,
      stolen: command.action === "steal",
      since: ctx.now,
      location: currentLocation(ctx),
      cargo: {},
    };
    if (command.action === "buy") {
      draft.vehicles.push(owned);
      return {
        ok: true,
        notes: [`买下${def.name}（${def.price} 欧元）`],
        emit: [{ type: "money", delta: -def.price, reason: `买车：${def.name}` }],
      };
    }
    const ruling = rulingFact(ctx.facts);
    if (ruling?.kind === "blocked") {
      return fail(ruling.reason ?? "车辆安防或现场条件阻断，没偷成");
    }
    draft.vehicles.push(owned);
    return {
      ok: true,
      notes: [`偷到一辆${def.name}`],
      emit: [
        {
          type: "event",
          kind: "theft",
          witnesses: command.witnesses ?? 0,
          public: true,
          reason: `偷车：${def.name}（${command.reason}）`,
        },
      ],
    };
  }

  const here = currentLocation(ctx);
  const relevantLocation =
    command.action === "damage" || command.action === "wreck" ? (command.location ?? here) : here;
  const candidates = draft.vehicles.filter((v) => {
    if (relevantLocation === null || v.location !== relevantLocation) return false;
    if (command.action === "repair") return v.condition === "damaged";
    if (command.action === "abandon") return true;
    return v.condition !== "wrecked";
  });
  if (command.vehicle === undefined && candidates.length > 1)
    return fail("相关地点有多辆候选车辆，请明确 vehicle，不会替你选另一辆");
  const target =
    command.vehicle !== undefined
      ? draft.vehicles.find((v) => v.id === command.vehicle)
      : candidates[0];
  if (!target) {
    return fail(
      command.vehicle !== undefined
        ? `名下没有 ${command.vehicle}；现有：${draft.vehicles.map((v) => v.id).join("、") || "没有车"}`
        : "相关地点没有可操作的车辆",
    );
  }

  switch (command.action) {
    case "damage":
    case "wreck": {
      if (target.condition === "wrecked") return fail(`${name(target)}已经报废了`);
      const incidentAt = command.location ?? here;
      if (incidentAt === null || target.location === null || incidentAt !== target.location)
        return fail(
          `${name(target)}停在${locationName(ctx, target.location)}，损坏地点与车辆位置不符`,
        );
      target.condition =
        command.action === "wreck" || target.condition === "damaged" ? "wrecked" : "damaged";
      return {
        ok: true,
        notes: [`${name(target)}${VEHICLE_CONDITION_LABELS[target.condition]}：${command.reason}`],
      };
    }
    case "repair": {
      if (here === null || target.location !== here)
        return fail(`${name(target)}停在${locationName(ctx, target.location)}，要修车得先到车旁`);
      if (target.condition === "wrecked") return fail(`${name(target)}报废了，修不了`);
      if (target.condition === "intact") return fail(`${name(target)}没坏`);
      const price = catalog.get(target.model)?.price ?? 10_000;
      const cost = Math.max(100, Math.round((price * REPAIR_SHARE) / 10) * 10);
      target.condition = "intact";
      return {
        ok: true,
        notes: [`修好${name(target)}（${cost} 欧元）`],
        emit: [{ type: "money", delta: -cost, reason: `修车：${name(target)}` }],
      };
    }
    case "abandon": {
      if (here === null || target.location !== here)
        return fail(`${name(target)}停在${locationName(ctx, target.location)}，要弃车得先到车旁`);
      if (Object.keys(target.cargo).length > 0)
        return fail(`${name(target)}后备箱还有物品，先取空再弃车`);
      draft.vehicles.splice(draft.vehicles.indexOf(target), 1);
      return { ok: true, notes: [`扔下${name(target)}：${command.reason}`] };
    }
    case "chase": {
      if (here === null || target.location !== here)
        return fail(`${name(target)}停在${locationName(ctx, target.location)}，不在身边`);
      if (target.condition === "wrecked") return fail(`${name(target)}报废了，开不了`);
      const ruling = rulingFact(ctx.facts);
      if (ruling?.kind === "blocked") {
        return fail(ruling.reason ?? "地形或对手堵死了路线，没能甩开");
      }
      return { ok: true, notes: [`开着${name(target)}甩开了：${command.reason}`] };
    }
  }
  return fail(`不认得的载具动作 ${command.action}`);
}

export function applyVehicleStash(
  draft: Draft<TravelState>,
  command: import("./schema").VehicleStash,
  ctx: SystemContext,
): ApplyOutcome {
  const target = draft.vehicles.find((vehicle) => vehicle.id === command.vehicle);
  const here = currentLocation(ctx);
  if (here === null || !target || target.location !== here)
    return fail("车辆不在当前位置，无法访问后备箱");
  if (command.action === "store") {
    if (target.condition === "wrecked") return fail("车辆已经报废，只能取出后备箱物品");
    target.cargo[command.item] = (target.cargo[command.item] ?? 0) + 1;
    return { ok: true };
  }
  const count = target.cargo[command.item] ?? 0;
  if (count < 1) return fail("后备箱里没有这件物品");
  if (count === 1) Reflect.deleteProperty(target.cargo, command.item);
  else target.cargo[command.item] = count - 1;
  return { ok: true };
}
