import type { Draft } from "immer";
import { districtLawFor, normalizeDistrictId } from "../../district-laws";
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
  type EventVictim,
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

/** 文本兜底识别受害/对抗对象身份（当模型未填 victim 时按 target 与 reason 判断） */
const NCPD_PATTERN = /ncpd|暴恐|maxtac|警察|警员|巡警|警车|警局|netwatch|网络监察|创伤小组|trauma/i;
const CORP_PATTERN =
  /荒坂|arasaka|军用科技|militech|康陶|kang[- ]?tao|生物技术|biotechnica|沛卓|petrochem|企业安保|公司安保|公司高管|公司特工|公司保安/i;
const GANG_PATTERN =
  /六街帮|sixth[- ]?street|漩涡帮|maelstrom|虎爪帮|tyger[- ]?claws|瓦伦蒂诺|valentinos|动物帮|animals|巫毒帮|voodoo[- ]?boys|莫克斯|mox|清道夫|scavengers?|夜游鬼|乱刀会|wraiths|幽冥犬|幽灵犬|barghest|帮派|混混|打手|暴徒|劫匪|掠夺者|毒贩|佣兵团/i;
const CIVILIAN_PATTERN = /平民|路人|市民|店主|店员|摊贩|医生|护士|无辜|居民|游客|服务员|司机/;

export interface HeatEventContext {
  readonly district?: string | null | undefined;
  readonly data?: Readonly<Record<string, unknown>> | undefined;
}

/** 整星显示 */
export function shownStars(stars: number): number {
  return Math.floor(stars);
}

/** 推断事件的受害对象类别：显式 victim 优先，否则结合势力表与 target/reason 关键词兜底 */
export function inferEventVictim(
  event: EventCommand,
  data?: Readonly<Record<string, unknown>>,
): EventVictim {
  if (event.victim) return event.victim;
  const hay = `${event.target ?? ""} ${event.reason}`;
  if (NCPD_PATTERN.test(hay)) return "ncpd";
  const rawFactions = data?.factions;
  if (Array.isArray(rawFactions)) {
    const lowerTarget = (event.target ?? "").trim().toLowerCase();
    for (const entry of rawFactions) {
      if (typeof entry !== "object" || entry === null) continue;
      const rec = entry as { id?: unknown; name?: unknown; kind?: unknown };
      if (typeof rec.id !== "string" || typeof rec.name !== "string") continue;
      if (
        (lowerTarget !== "" &&
          (lowerTarget === rec.id || lowerTarget.includes(rec.name.toLowerCase()))) ||
        hay.includes(rec.name) ||
        hay.toLowerCase().includes(rec.id)
      ) {
        if (rec.kind === "law" || rec.kind === "service") return "ncpd";
        if (rec.kind === "corp") return "corp";
        if (rec.kind === "gang") return "gang";
      }
    }
  }
  if (CORP_PATTERN.test(hay)) return "corp";
  if (GANG_PATTERN.test(hay)) return "gang";
  if (CIVILIAN_PATTERN.test(hay)) return "civilian";
  return "civilian";
}

/** 同时间戳（同回合）内本类事件最多允许累计的新增星数，防止按人数拆条瞬间飙到 5 星 */
function sameMomentCap(victim: EventVictim, kind: EventKind, securityTier: number): number {
  if (!VIOLENT.has(kind)) return 1.5;
  if (victim === "ncpd") return 3;
  if (victim === "gang") return securityTier >= 3 ? 2 : 1;
  if (victim === "corp") return securityTier >= 3 ? 2.5 : 2;
  return securityTier >= 3 ? 3 : 2;
}

/**
 * 按事件对象身份、目击/报警情况与城区警力等级推导热度增量（星）：
 * - 太平洲 / 恶土 / 狗镇无 NCPD 常规管辖，非针对 NCPD/暴恐不涨 NCPD 通缉星；
 * - 清剿敌对帮派在底/中安区很少惊动 NCPD（无报警且非闹市不涨，公开火并最多 +1 星）；
 * - 袭警、高安区公开动武或屠杀平民才会快速升星。
 */
