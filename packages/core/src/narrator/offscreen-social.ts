import { z } from "zod";
import type { LlmMessage } from "../kernel/ports";
import type { Command } from "../kernel/system";
import type { LogRecord } from "../kernel/turnlog";
import type { WorldState } from "../kernel/world";
import { CityStateSchema, OFFSCREEN_DEATHS } from "../systems/city";
import { JobOfferSchema, JobsStateSchema } from "../systems/jobs";
import {
  NO_FACTION,
  NO_FACTION_LABEL,
  type Npc,
  NpcStateSchema,
  PAST_MAX,
  relationBrief,
  TIMELINE_SQUASH,
  TieSchema,
} from "../systems/npc";
import {
  CallCommandSchema,
  hasContactChannel,
  IncomingMessageSchema,
  MESSAGES_PER_TURN,
  PhoneStateSchema,
} from "../systems/phone";
import { ThreadsStateSchema } from "../systems/threads";
import {
  formatGameTime,
  locationCatalog,
  WorldClockStateSchema,
  withSavedPlaces,
} from "../systems/world";
import { parseModelJson } from "./block";
import type { OffscreenParseResult } from "./offscreen-macro";
import {
  fitOffscreenBatch,
  type OffscreenBatch,
  type OffscreenCapacity,
  type OffscreenPromptScope,
  pendingTurns,
} from "./offscreen-trigger";
import { type PromptExtras, stateSummary } from "./prompts/context";
import { BOOKKEEPING_BASE, userMessage } from "./prompts/layers";

/** 一次最多更新几个非轮换人物的近况 */
export const OFFSCREEN_NPCS = 4;
/** 每次推演轮换让这么多人过一段自己的日子 */
export const OFFSCREEN_LIVES = 2;
/** 每次推演建议新记或更新几条人物间关系 */
export const OFFSCREEN_TIES = 2;
/** 每次推演中间人派单 / 熟人托事的建议单数与未接上限 */
export const OFFSCREEN_JOBS = 1;
export const OFFERED_CAP = 3;

const EXTRA_CARDS = 4;
const SOFT_CAP = 3;
const soft = (n: number) => n * SOFT_CAP;

export interface OffscreenFixer {
  readonly id: string;
  readonly name: string;
}

/** 熟人联系范围：见过、活着、已互留联系方式、不在场也不正与玩家同行 */
export function contactable(world: WorldState, present: ReadonlySet<string> = new Set()): Npc[] {
  const npcs = NpcStateSchema.parse(world.slices.npc).npcs;
  const phone = PhoneStateSchema.parse(world.slices.phone ?? {});
  return Object.values(npcs).filter(
    (n) => n.alive && n.met && hasContactChannel(phone, n.id) && !present.has(n.id) && !n.following,
  );
}

/** 该过自己日子的人：活着、不在场、非同行；见过的优先，最久没更新近况的优先 */
export function lifePicks(world: WorldState, present: ReadonlySet<string> = new Set()): Npc[] {
  return Object.values(NpcStateSchema.parse(world.slices.npc).npcs)
    .filter((n) => n.alive && !present.has(n.id) && !n.following)
    .sort(
      (a, b) =>
        Number(b.met) - Number(a.met) ||
        (a.doing?.at ?? -1) - (b.doing?.at ?? -1) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )
    .slice(0, OFFSCREEN_LIVES);
}

/** 挂着没接且未过期的委托不到 OFFERED_CAP 单时才允许派新单 */
export function offscreenJobsOpen(world: WorldState): boolean {
  const offered = JobsStateSchema.parse(world.slices.jobs).jobs.filter(
    (j) => j.status === "offered" && (j.due === null || j.due > world.time),
  ).length;
  return offered < OFFERED_CAP;
}

export function offscreenFixers(
  world: WorldState,
  present: ReadonlySet<string> = new Set(),
): OffscreenFixer[] {
  if (!offscreenJobsOpen(world)) return [];
  const jobs = JobsStateSchema.parse(world.slices.jobs);
  const npcs = NpcStateSchema.parse(world.slices.npc).npcs;
  return Object.values(jobs.fixers)
    .filter((f) => npcs[f.id]?.alive !== false && !present.has(f.id) && !npcs[f.id]?.following)
    .map((f) => ({ id: f.id, name: f.name }));
}

