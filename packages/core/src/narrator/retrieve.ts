import { effectiveTurns, type LogRecord } from "../kernel/turnlog";
import type { WorldState } from "../kernel/world";
import { TurnInputSchema } from "../schemas/turn";
import { CityStateSchema } from "../systems/city";
import { type Importance, MemoryStateSchema, recapScenes } from "../systems/memory";
import { type Npc, NpcStateSchema } from "../systems/npc";
import { locationCatalog, WorldClockStateSchema } from "../systems/world/schema";
import { presentNpcs } from "./offscreen";
import type { Memory } from "./stages";

/**
 * 扩展层：热层以外的旧记忆，覆盖不够时按分数补几条。
 * 条目有四种：掉出窗口的旧轮次、【前情】没带的场景摘要、热层没带的共同记忆、已经结束的城里的动静
 */
export type MemoryKind = "turn" | "scene" | "bond" | "city";

export interface MemoryEntry extends Memory {
  /** 稳定 id：turn:12、scene:3、bond:judy:4、city:<事件 id> */
  readonly id: string;
  readonly kind: MemoryKind;
  /** 牵涉的有卡人物 id */
  readonly people: readonly string[];
  readonly place: string | null;
  /** 游戏时间（分钟）；旧轮次没记游戏时间，为 null */
  readonly at: number | null;
  readonly importance: Importance;
  readonly keywords: readonly string[];
  /** 旧轮次这一轮主要做了什么（world 指令的 activity） */
  readonly activity?: string | undefined;
}

/** 给判断看的候选最多这么多条；每条正文最多几个字 */
export const MAX_CANDIDATES = 40;
const MEMORY_CHARS = 400;
/** 在场人物卡上已经带了最近几条共同记忆 */
const CARD_MEMORIES = 3;

function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return [...flat].length > max ? `${[...flat].slice(0, max).join("")}…` : flat;
}

/** 一个人在正文里可能被叫的名字：全名、名字的每一段（朱迪·阿尔瓦雷兹 → 朱迪、阿尔瓦雷兹）、外号 */
export function namesOf(n: Npc): string[] {
  const parts = n.name.split(/[·・\s]/);
  return [...new Set([n.name, ...parts, n.alias ?? ""])].filter((s) => [...s].length >= 2);
}

/** 正文里提到了哪些有卡人物 */
export function mentioned(text: string, npcs: readonly Npc[]): string[] {
  return npcs.filter((n) => namesOf(n).some((name) => text.includes(name))).map((n) => n.id);
}

/** 原文在最近 hot 轮里的场次 */
export function hotScenes(records: readonly LogRecord[], hot: number): Set<number> {
  const turns = effectiveTurns(records);
  return new Set(
    (hot > 0 ? turns.slice(-hot) : [])
      .map((t) => t.scene)
      .filter((s): s is number => s !== undefined),
  );
}

function activityOf(commands: readonly unknown[]): string | undefined {
  for (const c of commands) {
    if (typeof c !== "object" || c === null) continue;
    const { type, activity } = c as { type?: unknown; activity?: unknown };
    if (type === "world" && typeof activity === "string") return activity;
  }
  return undefined;
}

const CITY_IMPORTANCE = { minor: "minor", normal: "normal", major: "key" } as const;

