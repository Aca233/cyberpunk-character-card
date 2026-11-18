import type { StatusContext, SystemStatus } from "../../kernel/system";
import { RARITY_LABELS } from "../economy";
import type { shopsView } from "./shops";
import type { inventoryView } from "./view";

/** 【当前状态】里物品的几组行：当前地点的商店；随身武器、大件超重、穿着、治疗品、背包 */

type InventoryView = ReturnType<typeof inventoryView>;
type ShopsView = ReturnType<typeof shopsView>;

export const inventoryStatus: readonly SystemStatus[] = [
  {
    order: 220,
    lines(ctx: StatusContext) {
      return (ctx.views.shops as ShopsView).map(
        (shop) =>
          `商店 ${shop.id}：${shop.name}在这里（店主${shop.keeper}，${shop.note}）。按钮与自由输入共用实际报价；询价不交付，已成交写 trade with:${shop.id}，店内私人交易写实际人物 id，不占本店货源。`,
      );
    },
  },
  {
    order: 270,
    lines(ctx: StatusContext) {
      const inv = ctx.views.inventory as InventoryView;
      const lines: string[] = [];
      const withMods = (w: InventoryView["carriedWeapons"][number]) => {
        const fitted = inv.mods[w.id] ?? [];
        const tuned = w.weaponState?.tunedRarity;
        const extra = [
          ...(w.bulky ? ["大件"] : []),
          ...(tuned ? [`升到${RARITY_LABELS[tuned]}`] : []),
          ...(fitted.length > 0 ? [`装着 ${fitted.map((m) => m.id).join("、")}`] : []),
        ];
        const qty = w.count > 1 ? `×${w.count}` : "";
        return `${w.id}${qty}${extra.length > 0 ? `（${extra.join("；")}）` : ""}`;
      };
      lines.push(
        `随身武器：${inv.carriedWeapons.length > 0 ? inv.carriedWeapons.map(withMods).join("、") : "空手"}`,
      );
      if (inv.bulky.overloaded)
        lines.push(
          `随身大件：${inv.bulky.count}/${inv.bulky.max} 件（超重，长件在身且显眼，做翻墙、潜行、近身闪避与追逐动作吃物理劣势）`,
        );
      if (inv.clothing.length > 0)
        lines.push(
          `穿着（只影响身份和伪装，没有护甲）：${inv.clothing.map((c) => `${c.id}（${c.label}）`).join("、")}`,
        );
      if (inv.healing) lines.push(`治疗品：${inv.healing.id}，剩 ${inv.healing.charges} 次`);
      const backpack = Object.entries(inv.backpack).filter(
        ([id]) => inv.details[id]?.kind !== "weapon",
      );
      if (backpack.length > 0)
        lines.push(`背包：${backpack.map(([id, n]) => `${id}×${n}`).join("、")}`);
      // 物品栏精简（用户定的方案 A）：零件不再出现，不写进【当前状态】；存档里的零件数照旧留着
      return lines;
    },
  },
];
