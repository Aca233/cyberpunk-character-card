import { z } from "zod";
import type { AbortSignalLike, LlmClient, LlmMessage } from "../kernel/ports";
import {
  BIO_CHARS,
  INITIAL_DOING_CHARS,
  inferNpcCircle,
  LIMIT_CHARS,
  LOOK_CHARS,
  NAME_CHARS,
  NO_FACTION,
  NPC_CIRCLE_LABELS,
  NPC_CIRCLES,
  NPC_SAMPLES_MAX,
  type NpcCard,
  NpcCardSchema,
  type NpcCircle,
  OUTFIT_CHARS,
  ROLE_CHARS,
  SAMPLE_CHARS,
  SECRET_CHARS,
  VOICE_CHARS,
  WANT_CHARS,
} from "../systems/npc/schema";
import { completeFinish, isLengthFinish } from "./completion";
import { responseJsonSchema } from "./doc";

/**
 * 自建 / 润色 NPC 人物卡的辅助模型解析器：
 * 玩家写一句话描述（或对已有 NPC 提出修改方向），由辅助模型生成或局部润色完整 NpcCard；
 * 严格校验势力、地点、圈层与字数上限，修改原作人物且未展开剧透时绝不覆写原作生平与秘密。
 */

export const NpcReplySchema = z.object({
  name: z.string(),
  alias: z.string(),
  pronoun: z.string(),
  role: z.string(),
  faction: z.string(),
  circle: z.string(),
  home: z.string(),
  entity: z.string(),
  age: z.number().nullable(),
  look: z.string(),
  outfit: z.string(),
  voice: z.string(),
  samples: z.array(z.string()),
  want: z.string(),
  limit: z.string(),
  initialDoing: z.string(),
  bio: z.string(),
  secret: z.string(),
});

export type NpcDraftInput = {
  readonly [K in keyof NpcCard]?: NpcCard[K] | undefined;
};

export interface InterpretNpcRequest {
  /** 玩家写的一句话设定或修改要求 */
  readonly text: string;
  /** 已有卡面（润色/修改时传入；新建时省略） */
  readonly existing?: NpcDraftInput | undefined;
  /** 修改原作人物且剧透区折叠时为 true：不下发也不改写 bio / secret */
  readonly preserveSpoilers?: boolean | undefined;
  readonly factions?: readonly { readonly id: string; readonly name: string }[] | undefined;
  readonly locations?:
    | readonly { readonly id: string; readonly name: string; readonly district: string }[]
    | undefined;
}

const VALID_CIRCLES = new Set<string>(NPC_CIRCLES);
const VALID_ENTITIES = new Set<string>(["human", "synthetic", "robot"]);
const VALID_PRONOUNS = new Set<string>(["他", "她", "TA"]);

const cut = (value: unknown, max: number) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