/** 扩展层的候选池：热层（最近 hot 轮原文、【前情】、在场人物卡、进行中的城里的动静）已经有的不算 */
export function memoryPool(
  world: WorldState,
  records: readonly LogRecord[],
  hot: number,
): MemoryEntry[] {
  const npcs = Object.values(NpcStateSchema.parse(world.slices.npc).npcs);
  const shown = hotScenes(records, hot);
  const out: MemoryEntry[] = [];

  // 掉出窗口的旧轮次；场外提问和未定稿的不算
  const turns = effectiveTurns(records).filter((t) => {
    if (t.ooc === true || t.unsettled !== undefined) return false;
    const input = TurnInputSchema.safeParse(t.input);
    return !(input.success && input.data.mode === "ooc");
  });
  for (const t of turns.slice(0, Math.max(0, turns.length - hot)).slice(-MAX_CANDIDATES)) {
    out.push({
      id: `turn:${t.seq}`,
      kind: "turn",
      title: `第 ${t.seq} 轮${t.title ? ` ${t.title}` : ""}：${oneLine(t.read ?? t.text, 24)}`,
      text: oneLine(t.text, MEMORY_CHARS),
      people: mentioned(t.text, npcs),
      place: null,
      at: null,
      importance: "normal",
      keywords: [],
      activity: activityOf(t.commands),
    });
  }

  // 【前情】没带的场景摘要
  const memory = MemoryStateSchema.parse(world.slices.memory ?? {});
  const recapped = new Set(recapScenes(memory, shown).map((s) => s.scene));
  for (const s of memory.scenes) {
    if (shown.has(s.scene) || recapped.has(s.scene)) continue;
    out.push({
      id: `scene:${s.scene}`,
      kind: "scene",
      title: `第 ${s.scene + 1} 场「${s.title}」`,
      text: s.text,
      people: s.people,
      place: s.place,
      at: s.at,
      importance: s.importance,
      keywords: s.keywords,
    });
  }

  // 共同记忆：在场人物卡上已经带了最近几条
  const present = presentNpcs(world, world);
  for (const n of npcs) {
    const hidden = present.has(n.id) ? n.memories.slice(0, -CARD_MEMORIES) : n.memories;
    hidden.forEach((m, i) => {
      out.push({
        id: `bond:${n.id}:${i}`,
        kind: "bond",
        title: `和${n.name}：${oneLine(m, 20)}`,
        text: oneLine(m, MEMORY_CHARS),
        people: [n.id],
        place: null,
        at: null,
        importance: "normal",
        keywords: [],
      });
    });
  }

  // 已经结束的城里的动静；进行中的在热层
  for (const e of CityStateSchema.parse(world.slices.city ?? {}).events) {
    if (e.status !== "over") continue;
    out.push({
      id: `city:${e.id}`,
      kind: "city",
      title: `城里：${e.title}`,
      text: `${e.district ? `${e.district}：` : ""}${e.body}（已经过去了）`,
      people: mentioned(e.body, npcs),
      place: null,
      at: e.updatedAt,
      importance: CITY_IMPORTANCE[e.weight],
      keywords: [e.title, ...(e.district ? [e.district] : [])],
    });
  }
  return out;
}

/** 这一轮拿来检索的文字：input 是玩家输入加判断的理解，context 是最近两轮正文 */
export interface MemoryQuery {
  readonly input: string;
  readonly context: string;
}

type Intent = "ask" | "trade" | "fight";
const INTENTS: readonly (readonly [Intent, RegExp])[] = [
  ["ask", /打听|问问|听说|消息|传闻|知道.{0,8}吗|怎么样了/],
  ["trade", /买|卖|价钱|多少钱|欧元|交易|讲价/],
  ["fight", /开枪|开火|动手|揍|杀|干掉|打起来|拔枪/],
];
const DAY_WORDS: readonly (readonly [RegExp, number])[] = [
  [/前天/, 2],
  [/昨天|昨晚|昨夜/, 1],
  [/今天|今晚|刚才/, 0],
];

/** 各路的分值；向量相似度没配 embedding，记 0 */
const WEIGHT = { input: 0.4, context: 0.2, time: 0.3, keyword: 0.5, intent: 0.15 } as const;
export const IMPORTANCE_WEIGHT: Readonly<Record<Importance, number>> = {
  minor: 0.6,
  normal: 1,
  key: 1.5,
};
/** 输入里直接点了这个人的名字或 id */
export const EXACT_BONUS = 0.35;

const HAN = /[㐀-鿿]/;
const COMMON = new Set([
  ..."的了是在你我他她它们这那一不有和就也都着把被给说到上下来去个么什没吗呢吧啊又还很要想",
]);

