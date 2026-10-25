import type { PlayerView } from "../../game";
import type { LlmMessage } from "../../kernel/ports";
import type { WorldState } from "../../kernel/world";
import type { TurnInput } from "../../schemas/turn";
import { CityStateSchema, citySection } from "../../systems/city";
import { cyberwareSection } from "../../systems/cyberware/prompt";
import { ATTRIBUTE_LABELS, type Attribute, MOD_STEP, PENALTY_CAP } from "../../systems/dice";
import { RARITY_LABELS } from "../../systems/economy/schema";
import { consequenceSection, FalloutStateSchema, falloutSection } from "../../systems/fallout";
import { DAMAGE_LABELS } from "../../systems/health";
import { itemCatalog } from "../../systems/inventory/apply";
import {
  ITEM_KIND_LABELS,
  MOD_SLOT_LABELS,
  WEAPON_CATEGORY_LABELS,
  WEAPON_TYPE_LABELS,
  weaponAttribute,
} from "../../systems/inventory/schema";
import { jobsSection, jobTemplateSection } from "../../systems/jobs/prompt";
import { JobsStateSchema } from "../../systems/jobs/schema";
import { castSection } from "../../systems/npc/prompt";
import { NpcStateSchema } from "../../systems/npc/schema";
import { formatGameTime } from "../../systems/world/apply";
import { locationCatalog, WorldClockStateSchema } from "../../systems/world/schema";
import { canonSection } from "../canon";
import { twistSection } from "../examples";
import type { RolledCheck } from "../pending";
import type { Memory } from "../stages";

/**
 * 各步共用的材料：当前状态、人物、委托、到期事件、物品和地点表、玩家输入的写法。
 * 这些填进 L2 任务模板的槽位；模板和各层的拼法在 layers.ts
 */

/** 带最近这么多轮原文；更早的先丢，场景压缩在 M3 */
export const HISTORY_TURNS = 12;

/** 常驻核心负责说明的指令；其余指令由各系统的规则模块说明 */
export const CORE_COMMANDS = ["world", "humanity", "item", "damage", "heal", "deadline"] as const;

