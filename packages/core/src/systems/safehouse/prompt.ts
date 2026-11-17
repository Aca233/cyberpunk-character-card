import type { RuleModule } from "../../kernel/system";
import type { SafehouseState } from "./schema";

const WORDS = /安全屋|存放箱|后备箱|车里|车上|放回|拿出|取出|收起来|公寓|回家|住处/;

export const safehouseRules: RuleModule<SafehouseState> = {
  id: "safehouse",
  title: "安全屋和存放",
  commands: ["stash"],
  when: (_state, input) => input.mode !== "ooc" && WORDS.test(input.text),
  narrate: `- 安全屋有床、衣柜和住处，不收房租；睡一觉照休整写。屋内或车内物品不算随身携带；玩家在剧情中当场取用后，本轮同步物品归属，之后可正常使用。`,
  text: `- 玩家在同一行动中明确从当前所在住处或现场车辆取出、存入物品时，直接在本轮叙事结算里写 stash take/store 并同步后续行动；不要要求打开专门的存取界面、额外确认或再用一个行动，也不要另发模型调用。这只记录物品归属，不单独推进时间。安全屋内的物品省略 where；车辆后备箱用当前状态中名下车辆的 id，且车辆必须和玩家在同一已知地点。报废车辆只可取出其中物品。不得虚构未登记物品或把不在现场容器中的物品隔空取出；大件按已确立的车型、物件和场景事实作常识判断，不添加数字容量或格数机制。穿着的衣服或快捷栏里的药/雷需要先脱下（item unequip）。`,
};
