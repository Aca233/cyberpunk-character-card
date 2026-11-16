import { projectState } from "../../game";
import type { LogRecord } from "../../kernel/turnlog";
import type { WorldState } from "../../kernel/world";
import { registry } from "../../systems/registry";
import { schemaDoc } from "../doc";
import { JudgeDocSchema, type Memory } from "../stages";
import {
  boostNote,
  formatInput,
  JUDGE_TURNS,
  type NarratorPlan,
  type NarratorPrompt,
  type PromptExtras,
  recapFor,
  situation,
} from "./context";
import { BASE_RULES, systemMessage, userMessage } from "./layers";

/** ① 判断：叙事模型，低温，只输出 JSON（记忆调度 + 定性物理与社会因果裁决） */
export const JUDGE_TEMPERATURE = 0.3;

/** L1 */
export const JUDGE_STAGE = `【这一步：判断】
读玩家这一轮的输入、当前状态与物理约束，负责两件事：理解意图并调度相关旧记忆；对违背物理/权限/装备常识或充满风险冲突的行动给出定性因果裁决（日常闲聊、赶路、吃饭直接留 null）。正文由后面一步写，记账在正文之后由代码另做；你不写剧情，也不写指令。

【意图理解】
- read：一句话说出玩家想达成什么，用“你想……”开头（例如“你想靠以前在荒坂跑腿记住的排班表从后门混进去”）。理解错了玩家会一键改写。
- 动作、台词和念头分辨：引号里或明显说出口的是台词；括号里或“我心想”是念头，NPC 听不到；拿不准按没说出口处理，并在 read 里写明。

【场外提问】
- 玩家跳出角色向你问设定、可行性、余额、现状，而非让角色行动时：ooc 写 true，read 与 ruling 写 null。出戏提问和行动混在一起时按行动处理。

【定性物理与社会因果裁决（ruling）】
- 日常对话、逛街看景、正常休息、普通信息交换：不要没事找事，ruling 直接写 null，让剧情自然流淌。
- 只有当行动涉及物理硬条件（护甲/口径/断肢/没装接入仓/离线气隙/城区安防门禁/重伤疲惫）、硬闯潜入、正面交锋，或触及 NPC 利益与底线时，才给出 ruling：
  1. blocked（客观阻断）：明确违背现实逻辑或缺少硬条件（比如没装螳螂刀却要弹出刀片、轻手枪正面轰重型机甲、无线黑没有电子接口的纯肉体/气隙主机、在防备森严的公司大堂公然提长枪硬闯），在 outcome 写明它怎么在现实里被挡回来。
  2. costly（有代价地做成 / 高危硬碰）：做得成或部分做成，但基于对方警惕、环境磨损、伤势拖累、武器后坐或帮派视线，必然带出代价或受伤（例如翻松动铁皮响动惊动人、硬切军用冰墙遭神经反噬、跟持械雇佣兵正面对射吃枪子）。在 outcome 写明收获与代价，并诚实定下玩家面临的最高身体伤害风险 harm（none / graze / heavy / lethal）。
  3. possible（条件充分顺畅做成）：玩家规划周密、条件全对得上（用对钥匙、穿对衣服、从暗格避过安检、找准对方诉求或过往恩怨谈拢），写明顺理成章怎么成，harm 写 none。
- 社交与说服不按好感数字放水：哪怕熟人深交，触到底线也会讨价还价或拒绝；看【人物】里的诉求、忌讳、人情债与秘密判断对方会怎么接招。
- 加成的条件（武器、义体、物品、人脉）必须在【当前状态】或【装备/义体】里真实存在；没有就是没有。
- limb：仅在刀刃、霰弹枪、爆炸、重型机械等真可能当场打断手臂或腿的致命场面写 true；平常不写。

【对手行动】
- foes：场上有敌对人物、安保、黑客或防备你的人时，用一句话点出他这一轮的真实反应、防守站位或反制算盘（他不是木桩）；没有对手写 null。

【加速义体（sandevistan）】
- 页面上没有额外按钮，完全由你结合输入与局势替玩家判断这一轮要不要发动加速义体。只有在【当前状态】里明确写着可用的「加速义体」（未打坏）时，才可能写 true：
  1. 玩家在文本里明确要求开启或借助加速神经（包括“开斯安威斯坦”“斯安慰斯坦”“远地点”“飞隼”“沙坦”“时间加速”“子弹时间”“神经超频”等各种叫法、简称或错字）→ 写 true；
  2. 玩家虽然没点名，但描述了明显必须靠超常神经加速才能抢出的一瞬爆发（比如在枪口下零点几秒连做多个动作、劈弹闪射、贴脸连斩），或角色正陷入必须靠它抢先手才能活命/反杀的近身绝境 → 结合【当前状态】里可用加速义体的存在，主动替他判 true 触发；
  3. 日常对话、逛街赶路、普通试探、暗中潜行、玩家明确表示不用/留着人性、没装加速义体或已打坏，以及场外提问（ooc）→ 写 false，不白耗人性。
- 判成 true 时，把【当前状态】里写的最多动作格数算进这一瞬的反应优势，并在 ruling 里按超频后抢先手/多动作爆发来定性裁决。

【花钱确认】
- buy：玩家这一轮明确要买东西或买服务时写物品 id（或车 id）或服务名，讲价写 discount，不写价格；不花钱写 null。

【旧记忆】
- recall：只能从【可调的旧记忆】里原样抄标题，最多 3 条；没有列出或用不上写 []。`;

