import { z } from "zod";
import type { AbortSignalLike, LlmClient, LlmMessage } from "../kernel/ports";

/**
 * 文生图提示词提炼器：
 * - 支持三类对象：玩家角色立绘（character）、NPC 肖像（npc）、回合剧情场景插图（turn）。
 * - 默认交由辅助模型（aux）结合赛博朋克 2077 视觉基调提炼英文画面提示词与反向提示词；
 *   若未配置辅助模型或玩家关闭提炼，则回退为保留源语言的本地拼接提示词。
 */

export const DEFAULT_NEGATIVE_PROMPT =
  "lowres, blurry, bad anatomy, bad hands, extra fingers, deformed face, watermark, signature, text, speech bubble, UI overlay, frame, border, frame-within-frame";

export const DEFAULT_PORTRAIT_STYLE =
  "Cyberpunk 2077-inspired Night City portrait, restrained neo-noir palette with cyan and magenta accents, practical directional lighting, grounded skin, fabric, and metal textures, uncluttered background";

export const DEFAULT_SCENE_STYLE =
  "Cyberpunk 2077-inspired Night City scene, grounded urban architecture, neon from plausible in-scene sources, atmospheric depth, readable staging, no HUD";

export const ImageStyleConfigSchema = z.object({
  portraitStyle: z.string().trim().max(800).optional(),
  sceneStyle: z.string().trim().max(800).optional(),
  negativePrompt: z.string().trim().max(800).optional(),
  auxInstruction: z.string().trim().max(800).optional(),
});
export type ImageStyleConfig = z.infer<typeof ImageStyleConfigSchema>;

export const CharacterImagePromptInputSchema = z.object({
  kind: z.literal("character"),
  name: z.string().trim().max(40).default("Merc"),
  alias: z.string().trim().max(40).default(""),
  pronoun: z.string().trim().max(10).default("TA"),
  origin: z.string().trim().max(80).default(""),
  look: z.string().trim().max(500).default(""),
  personality: z.string().trim().max(400).default(""),
  skills: z.string().trim().max(400).default(""),
  cyberware: z.array(z.string().trim().max(60)).max(24).default([]),
  gear: z.array(z.string().trim().max(60)).max(16).default([]),
  instruction: z.string().trim().max(300).default(""),
});
export type CharacterImagePromptInput = z.infer<typeof CharacterImagePromptInputSchema>;

export const NpcImagePromptInputSchema = z.object({
  kind: z.literal("npc"),
  name: z.string().trim().max(40),
  alias: z.string().trim().max(40).nullable().optional(),
  pronoun: z.string().trim().max(10).default("TA"),
  role: z.string().trim().max(120).default(""),
  faction: z.string().trim().max(80).nullable().optional(),
  look: z.string().trim().max(500).default(""),
  outfit: z.string().trim().max(300).nullable().optional(),
  wounds: z.string().trim().max(200).nullable().optional(),
  instruction: z.string().trim().max(300).default(""),
});
export type NpcImagePromptInput = z.infer<typeof NpcImagePromptInputSchema>;

export const TurnImagePromptInputSchema = z.object({
  kind: z.literal("turn"),
  sceneText: z.string().trim().min(1).max(3500),
  actionText: z.string().trim().max(400).default(""),
  location: z.string().trim().max(120).default(""),
  district: z.string().trim().max(80).default(""),
  timeText: z.string().trim().max(80).default(""),
  weather: z.string().trim().max(80).default(""),
  characters: z.array(z.string().trim().max(160)).max(10).default([]),
  instruction: z.string().trim().max(300).default(""),
});
export type TurnImagePromptInput = z.infer<typeof TurnImagePromptInputSchema>;

export const ImagePromptRequestSchema = z.discriminatedUnion("kind", [
  CharacterImagePromptInputSchema,
  NpcImagePromptInputSchema,
  TurnImagePromptInputSchema,
]);
export type ImagePromptRequest = z.infer<typeof ImagePromptRequestSchema>;

export interface ImagePromptResult {
  readonly prompt: string;
  readonly negativePrompt: string;
  readonly usedAux: boolean;
  readonly fallbackReason?: string;
}

