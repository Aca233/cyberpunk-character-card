import type { LlmMessage } from "../kernel/ports";
import { effectiveTurns, type LogRecord } from "../kernel/turnlog";
import type { WorldState } from "../kernel/world";
import { type TurnInput, TurnInputSchema } from "../schemas/turn";
import {
  ImportanceSchema,
  KEYWORD_CHARS,
  type MemorySceneCommand,
  SUMMARY_CHARS,
  SUMMARY_KEYWORDS,
  SUMMARY_PEOPLE,
  SUMMARY_TITLE_CHARS,
} from "../systems/memory";
import { NpcStateSchema } from "../systems/npc";
import { withSavedPlaces } from "../systems/world/places";
import { locationCatalog, WorldClockStateSchema } from "../systems/world/schema";
import { parseModelJson } from "./block";
import { presentNpcs } from "./offscreen";
import { formatInput, type PromptExtras } from "./prompts/context";
import { BOOKKEEPING_BASE, userMessage } from "./prompts/layers";

/** 场景摘要：辅助模型，低温，只复述正文 */
export const SUMMARY_TEMPERATURE = 0.2;
/** 这一场最多带几轮正文、每轮最多几个字 */
const SCENE_TURNS = 16;
const TURN_CHARS = 800;
/** 最多带几张人物卡 */
const MAX_CARDS = 16;

const SUMMARY_STAGE = `【这一步：场景摘要】
玩家刚收了一场。把这一场写成一条摘要：以后这一场的原文不再给叙事模型，只留这条摘要。
- text 写 100–${SUMMARY_CHARS} 字，只写正文里已经发生的事：谁、做了什么、结果怎样、留下了什么（答应的事、欠下的人情、结下的仇、拿到的东西和线索）。计划和打算写成“打算……”“答应……”，不写成已经发生。
- 玩家角色写“你”；他说了什么、做了什么决定只认【玩家输入】，正文里替他写出来的不算。
- 人物写名字；people 写【人物】里对应的 id，只写这一场真出场或被认真提起的人，没卡的人只写进 text。
- importance：minor 小事（路过、闲聊、买东西），normal 普通，key 关键（有人死了、翻脸、结盟、委托办成或办砸、拿到关键线索、改变命运的决定）。
- keywords 写 2–${SUMMARY_KEYWORDS} 个以后检索用的词：人名、地名、物品、事件，每个 ${KEYWORD_CHARS} 字以内。
- 不评价、不预测，不写正文里没有的东西。`;

const SUMMARY_OUTPUT = `【输出格式】
只输出一个 JSON 对象，不要代码块：
{"title": "12 字以内", "text": "100–${SUMMARY_CHARS} 字", "people": ["人物 id"], "importance": "minor|normal|key", "keywords": ["词", "词"]}

例：{"title": "面馆里接下第一单", "text": "你在小摊面馆见到中间人老莫，他让你去沃森的一间废弃诊所取回一块芯片，事成给 2,000 欧元。你答应了，想先要一半定金，他没给。摊主阿珍提醒你那一带最近有帮派出没。你打算天黑以后再去。", "people": ["old-mo", "a-zhen"], "importance": "normal", "keywords": ["老莫", "芯片", "废弃诊所", "沃森"]}`;

export const SUMMARY_SYSTEM = [BOOKKEEPING_BASE, SUMMARY_STAGE, SUMMARY_OUTPUT].join("\n\n");

function clip(text: string, max: number): string {
  return [...text].slice(0, max).join("");
}

