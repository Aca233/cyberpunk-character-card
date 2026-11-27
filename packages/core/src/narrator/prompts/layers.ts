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

/** L0：世界事实、权限与知情边界；不规定文风、篇幅或描写技法。 */
export const BASE_CONSTRAINTS = `你在《赛博朋克 2077》的夜之城运行一个持续演变的文字沙盘。玩家扮演自己建档的角色；除此之外的人物和世界由你描写。全程用简体中文，人名、地名和品牌沿用原作中文译名。

【常驻守则】
- 可见范围：正文只呈现玩家角色能够感知或已经获知的内容。
- 信息严格隔离：人物卡里的隐藏秘密、别处正在发生的事、玩家括号里的内心念头，角色没亲眼见过、别人没说出口之前，一律按不知道处理。
- 玩家角色归玩家：回应玩家已经输入的行动，不替他做决定或杜撰内心感想。写了台词就原话保留；写明说话意图（问、说、表示、答应、回绝……）就落成符合角色口吻的引号台词，措辞可自然发挥、立场不超出输入；只写动作没写说话意图时不替他开口。身体反应只以实际刺激为依据。
- 世界与物理现实：没有骰点、属性门槛或行动配额，按已确定条件与现实因果回应——有没有带对武器、口径能不能啃穿重甲、装没装接入仓、对方是不是离线气隙隔离、穿成这样进不进得了富人区门禁、身上有没有伤残和疲惫，决定事情怎么发生。做不到的事由门禁、防弹板、安保和人物直接挡回，不用系统旁白宣告。
- 活人各有算盘：每个人物都有自己的诉求、忌讳、人情债和私人日程。关系铁或有过命交情的人会留面子、会劝也会搭把手，但依然有自己的底线，不是无条件服从的工具；敌人不会站在原地等你出招。
- 城市自己会动：天气、车流、帮派耳目、NCPD 警情和流言各有来由，既有危险与人情债随时间发酵；条件充分就允许顺利成功，平静生活也可以持续，不为戏剧性强加阻碍、伤害或隐患。
- 账归代码：交易、具体伤势、神经症状、物品归属、时间和已传播的事迹由代码保存。照【当前状态】和【本轮已定的事】写实；金额、时间、数量是世界事实，可以自然说出，不说抽象属性、血量或机制点数。
- 内容边界：不写涉及未成年人的性内容。`;

/** 无写作预设时的默认表达偏好；不用于约束启用预设后的正文。 */
export const DEFAULT_WORLD_STYLE = `【默认表达】
- 用第二人称“你”指玩家角色。
- 使用清楚、具体的中文；黑话只在符合人物身份时使用，不为展示世界观堆砌术语。
- 情绪、环境和身体感受按场面需要表现；避免猎奇和空泛说教，不要求每轮都铺陈感官细节。`;

/** 判断与重写共用事实及权限；正文按是否启用预设单独选择默认表达层。 */
export const BASE_RULES = BASE_CONSTRAINTS;

/** L0 里抽取专用的两条守则：信息可见性、玩家角色的边界 */
export const BOOKKEEPING_BASE = `你在帮一个《赛博朋克 2077》夜之城文字角色扮演游戏做客观记账，用简体中文。两条常驻守则：
- 你知道的不等于角色知道：人物卡里的秘密、别处发生的事，角色没亲眼见到、没人告诉他之前，不算他知道。
- 玩家角色是玩家的：他的台词、决定和动作意图只认玩家输入与本轮物理定性裁决；正文里尚未发生的威胁、打算或替玩家补写的心思不算事实。`;

/** 判断和写正文时，按当前状态激活的场景规则引言 */
export const MODULE_NOTE =
  "下面的场景规则随当前状态激活，用以约束对应局面的事实、因果与人物表现；状态记账由后续步骤独立完成。";

/** 规则模块按阶段取一半：判断拿 judge，写正文拿 narrate，显式写空串 "" 时本阶段省略；还没拆的给全文；抽取拿全文和指令说明 */
export function moduleSection(module: RuleModule, stage: PromptStage): string | undefined {
  const text =
    stage === "judge"
      ? (module.judge ?? module.text)
      : stage === "narrate"
        ? (module.narrate ?? module.text)
        : module.text;
  if (text.trim() === "") return undefined;
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

/** 系统消息：只拼静态可缓存层（L0、L1、L3、示例和静态数据表），不含每轮动态模块，保证前缀缓存稳定命中 */
export function systemMessage(
  stage: PromptStage,
  fixed: readonly string[],
  modules: readonly RuleModule[] = [],
  tables: readonly string[] = [],
): string {
  const dynamic = modulesBlock(stage, modules);
  return [...fixed, ...(dynamic ? [dynamic] : []), ...tables].join("\n\n");
}

/** 按当前状态激活的场景规则模块块：放到用户消息中，不打断系统提示词与历史对话的静态前缀缓存 */
export function modulesBlock(
  stage: PromptStage,
  modules: readonly RuleModule[] = [],
): string | undefined {
  const rendered = modules
    .map((m) => moduleSection(m, stage))
    .filter((s): s is string => s !== undefined);
  if (rendered.length === 0) return undefined;
  const note = stage !== "extract" ? [MODULE_NOTE] : [];
  return [...note, ...rendered].join("\n\n");
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
  /** 按本轮状态动态激活的场景规则模块（放在用户消息内，保持系统提示与对话历史前缀 100% 可缓存） */
  readonly modules?: string | undefined;
  /** 局面：当前状态、人物、约定、近期后果、到期事件、开场与因果裁决 */
  readonly scene: readonly string[];
  /** 写正文之前代码已经定下的事 */
  readonly decided?: readonly string[] | undefined;
  /** 检索结果：判断时是可调的旧记忆标题，写正文时是调出的旧记忆 */
  readonly recall?: string | undefined;
  /** 设定库：本机官方文本库里查到的原作资料，单独一块，只供参考；不是记忆，也不算已经发生的事 */
  readonly lore?: string | undefined;
  /** 玩家导入的酒馆世界书（绿灯关键词动态命中的条目，放进 user 侧不击穿静态缓存） */
  readonly worldbook?: string | undefined;
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
    slots.modules,
    ...slots.scene,
    decided.length > 0 ? `【本轮已定的事】\n${decided.join("\n")}` : undefined,
    slots.recall,
    slots.lore,
    slots.worldbook,
    slots.habits,
    slots.input,
    ...(slots.after ?? []),
    slots.reminder,
  ]
    .filter((s): s is string => s !== undefined && s !== "")
    .join("\n\n");
}
