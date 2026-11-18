import type { StatusContext, SystemStatus } from "../../kernel/system";
import type { cyberwareView } from "../cyberware";
import type { WeaponConcealment } from "../dice";
import { type namesView, summarizeAbility } from "./names";
import type { shopsView } from "./shops";
import type { inventoryView } from "./view";

/** 【当前状态】里物品的几组行：当前地点的商店；随身武器、大件超重、穿着、治疗品、背包 */

type InventoryView = ReturnType<typeof inventoryView>;
type NamesView = ReturnType<typeof namesView>;
type ShopsView = ReturnType<typeof shopsView>;
type CyberwareView = ReturnType<typeof cyberwareView>;

const CONCEALMENT_STATUS_NOTES: Readonly<Partial<Record<WeaponConcealment, string>>> = {
  coat: "需风衣遮掩",
  open: "大件显眼",
  heavy: "重型大件显眼",
};

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
      const names = (ctx.views.names as NamesView | undefined)?.items ?? {};
      const cyber = (ctx.views.cyberware as CyberwareView | undefined) ?? [];
      const hasHandSmartLink = cyber.some((c) => c.id === "smart-link" && !c.broken);
      const brokenHandSmartLink =
        !hasHandSmartLink && cyber.some((c) => c.id === "smart-link" && c.broken);

      const lines: string[] = [];
      const formatWeapon = (w: InventoryView["carriedWeapons"][number]) => {
        const displayName = names[w.id] ?? w.id;
        const detail = inv.details[w.id];
        const fitted = inv.mods[w.id] ?? [];
        const concealmentNote = CONCEALMENT_STATUS_NOTES[w.concealment];
        const smartLinkNote =
          w.weaponType !== "smart"
            ? undefined
            : w.grantsSmartLink
              ? "内置/外置智能联锁就绪"
              : hasHandSmartLink
                ? "手部智能联锁就绪"
                : brokenHandSmartLink
                  ? "手部智能连接已损坏，暂退化为普通直瞄"
                  : "缺智能连接，暂退化为普通直瞄";
        const modSummaries = fitted.map((m) => {
          const summary = summarizeAbility(m.ability, 48);
          const tagParts = [summary, ...(m.locked ? ["固锁"] : [])].filter(Boolean);
          return `[${m.label}] ${m.name}${tagParts.length > 0 ? `（${tagParts.join("；")}）` : ""}`;
        });
        const extra = [
          ...(displayName !== w.id ? [w.id] : []),
          ...(detail?.subLabel ? [detail.subLabel] : []),
          ...(concealmentNote ? [concealmentNote] : []),
          ...(w.isRanged && w.noise === "silent" ? ["已消音"] : []),
          ...(smartLinkNote ? [smartLinkNote] : []),
          ...modSummaries,
        ];
        const qty = w.count > 1 ? `×${w.count}` : "";
        return `${displayName}${qty}${extra.length > 0 ? `（${extra.join("；")}）` : ""}`;
      };
      lines.push(
        `随身武器：${inv.carriedWeapons.length > 0 ? inv.carriedWeapons.map(formatWeapon).join("、") : "空手"}`,
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
