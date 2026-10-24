import type { Draft } from "immer";
import type { ApplyOutcome, TimeSpan } from "../../kernel/system";
import {
  BRIBE_PER_STAR,
  DISTRICT_POLICE,
  EVENT_LABELS,
  type EventCommand,
  type EventKind,
  HEAT_DECAY_MINUTES,
  HEAT_MAX,
  type HeatCommand,
  type HeatState,
  type PoliceStrength,
  RECENT_EVENTS,
  type Zone,
} from "./schema";

/** 被人看见时各类事件的基础热度；羞辱、背叛、救人、帮忙不惊动警察，骇入公共网络记在网络监察那边（M2b） */
const BASE_HEAT: Readonly<Record<EventKind, number>> = {
  kill: 2,
  publicViolence: 1,
  theft: 1,
  vandalism: 1,
  publicHack: 0,
  humiliate: 0,
  betray: 0,
  rescue: 0,
  help: 0,
};

const VIOLENT: ReadonlySet<EventKind> = new Set(["kill", "publicViolence"]);

const POLICE_FACTOR: Readonly<Record<PoliceStrength, number>> = {
  strong: 1.5,
  normal: 1,
  weak: 0.5,
  none: 0,
};

const POLICE_LABELS: Readonly<Record<PoliceStrength, string>> = {
  strong: "警力强",
  normal: "",
  weak: "警力弱，减半",
  none: "NCPD 不管",
};

export function policeOf(district: string | null): PoliceStrength {
  return (district && DISTRICT_POLICE[district]) || "normal";
}

/** 整星显示 */
export function shownStars(stars: number): number {
  return Math.floor(stars);
}

export interface Place {
  readonly district: string | null;
  readonly zone: Zone;
}

/** 按事件、地点和城区警力推导热度增量（星，按半星取整），附一句理由 */
export function heatDelta(
  event: EventCommand,
  place: Place,
): { readonly delta: number; readonly why: string } {
  const base = BASE_HEAT[event.kind];
  if (base === 0) return { delta: 0, why: "这类事不惊动警察" };
  if (event.witnesses === 0 && !event.public && !event.reportedTo) {
    return { delta: 0, why: "没人看见" };
  }
  const police = policeOf(place.district);
  if (police === "none") return { delta: 0, why: POLICE_LABELS.none };
  const zone = event.reportedTo ? "street" : place.zone;
  if (zone === "corp") return { delta: 0, why: "公司产区里的事只算公司的账" };
  if (zone === "gang" && !VIOLENT.has(event.kind)) {
    return { delta: 0, why: "帮派地盘里的小事 NCPD 不管" };
  }
  const loud = VIOLENT.has(event.kind) && (event.public || event.witnesses >= 5) ? 1 : 0;
  const delta = Math.round((base + loud) * POLICE_FACTOR[police] * 2) / 2;
  const why = [event.reportedTo ? "有人报了警" : "", POLICE_LABELS[police]]
    .filter(Boolean)
    .join("，");
  return { delta, why };
}

function remember(draft: Draft<HeatState>, entry: HeatState["recent"][number]): void {
  draft.recent.push(entry);
  if (draft.recent.length > RECENT_EVENTS)
    draft.recent.splice(0, draft.recent.length - RECENT_EVENTS);
}

function seen(draft: Draft<HeatState>, now: number): void {
  draft.lastSeenAt = now;
  draft.decayedAt = now;
}

export function applyEvent(
  draft: Draft<HeatState>,
  event: EventCommand,
  place: Place,
  now: number,
): ApplyOutcome {
  const { delta, why } = heatDelta(event, place);
  const before = shownStars(draft.stars);
  draft.stars = Math.min(HEAT_MAX, draft.stars + delta);
  if (delta > 0) seen(draft, now);
  if (place.district !== null) draft.district = place.district;
  remember(draft, { at: now, kind: event.kind, delta, reason: event.reason });
  const after = shownStars(draft.stars);
  const label = EVENT_LABELS[event.kind];
  if (delta === 0)
    return { ok: true, notes: [`${label}（${event.reason}）：警方热度不变，${why}`] };
  if (before === after)
    return {
      ok: true,
      notes: [`${label}（${event.reason}）：警方热度已经是 ${after} 星，到顶了，重新计时`],
    };
  return {
    ok: true,
    notes: [
      `${label}（${event.reason}）：警方热度 ${before} → ${after} 星${why ? `（${why}）` : ""}`,
    ],
  };
}

/** 贿赂降一星的价钱 */
export function bribeCost(stars: number): number {
  return BRIBE_PER_STAR * Math.max(1, Math.ceil(stars));
}

export function applyHeat(
  draft: Draft<HeatState>,
  command: HeatCommand,
  now: number,
): ApplyOutcome {
  if (command.action === "seen") {
    if (draft.stars === 0) return { ok: true, notes: ["没有警方热度，被看见也不要紧"] };
    seen(draft, now);
    return { ok: true, notes: [`被看见了（${command.reason}）：警方热度重新计时`] };
  }
  if (draft.stars === 0) return { ok: false, reason: "没有警方热度，不用贿赂" };
  if (draft.stars >= HEAT_MAX) return { ok: false, reason: "5 星时贿赂不了，只能躲或者离开城区" };
  const cost = bribeCost(draft.stars);
  const before = shownStars(draft.stars);
  draft.stars = Math.max(0, draft.stars - 1);
  return {
    ok: true,
    notes: [`贿赂（${command.reason}）：警方热度 ${before} → ${shownStars(draft.stars)} 星`],
    emit: [{ type: "money", delta: -cost, reason: `贿赂警察：${command.reason}` }],
  };
}

/**
 * 时间推进：从最后一次被看见算起每满一个游戏日降一星（所以 3 星以上睡一觉也清不掉）；
 * 换了城区当天多降一星，每个游戏日最多一次
 */
export function tickHeat(draft: Draft<HeatState>, span: TimeSpan, district: string | null): void {
  if (draft.stars > 0 && draft.decayedAt !== null) {
    const days = Math.floor((span.to - draft.decayedAt) / HEAT_DECAY_MINUTES);
    if (days > 0) {
      draft.stars = Math.max(0, draft.stars - days);
      draft.decayedAt += days * HEAT_DECAY_MINUTES;
    }
  }
  if (district === null) return;
  if (draft.district !== null && district !== draft.district && draft.stars > 0) {
    const day = Math.floor(span.to / HEAT_DECAY_MINUTES);
    if (draft.districtDay !== day) {
      draft.stars = Math.max(0, draft.stars - 1);
      draft.districtDay = day;
    }
  }
  draft.district = district;
}
