import { z } from "zod";
import type { AbortSignalLike, LlmClient, LlmMessage } from "../kernel/ports";
import {
  ACQUAINTANCE_NOTE_CHARS,
  type Acquaintance,
  BoardSchema,
  boardBrief,
  RELATION_INFO,
} from "../schemas/board";
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
 * 润色（不改内容只改文字）。锁定的区块不能写，写别的区块时当作定稿。流式返回，不进回合日志。
 * 另有一键成稿（第三期，用户定的 2026-10-30："保留逐块重写、续写、润色、锁定，加一键成稿"）：
 * 一次写外貌、背景故事、性格、说话方式四块，顺带补旧识"是什么事"
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
  look: "第三人称写外人第一眼看到的外在形象：衣着质感、站姿神态、外显机械义体与陈旧伤疤，具体到能让读者脑海中浮现清晰构图",
  past: "第三人称写成因果连贯的生平经历，把主板上的出身、过往和负面经历自然缝合，留下悬而未决的因果线头",
  personality:
    "写这个人的价值信条、行事底线、极度在乎或无法容忍的事物、高压下的应激反应；拒绝空洞罗列形容词",
  voice: "写言谈风格：语速节奏、口头禅、惯用黑话行话、对不同阶层时的语态反差；附带一两句地道短例",
  scene: "第三人称描写故事揭幕时角色身处夜之城何处、手头正在进行的事务与眼下严峻的处境",
  greeting:
    "第三人称写角色初次登场的特写画面（动作、肢体语言、环境氛围），自然带出一句角色本人的现场台词；不越俎代庖替玩家决定反应",
  examples:
    "提供 3–5 句角色最真实的实战或生活台词，每句一行，每行开头不加序号；切合言谈风格，展现不同情绪张力",
};

/**
 * 逐块写和一键成稿共用的文风要求（第三期加的，2026-10-31）：两边写出来要像同一个人的手笔。
 * 示例是自己写的文风样子，不是原作文本，也不带原作人物
 */
const STYLE = [
  "原则：紧扣已有设定与事实，不与定稿区块冲突；克制收敛，角色是夜之城底层摸爬滚打的鲜活生灵，而非龙傲天救世主。",
  "文风：精准、凝练、短句主导，多用白描动作与实体名词，严控形容词泛滥；细节深度融入夜之城地标、帮派黑话与科技物件；拒绝假装深沉的无病呻吟（如“不仅……更……”“仿佛”）。",
  "示例文风（仅供领会笔触，切勿照搬）：左手小指是廉价的翻新义体，接口那圈皮肉反复排异发红，她习惯把手插在夹克侧兜里。在沃森的黑诊所打了三年白工抵债，还清那天她没庆祝，只是当着医生的面把联络人代号删得干干净净。",
  "严禁出现：最强、无敌、天选之子等夸大；霓虹灯下、眼神满是故事、不为人知的过往、“面冷心热”等网文套路词；无意义的并列排比形容词；“他是一个……的人”此类机械总结句；末尾强行抒情“这就是夜之城”；凭空捏造已有事实外的重大亲友仇家；网络热梗与英汉夹杂标签。",
  "原作人物：主板上确立为旧识的原作人物可在经历中展开交集，但必须严格遵循其在夜之城原作中的真实性格与地位；其余原作核心角色仅可作为街头传闻一笔带过。",
];

function attributesLine(card: ProseCard): string {
  if (!card.attributes) return "";
  const parts = (Object.keys(ATTRIBUTE_LABELS) as Attribute[]).flatMap((a) => {
    const v = card.attributes?.[a];
    return v === undefined ? [] : [`${ATTRIBUTE_LABELS[a]} ${v}`];
  });
  return parts.length > 0 ? `属性（3 普通，6 出众）：${parts.join("、")}` : "";
}

/** 名片、属性、主板、本事：逐块写和一键成稿都放在提示词最前面 */
function cardFacts(card: ProseCard): string[] {
  return [
    `名字：${card.name}${card.alias ? `，外号${card.alias}` : ""}；人称：${card.pronoun}${card.origin ? `；出身：${card.origin}` : ""}`,
    attributesLine(card),
    card.board ? boardBrief(card.board) : "",
    card.skills && `本事：${card.skills}`,
  ];
}

