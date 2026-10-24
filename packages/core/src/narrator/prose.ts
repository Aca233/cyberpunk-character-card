import { z } from "zod";
import type { AbortSignalLike, LlmClient, LlmMessage } from "../kernel/ports";
import { BoardSchema, boardBrief } from "../schemas/board";
import {
  PROSE_BLOCK_INFO,
  PROSE_BLOCKS,
  type ProseBlock,
  ProseBlockSchema,
} from "../schemas/character";
import { ATTRIBUTE_LABELS, type Attribute, AttributeSchema } from "../systems/dice/schema";

/**
 * 角色正文：按名片、属性、主板和别的区块，让辅助模型写外貌、背景故事、性格、说话方式、
 * 场景、开场白和对话示例。四种写法：生成（不看原文）、重写（换个写法）、续写（接着原文往下写）、
 * 润色（不改内容只改文字）。锁定的区块不能写，写别的区块时当作定稿。流式返回，不进回合日志
 */

export const PROSE_MODES = ["generate", "rewrite", "continue", "polish"] as const;
export const ProseModeSchema = z.enum(PROSE_MODES);
export type ProseMode = z.infer<typeof ProseModeSchema>;

export const PROSE_MODE_LABELS: Readonly<Record<ProseMode, string>> = {
  generate: "生成",
  rewrite: "重写",
  continue: "续写",
  polish: "润色",
};

const text = (max: number) => z.string().trim().max(max).default("");

/** 写正文时用到的角色卡部分；编辑中的卡可能还没填完，不校验预算和必填 */
export const ProseCardSchema = z.object({
  name: z.string().trim().min(1, "先给角色起个名字").max(20),
  alias: text(20),
  pronoun: z.string().trim().min(1).max(4).default("TA"),
  origin: text(40),
  skills: text(400),
  attributes: z.partialRecord(AttributeSchema, z.number().int()).optional(),
  board: BoardSchema.optional(),
  look: text(PROSE_BLOCK_INFO.look.max),
  past: text(PROSE_BLOCK_INFO.past.max),
  personality: text(PROSE_BLOCK_INFO.personality.max),
  voice: text(PROSE_BLOCK_INFO.voice.max),
  scene: text(PROSE_BLOCK_INFO.scene.max),
  greeting: text(PROSE_BLOCK_INFO.greeting.max),
  examples: text(PROSE_BLOCK_INFO.examples.max),
  locked: z.array(ProseBlockSchema).default([]),
});
export type ProseCard = z.infer<typeof ProseCardSchema>;

export const ProseRequestSchema = z.object({
  card: ProseCardSchema,
  block: ProseBlockSchema,
  mode: ProseModeSchema,
  /** 玩家的额外要求，例如“更冷一点”“提到她妹妹” */
  instruction: z.string().trim().max(200).default(""),
});
export type ProseRequest = z.infer<typeof ProseRequestSchema>;

/** 续写时至少还要剩这么多字，才值得调一次模型 */
const CONTINUE_MIN_ROOM = 30;

/** 这次请求能不能写；不能写时给出原因 */
export function proseProblem(request: ProseRequest): string | null {
  const { card, block, mode } = request;
  const info = PROSE_BLOCK_INFO[block];
  if (card.locked.includes(block)) return `「${info.label}」锁定了，先解锁再让模型写`;
  const current = card[block];
  if (mode !== "generate" && current === "") {
    return `「${info.label}」还是空的，没有可以${PROSE_MODE_LABELS[mode]}的内容，先生成一段`;
  }
  if (mode === "continue" && info.max - current.length < CONTINUE_MIN_ROOM) {
    return `「${info.label}」快到 ${info.max} 字上限了，续写不下`;
  }
  return null;
}

/** 这次最多能写多少字：续写只剩下原文后面的空间 */
export function proseRoom(request: ProseRequest): number {
  const { max } = PROSE_BLOCK_INFO[request.block];
  return request.mode === "continue" ? max - request.card[request.block].length - 1 : max;
}

const BLOCK_GUIDE: Readonly<Record<ProseBlock, string>> = {
  look: "第三人称写外人第一眼看到的样子：衣着、神态、义体、伤疤，具体到能画出来",
  past: "第三人称写成几段连贯的经历，把主板上的出身、过往和负面经历串起来，留下没了结的线头",
  personality: "写这个人在乎什么、忍不了什么、习惯藏起什么、在压力下会怎样；不要罗列形容词",
  voice: "写说话的方式：语速、口头禅、爱用的词和黑话、对不同的人怎么说话；可以举一两个短例子",
  scene: "第三人称写故事开始时角色身在夜之城何处、手头在忙什么、眼下的处境",
  greeting:
    "第三人称写角色登场的一小段描写（动作、环境、神态），可以带一句角色自己说的话；不写别人的反应",
  examples: "写 3–5 句这个角色会说的话，一句一行，每行开头不加编号；贴着说话方式，涵盖不同情绪",
};

