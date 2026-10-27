import { z } from "zod";
import type { LlmMessage } from "../kernel/ports";
import type { Command } from "../kernel/system";
import { effectiveTurns, type LogRecord } from "../kernel/turnlog";
import type { WorldState } from "../kernel/world";
import {
  ARC_OFFSCREEN_RULE,
  ARC_TEXT_MAX,
  ArcsStateSchema,
  arcCatalog,
  arcOf,
  arcOffscreenSection,
  arcUnlocked,
  ConcernFateSchema,
  concernOf,
  type OffscreenConcern,
  offscreenConcerns,
  openConcerns,
} from "../systems/arcs";
import { CRED_SIZES } from "../systems/character";
import {
  BulletinFieldsSchema,
  CityEventFieldsSchema,
  CityStateSchema,
  CONTACT_HOURS,
  CONTACT_PICKS,
  citySection,
  OFFSCREEN_DEATHS,
  OFFSCREEN_EVENTS,
  OFFSCREEN_HOURS,
  OFFSCREEN_MAJOR,
  OFFSCREEN_RUMORS,
  OFFSCREEN_SCENES,
  RumorFieldsSchema,
  rumorSection,
} from "../systems/city";
import {
  AGENDA_OUTCOME_LABELS,
  AgendaMoveCommandSchema,
  agendaCatalog,
  agendaDueSection,
  agendaTurfProblem,
  currentTurf,
  FactionsStateSchema,
} from "../systems/factions";
import { JobsStateSchema } from "../systems/jobs";
import {
  canMove,
  MOVE_MAX,
  moveOverdue,
  NEMESIS_DUE_DAYS,
  NemesisStateSchema,
  nemesisOffscreenSection,
} from "../systems/nemesis";
import { type Npc, NpcStateSchema, PAST_MAX, TIMELINE_SQUASH } from "../systems/npc";
import {
  CallCommandSchema,
  IncomingMessageSchema,
  MESSAGES_PER_TURN,
  PhoneStateSchema,
} from "../systems/phone";
import { SquadStateSchema } from "../systems/squad";
import { formatGameTime, WorldClockStateSchema } from "../systems/world";
import { parseModelJson } from "./block";
import { canonSection } from "./canon";
import { type PromptExtras, stateSummary } from "./prompts/context";
import { BOOKKEEPING_BASE, userMessage } from "./prompts/layers";

/** 场外推演：辅助模型，温度略高，城里的事才有变化 */
export const OFFSCREEN_TEMPERATURE = 0.6;
/** 一次最多更新几个人的近况 */
export const OFFSCREEN_NPCS = 4;
/** 推演窗口：上次推演以来最多几轮正文、每轮最多几个字 */
const WINDOW_TURNS = 8;
const WINDOW_CHARS = 600;
/** 最多带几张人物卡 */
const MAX_CARDS = 12;

/** 刚收的这一场里出场过、还在原地的人：他就在玩家眼前，近况由正文写 */
export function presentNpcs(before: WorldState, after: WorldState): Set<string> {
  const clock = WorldClockStateSchema.parse(before.slices.world);
  const npcs = NpcStateSchema.parse(after.slices.npc).npcs;
  return new Set(
    Object.values(npcs)
      .filter(
        (n) =>
          n.location !== null &&
          n.location === clock.location &&
          n.lastSeenAt !== null &&
          n.lastSeenAt >= clock.sceneStartedAt,
      )
      .map((n) => n.id),
  );
}

/** 这一轮收了场，并且离上次推演隔了几场（默认 3 场，设置里可调）或者游戏时间过了半天 */
export function offscreenDue(
  before: WorldState,
  after: WorldState,
  every: number = OFFSCREEN_SCENES,
): boolean {
  const was = WorldClockStateSchema.parse(before.slices.world);
  const now = WorldClockStateSchema.parse(after.slices.world);
  if (now.scene === was.scene) return false;
  const city = CityStateSchema.parse(after.slices.city ?? {});
  if (now.scene - (city.lastScene ?? 0) >= every) return true;
  // 上次推演以后有势力动向新到点了：只推一次，模型没写的留在队列里等下次
  const due = FactionsStateSchema.parse(after.slices.factions ?? {}).due;
  if (due.some((d) => city.lastAt === null || d.at > city.lastAt)) return true;
  // 宿敌拖到了期限、到期以后还没推演过：推一次，模型没写的等下次正常推演
  const rivals = NemesisStateSchema.parse(after.slices.nemesis ?? {}).nemeses;
  const overdueAt = (n: (typeof rivals)[number]) =>
    (n.lastMoveAt ?? n.since) + NEMESIS_DUE_DAYS * DAY;
  if (
    rivals.some(
      (n) => moveOverdue(n, after.time) && (city.lastAt === null || city.lastAt < overdueAt(n)),
    )
  )
    return true;
  return city.lastAt !== null && after.time - city.lastAt >= OFFSCREEN_HOURS * 60;
}

