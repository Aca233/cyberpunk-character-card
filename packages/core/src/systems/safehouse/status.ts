import type { StatusContext, SystemStatus } from "../../kernel/system";
import type { safehouseView } from "./view";

/** 【当前状态】里住所与车内的物品归属、当前地点出售的公寓 */

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
          `住所 ${h.id}：${h.name}（${h.locationName}${h.here ? "，你现在就在这里" : ""}）；屋内物品：${itemList(h.items) || "无"}（不在身上，需要时可在剧情中取用）`,
        );
      for (const t of s.trunks)
        if (t.items.length > 0)
          lines.push(`${t.name}（${t.id}）：${itemList(t.items)}（不在身上，需要时可在剧情中取用）`);
      const forSale = s.forSale.filter((a) => a.locked === null);
      if (forSale.length > 0)
        lines.push(
          `这里有公寓出售（玩家在界面上买下，代码扣钱；正文里可以有中介或广告，不要替玩家买下或白送）：${forSale.map((a) => `${a.name} ${a.price} 欧元：${a.note}`).join("；")}`,
        );
      return lines;
    },
  },
];
