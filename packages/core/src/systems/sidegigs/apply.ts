import type { Draft } from "immer";
import type { ApplyOutcome, Command, SystemContext } from "../../kernel/system";
import type { TravelState } from "../travel";
import { resolveVehicleAt } from "../travel";
import { formatGameTime, locationCatalog, type WorldClockState } from "../world";
import {
  GIG_KIND_LABELS,
  GigCatalogSchema,
  type GigDef,
  OPPONENT_TIER_LABELS,
  REMATCH_MINUTES,
  type SidegigCommand,
  type SidegigsState,
  SidegigsStateSchema,
} from "./schema";

const fail = (reason: string): ApplyOutcome => ({ ok: false, reason });

const catalogs = new WeakMap<object, readonly GigDef[]>();

/** 拳赛和赛车表；没有这张表时为空 */
export function gigCatalog(data: Readonly<Record<string, unknown>>): readonly GigDef[] {
  const cached = catalogs.get(data);
  if (cached) return cached;
  const list = data.sidegigs === undefined ? [] : GigCatalogSchema.parse(data.sidegigs);
  catalogs.set(data, list);
  return list;
}

function rematchAt(state: Pick<SidegigsState, "record">, gig: string): number | null {
  const r = state.record[gig];
  if (!r || r.wins > 0 || r.lastAt === null) return null;
  return r.lastAt + REMATCH_MINUTES;
}

export function applySidegig(
  draft: Draft<SidegigsState>,
  command: SidegigCommand,
  ctx: SystemContext,
): ApplyOutcome {
  const gig = gigCatalog(ctx.data).find((g) => g.id === command.id);
  if (!gig) {
    const known = gigCatalog(ctx.data).map((g) => g.id);
    return fail(`没有叫 ${command.id} 的拳赛或赛车；有的是：${known.join("、") || "没有"}`);
  }
  const label = `${GIG_KIND_LABELS[gig.kind]}「${gig.name}」`;
  const record = draft.record[gig.id] ?? { wins: 0, losses: 0, lastAt: null };
  if (command.action === "enter") {
    if (draft.active !== null) {
      const now = gigCatalog(ctx.data).find((g) => g.id === draft.active?.gig);
      return fail(`${now?.name ?? draft.active.gig}还没比完，先写 win、lose 或 quit`);
    }
    if (record.wins > 0) return fail(`${gig.opponent}已经被你赢过，不会再跟你比`);
    const again = rematchAt(draft, gig.id);
    if (again !== null && ctx.now < again) {
      return fail(`刚输给${gig.opponent}，${formatGameTime(again)} 以后才肯再比`);
    }
    if (ctx.read<WorldClockState>("world").location !== gig.location) {
      return fail(`${label}不在这里，要去 ${gig.location}`);
    }
    let vehicle: string | undefined;
    if (gig.kind === "race") {
      const travel = ctx.read<TravelState>("travel");
      const car = resolveVehicleAt(travel.vehicles, gig.location, command.vehicle);
      if (!car.ok) return fail(`赛车要有车在场：${car.reason}`);
      vehicle = car.vehicle.id;
    }
    draft.active = { gig: gig.id, at: ctx.now, ...(vehicle ? { vehicle } : {}) };
    const emit: Command[] =
      gig.stake > 0
        ? [
            {
              type: "money",
              delta: -gig.stake,
              reason: `${label}的押金`,
              event: `gig:${gig.id}:stake:${ctx.now}`,
            },
          ]
        : [];
    return { ok: true, notes: [`报名${label}，对手${gig.opponent}`], emit };
  }
  if (draft.active?.gig !== gig.id) return fail(`现在没在比${label}；先写 enter`);
  draft.active = null;
  if (command.action === "win") {
    draft.record[gig.id] = { ...record, wins: record.wins + 1, lastAt: ctx.now };
    const district = locationCatalog(ctx.data).get(gig.location)?.district;
    const crowd = gig.kind === "fight" ? "地下拳场圈" : "街头飙车圈";
    const reach = gig.tier === "elite" ? "district" : "local";
    return {
      ok: true,
      notes: [`赢下${label}，打败${gig.opponent}`],
      emit: [
        {
          type: "money",
          delta: gig.purse,
          reason: `${label}的奖金`,
          event: `gig:${gig.id}:win`,
        },
        {
          type: "character.deed",
          id: `gig:${gig.id}:win`,
          summary: `在${gig.name}击败${gig.opponent}`,
          knownBy: [crowd, ...(district ? [`${district}街头`] : [])],
          reach,
          ...(district ? { district } : {}),
        },
      ],
    };
  }
  if (command.action === "lose") {
    draft.record[gig.id] = { ...record, losses: record.losses + 1, lastAt: ctx.now };
    return { ok: true, notes: [`输掉${label}，押金没了`] };
  }
  return { ok: true, notes: [`退出${label}，押金不退`] };
}

export function sidegigsView(
  slice: unknown,
  data: Readonly<Record<string, unknown>>,
  location: string | null,
  now: number,
) {
  const state = SidegigsStateSchema.parse(slice ?? {});
  const list = gigCatalog(data).map((g) => {
    const r = state.record[g.id];
    const again = rematchAt(state, g.id);
    return {
      id: g.id,
      kind: g.kind,
      kindLabel: GIG_KIND_LABELS[g.kind],
      name: g.name,
      opponent: g.opponent,
      location: g.location,
      tier: g.tier,
      tierLabel: OPPONENT_TIER_LABELS[g.tier],
      stake: g.stake,
      purse: g.purse,
      note: g.note,
      here: g.location === location,
      beaten: (r?.wins ?? 0) > 0,
      losses: r?.losses ?? 0,
      /** 输了之后要等到几点 */
      rematch: again !== null && now < again ? formatGameTime(again) : null,
    };
  });
  const active = state.active;
  return {
    active: active === null ? null : (list.find((g) => g.id === active.gig) ?? null),
    list,
  };
}