/** ⑥ 收了场却没推演时给剧透视图的原因；没收场返回 undefined，不记 */
export function offscreenSkipReason(o: {
  readonly closed: boolean;
  readonly flashback: boolean;
  readonly unsettled: boolean;
  readonly dead: boolean;
  readonly every: number | null;
}): string | undefined {
  if (!o.closed) return undefined;
  if (o.dead) return "玩家角色死了，不推演";
  if (o.flashback) return "闪回里不推演";
  if (o.unsettled) return "这一轮没结算干净，不推演";
  if (o.every === null) return "设置里关了城里的动静";
  return `离上次推演还不到 ${o.every} 场，游戏时间也没过半天`;
}

const DAY = 24 * 60;
/** 好感到这么高、这么低算「极端」 */
const AFFINITY_HIGH = 60;
const AFFINITY_LOW = -40;
/** 隔这么多天没见算「很久没联系」 */
const LONG_SILENCE_DAYS = 3;
/** 分数到这么多才挑 */
const CONTACT_MIN_SCORE = 2;

export interface ContactPick {
  readonly id: string;
  readonly name: string;
  readonly score: number;
  readonly why: readonly string[];
}

/**
 * 按权重挑该主动联系玩家的人：离上次挑过了 CONTACT_HOURS 小时才挑；
 * 见过、活着、不在场、不在队里的人，按好感极端、挂着人情或仇、有消息没回、离开以后有新情况、很久没见打分，
 * 分数够的取前 CONTACT_PICKS 个，一样高按 id
 */
export function contactPicks(
  world: WorldState,
  present: ReadonlySet<string> = new Set(),
  data: Readonly<Record<string, unknown>> = {},
): ContactPick[] {
  const city = CityStateSchema.parse(world.slices.city ?? {});
  if (city.lastContactAt !== null && world.time - city.lastContactAt < CONTACT_HOURS * 60)
    return [];
  const npcs = NpcStateSchema.parse(world.slices.npc).npcs;
  const squad = new Set(SquadStateSchema.parse(world.slices.squad ?? {}).members.map((m) => m.npc));
  const messages = PhoneStateSchema.parse(world.slices.phone ?? {}).messages;
  const arcs = ArcsStateSchema.parse(world.slices.arcs ?? {});
  const seeds = arcCatalog(data);
  const rivals = new Map(
    NemesisStateSchema.parse(world.slices.nemesis ?? {}).nemeses.map((rival) => [rival.npc, rival]),
  );
  const picks: ContactPick[] = [];
  for (const n of Object.values(npcs)) {
    if (!n.alive || !n.met || present.has(n.id) || squad.has(n.id)) continue;
    const why: string[] = [];
    let score = 0;
    if (n.affinity >= AFFINITY_HIGH) {
      score += 2;
      why.push(`好感很高（${n.affinity}）`);
    } else if (n.affinity <= AFFINITY_LOW) {
      score += 2;
      why.push(`好感很低（${n.affinity}）`);
    }
    const open = n.ledger.filter((e) => e.settledAt === null);
    if (open.length > 0) {
      score += 2;
      why.push(`挂着没了结的人情或仇：${open[open.length - 1]?.text ?? ""}`);
    }
    if (messages.some((m) => m.from === n.id && !m.replied)) {
      score += 1;
      why.push("上次发的消息玩家没回");
    }
    if (n.doing && (n.lastSeenAt === null || n.doing.at > n.lastSeenAt)) {
      score += 2;
      why.push(`分开以后有了新情况：${n.doing.text}`);
    }
    // 宿敌在屏幕外动过手、之后还没再照面：由代码挑出来让他放句话，动作本身仍只给模型看
    const rival = rivals.get(n.id);
    if (rival?.lastMoveAt != null && (n.lastSeenAt === null || rival.lastMoveAt > n.lastSeenAt)) {
      score += 2;
      why.push(
        "宿敌，最近在屏幕外动过手，想让玩家知道他回来了（消息只放狠话或暗示，不说破他具体做了什么）",
      );
    }
    if (n.lastSeenAt !== null && world.time - n.lastSeenAt >= LONG_SILENCE_DAYS * DAY) {
      score += 1;
      why.push(`${Math.floor((world.time - n.lastSeenAt) / DAY)} 天没见了`);
    }
    const seed = seeds.get(n.id);
    if (seed && arcUnlocked(arcs, seed, n)) {
      const arc = arcOf(arcs, n.id);
      const untold = seed.concerns.some((c) => concernOf(arc, c.id).status === null);
      if (untold && openConcerns(seed, arc).length === 0) {
        score += 2;
        why.push(
          "和玩家熟到可以说心事了，有件事还没提过（发消息只约见面或说有事想聊，不在消息里说破）",
        );
      }
    }
    if (score >= CONTACT_MIN_SCORE) picks.push({ id: n.id, name: n.name, score, why });
  }
  return picks
    .sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, CONTACT_PICKS);
}

/** 这次场外推演可以推的心事：不在场、不在玩家队里的人 */
export function arcPicks(
  world: WorldState,
  present: ReadonlySet<string> = new Set(),
  data: Readonly<Record<string, unknown>> = {},
): OffscreenConcern[] {
  const squad = SquadStateSchema.parse(world.slices.squad ?? {}).members.map((m) => m.npc);
  return offscreenConcerns(
    ArcsStateSchema.parse(world.slices.arcs ?? {}),
    data,
    NpcStateSchema.parse(world.slices.npc).npcs,
    world.time,
    new Set([...present, ...squad]),
  );
}