export function buildNpcPrompt(request: InterpretNpcRequest): LlmMessage[] {
  const factionList = (request.factions ?? []).map((f) => `${f.id}(${f.name})`).join("、");
  const locationList = (request.locations ?? [])
    .map((l) => `${l.id}(${l.name}/${l.district})`)
    .join("、");
  const circleList = NPC_CIRCLES.map((c) => `${c}(${NPC_CIRCLE_LABELS[c]})`).join("、");

  const system = [
    "你在帮玩家创作或润色《赛博朋克 2077》夜之城文字角色扮演游戏里的 NPC 人物卡。",
    "只输出一个 JSON 对象，不要代码块，不要多余解释。字段说明：",
    `- "name"：人物姓名，${NAME_CHARS} 字以内，自然接地气的赛博朋克人名`,
    `- "alias"：外号或简称，${NAME_CHARS} 字以内；没有就空字符串`,
    '- "pronoun"：只填 "他"、"她" 或 "TA"',
    `- "role"：身份或行当，${ROLE_CHARS} 字以内，具体鲜明`,
    `- "faction"：所属势力 id，只能填 "${NO_FACTION}"（独立无势力）或以下之一：${factionList || NO_FACTION}`,
    `- "circle"：夜之城圈层，只能填以下之一：${circleList}`,
    `- "home"：常驻地点 id，不固定就填 ""，否则从以下选一个最贴合的：${locationList || "（无）"}`,
    '- "entity"：物种类型，只能填 "human"、"synthetic" 或 "robot"',
    '- "age"：整数年龄（0–200），不确定或非人可填 null',
    `- "look"：不会随换衣改变的外貌、疤痕、纹身、外露义体或习惯动作，${LOOK_CHARS} 字以内`,
    `- "outfit"：开局日常穿着，${OUTFIT_CHARS} 字以内`,
    `- "voice"：说话语速、腔调、口癖与被踩痛处时的语气变化，${VOICE_CHARS} 字以内`,
    `- "samples"：2–3 句符合人物口吻的示范台词，每句 ${SAMPLE_CHARS} 字以内`,
    `- "want"：当下最迫切的诉求或图谋，${WANT_CHARS} 字以内`,
    `- "limit"：一碰就会彻底翻脸的底线或逆鳞，${LIMIT_CHARS} 字以内`,
    `- "initialDoing"：开局时正在忙的近况，${INITIAL_DOING_CHARS} 字以内`,
    request.preserveSpoilers
      ? '- "bio" 与 "secret"：原作幕后设定已锁定防剧透，这两个字段必须原样返回空字符串 ""'
      : `- "bio"：生平背景与性格底色，${BIO_CHARS} 字以内\n- "secret"：暗中隐瞒的秘密或致命软肋，${SECRET_CHARS} 字以内`,
    "原则：扎根夜之城街头质感，避免龙傲天或浮夸设定；若提供了已有卡面，优先保留未要求改动的原有设定，仅按玩家要求补全或改写。",
  ].join("\n");

  const existing = request.existing;
  const existingSummary = existing
    ? [
        existing.name ? `姓名：${existing.name}` : "",
        existing.alias ? `外号：${existing.alias}` : "",
        existing.role ? `身份：${existing.role}` : "",
        existing.faction ? `势力：${existing.faction}` : "",
        existing.home ? `常驻：${existing.home}` : "",
        existing.look ? `外貌：${existing.look}` : "",
        existing.outfit ? `穿着：${existing.outfit}` : "",
        existing.voice ? `口吻：${existing.voice}` : "",
        existing.want ? `诉求：${existing.want}` : "",
        existing.limit ? `底线：${existing.limit}` : "",
        !request.preserveSpoilers && existing.bio ? `生平：${existing.bio}` : "",
        !request.preserveSpoilers && existing.secret ? `秘密：${existing.secret}` : "",
      ]
        .filter(Boolean)
        .join("\n")
    : "";

  const user = [
    existingSummary ? `已有卡面：\n${existingSummary}` : "",
    `玩家描述 / 修改要求：${request.text.trim()}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

/** 解析辅助模型返回的 NPC JSON，按 schema 上限与枚举做强校验与回退 */
export function parseNpcReply(
  text: string,
  id: string,
  request: InterpretNpcRequest,
): { readonly ok: true; readonly npc: NpcCard } | { readonly ok: false; readonly error: string } {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return { ok: false, error: "模型回复里没有合法 JSON，请重试" };
  }
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return { ok: false, error: "模型回复的 JSON 解析失败，请重试" };
  }

  const existing = request.existing;
  const name = cut(raw.name, NAME_CHARS) || cut(existing?.name, NAME_CHARS);
  const role = cut(raw.role, ROLE_CHARS) || cut(existing?.role, ROLE_CHARS);
  if (!name) return { ok: false, error: "模型没有生成人物姓名，请重试" };
  if (!role) return { ok: false, error: "模型没有生成人物身份，请重试" };

  const alias = cut(raw.alias, NAME_CHARS);
  const rawPronoun = cut(raw.pronoun, 4);
  const pronoun = VALID_PRONOUNS.has(rawPronoun)
    ? rawPronoun
    : existing?.pronoun && VALID_PRONOUNS.has(existing.pronoun)
      ? existing.pronoun
      : "TA";

  const knownFactions = new Set((request.factions ?? []).map((f) => f.id));
  const rawFaction = cut(raw.faction, 40);
  const faction =
    rawFaction === NO_FACTION || knownFactions.has(rawFaction)
      ? rawFaction
      : existing?.faction &&
          (existing.faction === NO_FACTION || knownFactions.has(existing.faction))
        ? existing.faction
        : NO_FACTION;

  const rawCircle = cut(raw.circle, 20);
  const circle: NpcCircle = VALID_CIRCLES.has(rawCircle)
    ? (rawCircle as NpcCircle)
    : inferNpcCircle({ faction, role });

  const knownLocations = new Set((request.locations ?? []).map((l) => l.id));
  const rawHome = cut(raw.home, 40);
  const home = knownLocations.has(rawHome)
    ? rawHome
    : existing?.home && knownLocations.has(existing.home)
      ? existing.home
      : undefined;

  const rawEntity = cut(raw.entity, 20);
  const entity = VALID_ENTITIES.has(rawEntity)
    ? (rawEntity as "human" | "synthetic" | "robot")
    : (existing?.entity ?? "human");

  const age =
    typeof raw.age === "number" && Number.isInteger(raw.age) && raw.age >= 0 && raw.age <= 200
      ? raw.age
      : existing?.age;

  const look =
    cut(raw.look, LOOK_CHARS) ||
    cut(existing?.look, LOOK_CHARS) ||
    `${name}，${role}，夜之城街角一眼就能认出的面孔`;
  const outfit = cut(raw.outfit, OUTFIT_CHARS);
  const voice =
    cut(raw.voice, VOICE_CHARS) ||
    cut(existing?.voice, VOICE_CHARS) ||
    "语速平稳直接，带着夜之城街头人特有的分寸感与警惕";
  const samples = Array.isArray(raw.samples)
    ? raw.samples
        .map((s) => cut(s, SAMPLE_CHARS))
        .filter(Boolean)
        .slice(0, NPC_SAMPLES_MAX)
    : (existing?.samples ?? []);
  const want =
    cut(raw.want, WANT_CHARS) ||
    cut(existing?.want, WANT_CHARS) ||
    `在夜之城稳住作为${role}的门路与生计`;
  const limit =
    cut(raw.limit, LIMIT_CHARS) ||
    cut(existing?.limit, LIMIT_CHARS) ||
    "绝不为不值得的人搭上性命，也不容忍背后捅刀";
  const initialDoing = cut(raw.initialDoing, INITIAL_DOING_CHARS);

  const bio = request.preserveSpoilers ? existing?.bio : cut(raw.bio, BIO_CHARS) || undefined;
  const secret = request.preserveSpoilers
    ? existing?.secret
    : cut(raw.secret, SECRET_CHARS) || undefined;

  const parsed = NpcCardSchema.safeParse({
    id,
    name,
    ...(alias ? { alias } : {}),
    pronoun,
    role,
    faction,
    circle,
    ...(age !== undefined ? { age } : {}),
    ...(existing?.adult !== undefined ? { adult: existing.adult } : {}),
    entity,
    look,
    ...(outfit ? { outfit } : {}),
    voice,
    samples,
    want,
    limit,
    ...(bio ? { bio } : {}),
    ...(secret ? { secret } : {}),
    ...(home ? { home } : {}),
    ...(existing?.hangouts?.length ? { hangouts: existing.hangouts } : {}),
    ...(initialDoing ? { initialDoing } : {}),
    canon: Boolean(existing?.canon),
    body: {
      gear: existing?.body?.gear ?? [],
      cyberware: existing?.body?.cyberware ?? [],
      ...(existing?.body?.symptoms ? { symptoms: existing.body.symptoms } : {}),
    },
  });
  if (!parsed.success) {
    return { ok: false, error: "模型生成的人物卡不符合格式，请重试" };
  }
  return { ok: true, npc: parsed.data };
}

/** 调辅助模型按一句话描述生成或局部润色 NPC 人物卡；不进回合日志 */
export async function interpretNpc(
  llm: LlmClient,
  request: InterpretNpcRequest,
  id: string,
  signal?: AbortSignalLike,
): Promise<
  { readonly ok: true; readonly npc: NpcCard } | { readonly ok: false; readonly error: string }
> {
  let text = "";
  let finishReason: string | null = null;
  for await (const event of llm.stream(
    {
      purpose: "aux",
      messages: buildNpcPrompt(request),
      maxOutputTokens: 1400,
      temperature: 0.55,
      responseFormat: responseJsonSchema("npc_card", NpcReplySchema),
    },
    signal,
  )) {
    if (event.type === "text") text += event.text;
    else if (event.type === "blocked") {
      return { ok: false, error: `模型拒绝了这段人物设定：${event.reason}` };
    } else if (event.type === "done") {
      finishReason = event.finishReason;
    }
  }
  if (finishReason === null) {
    return { ok: false, error: "人物设定回复未收到完整结束标记，请重试" };
  }
  if (isLengthFinish(finishReason)) {
    return { ok: false, error: "人物设定输出达到长度上限被截断，请提高最大输出配置后重试" };
  }
  if (!completeFinish(finishReason)) {
    return {
      ok: false,
      error: `人物设定回复未正常结束（${finishReason || "未知原因"}），请重试`,
    };
  }
  if (!text.trim()) {
    return { ok: false, error: "模型没有返回有效的人物设定，请重试" };
  }
  return parseNpcReply(text, id, request);
}
