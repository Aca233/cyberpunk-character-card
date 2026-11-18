import type { RuleModule } from "../../kernel/system";
import type { SafehouseState } from "./schema";

const WORDS =
  /安全屋|公寓|回家|回公寓|回窝|住处|睡觉|休息|躲|藏|车|摩托|后备箱|放|留|拿|取|带|塞|交|托|扔|丢|换|穿|脱/;

export const safehouseRules: RuleModule<SafehouseState> = {
  id: "safehouse",
  title: "住处与留置物品",
  commands: ["itemPlace", "home"],
  when: (state, input) =>
    input.mode !== "ooc" && (state.homes.length > 0 || WORDS.test(input.text)),
  judge: `- 回家拿枪、换件衣服再出门这类普通生活动作直接按一次完整行动放行，不拆成来回跑两趟，也不要求玩家做额外存取手续。
- 若玩家试图掏出、使用或穿戴某件东西，但它不在随身物品栏而在【住处与留置物品】中（例如留在家里或别的车里），按实际情况裁决为不在身边（需要回去拿或另想办法），不凭空变到手里。
- 住处的价值在于休息恢复、约人见面、藏身避风头或遭人盯梢/闯入；故事里自然获得、借住或失去住处均可按实情发生。`,
  narrate: `- 不必每轮交代家里放了什么或东西留在了哪；平时安静记在后台，只在玩家回家取用、要用时发现不在身边、或留下的证据/人物引发后果时自然带进正文。
- 玩家准备把重要证据、任务物件或尸体留在车上、现场或交给某人时，不强行阻拦；在正文里自然带出一句分量或隐患提示，由玩家自己承担后续演变。`,
  text: `- “回家拿枪、换衣服、然后出门”等复合生活动作，在**同一轮**内一并结算：world 只需写最终目的地（time 按整趟实际经过写），同时按实际动作写 itemPlace take/leave 与 item equip/unequip。
- itemPlace：只有玩家明确把东西留在家里、放进车里、留在现场或暂交某人，或从这些地方拿回随身时才写；普通日常杂物不要主动建档。
  - 留下的物品如果正穿在身上或占着快捷栏，直接写 itemPlace leave 即可（代码自动脱下，不必先发 item unequip）。
  - 现场物体或尸体（从未进过背包）直接塞进车里或留在某处时，可在 itemPlace leave 上直接带 definition 和 origin 登记。
- home：故事里新得住处、借住落脚点写 gain（id、name、location），抄家暴露或退掉写 lose；买公寓由界面或正常交易成交。`,
};