/** 汉字两字组，两个字都是虚词的不算 */
function grams(text: string): Set<string> {
  const chars = [...text];
  const out = new Set<string>();
  for (let i = 0; i + 2 <= chars.length; i += 1) {
    const a = chars[i] as string;
    const b = chars[i + 1] as string;
    if (!HAN.test(a) || !HAN.test(b) || (COMMON.has(a) && COMMON.has(b))) continue;
    out.add(a + b);
  }
  return out;
}

function overlap(query: ReadonlySet<string>, text: string): number {
  if (query.size === 0) return 0;
  let hits = 0;
  for (const g of query) if (text.includes(g)) hits += 1;
  return hits / query.size;
}

function intentMatches(intent: Intent, e: MemoryEntry): boolean {
  if (intent === "ask") return e.kind !== "turn";
  if (intent === "trade") return /欧元|买|卖|价/.test(e.text);
  return e.activity === "combat" || /枪|子弹|血|刀/.test(e.text);
}

export interface ScoredMemory {
  readonly entry: MemoryEntry;
  readonly score: number;
  /** 各路得分，给上下文查看器看 */
  readonly parts: string;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** 五路相加再乘重要度，输入里点名的再加 EXACT_BONUS；分数从高到低 */
export function scoreMemories(
  pool: readonly MemoryEntry[],
  world: WorldState,
  query: MemoryQuery,
): ScoredMemory[] {
  const npcs = Object.values(NpcStateSchema.parse(world.slices.npc).npcs);
  const named = new Set([
    ...mentioned(query.input, npcs),
    ...npcs.filter((n) => query.input.includes(n.id)).map((n) => n.id),
  ]);
  const around = new Set([...mentioned(query.context, npcs), ...presentNpcs(world, world).keys()]);
  const intent = INTENTS.find(([, re]) => re.test(query.input))?.[0];
  const back = DAY_WORDS.find(([re]) => re.test(query.input))?.[1];
  const day = back === undefined ? undefined : Math.floor(world.time / 1440) - back;
  const q = grams(query.input);
  return pool
    .map((entry) => {
      const vector = 0;
      const person = entry.people.some((p) => named.has(p))
        ? WEIGHT.input
        : entry.people.some((p) => around.has(p))
          ? WEIGHT.context
          : 0;
      const time =
        day !== undefined && entry.at !== null && Math.floor(entry.at / 1440) === day
          ? WEIGHT.time
          : 0;
      const kw =
        entry.keywords.length > 0
          ? entry.keywords.filter((k) => query.input.includes(k)).length / entry.keywords.length
          : 0;
      const keyword = WEIGHT.keyword * Math.max(kw, overlap(q, `${entry.title}${entry.text}`));
      const bias = intent !== undefined && intentMatches(intent, entry) ? WEIGHT.intent : 0;
      const exact = entry.people.some((p) => named.has(p)) ? EXACT_BONUS : 0;
      const times = IMPORTANCE_WEIGHT[entry.importance];
      const score = (vector + person + time + keyword + bias) * times + exact;
      const parts = `人物 ${r2(person)}、时间 ${r2(time)}、关键词 ${r2(keyword)}、意图 ${r2(bias)}，×${times}${exact > 0 ? `，点名 +${EXACT_BONUS}` : ""}`;
      return { entry, score: r2(score), parts };
    })
    .sort((a, b) => b.score - a.score);
}

/** 给判断看的【可调的旧记忆】：按这一轮的输入排好，最多 MAX_CANDIDATES 条 */
export function judgeCandidates(
  pool: readonly MemoryEntry[],
  world: WorldState,
  query: MemoryQuery,
): MemoryEntry[] {
  return scoreMemories(pool, world, query)
    .slice(0, MAX_CANDIDATES)
    .map((s) => s.entry);
}

/** 扩展层每轮按分数补几条、够多少分才补、热层里相关的不到几条算覆盖不够；查看器列前几名 */
export const EXPAND_TOP = 3;
export const MIN_SCORE = 0.35;
export const COVERAGE_MIN = 5;
const TOP_SHOWN = 8;

export interface Expansion {
  /** 为什么要补（覆盖不够的原因）；为空时没检索 */
  readonly triggers: readonly string[];
  /** 补进来的条目，不含判断调的 */
  readonly picked: readonly MemoryEntry[];
  /** 分数前几名，给上下文查看器看 */
  readonly top: readonly {
    readonly id: string;
    readonly title: string;
    readonly score: number;
    readonly parts: string;
  }[];
  /** 检索落空时每次退回的原因 */
  readonly fallback: readonly string[];
}

/**
 * 扩展层：覆盖不够时（判断调了旧记忆、输入提到热层里没有的人或地点、热层里相关的不到 COVERAGE_MIN 条）
 * 按分数补前 EXPAND_TOP 条；判断调过的不重复；什么都没够分时依次退回同地点的场景摘要、同城区的城里的动静、只用热层
 */
export function expandMemories(
  pool: readonly MemoryEntry[],
  world: WorldState,
  records: readonly LogRecord[],
  hot: number,
  query: MemoryQuery,
  recalled: readonly Memory[],
  data: Readonly<Record<string, unknown>>,
): Expansion {
  const npcs = Object.values(NpcStateSchema.parse(world.slices.npc).npcs);
  const present = presentNpcs(world, world);
  const clock = WorldClockStateSchema.parse(world.slices.world);
  const places = locationCatalog(data);
  const triggers: string[] = [];
  if (recalled.length > 0) triggers.push(`判断调了 ${recalled.length} 条旧记忆`);
  const named = mentioned(query.input, npcs);
  const absent = npcs.filter((n) => named.includes(n.id) && !present.has(n.id));
  if (absent.length > 0)
    triggers.push(`输入提到不在场的人：${absent.map((n) => n.name).join("、")}`);
  const elsewhere = [...places.values()].filter(
    (p) => p.id !== clock.location && query.input.includes(p.name),
  );
  if (elsewhere.length > 0) {
    triggers.push(`输入提到别的地点：${elsewhere.map((p) => p.name).join("、")}`);
  }
  const q = grams(query.input);
  const window = hot > 0 ? effectiveTurns(records).slice(-hot) : [];
  const relevant =
    window.filter((t) => overlap(q, t.text) >= 0.2).length +
    named.filter((id) => present.has(id)).length;
  if (relevant < COVERAGE_MIN) triggers.push(`热层里相关的只有 ${relevant} 条`);
  if (triggers.length === 0) return { triggers, picked: [], top: [], fallback: [] };

  const scored = scoreMemories(pool, world, query);
  const taken = new Set(recalled.map((m) => m.title));
  const picked = scored
    .filter((s) => s.score >= MIN_SCORE && !taken.has(s.entry.title))
    .slice(0, EXPAND_TOP)
    .map((s) => s.entry);
  const fallback: string[] = [];
  if (picked.length === 0 && recalled.length === 0) {
    fallback.push(`检索没有到 ${MIN_SCORE} 分的条目`);
    const here = clock.location;
    const same = pool.filter((e) => e.kind === "scene" && here !== null && e.place === here).at(-1);
    const district = here === null ? undefined : places.get(here)?.district;
    const near =
      district === undefined
        ? undefined
        : pool.filter((e) => e.kind === "city" && e.keywords.includes(district)).at(-1);
    if (same) {
      picked.push(same);
      fallback.push("退回同地点的场景摘要");
    } else if (near) {
      fallback.push("没有同地点的场景摘要");
      picked.push(near);
      fallback.push("退回同城区的城里的动静");
    } else {
      fallback.push("没有同地点的场景摘要，也没有同城区的城里的动静，只用热层");
    }
  }
  return {
    triggers,
    picked,
    top: scored
      .slice(0, TOP_SHOWN)
      .map((s) => ({ id: s.entry.id, title: s.entry.title, score: s.score, parts: s.parts })),
    fallback,
  };
}
