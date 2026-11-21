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
        if (h.locked) {
          lines.push(
            `住所欠费锁门 ${h.id}：${h.name}（${h.locationName}）因逾期未缴 ${h.rentAmount ?? 1200} 欧元房租水电已被电子门锁锁死并停水电，暂不可进入休息或取物（缴清房租即解锁）`,
          );
          continue;
        }
        if (h.here) {
          const rentTag =
            h.tenure === "rented" && h.rentPaidUntil
              ? `，租住·账单期至 ${h.rentPaidUntil}${h.rentDue ? "（临近交租）" : ""}`
              : "";
          lines.push(`当前所在住处 ${h.id}：${h.name}（${h.locationName}${rentTag}）`);
        } else if (h.rentDue && h.rentPaidUntil) {
          lines.push(
            `房租将至 ${h.id}：${h.name}本期房租水电 ${h.rentAmount ?? 1200} 欧元将于 ${h.rentPaidUntil} 到期`,
          );
        }
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
