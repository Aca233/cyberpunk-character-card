import { z } from "zod";
import type { AbortSignalLike, LlmClient, LlmMessage } from "../kernel/ports";
import {
  IMAGE_AUX_SYSTEM_PROMPT_MAX_LENGTH,
  IMAGE_INSTRUCTION_MAX_LENGTH,
  IMAGE_NEGATIVE_PROMPT_MAX_LENGTH,
  IMAGE_PROMPT_MAX_LENGTH,
  IMAGE_SCENE_MAX_LENGTH,
  IMAGE_STYLE_FIELD_MAX_LENGTH,
  type ImageCharacterReference,
  ImageCharacterReferenceSchema,
} from "../schemas/image";

/**
 * 文生图提示词提炼器：
 * - 支持三类对象：玩家角色立绘（character）、NPC 肖像（npc）、回合剧情场景插图（turn）。
 * - 支持三种输出语言/格式：
 *   1. `en`：纯英文自然语言描述（严禁夹杂中文，适合 Flux / Gemini / DALL·E / SDXL）
 *   2. `en-tags`：纯英文 Tag 词组（严禁夹杂中文，按逗号分隔 Danbooru 标签，适合 NovelAI V5 / V4.5 / 二次元 SD）
 *   3. `zh`：纯中文画面描述（严禁夹杂英文元指令，适合中文生图模型或本地直接中文生图）
 * - 支持玩家自定义固定提示词（`customPrompt`，如画质词/画师串/LoRA）与直接自定义辅助模型提炼 System Prompt（`auxSystemPrompt`）。
 */

export const ImagePromptLanguageSchema = z.enum(["en", "en-tags", "zh"]);
export type ImagePromptLanguage = z.infer<typeof ImagePromptLanguageSchema>;

export const DEFAULT_NEGATIVE_PROMPT =
  "lowres, blurry, bad anatomy, bad hands, extra fingers, deformed face, watermark, signature, text, speech bubble, UI overlay, frame, border, frame-within-frame";

export const DEFAULT_NEGATIVE_PROMPT_ZH =
  "低分辨率, 模糊, 肢体崩坏, 手部畸形, 多余手指, 面部扭曲, 水印, 签名, 文字, 对话气泡, 界面UI, 外框";

export const DEFAULT_PORTRAIT_STYLE =
  "Cyberpunk 2077-inspired Night City portrait, restrained neo-noir palette with cyan and magenta accents, practical directional lighting, grounded skin, fabric, and metal textures, uncluttered background";

export const DEFAULT_PORTRAIT_STYLE_ZH =
  "赛博朋克 2077 夜之城人物肖像，冷峻霓虹黑色电影基调，青色与洋红环境边光，细腻的皮肤、衣物与义体金属接缝质感，背景干净有层次";

export const DEFAULT_SCENE_STYLE =
  "Cyberpunk 2077-inspired Night City scene, grounded urban architecture, neon from plausible in-scene sources, atmospheric depth, readable staging, no HUD";

export const DEFAULT_SCENE_STYLE_ZH =
  "赛博朋克 2077 夜之城场景插画，真实都市建筑与室内空间感，潮湿路面或环境霓虹反射，富有电影感的镜头构图与景深，无文字水印与界面框";

export const DEFAULT_AUX_SYSTEM_PROMPT = [
  "你是《赛博朋克 2077》角色扮演游戏的专业 AI 视觉分镜与生图提示词导演。",
  "请将提供的角色或剧情场景资料转化为一张单幅画面的生图提示词（只描写画面中肉眼可见的镜头构图、人物外貌、神态动作、服饰材质、外显义体、环境光影与氛围，不要写抽象背景故事、心理活动或游戏数值）。",
  "- 若目标为人物/NPC 肖像：默认采用半身或胸像构图，突出面部神态、发型、衣着与外显义体细节。",
  "- 若目标为回合场景插图：定格本轮叙事中最具画面感的一个已发生瞬间，严格还原正文中已成立的结果（不要把失败或未遂的动作画成成功），只画当前镜头内实际在场的人物。",
].join("\n");

