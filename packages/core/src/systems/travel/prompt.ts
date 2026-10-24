import type { RuleModule } from "../../kernel/system";
import type { TravelState } from "./schema";

/** 输入里像要换地方的说法 */
const GO = /去|前往|打车|出租车|轻轨|NCART|开车|骑车|走过去|赶过去|回家|回公寓/i;

export const travelRules: RuleModule<TravelState> = {
  id: "travel",
  title: "出行和路上偶遇",
  when: (state, input) => state.encounter !== null || (input.mode !== "ooc" && GO.test(input.text)),
  judge: `- 没有快速移动。玩家在路线面板确认的出行，耗时、路费、到达时间和路上偶遇都由代码定了，不要为路途本身再给检定；路上的偶遇引出的冲突照常判。
- 自由输入里说要去哪（"打车去来生"）就照常写：过了多久按路途和方式定，location 写目的地。`,
  narrate: `- 【这一轮已定】里有【出行】时，照那里的方式和耗时写路上和到达：轻轨上人挤人、广告和传教的，出租车里 Delamain 客气地搭话，步行时街景、气味和危险；路上和同伴说话用的是这段路途时间。
- 有【路上偶遇】时这一场要让它出现，但写成世界自己发生的事，不替玩家决定管不管；玩家不理就照素材让它在屏幕外发展，以后可能找上门。
- 没有偶遇时就别自己加一个：一场最多一次，由代码定。`,
  text: `- 没有快速移动。玩家在路线面板确认的出行，代码已经推进时间、扣路费、换了地点（写在【这一轮已定】里）：world 里不要再写 location，time 只能写到达以后。
- 自由输入里说要去哪（"打车去来生"），照常在 world 里写 location（地点 id）和到达的 time，过了多久按路途和方式定。
- 【当前状态】或【这一轮已定】里有路上偶遇时，这一场要写出来；玩家可以不理，不理就让事情在屏幕外发展。偶遇一场最多一次，由代码定，不要自己再加。`,
};
