import type { Draft } from "immer";
import type { ApplyOutcome, SystemContext } from "../../kernel/system";
import {
  ATTITUDE_MAX_STEP,
  ATTITUDES,
  type Attitude,
  attitudeLabel,
  FactionCatalogSchema,
  type FactionCommand,
  type FactionDef,
  type FactionsState,
} from "./schema";

const catalogs = new WeakMap<object, ReadonlyMap<string, FactionDef>>();

/** 读取并校验势力表；没有势力表时是空表 */
export function factionCatalog(
  data: Readonly<Record<string, unknown>>,
): ReadonlyMap<string, FactionDef> {
  const raw = data.factions;
  if (typeof raw !== "object" || raw === null) return new Map();
  const cached = catalogs.get(raw);
  if (cached) return cached;
  const catalog = new Map(FactionCatalogSchema.parse(raw).map((f) => [f.id, f] as const));
  catalogs.set(raw, catalog);
  return catalog;
}

/** 现在的态度：变过的按记录，没变过的按势力卡 */
export function currentAttitude(state: FactionsState, def: FactionDef): Attitude {
  return state.stances[def.id]?.attitude ?? def.initial;
}

const fail = (reason: string): ApplyOutcome => ({ ok: false, reason });

export function applyFaction(
  draft: Draft<FactionsState>,
  command: FactionCommand,
  ctx: SystemContext,
): ApplyOutcome {
  const catalog = factionCatalog(ctx.data);
  const def = catalog.get(command.id);
  if (!def) return fail(`势力表里没有 ${command.id}；现有：${[...catalog.keys()].join("、")}`);
  const current = currentAttitude(draft as FactionsState, def);
  const now = attitudeLabel(def.kind, current);
  if (current === command.attitude) return fail(`${def.name}现在就是「${now}」，不用再写`);
  const step = Math.abs(ATTITUDES.indexOf(command.attitude) - ATTITUDES.indexOf(current));
  if (step > ATTITUDE_MAX_STEP)
    return fail(
      `态度一次最多变 ${ATTITUDE_MAX_STEP} 档：${def.name}现在是「${now}」，要变更多得再出一件事`,
    );
  draft.stances[def.id] = { attitude: command.attitude, reason: command.reason, at: ctx.now };
  return {
    ok: true,
    notes: [
      `${def.name}：${now} → ${attitudeLabel(def.kind, command.attitude)}（${command.reason}）`,
    ],
  };
}