const SocialNpcSchema = z.object({
  id: z.string().trim().min(1),
  doing: z.string().trim().min(1).max(120),
  location: z.string().trim().min(1).nullable().optional(),
});

const SocialPastSchema = z.object({
  id: z.string().trim().min(1),
  text: z.string().trim().min(1).max(PAST_MAX),
});

const SocialTieSchema = TieSchema.omit({ type: true });

const SocialDeathSchema = z.object({
  id: z.string().trim().min(1),
  cause: z.string().trim().min(1).max(120),
  rumor: z.string().trim().min(1).max(120).nullable().optional(),
});

const SocialMessageSchema = z.object({
  from: z.string().trim().min(1),
  text: z.string().trim().min(1).max(300),
  job: z.string().trim().min(1).nullable().optional(),
});

const SocialCallSchema = CallCommandSchema.omit({ type: true });

const SocialJobSchema = z.object({
  id: z.string().trim().min(1),
  title: z.string().trim().min(1).max(24),
  kind: z
    .enum([
      "escort",
      "assassinate",
      "abduct",
      "steal",
      "sabotage",
      "investigate",
      "negotiate",
      "deliver",
    ])
    .nullable()
    .optional(),
  fixer: z.string().trim().min(1).nullable().optional(),
  client: z.string().trim().min(1),
  location: z.string().trim().min(1).nullable().optional(),
  risk: z.number().int().min(1).max(5),
  reward: z.number().int().min(0),
  due: z.string().trim().min(1).nullable().optional(),
  conflict: z.string().trim().min(1),
  twist: z.string().trim().min(1).nullable().optional(),
});

export const SocialOffscreenDocSchema = z.object({
  npcs: z.array(SocialNpcSchema),
  pasts: z.array(SocialPastSchema).optional(),
  ties: z.array(SocialTieSchema).optional(),
  deaths: z.array(SocialDeathSchema).optional(),
  jobs: z.array(SocialJobSchema).optional(),
  messages: z.array(SocialMessageSchema),
  calls: z.array(SocialCallSchema).optional(),
});

const SOCIAL_STAGE = `【这一步：人物生活与社交推演】
你只负责推演玩家视线之外的有卡人物如何过自己的日子、彼此结交或生隙、主动联系玩家，以及中间人派单或熟人托事；宏观势力地盘、媒体新闻和商家封路由另一独立通道负责，本步不写城中新闻或地盘账。
- 【上次成功推演后的正文】是尚未处理的新事实，当前状态是本轮结算后的事实。不写玩家做了什么、说了什么、想了什么，不建新人物，不改已有委托账或数值。
- 各过各的日子：【该过自己日子的人】是按最久未更新轮出来的建议，尽量在 npcs 里给他们各写一句真实的生活近况（不占 ${OFFSCREEN_NPCS} 个名额），本批新牵涉的人物也可更新。照他的诉求、秘密、身份和势力接着上一条近况往下走（谋生进展或麻烦、和身边人来往、吵架和好、生病受伤、换住处、攒钱欠债、撞上城里的风波）。大多是具体小事，有起有落；不围着玩家转，不写他在等玩家、想玩家。
- 人物移动：中间人也是普通人物，可以离开办公室或常驻地点；确实去了别处时在 npcs 里写 location，必须是【地点索引】里已有的地点 id，且与 doing 一致；没移动就省略或写 null。本场在场或正与玩家同行的人不写近况也不移动。
- 人物关系网（ties）：两个有卡的人新结识或关系发生真实变化时写一条（一般最多 ${OFFSCREEN_TIES} 条，aToB 写 a 眼里的 b，bToA 写 b 眼里的 a；外人不该知道的私下关系 open 写 false），照旧来往不写。
- 经历压缩（pasts）：【该压成摘要的经历】里列出的人，把他较早经历压成 ${PAST_MAX} 字以内的摘要（接着旧摘要写，保留与玩家有关或改变他的事）。
- 原作人物场外命运（deaths）：【人物】里标了「原作人物」且不在场、非同行的人，仅在局面确实走到绝境时才可写进 deaths（一次最多 ${OFFSCREEN_DEATHS} 个）；大多数时候留空 []。写了死亡可顺带写一句 rumor，让外界有机会传出风声；已死之人不再写近况或发消息。
- 主动联系（messages / calls）：【能联系玩家的人】里谁发、发不发由你看局面定（交情深、积怨、挂着人情/仇、消息未回、分开后有新情况、中间人谈生意）。大多数时候没人发；发的可以是纯闲聊（吐槽、问近况、提一句街上的风声，口吻符合性格与交情），也可以托事或派单。messages 与 calls 合用本轮最多 ${MESSAGES_PER_TURN} 条额度（calls 最多 1 通，仅急需语音通话时发，且不要和同一件事的短信重复）。
- 中间人派单与熟人托事（jobs，建议最多 ${OFFSCREEN_JOBS} 单）：从城中风波、人物近况或余波里自然长出，无合适生意就输出 []。中间人派单填 fixer（【能派单的中间人】里的 id）；熟人托事（【能联系玩家的人】里标「可以托事」者）不写 fixer，且托事不一定是真心的（可能是求助、交易，也可能是借口、圈套或拿玩家当枪使，真相写进 twist）。派单或托事必须配同一人发的带 job 字段的短信。`;