export type NarratorPlan =
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
/** 状态里列最近几条消息 */
const PROMPT_MESSAGES = 5;

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
  /** 写正文之前代码已经定下的事：场外提问、先给检定、门槛结果 */
  readonly decided?: readonly string[] | undefined;
  /** ① 判断调出的旧记忆；写正文时单独放一栏 */
  readonly recalled?: readonly Memory[] | undefined;
  /** 开场的游戏时间；按它算原剧时间线走到第几天，没给就不带 */
  readonly startTime?: number | undefined;
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
    `天气：${view.weather.label}，${view.weather.note}；写进氛围，有时也是掩护或麻烦`,
    `地点：${view.location ?? "尚未确定，由你在开场时安排"}${view.names.location && view.names.location !== view.location ? `（${view.names.location}）` : ""}`,
    `生命：${view.health.hp}/${view.health.max}，${view.health.conditionLabel}${WOUND_TEXT[view.health.wound] ? `，${WOUND_TEXT[view.health.wound]}` : ""}`,
    `人性：${view.humanity.current}/${view.humanity.cap}，${view.humanity.stageLabel}`,
    `欧元：${view.money.eddies}`,
    `别人眼里的你：${view.perceived}`,
  ];
  if (c.habits.length > 0) lines.push(`习惯：${c.habits.join("；")}`);
  if (c.habitOffers.length > 0)
    lines.push(`提议过、等玩家确认的习惯：${c.habitOffers.join("；")}（不要再提）`);
  if (c.flashback) {
    lines.push(
      `闪回中：${c.flashback.past}，第 ${c.flashback.turn}/${c.flashback.turns} 轮；不掷骰、不推进时间、不记账，最后一轮写 flashback end 和确认的事`,
    );
  } else if (c.pasts.some((p) => !p.used)) {
    lines.push(
      `还能闪回的过往：${c.pasts
        .filter((p) => !p.used)
        .map((p) => p.label)
        .join("、")}`,
    );
  }
  if (view.phone.messages.length > 0) {
    lines.push(
      `消息（最近的在前，未读 ${view.phone.unread} 条）：${view.phone.messages
        .slice(0, PROMPT_MESSAGES)
        .map(
          (m) =>
            `#${m.id} ${m.name}（${m.at}${m.read ? (m.replied ? "，已回复" : "") : "，未读"}）：${m.text}`,
        )
        .join("；")}`,
    );
  }
  if (c.pastFacts.length > 0)
    lines.push(
      `过往里确认的事（已确定的事实）：${c.pastFacts.map((f) => `${f.past}：${f.text}`).join("；")}`,
    );
  if (view.heat.stars > 0 || view.heat.half)
    lines.push(
      `警方热度：${view.heat.stars} 星${view.heat.half ? "多" : ""}${view.heat.lastSeen ? `，最后一次被看见是 ${view.heat.lastSeen}` : ""}${view.heat.decayIn !== null ? `，再过 ${Math.ceil(view.heat.decayIn / 60)} 小时不犯事就降一星` : ""}`,
    );
  for (const h of view.safehouse.homes)
    lines.push(
      `安全屋 ${h.id}：${h.name}（${h.locationName}${h.here ? "，你现在就在这里" : ""}）；存放箱：${h.items.map((i) => `${i.name}${i.count > 1 ? `×${i.count}` : ""}`).join("、") || "空的"}（不在身上，拿出来才能用）`,
    );
  for (const t of view.safehouse.trunks)
    if (t.items.length > 0)
      lines.push(
        `${t.name}（${t.id}）：${t.items.map((i) => `${i.name}${i.count > 1 ? `×${i.count}` : ""}`).join("、")}（不在身上）`,
      );
  const squad = view.squad;
  if (squad.members.length > 0)
    lines.push(
      `小队（${squad.members.length}/${squad.max}；玩家在输入里调度，队员按专长用自己的属性出手，失败时受伤的是队员）：${squad.members.map((m) => `${m.name}（${m.npc}，${m.specialty}，${m.terms}，${m.statusLabel}，好感 ${m.affinity}；个人麻烦：${m.trouble}）`).join("；")}`,
    );
  for (const m of squad.members)
    if (m.owed > 0)
      lines.push(`欠薪：${m.name}已经 ${m.owed} 周没发薪，${m.leavesAt} 前还不发就会走人`);
  if (squad.offers.length > 0)
    lines.push(
      `等玩家确认的入队请求：${squad.offers.map((o) => `${o.name}（${o.kindLabel}，${o.terms}）`).join("、")}；已经提过了，不要再提，等玩家在小队面板答复`,
    );
  if (view.psychosis.anchors.length > 0)
    lines.push(
      `锚点（玩家确认的过命交情）：${view.psychosis.anchors.map((a) => `${a.name}（${a.npc}）`).join("、")}；在场或联系得上时发作相关检定可以写两项加成（来源：锚点），死去或决裂写 anchor`,
    );
  {
    const s = view.psychosis.suppressant;
    if (s.until)
      lines.push(
        `压制剂起效到 ${s.until}：发作相关检定可以写两项加成（来源：压制剂）${s.tolerant ? "；已经耐受，药效变短" : ""}`,
      );
    if (s.withdrawal)
      lines.push("压制剂戒断中：烦躁、手抖、睡不好；相关检定写一项减值（来源：戒断）");
    else if (s.dependent) lines.push("已经依赖压制剂：停药一天就会戒断");
  }
  {
    const c = view.psychosis.crisis;
    if (c?.status === "open")
      lines.push(
        `危机章节（${c.since} 人性归零）：普通委托暂停；方向：被拉回来（锚点或诊所出面，镇定检定成功后写 crisis pulledBack）、带着全部义体走向最后一战（crisis lastStand）、向暴恐机动队投降（crisis surrender），玩家别的合理办法也能接住`,
      );
    else if (c?.status === "lastStand")
      lines.push(
        "最后一战：角色带着全部义体冲向结局，普通委托暂停；结局照剧情写，被拉回来仍可以写 crisis pulledBack",
      );
    else if (c?.status === "recovering")
      lines.push(
        `恢复期到 ${c.until}：刚从危机里被拉回来，身上的义体大多拆了；这段时间义体医生不给装新义体`,
      );
    else if (c?.status === "surrendered") lines.push("已向暴恐机动队投降：写被带走之后的事");
  }
  if (view.psychosis.episodeHere) lines.push("这个场景已经发作过一次，不再安排发作");
  if (view.psychosis.blackoutOpen)
    lines.push("严重发作还没过去：这一段事后会成为记忆空白，场景结束后角色记不清");
  if (view.psychosis.blackouts.length > 0)
    lines.push(
      `记忆空白：${view.psychosis.blackouts.map((b) => `${b.from} 到 ${b.to}`).join("、")}；角色自己想不起这些时候的事，只能从别人的反应、新闻和物证拼回，真相以回合日志为准`,
    );
  if (view.trauma.active)
    lines.push(
      `创伤小组：${view.trauma.tierLabel}，到 ${view.trauma.until}；${view.trauma.dispatch.ok ? "现在叫得来（倒下或濒死时写 trauma rescue）" : `现在不会来：${view.trauma.dispatch.why}`}`,
    );
  else if (view.trauma.lapsed)
    lines.push(`创伤小组：会籍 ${view.trauma.lapsed} 过期了，没续，不会来`);
  if (view.ncpd.alerts.length > 0)
    lines.push(
      `NCPD 警情（扫描器上挂着的，玩家可以去处理，也可以不管）：${view.ncpd.alerts.map((a) => `${a.id}「${a.label}」在${a.locationName}（${a.district}${a.here ? "，就在这个城区" : ""}，${"★".repeat(a.risk)}，赏金 ${a.reward} 欧元，${a.until} 前）：${a.note}`).join("；")}`,
    );
  for (const b of view.heat.bounties)
    lines.push(
      `悬赏 ${b.id}：${b.reward} 欧元（${b.since} 起；案由：${b.reasons.join("；")}）${b.hunter ? `，赏金猎人 ${b.hunter} 在追你` : "，还没有赏金猎人：合适的时候让一个登场，先写 npc 建卡，再写 bounty hunter"}；不随时间消失，只能靠剧情了结（bounty resolve）`,
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
      `断肢：${view.health.lostLimbs.map((l) => l.label).join("、")}；${ids.some((l) => l.endsWith("arm")) ? "断臂不能用双手武器，" : ""}${ids.some((l) => l.endsWith("leg")) ? "断腿不能追车或步行逃跑，" : ""}相关检定在 penalties 加一项（−${MOD_STEP}，计入 −${PENALTY_CAP} 上限）；找义体医生装手臂或腿部义体就补上了`,
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
      `欠义体医生的钱：${view.ripperdocDebts.map((d) => `${d.docName} ${d.amount} 欧元，${d.due} 前还`).join("、")}；还钱在界面上做，你不写 trade。到期没还，医生会派人来催或上门`,
    );
  if (view.hacking) {
    const h = view.hacking;
    const programs = h.programs.map(
      (p) => `${p.id}「${p.name}」（${p.categoryLabel}，${p.ram} 格：${p.effect}）`,
    );
    lines.push(
      `网络接入仓：${h.deckName}，RAM ${h.ram}/${h.ramMax} 格；已装程序 ${h.programs.length}/${h.slots}：${programs.length > 0 ? programs.join("；") : "一个都没装"}`,
    );
    if (h.dive)
      lines.push(
        `潜网中：第 ${h.dive.layer}/${h.dive.layers} 层（${h.dive.label}），肉身躺在${h.dive.chair}，${h.dive.guard}守着`,
      );
    if (h.breaches.length > 0)
      lines.push(
        `这里入侵过的网络：${h.breaches.map((n) => `${n.name}（${n.at}，拿下${n.gains.join("、")}）`).join("；")}`,
      );
  }
  if (view.travel.vehicles.length > 0)
    lines.push(
      `名下的车：${view.travel.vehicles.map((v) => `${v.id}「${v.name}」（${v.classLabel}，速度 ${v.speed} 档，${v.seats} 座，${v.conditionLabel}${v.stolen ? "，偷来的" : ""}）`).join("；")}`,
    );
  if (view.travel.encounter)
    lines.push(
      `路上偶遇（代码定的，这一场要写出来，玩家可以不理）：${view.travel.encounter.label}——${view.travel.encounter.note}`,
    );
  if (view.factions.list.length > 0) {
    const turf = view.factions.list.filter((f) => f.here);
    if (turf.length > 0)
      lines.push(
        `这里（${view.factions.district}）是${turf.map((f) => `${f.name}（${f.turfNote ?? "整片"}，对你${f.attitudeLabel}）`).join("、")}的地盘`,
      );
    lines.push(
      `势力（faction 写 id）：${view.factions.list.map((f) => `${f.id} ${f.name}${f.attitude === "neutral" ? "" : `【${f.attitudeLabel}${f.reason ? `：${f.reason}` : ""}】`}`).join("、")}；没标的对你中立`,
    );
  }
  const weapons = view.inventory.weapons.filter((w): w is string => w !== null);
  const withMods = (w: string) => {
    const fitted = view.inventory.mods[w] ?? [];
    const tuned = view.inventory.tuned[w];
    const extra = [
      ...(tuned ? [`升到${tuned}`] : []),
      ...(fitted.length > 0 ? [`装着 ${fitted.map((m) => m.id).join("、")}`] : []),
    ];
    return extra.length > 0 ? `${w}（${extra.join("；")}）` : w;
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
  if (view.inventory.parts > 0)
    lines.push(
      `零件：${view.inventory.parts} 个（拆解和升级玩家在界面上做；剧情里得到或花掉写 parts）`,
    );
  if (view.combat.active) {
    const a = view.combat.active;
    const enemies = [
      ...a.enemies.map((e) => `${e.group}（${e.tier}，${e.count} 人）`),
      ...a.foes.map(
        (f) =>
          `${f.name}（有卡敌人 ${f.npc}，${f.tier}，${f.stateLabel}${f.state === "down" ? "，等玩家决定杀、放还是抓" : ""}${f.scanned ? "" : "，玩家还没扫描"}）`,
      ),
    ].join("、");
    lines.push(
      `战斗中：第 ${a.moment}/${a.moments} 段，敌人 ${enemies}，${a.objective ? `目标是「${a.objective}」，` : ""}败局是「${a.defeat}」；这一段快捷动作已用 ${a.quick}/${a.quickMax}`,
    );
    if (a.dyingMomentsLeft !== null) lines.push(`濒死：还剩 ${a.dyingMomentsLeft} 段内要被救回`);
    if (a.edgeLabel) lines.push(`第一段：${a.edgeLabel}`);
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

/** 已经到期、叙事模型还没回应的事：期限和超期的委托；一次跳过好几天时期间到期的一起列出 */
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
    "这些事已经到期，这一轮必须在正文里回应：人物打来电话、找上门，或者事情就这么黄了，怎么写由你决定。回应后期限写 deadline handle；委托还要接着办就写 jobNote，黄了就写 jobEnd。",
    ...due.map(
      (e) =>
        `- ${e.kind === "job" ? "委托" : "期限"} ${e.label}［${e.id}］：${formatGameTime(e.due)} 到期，已经过了 ${elapsed(world.time - e.due)}`,
    ),
  ].join("\n");
}

export function formatInput(input: TurnInput): string {
  const boost = input.sandevistan ? "【开斯安威斯坦】" : "";
  const reply = input.replyTo !== undefined ? `【回复消息 #${input.replyTo}】` : "";
  return input.mode
    ? `【${MODE_LABELS[input.mode]}】${boost}${reply}${input.text}`
    : `【玩家】${boost}${reply}${input.text}`;
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
    "按这个结果写这一轮的正文，正文里不提骰子和数值；失败时后果不比事先说明的更重。",
  ];
  return lines.join("\n");
}

