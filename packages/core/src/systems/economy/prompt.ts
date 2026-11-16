import type { RuleModule } from "../../kernel/system";
import type { EconomyState } from "./schema";

export const economyRules: RuleModule<EconomyState> = {
  id: "economy",
  title: "欧元",
  commands: ["trade", "loot"],
  when: () => true,
  judge: `- 【当前状态】里写着身上有多少欧元。要付超出余额的钱就是付不起，按做不到处理，不能硬写成勉强付得起。
- 讨价还价照对话处理：看有没有说中对方的诉求与筹码，按人情世故自然敲定。`,
  narrate: `- 现金交易使用【交易报价】或已确认的报价；物品参考价不是每个卖家的成交价。询价和议价不等于交付，不在未成交时写钱货已转移。
- 钱不够就是付不起：写成讨价还价、赊账、被拒或者另想办法，不让角色掏出超过余额的钱。
- 委托的报酬、雇主另给的小费、顺手摸到的钱，正文里写清楚到手多少。`,
  text: `- 【当前状态】里写着身上有多少欧元。钱只走三条路，都不写数字，价钱由同一报价结算：买卖物品和服务写 trade（with 用真实店铺、人物或已登记经营者 id，谈妥的新条件先登记 commerce.offer，再引用 offer），搜到、摸到的零钱和雇主另给的小费写 loot，委托报酬由 jobEnd 结算。
- 钱不够就是付不起：正文里写成讨价还价、赊账、被拒或者另想办法，不写付不起的 trade。
- 同一买卖只写一条 trade，不另发 item gain/lose 或 money；仅询价、提出折扣和未落实的赊账不算成交。不能凭目录给未知卖家生成货，店内向别人私下买卖也不扣店铺库存。
- 被抢、丢了钱这类正文里写清楚，账目由代码按剧情另记；不要自己编价钱。`,
};
