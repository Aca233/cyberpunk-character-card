import type { RuleModule } from "../../kernel/system";
import { ATTRIBUTE_LABELS } from "../dice";
import { RARITY_LABELS } from "../economy";
import { itemCatalog } from "./apply";
import {
  type InventoryState,
  ITEM_KIND_LABELS,
  MOD_SLOT_LABELS,
  WEAPON_CATEGORY_LABELS,
  WEAPON_TYPE_LABELS,
  weaponAttribute,
} from "./schema";

/** 物品表：内容不随状态变，放在系统提示词末尾；模型给、拿、用物品时只能用这些 id。
 * 按类别分组，组名写一次检定属性，每行只写这件东西自己的部分，几十件也不太占篇幅 */
export function catalogSection(data: Readonly<Record<string, unknown>>): string | undefined {
  if (data.items === undefined) return undefined;
  const groups = new Map<string, string[]>();
  for (const item of itemCatalog(data).values()) {
    const group =
      item.category === undefined
        ? ITEM_KIND_LABELS[item.kind]
        : `${WEAPON_CATEGORY_LABELS[item.category]}（${ATTRIBUTE_LABELS[weaponAttribute(item.category)]}检定）`;
    const notes = [
      ...(item.weaponType ? [WEAPON_TYPE_LABELS[item.weaponType]] : []),
      ...(item.category === undefined && item.attribute
        ? [`${ATTRIBUTE_LABELS[item.attribute]}检定`]
        : []),
      ...(item.modSlot && item.modFits
        ? [
            `${MOD_SLOT_LABELS[item.modSlot]}，配${item.modFits.map((c) => WEAPON_CATEGORY_LABELS[c]).join("、")}`,
          ]
        : []),
      ...(item.rarity ? [RARITY_LABELS[item.rarity]] : []),
      ...(item.iconic ? ["不朽"] : item.price === undefined ? [] : [String(item.price)]),
    ];
    const line = `- ${item.id} ${item.name}${notes.length > 0 ? `｜${notes.join("｜")}` : ""}${item.ability ? `：${item.ability}` : ""}`;
    groups.set(group, [...(groups.get(group) ?? []), line]);
  }
  const body = [...groups].map(([group, lines]) => `${group}\n${lines.join("\n")}`).join("\n");
  return `【物品表】
item 指令的 id 只能用下面这些；【当前状态】里的武器栏、治疗品和背包写的也是这些 id，正文里用名称。表里没有的东西只在正文里写，不发 item 指令。
每行是：id 名称｜武器类型｜稀有度｜参考价（欧元）：能力。技术武器一律用技术检定、智能武器一律用智能检定，不看组名；不朽的东西只从剧情获得，没人卖。
改装件只在装到武器上时才算数（【当前状态】武器栏括号里写着的），例如装了消音器才能安静开枪；装卸在界面上做，你不发指令。
${body}`;
}

const WORDS = /零件|拆解|拆成零件|升级武器/;

export const partsRules: RuleModule<InventoryState> = {
  id: "parts",
  title: "零件",
  commands: ["parts"],
  when: (state, input) => input.mode !== "ooc" && (state.parts > 0 || WORDS.test(input.text)),
  text: `- 零件是拆东西得来的，用来给武器升稀有度。玩家自己拆背包里的东西、给武器升级在界面上做，你不发指令；剧情里搜刮到、拆了场景里的设备、别人送的零件写 parts（正数），剧情里花掉写负数，零件不够时整条不生效。
- 【当前状态】武器栏括号里写着"升到某档"的武器按那一档写手感和威力。`,
};
