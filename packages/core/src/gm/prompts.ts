import { type PlayerView, projectState } from "../game";
import type { LlmMessage } from "../kernel/ports";
import type { RuleModule } from "../kernel/system";
import type { LogRecord } from "../kernel/turnlog";
import type { WorldState } from "../kernel/world";
import type { TurnInput } from "../schemas/turn";
import { cyberwareSection } from "../systems/cyberware/prompt";
import {
  ATTRIBUTE_LABELS,
  type Attribute,
  BONUS_CAP,
  DV_MOD_CAP,
  OPPONENT_TIERS,
  PENALTY_CAP,
} from "../systems/dice";
import { RARITY_LABELS } from "../systems/economy/schema";
import { consequenceSection, FalloutStateSchema, falloutSection } from "../systems/fallout";
import { DAMAGE_LABELS } from "../systems/health";
import { itemCatalog } from "../systems/inventory/apply";
import {
  ITEM_KIND_LABELS,
  MOD_SLOT_LABELS,
  WEAPON_CATEGORY_LABELS,
  WEAPON_TYPE_LABELS,
  weaponAttribute,
} from "../systems/inventory/schema";
import { jobsSection } from "../systems/jobs/prompt";
import { JobsStateSchema } from "../systems/jobs/schema";
import { castSection } from "../systems/npc/prompt";
import { NpcStateSchema } from "../systems/npc/schema";
import { registry } from "../systems/registry";
import { formatGameTime } from "../systems/world/apply";
import { locationCatalog, WorldClockStateSchema } from "../systems/world/schema";
import { BlockDocSchema, STATE_CLOSE, STATE_OPEN } from "./block";
import { commandDoc, schemaDoc } from "./doc";
import { examplesSection, twistSection } from "./examples";
import type { RolledCheck } from "./pending";

/**
 * 角色扮演提示词：常驻核心在前，按状态挑出的规则模块在后，两者都只随规则变化；
 * 每轮都变的状态、检定结果和玩家输入放在最后一条消息里，前缀能命中提示缓存
 */

/** 带最近这么多轮原文；更早的先丢，场景压缩在 M3 */
export const HISTORY_TURNS = 12;

/** 常驻核心负责说明的指令；其余指令由各系统的规则模块说明 */
export const CORE_COMMANDS = ["world", "humanity", "item", "damage", "heal", "deadline"] as const;

export type GmPlan =
  | { readonly kind: "action"; readonly input: TurnInput }
  /** 玩家确认了检定，骰子已经写进日志，这一轮写结果 */
  | { readonly kind: "resolve"; readonly input: TurnInput; readonly check: RolledCheck };

/** 旧存档的输入方式 */
const MODE_LABELS: Readonly<Record<NonNullable<TurnInput["mode"]>, string>> = {
  do: "做",
  say: "说",
  think: "想",
  ooc: "出戏",
};

/** 伤势标签给模型看的写法；没受伤不写 */
const WOUND_TEXT: Readonly<Record<string, string>> = {
  light: "轻伤",
  severe: "重伤",
  zero: "生命归零",
};

const OUTCOME_LABELS = {
  critical: "大成功",
  success: "成功",
  failure: "失败",
  fumble: "大失败",
} as const;

const tiers = Object.entries(OPPONENT_TIERS)
  .map(([id, t]) => `${id}（${t.label}）${t.dv[0]}–${t.dv[1]}`)
  .join("，");

const attributes = Object.entries(ATTRIBUTE_LABELS)
  .map(([id, label]) => `${id} ${label}`)
  .join("、");

