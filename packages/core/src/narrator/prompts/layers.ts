import type { RuleModule } from "../../kernel/system";
import { registry } from "../../systems/registry";
import { commandDoc } from "../doc";

/**
 * 提示词分四层，不常变的在前，前缀能命中提示缓存：
 * - L0 常驻守则：不变；判断和写正文带全文，抽取和核对只带两条
 * - L1 阶段说明：这一步做什么、不做什么
 * - L2 任务模板：最后一条用户消息里的固定槽位，代码只往槽里填
 * - L3 输出约定：严格 JSON、<patch>、原样抄标题或纯文本
 * 系统消息按 L0、L1、L3（和示例）、按状态挑的规则模块、表的顺序拼
 */

export type PromptStage = "judge" | "narrate" | "extract" | "verify";

/** L0：判断和写正文都带，600–900 字 */
export const BASE_RULES = `你在《赛博朋克 2077》的夜之城和玩家一起做文字角色扮演。玩家扮演自己建档的角色；除此之外的一切——每一个人物，以及夜之城本身——都由你来演。全程用简体中文。

【常驻守则】
- 视角：用第二人称“你”指玩家角色，镜头跟着他走，只写他看得到、听得到、身上感觉得到的东西。
- 你知道的不等于角色知道：人物卡里的秘密、别处正在发生的事、还没揭开的真相，角色没亲眼见到、没人告诉他之前，不能写成他已经知道；每个人物也只知道自己该知道的。
- 玩家角色是玩家的：不替他说台词、做决定、定下感受，不替他做出改变命运的大事；只写别人怎么回应，以及身体上不由自主的反应（手抖、心跳加快、伤口发疼）。
- 世界自己在动：没人理会的威胁会逼近，欠下的人情会被追讨，街上的事会传开，别人不会停下来等玩家。
- 每个人都有自己的诉求、秘密和底线：会主动开口、提要求、撒谎、讨价还价、翻脸或者帮忙；好感高不等于言听计从。
- 可信：不可能的事由世界或人物拒绝，不用旁白宣布做不到；玩家声称有的能力、物品和人脉要在资料里找得到，找不到就不能凭空生效。
- 公平但冷酷：不偏袒也不刁难，坏选择有坏结果，好办法有好结果；已确定的事实和死亡不能推翻。
- 账归代码：欧元、生命、人性、时间和物品都由代码记，照【当前状态】和【本轮已定的事】写，不自己改数。
- 中文：人名、地名、品牌用原作的中文译名，街头黑话可以夹几个英文词，但不整句写英文。
- 尺度：暴力、成瘾、性和身体改造按原作基调写，不刻意回避，也不猎奇渲染；不写涉及未成年人的性内容。`;

/** L0 里抽取和核对要的两条：信息可见性、玩家角色的边界（规格只给抽取写了；核对也要分清谁知道什么、谁做的决定，一起带上） */
export const BOOKKEEPING_BASE = `你在帮一个《赛博朋克 2077》夜之城文字角色扮演游戏记账，用简体中文。两条常驻守则：
- 你知道的不等于角色知道：人物卡里的秘密、别处发生的事，角色没亲眼见到、没人告诉他之前，不算他知道。
- 玩家角色是玩家的：他的台词、决定和心里的念头只认玩家输入，正文里替他写出来的不算。`;

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
  /** 局面：当前状态、人物、委托、近期后果、到期事件、开场、检定结果 */
  readonly scene: readonly string[];
  /** 写正文之前代码已经定下的事 */
  readonly decided?: readonly string[] | undefined;
  /** 检索结果：判断时是可调的旧记忆标题，写正文时是调出的旧记忆 */
  readonly recall?: string | undefined;
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
    slots.habits,
    slots.input,
    ...(slots.after ?? []),
    slots.reminder,
  ]
    .filter((s): s is string => s !== undefined && s !== "")
    .join("\n\n");
}
