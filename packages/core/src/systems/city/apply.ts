import type { Draft } from "immer";
import type { ApplyOutcome } from "../../kernel/system";
import {
  BULLETINS_KEPT,
  CITY_KEPT,
  type CityBulletinCommand,
  type CityEventCommand,
  type CityRumorCommand,
  type CityState,
  RUMORS_KEPT,
  type RumorHeard,
} from "./schema";

/** 记一条传闻：同样的原话不重复记；说的动静要对得上 */
export function applyRumor(
  draft: Draft<CityState>,
  command: CityRumorCommand,
  now: number,
): ApplyOutcome {
  const { type: _type, ...rumor } = command;
  if (rumor.event !== undefined && !draft.events.some((e) => e.id === rumor.event)) {
    return { ok: false, reason: `没有 id 为 ${rumor.event} 的动静` };
  }
  if (draft.rumors.some((r) => r.text === rumor.text)) return { ok: true };
  draft.rumors.push({ ...rumor, id: draft.nextRumor, at: now, heard: false });
  draft.nextRumor += 1;
  if (draft.rumors.length > RUMORS_KEPT) draft.rumors.splice(0, draft.rumors.length - RUMORS_KEPT);
  return { ok: true };
}

/** 正文里有人把一条传闻说给玩家听了：标成听说，之后进玩家的街头频道 */
export function applyRumorHeard(draft: Draft<CityState>, command: RumorHeard): ApplyOutcome {
  const rumor = draft.rumors.find((r) => r.id === command.id && r.id > 0);
  if (!rumor) return { ok: false, reason: `没有编号为 ${command.id} 的街头传闻` };
  if (rumor.heard) return { ok: true, notes: [`传闻 #${command.id} 玩家已经听说过了`] };
  rumor.heard = true;
  return { ok: true };
}

/** 记一段新闻快讯或电台插段，编号递增；玩家在侧栏「新闻」里看 */
export function applyBulletin(
  draft: Draft<CityState>,
  command: CityBulletinCommand,
  now: number,
): ApplyOutcome {
  const { type: _type, ...bulletin } = command;
  draft.bulletins.push({ ...bulletin, id: draft.nextBulletin, at: now });
  draft.nextBulletin += 1;
  if (draft.bulletins.length > BULLETINS_KEPT) {
    draft.bulletins.splice(0, draft.bulletins.length - BULLETINS_KEPT);
  }
  return { ok: true };
}

/** 按 id 合并：已有的整条替换、保留开始时间；尚不存在的事件若直接同步为 over 则安全忽略。 */
export function applyCityEvent(
  draft: Draft<CityState>,
  command: CityEventCommand,
  now: number,
): ApplyOutcome {
  const { type: _type, ...event } = command;
  const old = draft.events.find((e) => e.id === event.id);
  if (old) {
    Object.assign(old, event, { updatedAt: now });
    // 整条替换：这次没写城区就去掉旧的
    if (event.district === undefined) delete old.district;
    return { ok: true };
  }
  if (event.status === "over") return { ok: true };
  draft.events.push({ ...event, startedAt: now, updatedAt: now });
  while (draft.events.length > CITY_KEPT) {
    const over = draft.events.findIndex((e) => e.status === "over");
    draft.events.splice(Math.max(over, 0), 1);
  }
  return { ok: true };
}