function genderHint(pronoun: string): string {
  const p = pronoun.trim();
  if (p === "她" || p.toLowerCase() === "she" || p.toLowerCase() === "her") return "female";
  if (p === "他" || p.toLowerCase() === "he" || p.toLowerCase() === "him") return "male";
  return "";
}

function compact(parts: readonly (string | null | undefined)[]): string {
  return parts
    .map((p) => p?.trim() ?? "")
    .filter((p) => p !== "")
    .join(", ");
}

function sceneExcerpt(sceneText: string, maxLength = 1100): string {
  const normalized = sceneText.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  const headLength = Math.floor(maxLength * 0.38);
  const tailLength = maxLength - headLength;
  return `${normalized.slice(0, headLength).trimEnd()} … ${normalized.slice(-tailLength).trimStart()}`;
}

/** 不调用辅助模型时的兜底提示词；原始资料保留源语言，不冒充已翻译的英文 */
export function fallbackImagePrompt(
  input: ImagePromptRequest,
  style?: ImageStyleConfig,
): ImagePromptResult {
  const portraitStyle = style?.portraitStyle?.trim() ?? DEFAULT_PORTRAIT_STYLE;
  const sceneStyle = style?.sceneStyle?.trim() ?? DEFAULT_SCENE_STYLE;
  const negativePrompt = style?.negativePrompt?.trim() ?? DEFAULT_NEGATIVE_PROMPT;
  const auxExtra = style?.auxInstruction?.trim() || "";

  if (input.kind === "character") {
    const subject = compact([
      `${genderHint(input.pronoun)} mercenary portrait`,
      input.origin ? `background: ${input.origin}` : "",
      input.look ? `appearance: ${input.look}` : "",
      input.cyberware.length > 0
        ? `visible cyberware: ${input.cyberware.slice(0, 6).join(", ")}`
        : "",
      input.gear.length > 0 ? `equipped gear: ${input.gear.slice(0, 4).join(", ")}` : "",
      input.instruction ? `additional details: ${input.instruction}` : "",
      auxExtra,
      "single character portrait; use upper-body framing unless the user requests another composition",
      portraitStyle,
    ]);
    return {
      prompt: subject,
      negativePrompt,
      usedAux: false,
    };
  }
  if (input.kind === "npc") {
    const subject = compact([
      `${genderHint(input.pronoun)} Night City character portrait`,
      input.role ? `role: ${input.role}` : "",
      input.faction && input.faction !== "无" ? `faction aesthetic: ${input.faction}` : "",
      input.look ? `appearance: ${input.look}` : "",
      input.outfit ? `wearing: ${input.outfit}` : "",
      input.wounds ? `condition: ${input.wounds}` : "",
      input.instruction ? `additional details: ${input.instruction}` : "",
      auxExtra,
      "single character portrait; use upper-body framing unless the user requests another composition",
      portraitStyle,
    ]);
    return {
      prompt: subject,
      negativePrompt,
      usedAux: false,
    };
  }
  const excerpt = sceneExcerpt(input.sceneText);
  const subject = compact([
    "single coherent scene illustration",
    input.location || input.district
      ? `location: ${[input.district, input.location].filter(Boolean).join(" - ")}`
      : "Night City street or moody interior",
    input.timeText ? `time: ${input.timeText}` : "",
    input.weather ? `weather: ${input.weather}` : "",
    input.characters.length > 0 ? `characters in scene: ${input.characters.join("; ")}` : "",
    input.actionText ? `action moment: ${input.actionText}` : "",
    `scene description: ${excerpt}`,
    input.instruction ? `style/focus: ${input.instruction}` : "",
    auxExtra,
    sceneStyle,
  ]);
  return {
    prompt: subject,
    negativePrompt,
    usedAux: false,
  };
}

