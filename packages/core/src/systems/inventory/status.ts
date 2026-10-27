import type { StatusContext, SystemStatus } from "../../kernel/system";
import type { shopsView } from "./shops";
import type { inventoryView } from "./view";

/** 【当前状态】里物品的几组行：当前地点的商店；武器栏、不朽武器的声音、穿着、治疗品、背包和零件 */

type InventoryView = ReturnType<typeof inventoryView>;
type ShopsView = ReturnType<typeof shopsView>;

export const inventoryStatus: readonly SystemStatus[] = [
  {
    order: 220,
    lines(ctx: StatusContext) {
      return (ctx.views.shops as ShopsView).map(
        (shop) =>
          `商店：${shop.name}在这里（店主${shop.keeper}，${shop.note}）；玩家可以在界面上直接买卖，代码按货架价结算，你只写场面${shop.blackMarket ? "。这是黑市货，买到的东西可能来路不明，可以在剧情里兑现" : ""}`,
      );
    },
  },
  {
    order: 270,
    lines(ctx: StatusContext) {
      const inv = ctx.views.inventory as InventoryView;
      const lines: string[] = [];
      const weapons = inv.weapons.filter((w): w is string => w !== null);
      const withMods = (w: string) => {
        const fitted = inv.mods[w] ?? [];
        const tuned = inv.tuned[w];
        const extra = [
          ...(tuned ? [`升到${tuned}`] : []),
          ...(fitted.length > 0 ? [`装着 ${fitted.map((m) => m.id).join("、")}`] : []),
        ];
        return extra.length > 0 ? `${w}（${extra.join("；")}）` : w;
      };
      lines.push(`武器栏：${weapons.length > 0 ? weapons.map(withMods).join("、") : "空手"}`);
      if (inv.iconicVoices.length > 0)
        lines.push(
          `不朽武器的声音（voices 可以写 from "iconic"）：${inv.iconicVoices.map((v) => `${v.name}——${v.voice}`).join("；")}`,
        );
      if (inv.clothing.length > 0)
        lines.push(
          `穿着（只影响身份和伪装，没有护甲）：${inv.clothing.map((c) => `${c.id}（${c.label}）`).join("、")}`,
        );
      if (inv.healing) lines.push(`治疗品：${inv.healing.id}，剩 ${inv.healing.charges} 次`);
      const backpack = Object.entries(inv.backpack);
      if (backpack.length > 0)
        lines.push(`背包：${backpack.map(([id, n]) => `${id}×${n}`).join("、")}`);
      if (inv.parts > 0)
        lines.push(`零件：${inv.parts} 个（拆解和升级玩家在界面上做；剧情里得到或花掉写 parts）`);
      return lines;
    },
  },
];
