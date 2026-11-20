import type { RuleModule } from "../../kernel/system";
import type { PsychosisState } from "./schema";

const WORDS = /压制剂|抑制剂|阻断剂|吃药|打药|注射|药片|戒断/;

export const suppressantRules: RuleModule<PsychosisState> = {
  id: "suppressant",
  title: "压制剂",
  commands: ["suppressant"],
  when: (state, input) =>
    input.mode !== "ooc" && (state.doses.length > 0 || WORDS.test(input.text)),
  judge: `- 角色当场吞服或注射神经压制剂时，需先确认背包里确实有货，没有就裁定没摸到。
- 若【当前状态】写明压制剂正在起效：感官失真与手抖已被暂时摁住，普通发作被压住；已确认处于临界状态的人遭遇严重新刺激时仍可能突破。
- 若处于戒断期：冷汗、指尖颤抖、干渴与暴躁会实质拖累精细操作与耐心，直至补一针或硬熬过去。`,
  narrate: `- 压制剂只暂时缓解已有神经症状，绝不能写成“喝完/打完恢复了人性”；背包里没有就不能用药，也不产生药效。
- 用药、耐药与戒断的表现依据已登记状态和实际用药史，不为注射或停药额外添加固定感受与症状。`,
  text: `- 角色吞服或注射神经压制剂写 suppressant，背包里要有；药效内压住神经颤抖与常规发作（7 天内 ≥3 次耐药导致药效减半，14 天内 ≥5 次形成依赖，停药一天即戒断）。压制剂只缓解症状，不会凭空消除症状诱因。`,
};