const OFFSCREEN_STAGE = `【这一步：场外推演】
玩家刚收了一场。你负责推演玩家没看着的地方：这段时间里，夜之城有什么在变？
- 只推演已经具备条件的事：正文里提到、但没在玩家眼前发生的（有人说哪里打起来了、新闻里提到的、委托里的对手、玩家做完事留下的余波），帮派抢地盘、公司的动作、夜之城警察局和暴恐机动队的反应、中间人的生意。不凭空制造戏剧性；没有值得记的，events、npcs、messages 都输出空的（到点的势力动向照样要写）。
- 和现有状态自洽：地点、势力、人物的生死和关系都不能矛盾；不写玩家角色做了什么、说了什么、想了什么。
- 【城里的动静】里已有的照原 id 更新（升级、平息、结束），整条重写；新的事才起新 id。
- 一次最多 ${OFFSCREEN_EVENTS} 条动静，其中 major 最多 ${OFFSCREEN_MAJOR} 条：城不能每次都在爆炸。
- 人物近况只写这次推演牵涉到的、【人物】里活着的人，一人一句，最多 ${OFFSCREEN_NPCS} 个；标了「本场在场」的人就在玩家眼前，不写近况。
- 不改任何数值（欧元、人性、生命、好感、通缉星；声望只按下面「头条和声望」由代码涨），不改期限和委托；动静里可以提到没卡的人，但不建新人物。
- 原作人物没到时候的结局不提前写；死在屏幕外见下面「原作人物」。
- 主动联系：【该联系玩家的人】是代码按好感、人情和仇、没回的消息、分开后的新情况、多久没见挑出来的；人物发消息只能从这里面挑，中间人有生意上的事随时可以发。挑出来的人也不一定要发：这时候他没有说得过去的理由找玩家（只是想寒暄）就不发。发的话要接着他的近况和理由写，像真的短信；最多 ${MESSAGES_PER_TURN} 条。
- 人物经历：近况（npcs）每写一次就进这个人的经历。【该压成摘要的经历】里列出的人，在 pasts 里把他较早的经历压成一段 ${PAST_MAX} 字以内的摘要（接着旧摘要写，保留和玩家有关的、改变了这个人的事），代码只留最近几条原样的。
- 街头传闻：这次推演里有值得传的事（尤其是新的或升级了的动静、和玩家有关的事），在 rumors 里写 0–${OFFSCREEN_RUMORS} 条街上传的原话。truth 标和真相差多少：true 属实，exaggerated 夸大，garbled 走样；reach 标传多远：street 一条街，district 一个城区（写 district），city 全城。同一件事可以有几种说法；说的是玩家角色的标 player: true，按街上的人看到的写（有人看见、有人添油加醋），不写玩家没做过的大事。
- 新闻快讯：bulletin 写一段 N54 新闻快讯（kind: news）或电台主持词（kind: radio），玩家会在界面的「新闻」里看到原文：公司口径、带一点黑色幽默，引用的是传开的版本（和真相可以不一样），不提只有你知道的幕后、人物的诉求底线秘密、没传开的事。这次写了 major 的动静时必须写；其余时候有值得播的才写，没有就写 null。快讯里播了哪条势力动向，就在 agendas 里写它的 id（算玩家听说了）。
- 头条和声望：major 的动静如果玩家角色是当事人（做下这件事的就是玩家，街上也知道是他），写 player: true，可以再写 cred（small、medium、large，默认 medium）；代码会让街头声望按这个涨一次。不是玩家做的不要标。
- 原作人物：【人物】里标了「原作人物」的人可以死在屏幕外，写进 deaths（一次最多 ${OFFSCREEN_DEATHS} 个）：只在局面真的走到那一步时写（原作里这个人这段时间的命运、城里的动静或势力动向牵连到他、他自己的近况把他推到那里）；【原剧时间线】只是参考，玩家插过手的照玩家改过的走。大多数时候 deaths 是空的。写了死，最好再写一条能让玩家以后听说的动静或传闻；他死了就不要再给他写近况和消息。标了「本场在场」、在玩家队里的人不能写。
- 势力动向：【到点的势力动向】里每一条，都要写这次实际发生了什么。种子只是素材：手段可以从「可能的法子」里挑，也可以按局面换个法子、半路改主意、被对头或别的势力（夜之城警察局、网络监察、公司）截胡；接着上次的事和钩子写，和【城里的动静】【人物】对得上，原作里有的人和事优先照原作写。
- 代码掷的倾向是默认结果；局面明显不是这样的（玩家刚端了他们的据点、对头正好在那片收紧），可以改 outcome 并在 why 里写一句理由。地盘一次最多动一个城区，只在「能争的城区」里：成了，可以让这个势力拿下一个，或者让对头丢掉一个；受挫，可以让这个势力丢掉一个，或者让对头抢走一个；出了岔子不动地盘；不动地盘最常见，真打下来、真丢了才写。
- next 写这个势力接下来可能怎么走，一句话，给以后的推演和叙事接着用；可以留空。
- 宿敌：【宿敌】里列的是这次可以在屏幕外动一步的人，每人最多写一条 nemeses：打听玩家的下落、找玩家在乎的人（【人物】里好感高、和玩家有共同记忆的）麻烦、抢玩家的单子或截玩家的中间人，接着他怎么输的和上一步写，${MOVE_MAX} 字以内。标了「这次要写」的必须写；其余的有说得过去的理由才写。只写他做了什么，不改任何数值，不写玩家的反应，不让他亲自和玩家见面；被他找过麻烦的人可以顺手在 npcs 里写近况或在 messages 里给玩家发消息。
${ARC_OFFSCREEN_RULE}`;

