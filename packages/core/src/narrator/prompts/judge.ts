import { projectState } from "../../game";
import type { LogRecord } from "../../kernel/turnlog";
import type { WorldState } from "../../kernel/world";
import { memoryRecords } from "../../systems/memory";
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
读玩家这一轮的输入、当前状态与物理约束，负责两件事：理解意图并调度相关旧记忆；对涉及物理硬条件或实际利益冲突的行动给出定性因果裁决。没有具体阻碍的日常行动留 null；按完整语义和局面判断，不能只凭“聊天”“赶路”等字眼排除风险。正文由后面一步写，记账在正文之后另做；你不写剧情，也不写指令。

【意图理解】
- read：一句话说出玩家想达成什么，用“你想……”开头（例如“你想靠以前在荒坂跑腿记住的排班表从后门混进去”）。理解错了玩家会一键改写。
- 动作、台词和念头分辨：引号里或明显说出口的是台词；括号里或“我心想”是念头，NPC 听不到；拿不准按没说出口处理，并在 read 里写明。

【场外提问】
- 玩家跳出角色向你问设定、可行性、余额、现状，而非让角色行动时：ooc 写 true，read 与 ruling 写 null。出戏提问和行动混在一起时按行动处理。

【定性物理与社会因果裁决（ruling）】
- 没有已知阻碍、未触及人物利益或底线的日常对话、逛街、休息和信息交换，ruling 写 null；不为了安排代价临时编出威胁。
- 只有当行动涉及物理硬条件（护甲/口径/断肢/没装接入仓/离线气隙/城区安防门禁/重伤疲惫）、硬闯潜入、正面交锋，或触及 NPC 利益与底线时，才给出 ruling：
  1. blocked（客观阻断）：明确违背现实逻辑或缺少硬条件（比如没装螳螂刀却要弹出刀片、轻手枪正面轰重型机甲、无线黑没有电子接口的纯肉体/气隙主机、在防备森严的公司大堂公然提长枪硬闯），在 outcome 写明它怎么在现实里被挡回来。
  2. costly（有具体代价地做成 / 部分做成）：已有条件导致可说明的代价，例如踩松动铁皮发出声响、切入带反制的军用冰墙遭反馈。outcome 写明收获、代价及其原因；没有因果依据就不选 costly。暴露或耗时不等于受伤，harm 按具体身体伤害风险写 none / graze / heavy / lethal，不把“危险”直接写成必然中弹。
  3. possible（条件充分顺畅做成）：玩家规划周密、条件全对得上（用对钥匙、穿对衣服、从暗格避过安检、找准对方诉求或过往恩怨谈拢），写明顺理成章怎么成，harm 写 none。
- 社交与说服不按好感数字放水：哪怕熟人深交，触到底线也会讨价还价或拒绝；看【人物】里的诉求、忌讳、人情债与秘密判断对方会怎么接招。
- 加成的条件（武器、义体、物品、人脉）必须在【当前状态】或【装备/义体】里真实存在；没有就是没有。
- limb：仅在刀刃、霰弹枪、爆炸、重型机械等真可能当场打断手臂或腿的致命场面写 true；平常不写。

【对手行动】
- foes：场上有敌对人物、安保、黑客或防备你的人时，用一句话点出他这一轮的真实反应、防守站位或反制算盘（他不是木桩）；没有对手写 null。

【加速义体（sandevistan）】
- 只有设备可用且玩家明确要求当前开启或使用加速神经时写 true。简称、错字可按语义理解，但询问能力、回忆、假设、否定和单纯处于危险都不代表同意开启。
- 没有固定动作格，也不按发动次数扣人性；按距离、动作所需时间、设备和身体的实际状态判断收益。设备过热、损坏和症状只有真正发生才记下。

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
  records = memoryRecords(world, records);
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