function buildAuxMessages(
  input: ImagePromptRequest,
  style?: ImageStyleConfig,
): readonly LlmMessage[] {
  const portraitStyle = style?.portraitStyle?.trim() ?? DEFAULT_PORTRAIT_STYLE;
  const sceneStyle = style?.sceneStyle?.trim() ?? DEFAULT_SCENE_STYLE;
  const negativeHint = style?.negativePrompt?.trim() ?? DEFAULT_NEGATIVE_PROMPT;
  const targetStyle = input.kind === "turn" ? sceneStyle : portraitStyle;
  const visualBrief =
    input.kind === "character"
      ? [
          "Create one player-character portrait. Default to upper-body or bust framing unless the user requests another composition.",
          "Prioritize the supplied appearance, clothing, visible cyberware, scars, and gear. Treat personality and skills only as subtle expression or posture cues when supported by the supplied facts.",
          "Preserve stated age, ethnicity, body traits, equipment, scars, and cyberware; leave unspecified traits undescribed. Installed internal implants are not automatically visible. Do not turn a name into invented appearance details.",
        ]
      : input.kind === "npc"
        ? [
            "Create one NPC portrait. Default to head-and-shoulders or upper-body framing unless the user requests another composition.",
            "Prioritize the supplied appearance, current outfit, role, and visible wounds; keep those details consistent instead of redesigning the subject.",
            "Preserve stated age, ethnicity, body traits, equipment, scars, and cyberware; leave unspecified traits undescribed. Do not turn a name into invented appearance details.",
          ]
        : [
            "Create one coherent image of the decisive moment in the supplied scene, not a montage or a summary of several events.",
            "The narrative states what actually happened. Player Action describes intent only: do not depict an attempted, prevented, or failed action as successful. Use the narrative's established result to select the depicted moment.",
            "Use character and location references to identify subjects, but let the narrative determine who is visible and their state at that moment. Never merge one person's appearance, equipment, or actions into another person.",
            "Keep only facts supported by the scene. Do not add characters, weapons, weather, injuries, props, or outcomes that are not stated.",
            "Adapt the composition to the requested image dimensions; do not assume a fixed aspect ratio.",
          ];
  const system = [
    "You are an expert AI visual prompt director for a Cyberpunk 2077 roleplaying game.",
    "Convert the supplied Chinese/English source facts into one concrete English image-generation prompt describing visible pixels, not plot summary or backstory.",
    "Requirements:",
    '1. Output valid JSON ONLY with keys: "prompt" (string) and "negativePrompt" (string).',
    '2. Keep "prompt" focused on the defining visual facts, with enough detail to preserve identity, action, spatial relationships, and composition. Use concrete visual language, no game stats, abstract backstory, filler, or quality-score tags. Maximum 4000 characters for "prompt" and 2000 for "negativePrompt".',
    `3. Follow this image-specific brief: ${visualBrief.join(" ")}`,
    `4. Apply the user's preferred visual style baseline only where it does not conflict with specific source facts or the user's extra instruction: ${targetStyle}`,
    negativeHint
      ? `5. Preserve these exclusions in "negativePrompt" without copying them into the positive prompt: ${negativeHint}`
      : '5. The user has cleared negative prompts. Return "negativePrompt": ""; do not add default exclusions.',
    "6. Exclude text overlays, speech bubbles, watermarks, and HUD frames from the artwork.",
    "7. Treat the user's extra instruction as the highest-priority visual direction, unless it conflicts with the supplied character or scene facts.",
    ...(style?.auxInstruction?.trim()
      ? [`8. Global Player Visual Directive: ${style.auxInstruction.trim()}`]
      : []),
  ].join("\n");

  if (input.kind === "character") {
    const lines = [
      `Target: Player character portrait`,
      `Name/Alias: ${input.name}${input.alias ? ` (${input.alias})` : ""}`,
      `Pronoun: ${input.pronoun}; gender cue: ${genderHint(input.pronoun) || "unspecified; do not infer gendered features"}`,
      input.origin ? `Origin/Background: ${input.origin}` : "",
      input.look ? `Appearance: ${input.look}` : "",
      input.personality ? `Vibe/Personality: ${input.personality}` : "",
      input.skills ? `Specialty: ${input.skills}` : "",
      input.cyberware.length > 0 ? `Installed Cyberware: ${input.cyberware.join(", ")}` : "",
      input.gear.length > 0 ? `Weapons/Gear: ${input.gear.join(", ")}` : "",
      input.instruction ? `User Extra Instruction: ${input.instruction}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    return [
      { role: "system", content: system },
      { role: "user", content: lines },
    ];
  }

  if (input.kind === "npc") {
    const lines = [
      `Target: NPC character portrait`,
      `Name/Alias: ${input.name}${input.alias ? ` (${input.alias})` : ""}`,
      `Pronoun: ${input.pronoun}; gender cue: ${genderHint(input.pronoun) || "unspecified; do not infer gendered features"}`,
      input.role ? `Role: ${input.role}` : "",
      input.faction && input.faction !== "无" ? `Faction: ${input.faction}` : "",
      input.look ? `Appearance: ${input.look}` : "",
      input.outfit ? `Current Outfit: ${input.outfit}` : "",
      input.wounds ? `Visible Condition/Wounds: ${input.wounds}` : "",
      input.instruction ? `User Extra Instruction: ${input.instruction}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    return [
      { role: "system", content: system },
      { role: "user", content: lines },
    ];
  }

  const lines = [
    `Target: Scene illustration of this RPG turn (no speech bubbles, no text)`,
    input.district || input.location
      ? `Location: ${[input.district, input.location].filter(Boolean).join(" / ")}`
      : "",
    input.timeText ? `Time: ${input.timeText}` : "",
    input.weather ? `Weather: ${input.weather}` : "",
    input.characters.length > 0 ? `Present Characters:\n- ${input.characters.join("\n- ")}` : "",
    input.actionText ? `Player intent (not an established outcome): ${input.actionText}` : "",
    `Narrative Scene:\n${input.sceneText}`,
    input.instruction ? `User Extra Instruction: ${input.instruction}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return [
    { role: "system", content: system },
    { role: "user", content: lines },
  ];
}

const AuxPromptPayloadSchema = z.object({
  prompt: z.string().trim().min(8).max(4000),
  negativePrompt: z.string().trim().max(2000).optional(),
});

function parseAuxReply(
  raw: string,
  defaultNegative: string,
): { prompt: string; negativePrompt: string } | null {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  if (!cleaned) return null;
  try {
    const parsed = AuxPromptPayloadSchema.safeParse(JSON.parse(cleaned));
    if (parsed.success) {
      return {
        prompt: parsed.data.prompt,
        negativePrompt: defaultNegative ? (parsed.data.negativePrompt ?? defaultNegative) : "",
      };
    }
  } catch {
    // 不把解释、思考或不完整 JSON 当作可直接发送给图片模型的提示词。
  }
  return null;
}

/**
 * 调用辅助模型提炼英文生图提示词；
 * 当 useAux=false 或辅助模型未就绪/失败时，不抛错而是退回确定性兜底提示词并附带 fallbackReason。
 */
export async function draftImagePrompt(
  llm: LlmClient | null,
  input: ImagePromptRequest,
  options: {
    readonly useAux?: boolean;
    readonly style?: ImageStyleConfig;
    readonly signal?: AbortSignalLike;
  } = {},
): Promise<ImagePromptResult> {
  const useAux = options.useAux ?? true;
  const style = options.style;
  if (!useAux || !llm) {
    return fallbackImagePrompt(input, style);
  }
  let reply = "";
  let blockedReason: string | null = null;
  try {
    for await (const event of llm.stream(
      {
        purpose: "aux",
        messages: buildAuxMessages(input, style),
        temperature: 0.6,
        maxOutputTokens: 1400,
        responseFormat: { type: "json" },
      },
      options.signal,
    )) {
      if (event.type === "text") reply += event.text;
      else if (event.type === "blocked") {
        blockedReason = event.reason;
        break;
      }
    }
  } catch (error) {
    if (options.signal?.aborted) throw error;
    const message = error instanceof Error ? error.message : String(error);
    return {
      ...fallbackImagePrompt(input, style),
      fallbackReason: message,
    };
  }
  if (blockedReason) {
    return {
      ...fallbackImagePrompt(input, style),
      fallbackReason: `辅助模型拦截了提示词提炼：${blockedReason}`,
    };
  }
  const defaultNeg = style?.negativePrompt?.trim() ?? DEFAULT_NEGATIVE_PROMPT;
  const parsed = parseAuxReply(reply, defaultNeg);
  if (!parsed) {
    return {
      ...fallbackImagePrompt(input, style),
      fallbackReason: "辅助模型返回内容格式异常，已回退本地拼接提示词",
    };
  }
  return {
    prompt: parsed.prompt,
    negativePrompt: parsed.negativePrompt,
    usedAux: true,
  };
}