const CORE = `你在《赛博朋克 2077》世界观下和玩家一起做角色扮演。玩家扮演自己建档的角色；你扮演除此之外的一切——每一个 NPC，以及夜之城本身。用简体中文写作，玩家角色用第二人称“你”。

【入戏】
- 你不是主持人，也不是讲解员。NPC 用自己的声音说话：口癖、街头黑话、情绪和立场都要鲜明。台词是正文的主体，环境和动作描写为对话服务，点到为止。
- 每个 NPC 有自己的目的、秘密、记性和底线。他们会主动开口、提要求、撒谎、讨价还价、翻脸或者帮忙，不只是等玩家提问再回答；好感高不等于言听计从。
- 世界自己在动：没人理会的威胁会逼近，欠下的人情会被追讨，街上的事会传开。
- 不跳出戏：正文里不问“你要怎么做？”，不列选项，不总结局势，不提检定、难度、属性和数值，不解释规则。需要玩家回应时，让 NPC 把话递过来，或者停在一个悬着的瞬间。

【不替玩家角色说话】
- 不替玩家角色说台词、决定感受或做决定；只写别人怎么回应，以及身体上不由自主的反应（手抖、心跳加快、伤口发疼）。
- 玩家写的台词照原话放进正文，不改写不润色；动作可以展开描写，但不加玩家没写的意图。

【玩家输入】
- 玩家只有一个输入框，一次可能同时写了动作、台词和念头，你自己分辨：引号里的、或明显是说出口的话是台词；括号里的、或“我心想”之类是只有角色自己知道的念头，NPC 听不到，不能被当成对话回应；其余按行动理解。拿不准是说出口还是心里想时，按没说出口处理，并在 read 里写明你的理解。
- 玩家跳出角色问你（问规则、问能不能这么做、问现在什么情况、问前情），而不是让角色行动，就是场外提问：跳出角色，用一两句话直接回答，不推进剧情；指令块写 "ooc": true，changes 写 []、check 写 null。问“能不能行”时只说大致可行性和有没有风险，不给难度值。场外提问和行动混在一起时，按行动处理。

【可信】
- 自由输入是一等公民。先理解玩家想达成什么，合理的办法直接让它发生，并写出代价：时间、人情、痕迹或热度至少付一项。
- 不可能的事让世界或 NPC 拒绝（门锁死了、对方冷笑着摇头），不用旁白宣布“做不到”，也不用骰子掩饰。
- 玩家声称拥有的能力、物品、义体、人脉，必须在角色资料或物品栏里找得到；找不到时可以让玩家试着“装作有”，但不能凭空生效。已确定的事实和死亡不能推翻。
- 公平但冷酷：不偏袒也不刁难，坏选择有坏结果，好办法有好结果。

【暗中判定】骰子和数值都在幕后，玩家只从故事里感受到结果。按固定顺序：
1. 对话、说服、谈判、调情、威胁：看有没有说中对方的诉求或触到底线，由 NPC 的性格决定怎么回应，不掷骰。
2. 门槛：属性达标直接成功，不掷骰。门槛前期 4–8，中期 9–14，后期 15–20；选项可以带 gate，代码判断达不达标。
3. 只有结果真不确定、失败有意义的后果、成败都能让故事继续时才掷骰：这一轮正文只写到行动将要发生的那一刻（一两句），在指令块给出 check，写清 success 和 failure，不写结果，停笔等玩家确认。代码掷骰后会再请你写结果。正文里不提检定。
- 属性：${attributes}。
- 难度值的基础值按对手档位给：${tiers}；没有对手的环境风险（攀爬、追车路况、恶劣天气）按同一张表选相当的档位。
- 加成 bonuses（本事、义体、物品、人物、准备，每项 +2）合计最多 +${BONUS_CAP}；减值 penalties（伤势、恶劣环境）合计最多 −${PENALTY_CAP}；基础值之上的难度修正 dvMods 合计最多 +${DV_MOD_CAP}。代码统一截断。聪明的计划、充分的准备、利用人物关系和环境，可以免检定、降低难度值或获得加成。
- 失败可能受伤时在 check 写 damage（graze 擦伤、heavy 重击、lethal 致命）；只有写了 lethal 才可能死，不写 damage 失败就不扣血。
- 大失败时 damage 指令最多比事先写的高一档（仍然只有事先写了 lethal 才可能死）；装着护甲义体时代码自动降一档，damage 照角色实际挨的那一下写，不要自己先降。
- 断肢很少见：只在刀刃、霰弹枪、爆炸、重型机械这类真能打断手脚的场面，致命档失败可能失去手臂或腿时，在 check 写 limb: true 并在 failure 里写明；真断了才在 damage 指令写 limb（left-arm、right-arm、left-leg、right-leg）。没事先写明、降档后不到致命或难度不允许时代码会拦下；原本是义肢的部位改记为义体损坏，修好前用不了。
- 检定结果出来后照事先说明的写：失败后果不比 failure 更重，剧情照样往前走。

【专属选项和内心声音】
- 角色的出身、过往、义体或本事让某条路只有他走得通时，在选项里写 source 标出来源，例如“过往：荒坂前员工”“义体：螳螂刀”“出身：流浪者”；义体来源必须是【当前状态】里装着的；角色有主板时，出身、过往、本事来源写主板上的模块名。不用每轮都有。
- 关键时刻（艰难的决定、触动过往的东西、义体在逼你、人性在动摇）可以写 0–2 条 voices：一句脑子里冒出来的念头，不超过 30 字，不替角色做决定。past 是过往和出身的回响，chrome 是义体冷冰冰的建议（没装义体时不写），humanity 是残存的良心和情感，iconic 是武器栏里不朽武器的回响（照【当前状态】里写的口吻，武器栏里没有时不写）。人性越低，chrome 越多、越冷，humanity 越少。平常的轮次不写。
- 生死瞬间（子弹出膛、刀到眼前、车要撞上）可以在指令块写 "clutch": true：下一轮玩家装着能用的加速义体时可以开斯安威斯坦，把几个动作塞进这一瞬间。一场战斗最多一两次，平常不写。

【写作】
- 每轮 100–350 字，等检定的那一轮更短；以对话为主，停在 NPC 说完话、或需要玩家接话的地方。
- 状态由代码记账，正文只写故事。暴力和成人题材按原作基调写，不刻意回避也不猎奇渲染。`;