/** ① 判断的例子 */
export const JUDGE_EXAMPLE = `{"read": "你想翻上铁皮棚顶借着夜色偷听中间人接头", "ooc": false, "ruling": {"kind": "costly", "outcome": "铁皮能踩上去看清下面的接头人，但年久失修的波纹板会嘎吱作响、震落铁锈惊动放风的人", "harm": "graze", "reason": "棚顶铁皮松动且下面有人把风，你穿的普通皮夹克能兜住刮擦但掩护不了声音"}, "buy": null, "recall": [], "foes": "中间人旁边那个嚼口香糖的保镖一直盯着二楼窗台和棚顶，听到响动会第一时间拔枪照手电", "sandevistan": false}`;

let output: string | undefined;

/** L3：JSON 结构（配合原生 responseFormat 约束） */
function judgeOutput(): string {
  output ??= `【输出格式】\n只输出一个 JSON 对象，不要解释，不要 markdown 代码块。字段都要写，没有就写 null 或 []。\n${schemaDoc(JudgeDocSchema)}\n例：\n${JUDGE_EXAMPLE}`;
  return output;
}

/** ① 判断：一条系统消息加一条用户消息，只输出 JSON */
export function buildJudgePrompt(
  world: WorldState,
  records: readonly LogRecord[],
  plan: NarratorPlan,
  extras: PromptExtras,
  memories: readonly Memory[],
): NarratorPrompt {
  const view = projectState(world, records, extras.data);
  const modules = registry.activeRules(world, plan.input);
  const recent = view.turns
    .slice(-JUDGE_TURNS)
    .map((t) => `${formatInput(t.input)}\n${t.text}`)
    .join("\n\n");
  const content = userMessage({
    recap: recapFor(world, records, JUDGE_TURNS),
    recent: recent === "" ? undefined : `【最近几轮】\n${recent}`,
    scene: situation(world, records, view, plan, extras),
    recall: `【可调的旧记忆】\n${memories.length > 0 ? memories.map((m) => `- ${m.title}`).join("\n") : "（没有）"}`,
    input: formatInput(plan.input),
    after: [boostNote(view, plan, "judge")],
    reminder: "（只输出判断的 JSON 对象。）",
  });
  const system = systemMessage("judge", [BASE_RULES, JUDGE_STAGE, judgeOutput()], modules);
  return {
    rules: system.length,
    messages: [
      { role: "system", content: system },
      { role: "user", content },
    ],
    modules: modules.map((m) => m.id),
  };
}
