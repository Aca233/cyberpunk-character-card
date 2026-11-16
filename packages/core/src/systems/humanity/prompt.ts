import type { RuleModule } from "../../kernel/system";
import type { HumanityState } from "./schema";
export const psychosisRules: RuleModule<HumanityState> = {
  id: "cyberpsychosis",
  title: "神经症状与现实压力",
  commands: ["humanity", "episode", "lostControl"],
  when: (state, input) =>
    state.symptoms.length > 0 || /过载|耳鸣|幻听|失控|创伤|排异|神经|崩溃/.test(input.text),
  judge: `- 神经症状来自实际过载、排异、受伤、创伤或刺激，不因义体数量、稀有度、使用次数或道德评价自动发生。
- 对照已登记症状、正在起效的治疗和本轮诱因决定是否改变状态；没有新诱因，不重复发作。压制剂缓解症状，不清除病因。
- 自救、离开刺激源、得到支持和治疗能改变局势。不得替玩家选择杀人或篡改核心意图。`,
  narrate: `- 神经症状及其影响只以已确定的症状和实际诱因为依据；幻觉不等于客观世界事实，他人只能对实际观察到的表现作出反应。
- 不按数值阈值或每场配额制造发作。过去发生的症状不会因为切场消失。`,
  text: `- 实际出现或改变症状写 humanity affect：id 为稳定症状标识，symptom 写具体表现，stage 只描述当前严重程度，reason 写实际诱因。实际缓解写 humanity recover 并引用该症状 id。
- 不把装义体、用加速、杀人或任务结局换成人性加减；不设单次扣分、每日恢复或每场发作配额。
- episode 只能延续已有不稳定症状并有具体新诱因，event 标识这次刺激，不能重复记同一事件。lostControl 只写已发生的短暂动作失误，不替玩家做核心选择。
- 处于压制剂药效时普通发作应被压住；仅已确认临界症状受严重新刺激时可能突破。`,
};
