import type { StatusContext, SystemStatus } from "../../kernel/system";
import type { safehouseView } from "./view";

/** 【当前状态】只带当前所在住处和本地待售公寓；不住在这里时不每轮占篇幅 */

type SafehouseView = ReturnType<typeof safehouseView>;

const safehouseOf = (ctx: StatusContext) => ctx.views.safehouse as SafehouseView;

export const safehouseStatus: readonly SystemStatus[] = [
  {
    order: 110,
    lines(ctx) {
      const s = safehouseOf(ctx);
      const lines: string[] = [];
      for (const h of s.homes) {
        if (!h.here) continue;
        lines.push(`当前所在住处 ${h.id}：${h.name}（${h.locationName}）`);
      }
      const forSale = s.forSale.filter((a) => a.locked === null);
      if (forSale.length > 0)
        lines.push(
          `这里有公寓出售（${forSale.map((a) => `${a.name} ${a.price} 欧元：${a.note}`).join("；")}）`,
        );
      return lines;
    },
  },
];
