import type { Draft } from "immer";
import type { ApplyOutcome, Command, SystemContext } from "../../kernel/system";
import {
  type Attitude,
  attitudeLabel,
  currentAttitude,
  FactionsStateSchema,
  factionCatalog,
} from "../factions";
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

interface SidegigFactionContext {
  readonly factionId: string | null;
  readonly factionName: string | null;
  readonly factionAttitude: Attitude | null;
  readonly factionAttitudeLabel: string | null;
  readonly isMember: boolean;
  readonly contested: boolean;
  readonly effectiveStake: number;
  readonly blockedReason: string | null;
}

/** 联动势力系统：解析主办/看场势力态度、本帮/友好押金特权、敌对禁赛与地盘火拼暂闭 */
function resolveSidegigFaction(
  gig: GigDef,
  data: Readonly<Record<string, unknown>>,
  factionsSlice: unknown,
  district: string | null,
): SidegigFactionContext {
  const factions = FactionsStateSchema.parse(factionsSlice ?? {});
  const contested = district !== null && Boolean(factions.contested[district]);
  const host = gig.faction ? factionCatalog(data).get(gig.faction) : undefined;
  const attitude = host ? currentAttitude(factions, host) : null;
  const isMember = host !== undefined && factions.membership?.faction === host.id;
  const attLabel = host && attitude ? attitudeLabel(host.kind, attitude) : null;

  let blockedReason: string | null = null;
  if (contested && district) {
    blockedReason = `${district}眼下正爆发地盘火拼，地下赛场暂时停办`;
  } else if (host && (attitude === "kos" || attitude === "hostile")) {
    blockedReason = `${host.name}眼下与你${attLabel ?? "敌对"}，拒绝你入场报名`;
  }

  let effectiveStake = gig.stake;
  if (host && gig.stake > 0) {
    if (isMember || attitude === "family") {
      effectiveStake = 0;
    } else if (attitude === "friendly") {
      effectiveStake = Math.max(50, Math.round((gig.stake * 0.7) / 50) * 50);
    }
  }

  return {
    factionId: host?.id ?? null,
    factionName: host?.name ?? null,
    factionAttitude: attitude,
    factionAttitudeLabel: attLabel,
    isMember,
    contested,
    effectiveStake,
    blockedReason,
  };
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
  const district = locationCatalog(ctx.data).get(gig.location)?.district ?? null;
  const fctx = resolveSidegigFaction(gig, ctx.data, ctx.read("factions"), district);

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
    if (fctx.blockedReason) return fail(fctx.blockedReason);
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
      fctx.effectiveStake > 0
        ? [
            {
              type: "money",
              delta: -fctx.effectiveStake,
              reason: `${label}的押金`,
              event: `gig:${gig.id}:stake:${ctx.now}`,
            },
          ]
        : [];
    const discountNote =
      fctx.factionName && fctx.effectiveStake === 0 && gig.stake > 0
        ? `（${fctx.factionName}自己人免押金）`
        : fctx.factionName && fctx.effectiveStake < gig.stake
          ? `（${fctx.factionName}熟人折扣，实付 ${fctx.effectiveStake} 欧元）`
          : "";
    return { ok: true, notes: [`报名${label}，对手${gig.opponent}${discountNote}`], emit };
  }
  if (draft.active?.gig !== gig.id) return fail(`现在没在比${label}；先写 enter`);
  draft.active = null;
  if (command.action === "win") {
    draft.record[gig.id] = { ...record, wins: record.wins + 1, lastAt: ctx.now };
    const crowd = gig.kind === "fight" ? "地下拳场圈" : "街头飙车圈";
    const reach = gig.tier === "elite" || gig.tier === "legend" ? "district" : "local";
    const emit: Command[] = [
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
        knownBy: [
          crowd,
          ...(fctx.factionName ? [fctx.factionName] : []),
          ...(district ? [`${district}街头`] : []),
        ],
        reach,
        ...(district ? { district } : {}),
      },
    ];
    const notes = [`赢下${label}，打败${gig.opponent}`];
    // 赢下有看场势力的中/高阶赛事时，若对方当前中立，赢得场子上下尊重（中立 -> 友好）
    if (
      fctx.factionId &&
      fctx.factionName &&
      fctx.factionAttitude === "neutral" &&
      gig.tier !== "street"
    ) {
      emit.push({
        type: "faction",
        action: "stance",
        id: fctx.factionId,
        attitude: "friendly",
        reason: `在${gig.name}击败${gig.opponent}，赢得场子上下尊重`,
      });
      notes.push(`${fctx.factionName}对你的身手刮目相看`);
    }
    return { ok: true, notes, emit };
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
  factionsSlice?: unknown,
) {
  const state = SidegigsStateSchema.parse(slice ?? {});
  const places = locationCatalog(data);
  const list = gigCatalog(data).map((g) => {
    const r = state.record[g.id];
    const again = rematchAt(state, g.id);
    const place = places.get(g.location);
    const district = place?.district ?? null;
    const fctx = resolveSidegigFaction(g, data, factionsSlice, district);
    return {
      id: g.id,
      kind: g.kind,
      kindLabel: GIG_KIND_LABELS[g.kind],
      name: g.name,
      opponent: g.opponent,
      location: g.location,
      locationName: place?.name ?? g.location,
      district,
      x: place?.x ?? null,
      y: place?.y ?? null,
      tier: g.tier,
      tierLabel: OPPONENT_TIER_LABELS[g.tier],
      stake: g.stake,
      effectiveStake: fctx.effectiveStake,
      purse: g.purse,
      note: g.note,
      factionId: fctx.factionId,
      factionName: fctx.factionName,
      factionAttitude: fctx.factionAttitude,
      factionAttitudeLabel: fctx.factionAttitudeLabel,
      isMember: fctx.isMember,
      contested: fctx.contested,
      blockedReason: fctx.blockedReason,
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