function formatSection(): string {
  const commands = CORE_COMMANDS.map((type) => {
    const schema = registry.commandSchema(type);
    if (!schema) throw new Error(`常驻核心说明的 ${type} 不是模型可用的指令`);
    return commandDoc(type, schema);
  });
  return `【回复格式】
正文在前，末尾附一个指令块，块里是一个 JSON 对象，不要用代码块包起来：
${STATE_OPEN}
${schemaDoc(BlockDocSchema)}
${STATE_CLOSE}
- 字段后的问号表示可以不写，括号里是说明。
- changes 每轮都要有一条 world；没有别的变化就只写这一条。
- id 用小写英文和连字符，例如地点 kabuki-market。

changes 可用的指令：
${commands.join("\n")}

例：
你压低帽檐，跟着那个中间人拐进市场后巷。他在面摊前停下，头也不回：“跟了我三条街了，小鬼。有话坐下说，没话就滚。”
${STATE_OPEN}
{"read": "你想跟踪中间人，看他去见谁", "choices": [{"text": "坐到他旁边，点一碗面"}, {"text": "装作路过，翻上棚顶继续盯着", "check": {"intent": "不被发现地翻上棚顶", "attribute": "reflexes", "tier": "street", "dv": 11, "success": "看清他和谁接头", "failure": "铁皮响动惊动了他", "damage": "graze"}}], "check": null, "changes": [{"type": "world", "activity": "observe", "location": "kabuki-market"}]}
${STATE_CLOSE}`;
}

function moduleSection(module: RuleModule): string {
  const commands = (module.commands ?? []).map((type) =>
    commandDoc(
      type,
      registry.commandSchema(type) as NonNullable<ReturnType<typeof registry.commandSchema>>,
    ),
  );
  return [
    `【规则：${module.title}】`,
    module.text,
    ...(commands.length > 0 ? ["相关指令：", ...commands] : []),
  ].join("\n");
}

let core: string | undefined;

/** 常驻核心；第一次用时检查每种模型可用的指令都有说明 */
export function coreRules(): string {
  if (core === undefined) {
    const documented = new Set<string>([
      ...CORE_COMMANDS,
      ...registry.rules.flatMap((m) => m.commands ?? []),
    ]);
    const missing = registry.commandTypes().filter((t) => !documented.has(t));
    if (missing.length > 0) throw new Error(`这些指令没有写进任何规则模块：${missing.join("、")}`);
    core = `${CORE}\n\n${formatSection()}\n\n${examplesSection()}`;
  }
  return core;
}

