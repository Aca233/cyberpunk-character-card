import { projectState } from "../../game";
import type { LogRecord } from "../../kernel/turnlog";
import type { WorldState } from "../../kernel/world";
import { registry } from "../../systems/registry";
import { ExtractDocSchema } from "../block";
import { commandDoc, schemaDoc } from "../doc";
import {
  CORE_COMMANDS,
  formatInput,
  type NarratorPlan,
  type NarratorPrompt,
  type PromptExtras,
  situation,
  tablesOf,
} from "./context";
import { BOOKKEEPING_BASE, systemMessage, userMessage } from "./layers";

/** ④ 抽取：辅助模型，低温，只输出 JSON */
export const EXTRACT_TEMPERATURE = 0.2;

/** L1 */
export const EXTRACT_STAGE = `【这一步：抽取】
读这一轮的玩家输入和定稿的正文，把已经发生的状态变化抽成提议，再给出建议选项和内心声音。正文已经定稿，你不改写，也不补剧情。

【只抽已经发生的事】
- 计划、打算、还没兑现的威胁不算；玩家角色的台词和决定只认玩家输入，正文里替玩家写的不算。
- 考虑过但没抽的写进 dropped，每条带原因（“只是打算，没发生”“玩家角色心里想的”）；dropped 必须写，没有就写 []。
- 照正文写实，不夸大：子弹擦过是 graze，不是 heavy；正文只花了钱没拿到东西，就不写 item gain。

【changes】
- 每轮都要有一条 world：activity 写这一轮主要做了什么；time 按正文交代的经过写这一轮结束时是几点（不能早于【当前状态】里的时间；正文没交代就按场面估，几句对话一两分钟；台词里约好的以后，例如“明天这个点来”，只是约定，时间并没有过去）；换了地点写 location。
- 正文写明玩家角色挨了打、受了伤，就写 damage，照实际挨的那一下定档；没有失败的检定也照写，合不合规由代码判，判不过时代码会把这一轮标出来，你不要替它省掉。有【检定结果】时档位不超过检定事先写的；大失败最多高一档，仍然只有事先写了 lethal 才可能致命。装着护甲义体时代码自动降一档，damage 照角色实际挨的那一下写。正文写明断了手脚、且事先说了致命档时才写 limb（left-arm、right-arm、left-leg、right-leg）。
- id 用小写英文和连字符；物品、义体、地点、人物用表里和【当前状态】里的 id。
- 场外提问的轮次不会交给你。

【建议选项】
- choices：玩家角色可能的下一步 0–3 个，最多 5 个，用玩家的口吻写行动，不替角色说台词；对话正进行时通常写 []。结果真不确定的可以预先带 check，属性达标就行的带 gate，一个选项只能带其中一种。
- 角色的出身、过往、义体或本事让某条路只有他走得通时，在选项里写 source 标出来源，例如“过往：荒坂前员工”“义体：螳螂刀”“出身：流浪者”；义体来源必须是【当前状态】里装着的；角色有主板时，出身、过往、本事来源写主板上的模块名。不用每轮都有。

【内心声音和标记】
- 关键时刻（艰难的决定、触动过往的东西、义体在逼你、人性在动摇）可以写 0–2 条 voices：一句脑子里冒出来的念头，不超过 30 字，不替角色做决定。past 是过往和出身的回响，chrome 是义体冷冰冰的建议（没装义体时不写），humanity 是残存的良心和情感，iconic 是武器栏里不朽武器的回响（照【当前状态】里写的口吻，武器栏里没有时不写）。人性越低，chrome 越多、越冷，humanity 越少。平常的轮次不写。
- 正文停在生死瞬间（子弹出膛、刀到眼前、车要撞上）时写 "clutch": true：下一轮玩家可以开斯安威斯坦。一场战斗最多一两次。
- 一场戏收尾、换地点或跳过一段时间时写 "sceneEnd": true；这一轮很重要、以后要记住时写 "pin": true。
- 收场（sceneEnd 为 true）时，这一场里和玩家角色有过实质来往的有卡人物，每人写一条 memory：一句话记这一场你们之间发生了什么（帮了谁、欠了什么、闹翻了没有），只写正文里写了的；已经记过的同一件事不重复写。`;

/** ④ 抽取的例子 */
export const EXTRACT_EXAMPLE = `{"changes": [{"type": "world", "activity": "observe", "time": "2077-01-01 22:14", "location": "kabuki-market"}], "choices": [{"text": "坐到他旁边，点一碗面"}, {"text": "装作路过，翻上棚顶继续盯着", "check": {"intent": "不被发现地翻上棚顶", "attribute": "reflexes", "tier": "street", "edge": "low", "success": "看清他和谁接头", "failure": "铁皮响动惊动了他", "damage": "graze"}}], "dropped": ["中间人说要“找人收拾你”：只是威胁，没发生"]}`;

let extractCore: string | undefined;

/** ④ 抽取不变的几层：L0 的两条、L1、L3（schema 生成的格式、常驻指令、例子）；第一次用时检查每种模型可用的指令都有说明 */
export function extractRules(): string {
  if (extractCore === undefined) {
    const documented = new Set<string>([
      ...CORE_COMMANDS,
      ...registry.rules.flatMap((m) => m.commands ?? []),
    ]);
    const missing = registry.commandTypes().filter((t) => !documented.has(t));
    if (missing.length > 0) throw new Error(`这些指令没有写进任何规则模块：${missing.join("、")}`);
    const commands = CORE_COMMANDS.map((type) => {
      const schema = registry.commandSchema(type);
      if (!schema) throw new Error(`常驻核心说明的 ${type} 不是模型可用的指令`);
      return commandDoc(type, schema);
    });
    extractCore = [
      BOOKKEEPING_BASE,
      EXTRACT_STAGE,
      `【输出格式】\n只输出一个 JSON 对象，不要解释，不要代码块。\n${schemaDoc(ExtractDocSchema)}\n- 字段后的问号表示可以不写，括号里是说明。`,
      `changes 可用的指令：\n${commands.join("\n")}`,
      `例：\n${EXTRACT_EXAMPLE}`,
    ].join("\n\n");
  }
  return extractCore;
}

/** ④ 抽取：辅助模型读局面、玩家输入和定稿的正文，只输出 JSON */
export function buildExtractPrompt(
  world: WorldState,
  records: readonly LogRecord[],
  plan: NarratorPlan,
  extras: PromptExtras,
  narrative: string,
): NarratorPrompt {
  const view = projectState(world, records, extras.data);
  const modules = registry.activeRules(world, plan.input);
  const content = userMessage({
    scene: situation(world, records, view, plan, extras),
    input: `【玩家输入】\n${formatInput(plan.input)}`,
    after: [`【本轮正文】\n${narrative}`],
    reminder: "（只输出抽取的 JSON 对象。）",
  });
  const rules = systemMessage("extract", [extractRules()], modules);
  return {
    rules: rules.length,
    messages: [
      { role: "system", content: [rules, ...tablesOf(view, extras)].join("\n\n") },
      { role: "user", content },
    ],
    modules: modules.map((m) => m.id),
  };
}