function attributesLine(card: ProseCard): string {
  if (!card.attributes) return "";
  const parts = (Object.keys(ATTRIBUTE_LABELS) as Attribute[]).flatMap((a) => {
    const v = card.attributes?.[a];
    return v === undefined ? [] : [`${ATTRIBUTE_LABELS[a]} ${v}`];
  });
  return parts.length > 0 ? `属性（3 普通，6 出众）：${parts.join("、")}` : "";
}

export function buildProsePrompt(request: ProseRequest): LlmMessage[] {
  const { card, block, mode, instruction } = request;
  const info = PROSE_BLOCK_INFO[block];
  const room = proseRoom(request);
  const system = [
    "你在帮玩家写《赛博朋克 2077》夜之城文字角色扮演游戏里玩家角色的角色卡正文。用简体中文。",
    `这次写「${info.label}」：${BLOCK_GUIDE[block]}。`,
    `最多 ${room} 字。只输出正文本身，不要标题、引号、代码块或解释。`,
    "原则：贴着已有的设定写，不和定稿的区块矛盾；不夸大，角色是夜之城里的普通人，不是传奇；不替玩家添加主板、已有文字和玩家要求里都没有的重大设定（新的亲人、仇家、身份）；原作的主要角色只能作为传闻提到。",
  ].join("\n");
  const others = PROSE_BLOCKS.filter((b) => b !== block && card[b] !== "").map(
    (b) =>
      `【${PROSE_BLOCK_INFO[b].label}${card.locked.includes(b) ? "（定稿）" : ""}】\n${card[b]}`,
  );
  const current = card[block];
  const task: Readonly<Record<ProseMode, string>> = {
    generate: `写一段新的「${info.label}」。`,
    rewrite: `重写「${info.label}」：保留设定事实，换一种写法和切入点，不要照抄原文的句子。\n原文：\n${current}`,
    continue: `接着「${info.label}」的原文往下写，只输出接上去的新内容，不要重复原文。\n原文：\n${current}`,
    polish: `润色「${info.label}」：不增删设定和情节，只让文字更利落、更有画面，改掉前后矛盾的地方。\n原文：\n${current}`,
  };
  const user = [
    `名字：${card.name}${card.alias ? `，外号${card.alias}` : ""}；人称：${card.pronoun}${card.origin ? `；出身：${card.origin}` : ""}`,
    attributesLine(card),
    card.board ? boardBrief(card.board) : "",
    card.skills && `本事：${card.skills}`,
    ...others,
    instruction && `玩家的要求：${instruction}`,
    task[mode],
  ]
    .filter((p) => p !== "")
    .join("\n\n");
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

export type ProseEvent =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "error"; readonly message: string }
  /** truncated：模型写超了字数，后面的被截掉 */
  | { readonly type: "done"; readonly truncated: boolean };

/** 调辅助模型写一个区块，边写边吐；超出字数的部分截掉。模型连接出错由调用方处理 */
export async function* streamProse(
  llm: LlmClient,
  request: ProseRequest,
  signal?: AbortSignalLike,
): AsyncGenerator<ProseEvent> {
  const problem = proseProblem(request);
  if (problem) {
    yield { type: "error", message: problem };
    return;
  }
  const room = proseRoom(request);
  let written = 0;
  let started = false;
  for await (const event of llm.stream(
    {
      purpose: "aux",
      messages: buildProsePrompt(request),
      maxOutputTokens: Math.min(2000, room * 2 + 200),
      temperature: request.mode === "polish" ? 0.5 : 0.9,
    },
    signal,
  )) {
    if (event.type === "blocked") {
      yield { type: "error", message: `模型拒绝写这段：${event.reason}` };
      return;
    }
    if (event.type !== "text") continue;
    // 开头的空白不要：续写时由调用方接在原文后面
    let piece = started ? event.text : event.text.trimStart();
    if (piece === "") continue;
    started = true;
    if (written + piece.length > room) {
      piece = piece.slice(0, room - written);
      if (piece !== "") yield { type: "text", text: piece };
      yield { type: "done", truncated: true };
      return;
    }
    written += piece.length;
    yield { type: "text", text: piece };
  }
  yield { type: "done", truncated: false };
}
