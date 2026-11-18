import { z } from "zod";
import type { AbortSignalLike, LlmClient, LlmMessage } from "../kernel/ports";
import {
  BOARD_SLOT_LABELS,
  type Board,
  type BoardModule,
  BoardModuleSchema,
  type BoardSlot,
  boardModules,
} from "../schemas/board";
import { responseJsonSchema } from "./doc";

/**
 * 自写模块的解读：玩家写一段设定，辅助模型整理成模块（名字、标签、能力、钩子、人物），
 * 和原作设定冲突的地方只提醒
 */

export const ModuleReplySchema = z.object({
  label: z.string(),
  tags: z.array(z.string()),
  ability: z.string(),
  hook: z.string(),
  people: z.array(z.object({ name: z.string(), role: z.string() })),
  conflicts: z.array(z.string()),
});

export interface ModuleRequest {
  readonly slot: BoardSlot;
  /** 玩家写的设定 */
  readonly text: string;
  /** 主板上已经插着的模块，让模型别重复 */
  readonly board?: Board | undefined;
  /** 模块库里用过的标签：尽量沿用，方便分类筛选与检定判断 */
  readonly knownTags?: readonly string[];
}

export interface ModuleReading {
  readonly module: BoardModule;
  /** 和原作设定冲突、或者被代码改过的地方 */
  readonly warnings: readonly string[];
}

export function buildModulePrompt(request: ModuleRequest): LlmMessage[] {
  const label = BOARD_SLOT_LABELS[request.slot];
  const system = [
    "你在帮玩家把自己写的一段角色设定，整理成《赛博朋克 2077》夜之城文字角色扮演游戏里的一块“模块”。",
    "只输出一个 JSON 对象，不要代码块，不要别的文字。字段：",
    '- "label"：模块名，24 字以内',
    `- "tags"：1–6 个标签，每个 12 字以内；能用这些现成标签就用：${(request.knownTags ?? []).join("、") || "（无）"}`,
    `- "ability"：200 字以内，${request.slot === "flaw" ? "这段负面缺陷让角色眼下处在什么真实处境" : "这块模块让角色实际懂什么手艺、掌握什么经验或门路"}，写具体、扎实的事实，方便叙事根据真实能力判断`,
    '- "hook"：200 字以内，叙事可以拿来做文章的剧情线头；没有就写空字符串',
    `- "people"：${request.slot === "past" || request.slot === "flaw" ? "0–2 个带出的人物" : "空数组"}，每个 {"name": 20 字以内, "role": 80 字以内}；用自创的名字，不用原作的主要角色`,
    '- "conflicts"：和原作设定冲突、或者能力过强被你压下来的地方，一条一句；没有就空数组',
    "原则：不要夸大，一段经历不会让角色成为传奇；超出常人的能力降到合理范围，并在 conflicts 里说明。不要替玩家添加他们没写的重大设定。",
  ].join("\n");
  const placed = request.board ? boardModules(request.board) : [];
  const user = [
    `插槽：${label}`,
    `玩家写的：${request.text.trim()}`,
    placed.length > 0 &&
      `主板上已经插着：${placed.map((m) => `${BOARD_SLOT_LABELS[m.slot]}「${m.label}」`).join("、")}`,
  ]
    .filter(Boolean)
    .join("\n");
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

const cut = (value: unknown, max: number) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

/** 读模型的回复：找出 JSON 对象，过长的截短 */
export function parseModuleReply(
  text: string,
  slot: BoardSlot,
  id: string,
):
  | { readonly ok: true; readonly reading: ModuleReading }
  | { readonly ok: false; readonly error: string } {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return { ok: false, error: "模型的回复里没有 JSON，可以重新解读" };
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return { ok: false, error: "模型的回复不是合法的 JSON，可以重新解读" };
  }
  const warnings: string[] = Array.isArray(raw.conflicts)
    ? raw.conflicts.map((c) => cut(c, 120)).filter((c) => c !== "")
    : [];
  const label = cut(raw.label, 24);
  if (label === "") return { ok: false, error: "模型没有给模块起名字，可以重新解读" };
  const tags = Array.isArray(raw.tags)
    ? [...new Set(raw.tags.map((t) => cut(t, 12)).filter((t) => t !== ""))].slice(0, 6)
    : [];
  const people =
    slot === "past" || slot === "flaw"
      ? (Array.isArray(raw.people) ? raw.people : [])
          .map((p) => {
            const person = (p ?? {}) as Record<string, unknown>;
            return { name: cut(person.name, 20), role: cut(person.role, 80) };
          })
          .filter((p) => p.name !== "")
          .slice(0, 2)
      : [];
  const parsed = BoardModuleSchema.safeParse({
    id,
    slot,
    label,
    tags,
    ability: cut(raw.ability, 200),
    hook: cut(raw.hook, 200),
    people,
    checks: [],
    custom: true,
  });
  if (!parsed.success) return { ok: false, error: "模型给的模块不合格式，可以重新解读" };
  return { ok: true, reading: { module: parsed.data, warnings } };
}

/** 调辅助模型解读一块自写模块；不进回合日志 */
export async function interpretModule(
  llm: LlmClient,
  request: ModuleRequest,
  id: string,
  signal?: AbortSignalLike,
): Promise<
  | { readonly ok: true; readonly reading: ModuleReading }
  | { readonly ok: false; readonly error: string }
> {
  let text = "";
  for await (const event of llm.stream(
    {
      purpose: "aux",
      messages: buildModulePrompt(request),
      maxOutputTokens: 800,
      temperature: 0.4,
      responseFormat: responseJsonSchema("module", ModuleReplySchema),
    },
    signal,
  )) {
    if (event.type === "text") text += event.text;
    else if (event.type === "blocked")
      return { ok: false, error: `模型拒绝了这段设定：${event.reason}` };
  }
  return parseModuleReply(text, request.slot, id);
}
