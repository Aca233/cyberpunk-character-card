import type { RuleModule } from "../../kernel/system";
import type { HealthState } from "./schema";

export const healthRules: RuleModule<HealthState> = {
  id: "health",
  title: "失能、救治与生死",
  commands: ["healthCondition"],
  when: (_state, input) => input.mode !== "ooc",
  judge: `- 伤口严重度与行动能力分别判断：贯通伤不必然倒下；实际昏厥、被重击打倒或失去支撑能力但无生命危险时，ruling.condition 写 down；真实濒死需抢救写 dying；只有已经确定发生、且没有救援或其他现实手段化解的死亡才写 dead。未发生这些状态时不填 condition。即使没有新攻击，既有伤势明确恶化也须给出本轮 ruling 与具体因果。
- dying/dead 必须有 harm:lethal 的致命依据。致命风险不等于死亡；濒死仍留有实际抢救可能，不能只因时间推进就自动判死，也不能把尚未抵达的救援视为已获救。`,
  narrate: `- 严守裁决确认的生命状态：倒下是实际失能但未濒死，濒死是急需抢救且尚有挽救可能，死亡须是已定后果。危险预告或单纯经过时间不等于已经死亡。获救只稳定生命体征，具体伤口仍需治疗和恢复。`,
  text: `- 只在正文实际发生且裁决 condition 明确确认时写 healthCondition，condition 为 down/dying/dead，reason 写具体因果；死亡不能由风险、威胁、昏迷或时间推进推断。dying/dead 需要 harm:lethal；不能用 down 把濒死降档。
- damage 与 combat wound 继续记录实际伤口；lethal 默认令角色濒死，不自动死亡。发生倒下或已确认死亡时另记 healthCondition，与导致该状态的事件建立真实因果依赖；不可为同一伤口重复记 damage 与 combat wound。实际医生医疗或创伤小组救援负责稳定，不能用 healthCondition 擅自恢复正常。`,
};
