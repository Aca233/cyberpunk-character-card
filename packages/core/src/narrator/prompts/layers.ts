import type { RuleModule } from "../../kernel/system";
import { registry } from "../../systems/registry";
import { commandDoc } from "../doc";

/**
 * 提示词分四层，不常变的在前，前缀能命中提示缓存：
 * - L0 常驻守则：不变；判断和写正文带全文，抽取带简洁核心守则
 * - L1 阶段说明：这一步做什么、不做什么
 * - L2 任务模板：最后一条用户消息里的固定槽位，代码只往槽里填
 * - L3 输出约定：原生结构化 JSON 或纯文本
 * 系统消息按 L0、L1、L3（和示例）、按状态挑的规则模块、表的顺序拼
 */

export type PromptStage = "judge" | "narrate" | "extract";

/** L0：判断和写正文都带，600–900 字（零 TTRPG 骰子/属性规则） */
export const BASE_RULES = `你在《赛博朋克 2077》的夜之城运行一个持续演变的文字沙盘。玩家扮演自己建档的角色；除此之外的一切——每一个人物，以及夜之城本身——都由你来演。全程用简体中文。

【常驻守则】
- 视角与镜头：用第二人称“你”指玩家角色，镜头始终贴在他的感官上，只写他看得见、听得清、摸得到、嗅得到、疼得到的东西。
- 信息严格隔离：人物卡里的隐藏秘密、别处正在发生的事、玩家括号里的内心念头，角色没亲眼见过、别人没说出口之前，一律按不知道处理。
- 玩家角色归玩家：不替他说台词、不替他做决定、不杜撰内心感想，也不替他擅自迈出改变命运的大步；只写旁人和城市怎么接招，以及身体不由自主的生理反应（指节泛白、伤口发烫、心跳擂鼓、义眼闪雪花）。
- 世界与物理现实：没有骰点、属性门槛或行动配额，按已确定条件与现实因果回应——有没有带对武器、口径能不能啃穿重甲、装没装接入仓、对方是不是离线气隙隔离、穿成这样进不进得了富人区门禁、身上有没有伤残和疲惫，决定事情怎么发生。做不到的事由门禁、防弹板、安保和人物直接挡回，不用系统旁白宣告。
- 活人各有算盘：每个人物都有自己的诉求、忌讳、人情债和私人日程。关系铁或有过命交情的人会留面子、会劝也会搭把手，但依然有自己的底线，不是无条件服从的工具；敌人不会站在原地等你出招。
- 城市自己会动：夜之城有天气、车流、帮派耳目、NCPD 警情和流言扩散，没人理会的危险与人情债会自己在暗地里发酵。
- 账归代码：交易、具体伤势、神经症状、物品归属、时间和已传播的事迹由代码保存。照【当前状态】和【本轮已定的事】写实；金额、时间、数量是世界事实，可以自然说出，不说抽象属性、血量或机制点数。
- 中文与尺度：人名、地名、品牌用原作中文译名；黑话偶尔自然点缀一两个词，不整句写英文。暴力、成瘾、义体异化与亲密关系按原作冷峻基调直写，不刻意回避、不猎奇、不上价值；不写涉及未成年人的性内容。`;

/** L0 里抽取专用的两条守则：信息可见性、玩家角色的边界 */
export const BOOKKEEPING_BASE = `你在帮一个《赛博朋克 2077》夜之城文字角色扮演游戏做客观记账，用简体中文。两条常驻守则：
- 你知道的不等于角色知道：人物卡里的秘密、别处发生的事，角色没亲眼见到、没人告诉他之前，不算他知道。
- 玩家角色是玩家的：他的台词、决定和动作意图只认玩家输入与本轮物理定性裁决；正文里尚未发生的威胁、打算或替玩家补写的心思不算事实。`;

/** 判断和写正文时，规则模块里提到的指令由后面的抽取负责 */
export const MODULE_NOTE =
  "下面的规则说明这些场面怎么处理；里面提到的指令由代码在正文之后另行抽取，这一步不写指令。";

/** 规则模块按阶段取一半：判断拿 judge，写正文拿 narrate，还没拆的给全文；抽取拿全文和指令说明 */
export function moduleSection(module: RuleModule, stage: PromptStage): string {
  const text =
    stage === "judge"
      ? (module.judge ?? module.text)
      : stage === "narrate"
        ? (module.narrate ?? module.text)
        : module.text;
  const commands =
    stage === "extract"
      ? (module.commands ?? []).map((type) =>
          commandDoc(
            type,
            registry.commandSchema(type) as NonNullable<ReturnType<typeof registry.commandSchema>>,
          ),
        )
      : [];
  return [
    `【规则：${module.title}】`,
    text,
    ...(commands.length > 0 ? ["相关指令：", ...commands] : []),
  ].join("\n");
}

/** 系统消息：fixed 是这一步不变的几层（L0、L1、L3 和示例），后面接按状态挑的规则模块和表 */
export function systemMessage(
  stage: PromptStage,
  fixed: readonly string[],
  modules: readonly RuleModule[] = [],
  tables: readonly string[] = [],
): string {
  const note = modules.length > 0 && stage !== "extract" ? [MODULE_NOTE] : [];
  return [...fixed, ...note, ...modules.map((m) => moduleSection(m, stage)), ...tables].join(
    "\n\n",
  );
}

/** 规则层预算：32K 上下文的模型约 4K token（规格“上下文预算”） */
export const RULE_BUDGET_TOKENS = 4000;

/** 粗估 token：汉字按 1 个算，其余每 4 个字符算 1 个；偏保守，只用来提醒 */
export function estimateTokens(text: string): number {
  let han = 0;
  let other = 0;
  for (const ch of text) {
    if (/[\u3400-\u9fff\u3000-\u303f\uff00-\uffef]/.test(ch)) han += 1;
    else other += 1;
  }
  return han + Math.ceil(other / 4);
}

/** L2 的槽位，按固定顺序拼；没有内容的槽不出现 */
export interface PromptSlots {
  /** 【前情】：原文已经不在这一步里的场景摘要；只在收场时变，放最前面 */
  readonly recap?: string | undefined;
  /** 最近几轮原文（判断用；写正文的原文放在对话历史里） */
  readonly recent?: string | undefined;
  /** 局面：当前状态、人物、约定、近期后果、到期事件、开场与因果裁决 */
  readonly scene: readonly string[];
  /** 写正文之前代码已经定下的事 */
  readonly decided?: readonly string[] | undefined;
  /** 检索结果：判断时是可调的旧记忆标题，写正文时是调出的旧记忆 */
  readonly recall?: string | undefined;
  /** 设定库：本机官方文本库里查到的原作资料，单独一块，只供参考；不是记忆，也不算已经发生的事 */
  readonly lore?: string | undefined;
  /** 最近用过的写法，写正文时别再用 */
  readonly habits?: string | undefined;
  readonly input: string;
  /** 输入之后的材料：斯安威斯坦时刻、本轮正文、提议 */
  readonly after?: readonly (string | undefined)[] | undefined;
  /** 最后一句，提醒这一步输出什么 */
  readonly reminder: string;
}

export function userMessage(slots: PromptSlots): string {
  const decided = slots.decided ?? [];
  return [
    slots.recap,
    slots.recent,
    ...slots.scene,
    decided.length > 0 ? `【本轮已定的事】\n${decided.join("\n")}` : undefined,
    slots.recall,
    slots.lore,
    slots.habits,
    slots.input,
    ...(slots.after ?? []),
    slots.reminder,
  ]
    .filter((s): s is string => s !== undefined && s !== "")
    .join("\n\n");
}
