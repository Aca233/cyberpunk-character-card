import type { RuleModule } from "../../kernel/system";
import type { EconomyState } from "./schema";

export const economyRules: RuleModule<EconomyState> = {
  id: "economy",
  title: "欧元",
  commands: ["trade", "loot"],
  when: () => true,
  judge: `- 【当前状态】里写着身上有多少欧元。要付超出余额的钱就是付不起，按做不到处理，不给 check 去赌能不能付得起。
- 讨价还价照对话处理：看有没有说中对方的诉求，不掷骰。`,
  narrate: `- 价钱照夜之城的物价写：街边一碗面十几欧元，一晚胶囊旅馆几十欧元，物品表里有参考价。
- 钱不够就是付不起：写成讨价还价、赊账、被拒或者另想办法，不让角色掏出超过余额的钱。
- 委托的报酬、雇主另给的小费、顺手摸到的钱，正文里写清楚到手多少。`,
  text: `- 【当前状态】里写着身上有多少欧元。钱只走三条路，都不写数字，价钱由代码查表：买卖物品和服务写 trade（讲价讲下来就选折扣档），搜到、摸到的零钱和雇主另给的小费写 loot，委托报酬由 jobEnd 结算。
- 钱不够就是付不起：正文里写成讨价还价、赊账、被拒或者另想办法，不写付不起的 trade。
- 被抢、丢了钱这类正文里写清楚，账目由代码按剧情另记；不要自己编价钱。`,
};
