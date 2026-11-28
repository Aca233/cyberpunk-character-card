import { projectState } from "../../game";
import type { LogRecord } from "../../kernel/turnlog";
import type { WorldState } from "../../kernel/world";
import { memoryRecords } from "../../systems/memory";
import { registry } from "../../systems/registry";
import { staticPlacesSection } from "../../systems/world";
import { ExtractDocSchema } from "../block";
import { COMMAND_DOC_LEGEND, commandDoc, schemaDoc } from "../doc";
import { extractCatalogData, extractCatalogDetails, worldObjectsIndexSection } from "./catalogs";
import {
  ALWAYS_ON_MODULE_IDS,
  activeOpening,
  CORE_COMMANDS,
  formatInput,
  jobTemplatesForExtract,
  type NarratorPlan,
  type NarratorPrompt,
  type PromptExtras,
  situation,
  stageModules,
  staticBaseData,
  tablesOf,
} from "./context";
import { BOOKKEEPING_BASE, modulesBlock, systemMessage, userMessage } from "./layers";
import { npcEquipmentReference } from "./npc-equipment";

/** ④ 抽取：辅助模型，零温客观记账，只输出 JSON */
export const EXTRACT_TEMPERATURE = 0;

/** L1 */
export const EXTRACT_STAGE = `【这一步：抽取】
读这一轮的玩家输入和定稿的正文，把已经发生的状态变化抽成提议，再给出建议选项。正文已经定稿，你不改写，也不补剧情。

【只抽已经发生的事】
- 计划、打算、还没兑现的威胁不算；玩家角色的台词和决定只认玩家输入，正文里替玩家补写的不算。（注：中间人或熟人向玩家提出的具体委托提议属于“对方已经开口派单”的既成事实，必须立刻发 jobOffer 入账为待接委托，不要因为玩家尚未答应就丢进 dropped；等玩家明确答应再补 jobAccept。）
- 【本轮已定的事】中的客观阻碍、伤害上限和出行条件仍然有效；正文若与它冲突，不把被阻断行动的成功或依赖其成功的收益记账，冲突及原因写进 dropped。同轮独立发生、符合条件的其他事实仍照常记录。
- 考虑过但没抽的写进 dropped，每条带原因（“只是打算，没发生”“玩家角色心里想的”）；dropped 必须写，没有就写 []。
- 若存在【上一轮之后已在界面完成并结算的操作】，这些事项已经落盘完毕，正文只是回述它们；严禁为其中任何一项重复发 trade/item/money/cyberware/gunsmith/jobAccept/vehicle/safehouse/heal/suppressant 等指令，可在 dropped 注明“已在界面结算”。
- 交易询价与成交分开：对方已认可的新价格保存 commerce.offer 并引用正文证据；只有玩家已接受且正文实际交付才发 trade/cyberware/gunsmith，沿用实际对方、报价和旧件条件（自由剧情服务 favor/info 若【本次交易报价】给出了自定义 amount，trade 一并带同值 amount）。多件逐件按先后记账，不能额外发 item gain 或 money 重复结算；到店购买先记实际到达，转交刚买的东西再记其转交。报价清单是可成交条件，不代表正文已经交付。
- 照正文写实，不夸大：子弹擦过或皮外磕碰是 graze，贯通中枪或重击是 heavy；正文只花了钱没拿到东西，就不写 item gain。
- 唯有 npc 建卡或用 npcUpdate 首次定型「还没定」旧识时，按身份、所属势力、财力和现场表现补齐真实 body：gear 包含实际穿着的衣物、随身武器与药剂/工具/日常物件（普通人也应有合身衣物与随身小物）。cyberware 按夜之城常态推演：大多数新人物（含普通市民、商贩、雇员、帮派成员与佣兵）通常常配 1–3 件贴合身份、生计与财力的基础或常见义体（如基础岐路司义眼、生物监测、合成肺叶、持握衬垫、通用义肢、防火/接地镀层，或与工作直接相关的接入仓、皮下护甲、神经/骨骼件），按人物特点错开部位、不千篇一律只填同一款义眼；只有正文明确无植入、信仰排斥义体或极端拮据者才留空。正文明确无植入、或给出扫描所得的完整植入清单时照事实保留；npcUpdate 不得覆盖已定型人物的 body，实际变化用 npcChrome / npcGear。不得因模型没写具体武器型号或秘密把新人物留成空壳。

【changes】
- 每轮都要有一条 world：activity 写这一轮主要做了什么；time 按正文交代的经过写这一轮结束时是几点（不能早于【当前状态】里的时间；正文没交代就按场面估，几句对话一两分钟；台词里约好的以后，例如“明天这个点来”，只是约定，时间并没有过去）；换了地点写 location。超梦 progress/scan/stop(finished) 和 commerce.service 已按实际进度结算分钟，同事件不能再用 phases 相对加时；若保留 world.time，它是活动全部完成后的绝对时刻，不是再加一次体验时长。先看片、暂停后聊天、再继续属于不同事实，应按真实先后拆成不同事件，分别记录各自的实际分钟；纯暂停/恢复与翻阅旧文字本身不算又看了一遍。
- 正文写明玩家角色非战斗情况下挨了打、受了伤，就写 damage，照实际挨的那一下定档（graze 擦伤、heavy 重击、lethal 致命），并用 part 标出受伤部位（head、face、chest、belly、left-arm、right-arm、left-leg、right-leg 之一），reason 写明具体致伤经过（如「踩空从铁棚摔下扭伤左踝」「电弧灼伤右手」）；护甲、掩体等保护已在前置裁决里计入，damage 只记最终实际创口，不能再额外降档。仅当正文写明当场断了手脚、且现场存在刀刃/霰弹/爆炸/重机械致命重创时，才写 limb（left-arm、right-arm、left-leg、right-leg）。
- id 用小写英文和连字符；已有物品、义体、地点、人物复用表里和【当前状态】里的 id；目录外新物件按 item 的 definition 和 origin 登记，之后保持同一身份。
- weaponHold 只记录正文已经确定发生的持用变化：拔出、换持、明确用某把武器攻击后建立首次持用，或收起、放下、失去握持。weapons 写本轮结束时仍实际持用的完整武器 id 列表（最多两件，双持同款且确有两把时可重复同一 id），明确收起全部写 []；信息未明、持用未变、只在询问/回忆/假设或尚未完成换枪时不发，不因每次开火重复记账。正文擅自替玩家换枪的不记。
- 新获得后立即拿在手里时，取得物品先于 weaponHold，并让持用依赖对应的取得事件；被阻断的取用不能记成持用成功。weaponHold 只记手中状态，不改变物品归属，实际存放、丢弃、交付仍写对应的物品指令。
- 跨地点行动里的 tension 必须写 location 指向事发地点；在原地破坏后逃走，不能把损坏记到目的地。未写地点时沿用本次行动起点。
- 场外提问的轮次不会交给你。

【events：按事件直接组织指令与因果】
- events 必填，按发生顺序列出，每组写 {"id":"本轮唯一小写英文数字连字符","requires":[],"changes":[...],"messages":[...]}（无来信时省略 messages；每组至少包含一条指令或来信，无任何事实条目时写 events: []，不把建议选项或整场摘要放进 events）。
- 同组条目全成或全撤，只把不能拆开的同一件事放在一起；独立事件拆成不同组。付款与交付属于同一组，trade 等已统一处理钱货的指令不要再拆出重复款项或物品；人物出场/定型（meet、npcUpdate、doing）与局势风声（threadTold）、传闻/记忆等独立观测事实不要硬绑在同一组，避免一条附带提示未生效连累人物出场回滚。
- requires 写成功前提，只能引用排在前面的事件 id 或保留值 "$action"；独立事件明确写 []。依赖失败，本事件也不发生。
- 本轮主行动成功才会发生的事必须 requires: ["$action"]；即使没有单列 hack、breach 等指令，成功拿到的钱、物品、权限或其他成果仍须声明这个前提。后续成果还依赖某事件时也列该事件 id。例如接入 access 依赖 "$action"，从该网络转款 proceeds 依赖 ["$action","access"]。
- 尝试失败仍实际发生的时间消耗、伤害、费用、报警或其他后果，不依赖行动成功；独立来款（如朋友偿还旧债）也不依赖 "$action"。依事实分组，不能为了保留成功收益把它伪装成独立事件，也不能把所有条目一律绑定主行动。
- 事后确认消息跟随它所确认的事件：直接写在同一组的 messages 里，或单列一组并 requires 对应事件，避免事情没办成却收到完成通知。无关消息单独分组（该组 changes 写 []）。
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
- choices：每轮（含对话进行中）都应给出 2–4 个不同方向的行动或回应建议，最多 5 个；仅在玩家已死亡或故事彻底结束时才写 []。用玩家的口吻写清下一步意图、表态、追问或动作（例如“答应接单，问清目标长相和地址”“嫌抽成太高，当场压价还价”“先不表态，旁敲侧击打听雇主来头”），不替角色写大段逐字台词，不带属性门槛或掷骰字眼。
- 角色的出身、过往、义体或特长让某条路只有他走得通时，在选项里写 source 标出来源，例如“过往：荒坂前员工”“义体：螳螂刀”“出身：流浪者”；义体来源必须是【当前状态】里装着的；角色有特质时，出身、过往、特长来源写角色卡上的词条名。不是专属路子时省略 source（不要写 null 或“无”），不用每轮都有。

【标记】
- 正文停在生死瞬间（子弹出膛、刀到眼前、车要撞上）时写 "clutch": true：用来标记千钧一发的危机瞬间；只在实际发生时标记，不以场景配额制造或禁止危险。
- 一场戏收尾、换地点或跳过一段时间时写 "sceneEnd": true；这一轮很重要、以后要记住时写 "pin": true。
- 收场（sceneEnd 为 true）时，这一场里和玩家角色有过实质来往的有卡人物，每人写一条 memory：id 必须填【人物】里该人物卡的 id（如 yoko-tsuru、ozob，切勿给记忆内容自造事件 slug），text 一句话记这一场你们之间发生了什么（帮了谁、欠了什么、闹翻了没有），只写正文里写了的；已经记过的同一件事不重复写；不同人物的 memory 拆成独立事件组，避免互相连累。`;

