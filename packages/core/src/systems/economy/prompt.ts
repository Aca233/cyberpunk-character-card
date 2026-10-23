import type { RuleModule } from "../../kernel/system";
import type { EconomyState } from "./schema";

export const economyRules: RuleModule<EconomyState> = {
  id: "economy",
  title: "欧元",
  commands: ["money"],
  when: () => true,
  text: `- 【当前状态】里写着身上有多少欧元。付钱、收钱、被抢、被罚都写一条 money；价钱照夜之城的物价，物品表里有参考价，街边一碗面十几欧元，一晚胶囊旅馆几十欧元。
- 钱不够就是付不起：正文里写成讨价还价、赊账、被拒或者另想办法，不发超出余额的 money。
- 委托的报酬由 jobEnd 结算，不另写 money；雇主另给的小费、顺手摸到的钱才写 money。`,
};