const OFFSCREEN_OUTPUT = `【输出格式】
只输出一个 JSON 对象，不要代码块：
{"events": [{"id": "小写英文和连字符", "title": "24 字以内", "body": "160 字以内：发生了什么、谁在动、接下来可能怎样", "district": "城区，可省", "status": "brewing|heating|cooling|over", "weight": "minor|normal|major", "player": "可省：玩家角色是当事人时写 true", "cred": "可省：small|medium|large"}], "npcs": [{"id": "人物 id", "doing": "最近在做什么，一句话，80 字以内"}], "pasts": [{"id": "【该压成摘要的经历】里的人物 id", "text": "${PAST_MAX} 字以内的经历摘要"}], "rumors": [{"event": "可省：说的是哪条动静的 id", "text": "街上传的原话，80 字以内", "truth": "true|exaggerated|garbled", "reach": "street|district|city", "district": "reach 不是 city 时写城区", "player": "说的是玩家角色时写 true，可省"}], "bulletin": {"kind": "news|radio", "title": "24 字以内", "text": "200 字以内的播报原文", "agendas": ["可省：播了的势力动向 id"]}, "deaths": [{"id": "原作人物 id", "cause": "80 字以内：怎么死的、谁干的"}], "messages": [{"from": "人物或中间人 id", "text": "消息原文：短、口语"}], "agendas": [{"id": "到点的动向 id", "outcome": "success|setback|twist，照倾向的可省", "why": "改了结果才写，一句理由", "title": "24 字以内", "text": "160 字以内：实际发生了什么、谁在背后、用的什么法子", "news": "80 字以内：传开以后街上、新闻里怎么说", "turf": {"faction": "势力 id", "district": "城区", "change": "gain|lose"}, "next": "可省：接下来可能怎么走，80 字以内"}], "nemeses": [{"npc": "【宿敌】里的人物 id", "text": "${MOVE_MAX} 字以内：他这次在屏幕外做了什么"}], "arcs": [{"npc": "【没人管的心事】里的人物 id", "concern": "心事 id", "text": "${ARC_TEXT_MAX} 字以内：这件事这次怎么了", "resolve": "可省：推出结果时写 true", "fate": "resolve 时写 better|canon|worse"}]}
status：brewing 在酝酿，heating 在升级，cooling 在平息，over 结束了。weight：minor 街角小事，normal 几个街区在传，major 上了 N54 头条、迟早找到玩家头上。
agendas：没有【到点的势力动向】就输出空数组；有的话每条到点的都写一条。turf 不动地盘时写 null。
nemeses：没有【宿敌】就输出空数组。
arcs：没有【没人管的心事】就输出空数组；有也可以空着。
calls：重要的人确有需要当面通话的急事时，可以输出 [{"from": "人物或中间人 id", "about": "200 字以内的来意，仅给叙事模型"}]，否则输出 []。最多一通，和 messages 共用本轮 ${MESSAGES_PER_TURN} 条联系额度；同一件事不要既发消息又打电话。人物只能从【该联系玩家的人】里选，中间人必须已有记录；不让已死、本场在场或在队里的人打来。只提议来电，不替玩家接听、拒接或回应；about 不得写成玩家已经听到的内容。
messages：派单消息附上 job 字段，值为当前状态里已经挂出、尚未接下且未到期的委托 id；普通消息不写。场外推演不能新建委托，不编造 id，不把已接下或已结束的委托当成可接的新单。

例：{"events": [{"id": "tyger-claws-kabuki", "title": "虎爪帮在歌舞伎区收紧地盘", "body": "那间夜店被砸以后，虎爪帮把歌舞伎区几条街的保护费翻了倍，正在挨家打听是谁干的。", "district": "沃森", "status": "heating", "weight": "normal"}], "npcs": [], "messages": []}
玩家只是在公寓睡了一觉、正文没提城里任何事、也没有到点的势力动向时：{"events": [], "npcs": [], "pasts": [], "rumors": [], "bulletin": null, "deaths": [], "messages": [], "agendas": [], "nemeses": [], "arcs": []}
不要写没有前因的大事：玩家在街边吃了碗面，就写「荒坂塔遇袭」，这是凭空制造戏剧性。`;

export const OFFSCREEN_SYSTEM = [BOOKKEEPING_BASE, OFFSCREEN_STAGE, OFFSCREEN_OUTPUT].join("\n\n");

function card(n: Npc, here: boolean): string {
  const parts = [
    `${n.id}｜${n.name}，${n.role}${n.canon ? "（原作人物）" : ""}`,
    `想要：${n.want}`,
    `底线：${n.limit}`,
  ];
  if (n.secret) parts.push(`秘密：${n.secret}`);
  if (n.past) parts.push(`更早的经历：${n.past.text}`);
  const earlier = n.timeline.slice(-4, -1);
  if (earlier.length > 0) {
    parts.push(`经历：${earlier.map((t) => `${t.text}（${formatGameTime(t.at)}）`).join("；")}`);
  }
  if (n.doing) parts.push(`最近：${n.doing.text}（${formatGameTime(n.doing.at)}）`);
  parts.push(n.met ? `好感 ${n.affinity}` : "玩家还没见过");
  if (here) parts.push("本场在场");
  const shared = n.memories.slice(-3);
  if (shared.length > 0) parts.push(`和玩家：${shared.join("；")}`);
  return `- ${parts.join("；")}`;
}