export function systemPrompt(
  modules: readonly RuleModule[],
  extra: readonly string[] = [],
): string {
  return [coreRules(), ...modules.map(moduleSection), ...extra].join("\n\n");
}

const KIND_LABELS = ITEM_KIND_LABELS;

/** 物品表：内容不随状态变，放在系统提示词末尾；模型给、拿、用物品时只能用这些 id。
 * 按类别分组，组名写一次检定属性，每行只写这件东西自己的部分，几十件也不太占篇幅 */
export function catalogSection(data: Readonly<Record<string, unknown>>): string | undefined {
  if (data.items === undefined) return undefined;
  const groups = new Map<string, string[]>();
  for (const item of itemCatalog(data).values()) {
    const group =
      item.category === undefined
        ? KIND_LABELS[item.kind]
        : `${WEAPON_CATEGORY_LABELS[item.category]}（${ATTRIBUTE_LABELS[weaponAttribute(item.category)]}检定）`;
    const notes = [
      ...(item.weaponType ? [WEAPON_TYPE_LABELS[item.weaponType]] : []),
      ...(item.category === undefined && item.attribute
        ? [`${ATTRIBUTE_LABELS[item.attribute]}检定`]
        : []),
      ...(item.modSlot && item.modFits
        ? [
            `${MOD_SLOT_LABELS[item.modSlot]}，配${item.modFits.map((c) => WEAPON_CATEGORY_LABELS[c]).join("、")}`,
          ]
        : []),
      ...(item.rarity ? [RARITY_LABELS[item.rarity]] : []),
      ...(item.iconic ? ["不朽"] : item.price === undefined ? [] : [String(item.price)]),
    ];
    const line = `- ${item.id} ${item.name}${notes.length > 0 ? `｜${notes.join("｜")}` : ""}${item.ability ? `：${item.ability}` : ""}`;
    groups.set(group, [...(groups.get(group) ?? []), line]);
  }
  const body = [...groups].map(([group, lines]) => `${group}\n${lines.join("\n")}`).join("\n");
  return `【物品表】
item 指令的 id 只能用下面这些；【当前状态】里的武器栏、治疗品和背包写的也是这些 id，正文里用名称。表里没有的东西只在正文里写，不发 item 指令。
每行是：id 名称｜武器类型｜稀有度｜参考价（欧元）：能力。技术武器一律用技术检定、智能武器一律用智能检定，不看组名；不朽的东西只从剧情获得，没人卖。
改装件只在装到武器上时才算数（【当前状态】武器栏括号里写着的），例如装了消音器才能安静开枪；装卸在界面上做，你不发指令。
${body}`;
}

/** 地点表：和物品表一样放在系统提示词末尾 */
export function locationSection(data: Readonly<Record<string, unknown>>): string | undefined {
  const places = [...locationCatalog(data).values()];
  if (places.length === 0) return undefined;
  const lines = places.map(
    (p) => `- ${p.id}：${p.name}（${p.district}${p.note ? `，${p.note}` : ""}）`,
  );
  return `【常用地点】
world 指令换地点时，去下面这些地方就用这些 id；表里没有的地方，location 直接写中文地名，例如「沃森 · 无名小巷」。
${lines.join("\n")}`;
}

/** 提示词里随存档而定、但不在世界状态里的东西 */
export interface PromptExtras {
  /** 静态数据表；带物品表时写进系统提示词 */
  readonly data?: Readonly<Record<string, unknown>> | undefined;
  /** 这个存档的开场设定；故事还没开始时放进最后一条消息 */
  readonly opening?: string | undefined;
}

function attributeLine(values: Readonly<Record<Attribute, number>>): string {
  return (Object.keys(ATTRIBUTE_LABELS) as Attribute[])
    .map((a) => `${ATTRIBUTE_LABELS[a]} ${values[a]}`)
    .join("，");
}

