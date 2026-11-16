import type { RuleModule } from "../../kernel/system";
import { RARITY_LABELS } from "../economy";
import { itemCatalog } from "./apply";
import {
  type InventoryState,
  ITEM_KIND_LABELS,
  MOD_SLOT_LABELS,
  WEAPON_CATEGORY_LABELS,
  WEAPON_TYPE_LABELS,
} from "./schema";

/** 物品表：内容不随状态变，放在系统提示词末尾；模型给、拿、用物品时只能用这些 id。
 * 按类别分组，每行只写这件东西自己的特点，几十件也不太占篇幅 */
export function catalogSection(
  data: Readonly<Record<string, unknown>>,
  includeAbilities = true,
): string | undefined {
  if (data.items === undefined) return undefined;
  const groups = new Map<string, string[]>();
  for (const item of itemCatalog(data).values()) {
    const group =
      item.category === undefined
        ? ITEM_KIND_LABELS[item.kind]
        : WEAPON_CATEGORY_LABELS[item.category];
    const notes = [
      ...(item.weaponType ? [WEAPON_TYPE_LABELS[item.weaponType]] : []),
      ...(item.modSlot && item.modFits
        ? [
            `${MOD_SLOT_LABELS[item.modSlot]}，配${item.modFits.map((c) => WEAPON_CATEGORY_LABELS[c]).join("、")}`,
          ]
        : []),
      ...(item.rarity ? [RARITY_LABELS[item.rarity]] : []),
      ...(item.iconic ? ["不朽"] : item.price === undefined ? [] : [String(item.price)]),
    ];
    const line = `- ${item.id} ${item.name}${notes.length > 0 ? `｜${notes.join("｜")}` : ""}${includeAbilities && item.ability ? `：${item.ability}` : ""}`;
    groups.set(group, [...(groups.get(group) ?? []), line]);
  }
  const body = [...groups].map(([group, lines]) => `${group}\n${lines.join("\n")}`).join("\n");
  return `【物品表】
下表是物品模板，不是存在资格白名单。已有物件使用其稳定 id，正文用名称。剧情实际取得目录外物件时，item gain 同时写 definition（id、name、kind、ability 等定义）和 origin（来源/此前归属）；普通工具、信物用 misc，消耗品用 consumable。新定义只登记一次，以后保持同一 id，禁止重复获得同一个独立物件。拿起环境物件同样可以登记，不受是否正在交战限制。
- 治疗品与手雷的 charges 是这份实物的余量；切场、休息和结束战斗均不补满。补充必须确实购买、制作或取得另一份物品。工具和信物使用后保留，只有 consumable 的 use 才消耗掉。
- 独立物件交给已有卡的人时写 item lose，recipient 写人物 id；对方交还时写 item gain 同一物件 id，代码同步双方装备，不另发同一物件的 npcGear。
- 所有武器拿到就放进背包（item gain），直接就能拔出使用，不用写 item equip；item equip / unequip 只用于穿着衣服或切换快捷治疗品/手雷。
每行是：id 名称｜武器类型｜稀有度｜参考价（欧元）${includeAbilities ? "：能力" : "；本轮相关能力另列在用户消息里。完整索引始终保留，未展开能力不代表物件不存在，也不能据此重复新建同名物件"}。不同武器类型决定实际性能与战术作用（动能跳弹、技术充能穿墙、智能自寻的，但智能武器需要相应义体/握把联锁才能自导）；不朽的东西只从剧情获得，没人卖。
改装件只在装到武器上时才算数（【当前状态】随身武器括号里写着的），例如装了消音器才能安静开枪；装卸在界面上做，你不发指令。
${body}`;
}

const WORDS = /零件|拆解|拆成零件|升级武器/;

export const partsRules: RuleModule<InventoryState> = {
  id: "parts",
  title: "零件",
  commands: ["parts"],
  when: (state, input) => input.mode !== "ooc" && (state.parts > 0 || WORDS.test(input.text)),
  text: `- 剧情里搜刮到、拆了场景里的设备、别人送的零件写 parts（正数），剧情里花掉写负数，零件不够时整条不生效。
- 【当前状态】武器括号里写着"升到某档"的武器按那一档写手感和威力。`,
};
