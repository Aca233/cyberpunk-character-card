import type { Draft } from "immer";
import type { ApplyOutcome, Command, SystemContext, TimeSpan } from "../../kernel/system";
import type { CityState } from "../city";
import { rulingFact } from "../dice";
import {
  type Attitude,
  attitudeLabel,
  currentAttitude,
  currentTurf,
  FactionsStateSchema,
  factionCatalog,
} from "../factions";
import type { HeatState } from "../heat";
import { locationCatalog, type WorldClockState } from "../world";
import {
  ALERT_EXCLUDED_DISTRICTS,
  ALERT_INTERVAL,
  ALERT_TTL,
  ALERTS_MAX,
  type Alert,
  AlertCatalogSchema,
  type AlertTemplate,
  NCPD_BOUNTY_BLOCK_STARS,
  type NcpdCommand,
  type NcpdState,
} from "./schema";

const catalogs = new WeakMap<object, readonly AlertTemplate[]>();

/** 读取并校验警情模板；没有时是空表 */
export function alertCatalog(data: Readonly<Record<string, unknown>>): readonly AlertTemplate[] {
  const raw = data.ncpdAlerts;
  if (typeof raw !== "object" || raw === null) return [];
  const cached = catalogs.get(raw);
  if (cached) return cached;
  const parsed = AlertCatalogSchema.parse(raw);
  catalogs.set(raw, parsed);
  return parsed;
}

const fail = (reason: string): ApplyOutcome => ({ ok: false, reason });

/** 按权重抽一个；rng.roll(n) 返回 1..n */
function pickWeighted<T extends { readonly weight: number }>(
  list: readonly T[],
  roll: (sides: number) => number,
): T | undefined {
  const total = list.reduce((s, t) => s + t.weight, 0);
  if (total <= 0) return undefined;
  let r = ((roll(1000) - 1) / 1000) * total;
  for (const t of list) {
    r -= t.weight;
    if (r < 0) return t;
  }
  return list.at(-1);
}

/** 在 at 时挂一条新警情；没有合适的地点时不挂 */
function post(draft: Draft<NcpdState>, at: number, ctx: SystemContext): void {
  const template = pickWeighted(alertCatalog(ctx.data), ctx.rng.roll.bind(ctx.rng));
  if (!template) return;
  const taken = new Set(draft.alerts.map((a) => a.location));
  const places = [...locationCatalog(ctx.data).values()].filter(
    (p) =>
      p.x !== undefined &&
      !ALERT_EXCLUDED_DISTRICTS.includes(p.district) &&
      (template.districts === undefined || template.districts.includes(p.district)) &&
      !taken.has(p.id),
  );
  if (places.length === 0) return;
  // 正在升温的城中局势所在城区给予 2x 权重加成，让街头治安与城中动荡产生呼应
  const hotDistricts = new Set(
    ctx
      .read<CityState>("city")
      .events.filter((e) => e.status === "heating" && e.district !== undefined)
      .map((e) => e.district as string),
  );
  const place =
    pickWeighted(
      places.map((p) => ({ place: p, weight: hotDistricts.has(p.district) ? 2 : 1 })),
      ctx.rng.roll.bind(ctx.rng),
    )?.place ?? places[0];
  if (!place) return;
  draft.alerts.push({
    id: `ncpd-${draft.nextId}`,
    template: template.id,
    label: template.label,
    note: template.note,
    district: place.district,
    location: place.id,
    ...(template.faction ? { faction: template.faction } : {}),
    gangRelated: template.gangRelated,
    reward: template.reward,
    risk: template.risk,
    postedAt: at,
    expiresAt: at + ALERT_TTL,
  });
  draft.nextId += 1;
}

export interface AlertFactionContext {
  readonly targetFactionId: string | null;
  readonly targetFactionName: string | null;
  readonly targetAttitude: Attitude | null;
  readonly targetAttitudeLabel: string | null;
  readonly isOwnFaction: boolean;
  readonly contested: boolean;
}

/** 动态解析警情牵扯的帮派势力与城区争夺态（随地盘易主实时变化） */
export function resolveAlertFaction(
  alert: Pick<Alert, "template" | "district" | "faction" | "gangRelated">,
  data: Readonly<Record<string, unknown>>,
  factionsSlice: unknown,
): AlertFactionContext {
  const factions = FactionsStateSchema.parse(factionsSlice ?? {});
  const catalog = factionCatalog(data);
  const contested = Boolean(factions.contested[alert.district]);
  const tpl = alertCatalog(data).find((t) => t.id === alert.template);
  const explicitId = alert.faction ?? tpl?.faction;
  const gangRelated = Boolean(alert.gangRelated || tpl?.gangRelated || explicitId);

  let target = explicitId ? catalog.get(explicitId) : undefined;
  if (!target && gangRelated) {
    const turf = currentTurf(factions, data, false);
    for (const def of catalog.values()) {
      if (def.kind !== "gang") continue;
      if ((turf.get(def.id) ?? def.turf).includes(alert.district)) {
        target = def;
        break;
      }
    }
  }

  const attitude = target ? currentAttitude(factions, target) : null;
  const attLabel = target && attitude ? attitudeLabel(target.kind, attitude) : null;
  const isOwnFaction = target !== undefined && factions.membership?.faction === target.id;

  return {
    targetFactionId: target?.id ?? null,
    targetFactionName: target?.name ?? null,
    targetAttitude: attitude,
    targetAttitudeLabel: attLabel,
    isOwnFaction,
    contested,
  };
}

