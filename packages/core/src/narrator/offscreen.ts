import { z } from "zod";
import { projectState } from "../game";
import type { LlmMessage } from "../kernel/ports";
import type { Command } from "../kernel/system";
import { effectiveTurns, type LogRecord } from "../kernel/turnlog";
import type { WorldState } from "../kernel/world";
import {
  CityEventFieldsSchema,
  CityStateSchema,
  citySection,
  OFFSCREEN_EVENTS,
  OFFSCREEN_HOURS,
  OFFSCREEN_MAJOR,
  OFFSCREEN_SCENES,
} from "../systems/city";
import { JobsStateSchema } from "../systems/jobs";
import { type Npc, NpcStateSchema } from "../systems/npc";
import { IncomingMessageSchema, MESSAGES_PER_TURN } from "../systems/phone";
import { formatGameTime, WorldClockStateSchema } from "../systems/world";
import { parseModelJson } from "./block";
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

const OFFSCREEN_STAGE = `【这一步：场外推演】
玩家刚收了一场。你负责推演玩家没看着的地方：这段时间里，夜之城有什么在变？
- 只推演已经具备条件的事：正文里提到、但没在玩家眼前发生的（有人说哪里打起来了、新闻里提到的、委托里的对手、玩家做完事留下的余波），帮派抢地盘、公司的动作、夜之城警察局和暴恐机动队的反应、中间人的生意。不凭空制造戏剧性；没有值得记的，三个数组都输出空的。
- 和现有状态自洽：地点、势力、人物的生死和关系都不能矛盾；不写玩家角色做了什么、说了什么、想了什么。
- 【城里的动静】里已有的照原 id 更新（升级、平息、结束），整条重写；新的事才起新 id。
- 一次最多 ${OFFSCREEN_EVENTS} 条动静，其中 major 最多 ${OFFSCREEN_MAJOR} 条：城不能每次都在爆炸。
- 人物近况只写这次推演牵涉到的、【人物】里活着的人，一人一句，最多 ${OFFSCREEN_NPCS} 个；标了「本场在场」的人就在玩家眼前，不写近况。
- 不改任何数值（欧元、人性、生命、好感、通缉星、声望），不改期限和委托；动静里可以提到没卡的人，但不建新人物。
- 原作人物按原剧的时间线走，不提前写出原剧里还没到的结局。
- 主动联系：只在有人有事必须告诉玩家（有时限、发现了和玩家有关的事、要玩家做决定、关系变了）时才发，大多数时候是空的；不发寒暄和问候。发消息的只能是玩家见过的人或中间人，最多 ${MESSAGES_PER_TURN} 条；刚分开的人不发，除非分开后有了新情况。`;

const OFFSCREEN_OUTPUT = `【输出格式】
只输出一个 JSON 对象，不要代码块：
{"events": [{"id": "小写英文和连字符", "title": "24 字以内", "body": "160 字以内：发生了什么、谁在动、接下来可能怎样", "district": "城区，可省", "status": "brewing|heating|cooling|over", "weight": "minor|normal|major"}], "npcs": [{"id": "人物 id", "doing": "最近在做什么，一句话，80 字以内"}], "messages": [{"from": "人物或中间人 id", "text": "消息原文：短、口语"}]}
status：brewing 在酝酿，heating 在升级，cooling 在平息，over 结束了。weight：minor 街角小事，normal 几个街区在传，major 上了 N54 头条、迟早找到玩家头上。

例：{"events": [{"id": "tyger-claws-kabuki", "title": "虎爪帮在歌舞伎区收紧地盘", "body": "那间夜店被砸以后，虎爪帮把歌舞伎区几条街的保护费翻了倍，正在挨家打听是谁干的。", "district": "沃森", "status": "heating", "weight": "normal"}], "npcs": [], "messages": []}
玩家只是在公寓睡了一觉、正文没提城里任何事时：{"events": [], "npcs": [], "messages": []}
不要写没有前因的大事：玩家在街边吃了碗面，就写「荒坂塔遇袭」，这是凭空制造戏剧性。`;

