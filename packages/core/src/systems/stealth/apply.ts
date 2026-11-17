import type { Draft } from "immer";
import type { ApplyOutcome } from "../../kernel/system";
import {
  ALERT_LABELS,
  ALERT_MAX,
  type AlertCommand,
  type AlertSite,
  type StealthState,
} from "./schema";

type Stealth = Draft<StealthState>;

const siteKey = (location: string | null) => location ?? "unlocated";

/** 只显示当前地点；离开的现场仍独立保留。 */
export function currentAlert(state: StealthState, location: string | null): AlertSite {
  return state.sites[siteKey(location)] ?? { level: 0, peak: 0 };
}

export function applyAlert(
  draft: Stealth,
  command: AlertCommand,
  location: string | null,
): ApplyOutcome {
  const key = siteKey(location);
  const site = draft.sites[key] ?? { level: 0, peak: 0 };
  const from = site.level;
  if (command.delta < 0) {
    if (from === 0) return { ok: false, reason: "警戒度已经是 0，没得降" };
    site.level = Math.max(0, from + command.delta);
  } else {
    if (from >= ALERT_MAX) return { ok: false, reason: "已经是交战档" };
    site.level = Math.min(ALERT_MAX, from + command.delta);
    site.peak = Math.max(site.peak, site.level);
  }
  draft.sites[key] = site;
  const notes = [`警戒 ${from} → ${site.level}（${ALERT_LABELS[site.level]}）：${command.reason}`];
  return { ok: true, notes };
}
