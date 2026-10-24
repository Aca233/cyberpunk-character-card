import { projectState } from "../../game";
import type { LogRecord } from "../../kernel/turnlog";
import type { WorldState } from "../../kernel/world";
import {
  ATTRIBUTE_LABELS,
  BONUS_CAP,
  DV_MOD_CAP,
  MOD_STEP,
  OPPONENT_TIERS,
  PENALTY_CAP,
} from "../../systems/dice";
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
  situation,
} from "./context";
import { BASE_RULES, systemMessage, userMessage } from "./layers";

/** ① 判断：叙事模型，低温，只输出 JSON */
export const JUDGE_TEMPERATURE = 0.3;

const tiers = Object.entries(OPPONENT_TIERS)
  .map(([id, t]) => `${id}（${t.label}）`)
  .join("，");

const attributes = Object.entries(ATTRIBUTE_LABELS)
  .map(([id, label]) => `${id} ${label}`)
  .join("、");

/** L1 */
export const JUDGE_STAGE = `【这一步：判断】
读玩家这一轮的输入和当前局面，定下玩家想做什么、要不要检定或门槛、要不要调旧记忆。正文由后面一步写，记账在正文之后由代码另做；你不写剧情，也不写指令。

【意图】
- read：一句话说出玩家想达成什么，用“你想……”开头，例如“你想借以前的工号混进去，而不是硬闯”。理解错了玩家会一键改写。
- 玩家一次可能同时写了动作、台词和念头：引号里的或明显说出口的是台词；括号里的或“我心想”是念头，NPC 听不到；拿不准时按没说出口理解，并在 read 里写明。

【场外提问】
- 玩家跳出角色问你（问规则、问能不能这么做、问现在什么情况、问前情），而不是让角色行动：ooc 写 true，read、check、gate 写 null。场外提问和行动混在一起时按行动处理。

【暗中判定】按固定顺序：
1. 对话、说服、谈判、调情、威胁：看有没有说中对方的诉求或触到底线，由 NPC 的性格决定怎么回应，不掷骰，check 写 null。
2. 门槛：属性达标直接成功，不掷骰，写在 gate：选属性、阶段 level（early 前期、mid 中期、late 后期，按这里是城里哪一层的地方、对手是什么人）和 edge（low 偏容易，high 偏难）。门槛的数由代码查表，你不写数字。
3. 只有结果真不确定、失败有意义的后果、成败都能让故事继续时才给 check，写清 success 和 failure。合理的办法直接成功，不给 check；不可能的事也不给 check，后面一步会让世界拒绝。
- 属性：${attributes}。
- 难度按对手档位 tier 给：${tiers}；没有对手的环境风险（攀爬、追车路况、恶劣天气）按同一张表选相当的档位。再选 edge：low 是这一档里偏容易的，high 是偏难的。难度值由代码查表，你不写数字。
- 加成 bonuses（本事、义体、物品、人物、准备，每项 +${MOD_STEP}）合计最多 +${BONUS_CAP}；减值 penalties（伤势、恶劣环境）合计最多 −${PENALTY_CAP}；基础值之上的难度修正 dvMods 合计最多 +${DV_MOD_CAP}。代码统一截断。聪明的计划、充分的准备、利用人物关系和环境，可以免检定、降低难度值或获得加成。
- 加成的来源必须在【当前状态】里找得到：没装的义体、没有的物品、不认识的人不算。
- 失败可能受伤时在 check 写 damage（graze 擦伤、heavy 重击、lethal 致命）；只有写了 lethal 才可能死，不写 damage 失败就不扣血。
- 断肢很少见：只在刀刃、霰弹枪、爆炸、重型机械这类真能打断手脚的场面，致命档失败可能失去手臂或腿时，在 check 写 limb: true 并在 failure 里写明。

【花钱】
- 玩家这一轮要掏钱买东西或买服务（买枪、包一辆车、请人办事、看伤）时在 buy 写买什么：物品写物品表的 id，服务写服务名，讲价写 discount。你不写价钱；一笔太大时代码会先请玩家确认。不花钱写 null。

【旧记忆】
- recall 只能从【可调的旧记忆】里原样抄标题，抄错的会被丢掉；没有列出、或这一轮用不上时写 []。`;

/** ① 判断的例子 */
export const JUDGE_EXAMPLE = `{"read": "你想不被发现地翻上棚顶，继续盯着那个中间人", "ooc": false, "check": {"intent": "不被发现地翻上棚顶", "attribute": "reflexes", "tier": "street", "edge": "low", "success": "看清他和谁接头", "failure": "铁皮响动惊动了他", "damage": "graze"}, "gate": null, "buy": null, "recall": []}`;

let output: string | undefined;

/** L3：严格 JSON；recall 原样抄标题 */
function judgeOutput(): string {
  output ??= `【输出格式】\n只输出一个 JSON 对象，不要解释，不要代码块。字段都要写，没有就写 null 或 []。\n${schemaDoc(JudgeDocSchema)}\n例：\n${JUDGE_EXAMPLE}`;
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
    recent: recent === "" ? undefined : `【最近几轮】\n${recent}`,
    scene: situation(world, view, plan, extras),
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
