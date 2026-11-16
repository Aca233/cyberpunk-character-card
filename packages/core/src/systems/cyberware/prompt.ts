import type { RuleModule } from "../../kernel/system";
import { RARITY_LABELS } from "../economy";
import { cyberwareCatalog } from "./apply";
import { type CyberwareState, SLOT_LABELS } from "./schema";

export const cyberwareRules: RuleModule<CyberwareState> = {
  id: "cyberware",
  title: "义体",
  commands: ["cyberware"],
  when: () => true,
  judge: `- 【当前状态】里的「义体」是角色身上真的装着的东西，写着的能力角色真的做得到：装着螳螂刀就能爬墙，装着义眼就能扫描、读弹道或看透敌方植入件；没装的义体做不到，也不算硬件优势。
- 坏着的义体修好前用不了，无法提供任何能力或硬件支持。`,
  narrate: `- 装着的义体写进动作里：螳螂刀弹出、义眼扫描时视野里叠出的数据、加速义体启动时世界慢下来。
- 购买、安装、拆卸回收、维修和还款以当前医生的实际报价与条件为准；询价不等于成交。缺钱不会自动赊账，满槽不会自动出售旧件，只有玩家接受具体条件后才发生交易。`,
  text: `- 【当前状态】里的「义体」是角色身上真的装着的东西，写着的能力角色真的做得到：装着螳螂刀就能爬墙，装着义眼就能扫描，不用再问；没装的义体角色做不到。
- 给建议选项时想想装着的义体能开出什么路子。
- 实际接受并完成义体交易写 cyberware：doc 指定当前医生/诊所 id，action 为 install、remove、repair 或 repay，商品写 id。报价由同一交易入口计算，不写任意 price，不另用 trade 记第二次费用。已谈妥的折扣或赠与必须先有真实双方确认的 commerce 报价，再引用 offer；询价和单方面开价不算接受。
- 每个部位按格数装：额叶皮质、神经系统、循环系统、皮肤、骨骼各 3 件，眼部、手部各 2 件，操作系统、手臂、腿部各 1 件；满槽必须有玩家指定的 replace 和明确同意出售旧件的 tradeIn:true，不能自行挑最早一件。remove 当前表示拆卸回收，同样必须得到出售授权；仅要求拆下保留时不提交回收交易。
- 缺钱且玩家明确接受欠款才写 credit:true；代码核验该医生能否赊账和未清债务。repay 还清指定医生欠款。安装不扣精神资源；只有实际出现神经症状才记录 humanity。
- 只能由实际在场医生提供服务；已确认死亡或在别处的人不能亲自接诊。货架外商品、自带义体安装与旧件保留尚未接入本次交易入口，不用免费安装或任意改价绕过。`,
};

/** 义体表：和物品表一样放在系统提示词末尾，按部位分组 */
export function cyberwareSection(
  data: Readonly<Record<string, unknown>>,
  includeAbilities = true,
): string | undefined {
  const parts = [...cyberwareCatalog(data).values()];
  if (parts.length === 0) return undefined;
  const groups = new Map<string, string[]>();
  for (const p of parts) {
    const notes = [RARITY_LABELS[p.rarity], p.iconic ? "不朽" : String(p.price)];
    const group = SLOT_LABELS[p.slot];
    groups.set(group, [
      ...(groups.get(group) ?? []),
      `- ${p.id} ${p.name}｜${notes.join("｜")}${includeAbilities ? `：${p.ability}` : ""}`,
    ]);
  }
  const body = [...groups].map(([group, lines]) => `${group}\n${lines.join("\n")}`).join("\n");
  return `【义体表】
cyberware 指令的 id 只能用下面这些，正文里用名称。
每行是：id 名称｜稀有度｜参考价（欧元）${includeAbilities ? "：能力" : "；本轮相关能力另列在用户消息里，未展开的义体仍可按索引引用"}。这是设备目录，不代表眼前诊所有货；成交以指定医生的货架与已确认报价为准，不能按标签或参考价直接生成交易。
${body}`;
}