/** ④ 抽取的例子 */
export const EXTRACT_EXAMPLE = `{"events": [{"id": "observe-time", "requires": [], "changes": [{"type": "world", "activity": "observe", "time": "2077-04-12 21:14"}]}], "sceneMemory": {"text": "你在歌舞伎市场的拉面摊旁观察中间人。他说要找人收拾你，但没有动手，双方仍在对峙。", "anchors": [{"id": "fixer-threat-at-stall", "kind": "fact", "text": "中间人在拉面摊旁扬言找人收拾你；威胁尚未付诸行动。", "people": [], "keywords": ["中间人", "拉面摊", "威胁"], "evidence": {"source": "narrative", "quote": "找人收拾你"}}], "resolve": []}, "choices": [{"text": "坐到他旁边，点一碗合成拉面"}, {"text": "借着雨声退到二楼铁皮棚檐下继续盯着", "source": "过往：曾当过帮派哨兵"}], "dropped": ["中间人说要“找人收拾你”：只是威胁，没发生"]}`;

let extractCore: string | undefined;
let extractStaticModulesText: string | undefined;

function staticExtractModules(): string | undefined {
  if (extractStaticModulesText === undefined) {
    const fixed = registry.rules.filter((m) => ALWAYS_ON_MODULE_IDS.has(m.id));
    extractStaticModulesText = modulesBlock("extract", fixed) ?? "";
  }
  return extractStaticModulesText === "" ? undefined : extractStaticModulesText;
}

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
      `【输出格式】\n只输出一个 JSON 对象，不要解释，不要代码块。\n${schemaDoc(ExtractDocSchema)}\n${COMMAND_DOC_LEGEND}`,
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
  const details =
    extras.includeCatalogDetails === false
      ? undefined
      : extractCatalogDetails(
          world,
          view,
          data,
          [plan.input.text, narrative, tradePlans ?? ""].join("\n"),
          modules.some((m) => m.id === "hacking"),
        );
  // 常驻抽取模块放在可缓存 system 层；只有本轮按状态动态激活的模块才放进 user 层
  const dynamicModules = modules.filter((m) => !ALWAYS_ON_MODULE_IDS.has(m.id));
  const staticModulesText = staticExtractModules();
  const dynamicModulesText = modulesBlock("extract", dynamicModules);
  const worldObjectIndex = worldObjectsIndexSection(world);
  const npcEquipment =
    extras.includeNpcEquipment === false
      ? undefined
      : npcEquipmentReference(world, extras.data, true);
  const jobTemplates = jobTemplatesForExtract(data, `${plan.input.text}\n${narrative}`);
  const content = userMessage({
    modules: dynamicModulesText,
    scene: situation(
      world,
      records,
      view,
      plan,
      { ...extras, opening },
      "extract",
      `${plan.input.text}\n${narrative}`,
    ),
    input: `【玩家输入】\n${formatInput(plan.input)}`,
    after: [
      jobTemplates,
      npcEquipment,
      worldObjectIndex,
      details,
      extras.decided?.length ? `【本轮已定的事】\n${extras.decided.join("\n")}` : undefined,
      tradePlans ? `【本轮已核对的交易条件】\n${tradePlans}` : undefined,
      `【本轮正文】\n${narrative}`,
    ],
    reminder: "（只输出抽取的 JSON 对象。）",
  });
  // 系统层放纯静态抽取规则 + 纯静态常驻模块 + 纯静态基础目录表（物品/义体/固定地点），
  // 让抽取系统提示词跨回合稳定命中提示缓存，并把每轮未缓存的用户消息压到最小。
  const staticData = staticBaseData(extras.data);
  const staticPlaces = staticPlacesSection(staticData);
  const staticRules = systemMessage("extract", [
    extractRules(),
    ...(staticModulesText ? [staticModulesText] : []),
  ]);
  return {
    rules: staticRules.length + (dynamicModulesText?.length ?? 0),
    messages: [
      {
        role: "system",
        content: [
          staticRules,
          ...tablesOf(view, { ...extras, data: staticData }),
          ...(staticPlaces ? [staticPlaces] : []),
        ].join("\n\n"),
      },
      { role: "user", content },
    ],
    modules: modules.map((m) => m.id),
  };
}