/** 时间推进：撤掉过期的；每隔一段挂一条新的，最多同时挂几条 */
export function tickAlerts(draft: Draft<NcpdState>, span: TimeSpan, ctx: SystemContext): void {
  draft.alerts = draft.alerts.filter((a) => a.expiresAt > span.to);
  if (alertCatalog(ctx.data).length === 0) return;
  let next = draft.lastPostedAt === null ? span.to : draft.lastPostedAt + ALERT_INTERVAL;
  while (next <= span.to) {
    draft.lastPostedAt = next;
    // 跳过很久时，早就过期的不挂
    if (next + ALERT_TTL > span.to && draft.alerts.length < ALERTS_MAX) post(draft, next, ctx);
    next += ALERT_INTERVAL;
  }
}

export function applyNcpd(
  draft: Draft<NcpdState>,
  command: NcpdCommand,
  ctx: SystemContext,
): ApplyOutcome {
  const index = draft.alerts.findIndex((a) => a.id === command.id);
  const alert = draft.alerts[index];
  if (!alert)
    return fail(
      `没有这条警情；现在挂着的：${draft.alerts.map((a) => `${a.id} ${a.label}`).join("、") || "没有"}`,
    );
  if (command.action === "drop") {
    draft.alerts.splice(index, 1);
    return { ok: true, notes: [`警情撤掉了：${alert.label}（${command.reason}）`] };
  }
  const location = ctx.read<WorldClockState>("world").location;
  const origin = ctx.facts.actionStartLocation;
  // 结算可能在本轮移动后执行；允许在现场处理完再离开，不能只凭身处同一城区领赏。
  if (location !== alert.location && origin !== alert.location) {
    const place = locationCatalog(ctx.data).get(alert.location)?.name ?? alert.location;
    return fail(`这条警情在${place}（${alert.district}），本轮没有到场依据：先到现场处理`);
  }
  const ruling = rulingFact(ctx.facts);
  if (ruling?.kind === "blocked") {
    return fail(ruling.reason ?? "现场局势被阻断，这起警情还没处理完");
  }
  draft.alerts.splice(index, 1);
  draft.cleared += 1;
  const heat = ctx.read<HeatState>("heat");
  const bountyFrozen = (heat?.stars ?? 0) >= NCPD_BOUNTY_BLOCK_STARS;
  const factionsSlice = ctx.read("factions");
  const fctx = resolveAlertFaction(alert, ctx.data, factionsSlice);

  const emit: Command[] = [{ type: "heat.relief", reason: `帮 NCPD 处理了${alert.label}` }];
  const notes = [`处理完警情：${alert.label}（${command.reason}）`];
  if (bountyFrozen) {
    notes.push(`当前背负高星通缉（${heat.stars} 星），NCPD 冻结了外包赏金结算`);
  } else if (alert.reward > 0) {
    emit.push({ type: "money", delta: alert.reward, reason: `NCPD 赏金：${alert.label}` });
  }

  // 涉帮警情反向联动势力：端自家帮派场子直接记帮规污点；端别家帮派触发态度恶化
  if (fctx.targetFactionId && fctx.targetFactionName) {
    if (fctx.isOwnFaction) {
      emit.push({
        type: "faction",
        action: "strike",
        id: fctx.targetFactionId,
        reason: `替 NCPD 端了本帮在${alert.district}的${alert.label}`,
      });
      notes.push(`动了自家帮派${fctx.targetFactionName}的场子，已触发帮规污点`);
    } else if (fctx.targetAttitude === "friendly" || fctx.targetAttitude === "neutral") {
      emit.push({
        type: "faction",
        action: "stance",
        id: fctx.targetFactionId,
        attitude: fctx.targetAttitude === "friendly" ? "neutral" : "hostile",
        reason: `替 NCPD 清理了${fctx.targetFactionName}在${alert.district}的${alert.label}`,
      });
      notes.push(`${fctx.targetFactionName}记恨你替条子砸了场子`);
    }
  }

  // 累计协助 NCPD 满 3 起且当前中立，自动赢得 NCPD 友好外包口碑
  const ncpdDef = factionCatalog(ctx.data).get("ncpd");
  if (ncpdDef && draft.cleared >= 3) {
    const factions = FactionsStateSchema.parse(factionsSlice ?? {});
    if (currentAttitude(factions, ncpdDef) === "neutral") {
      emit.push({
        type: "faction",
        action: "stance",
        id: "ncpd",
        attitude: "friendly",
        reason: `累计协助 NCPD 摆平 ${draft.cleared} 起街头悬赏警情`,
      });
      notes.push("NCPD 对你建立了外包信任");
    }
  }

  return { ok: true, notes, emit };
}
