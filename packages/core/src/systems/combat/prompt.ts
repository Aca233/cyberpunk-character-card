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
    s.groundLoot.some((l) => l.items.length > 0)
  );
}

export const combatRules: RuleModule<CombatState> = {
  id: "combat",
  title: "战斗",
  commands: ["combat"],
  when: (state, input) =>
    state.active !== null || (input.mode !== "ooc" && (FIGHT.test(input.text) || open(state))),
  judge: `- 打斗没有轮次、没有血条，过程全由你按局面裁定：硬件代差（义体武装度、护甲义体、加速神经、武器口径）、位置、埋伏、情报、人数决定谁占上风。若【当前状态】列有「我方同行参战」的搭档，必须将其真实随身武器、义体、人数与当前伤情一并计入我方战力（重伤同伴掩护能力受限），不要把小队并肩作战写成主角独自硬扛。一两下就能分出生死，但“中一枪就重伤”只适用于打穿防护的情况——皮下护甲/顶配义体面对街头混混的轻武器和菜刀不会轻易破防，满配义体人收拾普通小兵应当干净利落（possible，harm:none）。
- 结果要讲得通：玩家没准备、装备吃亏、遇上重装精锐或被重火力/多人围堵，就让他吃亏、挂彩、丢东西或者跑；反过来，当玩家全身军用/顶配义体打街头杂兵时，就该让对手被碾压、溃逃或瞬秒，绝不为了凑“紧张感”强行五五开。
- 代码不判过程，只记后果：谁倒下、谁死了、谁跑了、玩家哪里挨了一下、同行同伴是否挂彩或阵亡、有多少人看见、有没有摄像头。`,
  narrate: `- 打斗的先后、位置变化和伤亡以本轮裁决与实际行动为准，不把伤势写成抽象血量。双方硬件成色必须拉出真实差距：满身军用/顶配义体的主角面对街头混混就是降维打击，该弹开子弹、一拳放倒、瞬斩压制就干脆写出来，不强行写成险胜。有同行搭档在场时，自然写出其火力掩护、配合或负伤反应。
- 死者的身份和关系延续【当前状态】；只有现场可观察或确有消息来源的信息才能进入玩家的知情范围。
- 没好的伤和疤延续【当前状态】，对动作的影响按实际伤情决定，不额外制造症状。
- 流言传到的地区，那里的人信的是流言里的玩家：会躲、会挑衅、会开价，说出来的版本和真相对不上。
- 找上门的人挑合适的时候出场，不要一来就开打：他可能来讨说法、来谈价钱、来报仇，也可能只是站在街对面看着。`,
  text: `- 真动手了发 combat start：foes 每人写 name、archetype（gunner 枪手、brute 打手、netrunner 网络黑客、boss 头目）、tier，属于哪伙人写 gang；有人物卡的写 npc，杂兵一伙合成一条。开打会自动将现场警戒拉至交战档，不必重复手写同一笔 alert；若原本随行的同伴当场反水列入 foes，代码会自动解除随行。
- 同行搭档在战斗中受伤、重伤倒地、阵亡或中途撤离失散，直接复用原 npc 指令发 npcHurt / npcDeath / npcCompanion(following: false)，不另造战斗指令。
- 场上有人倒下、死了、跑了发 combat foe（target 写他的 id，state 写 down、dead、fled）。死了的由代码补名字和等他的人，你不编；若死者属于明确势力，代码会自动结算对应的势力态度恶化或本帮帮规污点，不必重复手写同一笔 faction。
- 玩家挨了一下发 combat wound：by 写谁打的（场上的 id 或名字），weapon 写用什么，part 写 head、face、chest、belly、left-arm、right-arm、left-leg、right-leg 之一，tier 写 graze、heavy、lethal。记录具体创口和机能影响，不扣抽象血量，战斗里不另写 damage。
- 打完了发 combat end：witnesses 写看见的人数，cameras 写有没有摄像头，truth 用一句话写真实发生了什么。有人看见时代码起流言、定录像在谁手里。
- 从倒下或死了的人身上捡东西发 combat loot（target、item，只能是【当前状态】里他身上有的 id）。物品由代码放进背包，同一次拾取不另发 item gain。
- 已有人物的随身物以人物卡为准，开打不会重新生成。未拾取的物件留在原地，换场或下一次冲突不清空；只能在它所在地点拾取。桌上的工具等环境物件照常发 item gain，必须说明真实来源。
- 找人处理一处伤发 combat treat（target 写伤口 id），代码按街头诊所价目扣一次医疗费，余额不足则治疗和扣款都不生效；同一处伤重复处理不再收费。处理后仍需恢复时间，不是立刻痊愈；重创、致命伤愈合后仍留下伤疤，普通医疗不消除深层伤痕。同一次伤口治疗不另发 trade service medical，避免重复扣钱。
- 压下流言发 combat rumor（target、how silenced）；收买传话的人写 how bought，钱由代码扣。
- 录像追回、毁掉、付钱买下发 combat footage（target，how 写 recovered、destroyed、paid）。
- 找上门的人在正文里出场了发 combat avenger（target 写死者 id，how came）；事情了结了写 how settled。`,
};
