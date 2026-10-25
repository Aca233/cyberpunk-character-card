import type { Draft } from "immer";
import type { ApplyOutcome, SystemContext } from "../../kernel/system";
import { checkFact } from "../dice";
import {
  type OwnedVehicle,
  REPAIR_SHARE,
  type TravelState,
  VEHICLE_CONDITION_LABELS,
  VEHICLES_MAX,
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

/** 正在开的那辆：最近一辆没报废的；stolen 给了时只看偷来的或只看自己的 */
export function activeVehicle(
  vehicles: readonly OwnedVehicle[],
  stolen?: boolean,
): OwnedVehicle | undefined {
  return [...vehicles]
    .reverse()
    .find((v) => v.condition !== "wrecked" && (stolen === undefined || v.stolen === stolen));
}

/** 开这辆车时耗时乘的倍数 */
export function vehicleFactor(vehicle: OwnedVehicle, def: VehicleDef | undefined): number {
  const speed = SPEED_FACTORS[def?.speed ?? 3] ?? 1;
  return vehicle.condition === "damaged" ? speed * DAMAGED_FACTOR : speed;
}

const fail = (reason: string): ApplyOutcome => ({ ok: false, reason });

function nextId(vehicles: readonly OwnedVehicle[], model: string): string {
  let n = 1;
  while (vehicles.some((v) => v.id === `${model}-${n}`)) n += 1;
  return `${model}-${n}`;
}

/** 本轮的门槛结果是不是这几项属性之一、有没有达标；没有门槛时是 undefined */
function gateMet(facts: Readonly<Record<string, unknown>>, attributes: readonly string[]) {
  const gate = facts.gate as { attribute?: unknown; met?: unknown } | undefined;
  if (gate === undefined || !attributes.includes(String(gate.attribute))) return undefined;
  return gate.met === true;
}

const failed = (outcome: string) => outcome === "failure" || outcome === "fumble";

export function grantVehicle(
  draft: Draft<TravelState>,
  command: VehicleGrant,
  ctx: SystemContext,
): ApplyOutcome {
  const def = vehicleCatalog(ctx.data).get(command.model);
  if (!def) return fail(`车型表里没有 ${command.model}`);
  draft.vehicles.push({
    id: nextId(draft.vehicles, def.id),
    model: def.id,
    condition: "intact",
    stolen: false,
    since: ctx.now,
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
    if (draft.vehicles.length >= VEHICLES_MAX)
      return fail(`名下最多 ${VEHICLES_MAX} 辆车，先 abandon 一辆`);
    const owned = {
      id: nextId(draft.vehicles, def.id),
      model: def.id,
      condition: "intact" as const,
      stolen: command.action === "steal",
      since: ctx.now,
    };
    if (command.action === "buy") {
      draft.vehicles.push(owned);
      return {
        ok: true,
        notes: [`买下${def.name}（${def.price} 欧元）`],
        emit: [{ type: "money", delta: -def.price, reason: `买车：${def.name}` }],
      };
    }
    const check = checkFact(ctx.facts);
    const gate = gateMet(ctx.facts, ["tech", "body"]);
    if (check === undefined && gate === undefined)
      return fail("偷车要先过技术（或肉体）门槛、或者掷骰：本轮没有门槛结果，也没有检定结果");
    if (check !== undefined ? failed(check.outcome) : gate === false)
      return fail("偷车没成：写车警报响、车主追来或者 NCPD 到场");
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

  const target =
    command.vehicle !== undefined
      ? draft.vehicles.find((v) => v.id === command.vehicle)
      : activeVehicle(draft.vehicles);
  if (!target) {
    return fail(
      command.vehicle !== undefined
        ? `名下没有 ${command.vehicle}；现有：${draft.vehicles.map((v) => v.id).join("、") || "没有车"}`
        : "名下没有能开的车",
    );
  }

  switch (command.action) {
    case "damage":
    case "wreck": {
      if (target.condition === "wrecked") return fail(`${name(target)}已经报废了`);
      target.condition =
        command.action === "wreck" || target.condition === "damaged" ? "wrecked" : "damaged";
      return {
        ok: true,
        notes: [`${name(target)}${VEHICLE_CONDITION_LABELS[target.condition]}：${command.reason}`],
      };
    }
    case "repair": {
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
      draft.vehicles.splice(draft.vehicles.indexOf(target), 1);
      return { ok: true, notes: [`扔下${name(target)}：${command.reason}`] };
    }
    case "chase": {
      if (target.condition === "wrecked") return fail(`${name(target)}报废了，开不了`);
      const check = checkFact(ctx.facts);
      if (check === undefined) return fail("追车要先掷反应：本轮没有检定结果");
      if (!failed(check.outcome))
        return { ok: true, notes: [`开着${name(target)}甩开了：${command.reason}`] };
      if (command.stake === "damage") {
        target.condition = target.condition === "damaged" ? "wrecked" : "damaged";
        return {
          ok: true,
          notes: [`追车失手，${name(target)}${VEHICLE_CONDITION_LABELS[target.condition]}`],
        };
      }
      if (command.stake === "heat") {
        return {
          ok: true,
          notes: ["追车失手，NCPD 盯上了"],
          emit: [
            {
              type: "event",
              kind: "publicViolence",
              witnesses: 10,
              public: true,
              reportedTo: "ncpd",
              reason: `追车：${command.reason}`,
            },
          ],
        };
      }
      return { ok: true, notes: ["追车失手，被拦下了：写把车逼停的人"] };
    }
  }
  return fail(`不认得的载具动作 ${command.action}`);
}