const SOCIAL_OUTPUT = `【输出格式】
只输出一个 JSON 对象，不要代码块。npcs 与 messages 必须给出数组（无变化写 []）：
{"npcs":[{"id":"人物id","doing":"一句话近况（80字以内）","location":"可选已有地点id或null"}],"pasts":[{"id":"人物id","text":"${PAST_MAX}字以内经历摘要"}],"ties":[{"a":"人物id","b":"人物id","aToB":"一句话","bToA":"一句话","open":true}],"deaths":[{"id":"原作人物id","cause":"80字以内死因","rumor":"可选：80字以内外界传闻"}],"jobs":[{"id":"小写英文连字符","title":"24字以内","kind":"escort|assassinate|abduct|steal|sabotage|investigate|negotiate|deliver或null","fixer":"中间人id或null","client":"雇主","location":"地点id或中文地名或null","risk":1,"reward":1500,"due":"YYYY-MM-DD HH:mm或null","conflict":"核心冲突","twist":"可选幕后真相或null"}],"messages":[{"from":"人物或中间人id","text":"口语短信原文","job":"派单/托事写委托id，闲聊写null"}],"calls":[{"from":"人物或中间人id","about":"200字以内来意，只给叙事模型"}]}`;

export const SOCIAL_OFFSCREEN_SYSTEM = [BOOKKEEPING_BASE, SOCIAL_STAGE, SOCIAL_OUTPUT].join("\n\n");

function tiesPart(n: Npc, all: Readonly<Record<string, Npc>>): string | undefined {
  const known = n.ties
    .map((t) => ({ t, other: all[t.id] }))
    .filter((x): x is { t: (typeof n.ties)[number]; other: Npc } => x.other !== undefined)
    .map(
      ({ t, other }) =>
        `${other.name}（${other.id}${other.alive ? "" : "，已死"}）：${t.text}${t.open ? "" : "（私下，外人不知道）"}`,
    );
  return known.length > 0 ? `认识的人：${known.join("；")}` : undefined;
}

