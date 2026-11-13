import type { Draft } from "immer";
import type { ApplyOutcome, SystemContext, TimeSpan } from "../../kernel/system";
import { checkFact, rulingFact } from "../dice";
import { locationCatalog, type WorldClockState } from "../world";
import {
  ALERT_EXCLUDED_DISTRICTS,
  ALERT_INTERVAL,
  ALERT_TTL,
  ALERTS_MAX,
  AlertCatalogSchema,
  type AlertTemplate,
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
  const place = places[ctx.rng.roll(places.length) - 1] ?? places[0];
  if (!place) return;
  draft.alerts.push({
    id: `ncpd-${draft.nextId}`,
    template: template.id,
    label: template.label,
    note: template.note,
    district: place.district,
    location: place.id,
    reward: template.reward,
    risk: template.risk,
    postedAt: at,
    expiresAt: at + ALERT_TTL,
  });
  draft.nextId += 1;
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
  const here = location === null ? undefined : locationCatalog(ctx.data).get(location);
  if (here?.district !== alert.district)
    return fail(`这条警情在${alert.district}，现在不在那里：先过去再处理`);
  const check = checkFact(ctx.facts);
  if (check && (check.outcome === "failure" || check.outcome === "fumble"))
    return fail(
      "检定没过，警情没处理完：写对方跑了、人质出事或者 NCPD 先到的后果；警情还挂着，可以再试或者写 drop",
    );
  const ruling = check ? undefined : rulingFact(ctx.facts);
  if (ruling?.kind === "blocked") {
    return fail(ruling.reason ?? "现场局势被阻断，这起警情还没处理完");
  }
  draft.alerts.splice(index, 1);
  draft.cleared += 1;
  return {
    ok: true,
    notes: [`处理完警情：${alert.label}（${command.reason}）`],
    emit: [
      { type: "money", delta: alert.reward, reason: `NCPD 赏金：${alert.label}` },
      { type: "heat.relief", reason: `帮 NCPD 处理了${alert.label}` },
    ],
  };
}
