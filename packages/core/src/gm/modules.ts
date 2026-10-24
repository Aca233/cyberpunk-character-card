import type { AbortSignalLike, LlmClient, LlmMessage } from "../kernel/ports";
import {
  BOARD_SLOT_LABELS,
  type Board,
  type BoardModule,
  BoardModuleSchema,
  type BoardSlot,
  boardModules,
  MODULE_POINTS,
} from "../schemas/board";
import { ATTRIBUTE_LABELS, type Attribute } from "../systems/dice/schema";

/**
 * 自写模块的解读：玩家写一段设定，辅助模型整理成模块（名字、建议标价、标签、能力、钩子、人物、
 * 加成属性），和原作设定冲突的地方只提醒。标价由代码截到插槽的范围里，玩家还可以手动改
 */

export interface ModuleRequest {
  readonly slot: BoardSlot;
  /** 玩家写的设定 */
  readonly text: string;
  /** 主板上已经插着的模块，让模型别重复、能对上联动 */
  readonly board?: Board | undefined;
  /** 模块库里用过的标签：尽量沿用，联动才对得上 */
  readonly knownTags?: readonly string[];
}

export interface ModuleReading {
  readonly module: BoardModule;
  /** 和原作设定冲突、或者被代码改过的地方 */
  readonly warnings: readonly string[];
}

const ATTRIBUTES = Object.keys(ATTRIBUTE_LABELS) as Attribute[];

export function buildModulePrompt(request: ModuleRequest): LlmMessage[] {
  const label = BOARD_SLOT_LABELS[request.slot];
  const [min, max] = MODULE_POINTS[request.slot];
  const pricing =
    request.slot === "flaw"
      ? `points 是返还的背景点，${min}–${max}：麻烦越大、越容易找上门，返还越多`
      : request.slot === "origin"
        ? `points 是花费的背景点，${min}–${max}：普通出身 0，自带明显优势的出身 1–2`
        : `points 是花费的背景点，${min}–${max}：普通 1–2，强力 3–4（能直接解决一类难题的才算强力）`;
  const system = [
    "你在帮玩家把自己写的一段角色设定，整理成《赛博朋克 2077》夜之城文字角色扮演游戏里的一块“模块”。",
    "只输出一个 JSON 对象，不要代码块，不要别的文字。字段：",
    '- "label"：模块名，24 字以内',
    `- "points"：整数，${pricing}`,
    `- "tags"：1–6 个标签，每个 12 字以内；能用这些现成标签就用：${(request.knownTags ?? []).join("、") || "（无）"}`,
    `- "ability"：200 字以内，${request.slot === "flaw" ? "这段负面经历让角色眼下处在什么处境" : "这块模块让角色已经能做到什么"}，写具体的、主持人能据此判断行动可不可行的事`,
    '- "hook"：200 字以内，主持人可以拿来做文章的剧情线头；没有就写空字符串',
    `- "people"：${request.slot === "past" || request.slot === "flaw" ? "0–2 个带出的人物" : "空数组"}，每个 {"name": 20 字以内, "role": 80 字以内}；用自创的名字，不用原作的主要角色`,
    `- "checks"：0–2 个做检定时算有利条件的属性，只能从 ${ATTRIBUTES.join("、")} 里选（${ATTRIBUTES.map((a) => `${a}=${ATTRIBUTE_LABELS[a]}`).join("，")}）`,
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

/** 读模型的回复：找出 JSON 对象，过长的截短，标价截到插槽范围，不认识的属性去掉 */
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
  const [min, max] = MODULE_POINTS[slot];
  const suggested = typeof raw.points === "number" ? Math.round(raw.points) : min;
  const points = Math.min(max, Math.max(min, suggested));
  if (points !== suggested) warnings.push(`建议标价 ${suggested} 点超出范围，改成 ${points} 点`);
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
  const checks = Array.isArray(raw.checks)
    ? [
        ...new Set(raw.checks.filter((c): c is Attribute => ATTRIBUTES.includes(c as Attribute))),
      ].slice(0, 2)
    : [];
  const parsed = BoardModuleSchema.safeParse({
    id,
    slot,
    label,
    points,
    tags,
    ability: cut(raw.ability, 200),
    hook: cut(raw.hook, 200),
    people,
    checks,
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
    },
    signal,
  )) {
    if (event.type === "text") text += event.text;
    else if (event.type === "blocked")
      return { ok: false, error: `模型拒绝了这段设定：${event.reason}` };
  }
  return parseModuleReply(text, request.slot, id);
}
