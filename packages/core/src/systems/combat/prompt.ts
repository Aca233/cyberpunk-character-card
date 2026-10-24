import type { RuleModule } from "../../kernel/system";
import type { CombatState } from "./schema";

/** 输入里像要开打的说法；宁可多带，漏带时模型不知道怎么开战 */
const FIGHT =
  /开枪|开火|射击|扫射|动手|打(他|她|它|过去|起来|一架)|揍|砍|捅|刺(向|过去)|扑(上去|过去)|拔(枪|刀)|冲上去|干掉|宰了|杀了|攻击|拼了|突突/;

/** 像要僵持、摊牌的说法 */
const STANDOFF = /对峙|僵持|摊牌|把枪放下|放下枪|枪口对着/;

export const combatRules: RuleModule<CombatState> = {
  id: "combat",
  title: "战斗",
  commands: ["combat"],
  when: (state, input) =>
    state.active !== null ||
    (state.standoff ?? null) !== null ||
    (input.mode !== "ooc" && (FIGHT.test(input.text) || STANDOFF.test(input.text))),
  text: `- 战斗按“段”结算，不是回合制。开打时发 combat start：分几段 moments 1–3（小冲突 1 段，正经火并 2 段，硬仗 3 段）、败局 defeat（输了会怎样，写具体）、敌群 enemies（档位决定难度值，杂兵按组合并，不逐个建卡）。
- 每段玩家只有一个主行动，结果不确定时先给 check（tier 用对面最强那一组的档位）。一段打完、要进下一段时发 combat next；最后一段打完、或者敌人提前溃散，发 combat end 写结局 outcome（victory 或 defeat）。赢没赢由你按检定结果和正文判断，代码只记打到了第几段。
- 有名有姓、有人物卡的敌人写进 start 的 foes：[{"npc": 人物卡 id, "tier": 档位}]，不放进 enemies；没卡的先用 npc 指令建卡。他的情况变了发 combat foe：target 写他的 id，state 写 hurt（受伤了）、down（倒下了）或 fled（逃走了）。倒下以后杀、放还是抓由玩家决定，正文不要替玩家下手。
- 玩家扫描了有卡敌人（义体扫描、快速破解）时发 combat scan，target 写他的 id；界面上这才显示他的情况。
- 每段除了主行动，还能做最多 2 个快捷动作：用快捷栏的治疗品（heal maxdoc）、扔手雷（item use）。代码扣次数、记账，超了会被拦下；快捷动作不掷骰，也不决定这一段的胜负。
- 撤退也是主行动：撤成了发 combat retreat，没撤成照常 next 或 end。
- 失败扣血只能用 check 里事先写的 damage 档位，不能更重；只有事先写了 lethal 才可能濒死，否则血量归零只是倒下。
- 濒死要在下一段结束前被救回：只有在场的原作人物或现场医生能救；没人救就是死亡，正文不要替代码宣布结果。玩家倒下或死了，代码按败局收场。
- 正文里写出现在是第几段、局面朝哪边倒，不写血量数字。
- 双方摊牌、有人拔枪或要谈判时，可以先开对峙：combat standoff（opponent 写对面是谁，rounds 2–3 轮）。代码每轮倒数，时间到了下一轮对方先动手。对峙时正文停在僵持的那一刻，不替玩家开枪或让步。
- 对峙按顺序判：说中对方的诉求、亮出把柄或筹码、镇定门槛达标，可以 combat defuse 免掉这场仗，或者开战时少写一段；触到底线立刻 combat start。
- 开战时用 edge 写第一段谁占先机：玩家在对峙里先开枪、埋伏得手写 player（检定 +2），同时按先动手发 event，对没拔枪的人开枪可以扣人性；谈崩被抢先、被埋伏、潜入到交战档写 enemy（检定 −2，写进 penalties，计入 −4 上限）。对峙时间到了不写 edge 也按 enemy 算。`,
};
