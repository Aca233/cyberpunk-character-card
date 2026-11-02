import type { RuleModule } from "../../kernel/system";
import { type CombatState, INTENTS, TACTIC_LABELS, TacticSchema } from "./schema";

/** 输入里像要开打的说法；宁可多带，漏带时模型不知道怎么开战 */
const FIGHT =
  /开枪|开火|射击|扫射|动手|打(他|她|它|过去|起来|一架)|揍|砍|捅|刺(向|过去)|扑(上去|过去)|拔(枪|刀)|冲上去|干掉|宰了|杀了|攻击|拼了|突突/;

const tactics = TacticSchema.options.map((t) => `${t} ${TACTIC_LABELS[t]}`).join("、");
const intents = Object.values(INTENTS)
  .map((i) => `${i.label}（${i.counters.map((t) => TACTIC_LABELS[t]).join("、")}拦得住）`)
  .join("；");

export const combatRules: RuleModule<CombatState> = {
  id: "combat",
  title: "战斗",
  commands: ["combat"],
  when: (state, input) => state.active !== null || (input.mode !== "ooc" && FIGHT.test(input.text)),
  judge: `- 战斗一轮一轮打。每个敌人每轮有一个打算，由代码抽，【当前状态】里写着；玩家没看穿时是盖着的。
- 打算和拦得住它的打法：${intents}。玩家这一轮的打法对上了，又过了检定，就拦下了；敌人防着这种打法时拦不住。
- 扫描、细看、逼问都可以看穿一个敌人的打算：扫描要义眼能用，细看和逼问给检定。装死、放假消息、冒充他们的人可以骗过一个敌人，让他这一轮落空，也给检定。
- 有打中玩家还没抵的伤时，这一轮先问玩家拿什么抵，不另给检定。
- 代码替玩家出手的那一轮，按代码定的写，不给检定。`,
  narrate: `- 没看穿的打算不点破，只写动静：他在换弹匣、往侧面挪、手指在终端上敲。看穿了的照直写。
- 打中玩家的那一下写冲击，不写血量；停在玩家要挑拿什么去抵的那一刻：义体、胳膊腿还是肉身。
- 代码替玩家出手时，写"你看着自己的手动了"：动作、冷感，不替玩家的念头找理由。
- 超频义体写过热、视野发白、过后的空洞感。
- 有名有姓的敌人倒下以后，杀、放还是抓由玩家决定。`,
  text: `- 开打发 combat start：objective 这一仗要达成什么，defeat 输了会怎样，foes 每个敌人写 name、archetype（gunner 枪手、brute 打手、netrunner 网络黑客、boss 头目）、tier；有人物卡的写 npc，杂兵一伙合成一条。打算由代码抽，你不写。
- 每轮玩家出手发 combat act：tactic 写 ${tactics} 之一，target 写对谁（敌人 id）。拦没拦下由代码按打算、检定和防备算。
- 看穿了某人的打算发 combat reveal（target）；骗过了某人发 combat fool（target）。
- 某人受伤、倒下、逃走发 combat foe（target、state）。敌人全倒下或跑光时代码自动收场；玩家主动收场发 combat end（outcome），撤成了发 combat retreat。
- 没拦下的打算打中玩家时由代码记账，战斗里你不写 damage。
- 有待抵的伤、玩家在输入里说了拿什么去挡（"用义臂格开""拿左腿去顶""硬吃这一枪"），发 combat pay：pay 写 chrome（加 chrome 写那件义体的 id）、limb（加 limb 写 left-arm、right-arm、left-leg、right-leg 之一）或 flesh；一次只抵最早那一下。输入开头带了【这一下……】标记的，是玩家点按钮选好的，代码已经记了，不要再发 pay。玩家没说拿什么挡，就不发，停在问他的那一刻。`,
};
