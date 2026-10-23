import type { Draft } from "immer";
import type { ApplyOutcome, Command } from "../../kernel/system";
import { HUMANITY_MAX } from "../humanity";
import {
  CyberwareCatalogSchema,
  type CyberwareCommand,
  type CyberwareDef,
  type CyberwareState,
  SLOT_LABELS,
} from "./schema";

const catalogs = new WeakMap<object, ReadonlyMap<string, CyberwareDef>>();

/** 读取并校验义体表；没有义体表时是空表 */
export function cyberwareCatalog(
  data: Readonly<Record<string, unknown>>,
): ReadonlyMap<string, CyberwareDef> {
  const raw = data.cyberware;
  if (typeof raw !== "object" || raw === null) return new Map();
  const cached = catalogs.get(raw);
  if (cached) return cached;
  const catalog = new Map<string, CyberwareDef>();
  for (const part of CyberwareCatalogSchema.parse(raw)) {
    if (catalog.has(part.id)) throw new Error(`义体表里的 id 重复：${part.id}`);
    catalog.set(part.id, part);
  }
  catalogs.set(raw, catalog);
  return catalog;
}

/** 装着的义体一共占掉多少人性上限 */
function costCommand(
  draft: Draft<CyberwareState>,
  catalog: ReadonlyMap<string, CyberwareDef>,
): Command {
  const total = draft.installed.reduce((sum, c) => sum + (catalog.get(c.id)?.humanityCost ?? 0), 0);
  return { type: "humanity.setCyberwareCost", total: Math.min(HUMANITY_MAX, total) };
}

export interface Purchase {
  readonly price: number;
  /** 身上现有的欧元 */
  readonly eddies: number;
  readonly event?: string | undefined;
}

/** 装上一件义体：同一部位的旧件换下来；买的要先付得起，钱交给欧元系统扣 */
export function install(
  draft: Draft<CyberwareState>,
  id: string,
  catalog: ReadonlyMap<string, CyberwareDef>,
  now: number,
  purchase?: Purchase,
): ApplyOutcome {
  const def = catalog.get(id);
  if (!def) return { ok: false, reason: `义体表里没有 ${id}` };
  if (draft.installed.some((c) => c.id === id)) {
    return { ok: false, reason: `${def.name}已经装着了` };
  }
  if (purchase && purchase.price > purchase.eddies) {
    return {
      ok: false,
      reason: `欧元不够：${def.name}要 ${purchase.price}，身上只有 ${purchase.eddies}`,
    };
  }
  const notes: string[] = [];
  const old = draft.installed.findIndex((c) => c.slot === def.slot);
  if (old >= 0) {
    const [prev] = draft.installed.splice(old, 1);
    if (prev) notes.push(`换下${catalog.get(prev.id)?.name ?? prev.id}`);
  }
  draft.installed.push({ id, slot: def.slot, installedAt: now });
  notes.push(`${SLOT_LABELS[def.slot]}装上${def.name}`);
  const emit: Command[] = [];
  if (purchase && purchase.price > 0) {
    emit.push({
      type: "money",
      delta: -purchase.price,
      reason: `安装义体：${def.name}`,
      ...(purchase.event ? { event: purchase.event } : {}),
    });
  }
  emit.push(costCommand(draft, catalog));
  return { ok: true, notes, emit };
}

export function remove(
  draft: Draft<CyberwareState>,
  id: string,
  catalog: ReadonlyMap<string, CyberwareDef>,
): ApplyOutcome {
  const name = catalog.get(id)?.name ?? id;
  const i = draft.installed.findIndex((c) => c.id === id);
  if (i < 0) return { ok: false, reason: `没有装着${name}` };
  draft.installed.splice(i, 1);
  return { ok: true, notes: [`卸下${name}`], emit: [costCommand(draft, catalog)] };
}

/** 模型的 cyberware 指令 */
export function applyCyberware(
  draft: Draft<CyberwareState>,
  command: CyberwareCommand,
  catalog: ReadonlyMap<string, CyberwareDef>,
  now: number,
  eddies: number,
): ApplyOutcome {
  if (command.event !== undefined && draft.settled.includes(command.event)) {
    return { ok: false, reason: `事件 ${command.event} 的义体已经结算过` };
  }
  const outcome =
    command.action === "install"
      ? install(draft, command.id, catalog, now, {
          price: command.price ?? catalog.get(command.id)?.price ?? 0,
          eddies,
          event: command.event && `cyberware:${command.event}`,
        })
      : remove(draft, command.id, catalog);
  if (outcome.ok && command.event !== undefined) draft.settled.push(command.event);
  return outcome;
}
