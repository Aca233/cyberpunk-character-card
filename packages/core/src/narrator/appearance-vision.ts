import type { AbortSignalLike, LlmClient, LlmMessage, LlmMessageImage } from "../kernel/ports";
import { PROSE_BLOCK_INFO } from "../schemas/character";

export const APPEARANCE_LOOK_MAX = PROSE_BLOCK_INFO.look.max;
export const APPEARANCE_HINT_MAX = 200;

export interface DescribeAppearanceInput {
  readonly image: LlmMessageImage;
  readonly pronoun?: string | undefined;
  readonly hint?: string | undefined;
  readonly purpose?: "aux" | "narrator" | undefined;
}

export type DescribeAppearanceResult =
  | { readonly ok: true; readonly look: string }
  | { readonly ok: false; readonly error: string };

const SYSTEM_PROMPT = [
  "你是赛博朋克角色外貌档案录入员，负责根据用户提供的单张人物参考图，用简洁、具体、自然的中文客观提炼出该角色的固定物理外貌描述。",
  "",
  "严格要求：",
  "1. 只描述图片中真实可见的人物外貌特征：大致视觉年龄与整体气质、体态肩颈轮廓、脸型五官与神态、发型发色、瞳色/义眼形态、肤色、面部与身体外露义体（接缝、镀层、接口、义肢等）、伤疤、纹身、胡须或妆容特征。",
  "2. 不要描写服装穿搭、配饰、手持武器、光线滤镜、拍摄构图或画面背景（角色在剧情里会频繁换装与移动，衣着由背包系统独立管理）。",
  "3. 不要编造图片里看不到的设定、出身、性格或背景故事；不要评价画风、画质、镜头或AI绘画术语。",
  "4. 不要使用编号列表、Markdown、标题、引号或开场白；直接输出一段连贯自然的纯中文外貌描写。",
  `5. 长度控制在 60 到 ${APPEARANCE_LOOK_MAX} 个中文字符以内，做到画面感清晰且不啰嗦。`,
].join("\n");

export function buildDescribeAppearanceMessages(
  input: DescribeAppearanceInput,
): readonly LlmMessage[] {
  const pronoun = input.pronoun?.trim();
  const hint = input.hint?.trim().slice(0, APPEARANCE_HINT_MAX);
  const lines = [
    "请仔细观察这张人物参考图，为角色卡生成一段客观、具体的中文物理外貌描写（不含衣着与背景）。",
    pronoun ? `角色人称代词：${pronoun}` : "",
    hint ? `玩家补充强调（结合画面一并体现）：${hint}` : "",
    `直接输出纯正文，不超过 ${APPEARANCE_LOOK_MAX} 字。`,
  ].filter(Boolean);

  return [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: lines.join("\n"),
      images: [input.image],
    },
  ];
}

function cleanLookText(raw: string): string {
  return raw
    .trim()
    .replace(/^```[a-zA-Z]*\s*/, "")
    .replace(/\s*```$/, "")
    .replace(/^["「『“]+|["」』”]+$/g, "")
    .replace(/^(?:外貌(?:描述|描写)?|体貌(?:描述|描写)?)[：:]\s*/, "")
    .replace(/\r?\n+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * 调用支持视觉输入的模型，从单张参考图反推角色的物理外貌描写。
 * 遇到模型拦截、截断或空回复时直接返回失败原因，不静默兜底也不自动重试。
 */
export async function describeAppearanceFromImage(
  llm: LlmClient,
  input: DescribeAppearanceInput,
  signal?: AbortSignalLike,
): Promise<DescribeAppearanceResult> {
  let reply = "";
  let blockedReason: string | null = null;
  let finishReason: string | null = null;

  for await (const event of llm.stream(
    {
      purpose: input.purpose ?? "aux",
      messages: buildDescribeAppearanceMessages(input),
      temperature: 0.35,
      maxOutputTokens: 1024,
    },
    signal,
  )) {
    if (event.type === "text") reply += event.text;
    else if (event.type === "blocked") {
      blockedReason = event.reason;
      break;
    } else if (event.type === "done") {
      finishReason = event.finishReason;
    }
  }

  if (blockedReason) {
    return { ok: false, error: `模型拦截了识图请求：${blockedReason}` };
  }
  const cleaned = cleanLookText(reply);
  if (!cleaned) {
    return {
      ok: false,
      error: "模型没有返回有效的外貌描述，请确认所选模型支持图片识别（Vision）并重试",
    };
  }
  if (["length", "max_tokens"].includes(finishReason?.trim().toLowerCase() ?? "")) {
    return {
      ok: false,
      error: "识图输出达到长度上限被截断，请检查模型的最大输出配置后重试",
    };
  }
  const look =
    cleaned.length > APPEARANCE_LOOK_MAX
      ? cleaned.slice(0, APPEARANCE_LOOK_MAX).replace(/[，、；：,;:]+$/, "")
      : cleaned;
  return { ok: true, look };
}