function card(n: Npc, here: boolean, all: Readonly<Record<string, Npc>>): string {
  const ties = tiesPart(n, all);
  const parts = [
    `${n.id}｜${n.name}，${n.role}${n.canon ? "（原作人物）" : ""}${n.alive ? "" : "（已死）"}`,
    `势力：${n.faction === NO_FACTION ? NO_FACTION_LABEL : n.faction}`,
    `想要：${n.want}`,
    `底线：${n.limit}`,
    `口吻：${n.voice}`,
  ];
  if (n.bio) parts.push(`背景：${n.bio}`);
  if (n.secret) parts.push(`秘密：${n.secret}`);
  parts.push(`当前地点：${n.location ?? "未知"}`);
  if (n.home) parts.push(`常驻地点：${n.home}（不代表现在在那里）`);
  if (n.past) parts.push(`更早经历：${n.past.text}`);
  const earlier = n.timeline.slice(-4, -1);
  if (earlier.length > 0) {
    parts.push(`经历：${earlier.map((t) => `${t.text}（${formatGameTime(t.at)}）`).join("；")}`);
  }
  if (n.doing) parts.push(`最近：${n.doing.text}（${formatGameTime(n.doing.at)}）`);
  if (ties) parts.push(ties);
  parts.push(n.met ? `与玩家关系：${relationBrief(n)}` : "玩家还没见过");
  if (here) parts.push("本场在场");
  const shared = n.memories.slice(-3);
  if (shared.length > 0) parts.push(`和玩家：${shared.join("；")}`);
  return `- ${parts.join("；")}`;
}

