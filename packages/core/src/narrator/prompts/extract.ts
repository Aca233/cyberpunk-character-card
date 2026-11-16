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
读这一轮的玩家输入和定稿的正文，把已经发生的状态变化抽成提议，再给出建议选项。正文已经定稿，你不改写，也不补剧情。

【只抽已经发生的事】
- 计划、打算、还没兑现的威胁不算；玩家角色的台词和决定只认玩家输入，正文里替玩家补写的不算。
- 考虑过但没抽的写进 dropped，每条带原因（“只是打算，没发生”“玩家角色心里想的”）；dropped 必须写，没有就写 []。
- 照正文写实，不夸大：子弹擦过或皮外磕碰是 graze，贯通中枪或重击是 heavy；正文只花了钱没拿到东西，就不写 item gain。
- 唯有 npc / npcUpdate 建卡或定型人物时例外：长相、此刻穿着与正文说过的话照正文写实，而说话方式与台词样本、具体诉求底线、暗中秘密，以及契合身份斤两的 body（表内武器衣物与义体 id）必须顺着他的身份、所属势力与现场表现一并配齐，不能因为正文没报出具体武器型号或秘密，就把新人物留成空壳「普通人」。

【changes】
- 每轮都要有一条 world：activity 写这一轮主要做了什么；time 按正文交代的经过写这一轮结束时是几点（不能早于【当前状态】里的时间；正文没交代就按场面估，几句对话一两分钟；台词里约好的以后，例如“明天这个点来”，只是约定，时间并没有过去）；换了地点写 location。
- 正文写明玩家角色非战斗情况下挨了打、受了伤，就写 damage，照实际挨的那一下定档（graze 擦伤、heavy 重击、lethal 致命），并用 part 标出受伤部位（head、face、chest、belly、left-arm、right-arm、left-leg、right-leg 之一），reason 写明具体致伤经过（如「踩空从铁棚摔下扭伤左踝」「电弧灼伤右手」）；护甲、掩体等保护已在前置裁决里计入，damage 只记最终实际创口，不能再额外降档。仅当正文写明当场断了手脚、且现场存在刀刃/霰弹/爆炸/重机械致命重创时，才写 limb（left-arm、right-arm、left-leg、right-leg）。
- id 用小写英文和连字符；已有物品、义体、地点、人物复用表里和【当前状态】里的 id；目录外新物件按 item 的 definition 和 origin 登记，之后保持同一身份。
- 场外提问的轮次不会交给你。

【建议选项】
- choices：玩家角色可能的下一步 0–3 个，最多 5 个，用玩家的口吻写行动，不替角色说台词，不带属性门槛或掷骰字眼；对话正进行时通常写 []。
- 角色的出身、过往、义体或特长让某条路只有他走得通时，在选项里写 source 标出来源，例如“过往：荒坂前员工”“义体：螳螂刀”“出身：流浪者”；义体来源必须是【当前状态】里装着的；角色有特质时，出身、过往、特长来源写角色卡上的词条名。不用每轮都有。

【标记】
- 正文停在生死瞬间（子弹出膛、刀到眼前、车要撞上）时写 "clutch": true：用来标记千钧一发的危机瞬间；只在实际发生时标记，不以场景配额制造或禁止危险。
- 一场戏收尾、换地点或跳过一段时间时写 "sceneEnd": true；这一轮很重要、以后要记住时写 "pin": true。
- 收场（sceneEnd 为 true）时，这一场里和玩家角色有过实质来往的有卡人物，每人写一条 memory：一句话记这一场你们之间发生了什么（帮了谁、欠了什么、闹翻了没有），只写正文里写了的；已经记过的同一件事不重复写。`;

/** ④ 抽取的例子 */
export const EXTRACT_EXAMPLE = `{"changes": [{"type": "world", "activity": "observe", "time": "2077-01-01 22:14", "location": "kabuki-market"}], "choices": [{"text": "坐到他旁边，点一碗合成拉面"}, {"text": "借着雨声退到二楼铁皮棚檐下继续盯着", "source": "过往：曾当过帮派哨兵"}], "dropped": ["中间人说要“找人收拾你”：只是威胁，没发生"]}`;

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
