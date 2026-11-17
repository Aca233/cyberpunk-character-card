import type { RuleModule } from "../../kernel/system";
import type { SafehouseState } from "./schema";

const WORDS = /安全屋|存放箱|后备箱|放回|拿出|收起来|公寓|回家|住处/;

export const safehouseRules: RuleModule<SafehouseState> = {
  id: "safehouse",
  title: "安全屋和存放",
  commands: ["stash"],
  when: (_state, input) => input.mode !== "ooc" && WORDS.test(input.text),
  narrate: `- 安全屋有床、存放箱和衣柜，不收房租；睡一觉照休整写。存放箱和后备箱里的东西不在身上：没拿出来之前不能用、不能"掏出来"。`,
  text: `- 玩家把背包里的东西放进安全屋的存放箱或车的后备箱写 stash store，拿回来写 stash take；人在安全屋里 where 可以不写，用后备箱 where 写车的 id，车辆必须停在当前位置。报废车只可取物，车内有物品时需取空才能弃车。穿着的衣服或快捷栏里的药/雷需要先脱下（item unequip）。`,
};