/** 场外推演的提示词：状态、活着的人、中间人、已有动静、上次推演以来的正文和刚收场的这一轮 */
export function buildOffscreenPrompt(
  world: WorldState,
  records: readonly LogRecord[],
  extras: PromptExtras,
  narrative: string,
  present: ReadonlySet<string> = new Set(),
): LlmMessage[] {
  const city = CityStateSchema.parse(world.slices.city ?? {});
  const npcs = Object.values(NpcStateSchema.parse(world.slices.npc).npcs)
    .filter((n) => n.alive)
    .sort((a, b) => (b.lastSeenAt ?? -1) - (a.lastSeenAt ?? -1))
    .slice(0, MAX_CARDS);
  const fixers = Object.values(JobsStateSchema.parse(world.slices.jobs).fixers);
  const due = agendaDueSection(
    FactionsStateSchema.parse(world.slices.factions ?? {}),
    extras.data ?? {},
  );
  const rumors = rumorSection(city);
  const nemeses = nemesisOffscreenSection(
    NemesisStateSchema.parse(world.slices.nemesis ?? {}),
    world.time,
  );
  const picks = contactPicks(world, present, extras.data);
  const concerns = arcOffscreenSection(arcPicks(world, present, extras.data));
  const squash = Object.values(NpcStateSchema.parse(world.slices.npc).npcs)
    .filter((n) => n.alive && n.timeline.length >= TIMELINE_SQUASH)
    .slice(0, 3);
  const canon = canonSection(extras.data, extras.startTime, world.time);
  const since = city.lastScene ?? 0;
  const window = effectiveTurns(records)
    .filter((r) => (r.scene ?? since) >= since)
    .slice(-WINDOW_TURNS)
    .map((r) => r.text.slice(0, WINDOW_CHARS));
  const content = userMessage({
    scene: [
      `【当前状态】\n${stateSummary(world, records, extras.data)}`,
      `【人物】\n${npcs.length > 0 ? npcs.map((n) => card(n, present.has(n.id))).join("\n") : "（还没有）"}`,
      ...(fixers.length > 0
        ? [`【中间人】\n${fixers.map((f) => `- ${f.id}｜${f.name}`).join("\n")}`]
        : []),
      `【城里的动静】\n${citySection(city) ?? "（还没有记下的）"}`,
      ...(rumors ? [`【街头传闻】\n${rumors}`] : []),
      `【该联系玩家的人】\n${
        picks.length > 0
          ? picks.map((p) => `- ${p.id}｜${p.name}：${p.why.join("；")}`).join("\n")
          : "（这次没有：人物不发消息，中间人有生意上的事照常可以发）"
      }`,
      ...(squash.length > 0
        ? [
            `【该压成摘要的经历】\n${squash
              .map(
                (n) =>
                  `- ${n.id}｜${n.name}：${n.past ? `旧摘要：${n.past.text}；` : ""}经历：${n.timeline.map((t) => `${t.text}（${formatGameTime(t.at)}）`).join("；")}`,
              )
              .join("\n")}`,
          ]
        : []),
      ...(canon ? [`【原剧时间线】（只是参考）\n${canon}`] : []),
      ...(due ? [`【到点的势力动向】\n${due}`] : []),
      ...(nemeses ? [`【宿敌】\n${nemeses}`] : []),
      ...(concerns ? [`【没人管的心事】（原作结局只是参考）\n${concerns}`] : []),
      ...(window.length > 0 ? [`【上次推演以来的正文】\n${window.join("\n\n")}`] : []),
    ],
    input: `【刚收场的这一轮正文】\n${narrative}`,
    reminder: "（只输出一个 JSON 对象。）",
  });
  return [
    { role: "system", content: OFFSCREEN_SYSTEM },
    { role: "user", content },
  ];
}

/** 场外推演只提议来电身份和用意；内部指令类型由代码补上，接听决定只能来自玩家 */
const OffscreenCallSchema = CallCommandSchema.omit({ type: true });

const OffscreenNpcSchema = z.object({
  id: z.string().trim().min(1),
  doing: z.string().trim().min(1).max(80),
});

/** 推演写的动静可以多标玩家是不是当事人、声望涨多少；进 city.event 前去掉 */
const OffscreenEventSchema = CityEventFieldsSchema.extend({
  player: z.boolean().optional(),
  cred: z.enum(["small", "medium", "large"]).optional(),
});
const OffscreenPastSchema = z.object({
  id: z.string().trim().min(1),
  text: z.string().trim().min(1).max(PAST_MAX),
});
const OffscreenBulletinSchema = BulletinFieldsSchema.extend({
  agendas: z.array(z.string().trim().min(1)).max(3).optional(),
});
const OffscreenNemesisSchema = z.object({
  npc: z.string().trim().min(1),
  text: z.string().trim().min(1).max(MOVE_MAX),
});
const OffscreenArcSchema = z.object({
  npc: z.string().trim().min(1),
  concern: z.string().trim().min(1),
  text: z.string().trim().min(1).max(ARC_TEXT_MAX),
  resolve: z.boolean().optional(),
  fate: ConcernFateSchema.optional(),
});
const OffscreenDeathSchema = z.object({
  id: z.string().trim().min(1),
  cause: z.string().trim().min(1).max(80),
});

