import type { RuleModule } from "../../kernel/system";
import { HUMANITY_KINDS } from "../humanity";
import { type HackingState, RAM_SEGMENT_REGEN } from "./schema";

/** 输入里像要骇入的说法 */
const HACK = /骇|黑进|黑掉|入侵|快速破解|上传|破解|潜网|接入点|接入仓|网络黑客|ICE|RAM/i;

const CRUELTY = -HUMANITY_KINDS.cruelty.sizes.medium;

export const hackingRules: RuleModule<HackingState> = {
  id: "hacking",
  title: "骇入和快速破解",
  commands: ["hack"],
  when: (state, input) => state.deck !== null || (input.mode !== "ooc" && HACK.test(input.text)),
  judge: `- 快速破解要装网络接入仓，只能放【当前状态】里已装的程序；RAM 不够就放不了，代码会拦下，这时让玩家换办法。
- 对没有人物卡的杂兵直接生效，不检定；对有人物卡的人、敌方网络黑客要掷智力（check 的 attribute 写 intelligence），失败是被 ICE 挡下、对方察觉或反向追踪你。
- 好办法（先扫描、找到接入点、对方没装防火墙）照意图优先给加成；对方有网络黑客守着、隔着防火墙时给减值。`,
  narrate: `- 写出上传的过程：视野里锁定目标、程序传过去、对方身上的反应；控制和隐蔽类写对方的困惑和失措，伤害类写义体过热、电流、毒性程序。
- 终极类（赛博精神病、自我了断、系统崩溃）写得冷，不渲染快感；人性的代价代码已经扣了。
- RAM 用完就只能换别的办法；战斗中每打完一段回 ${RAM_SEGMENT_REGEN} 格，场景结束、休整后回满。
- 被追踪时按追你的是谁写后果：公司盯上你，网络监察发警告，帮派直接上门。`,
  text: `- 快速破解要装网络接入仓，只能放【当前状态】里已装的程序；放一次写一条 hack（program 写程序 id，target 写对谁）。RAM 不够、没装接入仓或没装这个程序时代码拦下，这时让玩家换办法。
- 对没有人物卡的杂兵直接生效，不检定；对有人物卡的人、敌方网络黑客要先掷智力，hack 里写 npc（卡的 id），失败是被 ICE 挡下、对方察觉或反向追踪你。
- 终极类（赛博精神病、自我了断、系统崩溃）代码自动按残忍行为扣 ${CRUELTY} 点人性，不要再另写 humanity；正文写得冷，不渲染快感。
- 得到新程序（买到、从芯片里拷来）写 hack 的 action learn 并写 reason；程序格满了先 drop 一个。
- RAM 用完就只能换别的办法；战斗中每打完一段回 ${RAM_SEGMENT_REGEN} 格，场景结束、休整后回满。
- 被追踪时按追你的是谁写后果：公司盯上你，网络监察发警告，帮派直接上门。`,
};
