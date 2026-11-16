import { z } from "zod";
import type { LlmMessage } from "../kernel/ports";
import type { Command } from "../kernel/system";
import { effectiveTurns, type LogRecord } from "../kernel/turnlog";
import type { WorldState } from "../kernel/world";
import { CRED_SIZES } from "../systems/character";
import {
  BulletinFieldsSchema,
  CityEventFieldsSchema,
  CityStateSchema,
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
import { agendaCatalog } from "../systems/factions";
import { JobOfferSchema, JobsStateSchema, jobTemplateSection } from "../systems/jobs";
import {
  attitudeLabel,
  NO_FACTION,
  NO_FACTION_LABEL,
  type Npc,
  NpcStateSchema,
  PAST_MAX,
  TIMELINE_SQUASH,
  TieSchema,
} from "../systems/npc";
import {
  CallCommandSchema,
  IncomingMessageSchema,
  MESSAGES_PER_TURN,
  PhoneStateSchema,
} from "../systems/phone";
import { SquadStateSchema } from "../systems/squad";
import {
  THREADS_MAX,
  ThreadCloseSchema,
  ThreadDeferSchema,
  ThreadOpenSchema,
  ThreadStepCommandSchema,
  ThreadsStateSchema,
  threadSection,
} from "../systems/threads";
import {
  formatGameTime,
  locationCatalog,
  WorldClockStateSchema,
  withSavedPlaces,
} from "../systems/world";
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

/**
 * 场外推演各项的条数只是建议，超了照收，到建议的这么多倍才截（用户 2026-11-01 定的「全改」第 2 步：
 * 模型当主持人，代码只管记账）；只防模型写疯了把账本撑爆
 */
const SOFT_CAP = 3;
const soft = (n: number) => n * SOFT_CAP;

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

/** 到期事件、经过的游戏时间或场景批次触发；每批更新 lastAt，避免同一到期事件反复调用。 */
export function offscreenDue(
  before: WorldState,
  after: WorldState,
  every: number = OFFSCREEN_SCENES,
): boolean {
  const was = WorldClockStateSchema.parse(before.slices.world);
  const now = WorldClockStateSchema.parse(after.slices.world);
  const city = CityStateSchema.parse(after.slices.city ?? {});
  if (now.scene !== was.scene && now.scene - (city.lastScene ?? 0) >= every) return true;
  // 统一看新单子的期限，不再分别催势力和宿敌（用户 2026-11-01 定的"全改"第 4 步）
  // 同一个期限只触发一次额外推演；遗漏的留到正常推演再提醒，避免每轮反复调用
  const threads = ThreadsStateSchema.parse(after.slices.threads ?? {}).threads;
  if (threads.some((t) => t.dueAt <= after.time && (city.lastAt === null || t.dueAt > city.lastAt)))
    return true;
  const jobs = JobsStateSchema.parse(after.slices.jobs).jobs;
  if (jobs.some((job) => job.due !== null && job.due <= after.time &&
    (job.status === "active" || job.status === "expired") &&
    (city.lastAt === null || job.due > city.lastAt))) return true;
  if (now.deadlines.some((deadline) => deadline.handledAt === null && deadline.due <= after.time &&
    (city.lastAt === null || deadline.due > city.lastAt))) return true;
  const since = city.lastAt ?? (was.sceneStartedAt > 0 ? was.sceneStartedAt : before.time);
  return after.time > before.time && after.time - since >= OFFSCREEN_HOURS * 60;
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

/**
 * 熟人的联系范围：见过、活着、不在场也不在队里；中间人也是普通人物，一样在里面
 * （用户 2026-11-02："都是npc"）。派单另走【能派单的中间人】。
 * 不打分、不挑前几名，谁来联系由主持人定（用户 2026-11-01 定的"全改"第 4 步）
 */
export function contactable(world: WorldState, present: ReadonlySet<string> = new Set()): Npc[] {
  const npcs = NpcStateSchema.parse(world.slices.npc).npcs;
  const squad = new Set(SquadStateSchema.parse(world.slices.squad ?? {}).members.map((m) => m.npc));
  return Object.values(npcs).filter(
    (n) => n.alive && n.met && !present.has(n.id) && !squad.has(n.id),
  );
}

// 心事什么时候往前走由【城里在发酵的事】的定时器管，不再由代码挑（用户 2026-11-01 定的「全改」第 4 步）

/**
 * 每次场外推演最多让这么多人过一段自己的日子（用户 2026-10-31："感觉没有活人感""感觉是为了我才存在的"）：
 * 原来只写推演牵涉到的人，没牵涉的人离开视线就停住了
 */
export const OFFSCREEN_LIVES = 2;

/**
 * 每次场外推演最多新记或改几条人物之间的关系（用户 2026-10-31："npc也有自己的生活，也有认识的npc"）：
 * 过日子时和认识的人来往、结识、闹翻，两边都有卡的才记
 */
export const OFFSCREEN_TIES = 2;

/**
 * 该过自己日子的人：活着、不在场、不在玩家队里；见过的优先，近况最久没变的优先（没写过近况的最先），
 * 一样久按 id。由代码轮着挑，每个人迟早都会轮到
 */
export function lifePicks(world: WorldState, present: ReadonlySet<string> = new Set()): Npc[] {
  const squad = new Set(SquadStateSchema.parse(world.slices.squad ?? {}).members.map((m) => m.npc));
  return Object.values(NpcStateSchema.parse(world.slices.npc).npcs)
    .filter((n) => n.alive && !present.has(n.id) && !squad.has(n.id))
    .sort(
      (a, b) =>
        Number(b.met) - Number(a.met) ||
        (a.doing?.at ?? -1) - (b.doing?.at ?? -1) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )
    .slice(0, OFFSCREEN_LIVES);
}

/**
 * 场外推演里中间人主动派单（用户定的，2026-10-30："能不能接到世界演变里"）：
 * 一次最多派这么多单；挂着没接、没过期的委托到 OFFERED_CAP 单就不再派，免得消息里同时堆太多活
 */
export const OFFSCREEN_JOBS = 1;
export const OFFERED_CAP = 3;

export interface OffscreenFixer {
  readonly id: string;
  readonly name: string;
}

/** 场外推演这次能不能派新单：挂着没接的委托已经够多时不派 */
export function offscreenJobsOpen(world: WorldState): boolean {
  const offered = JobsStateSchema.parse(world.slices.jobs).jobs.filter(
    (j) => j.status === "offered" && (j.due === null || j.due > world.time),
  ).length;
  return offered < OFFERED_CAP;
}

/**
 * 这次场外推演能派单的中间人：已经登记的中间人里，人物卡没死、不在场、不在玩家队里的。
 * offscreenJobsOpen 不让派时一个也不给；不在这里新建中间人（场外推演不建新人物）
 */
export function offscreenFixers(
  world: WorldState,
  present: ReadonlySet<string> = new Set(),
): OffscreenFixer[] {
  if (!offscreenJobsOpen(world)) return [];
  const jobs = JobsStateSchema.parse(world.slices.jobs);
  const npcs = NpcStateSchema.parse(world.slices.npc).npcs;
  const squad = new Set(SquadStateSchema.parse(world.slices.squad ?? {}).members.map((m) => m.npc));
  return Object.values(jobs.fixers)
    .filter((f) => npcs[f.id]?.alive !== false && !present.has(f.id) && !squad.has(f.id))
    .map((f) => ({ id: f.id, name: f.name }));
}

/**
 * 场外推演的规则。熟人主动发的消息不一定有正事，也可以只是闲聊（用户定的，2026-10-30："也有可能是闲聊啊"）；
 * 托的事也不一定是真心的（用户定的，2026-10-30："不一定是真的求助信息啊"）
 */
const OFFSCREEN_STAGE = `【这一步：场外推演】
玩家刚收了一场。你负责推演玩家没看着的地方：这段时间里，夜之城有什么在变？
- 只推演已经具备条件的事：正文里提到、但没在玩家眼前发生的（有人说哪里打起来了、新闻里提到的、委托里的对手、玩家做完事留下的余波），帮派抢地盘、公司的动作、夜之城警察局和暴恐机动队的反应、中间人的生意。不凭空制造戏剧性；没有值得记的，events、npcs、messages 都输出空的（【城里在发酵的事】里已到点的，写一步或往后推）。
- 和现有状态自洽：地点、势力、人物的生死和关系都不能矛盾；不写玩家角色做了什么、说了什么、想了什么。
- 【城里的动静】里已有的照原 id 更新（升级、平息、结束），整条重写；新的事才起新 id。
- 动静一般不超过 ${OFFSCREEN_EVENTS} 条，major 一般 ${OFFSCREEN_MAJOR} 条（多的 major 代码按 normal 记）：城不能每次都在爆炸；真有那么多事也可以多写。
- 人物近况写这次推演牵涉到的、【人物】里活着的人，一人一句，一般不超过 ${OFFSCREEN_NPCS} 个；标了「本场在场」的人就在玩家眼前，不写近况。
- 人物移动：中间人也是普通人物，同样有自己的生活、可以离开办公室或常驻地点；派单身份不代表固定站在那里。近况里确实去了别处时，在 npcs 的同一条里写 location，值必须是已有地点 id，doing 和目的地要对得上；没移动就省略，不凭空编地点 id。移动要符合这段时间和前因，不瞬移，不强行安排与玩家见面；本场在场或在玩家队里的人不由场外推演移动。
- 各过各的日子：【该过自己日子的人】是代码按多久没写近况轮出来的建议，这次尽量在 npcs 里给他们各写一句近况（不占上面的名额），别的人想写也行，写他自己的生活，不围着玩家转：照他的诉求、秘密、身份和所属势力，接着他上一条近况往下走（工作上的进展或麻烦、和身边人的来往、吵架和好、生病受伤、换住处、攒钱或欠债、迷上什么、碰上城里的动静）。大多是小事，有起有落、不总是顺的；可以和卡上「认识的人」或【人物】里别的人有来往（一起喝酒、闹翻、帮忙、结怨），两边对得上；两个有卡的人这次新认识了、或者关系真的变了，在 ties 里写一条（一次最多 ${OFFSCREEN_TIES} 条，aToB 写 a 眼里的 b，bToA 写 b 眼里的 a，各一句；私下的、外人不该知道的关系 open 写 false），只是照旧来往不写。不写玩家角色，不写他在等玩家、想玩家，也不为了引出委托才写。
- 不改任何状态数值或账目（欧元、人性、伤势、关系深浅、通缉热度；声望只按下面「头条和声望」由代码涨），不改已有委托和期限（新委托只按下面「中间人派单」写）；动静里可以提到没卡的人，但不建新人物。
- 原作人物没到时候的结局不提前写；死在屏幕外见下面「原作人物」。
- 主动联系：【能联系玩家的人】是玩家见过、活着、不在场也不在队里的人，谁发、发不发由你看局面定：交情极深或积怨深重、挂着人情或仇、消息没回、分开后有了新情况、很久没见、宿敌想放句狠话、熟到想说心事，都是说得过去的理由；中间人有生意上的事随时可以发。大多数时候没人发；发的也不一定有正事：可以只是闲聊（问一句在干嘛、吐槽两句、说说他最近碰上的事、顺嘴提一句城里的动静），也可以托事（见下面「熟人托事」）。闲聊照他的性格、口吻、双方交情和近况写：关系近的随意亲近，交恶带刺、记着仇的阴阳怪气或冷淡试探；闲聊消息不写 job。发的话要接着他的近况和理由写，像真的短信；最多 ${MESSAGES_PER_TURN} 条。
- 人物经历：近况（npcs）每写一次就进这个人的经历。【该压成摘要的经历】里列出的人，在 pasts 里把他较早的经历压成一段 ${PAST_MAX} 字以内的摘要（接着旧摘要写，保留和玩家有关的、改变了这个人的事），代码只留最近几条原样的。
- 街头传闻：这次推演里有值得传的事（尤其是新的或升级了的动静、和玩家有关的事），在 rumors 里写 0–${OFFSCREEN_RUMORS} 条街上传的原话。truth 标和真相差多少：true 属实，exaggerated 夸大，garbled 走样；reach 标传多远：street 一条街，district 一个城区（写 district），city 全城。同一件事可以有几种说法；说的是玩家角色的标 player: true，按街上的人看到的写（有人看见、有人添油加醋），不写玩家没做过的大事。
- 新闻快讯：bulletin 写一段 N54 新闻快讯（kind: news）或电台主持词（kind: radio），玩家会在界面的「新闻」里看到原文：公司口径、带一点黑色幽默，引用的是传开的版本（和真相可以不一样），不提只有你知道的幕后、人物的诉求底线秘密、没传开的事。这次写了 major 的动静时必须写；其余时候有值得播的才写，没有就写 null。快讯里确实播了【城里在发酵的事】里某件事已发生的进展，就在 bulletin.threads 里写它的 id（算玩家听说了）；只播 news 的公开说法，不播 text、want、stage 或倒计时。只有开事或延期、没有新进展的，不算播了新消息。
- 头条和声望：major 的动静如果玩家角色是当事人（做下这件事的就是玩家，街上也知道是他），写 player: true，可以再写 cred（small、medium、large，默认 medium）；代码会让街头声望按这个涨一次。不是玩家做的不要标。
- 原作人物：【人物】里标了「原作人物」的人可以死在屏幕外，写进 deaths（一次最多 ${OFFSCREEN_DEATHS} 个）：只在局面真的走到那一步时写（原作里这个人这段时间的命运、城里的动静或势力动向牵连到他、他自己的近况把他推到那里）；【原剧时间线】只是参考，玩家插过手的照玩家改过的走。大多数时候 deaths 是空的。写了死，最好再写一条能让玩家以后听说的动静或传闻；他死了就不要再给他写近况和消息。标了「本场在场」、在玩家队里的人不能写。
- 城里在发酵的事：【城里在发酵的事】是一张单子，势力的打算、宿敌的报复、人物的心事都在上面，每件带一个下次推进的时间。标「已到点」的，这次在 threads 里写一条 thread.step（这一步实际发生了什么、传开后怎么说、days 写下次几天后再推，1–10）；局面不合适就写 thread.defer（days 和一句 why）；事情走到头了写 thread.close（end 写怎么收场，心事收场再写 fate：better、canon、worse，和原作结局比）。没到点的也可以提前推一步。每件一次只写一条。
- 开新事：单子有空位、又有前因时才写 thread.open：kind 写 faction（owner 写势力 id，seed 可以写【势力打算素材】里的种子 id）、nemesis（owner 写宿敌的人物 id）或 concern（owner 写人物 id，seed 写他的心事 id）；want 写他想要什么，stage 写眼下走到哪，days 写第一次几天后推。宿敌刚冒出来时代码会自己开一件，不用再开。
- 素材只是素材：手段可以从「可能的法子」里挑，也可以按局面换、半路改主意、被对头或别的势力截胡；接着上一步写，和【城里的动静】【人物】对得上，原作里有的人和事优先照原作写。宿敌的一步只写他在屏幕外做了什么（打听玩家下落、找玩家在乎的人麻烦、截玩家的单子），不让他亲自和玩家见面；心事的原作结局只是没人插手时的参考，玩家不是 V。
- 地盘：只有势力的事能动地盘，一步最多一个城区（照种子开的只在「能争的城区」里），改的是这个势力或它的对头；不动地盘最常见，真打下来、真丢了才写 turf，不动写 null。
- 中间人派单：【能派单的中间人】里的人这段时间可以主动找玩家派活，一般一次 ${OFFSCREEN_JOBS} 单。活要从已有的东西里长出来：城里的动静、势力动向、委托里的对手、玩家做完事留下的余波、这个中间人自己的近况；没有说得过去的生意就不派。派的话在 jobs 里写这一单，同时在 messages 里由同一个中间人发一条派单消息、job 写这一单的 id（忘了写消息代码会补一条干巴巴的，最好自己写）。按中间人的口风、和玩家的交情与当前局面定这一单的分量（risk 1–5 仅给后台参考，不按声望设星级卡死）；期限晚于现在；location 写【当前状态】【地点】里已有的地点 id，没有就写中文地名或不写，不新建地点；client 是真正的雇主，中间人不肯说就写「身份不明」；twist 约三成不写。没有【能派单的中间人】、也没有人标「可以托事」时 jobs 写空数组。
- 熟人托事：【能联系玩家的人】里标了「可以托事」的人，也可以发消息托玩家办件事，和中间人派单共用这一单的名额：jobs 里这一单不写 fixer，由他本人发的那条消息的 job 写这一单的 id。托的事不一定是真心的：可以是真的求救、谈一笔交易、递一个活，也可以是借口、圈套、拿玩家当枪使、把玩家引到某个地方（交恶怀恨、秘密里有图谋、近况里正走投无路的人更可能这样）。消息、title、client 都照他对玩家说的写（client 写他自称的雇主，一般就是他自己或他要护着的人），真相和他真正的打算写进 twist，只有你知道；真心的托事 twist 可以不写。要接着他的近况、心事、挂着的人情或仇、他的诉求和秘密写，说得过去才托；只是想闲聊的就发闲聊消息，不硬塞委托。`;

const OFFSCREEN_OUTPUT = `【输出格式】
只输出一个 JSON 对象，不要代码块：
{"events": [{"id": "小写英文和连字符", "title": "24 字以内", "body": "160 字以内：发生了什么、谁在动、接下来可能怎样", "district": "城区，可省", "status": "brewing|heating|cooling|over", "weight": "minor|normal|major", "player": "可省：玩家角色是当事人时写 true", "cred": "可省：small|medium|large"}], "npcs": [{"id": "人物 id", "doing": "最近在做什么，一句话，80 字以内", "location": "可省：这段时间去了别处时写现在在的地点 id"}], "pasts": [{"id": "【该压成摘要的经历】里的人物 id", "text": "${PAST_MAX} 字以内的经历摘要"}], "ties": [{"a": "人物 id", "b": "另一个人物 id", "aToB": "a 眼里的 b 是他什么人，一句话", "bToA": "b 眼里的 a 是他什么人，一句话", "open": "可省：私下的、外人不该知道的写 false"}], "rumors": [{"event": "可省：说的是哪条动静的 id", "text": "街上传的原话，80 字以内", "truth": "true|exaggerated|garbled", "reach": "street|district|city", "district": "reach 不是 city 时写城区", "player": "说的是玩家角色时写 true，可省"}], "bulletin": {"kind": "news|radio", "title": "24 字以内", "text": "200 字以内的播报原文", "threads": ["可省：播了的【城里在发酵的事】事项 id"]}, "deaths": [{"id": "原作人物 id", "cause": "80 字以内：怎么死的、谁干的"}], "messages": [{"from": "人物或中间人 id", "text": "消息原文：短、口语", "job": "可省：派单消息写委托 id"}], "jobs": [{"id": "小写英文和连字符，不和已有委托重复", "title": "24 字以内", "kind": "可省：委托类型", "fixer": "中间人派单写【能派单的中间人】里的 id；熟人托事不写", "client": "真正的雇主", "location": "可省：地点 id 或中文地名", "risk": 1, "reward": 1500, "due": "可省：YYYY-MM-DD HH:mm", "conflict": "谁想要什么、谁会受害", "twist": "可省：只有你知道的转折"}], "threads": [{"type": "thread.step", "id": "【城里在发酵的事】里的事项 id", "text": "160 字以内：实际发生了什么，只给主持人看", "news": "80 字以内：传开后的公开说法，不泄露幕后秘密", "stage": "可省：80 字以内的当前阶段", "turf": null, "days": 3}]}
status：brewing 在酝酿，heating 在升级，cooling 在平息，over 结束了。weight：minor 街角小事，normal 几个街区在传，major 上了 N54 头条、迟早找到玩家头上。
threads：三类事情共用这个数组，每件一次只写一个操作；没有要处理的事就输出 []。操作格式：
- 开新事：{"type": "thread.open", "id": "新的小写英文和连字符编号", "kind": "faction|nemesis|concern", "owner": "势力或人物 id", "seed": "素材种子 id，无种子写 null", "title": "24 字以内", "want": "120 字以内的目标", "stage": "80 字以内的当前阶段", "days": 3}。心事必须对应那个人已有的心事种子；同时最多 ${THREADS_MAX} 件，不必填满。
- 推进一步：按上面的 thread.step 格式；不要求已经到点。text 是幕后真相，news 是公开说法，写了 news 不代表玩家已经听说。
- 延期：{"type": "thread.defer", "id": "事项 id", "days": 3, "why": "80 字以内的一句理由"}。
- 收场：{"type": "thread.close", "id": "事项 id", "end": "160 字以内的实际结果", "fate": "心事收场时写 better|canon|worse，其余省略"}。
days 都按游戏日算，写 1–10 的整数，睡觉和等待也算时间。turf 不动地盘时写 null；确有变化时写 {"faction": "势力 id", "district": "一个城区", "change": "gain|lose"}。
calls：重要的人确有需要当面通话的急事时，可以输出 [{"from": "人物或中间人 id", "about": "200 字以内的来意，仅给叙事模型"}]，否则输出 []。最多一通，和 messages 共用本轮 ${MESSAGES_PER_TURN} 条联系额度；同一件事不要既发消息又打电话。普通人物从【能联系玩家的人】里选，是否来电由你按局面决定，不凭数值凑数挑人；中间人必须已有记录，同样不能是已死、本场在场或在队里的人。只提议来电，不替玩家接听、拒接或回应；about 不得写成玩家已经听到的内容。
messages：派单消息附上 job 字段，值为当前状态里已经挂出、尚未接下且未到期的委托 id，或者这次 jobs 里新派的那一单的 id；普通消息不写。不编造 id，不把已接下或已结束的委托当成可接的新单。
jobs：没有【能派单的中间人】、也没有人标「可以托事」就输出空数组；有也大多空着，只在确实有生意、或这个人确实有事要托玩家（真心的、别有用心的都算）时写。熟人托事的单不写 fixer。due 晚于【当前状态】的时间。

例：{"events": [{"id": "tyger-claws-kabuki", "title": "虎爪帮在歌舞伎区收紧地盘", "body": "那间夜店被砸以后，虎爪帮把歌舞伎区几条街的保护费翻了倍，正在挨家打听是谁干的。", "district": "沃森", "status": "heating", "weight": "normal"}], "npcs": [], "messages": []}
玩家只是在公寓睡了一觉、正文没提城里任何事、【城里在发酵的事】里也没有到点的时：{"events": [], "npcs": [], "pasts": [], "ties": [], "rumors": [], "bulletin": null, "deaths": [], "messages": [], "jobs": [], "threads": []}
不要写没有前因的大事：玩家在街边吃了碗面，就写「荒坂塔遇袭」，这是凭空制造戏剧性。`;

export const OFFSCREEN_SYSTEM = [BOOKKEEPING_BASE, OFFSCREEN_STAGE, OFFSCREEN_OUTPUT].join("\n\n");

/**
 * 卡上「认识的人」（用户 2026-10-31："npc也有自己的生活，也有认识的npc"）：
 * 过自己的日子时可以和这些人来往；私下的关系标出来，模型知道但外人不知道
 */
function tiesPart(n: Npc, all: Readonly<Record<string, Npc>>): string | undefined {
  const known = n.ties
    .map((t) => ({ t, other: all[t.id] }))
    .filter((x): x is { t: (typeof n.ties)[number]; other: Npc } => x.other !== undefined)
    .map(
      ({ t, other }) =>
        `${other.name}（${other.id}${other.alive ? "" : "，已死"}）：${t.text}${t.open ? "" : "（私下的，外人不知道）"}`,
    );
  return known.length > 0 ? `认识的人：${known.join("；")}` : undefined;
}

function card(n: Npc, here: boolean, all: Readonly<Record<string, Npc>> = {}): string {
  const ties = tiesPart(n, all);
  const parts = [
    `${n.id}｜${n.name}，${n.role}${n.canon ? "（原作人物）" : ""}`,
    // 所属势力（用户 2026-10-31："感觉是为了我才存在的"）：过自己的日子时照他是哪家的人写
    `势力：${n.faction === NO_FACTION ? NO_FACTION_LABEL : n.faction}`,
    `想要：${n.want}`,
    `底线：${n.limit}`,
  ];
  if (n.secret) parts.push(`秘密：${n.secret}`);
  parts.push(`当前地点：${n.location ?? "未知"}`);
  if (n.home) parts.push(`常驻地点：${n.home}（不代表现在在那里）`);
  if (n.past) parts.push(`更早的经历：${n.past.text}`);
  const earlier = n.timeline.slice(-4, -1);
  if (earlier.length > 0) {
    parts.push(`经历：${earlier.map((t) => `${t.text}（${formatGameTime(t.at)}）`).join("；")}`);
  }
  if (n.doing) parts.push(`最近：${n.doing.text}（${formatGameTime(n.doing.at)}）`);
  if (ties) parts.push(ties);
  parts.push(n.met ? `态度：${attitudeLabel(n)}` : "玩家还没见过");
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
  const lives = lifePicks(world, present);
  const lifeIds = new Set(lives.map((n) => n.id));
  const roster = NpcStateSchema.parse(world.slices.npc).npcs;
  // 该过自己日子的人一定带卡，其余按最近出场补满
  const npcs = [
    ...lives,
    ...Object.values(roster)
      .filter((n) => n.alive && !lifeIds.has(n.id))
      .sort((a, b) => (b.lastSeenAt ?? -1) - (a.lastSeenAt ?? -1))
      .slice(0, Math.max(0, MAX_CARDS - lives.length)),
  ];
  const dispatch = offscreenFixers(world, present);
  // 三类事情共用一张单子；期限只给主持人看，不进玩家视图（用户 2026-11-01 定的"全改"第 4 步）
  const threads = ThreadsStateSchema.parse(world.slices.threads ?? {});
  const due = [
    `当前 ${threads.threads.length}/${THREADS_MAX} 件；有空位且有前因才开新事，不必填满。`,
    threadSection(threads),
    ...threads.threads.map(
      (t) =>
        `- ${t.id}｜主人：${t.owner}｜种子：${t.seed ?? "无"}｜下次推进：${formatGameTime(t.dueAt)}（${t.dueAt <= world.time ? "已到点" : "还没到点"}${t.reminded ? "，上次推演未处理" : ""}）`,
    ),
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n");
  const rumors = rumorSection(city);
  const canAsk = offscreenJobsOpen(world);
  const templates =
    dispatch.length > 0 || (canAsk && contactable(world, present).length > 0)
      ? jobTemplateSection(extras.data ?? {})
      : undefined;
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
      `【人物】\n${npcs.length > 0 ? npcs.map((n) => card(n, present.has(n.id), roster)).join("\n") : "（还没有）"}`,
      // 中间人不再单列一节（用户 2026-11-02："都是npc"）：他们照普通人物进【人物】和【能联系玩家的人】，派单另看【能派单的中间人】
      ...(dispatch.length > 0
        ? [
            `【能派单的中间人】（这次最多派 ${OFFSCREEN_JOBS} 单）\n${dispatch.map((f) => `- ${f.id}｜${f.name}`).join("\n")}`,
            ...(templates ? [templates] : []),
          ]
        : []),
      `【城里的动静】\n${citySection(city) ?? "（还没有记下的）"}`,
      ...(rumors ? [`【街头传闻】\n${rumors}`] : []),
      `【能联系玩家的人】（谁发、发不发由你看局面定）\n${
        contactable(world, present)
          .map(
            (n) => `- ${n.id}｜${n.name}：态度「${attitudeLabel(n)}」${canAsk ? "；可以托事" : ""}`,
          )
          .join("\n") || "（这次没有：人物不发消息，【能派单的中间人】派单照常可以发）"
      }`,
      ...(lives.length > 0
        ? [
            `【该过自己日子的人】（这次每人写一句近况，写他自己的生活，不围着玩家转）\n${lives
              .map((n) => {
                // 过日子可以牵上认识的人（用户 2026-10-31："npc也有自己的生活，也有认识的npc"）
                const ties = tiesPart(n, roster);
                return `- ${n.id}｜${n.name}：${n.doing ? `上一条近况：${n.doing.text}（${formatGameTime(n.doing.at)}）` : "还没写过近况"}${ties ? `；${ties}` : ""}`;
              })
              .join("\n")}`,
          ]
        : []),
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
      `【城里在发酵的事】\n${due}`,
      // 旧种子保留为素材，不再让代码抽签决定谁动（用户 2026-11-01 定的"全改"第 4 步）
      `【势力打算素材】（不是已经发生的事；有前因且单子有空位才考虑开新事）\n${
        [...agendaCatalog(extras.data ?? {}).values()]
          .map(
            (s) =>
              `- 种子：${s.id}｜主人：${s.faction}｜${s.title}｜想要：${s.goal}｜可能的法子：${s.means.join("；")}｜能争的城区：${s.districts.join("、") || "不争地盘"}｜对头：${s.rivals.join("、") || "无"}｜原作参考：${s.canon.join("；") || "无"}`,
          )
          .join("\n") || "（没有）"
      }`,
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

// 新单子的场外输出只接受开事、推进、延期和收场，不接受任意内部指令
// （用户 2026-11-01 定的"全改"第 4 步：模型当主持人，代码只管记账）
const OffscreenThreadSchema = z.discriminatedUnion("type", [
  ThreadOpenSchema,
  ThreadStepCommandSchema,
  ThreadDeferSchema,
  ThreadCloseSchema,
]);

const OffscreenNpcSchema = z.object({
  id: z.string().trim().min(1),
  doing: z.string().trim().min(1).max(80),
  // 场外换地点不算和玩家见面，不更新 met 和 lastSeenAt；地点是否存在由 readOffscreen 核对
  location: z.string().trim().min(1).optional(),
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
// 快讯关联统一单子的事项；宿敌和心事不再各用一种场外输出格式
// （用户 2026-11-01 定的"全改"第 4 步：模型当主持人，代码只管记账）
const OffscreenBulletinSchema = BulletinFieldsSchema.extend({
  threads: z.array(z.string().trim().min(1)).max(THREADS_MAX).optional(),
});
const OffscreenDeathSchema = z.object({
  id: z.string().trim().min(1),
  cause: z.string().trim().min(1).max(80),
});
/** 场外推演写的人物关系；指令类型由代码补上（用户 2026-10-31："npc也有自己的生活，也有认识的npc"） */
const OffscreenTieSchema = TieSchema.omit({ type: true });

export interface OffscreenResult {
  readonly commands: Command[];
  /** 丢掉、降级的原因；只进剧透视图 */
  readonly notes: string[];
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
  const json = parseModelJson(text);
  if (
    !json.ok ||
    typeof json.value !== "object" ||
    json.value === null ||
    Array.isArray(json.value)
  ) {
    notes.push(`场外推演的结果读不了${json.ok ? "" : `：${json.error}`}，这次不推演`);
    return { commands, notes };
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
    if (kept >= soft(OFFSCREEN_EVENTS)) {
      notes.push(`场外推演：动静写了 ${soft(OFFSCREEN_EVENTS)} 条以上，后面的不收`);
      break;
    }
    kept += 1;
    if (kept === OFFSCREEN_EVENTS + 1)
      notes.push(`场外推演：动静超过建议的 ${OFFSCREEN_EVENTS} 条，照收`);
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

  // 【该过自己日子的人】的近况不占 OFFSCREEN_NPCS 的名额（用户 2026-10-31："感觉是为了我才存在的"）
  // 换地点时同时核对内容表和存档里新增的地点，不只认开局地点
  const places = locationCatalog(withSavedPlaces(opts.data ?? {}, world));
  const lives = new Map(lifePicks(world, opts.present).map((n) => [n.id, n]));
  const lived = new Set<string>();
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
    if (lived.has(npc.id)) {
      notes.push(`场外推演：${npc.name}的近况一次只写一句，多的不要`);
      continue;
    }
    if (lives.has(npc.id)) {
      lived.add(npc.id);
    } else if (updated >= soft(OFFSCREEN_NPCS)) {
      notes.push(`场外推演：人物近况写了 ${soft(OFFSCREEN_NPCS)} 个以上，后面的不收`);
      continue;
    } else {
      updated += 1;
      if (updated === OFFSCREEN_NPCS + 1)
        notes.push(`场外推演：人物近况超过建议的 ${OFFSCREEN_NPCS} 个，照收`);
    }
    // NPC 会移动（用户 2026-11-02："npc是能移动的"）：地点 id 在地点表里才挪，不在的只去掉地点，近况照收
    let location = parsed.data.location;
    if (location !== undefined && !places.has(location)) {
      notes.push(`场外推演：${npc.name}去的 ${location} 不在地点表里，近况照收，位置不动`);
      location = undefined;
    }
    commands.push({
      type: "doing",
      id: npc.id,
      text: parsed.data.doing,
      ...(location === undefined ? {} : { location }),
    });
  }
  // 【该过自己日子的人】只是建议（「全改」第 2 步），没写不算错，记一笔给剧透视图
  for (const n of lives.values()) {
    if (!lived.has(n.id)) notes.push(`场外推演：建议${n.name}过自己的日子，这次没写`);
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
    if (rumored >= soft(OFFSCREEN_RUMORS)) {
      notes.push(`场外推演：传闻写了 ${soft(OFFSCREEN_RUMORS)} 条以上，后面的不收`);
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

  // 人物之间的关系（用户 2026-10-31："npc也有自己的生活，也有认识的npc"）：
  // 两边都要有卡、不是同一个人、不能两个都死了（算上这次刚死的），同一对人一次只写一条
  const gone = (n: Npc) => !n.alive || died.has(n.id);
  const pairs = new Set<string>();
  for (const [i, item] of list("ties").entries()) {
    const parsed = OffscreenTieSchema.safeParse(item);
    if (!parsed.success) {
      notes.push(`场外推演：ties[${i}] 格式不对：${issue(parsed.error)}`);
      continue;
    }
    const { a, b } = parsed.data;
    const left = npcs[a];
    const right = npcs[b];
    const pair = a < b ? `${a}|${b}` : `${b}|${a}`;
    const problem =
      a === b
        ? "a 和 b 是同一个人"
        : !left || !right
          ? "有人不在人物卡里"
          : gone(left) && gone(right)
            ? "两个人都死了"
            : pairs.has(pair)
              ? "同一对人一次只写一条"
              : undefined;
    if (problem) {
      notes.push(`场外推演：ties[${i}] ${a}/${b} ${problem}，不要`);
      continue;
    }
    if (pairs.size >= soft(OFFSCREEN_TIES)) {
      notes.push(`场外推演：人物之间的关系写了 ${soft(OFFSCREEN_TIES)} 条以上，后面的不收`);
      break;
    }
    pairs.add(pair);
    commands.push({ type: "tie", ...parsed.data });
  }

  // 中间人派单（用户定的，2026-10-30：委托接到场外推演里）：先挑出能派的单，要等同一个中间人的派单消息带上才算；
  // 不写 fixer 的是熟人托事（用户定的，2026-10-30："npc发消息也接入"），要等【能联系玩家的人】里的人本人发消息带上；
  // 托的事真假都行，真相写在 twist 里，玩家看不到（用户定的，2026-10-30："不一定是真的求助信息啊"）
  const jobsOpen = offscreenJobsOpen(world);
  const dispatch = new Map(offscreenFixers(world, opts.present).map((f) => [f.id, f]));
  const existing = new Set(JobsStateSchema.parse(world.slices.jobs).jobs.map((j) => j.id));
  const offers = new Map<
    string,
    { fixer: string | null; risk: number; title: string; command: Command }
  >();
  for (const [i, item] of list("jobs").entries()) {
    const parsed = JobOfferSchema.omit({ type: true }).safeParse(item);
    if (!parsed.success) {
      notes.push(`场外推演：jobs[${i}] 格式不对：${issue(parsed.error)}`);
      continue;
    }
    // 托事人只由代码按发消息的人填，模型写的不算（用户 2026-10-31 选的「托事影响好感」）
    const { asker: _asker, ...job } = parsed.data;
    const fixer = job.fixer === undefined ? undefined : dispatch.get(job.fixer);
    const problem = !jobsOpen
      ? "这次不能派新单（挂着没接的委托已经够多）"
      : existing.has(job.id) || offers.has(job.id)
        ? "编号和已有委托重复"
        : job.fixer !== undefined && !fixer
          ? "派单的人不在【能派单的中间人】里"
          : fixer && died.has(fixer.id)
            ? "派单的人这次死了"
            : job.due !== undefined && job.due <= world.time
              ? "期限不晚于现在"
              : undefined;
    if (problem) {
      notes.push(`场外推演：jobs[${i}]「${job.title}」${problem}，不要`);
      continue;
    }
    if (offers.size >= soft(OFFSCREEN_JOBS)) {
      notes.push(`场外推演：派单和求助写了 ${soft(OFFSCREEN_JOBS)} 单以上，后面的不收`);
      break;
    }
    offers.set(job.id, {
      fixer: fixer?.id ?? null,
      risk: job.risk,
      title: job.title,
      command: { type: "jobOffer", ...job },
    });
  }

  const picked = new Set(contactable(world, opts.present).map((n) => n.id));
  const budget = Math.max(0, opts.messages ?? MESSAGES_PER_TURN);
  let sent = 0;
  /** 新委托要排在带它的派单消息前面：消息结算时要查得到这一单 */
  const offerAt = commands.length;
  const delivered = new Set<string>();
  for (const [i, item] of list("messages").entries()) {
    const parsed = IncomingMessageSchema.safeParse(item);
    if (!parsed.success) {
      notes.push(`场外推演：messages[${i}] 格式不对：${issue(parsed.error)}`);
      continue;
    }
    const npc = npcs[parsed.data.from];
    const fixer = fixers[parsed.data.from] !== undefined;
    // 不再打分挑人；中间人也不能绕过死亡、在场和队伍检查（用户 2026-11-01 定的"全改"第 4 步）
    const from = parsed.data.from;
    if (
      (!fixer && !picked.has(from)) ||
      npc?.alive === false ||
      died.has(from) ||
      opts.present?.has(from) ||
      squad.has(from)
    ) {
      notes.push(`场外推演：messages[${i}] 的 ${from} 不符合主动联系条件`);
      continue;
    }
    if (sent >= budget) {
      notes.push(`场外推演：消息连同本轮正文每轮最多 ${MESSAGES_PER_TURN} 条，多的不要`);
      break;
    }
    let job = parsed.data.job;
    const offer = job === undefined ? undefined : offers.get(job);
    // 熟人托事：不是中间人的人本人发；真心的、别有用心的都走这里。星级超了压到他的上限（「全改」第 2 步）
    if (offer && offer.fixer !== null && offer.fixer !== parsed.data.from) {
      notes.push(`场外推演：新委托「${offer.title}」不是 ${parsed.data.from} 派的，消息去掉委托`);
      job = undefined;
    } else if (offer && offer.fixer === null && fixer && !picked.has(parsed.data.from)) {
      // 中间人也是普通人物（用户 2026-11-02："都是npc"）：见过、在联系名单里的中间人可以本人托事；没见过的只能派单
      notes.push(`场外推演：求助「${offer.title}」要由托事的人本人发，中间人不能带，消息去掉委托`);
      job = undefined;
    } else if (offer && job !== undefined) {
      delivered.add(job);
      if (offer.fixer === null) {
        // 托事人就是发这条消息的人，结束时按结局改他的好感（用户 2026-10-31 选的「托事影响好感」）
        offer.command = {
          ...offer.command,
          asker: parsed.data.from,
        };
      }
    }
    sent += 1;
    commands.push({
      type: "phone.receive",
      from: parsed.data.from,
      text: parsed.data.text,
      ...(job === undefined ? {} : { job }),
    });
  }
  // 没有消息带上的单（「全改」第 2 步）：中间人派的由代码补一条派单消息；熟人托事不知道是谁托的，还是不要
  const sending: Command[] = [];
  for (const [id, offer] of offers) {
    if (delivered.has(id)) {
      sending.push(offer.command);
      continue;
    }
    if (offer.fixer === null) {
      notes.push(`场外推演：求助「${offer.title}」没有托事的人发消息带上，不要`);
      continue;
    }
    if (sent >= budget) {
      notes.push(`场外推演：新委托「${offer.title}」没有派单消息，这一轮的消息也满了，不要`);
      continue;
    }
    sending.push(offer.command);
    commands.push({
      type: "phone.receive",
      from: offer.fixer,
      text: `有个活：${offer.title}。有兴趣就回我。`,
      job: id,
    });
    sent += 1;
    notes.push(`场外推演：新委托「${offer.title}」没有派单消息，代码补了一条`);
  }
  commands.splice(offerAt, 0, ...sending);

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
    // 来电和消息用同一个联系范围（用户 2026-11-01 定的"全改"第 4 步）
    if (
      (!fixer && !picked.has(from)) ||
      npc?.alive === false ||
      died.has(from) ||
      opts.present?.has(from) ||
      squad.has(from)
    ) {
      notes.push(`场外推演：calls[${i}] 来电者不符合主动联系条件`);
      continue;
    }
    commands.push({ type: "phone.call", ...parsed.data });
    sent += 1;
    break;
  }

  // 三类事情统一解析；限制操作总量，实际主人和状态由系统结算再次核对
  // （用户 2026-11-01 定的"全改"第 4 步：模型当主持人，代码只管记账）
  const threads = ThreadsStateSchema.parse(world.slices.threads ?? {});
  const owners = new Map(
    threads.threads.map((t) => [t.id, { owner: t.owner, kind: t.kind }] as const),
  );
  const wrote = new Set<string>();
  const operations = list("threads");
  const limit = THREADS_MAX * 3;
  if (operations.length > limit) notes.push(`场外推演：事项操作超过 ${limit} 条，后面的不收`);
  for (const [i, item] of operations.slice(0, limit).entries()) {
    const parsed = OffscreenThreadSchema.safeParse(item);
    if (!parsed.success) {
      notes.push(`场外推演：threads[${i}] 格式不对：${issue(parsed.error)}`);
      continue;
    }
    const op = parsed.data;
    if (wrote.has(op.id)) {
      notes.push(`场外推演：threads[${i}] ${op.id} 一次只写一步，多的不要`);
      continue;
    }
    if (op.type === "thread.open") {
      const problem = owners.has(op.id)
        ? "已经在单子上了"
        : owners.size >= THREADS_MAX
          ? `单子上同时最多 ${THREADS_MAX} 件`
          : op.kind !== "faction" && died.has(op.owner)
            ? "主人这次死了"
            : undefined;
      if (problem) {
        notes.push(`场外推演：threads[${i}] 开 ${op.id} ${problem}，不要`);
        continue;
      }
      owners.set(op.id, { owner: op.owner, kind: op.kind });
      wrote.add(op.id);
      commands.push(op);
      continue;
    }
    const target = owners.get(op.id);
    if (!target) {
      notes.push(`场外推演：threads[${i}] ${op.id} 不在单子上，不要`);
      continue;
    }
    if (op.type === "thread.step" && target.kind !== "faction" && died.has(target.owner)) {
      notes.push(`场外推演：threads[${i}] ${op.id} 的主人这次死了，不再往前推`);
      continue;
    }
    wrote.add(op.id);
    commands.push(op);
  }

  // 宿敌的场外动作改走统一的 threads 输出，不再单独读取 nemeses 数组
  // （用户 2026-11-01 定的"全改"第 4 步：模型当主持人，代码只管记账）

  // 心事也改走 threads，由线程结算同步心事账，不再单独读取 arcs 数组
  // （用户 2026-11-01 定的"全改"第 4 步：模型当主持人，代码只管记账）

  const rawBulletin = raw.bulletin;
  if (rawBulletin !== undefined && rawBulletin !== null) {
    const parsed = OffscreenBulletinSchema.safeParse(rawBulletin);
    if (!parsed.success) {
      notes.push(`场外推演：bulletin 格式不对：${issue(parsed.error)}`);
    } else {
      const { threads: aired, ...bulletin } = parsed.data;
      commands.push({ type: "city.bulletin", ...bulletin });
      const known = [...threads.threads, ...threads.closed];
      for (const id of new Set(aired ?? [])) {
        const t = known.find((x) => x.id === id);
        if (!t && !owners.has(id)) {
          notes.push(`场外推演：快讯里的 ${id} 不在【城里在发酵的事】里`);
          continue;
        }
        // 这次刚写了一步，或者还有玩家没听说的几步，才算播了新东西
        const fresh = wrote.has(id) || (t?.steps.some((s) => !s.told) ?? false);
        if (!fresh) {
          notes.push(`场外推演：快讯里的 ${id} 没有玩家还没听说的事`);
          continue;
        }
        commands.push({ type: "threadTold", id });
      }
    }
  } else if (majorWritten) {
    notes.push("场外推演：这次写了头条却没写新闻快讯");
  }
  commands.push(...credits);
  return { commands, notes };
}
