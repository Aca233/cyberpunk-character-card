import type { RuleModule } from "../../kernel/system";
import type { CombatState } from "./schema";

/** 输入里像要开打的说法；宁可多带，漏带时模型不知道怎么开战 */
const FIGHT =
  /开枪|开火|射击|扫射|动手|打(他|她|它|过去|起来|一架)|揍|砍|捅|刺(向|过去)|扑(上去|过去)|拔(枪|刀)|冲上去|干掉|宰了|杀了|攻击|拼了|突突/;

export const combatRules: RuleModule<CombatState> = {
  id: "combat",
  title: "战斗",
  commands: ["combat"],
  when: (state, input) => state.active !== null || (input.mode !== "ooc" && FIGHT.test(input.text)),
  text: `- 战斗按“交锋”结算，不是回合制。开打时发 combat start：交锋数 1–3（小冲突 1 次，正经火并 2 次，硬仗 3 次）、败局（输了会怎样，写具体）、敌群（档位决定难度值，杂兵按组合并，不逐个建卡）。
- 每次交锋玩家只有一个主行动。结果不确定时先给 check（tier 用对面最强那一组的档位），检定结果出来的那一轮发 combat next 结算这次交锋；只用一次检定结算一次交锋。
- 埋伏得手、碾压级优势、聪明的办法可以不掷骰直接赢下这次交锋：在指令块写 "direct": true 并发 combat next，正文写清凭什么；没掷骰也不是直接成功就算平手。
- 有名有姓、有人物卡的敌人写进 start 的 foes：[{"npc": 人物卡 id, "tier": 档位, "armor": 装着护甲义体时写 true}]，不放进 enemies；没卡的先用 npc 指令建卡。代码按成功次数算：混混 1 次、精锐 2 次、精英和传奇 3 次打到濒死，护甲多 1 次；大成功算 2 次，直接成功并且确实打中他算 1 次；传奇至少要掷一次骰才拿得下。这次交锋的主行动打的是他时，combat next 写 "target": 他的 id。打到濒死后杀、放还是抓由玩家决定，正文不要替玩家下手。
- 玩家扫描了有卡敌人（义体扫描、快速破解）时发 combat scan，target 写他的 id；界面上这才显示他的血条。
- 每次交锋除了主行动，还能做最多 2 个快捷动作：用快捷栏的治疗品（heal maxdoc）、扔手雷（item use）。代码扣次数、记账，超了会被拦下；快捷动作不掷骰，也不决定这次交锋的胜负。
- 撤退也是主行动：combat retreat，同样要检定或直接成功。上一次交锋赢了、敌人已经溃散时可以 combat end 提前收场。
- 失败扣血只能用 check 里事先写的 damage 档位，不能更重；只有事先写了 lethal 才可能濒死，否则血量归零只是倒下。
- 濒死要在下一次交锋结束前被救回：只有在场的原作人物或现场医生能救；没人救就是死亡，正文不要替代码宣布结果。
- 正文里写出现在是第几次交锋、局面朝哪边倒，不写血量数字。`,
};