export const ImageStyleConfigSchema = z.object({
  promptLanguage: ImagePromptLanguageSchema.optional(),
  customPrompt: z.string().trim().max(IMAGE_STYLE_FIELD_MAX_LENGTH).optional(),
  portraitStyle: z.string().trim().max(IMAGE_STYLE_FIELD_MAX_LENGTH).optional(),
  sceneStyle: z.string().trim().max(IMAGE_STYLE_FIELD_MAX_LENGTH).optional(),
  negativePrompt: z.string().trim().max(IMAGE_NEGATIVE_PROMPT_MAX_LENGTH).optional(),
  auxInstruction: z.string().trim().max(IMAGE_STYLE_FIELD_MAX_LENGTH).optional(),
  auxSystemPrompt: z.string().trim().max(IMAGE_AUX_SYSTEM_PROMPT_MAX_LENGTH).optional(),
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

export const MAX_TURN_SCENE_SEGMENTS = 4;

/** 将单轮剧情正文按段落（段落不足时按句子）均分为 1~4 个连续叙事分镜片段 */
export function splitTurnSceneSegments(sceneText: string, count: number): readonly string[] {
  const normalized = sceneText.trim();
  const target = Math.max(1, Math.min(MAX_TURN_SCENE_SEGMENTS, Math.floor(count)));
  if (!normalized || target <= 1) return normalized ? [normalized] : [];

  const rawParagraphs = normalized
    .split(/\n\s*\n+/)
    .map((p) => p.trim())
    .filter((p) => p !== "");
  const lineParagraphs =
    rawParagraphs.length > 1
      ? rawParagraphs
      : normalized
          .split(/\n+/)
          .map((p) => p.trim())
          .filter((p) => p !== "");

  let units: readonly string[] = lineParagraphs;
  if (units.length < target) {
    const sentences = normalized
      .split(/(?<=[。！？!?…\n])\s*/)
      .map((s) => s.trim())
      .filter((s) => s !== "");
    if (sentences.length > units.length) {
      units = sentences;
    }
  }

  if (units.length <= 1) {
    return Array.from({ length: target }, () => normalized);
  }

  const effectiveCount = Math.min(target, units.length);
  const totalChars = units.reduce((sum, u) => sum + u.length, 0);
  const segments: string[] = [];
  let cursor = 0;

  for (let seg = 0; seg < effectiveCount; seg++) {
    const remainingSegs = effectiveCount - seg;
    if (remainingSegs === 1) {
      segments.push(units.slice(cursor).join("\n\n"));
      break;
    }
    const maxEnd = units.length - (remainingSegs - 1);
    const idealChars = totalChars / effectiveCount;
    let end = cursor + 1;
    let acc = units[cursor]?.length ?? 0;
    while (end < maxEnd) {
      const nextLen = units[end]?.length ?? 0;
      if (Math.abs(acc + nextLen - idealChars) <= Math.abs(acc - idealChars)) {
        acc += nextLen;
        end += 1;
      } else {
        break;
      }
    }
    segments.push(units.slice(cursor, end).join("\n\n"));
    cursor = end;
  }

  while (segments.length < target) {
    segments.push(segments.at(-1) ?? normalized);
  }
  return segments;
}

/** 构造单轮正文第 segmentIndex（从 0 开始）个分镜对应的生图提示词输入 */
export function buildTurnSegmentPromptInput(
  input: TurnImagePromptInput,
  segmentIndex: number,
  totalSegments: number,
): TurnImagePromptInput {
  const total = Math.max(1, Math.min(MAX_TURN_SCENE_SEGMENTS, Math.floor(totalSegments)));
  if (total <= 1) return input;
  const segments = splitTurnSceneSegments(input.sceneText, total);
  const idx = Math.max(0, Math.min(segments.length - 1, Math.floor(segmentIndex)));
  const segmentText = segments[idx] ?? input.sceneText;
  const phaseLabel =
    idx === 0
      ? "开篇建立镜头"
      : idx === total - 1
        ? "高潮/收束镜头"
        : `中段推进镜头（第 ${idx + 1} 幕）`;
  const segmentHint = `这是本轮正文连续 ${total} 张插图中的第 ${idx + 1} 张（${phaseLabel}）。请只聚焦下面这一片段正在发生的视觉瞬间与构图，与同轮其他分镜在景别或视角上保持区分。`;
  return {
    ...input,
    sceneText: segmentText,
    instruction: [segmentHint, input.instruction.trim()].filter(Boolean).join("\n"),
  };
}

function genderHint(pronoun: string, lang: ImagePromptLanguage = "en"): string {
  const p = pronoun.trim();
  const isFemale = p === "她" || p.toLowerCase() === "she" || p.toLowerCase() === "her";
  const isMale = p === "他" || p.toLowerCase() === "he" || p.toLowerCase() === "him";
  if (lang === "zh") {
    return isFemale ? "女性" : isMale ? "男性" : "";
  }
  if (lang === "en-tags") {
    return isFemale ? "1girl, solo" : isMale ? "1boy, solo" : "solo";
  }
  return isFemale ? "female" : isMale ? "male" : "";
}

function compact(parts: readonly (string | null | undefined)[], sep = ", "): string {
  return parts
    .map((p) => p?.trim() ?? "")
    .filter((p) => p !== "")
    .join(sep);
}

function prependCustomPrompt(prompt: string, customPrompt?: string, sep = ", "): string {
  const custom = customPrompt?.trim() ?? "";
  const body = prompt.trim();
  if (!custom) return body;
  if (!body) return custom;
  if (body.toLowerCase().startsWith(custom.toLowerCase())) return body;
  return `${custom}${sep}${body}`;
}

function resolvePortraitStyle(
  style: ImageStyleConfig | undefined,
  lang: ImagePromptLanguage,
): string {
  const raw = style?.portraitStyle?.trim();
  if (raw === undefined) {
    return lang === "zh" ? DEFAULT_PORTRAIT_STYLE_ZH : DEFAULT_PORTRAIT_STYLE;
  }
  if (lang === "zh" && raw === DEFAULT_PORTRAIT_STYLE) {
    return DEFAULT_PORTRAIT_STYLE_ZH;
  }
  return raw;
}

function resolveSceneStyle(style: ImageStyleConfig | undefined, lang: ImagePromptLanguage): string {
  const raw = style?.sceneStyle?.trim();
  if (raw === undefined) {
    return lang === "zh" ? DEFAULT_SCENE_STYLE_ZH : DEFAULT_SCENE_STYLE;
  }
  if (lang === "zh" && raw === DEFAULT_SCENE_STYLE) {
    return DEFAULT_SCENE_STYLE_ZH;
  }
  return raw;
}

function resolveNegativePrompt(
  style: ImageStyleConfig | undefined,
  lang: ImagePromptLanguage,
): string {
  const raw = style?.negativePrompt?.trim();
  if (raw === undefined) {
    return lang === "zh" ? DEFAULT_NEGATIVE_PROMPT_ZH : DEFAULT_NEGATIVE_PROMPT;
  }
  if (lang === "zh" && raw === DEFAULT_NEGATIVE_PROMPT) {
    return DEFAULT_NEGATIVE_PROMPT_ZH;
  }
  return raw;
}

function sceneExcerpt(sceneText: string, maxLength: number): string {
  const normalized = sceneText.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  const headLength = Math.floor((maxLength - 40) * 0.25);
  const tailLength = maxLength - headLength - 40;
  return `${normalized.slice(0, headLength).trimEnd()} … ${normalized.slice(-tailLength).trimStart()}`;
}

function characterReferenceText(
  character: ImageCharacterReference,
  concise = false,
  lang: ImagePromptLanguage = "en",
): string {
  const limit = (text: string, length: number) => (concise ? text.slice(0, length) : text);
  if (lang === "zh") {
    return [
      `${character.name}${character.alias ? `（${character.alias}）` : ""}`,
      character.pronoun ? `代词：${character.pronoun}` : "",
      character.role ? `身份：${limit(character.role, 80)}` : "",
      character.look ? `外貌：${limit(character.look, 240)}` : "",
      character.outfit ? `衣着：${limit(character.outfit, 160)}` : "",
      character.wounds ? `状态：${limit(character.wounds, 120)}` : "",
      character.cyberware.length
        ? `义体：${(concise ? character.cyberware.slice(0, 4) : character.cyberware).join("、")}`
        : "",
      character.gear.length
        ? `随身装备：${(concise ? character.gear.slice(0, 3) : character.gear).join("、")}`
        : "",
    ]
      .filter(Boolean)
      .join("；");
  }
  return [
    `[${character.id}] ${character.name}${character.alias ? ` (${character.alias})` : ""}`,
    character.pronoun ? `pronoun: ${character.pronoun}` : "",
    character.role ? `role: ${limit(character.role, 80)}` : "",
    character.look ? `appearance: ${limit(character.look, 240)}` : "",
    character.outfit ? `outfit: ${limit(character.outfit, 160)}` : "",
    character.wounds ? `condition: ${limit(character.wounds, 120)}` : "",
    character.cyberware.length
      ? `cyberware: ${(concise ? character.cyberware.slice(0, 4) : character.cyberware).join(", ")}`
      : "",
    character.gear.length
      ? `gear: ${(concise ? character.gear.slice(0, 3) : character.gear).join(", ")}`
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
      { label: "appearance", value: character.look },
      { label: "outfit", value: character.outfit },
      { label: "condition", value: character.wounds },
      { label: "cyberware", value: character.cyberware.join(", ") },
      { label: "gear", value: character.gear.join(", ") },
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

/**
 * 不调用辅助模型时的本地拼接提示词：
 * - 去除冗长的英文说教元指令，仅拼接干净的视觉要素、玩家自定义提示词与画风；
 * - 当语言设为 `zh` 时全程使用中文拼接，彻底避免中英混杂。
 */
export function fallbackImagePrompt(
  input: ImagePromptRequest,
  style?: ImageStyleConfig,
  negativePromptMode: ImageNegativePromptMode = "independent",
): ImagePromptResult {
  const lang: ImagePromptLanguage = style?.promptLanguage ?? "en";
  const sep = lang === "zh" ? "，" : ", ";
  const portraitStyle = resolvePortraitStyle(style, lang);
  const sceneStyle = resolveSceneStyle(style, lang);
  const negativePrompt = resolveNegativePrompt(style, lang);
  const customPrompt = style?.customPrompt?.trim() || "";
  const auxExtra = style?.auxInstruction?.trim() || "";
  const exclusionPrefix =
    lang === "zh"
      ? "\n排除元素（画面中不要出现）："
      : "\nUser-requested exclusions (render the image without these): ";
  const exclusions =
    negativePromptMode === "in-prompt" && negativePrompt
      ? `${exclusionPrefix}${negativePrompt}`
      : "";
  const finish = (rawPrompt: string): ImagePromptResult => {
    const withCustom = prependCustomPrompt(rawPrompt, customPrompt, sep);
    return {
      prompt: `${withCustom}${exclusions}`,
      negativePrompt: negativePromptMode === "in-prompt" ? "" : negativePrompt,
      usedAux: false,
    };
  };

  if (input.kind === "character") {
    if (lang === "zh") {
      return finish(
        compact(
          [
            genderHint(input.pronoun, "zh")
              ? `${genderHint(input.pronoun, "zh")}佣兵半身肖像`
              : "夜之城佣兵半身肖像",
            input.origin ? `出身背景：${input.origin}` : "",
            input.look ? `外貌特征：${input.look}` : "",
            input.outfit ? `当前穿着：${input.outfit}` : "",
            input.wounds ? `伤势状态：${input.wounds}` : "",
            input.cyberware.length > 0 ? `义体：${input.cyberware.slice(0, 6).join("、")}` : "",
            input.gear.length > 0 ? `装备：${input.gear.slice(0, 4).join("、")}` : "",
            input.instruction,
            auxExtra,
            portraitStyle,
          ],
          "，",
        ),
      );
    }
    const subject = compact([
      genderHint(input.pronoun, lang),
      lang === "en-tags"
        ? "cyberpunk, mercenary, upper body, portrait"
        : "cyberpunk mercenary upper-body portrait",
      input.origin,
      input.look,
      input.outfit,
      input.wounds,
      input.cyberware.length > 0 ? input.cyberware.slice(0, 6).join(", ") : "",
      input.gear.length > 0 ? input.gear.slice(0, 4).join(", ") : "",
      input.instruction,
      auxExtra,
      portraitStyle,
    ]);
    return finish(subject);
  }

  if (input.kind === "npc") {
    if (lang === "zh") {
      return finish(
        compact(
          [
            genderHint(input.pronoun, "zh")
              ? `${genderHint(input.pronoun, "zh")}角色半身肖像`
              : "夜之城角色半身肖像",
            input.role ? `身份：${input.role}` : "",
            input.faction && input.faction !== "无" ? `所属势力：${input.faction}` : "",
            input.look ? `外貌特征：${input.look}` : "",
            input.outfit ? `当前穿着：${input.outfit}` : "",
            input.wounds ? `伤势状态：${input.wounds}` : "",
            input.cyberware?.length ? `义体：${input.cyberware.slice(0, 6).join("、")}` : "",
            input.gear?.length ? `装备：${input.gear.slice(0, 4).join("、")}` : "",
            input.instruction,
            auxExtra,
            portraitStyle,
          ],
          "，",
        ),
      );
    }
    const subject = compact([
      genderHint(input.pronoun, lang),
      lang === "en-tags"
        ? "cyberpunk, character portrait, upper body"
        : "Night City character upper-body portrait",
      input.role,
      input.faction && input.faction !== "无" ? input.faction : "",
      input.look,
      input.outfit,
      input.wounds,
      input.cyberware?.length ? input.cyberware.slice(0, 6).join(", ") : "",
      input.gear?.length ? input.gear.slice(0, 4).join(", ") : "",
      input.instruction,
      auxExtra,
      portraitStyle,
    ]);
    return finish(subject);
  }

  const references = input.characters
    .slice(0, 8)
    .map((character) => characterReferenceText(character, true, lang))
    .join("\n")
    .slice(0, 3600);
  if (lang === "zh") {
    const framing = compact(
      [
        input.location || input.district
          ? `地点：${[input.district, input.location].filter(Boolean).join(" · ")}`
          : "夜之城街头或室内场景",
        input.timeText ? `时间：${input.timeText}` : "",
        input.weather ? `天气：${input.weather}` : "",
        input.instruction ? `画面重点：${input.instruction}` : "",
        auxExtra,
        sceneStyle,
      ],
      "，",
    );
    const fixed = references
      ? `${framing}\n在场人物参考：\n${references}\n场景画面：\n`
      : `${framing}\n场景画面：\n`;
    const excerpt = sceneExcerpt(
      input.sceneText,
      Math.max(
        300,
        IMAGE_PROMPT_MAX_LENGTH - fixed.length - exclusions.length - customPrompt.length,
      ),
    );
    return finish(`${fixed}${excerpt}`);
  }

  const framing = compact([
    input.location || input.district
      ? [input.district, input.location].filter(Boolean).join(" - ")
      : "Night City scene",
    input.timeText,
    input.weather,
    input.instruction,
    auxExtra,
    sceneStyle,
  ]);
  const fixed = references
    ? `${framing}\nCharacters:\n${references}\nScene:\n`
    : `${framing}\nScene:\n`;
  const excerpt = sceneExcerpt(
    input.sceneText,
    Math.max(300, IMAGE_PROMPT_MAX_LENGTH - fixed.length - exclusions.length - customPrompt.length),
  );
  return finish(`${fixed}${excerpt}`);
}

function buildAuxMessages(
  input: ImagePromptRequest,
  style?: ImageStyleConfig,
  negativePromptMode: ImageNegativePromptMode = "independent",
): readonly LlmMessage[] {
  const lang: ImagePromptLanguage = style?.promptLanguage ?? "en";
  const portraitStyle = resolvePortraitStyle(style, lang);
  const sceneStyle = resolveSceneStyle(style, lang);
  const negativeHint = resolveNegativePrompt(style, lang);
  const targetStyle = input.kind === "turn" ? sceneStyle : portraitStyle;
  const customPrompt = style?.customPrompt?.trim() || "";
  const userDirectorPrompt = style?.auxSystemPrompt?.trim() || DEFAULT_AUX_SYSTEM_PROMPT;

  const languageRule =
    lang === "en-tags"
      ? 'LANGUAGE & FORMAT RULE: "prompt" MUST be 100% pure English comma-separated Danbooru/NovelAI visual tags (e.g., "1girl, solo, cyberpunk, neon lights, cybernetic eyes, leather jacket, rainy street, cinematic lighting"). Translate every Chinese feature/outfit/cyberware/place into accurate English tags. NEVER output any Chinese characters in "prompt".'
      : lang === "zh"
        ? 'LANGUAGE & FORMAT RULE: "prompt" MUST be 100% pure, fluent Chinese visual description (纯中文画面描述). Do NOT mix English labels or English sentences into "prompt" (except user-supplied custom tags if any).'
        : 'LANGUAGE & FORMAT RULE: "prompt" MUST be 100% pure English natural-language visual description. Translate all Chinese appearance, cyberware, clothing, and scene details into vivid English visual prose. NEVER output any Chinese characters in "prompt".';

  const system = [
    userDirectorPrompt,
    "",
    "Strict Output Specification:",
    '1. Output valid JSON ONLY with keys: "prompt" (string) and "negativePrompt" (string).',
    `2. ${languageRule}`,
    `3. Maximum ${IMAGE_PROMPT_MAX_LENGTH} characters for "prompt" and ${IMAGE_NEGATIVE_PROMPT_MAX_LENGTH} for "negativePrompt". Describe only visible elements (composition, lighting, appearance, pose, expression, outfit, visible implants, environment). No HUD, no text overlays, no watermarks.`,
    targetStyle ? `4. Visual style baseline: ${targetStyle}` : "",
    customPrompt
      ? `5. Custom fixed prompt prefix/tags to preserve at the beginning of "prompt": ${customPrompt}`
      : "",
    negativeHint
      ? negativePromptMode === "in-prompt"
        ? `6. Target model uses a single prompt without a separate negative field. Incorporate these exclusions concisely at the end of "prompt" in the selected language and return "negativePrompt": "". Exclusions: ${negativeHint}`
        : `6. Keep these exclusions in "negativePrompt": ${negativeHint}`
      : '6. Return "negativePrompt": "".',
    ...(style?.auxInstruction?.trim()
      ? [`7. Additional player directive: ${style.auxInstruction.trim()}`]
      : []),
  ]
    .filter(Boolean)
    .join("\n");

  if (input.kind === "character") {
    const lines = [
      `Target: Player character portrait`,
      `Name/Alias: ${input.name}${input.alias ? ` (${input.alias})` : ""}`,
      `Pronoun: ${input.pronoun}; gender cue: ${genderHint(input.pronoun, "en") || "unspecified"}`,
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
      `Pronoun: ${input.pronoun}; gender cue: ${genderHint(input.pronoun, "en") || "unspecified"}`,
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
  negativePrompt: z.string().trim().max(IMAGE_NEGATIVE_PROMPT_MAX_LENGTH).optional(),
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
 * 调用辅助模型提炼生图提示词；
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
  const lang: ImagePromptLanguage = style?.promptLanguage ?? "en";
  const sep = lang === "zh" ? "，" : ", ";
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
  const defaultNeg = resolveNegativePrompt(style, lang);
  const parsed = parseAuxReply(reply, defaultNeg);
  if (!parsed) {
    return {
      ...fallbackImagePrompt(input, style, negativePromptMode),
      fallbackReason: "辅助模型返回内容格式异常，已回退本地拼接提示词",
    };
  }
  const withCustom = prependCustomPrompt(parsed.prompt, style?.customPrompt, sep);
  const exclusionPrefix =
    lang === "zh"
      ? "\n排除元素（画面中不要出现）："
      : "\nUser-requested exclusions (render the image without these): ";
  const prompt =
    negativePromptMode === "in-prompt" && parsed.negativePrompt
      ? `${withCustom}${exclusionPrefix}${parsed.negativePrompt}`
      : withCustom;
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
