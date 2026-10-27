import type { EventContext, SystemEvent } from "../../kernel/system";
import { ncpdView } from "./view";

/** 扫描器新挂出的公开警情；已有警情不重复通知 */
export function ncpdEvents({ before, after }: EventContext): readonly SystemEvent[] {
  const known = new Set(ncpdView(before).alerts.map((a) => a.id));
  const alerts = ncpdView(after).alerts;
  return alerts
    .filter((a) => !known.has(a.id))
    .map((a) => ({
      source: "ncpd",
      icon: "attention",
      text: `NCPD 警情：${a.label}（${a.locationName}）`,
      tone: "info",
    }));
}
