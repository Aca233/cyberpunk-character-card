import type { RuleModule } from "../../kernel/system";
import type { TraumaState } from "./schema";

const WORDS = /创伤小组|trauma|会籍|白金卡|银卡/i;

export const traumaRules: RuleModule<TraumaState> = {
  id: "trauma",
  title: "创伤小组",
  commands: ["trauma"],
  when: (state, input) => input.mode !== "ooc" && (state.tier !== "none" || WORDS.test(input.text)),
  narrate: `- 创伤小组是装甲浮空车和全副武装的医护，只认会籍：银卡交火结束后来接人、只救倒下；白金卡交火中也会冲进来，能救濒死。恶土、狗镇不进，暴恐机动队出动时不来。他们不管别人，挡路的照样开枪。`,
  text: `- 玩家买了一期会籍（在诊所、网上，或者中间人帮忙办）写 trauma join，tier 写 silver 或 platinum：钱由代码扣，管 30 天，到期不续就失效；你不写 trade。退掉写 trauma cancel。
- 玩家倒下或濒死时，【当前状态】里的「创伤小组」写了会不会来：会来就让他们赶到，写 trauma rescue，代码把人救回来；不会来就照没人救写。不要替没有会籍的人叫来创伤小组。`,
};
