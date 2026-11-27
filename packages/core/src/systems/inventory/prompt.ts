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

/** 判断与正文共用的物品事实约束；不规定文风，也不要求玩家额外点装备按钮。 */
export const CARRY_AND_WEAPON_RULES = `【随身、持用与负担】
- 随身武器是可以取用的实物清单，不代表同时拿在手里。玩家未明确换武器时延续【当前状态】的持用情况；持用尚未明确时，按本场已经确定的动作承接，信息不足就保留未定，不按稀有度或克制关系替玩家自动选枪。
- 本次攻击只使用实际取出并用于该动作的武器；消音、穿甲、智能联锁与改装效果分别属于各自那把武器，不能借用另一件随身武器的能力，也不按背包件数叠加火力。
- 收起、背挂、拔出、换持和捡拾都有实际过程。普通取用可随玩家完整行动自然完成；交火中结合手的占用、距离、掩护、对手反应与伤势判断所需时间，不固定扣动作点，也不强制每次换枪单开一轮。长枪通常需要双手稳定使用，小型手枪与短刀可单手；双持、攀爬、拖人和治疗须满足实际握持条件。
- 留在家、车里、现场或别人处的物件先按实际位置取回，提到物品名称不等于已经拿到；不要代玩家存放、丢弃、出售或购买装备。
- 携带负担以【当前状态】的代码分档为准，不自行估算公斤数或叠加一套负重。负担只在攀爬、潜行、钻缝、闪避、追逐等相关行动中按实情影响便利性与耗时；正常携带、对话和安全休息不凭空受罚，超载也不自动造成疲劳、受伤或失败。`;

/** 静态数据表的渲染缓存：纯静态物品表不随回合变化，缓存拼好的字符串避免每轮重建 */
const catalogRenderCache = new WeakMap<object, Map<boolean, string>>();

/** 物品表：内容不随状态变，放在系统提示词末尾；模型给、拿、用物品时只能用这些 id。
 * 按类别分组，每行只写这件东西自己的特点，几十件也不太占篇幅 */
export function catalogSection(
  data: Readonly<Record<string, unknown>>,
  includeAbilities = true,
): string | undefined {
  if (data.items === undefined) return undefined;
  const raw = data.items;
  if (typeof raw === "object" && raw !== null) {
    const hit = catalogRenderCache.get(raw)?.get(includeAbilities);
    if (hit !== undefined) return hit;
  }
  const groups = new Map<string, string[]>();
  for (const item of itemCatalog(data).values()) {
    if (item.id.startsWith("wpn:")) continue;
    const group =
      item.category === undefined
        ? ITEM_KIND_LABELS[item.kind]
        : WEAPON_CATEGORY_LABELS[item.category];
    if (includeAbilities) {
      const notes = [
        ...(item.weaponType ? [WEAPON_TYPE_LABELS[item.weaponType]] : []),
        ...(item.modSlot && item.modFits
          ? [
              `${MOD_SLOT_LABELS[item.modSlot]}，配${item.modFits.map((c) => WEAPON_CATEGORY_LABELS[c]).join("、")}`,
            ]
          : []),
        ...(item.rarity ? [RARITY_LABELS[item.rarity]] : []),
        ...(item.iconic ? ["不朽"] : []),
        ...(item.price === undefined ? [] : [String(item.price)]),
      ];
      const line = `- ${item.id} ${item.name}${notes.length > 0 ? `｜${notes.join("｜")}` : ""}${item.ability ? `：${item.ability}` : ""}`;
      groups.set(group, [...(groups.get(group) ?? []), line]);
    } else {
      const entry = `${item.id} ${item.name}`;
      groups.set(group, [...(groups.get(group) ?? []), entry]);
    }
  }
  const body = includeAbilities
    ? [...groups].map(([group, lines]) => `${group}\n${lines.join("\n")}`).join("\n")
    : [...groups].map(([group, entries]) => `${group}：${entries.join("、")}`).join("\n");
  const rendered = `【物品表】
下表是物品模板，不是存在资格白名单。已有物件使用其稳定 id，正文用名称。剧情实际取得目录外物件时，item gain 同时写 definition（id、name、kind、ability 等定义）和 origin（来源/此前归属）；普通工具、信物用 misc，消耗品用 consumable。新定义只登记一次，以后保持同一 id，禁止重复获得同一个独立物件。拿起环境物件同样可以登记，不受是否正在交战限制。
- 治疗品与手雷的 charges 是这份实物的余量；切场、休息和结束战斗均不补满。补充必须确实购买、制作或取得另一份物品。工具和信物使用后保留，只有 consumable 的 use 才消耗掉。
- 独立物件交给已有卡的人时写 item lose，recipient 写人物 id；对方交还时写 item gain 同一物件 id，代码同步双方装备，不另发同一物件的 npcGear。
- 武器取得后放进随身背包（item gain），可按现场条件取用；随身不等于正在持用。实际持用变化由 weaponHold 记录，不用写 item equip；item equip / unequip 只用于穿着衣服或切换快捷治疗品/手雷。
${
  includeAbilities
    ? "每行是：id 名称｜武器类型｜稀有度｜参考价（欧元）：能力。不同武器类型决定实际性能与战术作用（动能跳弹、技术充能穿墙、智能自寻的，但智能武器需要相应义体/握把联锁才能自导）。参考价不是成交价，交易以实际卖方、货源和已确认报价为准；不朽标签说明特殊来历，不禁止真实持有人转让，也不能据目录凭空购买。"
    : "以下按分类以「id 名称」列出完整模板索引；本轮相关物品的详细能力与成交价另列在用户消息与交易条件里。未展开能力不代表物件不存在，禁止据此重复新建同名物件；交易以实际卖方、货源和已确认报价为准。"
}
改装件只对实际装着它的那把武器生效（【当前状态】随身武器括号里写着的），例如使用装有消音器的枪才压低枪口爆鸣；装卸在界面上做，你不发指令。
${body}`;
  if (typeof raw === "object" && raw !== null) {
    let byMode = catalogRenderCache.get(raw);
    if (!byMode) {
      byMode = new Map();
      catalogRenderCache.set(raw, byMode);
    }
    byMode.set(includeAbilities, rendered);
  }
  return rendered;
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
