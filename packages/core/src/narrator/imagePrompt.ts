import { z } from "zod";
import type { AbortSignalLike, LlmClient, LlmMessage } from "../kernel/ports";
import {
  IMAGE_INSTRUCTION_MAX_LENGTH,
  IMAGE_PROMPT_MAX_LENGTH,
  IMAGE_SCENE_MAX_LENGTH,
  type ImageCharacterReference,
  ImageCharacterReferenceSchema,
} from "../schemas/image";

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
  cyberware: z.array(z.string().trim().max(240)).max(32).default([]),
  gear: z.array(z.string().trim().max(240)).max(32).default([]),
  outfit: z.string().trim().max(2000).optional(),
  wounds: z.string().trim().max(2000).optional(),
  instruction: z.string().trim().max(IMAGE_INSTRUCTION_MAX_LENGTH).default(""),
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
  outfit: z.string().trim().max(2000).nullable().optional(),
  wounds: z.string().trim().max(2000).nullable().optional(),
  cyberware: z.array(z.string().trim().max(240)).max(32).optional(),
  gear: z.array(z.string().trim().max(240)).max(32).optional(),
  instruction: z.string().trim().max(IMAGE_INSTRUCTION_MAX_LENGTH).default(""),
});
export type NpcImagePromptInput = z.infer<typeof NpcImagePromptInputSchema>;

