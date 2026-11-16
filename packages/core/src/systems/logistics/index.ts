import { defineSystem } from "../../kernel/system";
import type { CityState } from "../city";
import { locationForTravel, merchantSites } from "../world";
import {
  type LogisticsState,
  LogisticsStateSchema,
  type RouteCommand,
  RouteCommandSchema,
} from "./schema";

/** 仅合并经营索引已核对的同一入口；不按名称、距离或城区推断。 */
export function routeLocations(
  data: Readonly<Record<string, unknown>>,
  location: string,
): string[] {
  return [
    ...new Set([
      location,
      ...[...merchantSites(data).values()]
        .filter((site) => site.locations.includes(location))
        .flatMap((site) => site.locations),
    ]),
  ];
}

export const logistics = defineSystem<LogisticsState, RouteCommand>({
  id: "logistics",
  dependsOn: ["world", "city"],
  state: LogisticsStateSchema,
  initial: () => ({ routes: {} }),
  commands: { "logistics.route": RouteCommandSchema },
  apply(draft, command, ctx) {
    if (!locationForTravel(ctx.data, command.location))
      return { ok: false, reason: "物流封锁必须指向已经登记的具体地点" };
    const event = command.sourceEvent
      ? ctx.read<CityState>("city").events.find((e) => e.id === command.sourceEvent)
      : undefined;
    if (command.sourceEvent && !event)
      return { ok: false, reason: "没有这条城市事件，不能凭空改变供货路线" };
    const source = event ? `${event.title}\n${event.body}` : ctx.facts.tradeNarrative;
    const clean = (text: string) => text.normalize("NFKC").replace(/\s+/g, "");
    if (typeof source !== "string" || !clean(source).includes(clean(command.evidence)))
      return { ok: false, reason: "路线变化缺少实际发生的来源证据" };
    if (event?.status === "over" && command.blocked)
      return { ok: false, reason: "已经结束的事件不能新建持续封锁" };
    const locations = routeLocations(ctx.data, command.location);
    if (locations.every((id) => draft.routes[id]?.blocked === command.blocked)) return { ok: true };
    for (const id of locations) {
      if (draft.routes[id]?.blocked === command.blocked) continue;
      draft.routes[id] = {
        blocked: command.blocked,
        reason: command.reason,
        changedAt: ctx.now,
        source: command.sourceEvent ?? command.evidence,
      };
    }
    return {
      ok: true,
      notes: [
        command.blocked ? `供货路线受阻：${command.reason}` : `路线恢复通行：${command.reason}`,
      ],
      signals: ["logistics.changed"],
    };
  },
  rules: [
    {
      id: "logistics",
      title: "供货路线",
      commands: ["logistics.route"],
      when: (state, input) =>
        Object.values(state.routes).some((r) => r.blocked) ||
        /封锁|封路|解封|通行|供货|补货|订货|运货/.test(input.text),
      text: "- 真实封路或恢复通行写 logistics.route，location 必须指向具体地点，并引用实际证据；只影响经过该地点的订单。不由全城新闻自动涨价，不为平稳经营强造麻烦。正常到货由已保存供货单随时间自动结算，不额外发加库存。",
    },
  ],
});
export * from "./schema";