export function stateSummary(view: PlayerView): string {
  const c = view.character;
  const lines = [
    `角色：${c.name ?? "（还没建档）"}${c.brief ? `。${c.brief}` : ""}`,
    `属性：${attributeLine(c.attributes)}；街头声望 ${c.streetCred} 级${c.credHalf ? "（再得半级就升级）" : ""}，${c.credTier}：${c.credWorld}`,
    `时间：${view.time.text}（${view.time.periodLabel}）`,
    `地点：${view.location ?? "尚未确定，由你在开场时安排"}${view.names.location && view.names.location !== view.location ? `（${view.names.location}）` : ""}`,
    `生命：${view.health.hp}/${view.health.max}，${view.health.conditionLabel}${WOUND_TEXT[view.health.wound] ? `，${WOUND_TEXT[view.health.wound]}` : ""}`,
    `人性：${view.humanity.current}/${view.humanity.cap}，${view.humanity.stageLabel}`,
    `欧元：${view.money.eddies}`,
  ];
  if (view.heat.stars > 0 || view.heat.half)
    lines.push(
      `警方热度：${view.heat.stars} 星${view.heat.half ? "多" : ""}${view.heat.lastSeen ? `，最后一次被看见是 ${view.heat.lastSeen}` : ""}${view.heat.decayIn !== null ? `，再过 ${Math.ceil(view.heat.decayIn / 60)} 小时不犯事就降一星` : ""}`,
    );
  if (view.cyberware.length > 0)
    lines.push(
      `义体：${view.cyberware.map((c) => `${c.name}（${c.id}，${c.slotLabel}${c.broken ? "，打坏了，修好前用不了" : c.bonusText ? `，${c.bonusText}` : ""}）`).join("、")}`,
    );
  if (view.sandevistan) {
    lines.push(
      `加速义体：${view.sandevistan.name}，斯安威斯坦时刻最多 ${view.sandevistan.slots} 个动作，再开一次人性 −${view.sandevistan.cost}`,
    );
  }
  if (view.health.lostLimbs.length > 0) {
    const ids = view.health.lostLimbs.map((l) => l.id);
    lines.push(
      `断肢：${view.health.lostLimbs.map((l) => l.label).join("、")}；${ids.some((l) => l.endsWith("arm")) ? "断臂不能用双手武器，" : ""}${ids.some((l) => l.endsWith("leg")) ? "断腿不能追车或步行逃跑，" : ""}相关检定在 penalties 写 −2（计入 −4 上限）；找义体医生装手臂或腿部义体就补上了`,
    );
  }
  if (view.ripperdoc)
    lines.push(
      `义体医生：${view.ripperdoc.name}在这里（${view.ripperdoc.note}）；玩家可以在界面上直接买、卸义体，代码按货架价结算，你只写场面${view.ripperdoc.blackMarket ? "。这是黑市货，装上的东西可能有故障或追踪器，可以在剧情里兑现" : ""}`,
    );
  for (const shop of view.shops)
    lines.push(
      `商店：${shop.name}在这里（店主${shop.keeper}，${shop.note}）；玩家可以在界面上直接买卖，代码按货架价结算，你只写场面${shop.blackMarket ? "。这是黑市货，买到的东西可能来路不明，可以在剧情里兑现" : ""}`,
    );
  if (view.ripperdocDebts.length > 0)
    lines.push(
      `欠义体医生的钱：${view.ripperdocDebts.map((d) => `${d.docName} ${d.amount} 欧元，${d.due} 前还`).join("、")}；还钱在界面上做，你不写 money。到期没还，医生会派人来催或上门`,
    );
  const weapons = view.inventory.weapons.filter((w): w is string => w !== null);
  const withMods = (w: string) => {
    const fitted = view.inventory.mods[w] ?? [];
    return fitted.length > 0 ? `${w}（装着 ${fitted.map((m) => m.id).join("、")}）` : w;
  };
  lines.push(`武器栏：${weapons.length > 0 ? weapons.map(withMods).join("、") : "空手"}`);
  if (view.inventory.iconicVoices.length > 0)
    lines.push(
      `不朽武器的声音（voices 可以写 from "iconic"）：${view.inventory.iconicVoices.map((v) => `${v.name}——${v.voice}`).join("；")}`,
    );
  if (view.inventory.clothing.length > 0)
    lines.push(
      `穿着（只影响身份和伪装，没有护甲）：${view.inventory.clothing.map((c) => `${c.id}（${c.label}）`).join("、")}`,
    );
  if (view.inventory.healing)
    lines.push(`治疗品：${view.inventory.healing.id}，剩 ${view.inventory.healing.charges} 次`);
  const backpack = Object.entries(view.inventory.backpack);
  if (backpack.length > 0)
    lines.push(`背包：${backpack.map(([id, n]) => `${id}×${n}`).join("、")}`);
  if (view.combat.active) {
    const a = view.combat.active;
    const enemies = [
      ...a.enemies.map((e) => `${e.group}（${e.tier}，${e.count} 人）`),
      ...a.foes.map(
        (f) =>
          `${f.name}（有卡敌人 ${f.npc}，${f.tier}，${f.down ? "已打到濒死，等玩家决定杀、放还是抓" : `已中 ${f.hits}/${f.need} 次`}${f.scanned ? "" : "，玩家还没扫描"}）`,
      ),
    ].join("、");
    lines.push(
      `战斗中：第 ${a.moment}/${a.moments} 次交锋，敌人 ${enemies}，败局是「${a.defeat}」；这次交锋快捷动作已用 ${a.quick}/${a.quickMax}`,
    );
    if (a.dyingMomentsLeft !== null)
      lines.push(`濒死：还剩 ${a.dyingMomentsLeft} 次交锋内要被救回`);
    if (a.edgeLabel) lines.push(`第一次交锋：${a.edgeLabel}`);
  }
  if (view.combat.standoff) {
    const s = view.combat.standoff;
    lines.push(
      s.left > 0
        ? `对峙中：和${s.opponent}，还剩 ${s.left}/${s.rounds} 轮`
        : `对峙到时间了：和${s.opponent}，这一轮对方先动手，发 combat start`,
    );
  }
  if (view.stealth.level > 0) {
    lines.push(
      `潜入警戒：${view.stealth.level}/3 ${view.stealth.label}${view.stealth.lowered ? "，这个场景已经降过一档" : ""}`,
    );
  }
  for (const d of view.deadlines) {
    lines.push(
      `期限 ${d.id}：${d.label}，${d.due}${d.overdue ? "（已到期，见【到期事件】）" : ""}`,
    );
  }
  return lines.join("\n");
}

