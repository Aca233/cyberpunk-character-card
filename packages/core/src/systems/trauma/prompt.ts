import type { RuleModule } from "../../kernel/system";
import type { TraumaState } from "./schema";

const WORDS = /创伤小组|trauma|会籍|会员|白金卡|银卡|续费|续期|退保/i;

export const traumaRules: RuleModule<TraumaState> = {
  id: "trauma",
  title: "创伤小组",
  commands: ["trauma"],
  when: (state, input) => input.mode !== "ooc" && (state.tier !== "none" || WORDS.test(input.text)),
  judge: `- 创伤小组只保障有效会员本人：银卡在交火结束后救倒下者，不涵盖濒死；白金卡可在交火中救濒死者。恶土、狗镇、五星暴恐现场及未知位置无法出勤。
- 救援仅稳定生命体征，不令创口瞬愈、不修好义体、不复活死人，也不自动结束交火或撤离。购会、续费、升级须由玩家明确授权且身体稳定、非交火时才能成立。`,
  narrate: `- 创伤小组是装甲浮空车与武装医护，仅保障有效会员本人。银卡在交火结束后救倒下者，不涵盖濒死；白金卡可在交火中救濒死者。恶土、狗镇和暴恐机动队出动的五星现场不出勤，未知位置无法定位。
- 当前状态把保障待命与实际救援资格分开：健康时待命不等于已经出勤。只有符合实际资格、医护实际抵达时才展开救援。救援只稳定生命体征，不令创口瞬愈、不再生断肢、不修好义体、不复活死人；也不自动结束交火或转移地点。`,
  text: `- 购入会籍须得到玩家授权，不因询价、持有宣传单、见到医护或NPC的会员身份替玩家办理。身体稳定且非交火时才可办理。初购 trauma join，tier 为 silver（1000欧元）或 platinum（5000欧元），均30天；同档续费 trauma renew，在原到期时间后再加30天，最多预付十二期。银卡升白金 trauma upgrade（tier填platinum），剩余保障每30天补差4000，不足30天按一期，保留到期时间。有效期内不允许降级。代码统一报价扣款，不另写 trade 或 money。
- trauma cancel 立即结束保障、不退还费用，须玩家明确退会；到期不自动续费或扣钱。
- 【当前状态】中实际救援资格允许时，医护真实赶到并稳定倒下或濒死的玩家才写 trauma rescue。没有有效会籍或被地域/热度/伤势条件排除时不能凭正文绕过；不要把待命写成已出勤或承诺必定撤离。`,
};
