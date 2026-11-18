import { projectState } from "../../game";
import type { LogRecord } from "../../kernel/turnlog";
import type { WorldState } from "../../kernel/world";
import { memoryRecords } from "../../systems/memory";
import { registry } from "../../systems/registry";
import { ExtractDocSchema } from "../block";
import { commandDoc, schemaDoc } from "../doc";
import { extractCatalogData, extractCatalogDetails } from "./catalogs";
import {
  activeOpening,
  CORE_COMMANDS,
  formatInput,
  type NarratorPlan,
  type NarratorPrompt,
  type PromptExtras,
  situation,
  stageModules,
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
- 【本轮已定的事】中的客观阻碍、伤害上限和出行条件仍然有效；正文若与它冲突，不把被阻断行动的成功或依赖其成功的收益记账，冲突及原因写进 dropped。同轮独立发生、符合条件的其他事实仍照常记录。
- 考虑过但没抽的写进 dropped，每条带原因（“只是打算，没发生”“玩家角色心里想的”）；dropped 必须写，没有就写 []。
- 交易询价与成交分开：对方已认可的新价格保存 commerce.offer 并引用正文证据；只有玩家已接受且正文实际交付才发 trade/cyberware，沿用实际对方、报价和旧件条件。多件逐件按先后记账，不能额外发 item gain 或 money 重复结算；到店购买先记实际到达，转交刚买的东西再记其转交。报价清单是可成交条件，不代表正文已经交付。
- 照正文写实，不夸大：子弹擦过或皮外磕碰是 graze，贯通中枪或重击是 heavy；正文只花了钱没拿到东西，就不写 item gain。
- 唯有 npc / npcUpdate 建卡或定型人物时例外：长相、此刻穿着与正文说过的话照正文写实，而说话方式与台词样本、具体诉求底线、暗中秘密，以及契合身份斤两的 body（表内武器衣物与义体 id）必须顺着他的身份、所属势力与现场表现一并配齐，不能因为正文没报出具体武器型号或秘密，就把新人物留成空壳「普通人」。

【changes】
- 每轮都要有一条 world：activity 写这一轮主要做了什么；time 按正文交代的经过写这一轮结束时是几点（不能早于【当前状态】里的时间；正文没交代就按场面估，几句对话一两分钟；台词里约好的以后，例如“明天这个点来”，只是约定，时间并没有过去）；换了地点写 location。
- 正文写明玩家角色非战斗情况下挨了打、受了伤，就写 damage，照实际挨的那一下定档（graze 擦伤、heavy 重击、lethal 致命），并用 part 标出受伤部位（head、face、chest、belly、left-arm、right-arm、left-leg、right-leg 之一），reason 写明具体致伤经过（如「踩空从铁棚摔下扭伤左踝」「电弧灼伤右手」）；护甲、掩体等保护已在前置裁决里计入，damage 只记最终实际创口，不能再额外降档。仅当正文写明当场断了手脚、且现场存在刀刃/霰弹/爆炸/重机械致命重创时，才写 limb（left-arm、right-arm、left-leg、right-leg）。
- id 用小写英文和连字符；已有物品、义体、地点、人物复用表里和【当前状态】里的 id；目录外新物件按 item 的 definition 和 origin 登记，之后保持同一身份。
- 跨地点行动里的 tension 必须写 location 指向事发地点；在原地破坏后逃走，不能把损坏记到目的地。未写地点时沿用本次行动起点。
- 场外提问的轮次不会交给你。

【events：事实归属与因果】
- events 必填，每组写 {"id":"本轮唯一小写英文数字连字符","requires":[],"entries":["changes[0]"]}。changes 和 messages 的每一条必须恰好归属一组；没有事实条目才写 events: []，不把建议选项或整场摘要放进 entries。
- 同组条目全成或全撤，只把不能拆开的同一件事放在一起；独立事件分组。付款与交付属于同一组，trade 等已统一处理钱货的指令不要再拆出重复款项或物品。
- requires 写成功前提，只能引用前面已经列出的事件 id 或保留值 "$action"；独立事件明确写 []。依赖失败，本事件也不发生。事件和组内 entries 按事实原先顺序列出，changes 的索引与 messages 的索引各自从 0 递增，不能交错分组后重排发生顺序。
- 本轮主行动成功才会发生的事必须 requires: ["$action"]；即使没有单列 hack、breach 等指令，成功拿到的钱、物品、权限或其他成果仍须声明这个前提。后续成果还依赖某事件时也列该事件 id。例如接入 access 依赖 "$action"，从该网络转款 proceeds 依赖 ["$action","access"]。
- 尝试失败仍实际发生的时间消耗、伤害、费用、报警或其他后果，不依赖行动成功；独立来款（如朋友偿还旧债）也不依赖 "$action"。依事实分组，不能为了保留成功收益把它伪装成独立事件，也不能把所有条目一律绑定主行动。
- 事后确认消息跟随它所确认的事件：放在同组或另组并 requires 对应事件，避免事情没办成却收到完成通知。无关消息单独分组。
- world 的纯时间推进可以独立成组；location 代表实际抵达，必须放在抵达事件中，或依赖已成功的抵达事件。若抵达取决于本轮主行动成功，还须声明 "$action"；不能把换地点混在独立计时组里绕过失败的出行。

【场景记忆】
- 每轮给 sceneMemory：text 是这一场至今的简短提要（最多 600 字），在【场景记忆与未完事项】基础上加入本轮确认事实，保留早期承诺、线索和关系变化；普通气氛不必反复记录。这里不代替 changes 的实际记账。
- anchors 只增记本轮以后还重要的事实、承诺、计划或问题；引用本轮 input 或 narrative 的原文片段作 evidence.quote，source 标明出处。玩家行动和承诺只能据玩家输入，正文替玩家补写的不算。
- 承诺写 promise（尚未兑现），打算写 plan（尚未实行），疑问写 question（尚未回答）。fact 必须有本轮正文中实际结果的证据，不能只凭玩家输入判定已经发生；玩家自述、人物转述、传闻和未核实说法用 report，text 标明谁说了什么，不把说法当客观事实。稳定 id 用小写英文和连字符；已有锚点不重建、不改写。
- fact 或兑现结果涉及玩家物品获得/失去、支付/收款时，写 settlement：[{"type":"item","id":"物品id","delta":1}] 或 [{"type":"money","delta":-100}]，两者同时发生就同时列。delta 是本轮对应物品总数量或欧元的净变化，必须与 changes 的实际结算相符；换装不算获得，承诺付款不算已支付。普通观察、对话事实无需 settlement。
- 记忆正文中的“明天”“今晚”等相对日期按本轮游戏时间写成具体日期；原文 evidence.quote 保持原样。日后读旧锚点时以登记时间为参照，不把约定日期跟着当前时间顺延。
- resolve 只在本轮确实兑现、取消或回答后引用旧 id，并给原文证据及具体结果；fulfilled 必须引用正文的实际结果，不能只引用“我要交给你”这种输入意图。没提到的旧锚点由代码原样保留。没新增或没解决时相应数组写 []。
- sceneEnd 为 true 时，同时给 summary：结合本场提要、重要锚点和本轮正文，用 100–200 字概括这一场。计划和承诺仍标清尚未兑现，不把场外信息写成玩家已知；不要为了收尾强行解决问题。

【建议选项】
- choices：玩家角色可能的下一步 0–3 个，最多 5 个，用玩家的口吻写行动，不替角色说台词，不带属性门槛或掷骰字眼；对话正进行时通常写 []。
- 角色的出身、过往、义体或特长让某条路只有他走得通时，在选项里写 source 标出来源，例如“过往：荒坂前员工”“义体：螳螂刀”“出身：流浪者”；义体来源必须是【当前状态】里装着的；角色有特质时，出身、过往、特长来源写角色卡上的词条名。不用每轮都有。

【标记】
- 正文停在生死瞬间（子弹出膛、刀到眼前、车要撞上）时写 "clutch": true：用来标记千钧一发的危机瞬间；只在实际发生时标记，不以场景配额制造或禁止危险。
- 一场戏收尾、换地点或跳过一段时间时写 "sceneEnd": true；这一轮很重要、以后要记住时写 "pin": true。
- 收场（sceneEnd 为 true）时，这一场里和玩家角色有过实质来往的有卡人物，每人写一条 memory：一句话记这一场你们之间发生了什么（帮了谁、欠了什么、闹翻了没有），只写正文里写了的；已经记过的同一件事不重复写。`;

/** ④ 抽取的例子 */
export const EXTRACT_EXAMPLE = `{"changes": [{"type": "world", "activity": "observe", "time": "2077-01-01 22:14"}], "events": [{"id":"observe-time","requires":[],"entries":["changes[0]"]}], "sceneMemory": {"text": "你在歌舞伎市场的拉面摊旁观察中间人。他说要找人收拾你，但没有动手，双方仍在对峙。", "anchors": [{"id": "fixer-threat-at-stall", "kind": "fact", "text": "中间人在拉面摊旁扬言找人收拾你；威胁尚未付诸行动。", "people": [], "keywords": ["中间人", "拉面摊", "威胁"], "evidence": {"source": "narrative", "quote": "找人收拾你"}}], "resolve": []}, "choices": [{"text": "坐到他旁边，点一碗合成拉面"}, {"text": "借着雨声退到二楼铁皮棚檐下继续盯着", "source": "过往：曾当过帮派哨兵"}], "dropped": ["中间人说要“找人收拾你”：只是威胁，没发生"]}`;

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
  tradePlans?: string,
): NarratorPrompt {
  const opening = activeOpening(records, extras.opening);
  records = memoryRecords(world, records);
  const view = projectState(world, records, extras.data);
  const data = extractCatalogData(world, extras.data ?? {});
  const modules = stageModules(world, plan.input, extras, narrative);
  const details = extractCatalogDetails(
    world,
    view,
    data,
    `${plan.input.text}\n${narrative}`,
    modules.some((m) => m.id === "hacking"),
  );
  const content = userMessage({
    scene: situation(world, records, view, plan, { ...extras, opening }),
    input: `【玩家输入】\n${formatInput(plan.input)}`,
    after: [
      details,
      extras.decided?.length ? `【本轮已定的事】\n${extras.decided.join("\n")}` : undefined,
      tradePlans ? `【本轮已核对的交易条件】\n${tradePlans}` : undefined,
      `【本轮正文】\n${narrative}`,
    ],
    reminder: "（只输出抽取的 JSON 对象。）",
  });
  const rules = systemMessage("extract", [extractRules()], modules);
  return {
    rules: rules.length,
    messages: [
      { role: "system", content: [rules, ...tablesOf(view, { ...extras, data })].join("\n\n") },
      { role: "user", content },
    ],
    modules: modules.map((m) => m.id),
  };
}