export interface DueEvent {
  readonly kind: "deadline" | "job";
  readonly id: string;
  readonly label: string;
  readonly due: number;
}

/** 已经到期、主持人还没回应的事：期限和超期的委托；一次跳过好几天时期间到期的一起列出 */
export function dueEvents(world: WorldState): DueEvent[] {
  const clock = WorldClockStateSchema.parse(world.slices.world);
  const jobs = JobsStateSchema.parse(world.slices.jobs);
  const events: DueEvent[] = [
    ...clock.deadlines
      .filter((d) => d.handledAt === null && d.due <= world.time)
      .map((d) => ({ kind: "deadline" as const, id: d.id, label: d.label, due: d.due })),
    ...jobs.jobs.flatMap((j) =>
      j.status === "active" && j.overdue && !j.dueHandled && j.due !== null
        ? [{ kind: "job" as const, id: j.id, label: j.title, due: j.due }]
        : [],
    ),
  ];
  return events.sort((a, b) => a.due - b.due);
}

function elapsed(minutes: number): string {
  if (minutes < 60) return `${minutes} 分钟`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} 小时`;
  return `${Math.floor(minutes / 1440)} 天`;
}

/** 给模型看的【到期事件】：这一轮必须回应 */
export function dueSection(world: WorldState): string | undefined {
  const due = dueEvents(world);
  if (due.length === 0) return undefined;
  return [
    "这些事已经到期，这一轮必须在戏里回应：人物打来电话、找上门，或者事情就这么黄了，怎么写由你决定。回应后期限写 deadline handle；委托还要接着办就写 jobNote，黄了就写 jobEnd。",
    ...due.map(
      (e) =>
        `- ${e.kind === "job" ? "委托" : "期限"} ${e.label}［${e.id}］：${formatGameTime(e.due)} 到期，已经过了 ${elapsed(world.time - e.due)}`,
    ),
  ].join("\n");
}

export function formatInput(input: TurnInput): string {
  const boost = input.sandevistan ? "【开斯安威斯坦】" : "";
  return input.mode
    ? `【${MODE_LABELS[input.mode]}】${boost}${input.text}`
    : `【玩家】${boost}${input.text}`;
}

export function checkResultText(rolled: RolledCheck): string {
  const { prepared, result, offer } = rolled;
  const spec = offer.spec;
  const faces =
    result.faces.length > 1
      ? `${result.faces[0]}（再掷 ${result.faces[1]}）`
      : `${result.faces[0]}`;
  const lines = [
    `【检定结果】${ATTRIBUTE_LABELS[spec.attribute]}检定，难度值 ${prepared.dv}：掷出 ${faces}，加检定值 ${prepared.modifier}，合计 ${result.total} → ${OUTCOME_LABELS[result.outcome]}`,
    `事先说明——成功：${spec.success}；失败：${spec.failure}${spec.damage ? `；失败最多${DAMAGE_LABELS[spec.damage]}` : "；失败不扣血"}`,
    "按这个结果写这一轮的正文，正文里不提骰子和数值。同一个行动不要再给 check；失败时后果不比事先说明的更重。",
  ];
  return lines.join("\n");
}

export interface GmPrompt {
  readonly messages: readonly LlmMessage[];
  /** 本轮带上的规则模块 id，记进回合日志，上下文查看器用 */
  readonly modules: readonly string[];
}

export function buildGmPrompt(
  world: WorldState,
  records: readonly LogRecord[],
  plan: GmPlan,
  extras: PromptExtras = {},
): GmPrompt {
  const view = projectState(world, records, extras.data);
  const modules = registry.activeRules(world, plan.input);
  const tables = extras.data
    ? [
        catalogSection(extras.data),
        cyberwareSection(extras.data),
        locationSection(extras.data),
        twistSection(extras.data),
        consequenceSection(extras.data, view.difficulty),
      ].filter((s): s is string => s !== undefined)
    : [];
  const messages: LlmMessage[] = [{ role: "system", content: systemPrompt(modules, tables) }];
  for (const turn of view.turns.slice(-HISTORY_TURNS)) {
    messages.push({ role: "user", content: formatInput(turn.input) });
    messages.push({ role: "assistant", content: turn.text });
  }
  const clock = WorldClockStateSchema.parse(world.slices.world);
  const cast = castSection(NpcStateSchema.parse(world.slices.npc), {
    location: clock.location,
    sceneStartedAt: clock.sceneStartedAt,
  });
  const parts = [`【当前状态】\n${stateSummary(view)}`, `【人物】\n${cast}`];
  const jobs = jobsSection(JobsStateSchema.parse(world.slices.jobs), view.character.streetCred);
  if (jobs) parts.push(`【委托】\n${jobs}`);
  const recent = falloutSection(FalloutStateSchema.parse(world.slices.fallout ?? {}));
  if (recent) parts.push(`【近期后果】\n${recent}`);
  const due = dueSection(world);
  if (due) parts.push(`【到期事件】\n${due}`);
  if (extras.opening && view.totalTurns === 0) parts.push(`【开场】\n${extras.opening}`);
  if (plan.kind === "resolve") parts.push(checkResultText(plan.check));
  parts.push(formatInput(plan.input));
  if (plan.kind === "action" && plan.input.sandevistan === true && view.sandevistan) {
    const { name, slots } = view.sandevistan;
    parts.push(
      `【斯安威斯坦时刻】\n玩家开了${name}：这一瞬间最多做 ${slots} 个动作（快速破解、换武器、扔手雷各占一格），超出的按顺序不执行，正文里写明哪几件没来得及。把这些动作写成一段连贯的慢动作；所有真正不确定的部分合并成一次 check（占这次交锋唯一的掷骰），事先写明失败时哪几个动作会落空。人性已经由代码扣过，不另写 humanity。`,
    );
  }
  parts.push(`（先写正文，最后附 ${STATE_OPEN} 指令块。）`);
  messages.push({ role: "user", content: parts.join("\n\n") });
  return { messages, modules: modules.map((m) => m.id) };
}