export interface NarratorPrompt {
  readonly messages: readonly LlmMessage[];
  /** 本轮带上的规则模块 id，记进回合日志，上下文查看器用 */
  readonly modules: readonly string[];
  /** 规则层的字数：守则、阶段说明、输出约定和规则模块，不含物品表这类数据表 */
  readonly rules: number;
}

/** 判断只看最近几轮的原文 */
export const JUDGE_TURNS = 4;

/** 物品、义体、地点等表：写正文和抽取都要用 id */
export function tablesOf(view: PlayerView, extras: PromptExtras): string[] {
  if (!extras.data) return [];
  return [
    catalogSection(extras.data),
    cyberwareSection(extras.data),
    locationSection(extras.data),
    twistSection(extras.data),
    jobTemplateSection(extras.data),
    consequenceSection(extras.data, view.difficulty),
  ].filter((s): s is string => s !== undefined);
}

/** 各步共用的局面：状态、人物、委托、近期后果、到期事件、开场和检定结果 */
export function situation(
  world: WorldState,
  view: PlayerView,
  plan: NarratorPlan,
  extras: PromptExtras,
): string[] {
  const clock = WorldClockStateSchema.parse(world.slices.world);
  const npcs = NpcStateSchema.parse(world.slices.npc);
  const cast = castSection(npcs, {
    location: clock.location,
    sceneStartedAt: clock.sceneStartedAt,
  });
  const parts = [`【当前状态】\n${stateSummary(view)}`, `【人物】\n${cast}`];
  const jobs = jobsSection(
    JobsStateSchema.parse(world.slices.jobs),
    view.character.streetCred,
    (id) => npcs.npcs[id]?.affinity ?? 0,
  );
  if (jobs) parts.push(`【委托】\n${jobs}`);
  const recent = falloutSection(FalloutStateSchema.parse(world.slices.fallout ?? {}));
  if (recent) parts.push(`【近期后果】\n${recent}`);
  const due = dueSection(world);
  if (due) parts.push(`【到期事件】\n${due}`);
  const city = citySection(CityStateSchema.parse(world.slices.city ?? {}));
  if (city) parts.push(`【城里的动静】\n${city}`);
  const canon = canonSection(extras.data, extras.startTime, world.time);
  if (canon) parts.push(`【原剧时间线】\n${canon}`);
  if (extras.opening && view.totalTurns === 0) parts.push(`【开场】\n${extras.opening}`);
  if (plan.kind === "resolve") parts.push(checkResultText(plan.check));
  return parts;
}

/** 开了斯安威斯坦时的说明；没开或开不了时为 undefined */
export function boostNote(
  view: PlayerView,
  plan: NarratorPlan,
  stage: "judge" | "narrate",
): string | undefined {
  if (plan.kind !== "action" || plan.input.sandevistan !== true || !view.sandevistan)
    return undefined;
  const { name, slots } = view.sandevistan;
  return stage === "judge"
    ? `【斯安威斯坦时刻】\n玩家开了${name}：这一瞬间最多做 ${slots} 个动作（快速破解、换武器、扔手雷各占一格）。所有真正不确定的部分合并成一次 check，事先在 failure 里写明失败时哪几个动作会落空。`
    : `【斯安威斯坦时刻】\n玩家开了${name}：这一瞬间最多做 ${slots} 个动作（快速破解、换武器、扔手雷各占一格），超出的按顺序不执行，正文里写明哪几件没来得及。把这些动作写成一段连贯的慢动作。人性已经由代码扣过。`;
}
