import type { RuleModule } from "../../kernel/system";
import { ANCHORS_MAX, type PsychosisState } from "./schema";

const WORDS = /锚点|压制剂|吃药|药片|戒断/;

export const anchorRules: RuleModule<PsychosisState> = {
  id: "anchors",
  title: "锚点和压制剂",
  commands: ["anchor", "suppressant"],
  when: (state, input) =>
    input.mode !== "ooc" &&
    (state.anchors.length > 0 || state.doses.length > 0 || WORDS.test(input.text)),
  text: `- 锚点是玩家在人物卡上确认的过命交情，最多 ${ANCHORS_MAX} 个；作用首先是叙事上的：喊出锚点的名字、听见锚点的声音，可以把角色拉回来。需要检定时锚点在场或联系得上，可以写两项加成（来源：锚点）。不要替玩家设锚点。
- 锚点死去或和角色决裂写 anchor（how 写 dead 或 broken），人性由代码扣，不要再另写 humanity anchor。
- 角色吞下压制剂写 suppressant，背包里要有；药效期内发作相关检定可以写两项加成（来源：压制剂）。压制剂只缓解症状，不恢复人性上限；吃多了耐受、依赖，戒断时烦躁、手抖、睡不好，相关检定写一项减值（来源：戒断）。`,
};