function flat(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

/**
 * 场景摘要的提示词：这一场里定稿的正文和刚收场的这一轮。
 * before 是这一轮开始时的世界（场次、地点按它），after 是结算后的（人物卡按它，刚建的卡也在）
 */
export function buildSummaryPrompt(
  before: WorldState,
  after: WorldState,
  records: readonly LogRecord[],
  input: TurnInput,
  narrative: string,
  extras: PromptExtras,
): LlmMessage[] {
  const clock = WorldClockStateSchema.parse(before.slices.world);
  const earlier = effectiveTurns(records)
    .filter((t) => t.scene === clock.scene && t.ooc !== true && t.unsettled === undefined)
    .flatMap((t) => {
      const parsed = TurnInputSchema.safeParse(t.input);
      if (parsed.success && parsed.data.mode === "ooc") return [];
      const said = parsed.success ? `${formatInput(parsed.data)}\n` : "";
      return [`${said}${clip(t.text, TURN_CHARS)}`];
    })
    .slice(-SCENE_TURNS);
  const present = presentNpcs(before, after);
  const cards = Object.values(NpcStateSchema.parse(after.slices.npc).npcs)
    .filter((n) => n.lastSeenAt !== null)
    .sort((a, b) => (b.lastSeenAt ?? -1) - (a.lastSeenAt ?? -1))
    .slice(0, MAX_CARDS)
    .map(
      (n) =>
        `- ${n.id}｜${n.name}，${n.role}${n.alive ? "" : "，已经死了"}${present.has(n.id) ? "，本场在场" : ""}`,
    );
  const place = clock.location;
  const placeName =
    place === null
      ? undefined
      : // 存档记下的地点并进地点表；按结算后的世界查，这一轮刚记下的地点也有名字
        locationCatalog(withSavedPlaces(extras.data ?? {}, after)).get(place)?.name;
  const content = userMessage({
    scene: [
      `【地点】${place === null ? "还没有" : `${placeName ?? place}（${place}）`}`,
      `【人物】\n${cards.length > 0 ? cards.join("\n") : "（还没有）"}`,
      ...(earlier.length > 0 ? [`【这一场前面的正文】\n${earlier.join("\n\n")}`] : []),
    ],
    input: `【刚收场的这一轮】\n${formatInput(input)}\n${narrative}`,
    reminder: "（只输出一个 JSON 对象。）",
  });
  return [
    { role: "system", content: SUMMARY_SYSTEM },
    { role: "user", content },
  ];
}

export interface SummaryResult {
  /** 读出来的摘要；读不了时为 undefined */
  readonly command?: MemorySceneCommand;
  /** 截短、去掉、按默认记的原因；只进剧透视图 */
  readonly notes: string[];
}

/** 读场景摘要：超长的截短，人物 id 要对得上卡，地点由代码按收场前的位置填 */
export function readSummary(
  text: string,
  world: WorldState,
  scene: number,
  place: string | null,
): SummaryResult {
  const notes: string[] = [];
  const json = parseModelJson(text);
  if (
    !json.ok ||
    typeof json.value !== "object" ||
    json.value === null ||
    Array.isArray(json.value)
  ) {
    notes.push(`场景摘要读不了${json.ok ? "" : `：${json.error}`}，这一场不记摘要`);
    return { notes };
  }
  const raw = json.value as Record<string, unknown>;
  const body = flat(raw.text);
  if (body === "") {
    notes.push("场景摘要没写 text，这一场不记摘要");
    return { notes };
  }
  let summary = body;
  if ([...body].length > SUMMARY_CHARS) {
    summary = `${clip(body, SUMMARY_CHARS - 1)}…`;
    notes.push(`场景摘要超过 ${SUMMARY_CHARS} 字，截短了`);
  }
  const title = clip(flat(raw.title) || clip(summary, 12), SUMMARY_TITLE_CHARS);

  const npcs = NpcStateSchema.parse(world.slices.npc).npcs;
  const people: string[] = [];
  for (const id of Array.isArray(raw.people) ? raw.people : []) {
    const key = flat(id);
    if (key === "") continue;
    if (!npcs[key]) {
      notes.push(`场景摘要：people 里的 ${key} 不在人物卡里，去掉了`);
      continue;
    }
    if (!people.includes(key) && people.length < SUMMARY_PEOPLE) people.push(key);
  }

  const importance = ImportanceSchema.safeParse(raw.importance);
  if (!importance.success) notes.push("场景摘要的 importance 认不出，按 normal 记");

  const keywords: string[] = [];
  for (const k of Array.isArray(raw.keywords) ? raw.keywords : []) {
    const word = clip(flat(k), KEYWORD_CHARS);
    if (word !== "" && !keywords.includes(word) && keywords.length < SUMMARY_KEYWORDS) {
      keywords.push(word);
    }
  }
  if (keywords.length < 2) notes.push("场景摘要的关键词不到 2 个");

  return {
    notes,
    command: {
      type: "memory.scene",
      scene,
      title,
      text: summary,
      people,
      place,
      importance: importance.success ? importance.data : "normal",
      keywords,
    },
  };
}
