import type { RuleModule } from "../../kernel/system";
import { RARITY_LABELS } from "../economy";
import { cyberwareCatalog } from "./apply";
import { type CyberwareState, SLOT_LABELS } from "./schema";

export const cyberwareRules: RuleModule<CyberwareState> = {
  id: "cyberware",
  title: "义体",
  commands: [
    "cyberware",
    "cyberware.clinic",
    "cyberware.part",
    "cyberware.service",
    "cyberware.supply",
  ],
  when: () => true,
  judge: `- 【当前状态】里的「义体」是角色身上真的装着的东西，写着的能力角色真的做得到：装着螳螂刀就能爬墙，装着义眼就能扫描、读弹道或看透敌方植入件；没装的义体做不到，也不算硬件优势。
- 坏着的义体修好前用不了，无法提供任何能力或硬件支持。`,
  narrate: `- 装着的义体写进动作里：螳螂刀弹出、义眼扫描时视野里叠出的数据、加速义体启动时世界慢下来。
- 买下实物、开始手术与安装完成是不同事实。按给定医生、现货、旧件去向和服务起止时刻写；正文使用同一时间，不再次累加。只有已经完成安装的零件能提供能力。询价不成交，缺钱不自动赊账，黑市来源不强制造成故障。`,
  text: `- 【当前状态】里的「义体」是角色身上真的装着的东西，写着的能力角色真的做得到：装着螳螂刀就能爬墙，装着义眼就能扫描，不用再问；没装的义体角色做不到。
- 给建议选项时想想装着的义体能开出什么路子。
- cyberware：buy 只买下实物；install 购买并安装，或 part 指定自己实际持有的零件；remove 拆下；repair 修复已损坏的装机或自带件；repay 还清指定医生欠款。doc、id 和授权时间来自共同报价，不写任意 price，不另发 money/trade 重复收费。议价引用双方已确认的 offer。
- 满位必须指定 replace；拆卸或替换必须明确 disposition:keep（旧件带走）、sell（出售回诊所）、scrap（报废），不能自行选最早旧件或出售。tradeIn:true 也是出售旧件授权，不能与 keep/scrap 同写。未安装实物记录在「未安装义体」里，不能当作身体能力。
- 预约与复杂手术使用 cyberware.service：book 只预约；start 才付款并交接实物/拆旧；complete 按原结束时刻完成。中断只在真实事件发生时 interrupt，resume 继续剩余时间，cancel 保留已付款和实际实物去向，不自动退款或复原身体。开始、继续和取消须有玩家意图，不能靠抽取擅自替玩家接受手术。
- cyberware.part 记录有来源的捡拾、赠与、转交和检测：从诊所批量现货实际取走用 takeStock 并写 from 诊所，扣同一库存；已有独立实物用 transfer，不能 record 复制同一件。已安装或进行中手术的实物不能直接拿走；取消/中断后仍须实际交回。
- cyberware.clinic 只记真实营业、人员、设备变化；cyberware.supply 只登记已确认供货方、物件、路线和到达时刻，正常到货由本地时间结算。未到货不能先卖，重访不补满，封路只影响途经的订单。
- 缺钱且玩家明确接受欠款才写 credit:true；多笔欠款合计不超过医生实际信用额度。只有约定期限才生成到期事项，不自行统一七天。安装不扣精神资源；只有实际出现神经症状才记录 humanity。`,
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
