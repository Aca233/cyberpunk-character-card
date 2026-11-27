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
          `商店 ${shop.id}：${shop.name}在这里（店主${shop.keeper}，${shop.note}）。按钮与自由输入共用实际报价；询价不交付，已成交写 trade with:${shop.id}（买卖入本店库存，不占店主随身装备栏），非店主之间的店内私人交易写实际人物 id。`,
      );
    },
  },
  {
    order: 270,
    lines(ctx: StatusContext) {
      const inv = ctx.views.inventory as InventoryView;
      const names = (ctx.views.names as NamesView | undefined)?.items ?? {};
      const cyber = (ctx.views.cyberware as CyberwareView | undefined) ?? [];
      const hasHandSmartLink = cyber.some((c) => c.smartLink && !c.broken);
      const brokenHandSmartLink = !hasHandSmartLink && cyber.some((c) => c.smartLink && c.broken);

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
        const weaponTrait = summarizeAbility(detail?.ability, 72);
        const extra = [
          ...(displayName !== w.id ? [w.id] : []),
          ...(detail?.subLabel ? [detail.subLabel] : []),
          ...(concealmentNote ? [concealmentNote] : []),
          ...(w.isRanged && w.noise === "silent" ? ["已消音"] : []),
          ...(smartLinkNote ? [smartLinkNote] : []),
          ...modSummaries,
          ...(weaponTrait ? [weaponTrait] : []),
        ];
        const qty = w.count > 1 ? `×${w.count}` : "";
        return `${displayName}${qty}${extra.length > 0 ? `（${extra.join("；")}）` : ""}`;
      };
      lines.push(
        `随身武器：${inv.carriedWeapons.length > 0 ? inv.carriedWeapons.map(formatWeapon).join("、") : "空手"}`,
      );
      lines.push(
        `当前持用：${inv.heldWeapons === null ? "尚未明确；按玩家实际动作承接，不自动挑选最强武器" : inv.heldWeapons.length > 0 ? inv.heldWeapons.map((id) => names[id] ?? id).join("、") : "已明确收起武器"}`,
        `携带负担：${inv.loadout.carryLabel}（${inv.loadout.carryUnits}/${inv.loadout.carryMax} 携带单位；单位是体积与负担的粗分，不是公斤）${inv.loadout.carryLevel === "light" ? "；负担本身不额外限制日常动作，长枪显眼仍单独判断" : inv.loadout.carryLevel === "burdened" ? "；只在疾跑、攀爬、潜行、闪避、狭窄处取用等确受负担影响的动作中体现，不因此自动失败或受伤" : "；持续疾跑、攀爬和敏捷转身明显受累，按现场条件减速、寻找支撑或建议放下大件，不自动丢弃、扣钱或制造伤势"}`,
      );
      if (inv.clothing.length > 0) {
        const clothLines = inv.clothing.map((c) => {
          const tags = [c.label, ...(c.styleLabel ? [c.styleLabel] : []), ...c.effectTags];
          const trait = summarizeAbility(c.ability, 44);
          return `${names[c.id] ?? c.id}［${c.id}］（${tags.join("·")}${trait ? `；${trait}` : ""}）`;
        });
        lines.push(`穿着：${clothLines.join("、")}`);
      }
      if (inv.gearEffects.badges.length > 0) {
        lines.push(
          `当前装备与着装生效效果：${inv.gearEffects.badges.join("、")}（防弹/防护、散热、抗性、伪装与隐匿在交火、潜行、环境危害与门禁裁决中直接生效）`,
        );
      }
      if (inv.healing)
        lines.push(
          `治疗品：${names[inv.healing.id] ?? inv.healing.id}（${inv.healing.id}），剩 ${inv.healing.charges} 次`,
        );
      if (inv.grenade)
        lines.push(
          `手雷：${names[inv.grenade.id] ?? inv.grenade.id}（${inv.grenade.id}），剩 ${inv.grenade.charges} 次`,
        );
      const backpack = Object.entries(inv.backpack).filter(
        ([id]) => inv.details[id]?.kind !== "weapon",
      );
      if (backpack.length > 0) {
        const bagLines = backpack.map(([id, n]) => {
          const detail = inv.details[id];
          const label = names[id] ?? id;
          const qty = n > 1 ? `×${n}` : "";
          const tags = detail?.effectTags ?? [];
          const summary =
            detail && detail.kind !== "clothing" ? summarizeAbility(detail.ability, 40) : undefined;
          const meta = [...tags, ...(summary ? [summary] : [])].join("；");
          return `${label}［${id}］${qty}${meta ? `（${meta}）` : ""}`;
        });
        lines.push(`背包：${bagLines.join("、")}`);
      }
      // 物品栏精简（用户定的方案 A）：零件不再出现，不写进【当前状态】；存档里的零件数照旧留着
      return lines;
    },
  },
];
