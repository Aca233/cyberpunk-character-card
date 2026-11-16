import { z } from "zod";
import type { AbortSignalLike, LlmClient, LlmMessage } from "../kernel/ports";
import {
  BOARD_SLOT_LABELS,
  type BoardModule,
  BoardSchema,
  type BoardSlot,
  FLAW_MAX,
  PAST_MAX,
  PAST_MIN,
  SKILL_MAX,
  SKILL_MIN,
} from "../schemas/board";
import {
  type CharacterCard,
  CharacterCardSchema,
  DEFAULT_CARD_ATTRIBUTES,
  PROSE_BLOCK_INFO,
} from "../schemas/character";
import { responseJsonSchema } from "./doc";

/**
 * Character Card V2（SillyTavern 等通用的角色卡格式）的导入和导出。
 * 导出时整张卡放进 extensions.cp2077，导回来原样还原；别处来的卡先按字段对上正文，
 * 再交给辅助模型从模块库里挑模块，仅检查模块类型、重复项与插槽数量，玩家确认后才保存。
 */

const EXTENSION_KEY = "cp2077";
const EXTENSION_VERSION = 1;

/** 从卡里读到的文字；V1（字段在最外层）和 V2（字段在 data 里）都认 */
export interface TavernCard {
  readonly name: string;
  readonly description: string;
  readonly personality: string;
  readonly scenario: string;
  readonly firstMes: string;
  readonly mesExample: string;
  readonly tags: readonly string[];
  /** 本作导出的卡带着整张角色卡 */
  readonly own?: CharacterCard;
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

export function readTavernCard(
  raw: unknown,
):
  | { readonly ok: true; readonly card: TavernCard }
  | { readonly ok: false; readonly error: string } {
  if (typeof raw !== "object" || raw === null)
    return { ok: false, error: "不是角色卡：内容不是 JSON 对象" };
  const outer = raw as Record<string, unknown>;
  const data =
    typeof outer.data === "object" && outer.data !== null
      ? (outer.data as Record<string, unknown>)
      : outer;
  const name = str(data.name).trim();
  if (name === "") return { ok: false, error: "不是角色卡：没有 name 字段" };
  const extensions = (data.extensions ?? {}) as Record<string, unknown>;
  const ext = extensions[EXTENSION_KEY] as Record<string, unknown> | undefined;
  const own = ext ? CharacterCardSchema.safeParse(ext.card) : undefined;
  return {
    ok: true,
    card: {
      name,
      description: str(data.description),
      personality: str(data.personality),
      scenario: str(data.scenario),
      firstMes: str(data.first_mes),
      mesExample: str(data.mes_example),
      tags: Array.isArray(data.tags)
        ? data.tags.filter((t): t is string => typeof t === "string")
        : [],
      ...(own?.success ? { own: own.data } : {}),
    },
  };
}

/** 卡里的占位符换成名字；对话示例去掉 <START> 分隔 */
function clean(text: string, name: string): string {
  return text
    .replace(/\{\{char\}\}|<BOT>/gi, name)
    .replace(/\{\{user\}\}|<USER>/gi, "对方")
    .replace(/<START>/gi, "")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** 不用模型：只把文字对上正文，主板留空、属性全是 3，让玩家自己插 */
export function tavernToCard(tavern: TavernCard): { card: CharacterCard; warnings: string[] } {
  if (tavern.own) return { card: tavern.own, warnings: [] };
  const warnings: string[] = [];
  const fit = (label: string, text: string, max: number) => {
    const t = clean(text, tavern.name);
    if (t.length > max)
      warnings.push(`${label}原文 ${t.length} 字，只留了前 ${max} 字，可以再润色`);
    return t.slice(0, max);
  };
  const name = tavern.name.slice(0, 20);
  if (name !== tavern.name) warnings.push("名字超过 20 字，截短了");
  const card: CharacterCard = {
    name,
    alias: "",
    pronoun: "TA",
    origin: "未定",
    look: "",
    past: fit("描述", tavern.description, PROSE_BLOCK_INFO.past.max),
    personality: fit("性格", tavern.personality, PROSE_BLOCK_INFO.personality.max),
    voice: "",
    skills: "",
    scene: fit("场景", tavern.scenario, PROSE_BLOCK_INFO.scene.max),
    greeting: fit("开场白", tavern.firstMes, PROSE_BLOCK_INFO.greeting.max),
    examples: fit("对话示例", tavern.mesExample, PROSE_BLOCK_INFO.examples.max),
    locked: [],
    attributes: { ...DEFAULT_CARD_ATTRIBUTES },
  };
  return { card, warnings };
}

/** 导出成 Character Card V2；整张卡放在 extensions.cp2077，导回本作时原样还原 */
export function exportTavernCard(card: CharacterCard): Record<string, unknown> {
  const description = [
    `出身：${card.origin}`,
    card.look && `外貌：${card.look}`,
    card.past && `经历：${card.past}`,
    card.skills && `本事：${card.skills}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  return {
    spec: "chara_card_v2",
    spec_version: "2.0",
    data: {
      name: card.name,
      description,
      personality: [card.personality, card.voice && `说话方式：${card.voice}`]
        .filter(Boolean)
        .join("\n"),
      scenario: card.scene,
      first_mes: card.greeting,
      mes_example: card.examples
        ? `<START>\n${card.examples
            .split("\n")
            .filter((l) => l.trim() !== "")
            .map((l) => `{{char}}: ${l.trim()}`)
            .join("\n")}`
        : "",
      creator_notes: "《赛博朋克 2077》文字角色扮演的角色卡；主板设定在 extensions.cp2077",
      system_prompt: "",
      post_history_instructions: "",
      alternate_greetings: [],
      tags: ["cyberpunk2077", ...(card.board?.origin ? [card.board.origin.label] : [])],
      creator: "",
      character_version: "",
      extensions: { [EXTENSION_KEY]: { version: EXTENSION_VERSION, card } },
    },
  };
}

export const TavernImportReplySchema = z.object({
  pronoun: z.string(),
  alias: z.string(),
  origin: z.string(),
  pasts: z.array(z.string()),
  skills: z.array(z.string()),
  flaws: z.array(z.string()),
  look: z.string(),
  voice: z.string(),
  skillsText: z.string(),
  conflicts: z.array(z.string()),
});

export function buildImportPrompt(
  tavern: TavernCard,
  modules: readonly BoardModule[],
): LlmMessage[] {
  const library = modules
    .map((m) => `${m.id}｜${BOARD_SLOT_LABELS[m.slot]}｜${m.label}｜${m.ability}`)
    .join("\n");
  const system = [
    "你在帮玩家把一张别处的角色卡，改成《赛博朋克 2077》夜之城文字角色扮演游戏的角色。",
    "只输出一个 JSON 对象，不要代码块，不要别的文字。字段：",
    '- "pronoun"：他、她或 TA',
    '- "alias"：外号，没有就空字符串，20 字以内',
    '- "origin"：出身模块的 id',
    `- "pasts"：${PAST_MIN}–${PAST_MAX} 个过往模块的 id`,
    `- "skills"：${SKILL_MIN}–${SKILL_MAX} 个${BOARD_SLOT_LABELS.skill}模块的 id`,
    `- "flaws"：0–${FLAW_MAX} 个${BOARD_SLOT_LABELS.flaw}模块的 id`,
    `- "look"：从描述里整理外貌，${PROSE_BLOCK_INFO.look.max} 字以内；描述里没有就空字符串`,
    `- "voice"：从描述和对话示例里整理说话方式，${PROSE_BLOCK_INFO.voice.max} 字以内`,
    `- "skillsText"：会什么、不会什么（专长与短板），400 字以内`,
    '- "conflicts"：和夜之城设定冲突、没有合适模块、或者能力过强被你压下来的地方，一条一句',
    "规则：模块只能从下面的模块库里挑，用 id，不要超过各插槽的数量上限。",
    "不要夸大：魔法、超能力、异世界的设定换成夜之城里说得通的东西，或者在 conflicts 里说明舍掉了。",
    "模块库（id｜插槽｜名字｜能力）：",
    library,
  ].join("\n");
  const user = [
    `名字：${tavern.name}`,
    tavern.description && `描述：${clean(tavern.description, tavern.name).slice(0, 3000)}`,
    tavern.personality && `性格：${clean(tavern.personality, tavern.name).slice(0, 800)}`,
    tavern.scenario && `场景：${clean(tavern.scenario, tavern.name).slice(0, 800)}`,
    tavern.mesExample && `对话示例：${clean(tavern.mesExample, tavern.name).slice(0, 1200)}`,
    tavern.tags.length > 0 && `标签：${tavern.tags.slice(0, 12).join("、")}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

const cut = (value: unknown, max: number) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

/** 模型挑的模块：不认识的、插错槽的、重复的去掉，超出块数的丢掉 */
function pickModules(
  ids: unknown,
  slot: BoardSlot,
  max: number,
  modules: readonly BoardModule[],
  warnings: string[],
): BoardModule[] {
  const picked: BoardModule[] = [];
  for (const id of Array.isArray(ids) ? ids : []) {
    const m = modules.find((x) => x.id === id);
    if (!m || m.slot !== slot) {
      warnings.push(`模块库里没有${BOARD_SLOT_LABELS[slot]}模块「${String(id)}」，去掉了`);
      continue;
    }
    if (picked.some((p) => p.id === m.id)) continue;
    if (picked.length >= max) {
      warnings.push(`${BOARD_SLOT_LABELS[slot]}最多 ${max} 块，「${m.label}」没插上`);
      continue;
    }
    picked.push(m);
  }
  return picked;
}

/** 读模型的回复，和直接对上的正文合成一张卡（仅按插槽数量上限约束） */
export function parseImportReply(
  text: string,
  tavern: TavernCard,
  modules: readonly BoardModule[],
):
  | { readonly ok: true; readonly card: CharacterCard; readonly warnings: readonly string[] }
  | { readonly ok: false; readonly error: string } {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return { ok: false, error: "模型的回复里没有 JSON，可以重新导入" };
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return { ok: false, error: "模型的回复不是合法的 JSON，可以重新导入" };
  }
  const base = tavernToCard(tavern);
  const warnings: string[] = Array.isArray(raw.conflicts)
    ? raw.conflicts.map((c) => cut(c, 120)).filter((c) => c !== "")
    : [];
  warnings.push(...base.warnings);
  const origin = pickModules([raw.origin], "origin", 1, modules, warnings)[0] ?? null;
  if (!origin) warnings.push("没挑出合适的出身，回主板选一个");
  const board = BoardSchema.parse({
    origin,
    pasts: pickModules(raw.pasts, "past", PAST_MAX, modules, warnings),
    skills: pickModules(raw.skills, "skill", SKILL_MAX, modules, warnings),
    flaws: pickModules(raw.flaws, "flaw", FLAW_MAX, modules, warnings),
  });
  if (board.pasts.length < PAST_MIN)
    warnings.push(`过往只有 ${board.pasts.length} 块，至少要 ${PAST_MIN} 块`);
  if (board.skills.length < SKILL_MIN)
    warnings.push(`本事只有 ${board.skills.length} 块，至少要 ${SKILL_MIN} 块`);
  const pronoun = cut(raw.pronoun, 4);
  const card: CharacterCard = {
    ...base.card,
    pronoun: pronoun === "" ? "TA" : pronoun,
    alias: cut(raw.alias, 20),
    origin: origin?.label ?? base.card.origin,
    look: cut(raw.look, PROSE_BLOCK_INFO.look.max),
    voice: cut(raw.voice, PROSE_BLOCK_INFO.voice.max),
    skills: cut(raw.skillsText, 400),
    attributes: { ...DEFAULT_CARD_ATTRIBUTES },
    board,
  };
  return { ok: true, card, warnings };
}

/** 调辅助模型解读导入的卡；本作导出的卡原样还原，不调模型 */
export async function interpretTavernCard(
  llm: LlmClient,
  tavern: TavernCard,
  modules: readonly BoardModule[],
  signal?: AbortSignalLike,
): Promise<
  | { readonly ok: true; readonly card: CharacterCard; readonly warnings: readonly string[] }
  | { readonly ok: false; readonly error: string }
> {
  if (tavern.own) return { ok: true, card: tavern.own, warnings: [] };
  let text = "";
  for await (const event of llm.stream(
    {
      purpose: "aux",
      messages: buildImportPrompt(tavern, modules),
      maxOutputTokens: 1500,
      temperature: 0.3,
      responseFormat: responseJsonSchema("tavernImport", TavernImportReplySchema),
    },
    signal,
  )) {
    if (event.type === "text") text += event.text;
    else if (event.type === "blocked")
      return { ok: false, error: `模型拒绝解读这张卡：${event.reason}` };
  }
  return parseImportReply(text, tavern, modules);
}

/** 服务端收的导入请求：网页先读出文件里的 JSON（PNG 卡从 chara 块里取） */
export const ImportRequestSchema = z.object({
  raw: z.unknown(),
  /** false：不调模型，只对上文字 */
  useModel: z.boolean().default(true),
});
