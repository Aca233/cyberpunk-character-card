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

/** 被人看见时各类事件的基础热度（全为 0.5 倍数）；羞辱、背叛、救人、帮忙不惊动警察 */
const BASE_HEAT: Readonly<Record<EventKind, number>> = {
  kill: 1,
  publicViolence: 0.5,
  theft: 0.5,
  vandalism: 0.5,
  publicHack: 0.5,
  humiliate: 0,
  betray: 0,
  rescue: 0,
  help: 0,
};

const VIOLENT: ReadonlySet<EventKind> = new Set(["kill", "publicViolence"]);

/** 同场冲突/同场景防连回合叠星的时间窗（游戏内分钟） */
const INCIDENT_WINDOW_MINUTES = 25;

/** 文本兜底识别受害/对抗对象身份（当模型未填 victim 时按 target 与 reason 判断） */
const NCPD_PATTERN = /ncpd|暴恐|maxtac|警察|警员|巡警|警车|警局|netwatch|网络监察|创伤小组|trauma/i;
const CORP_PATTERN =
  /荒坂|arasaka|军用科技|militech|康陶|kang[- ]?tao|生物技术|biotechnica|沛卓|petrochem|企业安保|公司安保|公司高管|公司特工|公司保安/i;
const GANG_PATTERN =
  /六街帮|sixth[- ]?street|漩涡帮|maelstrom|虎爪帮|tyger[- ]?claws|瓦伦蒂诺|valentinos|动物帮|animals|巫毒帮|voodoo[- ]?boys|莫克斯|mox|清道夫|scavengers?|夜游鬼|乱刀会|wraiths|幽冥犬|幽灵犬|barghest|帮派|混混|打手|暴徒|劫匪|掠夺者|毒贩|佣兵|雇佣兵|枪手|马仔|看门|保镖|赏金猎人|敌方|对手|黑客|义体疯子|赛博精神病|武装分子|杀手|强盗|头目/i;
const CIVILIAN_PATTERN = /平民|路人|市民|店主|店员|摊贩|医生|护士|无辜|居民|游客|服务员|司机/;

type ResolvedVictim = EventVictim | "unknown";

export interface HeatEventContext {
  readonly district?: string | null | undefined;
  readonly data?: Readonly<Record<string, unknown>> | undefined;
}

/** 整星显示 */
export function shownStars(stars: number): number {
  return Math.floor(stars);
}

/** 推断事件的受害对象类别：显式 victim 优先，否则结合势力表与关键词兜底；无法判定时归 unknown，不再误判成无辜平民 */
function resolveEventVictim(
  event: EventCommand,
  data?: Readonly<Record<string, unknown>>,
): ResolvedVictim {
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
  return "unknown";
}

export function inferEventVictim(
  event: EventCommand,
  data?: Readonly<Record<string, unknown>>,
): EventVictim {
  const resolved = resolveEventVictim(event, data);
  return resolved === "unknown" ? "gang" : resolved;
}

/** 同一场冲突（25 分钟时间窗内）最多允许累计的新增星数，防止多回合持续交火反复叠星瞬间飙到 5 星 */
function incidentCap(
  victim: ResolvedVictim,
  kind: EventKind,
  securityTier: number,
  reported: boolean,
): number {
  if (!VIOLENT.has(kind)) return reported || securityTier >= 3 ? 1 : 0.5;
  if (victim === "ncpd") return 2;
  if (victim === "gang") {
    if (securityTier <= 1) return reported ? 1 : 0.5;
    if (securityTier === 2) return 1;
    return 1.5;
  }
  if (victim === "unknown") return securityTier >= 3 ? 1.5 : 1;
  if (victim === "corp") return securityTier >= 3 ? 2 : 1.5;
  return securityTier >= 3 ? 2 : 1.5;
}

/**
 * 按事件对象身份、目击/报警情况与城区警力等级推导热度增量（星，均为 0.5 倍数）：
 * - 太平洲 / 恶土 / 狗镇无 NCPD 常规管辖，非针对 NCPD/暴恐不涨 NCPD 通缉星；
 * - 常规无线快速破解对路人不可见，仅在报警、波及公共/警用设施或高安区公开闹大时轻度涨星；
 * - 清剿帮派在低/中安区很少惊动 NCPD（未报警多为 0~0.5 星，闹大或报警最多 1 星）；
 * - 袭警、高安区公开动武或伤害无辜平民按 1~1.5 星稳步抬升，避免一两回合瞬间满星。
 */