export function buildSocialOffscreenPrompt(
  world: WorldState,
  records: readonly LogRecord[],
  extras: PromptExtras,
  narrative: string,
  present: ReadonlySet<string> = new Set(),
  scope?: OffscreenPromptScope,
): LlmMessage[] {
  const city = CityStateSchema.parse(world.slices.city ?? {});
  const cursor = city.social;
  const clock = WorldClockStateSchema.parse(world.slices.world);
  const lives = scope?.backlog ? [] : lifePicks(world, present);
  const roster = NpcStateSchema.parse(world.slices.npc).npcs;
  const threads = ThreadsStateSchema.parse(world.slices.threads ?? {});
  const pending = pendingTurns(world, records, cursor.processedThrough).filter(
    (record) => scope === undefined || record.seq <= scope.through,
  );
  const jobs = JobsStateSchema.parse(world.slices.jobs).jobs.filter(
    (j) =>
      ["active", "offered", "expired"].includes(j.status) ||
      (j.closedAt !== null && (cursor.lastAt === null || j.closedAt >= cursor.lastAt)),
  );
  const changes = [
    narrative,
    ...pending.map((r) => `${r.text}\n${JSON.stringify(r.commands)}`),
    ...jobs.map((j) => `${j.fixer ?? ""} ${j.asker ?? ""} ${j.client} ${j.conflict}`),
  ].join("\n");

  const required = new Set(lives.map((n) => n.id));
  const mentionedIds = new Set(changes.match(/[a-zA-Z0-9][a-zA-Z0-9:_-]*/g) ?? []);
  for (const n of Object.values(roster)) {
    if (mentionedIds.has(n.id) || changes.includes(n.name)) required.add(n.id);
  }
  for (const id of [...required]) {
    for (const tie of roster[id]?.ties ?? []) if (roster[tie.id]) required.add(tie.id);
  }
  const npcs = [
    ...Object.values(roster).filter((n) => required.has(n.id)),
    ...Object.values(roster)
      .filter((n) => n.alive && n.met && !required.has(n.id))
      .sort((a, b) => (b.lastSeenAt ?? -1) - (a.lastSeenAt ?? -1))
      .slice(0, EXTRA_CARDS),
  ];

  const dispatch = scope?.backlog ? [] : offscreenFixers(world, present);
  const canAsk = !scope?.backlog && offscreenJobsOpen(world);
  const places = locationCatalog(withSavedPlaces(extras.data ?? {}, world));
  const squash = Object.values(roster)
    .filter((n) => !scope?.backlog && n.alive && n.timeline.length >= TIMELINE_SQUASH)
    .slice(0, 3);

  const cityHeadlines = threads.threads
    .map(
      (t) =>
        `- ${t.title}（${t.district ?? "全城"}，${t.status}）：${t.steps.at(-1)?.news ?? t.stage}`,
    )
    .slice(0, 6);

  const since = cursor.lastAt ?? clock.startedAt ?? clock.sceneStartedAt;
  const elapsedHours = Math.max(0, Math.floor((world.time - since) / 60));
  const spanHint =
    !scope?.backlog && elapsedHours >= 48
      ? `【时间跨度提示】\n距离上次人物推演已过去约 ${Math.floor(elapsedHours / 24)} 个游戏日（${elapsedHours} 小时），人物近况与联系请符合多日间隔。`
      : undefined;

  const content = userMessage({
    scene: [
      `【当前状态】\n${stateSummary(world, records, extras.data)}`,
      ...(spanHint ? [spanHint] : []),
      `【本批范围】\n上次人物推演：${cursor.lastAt === null ? "尚未推演" : formatGameTime(cursor.lastAt)}；已处理到回合 ${cursor.processedThrough}；当前 ${formatGameTime(world.time)}。`,
      ...(scope?.backlog
        ? [
            `【积压分批处理】\n本批只处理回合 ${cursor.processedThrough + 1} 至 ${scope.through} 的已定稿正文。当前状态优先于历史描述，不补例行生活或派单。`,
          ]
        : []),
      ...(cityHeadlines.length > 0
        ? [`【城中近期风声摘要】（供人物闲聊与反应参考）\n${cityHeadlines.join("\n")}`]
        : []),
      `【人物索引】\n${
        Object.values(roster)
          .map(
            (n) =>
              `- ${n.id}｜${n.name}｜${n.role}｜${n.faction}｜${n.location ?? "位置未知"}${n.alive ? "" : "｜已死"}${present.has(n.id) ? "｜本场在场" : ""}${n.following ? "｜同行中" : ""}`,
          )
          .join("\n") || "（还没有）"
      }`,
      `【人物】\n${npcs.length > 0 ? npcs.map((n) => card(n, present.has(n.id), roster)).join("\n") : "（还没有）"}`,
      ...(dispatch.length > 0
        ? [
            `【能派单的中间人】（本次建议最多派 ${OFFSCREEN_JOBS} 单）\n${dispatch.map((f) => `- ${f.id}｜${f.name}`).join("\n")}`,
          ]
        : []),
      ...(jobs.length > 0
        ? [
            `【当前委托及近期收场】\n${jobs.map((j) => `- ${j.id}｜${j.title}｜${j.status}｜派单：${j.fixer ?? j.asker ?? "无"}｜雇主：${j.client}｜冲突：${j.conflict}${j.summary ? `｜收场：${j.summary}` : ""}`).join("\n")}`,
          ]
        : []),
      `【地点索引】（人物移动只用已有 id）\n${[...places.values()].map((p) => `${p.id}｜${p.name}｜${p.district}`).join("\n") || "（没有）"}`,
      `【能联系玩家的人】（仅限已互留联系方式的熟人；没在通讯录里的普通人物不主动发消息）\n${
        contactable(world, present)
          .map((n) => `- ${n.id}｜${n.name}：${relationBrief(n)}${canAsk ? "；可以托事" : ""}`)
          .join("\n") || "（这次没有：普通人物不发消息，【能派单的中间人】照常可派单）"
      }`,
      ...(lives.length > 0
        ? [
            `【该过自己日子的人】（建议各写一句自己的生活，不围着玩家转）\n${lives.map((n) => `- ${n.id}｜${n.name}`).join("\n")}`,
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
      ...(pending.length > 0
        ? [
            `【上次成功推演后的正文】\n${pending.map((r) => `回合 ${r.seq}：\n${r.text}`).join("\n\n")}`,
          ]
        : []),
    ],
    input: `【当前这一轮正文${scope?.backlog ? "：仅作现状保护，后续批次处理" : ""}】\n${narrative}`,
    reminder: "（只输出一个 JSON 对象。）",
  });

  return [
    { role: "system", content: SOCIAL_OFFSCREEN_SYSTEM },
    { role: "user", content },
  ];
}

export function prepareSocialOffscreenBatch(
  world: WorldState,
  records: readonly LogRecord[],
  extras: PromptExtras,
  narrative: string,
  present: ReadonlySet<string>,
  capacity: OffscreenCapacity,
): OffscreenBatch {
  return fitOffscreenBatch(world, records, "social", capacity, (scope) =>
    buildSocialOffscreenPrompt(world, records, extras, narrative, present, scope),
  );
}

/** L0/L1/L2 分级容错解析人物社交推演结果 */
export function readSocialOffscreen(
  text: string,
  world: WorldState,
  opts: {
    readonly present?: ReadonlySet<string>;
    readonly messages?: number;
    readonly data?: Readonly<Record<string, unknown>>;
  } = {},
): OffscreenParseResult {
  const commands: Command[] = [];
  const notes: string[] = [];
  const json = parseModelJson(text);
  if (
    !json.ok ||
    typeof json.value !== "object" ||
    json.value === null ||
    Array.isArray(json.value)
  ) {
    const fatal = `人物推演结果不是合法 JSON 对象${json.ok ? "" : `：${json.error}`}`;
    return { ok: false, commands, notes: [fatal], fatal };
  }
  const raw = json.value as Record<string, unknown>;
  if (!Array.isArray(raw.npcs) || !Array.isArray(raw.messages)) {
    const fatal = "人物推演缺少 npcs 或 messages 数组";
    return { ok: false, commands, notes: [fatal], fatal };
  }

  const list = (key: string): unknown[] => (Array.isArray(raw[key]) ? (raw[key] as unknown[]) : []);
  const npcs = NpcStateSchema.parse(world.slices.npc).npcs;
  const fixers = JobsStateSchema.parse(world.slices.jobs).fixers;
  const places = locationCatalog(withSavedPlaces(opts.data ?? {}, world));
  const lives = new Map(lifePicks(world, opts.present).map((n) => [n.id, n]));
  const lived = new Set<string>();
  const updatedIds = new Set<string>();
  let updated = 0;

  for (const [i, item] of list("npcs").entries()) {
    const parsed = SocialNpcSchema.safeParse(item);
    if (!parsed.success) {
      notes.push(`人物推演：npcs[${i}] 格式不对已跳过`);
      continue;
    }
    const npc = npcs[parsed.data.id];
    if (!npc?.alive) {
      notes.push(`人物推演：npcs[${i}] ${parsed.data.id} ${npc ? "已死" : "无人物卡"}，已跳过`);
      continue;
    }
    if (opts.present?.has(npc.id) || npc.following) {
      notes.push(`人物推演：${npc.name}本场在场或正与你同行，近况由正文写，已跳过`);
      continue;
    }
    if (updatedIds.has(npc.id)) {
      notes.push(`人物推演：${npc.name}近况重复，跳过多余条目`);
      continue;
    }
    if (lives.has(npc.id)) {
      lived.add(npc.id);
    } else if (updated >= soft(OFFSCREEN_NPCS)) {
      notes.push(`人物推演：人物近况超过 ${soft(OFFSCREEN_NPCS)} 个，多余已截断`);
      continue;
    } else {
      updated += 1;
    }
    let location = parsed.data.location ?? undefined;
    if (location !== undefined && !places.has(location)) {
      notes.push(`人物推演：${npc.name}去的 ${location} 不在地点表里，近况照收，位置不动`);
      location = undefined;
    }
    commands.push({
      type: "npc.offscreenDoing",
      id: npc.id,
      text: parsed.data.doing,
      ...(location === undefined ? {} : { location }),
    });
    updatedIds.add(npc.id);
  }
  for (const n of lives.values()) {
    if (!lived.has(n.id)) notes.push(`人物推演：建议${n.name}过自己的日子，这次没写`);
  }

  for (const [i, item] of list("pasts").entries()) {
    const parsed = SocialPastSchema.safeParse(item);
    if (!parsed.success) {
      notes.push(`人物推演：pasts[${i}] 格式不对已跳过`);
      continue;
    }
    const npc = npcs[parsed.data.id];
    if (!npc || npc.timeline.length < TIMELINE_SQUASH) {
      notes.push(`人物推演：pasts[${i}] ${parsed.data.id} 暂无需压缩经历，已跳过`);
      continue;
    }
    commands.push({ type: "npc.past", id: npc.id, text: parsed.data.text });
  }

  const died = new Set<string>();
  const deathRumors: Command[] = [];
  for (const [i, item] of list("deaths").entries()) {
    const parsed = SocialDeathSchema.safeParse(item);
    if (!parsed.success) {
      notes.push(`人物推演：deaths[${i}] 格式不对已跳过`);
      continue;
    }
    const npc = npcs[parsed.data.id];
    const problem = !npc
      ? "无人物卡"
      : !npc.canon
        ? "不是原作人物"
        : !npc.alive
          ? "已经死了"
          : opts.present?.has(npc.id)
            ? "本场在场"
            : npc.following
              ? "正与玩家同行"
              : updatedIds.has(npc.id) || died.has(npc.id)
                ? "与本批近况/死亡冲突"
                : undefined;
    if (problem || !npc) {
      notes.push(`人物推演：deaths[${i}] ${parsed.data.id} ${problem ?? ""}，已跳过`);
      continue;
    }
    if (died.size >= OFFSCREEN_DEATHS) {
      notes.push(`人物推演：原作人物一次最多死 ${OFFSCREEN_DEATHS} 个，多余已截断`);
      break;
    }
    died.add(npc.id);
    commands.push({ type: "npc.offscreenDeath", id: npc.id, cause: parsed.data.cause });
    if (parsed.data.rumor) {
      deathRumors.push({
        type: "city.rumor",
        text: parsed.data.rumor,
        truth: "true",
        reach: "district",
        player: false,
      });
    }
  }
  commands.push(...deathRumors);

  const gone = (n: Npc) => !n.alive || died.has(n.id);
  const pairs = new Set<string>();
  for (const [i, item] of list("ties").entries()) {
    const parsed = SocialTieSchema.safeParse(item);
    if (!parsed.success) {
      notes.push(`人物推演：ties[${i}] 格式不对已跳过`);
      continue;
    }
    const { a, b } = parsed.data;
    const left = npcs[a];
    const right = npcs[b];
    const pair = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (a === b || !left || !right || (gone(left) && gone(right)) || pairs.has(pair)) {
      notes.push(`人物推演：ties[${i}] ${a}/${b} 不满足条件，已跳过`);
      continue;
    }
    if (pairs.size >= soft(OFFSCREEN_TIES)) {
      notes.push(`人物推演：关系超过 ${soft(OFFSCREEN_TIES)} 条，多余已截断`);
      break;
    }
    pairs.add(pair);
    commands.push({ type: "tie", ...parsed.data });
  }

  // 委托派单与熟人托事
  const jobsOpen = offscreenJobsOpen(world);
  const dispatch = new Map(offscreenFixers(world, opts.present).map((f) => [f.id, f]));
  const existing = new Set(JobsStateSchema.parse(world.slices.jobs).jobs.map((j) => j.id));
  const offers = new Map<string, { fixer: string | null; title: string; command: Command }>();
  for (const [i, item] of list("jobs").entries()) {
    if (typeof item !== "object" || item === null) {
      notes.push(`人物推演：jobs[${i}] 格式不对已跳过`);
      continue;
    }
    const cleanJob: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(item as Record<string, unknown>)) {
      if (v !== null && v !== undefined) cleanJob[k] = v;
    }
    const parsed = JobOfferSchema.omit({ type: true }).safeParse(cleanJob);
    if (!parsed.success) {
      notes.push(
        `人物推演：jobs[${i}] 格式不对已跳过（${parsed.error.issues[0]?.message ?? "校验失败"}）`,
      );
      continue;
    }
    const { asker: _asker, ...job } = parsed.data;
    const fixer = job.fixer === undefined ? undefined : dispatch.get(job.fixer);
    const problem = !jobsOpen
      ? "挂着没接的委托已达上限"
      : existing.has(job.id) || offers.has(job.id)
        ? "编号重复"
        : job.fixer !== undefined && !fixer
          ? "派单人不在【能派单的中间人】里"
          : fixer && died.has(fixer.id)
            ? "派单人本批身亡"
            : job.due !== undefined && job.due <= world.time
              ? "期限不晚于当前时间"
              : undefined;
    if (problem) {
      notes.push(`人物推演：jobs[${i}]「${job.title}」${problem}，已跳过`);
      continue;
    }
    if (offers.size >= soft(OFFSCREEN_JOBS)) {
      notes.push(`人物推演：派单超过 ${soft(OFFSCREEN_JOBS)} 单，多余已截断`);
      break;
    }
    offers.set(job.id, {
      fixer: fixer?.id ?? null,
      title: job.title,
      command: { type: "jobOffer", ...job },
    });
  }

  const picked = new Set(contactable(world, opts.present).map((n) => n.id));
  const budget = Math.max(0, opts.messages ?? MESSAGES_PER_TURN);
  let sent = 0;
  const offerAt = commands.length;
  const delivered = new Set<string>();
  for (const [i, item] of list("messages").entries()) {
    if (typeof item !== "object" || item === null) {
      notes.push(`人物推演：messages[${i}] 格式不对已跳过`);
      continue;
    }
    const cleanMsg: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(item as Record<string, unknown>)) {
      if (v !== null && v !== undefined) cleanMsg[k] = v;
    }
    const parsed = IncomingMessageSchema.safeParse(cleanMsg);
    if (!parsed.success) {
      notes.push(`人物推演：messages[${i}] 格式不对已跳过`);
      continue;
    }
    const from = parsed.data.from;
    const npc = npcs[from];
    const fixer = fixers[from] !== undefined;
    if (
      (!fixer && !picked.has(from)) ||
      npc?.alive === false ||
      died.has(from) ||
      opts.present?.has(from) ||
      npc?.following === true
    ) {
      notes.push(`人物推演：messages[${i}] 的 ${from} 不符合主动联系条件，已跳过`);
      continue;
    }
    if (sent >= budget) {
      notes.push(`人物推演：消息达到每轮上限 ${MESSAGES_PER_TURN} 条，多余已截断`);
      break;
    }
    let job = parsed.data.job;
    const offer = job === undefined ? undefined : offers.get(job);
    if (offer && offer.fixer !== null && offer.fixer !== from) {
      notes.push(`人物推演：新委托「${offer.title}」不是 ${from} 派的，消息去掉委托关联`);
      job = undefined;
    } else if (offer && offer.fixer === null && fixer && !picked.has(from)) {
      notes.push(`人物推演：求助「${offer.title}」应由本人发，消息去掉委托关联`);
      job = undefined;
    } else if (offer && job !== undefined) {
      delivered.add(job);
      if (offer.fixer === null) {
        offer.command = { ...offer.command, asker: from };
      }
    }
    sent += 1;
    commands.push({
      type: "phone.receive",
      from,
      text: parsed.data.text,
      ...(job === undefined ? {} : { job }),
    });
  }

  const sending: Command[] = [];
  for (const [id, offer] of offers) {
    if (delivered.has(id)) {
      sending.push(offer.command);
      continue;
    }
    if (offer.fixer === null) {
      notes.push(`人物推演：求助「${offer.title}」缺少托事者短信，已跳过`);
      continue;
    }
    if (sent >= budget) {
      notes.push(`人物推演：新委托「${offer.title}」缺少派单短信且额度已满，已跳过`);
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
    notes.push(`人物推演：新委托「${offer.title}」缺少派单短信，代码已补发`);
  }
  commands.splice(offerAt, 0, ...sending);

  const phone = PhoneStateSchema.parse(world.slices.phone ?? {});
  let called = false;
  for (const [i, item] of list("calls").entries()) {
    if (sent >= budget || called || phone.calls.some((c) => c.status === "ringing")) {
      notes.push(`人物推演：calls[${i}] 超过联系额度或已有响铃来电，已跳过`);
      continue;
    }
    const parsed = SocialCallSchema.safeParse(item);
    if (!parsed.success) {
      notes.push(`人物推演：calls[${i}] 格式不对已跳过`);
      continue;
    }
    const { from } = parsed.data;
    const npc = npcs[from];
    const fixer = fixers[from] !== undefined;
    if (
      (!fixer && !picked.has(from)) ||
      npc?.alive === false ||
      died.has(from) ||
      opts.present?.has(from) ||
      npc?.following === true
    ) {
      notes.push(`人物推演：calls[${i}] 来电者 ${from} 不符合条件，已跳过`);
      continue;
    }
    commands.push({ type: "phone.call", ...parsed.data });
    sent += 1;
    called = true;
  }

  return { ok: true, commands, notes };
}