export interface OffscreenResult {
  readonly commands: Command[];
  /** 丢掉、降级的原因；只进剧透视图 */
  readonly notes: string[];
  /** 这次给了【该联系玩家的人】：city.ran 记下挑人的时间 */
  readonly contact: boolean;
}

/** 读场外推演的结果：逐条校验，头条超额的降成 normal，人和发消息的人都要对得上 */
export function readOffscreen(
  text: string,
  world: WorldState,
  opts: {
    /** 本场在场的人：不写近况 */
    readonly present?: ReadonlySet<string>;
    /** 这一轮还能收几条消息（本轮正文已经发的要扣掉） */
    readonly messages?: number;
    /** 内容表：读势力动向的种子和势力卡 */
    readonly data?: Readonly<Record<string, unknown>>;
  } = {},
): OffscreenResult {
  const commands: Command[] = [];
  const notes: string[] = [];
  const picks = contactPicks(world, opts.present, opts.data);
  const contact = picks.length > 0;
  const json = parseModelJson(text);
  if (
    !json.ok ||
    typeof json.value !== "object" ||
    json.value === null ||
    Array.isArray(json.value)
  ) {
    notes.push(`场外推演的结果读不了${json.ok ? "" : `：${json.error}`}，这次不推演`);
    return { commands, notes, contact };
  }
  const raw = json.value as Record<string, unknown>;
  const list = (key: string): unknown[] => {
    const value = raw[key];
    return Array.isArray(value) ? value : [];
  };
  const npcs = NpcStateSchema.parse(world.slices.npc).npcs;
  const fixers = JobsStateSchema.parse(world.slices.jobs).fixers;
  const issue = (error: z.ZodError) => error.issues[0]?.message ?? "格式不对";

  let majors = 0;
  let kept = 0;
  /** 玩家当事的头条：最后统一结算声望（同一条动静只算一次，由 credSettled 去重） */
  const credits: Command[] = [];
  const written = new Set<string>();
  for (const [i, item] of list("events").entries()) {
    const parsed = OffscreenEventSchema.safeParse(item);
    if (!parsed.success) {
      notes.push(`场外推演：events[${i}] 格式不对：${issue(parsed.error)}`);
      continue;
    }
    if (kept >= OFFSCREEN_EVENTS) {
      notes.push(`场外推演：动静一次最多 ${OFFSCREEN_EVENTS} 条，多的不要`);
      break;
    }
    kept += 1;
    const { player, cred, ...fields } = parsed.data;
    let event = fields;
    if (event.weight === "major") {
      majors += 1;
      if (majors > OFFSCREEN_MAJOR) {
        event = { ...event, weight: "normal" };
        notes.push(`场外推演：头条一次最多 ${OFFSCREEN_MAJOR} 条，「${event.title}」降成 normal`);
      }
    }
    written.add(event.id);
    commands.push({ type: "city.event", ...event });
    if (player === true && event.weight === "major" && event.status !== "over") {
      credits.push({
        type: "streetCred",
        levels: CRED_SIZES[cred ?? "medium"],
        reason: `上了头条：${event.title}`,
        event: `city:${event.id}`,
      });
    } else if (player === true) {
      notes.push(`场外推演：「${event.title}」不是头条，玩家当事也不涨声望`);
    }
  }
  const majorWritten = majors > 0;

  let updated = 0;
  for (const [i, item] of list("npcs").entries()) {
    const parsed = OffscreenNpcSchema.safeParse(item);
    if (!parsed.success) {
      notes.push(`场外推演：npcs[${i}] 格式不对：${issue(parsed.error)}`);
      continue;
    }
    const npc = npcs[parsed.data.id];
    if (!npc?.alive) {
      notes.push(`场外推演：npcs[${i}] ${parsed.data.id} ${npc ? "已经死了" : "不在人物卡里"}`);
      continue;
    }
    if (opts.present?.has(npc.id)) {
      notes.push(`场外推演：${npc.name}本场在场，近况由正文写`);
      continue;
    }
    if (updated >= OFFSCREEN_NPCS) {
      notes.push(`场外推演：人物近况一次最多 ${OFFSCREEN_NPCS} 个，多的不要`);
      break;
    }
    updated += 1;
    commands.push({ type: "doing", id: npc.id, text: parsed.data.doing });
  }

  const city = CityStateSchema.parse(world.slices.city ?? {});
  let rumored = 0;
  for (const [i, item] of list("rumors").entries()) {
    const parsed = RumorFieldsSchema.safeParse(item);
    if (!parsed.success) {
      notes.push(`场外推演：rumors[${i}] 格式不对：${issue(parsed.error)}`);
      continue;
    }
    const rumor = parsed.data;
    if (
      rumor.event !== undefined &&
      !written.has(rumor.event) &&
      !city.events.some((e) => e.id === rumor.event)
    ) {
      notes.push(`场外推演：传闻「${rumor.text}」说的 ${rumor.event} 不是记下的动静，去掉关联`);
      delete rumor.event;
    }
    if (rumored >= OFFSCREEN_RUMORS) {
      notes.push(`场外推演：传闻一次最多 ${OFFSCREEN_RUMORS} 条，多的不要`);
      break;
    }
    rumored += 1;
    commands.push({ type: "city.rumor", ...rumor });
  }

  for (const [i, item] of list("pasts").entries()) {
    const parsed = OffscreenPastSchema.safeParse(item);
    if (!parsed.success) {
      notes.push(`场外推演：pasts[${i}] 格式不对：${issue(parsed.error)}`);
      continue;
    }
    const npc = npcs[parsed.data.id];
    if (!npc || npc.timeline.length < TIMELINE_SQUASH) {
      notes.push(`场外推演：pasts[${i}] ${parsed.data.id} 不在【该压成摘要的经历】里`);
      continue;
    }
    commands.push({ type: "npc.past", id: npc.id, text: parsed.data.text });
  }

  const squad = new Set(SquadStateSchema.parse(world.slices.squad ?? {}).members.map((m) => m.npc));
  const died = new Set<string>();
  for (const [i, item] of list("deaths").entries()) {
    const parsed = OffscreenDeathSchema.safeParse(item);
    if (!parsed.success) {
      notes.push(`场外推演：deaths[${i}] 格式不对：${issue(parsed.error)}`);
      continue;
    }
    const npc = npcs[parsed.data.id];
    const problem = !npc
      ? "不在人物卡里"
      : !npc.canon
        ? "不是原作人物"
        : !npc.alive
          ? "已经死了"
          : opts.present?.has(npc.id)
            ? "本场在场"
            : squad.has(npc.id)
              ? "在玩家队里"
              : undefined;
    if (problem || !npc) {
      notes.push(`场外推演：deaths[${i}] ${parsed.data.id} ${problem ?? ""}，不能死在屏幕外`);
      continue;
    }
    if (died.size >= OFFSCREEN_DEATHS) {
      notes.push(`场外推演：原作人物一次最多死 ${OFFSCREEN_DEATHS} 个，多的不要`);
      break;
    }
    died.add(npc.id);
    commands.push({ type: "npc.offscreenDeath", id: npc.id, cause: parsed.data.cause });
  }

  const picked = new Set(picks.map((p) => p.id));
  const budget = Math.max(0, opts.messages ?? MESSAGES_PER_TURN);
  let sent = 0;
  for (const [i, item] of list("messages").entries()) {
    const parsed = IncomingMessageSchema.safeParse(item);
    if (!parsed.success) {
      notes.push(`场外推演：messages[${i}] 格式不对：${issue(parsed.error)}`);
      continue;
    }
    const npc = npcs[parsed.data.from];
    const fixer = fixers[parsed.data.from] !== undefined;
    const known = (npc?.alive === true && npc.met && !died.has(npc.id)) || fixer;
    if (!known) {
      notes.push(`场外推演：messages[${i}] 的 ${parsed.data.from} 不是玩家见过的活人或中间人`);
      continue;
    }
    if (!fixer && !picked.has(parsed.data.from)) {
      notes.push(
        `场外推演：messages[${i}] 的 ${parsed.data.from} 不在【该联系玩家的人】里，人物主动联系由代码挑`,
      );
      continue;
    }
    if (sent >= budget) {
      notes.push(`场外推演：消息连同本轮正文每轮最多 ${MESSAGES_PER_TURN} 条，多的不要`);
      break;
    }
    sent += 1;
    commands.push({
      type: "phone.receive",
      from: parsed.data.from,
      text: parsed.data.text,
      ...(parsed.data.job === undefined ? {} : { job: parsed.data.job }),
    });
  }

  const phone = PhoneStateSchema.parse(world.slices.phone ?? {});
  for (const [i, item] of list("calls").entries()) {
    if (sent >= budget || phone.calls.some((c) => c.status === "ringing")) break;
    const parsed = OffscreenCallSchema.safeParse(item);
    if (!parsed.success) {
      notes.push(`场外推演：calls[${i}] 格式不对：${issue(parsed.error)}`);
      continue;
    }
    const { from } = parsed.data;
    const npc = npcs[from];
    const fixer = fixers[from] !== undefined;
    if (
      (npc ? !npc.alive || !npc.met : !fixer) ||
      died.has(from) ||
      opts.present?.has(from) ||
      squad.has(from) ||
      (!fixer && !picked.has(from))
    ) {
      notes.push(`场外推演：calls[${i}] 来电者不符合主动联系条件`);
      continue;
    }
    commands.push({ type: "phone.call", ...parsed.data });
    sent += 1;
    break;
  }

  const data = opts.data ?? {};
  const factions = FactionsStateSchema.parse(world.slices.factions ?? {});
  const seeds = agendaCatalog(data);
  const turf = currentTurf(factions, data);
  const wrote = new Set<string>();
  for (const [i, item] of list("agendas").entries()) {
    const parsed = AgendaMoveCommandSchema.omit({ type: true }).safeParse(item);
    if (!parsed.success) {
      notes.push(`场外推演：agendas[${i}] 格式不对：${issue(parsed.error)}`);
      continue;
    }
    const move = parsed.data;
    const seed = seeds.get(move.id);
    const due = factions.due.find((d) => d.id === move.id);
    if (!seed || !due) {
      notes.push(`场外推演：agendas[${i}] ${move.id} ${seed ? "没到点" : "不是势力动向"}`);
      continue;
    }
    if (wrote.has(move.id)) {
      notes.push(`场外推演：${move.id} 一次只写一步，多的不要`);
      continue;
    }
    wrote.add(move.id);
    const outcome = move.outcome ?? due.outcome;
    if (outcome !== due.outcome)
      notes.push(
        `场外推演：${move.id} 倾向是${AGENDA_OUTCOME_LABELS[due.outcome]}，改成了${AGENDA_OUTCOME_LABELS[outcome]}${move.why ? `：${move.why}` : ""}`,
      );
    const problem = agendaTurfProblem(seed, outcome, move.turf, turf);
    if (problem) notes.push(`场外推演：「${move.title}」的地盘变化不算：${problem}`);
    commands.push({ type: "agenda.move", ...move, turf: problem ? null : move.turf });
  }

  const rivals = NemesisStateSchema.parse(world.slices.nemesis ?? {}).nemeses;
  const moved = new Set<string>();
  for (const [i, item] of list("nemeses").entries()) {
    const parsed = OffscreenNemesisSchema.safeParse(item);
    if (!parsed.success) {
      notes.push(`场外推演：nemeses[${i}] 格式不对：${issue(parsed.error)}`);
      continue;
    }
    const rival = rivals.find((n) => n.npc === parsed.data.npc);
    const problem = !rival
      ? "不是宿敌"
      : !canMove(rival, world.time)
        ? "离上次动静还不到间隔"
        : died.has(rival.npc) || npcs[rival.npc]?.alive === false
          ? "已经死了"
          : moved.has(rival.npc)
            ? "一次只写一步"
            : undefined;
    if (problem || !rival) {
      notes.push(`场外推演：nemeses[${i}] ${parsed.data.npc} ${problem ?? ""}，不要`);
      continue;
    }
    moved.add(rival.npc);
    commands.push({ type: "nemesis.move", npc: rival.npc, text: parsed.data.text });
  }
  for (const n of rivals) {
    if (!moved.has(n.npc) && moveOverdue(n, world.time)) {
      notes.push(`场外推演：宿敌${n.name}标了「这次要写」却没写`);
    }
  }

  const listed = arcPicks(world, opts.present, opts.data);
  const pushed = new Set<string>();
  for (const [i, item] of list("arcs").entries()) {
    const parsed = OffscreenArcSchema.safeParse(item);
    if (!parsed.success) {
      notes.push(`场外推演：arcs[${i}] 格式不对：${issue(parsed.error)}`);
      continue;
    }
    const { npc, concern, text: what } = parsed.data;
    const pick = listed.find((o) => o.npc === npc && o.concern.id === concern);
    const problem = !pick
      ? "不在【没人管的心事】里"
      : died.has(npc)
        ? "这次已经死了"
        : pushed.has(npc)
          ? "一次只写一步"
          : undefined;
    if (problem || !pick) {
      notes.push(`场外推演：arcs[${i}] ${npc}/${concern} ${problem ?? ""}，不要`);
      continue;
    }
    pushed.add(npc);
    let resolve = parsed.data.resolve === true;
    if (resolve && pick.progress.notes.length === 0) {
      notes.push(`场外推演：arcs[${i}] ${npc}/${concern} 还没推过一步，不能直接出结果，只记这一步`);
      resolve = false;
    }
    const fate = resolve ? (parsed.data.fate ?? "canon") : undefined;
    if (resolve && !parsed.data.fate) {
      notes.push(`场外推演：arcs[${i}] ${npc}/${concern} 出了结果没写 fate，按 canon 记`);
    }
    commands.push({
      type: "arc.offscreen",
      npc,
      concern,
      text: what,
      resolve,
      ...(fate ? { fate } : {}),
    });
  }

  const rawBulletin = raw.bulletin;
  if (rawBulletin !== undefined && rawBulletin !== null) {
    const parsed = OffscreenBulletinSchema.safeParse(rawBulletin);
    if (!parsed.success) {
      notes.push(`场外推演：bulletin 格式不对：${issue(parsed.error)}`);
    } else {
      const { agendas, ...bulletin } = parsed.data;
      commands.push({ type: "city.bulletin", ...bulletin });
      for (const id of new Set(agendas ?? [])) {
        if (!seeds.has(id)) {
          notes.push(`场外推演：快讯里的 ${id} 不是势力动向`);
          continue;
        }
        // 这次刚写了一步，或者还有玩家没听说的几步，才算播了新东西
        const fresh = wrote.has(id) || (factions.agendas[id]?.moves.some((m) => !m.told) ?? false);
        if (!fresh) {
          notes.push(`场外推演：快讯里的 ${id} 没有玩家还没听说的事`);
          continue;
        }
        commands.push({ type: "agendaTold", id });
      }
    }
  } else if (majorWritten) {
    notes.push("场外推演：这次写了头条却没写新闻快讯");
  }
  commands.push(...credits);
  return { commands, notes, contact };
}