export function heatDelta(
  event: EventCommand,
  ctx?: HeatEventContext,
): {
  readonly delta: number;
  readonly why: string;
  readonly victim: EventVictim;
  readonly resolvedVictim: ResolvedVictim;
  readonly securityTier: number;
} {
  const resolvedVictim = resolveEventVictim(event, ctx?.data);
  const victim: EventVictim = resolvedVictim === "unknown" ? "gang" : resolvedVictim;
  const districtId = normalizeDistrictId(ctx?.district);
  const law = districtLawFor(ctx?.data, districtId);
  const securityTier = law?.securityTier ?? 2;
  const base = BASE_HEAT[event.kind];
  if (base === 0)
    return { delta: 0, why: "这类事不惊动警察", victim, resolvedVictim, securityTier };

  const outsideNcpd = securityTier === 0 || districtId === "badlands" || districtId === "dogtown";
  if (outsideNcpd && resolvedVictim !== "ncpd") {
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
      resolvedVictim,
      securityTier,
    };
  }

  if (event.witnesses === 0 && !event.public && !event.reportedTo) {
    return { delta: 0, why: "没人看见", victim, resolvedVictim, securityTier };
  }

  // 非暴力事件：publicHack / theft / vandalism
  if (!VIOLENT.has(event.kind)) {
    if (event.kind === "publicHack") {
      if (event.reportedTo === "ncpd" || resolvedVictim === "ncpd") {
        return {
          delta: securityTier >= 3 ? 1 : 0.5,
          why: "骇入行为触发警务/网络监察告警",
          victim,
          resolvedVictim,
          securityTier,
        };
      }
      if (resolvedVictim === "gang" || resolvedVictim === "unknown") {
        return {
          delta: securityTier >= 3 && event.public ? 0.5 : 0,
          why:
            securityTier >= 3 && event.public
              ? "高安区公开无线骇入引起安防留意"
              : "近距无线破解隐蔽性高，未惊动 NCPD",
          victim,
          resolvedVictim,
          securityTier,
        };
      }
      return {
        delta: event.public || securityTier >= 3 ? 0.5 : 0,
        why: event.public || securityTier >= 3 ? "公共网络异常接入被记录" : "动静较小，未惊动巡警",
        victim,
        resolvedVictim,
        securityTier,
      };
    }
    const pettyDelta =
      event.reportedTo === "ncpd" ||
      resolvedVictim === "ncpd" ||
      (securityTier >= 3 && event.public)
        ? 1
        : 0.5;
    return {
      delta: pettyDelta,
      why: event.reportedTo
        ? "有人报了警"
        : securityTier >= 3
          ? "高安区治安巡检较严"
          : "引起街区巡警留意",
      victim,
      resolvedVictim,
      securityTier,
    };
  }

  if (resolvedVictim === "gang") {
    if (event.reportedTo === "ncpd") {
      return {
        delta: securityTier >= 3 ? 1 : 0.5,
        why: "帮派冲突波及外界且有人报了警",
        victim,
        resolvedVictim,
        securityTier,
      };
    }
    if (securityTier <= 1) {
      if (event.public && event.witnesses >= 5) {
        return {
          delta: 0.5,
          why: "闹市帮派火并闹大，巡警迟缓响应",
          victim,
          resolvedVictim,
          securityTier,
        };
      }
      return {
        delta: 0,
        why: "低安区街头帮派火并，NCPD 懒得管",
        victim,
        resolvedVictim,
        securityTier,
      };
    }
    if (securityTier === 2) {
      if (event.public && event.witnesses >= 4) {
        return {
          delta: 0.5,
          why: "街头帮派火并引起巡警留意",
          victim,
          resolvedVictim,
          securityTier,
        };
      }
      return {
        delta: 0,
        why: "帮派内斗未波及市民，NCPD 暂未介入",
        victim,
        resolvedVictim,
        securityTier,
      };
    }
    const highZoneDelta = event.public && event.witnesses >= 5 ? 1 : 0.5;
    return {
      delta: highZoneDelta,
      why: "高安保区动武清剿帮派",
      victim,
      resolvedVictim,
      securityTier,
    };
  }

  if (resolvedVictim === "ncpd") {
    const severe =
      event.kind === "kill" || event.public || event.witnesses >= 5 || Boolean(event.reportedTo);
    return {
      delta: severe ? 1.5 : 1,
      why: "袭击执法力量",
      victim,
      resolvedVictim,
      securityTier,
    };
  }

  if (resolvedVictim === "corp") {
    const corpDelta =
      event.kind === "kill"
        ? securityTier >= 3 && (event.public || event.witnesses >= 5)
          ? 1.5
          : 1
        : securityTier >= 3
          ? 1
          : 0.5;
    return {
      delta: corpDelta,
      why: event.reportedTo ? "企业安保联动 NCPD 报警" : "触动企业安保与警务联动",
      victim,
      resolvedVictim,
      securityTier,
    };
  }

  if (resolvedVictim === "unknown") {
    if (securityTier <= 1 && !event.reportedTo && !event.public) {
      return {
        delta: 0,
        why: "低安区暗处冲突，NCPD 未介入",
        victim,
        resolvedVictim,
        securityTier,
      };
    }
    const unknownDelta =
      event.kind === "kill" && (event.public || event.witnesses >= 5 || Boolean(event.reportedTo))
        ? 1
        : 0.5;
    return {
      delta: unknownDelta,
      why: event.reportedTo ? "冲突有人报警" : "街头冲突引起巡警注意",
      victim,
      resolvedVictim,
      securityTier,
    };
  }

  // 确认伤害无辜平民（civilian）
  const loud = event.public || event.witnesses >= 5 || Boolean(event.reportedTo);
  const civilianDelta =
    event.kind === "kill" ? (securityTier >= 3 && loud ? 1.5 : 1) : loud ? 1 : 0.5;
  return {
    delta: civilianDelta,
    why: event.reportedTo ? "伤及平民且有人报了警" : "伤及无辜平民",
    victim,
    resolvedVictim,
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
  draft.hideoutSince = null;
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
  // 同城区 25 分钟同场冲突窗口内防按人头拆条或多回合持续交火反复叠星：按本类事件同场封顶裁剪增量
  const sameDistrict = district === null || draft.district === null || district === draft.district;
  const sameIncidentAccumulated = sameDistrict
    ? draft.recent
        .filter(
          (entry) =>
            entry.delta > 0 && now >= entry.at && now - entry.at <= INCIDENT_WINDOW_MINUTES,
        )
        .reduce((sum, entry) => sum + entry.delta, 0)
    : 0;
  const cap = incidentCap(
    computed.resolvedVictim,
    event.kind,
    computed.securityTier,
    event.reportedTo === "ncpd",
  );
  const remaining = Math.max(0, cap - sameIncidentAccumulated);
  const capped = computed.delta > remaining;
  const delta = Math.min(computed.delta, remaining);
  const why = capped && delta === 0 ? "同一场冲突的热度已结算，不重复叠星" : computed.why;

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

/** 在自己的安全屋里连续躲够这么久（分钟），多降一星（本作改编） */
export const HIDEOUT_MINUTES = 6 * 60;

/**
 * 时间推进：从最后一次被看见算起每满一个游戏日降一星（所以 3 星以上睡一觉也清不掉）；
 * 换了城区当天多降一星，每个游戏日最多一次；在自己的安全屋里躲满 6 小时也多降一星，每个游戏日最多一次
 */
export function tickHeat(
  draft: Draft<HeatState>,
  span: TimeSpan,
  district: string | null,
  hideout?: boolean,
): void {
  if (hideout === true) draft.hideoutSince ??= span.from;
  else if (hideout === false) draft.hideoutSince = null;
  // 按实际生效时间依次结算自然衰减与躲藏；跨日长推进和多轮短推进使用同一条时间线。
  while (draft.stars > 0) {
    const naturalAt =
      draft.decayedAt === null ? Number.POSITIVE_INFINITY : draft.decayedAt + HEAT_DECAY_MINUTES;
    const hideoutAt =
      draft.hideoutSince === null
        ? Number.POSITIVE_INFINITY
        : Math.max(
            draft.hideoutSince + HIDEOUT_MINUTES,
            draft.hideoutDay === null
              ? Number.NEGATIVE_INFINITY
              : (draft.hideoutDay + 1) * HEAT_DECAY_MINUTES,
          );
    const next = Math.min(naturalAt, hideoutAt);
    if (next > span.to) break;
    draft.stars = Math.max(0, draft.stars - 1);
    if (naturalAt <= hideoutAt) draft.decayedAt = naturalAt;
    else draft.hideoutDay = Math.floor(hideoutAt / HEAT_DECAY_MINUTES);
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