export function heatDelta(
  event: EventCommand,
  ctx?: HeatEventContext,
): {
  readonly delta: number;
  readonly why: string;
  readonly victim: EventVictim;
  readonly securityTier: number;
} {
  const victim = inferEventVictim(event, ctx?.data);
  const districtId = normalizeDistrictId(ctx?.district);
  const law = districtLawFor(ctx?.data, districtId);
  const securityTier = law?.securityTier ?? 2;
  const base = BASE_HEAT[event.kind];
  if (base === 0) return { delta: 0, why: "这类事不惊动警察", victim, securityTier };

  const outsideNcpd = securityTier === 0 || districtId === "badlands" || districtId === "dogtown";
  if (outsideNcpd && victim !== "ncpd") {
    const placeLabel =
      districtId === "pacifica"
        ? "太平洲"
        : districtId === "badlands"
          ? "恶土"
          : districtId === "dogtown"
            ? "狗镇"
            : "法外城区";
    return {
      delta: 0,
      why: `${placeLabel}不在 NCPD 常规出警管辖内`,
      victim,
      securityTier,
    };
  }

  if (event.witnesses === 0 && !event.public && !event.reportedTo) {
    return { delta: 0, why: "没人看见", victim, securityTier };
  }

  if (victim === "gang" && VIOLENT.has(event.kind)) {
    if (event.reportedTo === "ncpd") {
      return {
        delta: securityTier >= 3 ? 1.5 : 1,
        why: "帮派冲突波及外界且有人报了警",
        victim,
        securityTier,
      };
    }
    if (securityTier <= 1) {
      if (event.public && event.witnesses >= 5) {
        return { delta: 1, why: "闹市帮派火并闹大，巡警迟缓响应", victim, securityTier };
      }
      if (event.public || event.witnesses >= 3) {
        return { delta: 0.5, why: "街头帮派火并，NCPD 在该区通常敷衍了事", victim, securityTier };
      }
      return { delta: 0, why: "低安区街头帮派火并，NCPD 懒得管", victim, securityTier };
    }
    if (securityTier === 2) {
      if (event.public || event.witnesses >= 5) {
        return { delta: 1, why: "帮派火并惊动街区巡警", victim, securityTier };
      }
      return { delta: 0.5, why: "帮派冲突动静不大，仅引起零星注意", victim, securityTier };
    }
    const highZoneDelta = event.public || event.witnesses >= 5 ? 2 : 1;
    return { delta: highZoneDelta, why: "高安保区动武清剿帮派", victim, securityTier };
  }

  if (victim === "ncpd" && VIOLENT.has(event.kind)) {
    const loud = event.public || event.witnesses >= 5 || event.reportedTo ? 1 : 0;
    return {
      delta: Math.min(3, base + loud),
      why: "袭击执法力量",
      victim,
      securityTier,
    };
  }

  if (victim === "corp" && VIOLENT.has(event.kind)) {
    const corpDelta =
      event.kind === "kill"
        ? securityTier >= 3
          ? event.public || event.witnesses >= 5
            ? 2.5
            : 2
          : 1.5
        : securityTier >= 3
          ? 1.5
          : 1;
    return {
      delta: corpDelta,
      why: event.reportedTo ? "企业安保联动 NCPD 报警" : "触动企业安保与警务联动",
      victim,
      securityTier,
    };
  }

  const loud =
    VIOLENT.has(event.kind) && (event.public || event.witnesses >= 5)
      ? securityTier >= 3
        ? 1
        : 0.5
      : 0;
  return {
    delta: base + loud,
    why: event.reportedTo ? "有人报了警" : "",
    victim,
    securityTier,
  };
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

/** 显示的星级真的涨了才记一条警方播报；封顶或只攒了半星不记 */
export function noticeRise(
  draft: Draft<HeatState>,
  before: number,
  after: number,
  now: number,
): void {
  if (after <= before) return;
  if (!draft.notices) draft.notices = [];
  if (!draft.nextNotice) draft.nextNotice = 1;
  draft.notices.push({ id: draft.nextNotice, at: now, before, after });
  draft.nextNotice += 1;
  if (draft.notices.length > RECENT_EVENTS) {
    draft.notices.splice(0, draft.notices.length - RECENT_EVENTS);
  }
}

export function applyEvent(
  draft: Draft<HeatState>,
  event: EventCommand,
  district: string | null,
  now: number,
  data?: Readonly<Record<string, unknown>>,
): ApplyOutcome {
  const computed = heatDelta(event, { district, data });
  // 同时间戳（同一场交火/同回合）防按人头拆条连乘暴涨：按该类事件同轮封顶裁剪增量
  const sameMomentAccumulated = draft.recent
    .filter((entry) => entry.at === now && entry.delta > 0)
    .reduce((sum, entry) => sum + entry.delta, 0);
  const cap = sameMomentCap(computed.victim, event.kind, computed.securityTier);
  const remaining = Math.max(0, cap - sameMomentAccumulated);
  const capped = computed.delta > remaining;
  const delta = Math.min(computed.delta, remaining);
  const why = capped && delta === 0 ? "同一场冲突的热度已结算，不按人头重复叠星" : computed.why;

  const before = shownStars(draft.stars);
  draft.stars = Math.min(HEAT_MAX, draft.stars + delta);
  if (delta > 0) seen(draft, now);
  if (district !== null) draft.district = district;
  remember(draft, { at: now, kind: event.kind, delta, reason: event.reason });
  const after = shownStars(draft.stars);
  noticeRise(draft, before, after, now);
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
      notes: [
        draft.stars >= HEAT_MAX
          ? `${label}（${event.reason}）：警方热度已经是 ${after} 星，到顶了，重新计时`
          : `${label}（${event.reason}）：警方热度仍为 ${after} 星${why ? `（${why}）` : ""}`,
      ],
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
