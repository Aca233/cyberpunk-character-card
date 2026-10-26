import type { RuleModule } from "../../kernel/system";
import type { PsychosisState } from "./schema";

const WORDS = /压制剂|吃药|药片|戒断/;

export const suppressantRules: RuleModule<PsychosisState> = {
  id: "suppressant",
  title: "压制剂",
  commands: ["suppressant"],
  when: (state, input) =>
    input.mode !== "ooc" && (state.doses.length > 0 || WORDS.test(input.text)),
  text: `- 角色吞下压制剂写 suppressant，背包里要有；药效期内发作相关检定可以写两项加成（来源：压制剂）。压制剂只缓解症状，不恢复人性上限；吃多了耐受、依赖，戒断时烦躁、手抖、睡不好，相关检定写一项减值（来源：戒断）。`,
};
