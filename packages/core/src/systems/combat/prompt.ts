import type { RuleModule } from "../../kernel/system";
import type { CombatState } from "./schema";

/** 输入里像要开打的说法；宁可多带，漏带时模型不知道怎么开战 */
const FIGHT =
  /开枪|开火|射击|扫射|动手|打(他|她|它|过去|起来|一架)|揍|砍|捅|刺(向|过去)|扑(上去|过去)|拔(枪|刀)|冲上去|干掉|宰了|杀了|攻击|拼了|突突/;

/** 案底里还有没了结的：伤没好、有人要找上门、流言在传、录像没了结、东西没捡 */
function open(s: CombatState): boolean {
  return (
    s.wounds.length > 0 ||
    s.dead.some((d) => d.avenger === "pending" || d.avenger === "came") ||
    s.rumors.some((r) => r.stopped === null) ||
    s.footage.some((f) => f.resolved === null) ||
    (s.last?.loot ?? []).some((l) => l.items.length > 0)
  );
}

export const combatRules: RuleModule<CombatState> = {
  id: "combat",
  title: "战斗",
  commands: ["combat"],
  when: (state, input) =>
    state.active !== null || (input.mode !== "ooc" && (FIGHT.test(input.text) || open(state))),
  judge: `- 打斗没有轮次、没有血条，过程全由你按局面裁定：位置、埋伏、情报、人数、手里的家伙决定谁占上风。一两下就能分出生死，中一枪就是真伤。
- 结果要讲得通：玩家没准备、以少打多、对手更狠，就让他吃亏、挂彩、丢东西或者跑；不替玩家凭空赢，也不让他莫名其妙死。
- 代码不判过程，只记后果：谁倒下、谁死了、谁跑了、玩家哪里挨了一下、有多少人看见、有没有摄像头。`,
  narrate: `- 打斗写得快、乱、短：声音、气味、手上的感觉，谁先动手、谁倒下。不写血量和数值。
- 死的人是活过的人：【当前状态】里写着他的名字和在等他的人，正文里可以让玩家看见他兜里的照片、听见他手机在响。
- 身上没好的伤和疤照【当前状态】写：动作会扯到伤口，认得那道疤的人会多看一眼，下雨天它会疼。
- 流言传到的地区，那里的人信的是流言里的玩家：会躲、会挑衅、会开价，说出来的版本和真相对不上。
- 找上门的人挑合适的时候出场，不要一来就开打：他可能来讨说法、来谈价钱、来报仇，也可能只是站在街对面看着。`,
  text: `- 真动手了发 combat start：foes 每人写 name、archetype（gunner 枪手、brute 打手、netrunner 网络黑客、boss 头目）、tier，属于哪伙人写 gang；有人物卡的写 npc，杂兵一伙合成一条。
- 场上有人倒下、死了、跑了发 combat foe（target 写他的 id，state 写 down、dead、fled）。死了的由代码补名字和等他的人，你不编。
- 玩家挨了一下发 combat wound：by 写谁打的（场上的 id 或名字），weapon 写用什么，part 写 head、face、chest、belly、left-arm、right-arm、left-leg、right-leg 之一，tier 写 graze、heavy、lethal。扣血由代码算，战斗里不另写 damage。
- 打完了发 combat end：witnesses 写看见的人数，cameras 写有没有摄像头，truth 用一句话写真实发生了什么。有人看见时代码起流言、定录像在谁手里。
- 从倒下或死了的人身上捡东西发 combat loot（target、item，只能是【当前状态】里他身上有的 id）。物品由代码放进背包，同一次拾取不另发 item gain。
- 找人处理一处伤发 combat treat（target 写伤口 id），代码按街头诊所价目扣一次医疗费，余额不足则治疗和扣款都不生效；同一处伤重复处理不再收费。处理后仍需恢复时间，不是立刻痊愈。同一次伤口治疗不另发 trade service medical，避免重复扣钱。
- 压下流言发 combat rumor（target、how silenced）；收买传话的人写 how bought，钱由代码扣。
- 录像追回、毁掉、付钱买下发 combat footage（target，how 写 recovered、destroyed、paid）。
- 找上门的人在正文里出场了发 combat avenger（target 写死者 id，how came）；事情了结了写 how settled。`,
};
