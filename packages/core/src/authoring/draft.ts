import { z } from "zod";
import type { AbortSignalLike, LlmClient, LlmMessage } from "../kernel/ports";
import { schemaDoc } from "../narrator/doc";
import { CHROME_PRICES, type PriceBand, WEAPON_PRICES } from "./prices";
import {
  AUTHORING_LABELS,
  AUTHORING_SCHEMAS,
  type AuthoringKind,
  AuthoringKindSchema,
  NPC_REVIEW_ITEMS,
  validateAuthoringContent,
} from "./schema";

/**
 * 工坊起草：辅助模型按条目 schema 写一份初稿。结果只返回给页面，不保存、不带来源和审核状态；
 * 格式或价格不合格的照样返回，由页面标红、人工改
 */
export const AuthoringGenerateRequestSchema = z.strictObject({
  kind: AuthoringKindSchema,
  name: z.string().trim().min(1, "先填名字").max(40),
  notes: z.string().trim().max(1200).default(""),
});
export type AuthoringGenerateRequest = z.infer<typeof AuthoringGenerateRequestSchema>;

export interface AuthoringGenerated {
  readonly content: unknown;
  readonly validation: ReturnType<typeof validateAuthoringContent>;
  /** 模型自己拿不准、需要人工核对原作的地方 */
  readonly doubts: readonly string[];
}

const bandText = (bands: Readonly<Record<string, PriceBand>>) =>
  Object.entries(bands)
    .map(([rarity, [min, max]]) =>
      max === Number.POSITIVE_INFINITY ? `${rarity} ${min} 以上` : `${rarity} ${min}–${max}`,
    )
    .join("，");

function priceRule(kind: AuthoringKind): string | false {
  if (kind === "item") {
    return `武器和改装件的价格按稀有度：${bandText(WEAPON_PRICES)}；不朽（iconic）不标价`;
  }
  if (kind === "cyberware") {
    return `义体的价格按稀有度：${bandText(CHROME_PRICES)}；不朽（iconic）不标价`;
  }
  return false;
}

export function buildAuthoringPrompt(
  request: AuthoringGenerateRequest,
  example?: unknown,
): LlmMessage[] {
  const label = AUTHORING_LABELS[request.kind];
  const system = [
    `你在为《赛博朋克 2077》夜之城文字角色扮演游戏的内容库起草一条「${label}」。`,
    '只输出一个 JSON 对象，不要代码块，不要别的文字：{"content": 条目, "doubts": [拿不准、需要人工核对原作的地方，一条一句]}。',
    `content 的字段格式（JSON Schema）：\n${schemaDoc(AUTHORING_SCHEMAS[request.kind])}`,
    example !== undefined &&
      `现有条目的写法示例（只学格式和口吻，不要照抄内容）：\n${JSON.stringify(example)}`,
    "原则：按原作设定用自己的话写，不整段搬运 Wiki 或游戏原文；拿不准的设定不要编，写进 doubts。",
    "id 用小写英文和连字符；有官方中文译名的用官方译名，拿不准也写进 doubts。",
    priceRule(request.kind),
    request.kind === "npc" &&
      `原作人物按 2076 年（《边缘行者》时间点）的处境写；以下几项会由人工逐条核对，拿不准的写进 doubts：${NPC_REVIEW_ITEMS.map((i) => i.label).join("；")}`,
    "来源和审核状态由人工填写，不要写进 content。",
  ]
    .filter((line): line is string => typeof line === "string")
    .join("\n");
  const user = [`名字：${request.name}`, request.notes && `要点：${request.notes}`]
    .filter(Boolean)
    .join("\n");
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

/** 读模型回复：找出 JSON；内容合格时返回 schema 解析后的版本（多余字段去掉），否则原样返回 */
export function parseAuthoringReply(
  text: string,
  kind: AuthoringKind,
):
  | { readonly ok: true; readonly result: AuthoringGenerated }
  | { readonly ok: false; readonly error: string } {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return { ok: false, error: "模型的回复里没有 JSON，可以重新起草" };
  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    return { ok: false, error: "模型的回复不是合法的 JSON，可以重新起草" };
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, error: "模型的回复不是 JSON 对象，可以重新起草" };
  }
  const wrapper = raw as Record<string, unknown>;
  const content = "content" in wrapper ? wrapper.content : wrapper;
  const doubts = Array.isArray(wrapper.doubts)
    ? wrapper.doubts
        .filter((d): d is string => typeof d === "string")
        .map((d) => d.trim().slice(0, 160))
        .filter((d) => d !== "")
        .slice(0, 8)
    : [];
  const validation = validateAuthoringContent(kind, content);
  return {
    ok: true,
    result: { content: validation.ok ? validation.content : content, validation, doubts },
  };
}

/** 调辅助模型起草一条；不进回合日志，也不写草稿文件 */
export async function generateAuthoringDraft(
  llm: LlmClient,
  request: AuthoringGenerateRequest,
  example?: unknown,
  signal?: AbortSignalLike,
): Promise<
  | { readonly ok: true; readonly result: AuthoringGenerated }
  | { readonly ok: false; readonly error: string }
> {
  let text = "";
  for await (const event of llm.stream(
    {
      purpose: "aux",
      messages: buildAuthoringPrompt(request, example),
      maxOutputTokens: 1600,
      temperature: 0.5,
    },
    signal,
  )) {
    if (event.type === "text") text += event.text;
    else if (event.type === "blocked") {
      return { ok: false, error: `模型拒绝了起草：${event.reason}` };
    }
  }
  return parseAuthoringReply(text, request.kind);
}
