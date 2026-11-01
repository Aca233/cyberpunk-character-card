import type { Draft } from "immer";
import type { ApplyOutcome, SystemContext } from "../../kernel/system";
import { factionCatalog } from "./apply";
import {
  AgendaCatalogSchema,
  type AgendaSeed,
  type FactionsState,
  type FactionTurf,
  type FactionTurfTold,
  type TurfChange,
} from "./schema";

/**
 * 地盘账（用户 2026-11-01 定的「全改」第 4 步：模型当主持人，代码只管记账）：
 * 势力动向并进【城里在发酵的事】以后，势力这里只记地盘变过的几笔，谁拿下、谁丢了、玩家听说了没有
 */

type Data = Readonly<Record<string, unknown>>;

const catalogs = new WeakMap<object, ReadonlyMap<string, AgendaSeed>>();

/** 势力动向的种子表：开【城里在发酵的事】时的素材；没有时是空表 */
export function agendaCatalog(data: Data): ReadonlyMap<string, AgendaSeed> {
  const raw = data.agendas;
  if (typeof raw !== "object" || raw === null) return new Map();
  const cached = catalogs.get(raw);
  if (cached) return cached;
  const catalog = new Map(AgendaCatalogSchema.parse(raw).map((a) => [a.id, a] as const));
  catalogs.set(raw, catalog);
  return catalog;
}

/**
 * 一步能不能这样改地盘：只动一个城区；改的是这件事的势力或它的对头；
 * 照种子开的只在种子能争的城区里
 */
export function threadTurfProblem(
  owner: string,
  seed: AgendaSeed | undefined,
  change: TurfChange,
  turf: ReadonlyMap<string, readonly string[]>,
  data: Data = {},
): string | undefined {
  const rivals = seed?.rivals ?? factionCatalog(data).get(owner)?.enemies ?? [];
  if (change.faction !== owner && !rivals.includes(change.faction))
    return `${change.faction} 不是这件事的势力或它的对头`;
  if (seed && !seed.districts.includes(change.district))
    return `${change.district} 不在「${seed.title}」能争的城区里`;
  const has = (turf.get(change.faction) ?? []).includes(change.district);
  if (change.change === "gain" && has)
    return `${change.faction} 已经在 ${change.district} 有地盘了`;
  if (change.change === "lose" && !has)
    return `${change.faction} 在 ${change.district} 本来就没有地盘`;
  return undefined;
}

/**
 * 每个势力现在的地盘：势力卡上的，按时间先后加上拿下的、减去丢掉的。
 * toldOnly 只算玩家听说了的（玩家视图用），叙事模型看的是实际的
 */
export function currentTurf(
  state: FactionsState,
  data: Data,
  toldOnly = false,
): ReadonlyMap<string, readonly string[]> {
  const turf = new Map([...factionCatalog(data).values()].map((f) => [f.id, [...f.turf]]));
  const changes = [...state.turf].filter((r) => !toldOnly || r.told).sort((a, b) => a.at - b.at);
  for (const change of changes) {
    const list = turf.get(change.faction);
    if (!list) continue;
    const at = list.indexOf(change.district);
    if (change.change === "gain" && at < 0) list.push(change.district);
    if (change.change === "lose" && at >= 0) list.splice(at, 1);
  }
  return turf;
}

const fail = (reason: string): ApplyOutcome => ({ ok: false, reason });

/** 【城里在发酵的事】里一步改了地盘：由那边核对过再发来，这里只记 */
export function applyTurf(
  draft: Draft<FactionsState>,
  command: FactionTurf,
  ctx: SystemContext,
): ApplyOutcome {
  if (!factionCatalog(ctx.data).has(command.faction))
    return fail(`没有 ${command.faction} 这个势力`);
  draft.turf.push({
    at: ctx.now,
    thread: command.thread,
    faction: command.faction,
    district: command.district,
    change: command.change,
    told: false,
  });
  return { ok: true };
}

/** 那件事传到玩家耳朵里了：它带来的地盘变化也算听说了 */
export function applyTurfTold(draft: Draft<FactionsState>, command: FactionTurfTold): ApplyOutcome {
  for (const r of draft.turf) if (r.thread === command.thread) r.told = true;
  return { ok: true };
}