export function buildProsePrompt(request: ProseRequest): LlmMessage[] {
  const { card, block, mode, instruction } = request;
  const info = PROSE_BLOCK_INFO[block];
  const room = proseRoom(request);
  const system = [
    "你在帮玩家写《赛博朋克 2077》夜之城文字角色扮演游戏里玩家角色的角色卡正文。用简体中文。",
    `这次写「${info.label}」：${BLOCK_GUIDE[block]}。`,
    `最多 ${room} 字。只输出正文本身，不要标题、引号、代码块或解释。`,
    ...STYLE,
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
    ...cardFacts(card),
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

/** 边收边吐模型的文字，超过 room 字就截掉 */
async function* capped(
  llm: LlmClient,
  params: Parameters<LlmClient["stream"]>[0],
  room: number,
  signal?: AbortSignalLike,
): AsyncGenerator<ProseEvent> {
  let written = 0;
  let started = false;
  for await (const event of llm.stream(params, signal)) {
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
  yield* capped(
    llm,
    {
      purpose: "aux",
      messages: buildProsePrompt(request),
      maxOutputTokens: Math.min(2000, room * 2 + 200),
      temperature: request.mode === "polish" ? 0.5 : 0.9,
    },
    room,
    signal,
  );
}

// ———— 一键成稿 ————

/** 一键成稿写的四块；用户定了不做开场正文，场景、开场白、对话示例不在里面 */
export const DRAFT_BLOCKS = ["look", "past", "personality", "voice"] as const;
export type DraftBlock = (typeof DRAFT_BLOCKS)[number];

export const DraftRequestSchema = z.object({
  card: ProseCardSchema,
  /** 玩家的额外要求 */
  instruction: z.string().trim().max(200).default(""),
});
export type DraftRequest = z.infer<typeof DraftRequestSchema>;

/** 这次要写的区块：锁定的当定稿，不写 */
export function draftTargets(card: ProseCard): DraftBlock[] {
  return DRAFT_BLOCKS.filter((b) => !card.locked.includes(b));
}

/** 要补"是什么事"的旧识：note 空着的（用户定的："不写由一键成稿补"） */
export function draftAcquaintances(card: ProseCard): Acquaintance[] {
  return card.board?.acquaintances.filter((a) => a.note === "") ?? [];
}

export function draftProblem(request: DraftRequest): string | null {
  if (draftTargets(request.card).length > 0) return null;
  if (draftAcquaintances(request.card).length > 0) return null;
  return "外貌、背景故事、性格、说话方式都锁定了，旧识也都写了是什么事，没有能写的";
}

/** 一键成稿最多收多少字：四块的上限、每个旧识一行，再留标记的位置 */
export function draftRoom(card: ProseCard): number {
  const blocks = draftTargets(card).reduce((sum, b) => sum + PROSE_BLOCK_INFO[b].max, 0);
  const people = draftAcquaintances(card).length * (ACQUAINTANCE_NOTE_CHARS + 12);
  return blocks + people + (DRAFT_BLOCKS.length + 1) * 10;
}

const PEOPLE_MARK = "旧识";

export function buildDraftPrompt(request: DraftRequest): LlmMessage[] {
  const { card, instruction } = request;
  const targets = draftTargets(card);
  const needs = draftAcquaintances(card);
  const format = [
    ...targets.map(
      (b) =>
        `【${PROSE_BLOCK_INFO[b].label}】\n${BLOCK_GUIDE[b]}；最多 ${PROSE_BLOCK_INFO[b].max} 字。`,
    ),
    ...(needs.length > 0
      ? [
          `【${PEOPLE_MARK}】\n每人一行，写成“编号：一句话”，说清你们之间是什么事，要和背景故事对得上；每句最多 ${ACQUAINTANCE_NOTE_CHARS} 字。`,
        ]
      : []),
  ];
  const system = [
    "你在帮玩家一次写完《赛博朋克 2077》夜之城文字角色扮演游戏里玩家角色的角色卡正文。用简体中文。",
    "按下面的顺序输出，每块用【】标记开头，标记单独占一行；除了这些标记和正文，不要输出别的标题、说明、引号或代码块：",
    ...format,
    "这几块写的是同一个人：外貌里的伤疤、义体、衣着要能在背景故事里找到来历；性格是这些经历留下的；说话方式贴着出身和性格。背景故事把主板上的出身、过往、负面经历、本事和旧识串成因果：因为什么，发生了什么，所以现在是这样，最后留下没了结的线头。",
    "标了（定稿）的区块是硬约束：不能和它矛盾，也不要再输出它。不写场景、开场白和对话示例。",
    ...STYLE,
  ].join("\n");
  const others = PROSE_BLOCKS.filter((b) => card[b] !== "").map((b) => {
    const tag = card.locked.includes(b)
      ? "（定稿）"
      : (targets as readonly ProseBlock[]).includes(b)
        ? "（旧稿，这次重写，可以沿用里面的设定）"
        : "";
    return `【${PROSE_BLOCK_INFO[b].label}${tag}】\n${card[b]}`;
  });
  const people =
    needs.length > 0
      ? [
          "要补“是什么事”的旧识（编号：名字，关系）：",
          ...needs.map((a, i) => `${i + 1}：${a.name}，${RELATION_INFO[a.relation].label}`),
        ].join("\n")
      : "";
  const user = [
    ...cardFacts(card),
    ...others,
    people,
    instruction && `玩家的要求：${instruction}`,
    `现在按格式写${targets.map((b) => `「${PROSE_BLOCK_INFO[b].label}」`).join("")}${needs.length > 0 ? "，再补旧识" : ""}。`,
  ]
    .filter((p) => p !== "")
    .join("\n\n");
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

export interface DraftResult {
  /** 写出来的区块；锁定的、没写出来的不在里面 */
  readonly blocks: Partial<Record<DraftBlock, string>>;
  /** 旧识 id → 是什么事；只有原来空着的 */
  readonly notes: Readonly<Record<string, string>>;
  /** 超了字数、被截短的区块 */
  readonly cut: readonly DraftBlock[];
}

/** 把一键成稿的输出按【】标记拆开；认不出的标记当正文，锁定的区块写了也不要 */
export function splitDraft(output: string, card: ProseCard): DraftResult {
  const targets = draftTargets(card);
  const needs = draftAcquaintances(card);
  const byLabel = new Map<string, DraftBlock | typeof PEOPLE_MARK>(
    DRAFT_BLOCKS.map((b) => [PROSE_BLOCK_INFO[b].label, b]),
  );
  byLabel.set(PEOPLE_MARK, PEOPLE_MARK);
  const marks = [...output.matchAll(/【([^】\n]{1,16})】/g)].flatMap((m) => {
    // 模型可能照抄成"【外貌（定稿）】"，括号后面的不算
    const key = byLabel.get((m[1] ?? "").replace(/[（(].*$/, "").trim());
    return key && m.index !== undefined
      ? [{ key, start: m.index, end: m.index + m[0].length }]
      : [];
  });
  const blocks: Partial<Record<DraftBlock, string>> = {};
  const notes: Record<string, string> = {};
  const cut: DraftBlock[] = [];
  marks.forEach((mark, i) => {
    const body = output.slice(mark.end, marks[i + 1]?.start ?? output.length).trim();
    if (mark.key === PEOPLE_MARK) {
      for (const raw of body.split("\n")) {
        const line = raw.replace(/^[\s\-*·•]+/, "").trim();
        const m = /^(.+?)[：:]\s*(.+)$/.exec(line);
        if (!m) continue;
        const key = (m[1] ?? "").replace(/[「」]/g, "").trim();
        const num = /^(\d+)/.exec(key);
        const who = num
          ? needs[Number(num[1]) - 1]
          : needs.find((a) => a.name === key || a.id === key);
        const note = (m[2] ?? "").trim().slice(0, ACQUAINTANCE_NOTE_CHARS);
        if (who && note !== "" && notes[who.id] === undefined) notes[who.id] = note;
      }
      return;
    }
    const block = mark.key;
    if (!targets.includes(block) || blocks[block] !== undefined || body === "") return;
    const { max } = PROSE_BLOCK_INFO[block];
    if (body.length > max) cut.push(block);
    blocks[block] = body.slice(0, max).trimEnd();
  });
  return { blocks, notes, cut };
}

/** 一键成稿，边写边吐原文（带标记），由调用方收齐后用 splitDraft 拆 */
export async function* streamDraft(
  llm: LlmClient,
  request: DraftRequest,
  signal?: AbortSignalLike,
): AsyncGenerator<ProseEvent> {
  const problem = draftProblem(request);
  if (problem) {
    yield { type: "error", message: problem };
    return;
  }
  const room = draftRoom(request.card);
  yield* capped(
    llm,
    {
      purpose: "aux",
      messages: buildDraftPrompt(request),
      maxOutputTokens: Math.min(8000, room * 2 + 400),
      // 一次写四块要前后一致，比逐块生成稳一点（计划定的 0.8）
      temperature: 0.8,
    },
    room,
    signal,
  );
}