export const OFFSCREEN_SYSTEM = [BOOKKEEPING_BASE, OFFSCREEN_STAGE, OFFSCREEN_OUTPUT].join("\n\n");

function card(n: Npc, here: boolean): string {
  const parts = [`${n.id}｜${n.name}，${n.role}`, `想要：${n.want}`, `底线：${n.limit}`];
  if (n.secret) parts.push(`秘密：${n.secret}`);
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
  const view = projectState(world, records, extras.data);
  const city = CityStateSchema.parse(world.slices.city ?? {});
  const npcs = Object.values(NpcStateSchema.parse(world.slices.npc).npcs)
    .filter((n) => n.alive)
    .sort((a, b) => (b.lastSeenAt ?? -1) - (a.lastSeenAt ?? -1))
    .slice(0, MAX_CARDS);
  const fixers = Object.values(JobsStateSchema.parse(world.slices.jobs).fixers);
  const since = city.lastScene ?? 0;
  const window = effectiveTurns(records)
    .filter((r) => (r.scene ?? since) >= since)
    .slice(-WINDOW_TURNS)
    .map((r) => r.text.slice(0, WINDOW_CHARS));
  const content = userMessage({
    scene: [
      `【当前状态】\n${stateSummary(view)}`,
      `【人物】\n${npcs.length > 0 ? npcs.map((n) => card(n, present.has(n.id))).join("\n") : "（还没有）"}`,
      ...(fixers.length > 0
        ? [`【中间人】\n${fixers.map((f) => `- ${f.id}｜${f.name}`).join("\n")}`]
        : []),
      `【城里的动静】\n${citySection(city) ?? "（还没有记下的）"}`,
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

const OffscreenNpcSchema = z.object({
  id: z.string().trim().min(1),
  doing: z.string().trim().min(1).max(80),
});

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
  for (const [i, item] of list("events").entries()) {
    const parsed = CityEventFieldsSchema.safeParse(item);
    if (!parsed.success) {
      notes.push(`场外推演：events[${i}] 格式不对：${issue(parsed.error)}`);
      continue;
    }
    if (kept >= OFFSCREEN_EVENTS) {
      notes.push(`场外推演：动静一次最多 ${OFFSCREEN_EVENTS} 条，多的不要`);
      break;
    }
    kept += 1;
    let event = parsed.data;
    if (event.weight === "major") {
      majors += 1;
      if (majors > OFFSCREEN_MAJOR) {
        event = { ...event, weight: "normal" };
        notes.push(`场外推演：头条一次最多 ${OFFSCREEN_MAJOR} 条，「${event.title}」降成 normal`);
      }
    }
    commands.push({ type: "city.event", ...event });
  }

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

  const budget = Math.max(0, opts.messages ?? MESSAGES_PER_TURN);
  let sent = 0;
  for (const [i, item] of list("messages").entries()) {
    const parsed = IncomingMessageSchema.safeParse(item);
    if (!parsed.success) {
      notes.push(`场外推演：messages[${i}] 格式不对：${issue(parsed.error)}`);
      continue;
    }
    const npc = npcs[parsed.data.from];
    const known = (npc?.alive === true && npc.met) || fixers[parsed.data.from] !== undefined;
    if (!known) {
      notes.push(`场外推演：messages[${i}] 的 ${parsed.data.from} 不是玩家见过的活人或中间人`);
      continue;
    }
    if (sent >= budget) {
      notes.push(`场外推演：消息连同本轮正文每轮最多 ${MESSAGES_PER_TURN} 条，多的不要`);
      break;
    }
    sent += 1;
    commands.push({ type: "phone.receive", from: parsed.data.from, text: parsed.data.text });
  }
  return { commands, notes };
}
