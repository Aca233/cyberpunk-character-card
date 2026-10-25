import type { Draft } from "immer";
import type { ApplyOutcome, TimeSpan } from "../../kernel/system";
import {
  BOUNTY_MIN_STARS,
  BOUNTY_PER_STAR,
  BOUNTY_REASONS,
  BOUNTY_RESOLUTION_LABELS,
  type BountyCommand,
  BRIBE_PER_STAR,
  EVENT_LABELS,
  type EventCommand,
  type EventKind,
  HEAT_DECAY_MINUTES,
  HEAT_MAX,
  type HeatCommand,
  type HeatRelief,
  type HeatState,
  RECENT_EVENTS,
} from "./schema";

/** 被人看见时各类事件的基础热度；羞辱、背叛、救人、帮忙不惊动警察 */
const BASE_HEAT: Readonly<Record<EventKind, number>> = {
  kill: 2,
  publicViolence: 1,
  theft: 1,
  vandalism: 1,
  publicHack: 1,
  humiliate: 0,
  betray: 0,
  rescue: 0,
  help: 0,
};

const VIOLENT: ReadonlySet<EventKind> = new Set(["kill", "publicViolence"]);

/** 整星显示 */
export function shownStars(stars: number): number {
  return Math.floor(stars);
}

/** 按事件推导热度增量（星），附一句理由：公开或五人以上看见的暴力多涨一星；没人看见也没人报警不涨 */
export function heatDelta(event: EventCommand): { readonly delta: number; readonly why: string } {
  const base = BASE_HEAT[event.kind];
  if (base === 0) return { delta: 0, why: "这类事不惊动警察" };
  if (event.witnesses === 0 && !event.public && !event.reportedTo) {
    return { delta: 0, why: "没人看见" };
  }
  const loud = VIOLENT.has(event.kind) && (event.public || event.witnesses >= 5) ? 1 : 0;
  return { delta: base + loud, why: event.reportedTo ? "有人报了警" : "" };
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
  district: string | null,
  now: number,
): ApplyOutcome {
  const { delta, why } = heatDelta(event);
  const before = shownStars(draft.stars);
  draft.stars = Math.min(HEAT_MAX, draft.stars + delta);
  if (delta > 0) seen(draft, now);
  if (district !== null) draft.district = district;
  remember(draft, { at: now, kind: event.kind, delta, reason: event.reason });
  const after = shownStars(draft.stars);
  const label = EVENT_LABELS[event.kind];
  const bounty = VIOLENT.has(event.kind) && delta > 0 ? postBounty(draft, event.reason, now) : null;
  if (bounty) {
    const base =
      delta === 0 || before === after ? `警方热度 ${after} 星` : `警方热度 ${before} → ${after} 星`;
    return { ok: true, notes: [`${label}（${event.reason}）：${base}；${bounty}`] };
  }
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

/** 4 星以上的暴力大案：没有悬赏时挂一份，已有没了结的就加一份钱；返回提示，没挂时为 null */
function postBounty(draft: Draft<HeatState>, reason: string, now: number): string | null {
  if (shownStars(draft.stars) < BOUNTY_MIN_STARS) return null;
  if (!draft.bounties) draft.bounties = [];
  const open = draft.bounties.find((b) => b.resolvedAt === null);
  if (open) {
    open.reward += BOUNTY_PER_STAR;
    open.reasons.push(reason);
    if (open.reasons.length > BOUNTY_REASONS)
      open.reasons.splice(0, open.reasons.length - BOUNTY_REASONS);
    return `悬赏涨到 ${open.reward.toLocaleString("en-US")} 欧元`;
  }
  const reward = BOUNTY_PER_STAR * shownStars(draft.stars);
  draft.bounties.push({
    id: `bounty-${draft.bounties.length + 1}`,
    at: now,
    reward,
    reasons: [reason],
    hunter: null,
    resolvedAt: null,
    resolution: null,
  });
  return `大案留下了悬赏：${reward.toLocaleString("en-US")} 欧元，不会随时间消失，会有赏金猎人找上门`;
}

/** 赏金猎人登场或靠剧情了结悬赏 */
export function applyBounty(
  draft: Draft<HeatState>,
  command: BountyCommand,
  now: number,
): ApplyOutcome {
  const open = (draft.bounties ?? []).filter((b) => b.resolvedAt === null);
  if (open.length === 0) return { ok: false, reason: "现在没有悬赏" };
  const target =
    command.id === undefined
      ? open.length === 1
        ? open[0]
        : undefined
      : open.find((b) => b.id === command.id);
  if (!target)
    return {
      ok: false,
      reason: `要写悬赏 id；没了结的有：${open.map((b) => b.id).join("、")}`,
    };
  if (command.action === "hunter") {
    target.hunter = command.npc ?? null;
    return { ok: true, notes: [`赏金猎人 ${command.npc} 盯上了你（${command.reason}）`] };
  }
  const how = command.how ?? "settled";
  target.resolvedAt = now;
  target.resolution = how;
  return {
    ok: true,
    notes: [`悬赏了结：${BOUNTY_RESOLUTION_LABELS[how]}（${command.reason}）`],
  };
}

/** 帮 NCPD 办了事：降一星，不碰悬赏 */
export function applyRelief(draft: Draft<HeatState>, command: HeatRelief): ApplyOutcome {
  if (draft.stars === 0) return { ok: true, notes: [`${command.reason}：没有警方热度可降`] };
  const before = shownStars(draft.stars);
  draft.stars = Math.max(0, draft.stars - 1);
  return {
    ok: true,
    notes: [`${command.reason}：警方热度 ${before} → ${shownStars(draft.stars)} 星`],
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

/** 在自己的安全屋里一口气躲够这么久（分钟），多降一星（本作改编） */
export const HIDEOUT_MINUTES = 6 * 60;

/**
 * 时间推进：从最后一次被看见算起每满一个游戏日降一星（所以 3 星以上睡一觉也清不掉）；
 * 换了城区当天多降一星，每个游戏日最多一次；在自己的安全屋里躲满 6 小时也多降一星，每个游戏日最多一次
 */
export function tickHeat(
  draft: Draft<HeatState>,
  span: TimeSpan,
  district: string | null,
  hideout = false,
): void {
  if (draft.stars > 0 && draft.decayedAt !== null) {
    const days = Math.floor((span.to - draft.decayedAt) / HEAT_DECAY_MINUTES);
    if (days > 0) {
      draft.stars = Math.max(0, draft.stars - days);
      draft.decayedAt += days * HEAT_DECAY_MINUTES;
    }
  }
  if (hideout && draft.stars > 0 && span.to - span.from >= HIDEOUT_MINUTES) {
    const day = Math.floor(span.to / HEAT_DECAY_MINUTES);
    if (draft.hideoutDay !== day) {
      draft.stars = Math.max(0, draft.stars - 1);
      draft.hideoutDay = day;
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
