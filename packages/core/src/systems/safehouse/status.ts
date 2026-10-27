import type { StatusContext, SystemStatus } from "../../kernel/system";
import type { safehouseView } from "./view";

/** 【当前状态】里安全屋的几行：住处和存放箱、后备箱、当前地点出售的公寓 */

type SafehouseView = ReturnType<typeof safehouseView>;

const safehouseOf = (ctx: StatusContext) => ctx.views.safehouse as SafehouseView;

const itemList = (items: SafehouseView["homes"][number]["items"]) =>
  items.map((i) => `${i.name}${i.count > 1 ? `×${i.count}` : ""}`).join("、");

export const safehouseStatus: readonly SystemStatus[] = [
  {
    order: 110,
    lines(ctx) {
      const s = safehouseOf(ctx);
      const lines: string[] = [];
      for (const h of s.homes)
        lines.push(
          `安全屋 ${h.id}：${h.name}（${h.locationName}${h.here ? "，你现在就在这里" : ""}）；存放箱：${itemList(h.items) || "空的"}（不在身上，拿出来才能用）`,
        );
      for (const t of s.trunks)
        if (t.items.length > 0)
          lines.push(`${t.name}（${t.id}）：${itemList(t.items)}（不在身上）`);
      const forSale = s.forSale.filter((a) => a.locked === null);
      if (forSale.length > 0)
        lines.push(
          `这里有公寓出售（玩家在界面上买下，代码扣钱；正文里可以有中介或广告，不要替玩家买下或白送）：${forSale.map((a) => `${a.name} ${a.price} 欧元：${a.note}`).join("；")}`,
        );
      return lines;
    },
  },
];