export const TurnImagePromptInputSchema = z.object({
  kind: z.literal("turn"),
  sceneText: z.string().trim().min(1).max(IMAGE_SCENE_MAX_LENGTH),
  actionText: z.string().trim().max(2000).default(""),
  location: z.string().trim().max(300).default(""),
  district: z.string().trim().max(160).default(""),
  timeText: z.string().trim().max(160).default(""),
  weather: z.string().trim().max(160).default(""),
  characters: z.array(ImageCharacterReferenceSchema).max(32).default([]),
  instruction: z.string().trim().max(IMAGE_INSTRUCTION_MAX_LENGTH).default(""),
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

export type ImageNegativePromptMode = "independent" | "in-prompt";

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

function sceneExcerpt(sceneText: string, maxLength: number): string {
  const normalized = sceneText.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  const headLength = Math.floor((maxLength - 80) * 0.25);
  const tailLength = maxLength - headLength - 80;
  return `Earlier context: ${normalized.slice(0, headLength).trimEnd()} … Scene ending: ${normalized.slice(-tailLength).trimStart()}`;
}

function characterReferenceText(character: ImageCharacterReference, concise = false): string {
  const limit = (text: string, length: number) => (concise ? text.slice(0, length) : text);
  return [
    `[${character.id}] ${character.name}${character.alias ? ` (${character.alias})` : ""}`,
    character.pronoun ? `pronoun: ${character.pronoun}` : "",
    character.role ? `role: ${limit(character.role, 80)}` : "",
    character.look ? `fixed appearance: ${limit(character.look, 240)}` : "",
    character.outfit ? `current outfit: ${limit(character.outfit, 160)}` : "",
    character.wounds ? `known condition: ${limit(character.wounds, 120)}` : "",
    character.cyberware.length
      ? `installed implants (not all visible): ${(concise ? character.cyberware.slice(0, 4) : character.cyberware).join(", ")}`
      : "",
    character.gear.length
      ? `carried gear (not necessarily held): ${(concise ? character.gear.slice(0, 3) : character.gear).join(", ")}`
      : "",
  ]
    .filter(Boolean)
    .join("; ");
}

const AUX_CHARACTER_REFERENCES_MAX_LENGTH = 24000;

function fairTextBudgets(
  parts: readonly { readonly length: number; readonly weight: number }[],
  maxLength: number,
): number[] {
  const allocations = parts.map((part) => ({ ...part, budget: 0 }));
  let remaining = Math.max(0, maxLength);
  let active = allocations.filter((part) => part.length > 0);
  while (remaining > 0 && active.length > 0) {
    const totalWeight = active.reduce((sum, part) => sum + part.weight, 0);
    const available = remaining;
    for (const part of active) {
      const share = Math.max(1, Math.floor((available * part.weight) / totalWeight));
      const allocated = Math.min(part.length - part.budget, share, remaining);
      part.budget += allocated;
      remaining -= allocated;
    }
    active = active.filter((part) => part.budget < part.length);
  }
  return allocations.map(({ budget }) => budget);
}

/** 只压缩超大角色参考资料；保留每位角色身份与各类视觉事实，不挤占剧情正文。 */
function auxCharacterReferences(input: TurnImagePromptInput): string {
  const narrative = input.sceneText.toLowerCase();
  const references = input.characters
    .map((character) => ({
      character,
      text: characterReferenceText(character),
      weight:
        character.id === "player"
          ? 3
          : [character.name, character.alias].some(
                (name) => name.trim() && narrative.includes(name.trim().toLowerCase()),
              )
            ? 2
            : 1,
    }))
    .sort((a, b) => b.weight - a.weight);
  const complete = references.map(({ text }) => text).join("\n");
  if (complete.length <= AUX_CHARACTER_REFERENCES_MAX_LENGTH) return complete;

  const structured = references.map(({ character, weight }) => {
    const identity = [
      `[${character.id}] ${character.name}${character.alias ? ` (${character.alias})` : ""}`,
      character.pronoun ? `pronoun: ${character.pronoun}` : "",
    ]
      .filter(Boolean)
      .join("; ");
    const fields = [
      { label: "role", value: character.role },
      { label: "fixed appearance", value: character.look },
      { label: "current outfit", value: character.outfit },
      { label: "known condition", value: character.wounds },
      { label: "installed implants (not all visible)", value: character.cyberware.join(", ") },
      { label: "carried gear (not necessarily held)", value: character.gear.join(", ") },
    ].filter(({ value }) => value.length > 0);
    return { identity, fields, weight };
  });
  const fixedLength =
    structured.length -
    1 +
    structured.reduce(
      (sum, { identity, fields }) =>
        sum + identity.length + fields.reduce((length, { label }) => length + label.length + 4, 0),
      0,
    );
  const characterBudgets = fairTextBudgets(
    structured.map(({ fields, weight }) => ({
      length: fields.reduce((sum, { value }) => sum + value.length, 0),
      weight,
    })),
    AUX_CHARACTER_REFERENCES_MAX_LENGTH - fixedLength,
  );
  return structured
    .map(({ identity, fields }, index) => {
      const fieldBudgets = fairTextBudgets(
        fields.map(({ value }) => ({ length: value.length, weight: 1 })),
        characterBudgets[index] ?? 0,
      );
      return [
        identity,
        ...fields.map(({ label, value }, fieldIndex) => {
          const budget = fieldBudgets[fieldIndex] ?? 0;
          const shortened =
            value.length <= budget
              ? value
              : `${value.slice(0, Math.max(0, budget - 1))}…`.slice(0, budget);
          return `${label}: ${shortened}`;
        }),
      ].join("; ");
    })
    .join("\n");
}

/** 不调用辅助模型时的兜底提示词；原始资料保留源语言，不冒充已翻译的英文 */
export function fallbackImagePrompt(
  input: ImagePromptRequest,
  style?: ImageStyleConfig,
  negativePromptMode: ImageNegativePromptMode = "independent",
): ImagePromptResult {
  const portraitStyle = style?.portraitStyle?.trim() ?? DEFAULT_PORTRAIT_STYLE;
  const sceneStyle = style?.sceneStyle?.trim() ?? DEFAULT_SCENE_STYLE;
  const negativePrompt = style?.negativePrompt?.trim() ?? DEFAULT_NEGATIVE_PROMPT;
  const auxExtra = style?.auxInstruction?.trim() || "";
  const exclusions =
    negativePromptMode === "in-prompt" && negativePrompt
      ? `\nUser-requested exclusions (render the image without these): ${negativePrompt}`
      : "";
  const finish = (prompt: string): ImagePromptResult => ({
    prompt: `${prompt}${exclusions}`,
    negativePrompt: negativePromptMode === "in-prompt" ? "" : negativePrompt,
    usedAux: false,
  });

  if (input.kind === "character") {
    const subject = compact([
      `${genderHint(input.pronoun)} mercenary portrait`,
      input.origin ? `background: ${input.origin}` : "",
      input.look ? `appearance: ${input.look}` : "",
      input.outfit ? `current outfit: ${input.outfit}` : "",
      input.wounds ? `known condition: ${input.wounds}` : "",
      input.cyberware.length > 0
        ? `installed cyberware (only depict explicitly visible parts): ${input.cyberware.slice(0, 6).join(", ")}`
        : "",
      input.gear.length > 0
        ? `carried gear (not necessarily held): ${input.gear.slice(0, 4).join(", ")}`
        : "",
      input.instruction ? `additional details: ${input.instruction}` : "",
      auxExtra,
      "single character portrait; use upper-body framing unless the user requests another composition",
      portraitStyle,
    ]);
    return finish(subject);
  }
  if (input.kind === "npc") {
    const subject = compact([
      `${genderHint(input.pronoun)} Night City character portrait`,
      input.role ? `role: ${input.role}` : "",
      input.faction && input.faction !== "无" ? `faction aesthetic: ${input.faction}` : "",
      input.look ? `appearance: ${input.look}` : "",
      input.outfit ? `wearing: ${input.outfit}` : "",
      input.wounds ? `condition: ${input.wounds}` : "",
      input.cyberware?.length
        ? `installed implants (not all visible): ${input.cyberware.slice(0, 6).join(", ")}`
        : "",
      input.gear?.length
        ? `carried gear (not necessarily held): ${input.gear.slice(0, 4).join(", ")}`
        : "",
      input.instruction ? `additional details: ${input.instruction}` : "",
      auxExtra,
      "single character portrait; use upper-body framing unless the user requests another composition",
      portraitStyle,
    ]);
    return finish(subject);
  }
  const references = input.characters
    .slice(0, 8)
    .map((character) => characterReferenceText(character, true))
    .join("\n")
    .slice(0, 4000);
  const framing = compact([
    "single coherent scene illustration",
    "Depict one moment established in the narrative, preserving its outcome; do not turn attempted or failed actions into successes. Character references do not imply that everyone is on screen. Internal implants and carried gear are not automatically visible",
    input.location || input.district
      ? `location: ${[input.district, input.location].filter(Boolean).join(" - ")}`
      : "Night City street or moody interior",
    input.timeText ? `time: ${input.timeText}` : "",
    input.weather ? `weather: ${input.weather}` : "",
    input.instruction ? `style/focus: ${input.instruction}` : "",
    auxExtra,
    sceneStyle,
  ]);
  const fixed = `${framing}\nCharacter references:\n${references}\nNarrative source:\n`;
  const excerpt = sceneExcerpt(
    input.sceneText,
    Math.max(300, IMAGE_PROMPT_MAX_LENGTH - fixed.length - exclusions.length),
  );
  return finish(`${fixed}${excerpt}`);
}

function buildAuxMessages(
  input: ImagePromptRequest,
  style?: ImageStyleConfig,
  negativePromptMode: ImageNegativePromptMode = "independent",
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
    `2. Keep "prompt" focused on the defining visual facts, with enough detail to preserve identity, action, spatial relationships, and composition. Use concrete visual language, no game stats, abstract backstory, filler, or quality-score tags. Maximum ${IMAGE_PROMPT_MAX_LENGTH} characters for "prompt" and 2000 for "negativePrompt".`,
    `3. Follow this image-specific brief: ${visualBrief.join(" ")}`,
    `4. Apply the user's preferred visual style baseline only where it does not conflict with specific source facts or the user's extra instruction: ${targetStyle}`,
    negativeHint
      ? negativePromptMode === "in-prompt"
        ? `5. The target image model uses one natural-language prompt. Express all of these user-requested exclusions as concise natural-language constraints inside "prompt", translated faithfully if needed; return "negativePrompt": "". Exclusions: ${negativeHint}`
        : `5. Preserve these exclusions in "negativePrompt" without copying them into the positive prompt: ${negativeHint}`
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
      input.outfit ? `Current outfit: ${input.outfit}` : "",
      input.wounds ? `Known condition: ${input.wounds}` : "",
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
      input.cyberware?.length
        ? `Installed cyberware (not all visible): ${input.cyberware.join(", ")}`
        : "",
      input.gear?.length ? `Carried gear (not necessarily held): ${input.gear.join(", ")}` : "",
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
    input.characters.length > 0
      ? `Character references at this turn (the narrative determines who is on screen):\n${auxCharacterReferences(input)}`
      : "",
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
  prompt: z.string().trim().min(8).max(IMAGE_PROMPT_MAX_LENGTH),
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
    readonly negativePromptMode?: ImageNegativePromptMode;
    readonly signal?: AbortSignalLike;
  } = {},
): Promise<ImagePromptResult> {
  const useAux = options.useAux ?? true;
  const style = options.style;
  const negativePromptMode = options.negativePromptMode ?? "independent";
  if (!useAux || !llm) {
    return fallbackImagePrompt(input, style, negativePromptMode);
  }
  let reply = "";
  let blockedReason: string | null = null;
  let finishReason: string | null = null;
  try {
    for await (const event of llm.stream(
      {
        purpose: "aux",
        messages: buildAuxMessages(input, style, negativePromptMode),
        temperature: 0.6,
        maxOutputTokens: input.kind === "turn" ? 6144 : 4096,
        responseFormat: { type: "json" },
      },
      options.signal,
    )) {
      if (event.type === "text") reply += event.text;
      else if (event.type === "blocked") {
        blockedReason = event.reason;
        break;
      } else if (event.type === "done") {
        finishReason = event.finishReason;
      }
    }
  } catch (error) {
    if (options.signal?.aborted) throw error;
    const message = error instanceof Error ? error.message : String(error);
    return {
      ...fallbackImagePrompt(input, style, negativePromptMode),
      fallbackReason: message,
    };
  }
  if (blockedReason) {
    return {
      ...fallbackImagePrompt(input, style, negativePromptMode),
      fallbackReason: `辅助模型拦截了提示词提炼：${blockedReason}`,
    };
  }
  if (["length", "max_tokens"].includes(finishReason?.trim().toLowerCase() ?? "")) {
    return {
      ...fallbackImagePrompt(input, style, negativePromptMode),
      fallbackReason: `辅助模型输出达到长度上限（${finishReason}），已回退本地拼接提示词`,
    };
  }
  const defaultNeg = style?.negativePrompt?.trim() ?? DEFAULT_NEGATIVE_PROMPT;
  const parsed = parseAuxReply(reply, defaultNeg);
  if (!parsed) {
    return {
      ...fallbackImagePrompt(input, style, negativePromptMode),
      fallbackReason: "辅助模型返回内容格式异常，已回退本地拼接提示词",
    };
  }
  const prompt =
    negativePromptMode === "in-prompt" && parsed.negativePrompt
      ? `${parsed.prompt}\nUser-requested exclusions (render the image without these): ${parsed.negativePrompt}`
      : parsed.prompt;
  if (prompt.length > IMAGE_PROMPT_MAX_LENGTH) {
    return {
      ...fallbackImagePrompt(input, style, negativePromptMode),
      fallbackReason: `辅助模型提示词与排除项合计超过 ${IMAGE_PROMPT_MAX_LENGTH} 字符，已回退本地拼接提示词`,
    };
  }
  return {
    prompt,
    negativePrompt: negativePromptMode === "in-prompt" ? "" : parsed.negativePrompt,
    usedAux: true,
  };
}
