import type { RuleModule } from "../../kernel/system";
import type { TravelState } from "./schema";

/** 输入里像要换地方的说法 */
const GO = /去|前往|打车|出租车|轻轨|NCART|开车|骑车|走过去|赶过去|回家|回公寓/i;
/** 输入里像和车有关的说法 */
const CAR = /车|摩托|追|甩掉|飙|撞/;

export const travelRules: RuleModule<TravelState> = {
  id: "travel",
  title: "出行、载具和路上偶遇",
  commands: ["vehicle"],
  when: (state, input) =>
    state.encounter !== null ||
    (input.mode !== "ooc" && (GO.test(input.text) || CAR.test(input.text))),
  judge: `- 没有快速移动。玩家在路线面板确认的出行，耗时、路费、到达时间和路上偶遇都由代码定了，不要为路途本身再给检定；路上的偶遇引出的冲突照常判。
- 自由输入里说要去哪（"打车去来生"）就照常写：过了多久按路途和方式定，location 写目的地。
- 偷车：没人看着的普通车给技术门槛（gate 的 attribute 写 tech），有警报、有人守着或者大白天在街上给技术检定；失败是警报响、车主追来或 NCPD 到场。
- 追车（追人或被追）掷反应（check 的 attribute 写 reflexes）；车的速度档高、车况好时给加成，受损、偷来的车不熟时给减值。确认条里写明失败的代价：车受损、被拦下或通缉星涨。
- 买车走 buy：item 写车型 id。`,
  narrate: `- 【这一轮已定】里有【出行】时，照那里的方式和耗时写路上和到达：轻轨上人挤人、广告和传教的，出租车里 Delamain 客气地搭话，步行时街景、气味和危险；路上和同伴说话用的是这段路途时间。
- 有【路上偶遇】时这一场要让它出现，但写成世界自己发生的事，不替玩家决定管不管；玩家不理就照素材让它在屏幕外发展，以后可能找上门。
- 没有偶遇时就别自己加一个：一场最多一次，由代码定。
- 车是角色的一部分：车况、偷来的车被认出、后备箱里的东西都可以写进场面；车报废了就只能换别的走法。`,
  text: `- 没有快速移动。玩家在路线面板确认的出行，代码已经推进时间、扣路费、换了地点（写在【这一轮已定】里）：world 里不要再写 location，time 只能写到达以后。
- 自由输入里说要去哪（"打车去来生"），照常在 world 里写 location（地点 id）和到达的 time，过了多久按路途和方式定。
- 【当前状态】或【这一轮已定】里有路上偶遇时，这一场要写出来；玩家可以不理，不理就让事情在屏幕外发展。偶遇一场最多一次，由代码定，不要自己再加。
- 载具写 vehicle：买车 buy（model 写车型 id，代码按车价扣钱）；偷车 steal（本轮技术门槛达标或检定成功，写 witnesses）；撞坏 damage（受损一档，受损的再坏就报废）、wreck 直接报废；修车 repair（代码按车价一成收钱）；扔掉 abandon（偷来的车用完了常要扔）；追车 chase（本轮掷过反应，stake 写事先说好的失败代价：damage、stopped、heat）。不写 vehicle 时是正在开的那辆。
- 【当前状态】里列着名下的车；没有车就不能开车走，偷来的车开着风险高，NCPD 迟早会找。`,
};
