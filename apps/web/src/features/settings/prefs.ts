import {
  DEFAULT_AUX_SYSTEM_PROMPT,
  DEFAULT_NEGATIVE_PROMPT,
  DEFAULT_NEGATIVE_PROMPT_ZH,
  DEFAULT_PORTRAIT_STYLE,
  DEFAULT_PORTRAIT_STYLE_ZH,
  DEFAULT_SCENE_STYLE,
  DEFAULT_SCENE_STYLE_ZH,
  type ImagePromptLanguage,
  type ImageStyleConfig,
  type OffscreenPace,
} from "@cp/core";
import { useSyncExternalStore } from "react";

export type ImageBatchCount = 1 | 2 | 3 | 4;

/** 正文字体预设：内置默认无衬线 / 宋体衬线 / 楷体手书 / 系统黑体 / 终端等宽 / 自定义字体名 */
export type StoryFontPreset = "default" | "serif" | "kai" | "system" | "mono" | "custom";

export const STORY_FONT_SIZE_MIN = 14;
export const STORY_FONT_SIZE_MAX = 26;
export const STORY_FONT_SIZE_DEFAULT = 18;
export const STORY_LINE_HEIGHT_MIN = 1.45;
export const STORY_LINE_HEIGHT_MAX = 2.25;
export const STORY_LINE_HEIGHT_DEFAULT = 1.85;
export const UI_FONT_SCALE_MIN = 85;
export const UI_FONT_SCALE_MAX = 125;
export const UI_FONT_SCALE_DEFAULT = 100;

export const DEFAULT_FONT_BODY = '"Noto Sans SC Variable", "Rajdhani", sans-serif';
export const DEFAULT_FONT_UI = '"Rajdhani", "Noto Sans SC Variable", sans-serif';

export const STORY_FONT_STACKS: Readonly<Record<Exclude<StoryFontPreset, "custom">, string>> = {
  default: DEFAULT_FONT_BODY,
  serif:
    '"Source Han Serif SC", "Noto Serif SC", "Songti SC", "STSong", "SimSun", "FangSong", Georgia, serif',
  kai: '"LXGW WenKai", "Kaiti SC", "STKaiti", "KaiTi", "BiauKai", Georgia, serif',
  system:
    '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Segoe UI", system-ui, -apple-system, sans-serif',
  mono: '"JetBrains Mono", "Cascadia Mono", "Sarasa Mono SC", "Noto Sans SC Variable", Consolas, ui-monospace, monospace',
};

/** 叙事与文生图偏好：只存在这台浏览器里 */
export interface NarrativePrefs {
  /** 场景开头打出一行标题卡：城区 · 地点 · 时间 · 天气 */
  readonly sceneTitles: boolean;
  /** 局内应用界面主题：开启后剧情界面也使用当前所选主题的动态壁纸与配色；关闭则按当前地点与时段显示夜之城实景 */
  readonly storyTheme: boolean;
  /** 点选行动选项时只填入输入框、不自动发送，方便修改或补充细节后再发 */
  readonly choiceFillOnly: boolean;
  /** 剧透调试视图：上下文查看器、存为测评用例；打开时屏幕顶部常驻「剧透」 */
  readonly spoilers: boolean;
  /** 城里的动静（场外生态推演）多久跑一次；每轮随请求带给后端 */
  readonly offscreen: OffscreenPace;
  /** 正文字体风格 */
  readonly storyFont: StoryFontPreset;
  /** 自定义正文字体名（逗号分隔，仅 storyFont === "custom" 时生效，如 霞鹜文楷, Microsoft YaHei） */
  readonly storyCustomFont: string;
  /** 是否把所选字体同步应用到全部界面文字（关闭时仅作用于剧情正文） */
  readonly applyFontToUi: boolean;
  /** 剧情正文字号（px，14–26） */
  readonly storyFontSize: number;
  /** 剧情正文行距（1.45–2.25） */
  readonly storyLineHeight: number;
  /** 界面基础字号缩放（%，85–125） */
  readonly uiFontScale: number;
  /** 回合叙事结束后自动生成本轮场景插图 */
  readonly autoTurnImage: boolean;
  /** 提炼生图提示词时优先调用辅助模型 */
  readonly autoImageUseAux: boolean;
  /** 提示词输出语言与格式：纯英文自然语言 / 英文 Tag 词组 / 纯中文 */
  readonly imagePromptLanguage: ImagePromptLanguage;
  /** 单轮剧情正文默认穿插插图数量（1 ~ 4 张） */
  readonly imageBatchCount: ImageBatchCount;
  /** 通用自定义固定提示词（总是拼在提示词最前面，如画质词、画师串、LoRA 触发词） */
  readonly imageCustomPrompt: string;
  /** 角色/NPC 肖像通用画风提示词 */
  readonly imagePortraitPrompt: string;
  /** 回合场景插图通用画风提示词 */
  readonly imageScenePrompt: string;
  /** 默认反向提示词 */
  readonly imageNegativePrompt: string;
  /** 交给辅助模型的额外生图导演要求 */
  readonly imageAuxInstruction: string;
  /** 辅助模型提炼主提示词（System Prompt），玩家可直接替换接管 */
  readonly imageAuxSystemPrompt: string;
}

export type NarrativeToggle =
  | "sceneTitles"
  | "storyTheme"
  | "choiceFillOnly"
  | "applyFontToUi"
  | "spoilers"
  | "autoTurnImage"
  | "autoImageUseAux";

export type ImagePromptField =
  | "imageCustomPrompt"
  | "imagePortraitPrompt"
  | "imageScenePrompt"
  | "imageNegativePrompt"
  | "imageAuxInstruction"
  | "imageAuxSystemPrompt";

const PACES: readonly OffscreenPace[] = ["off", "slow", "normal", "fast"];
const LANGUAGES: readonly ImagePromptLanguage[] = ["en", "en-tags", "zh"];
const BATCH_COUNTS: readonly ImageBatchCount[] = [1, 2, 3, 4];
const FONT_PRESETS: readonly StoryFontPreset[] = [
  "default",
  "serif",
  "kai",
  "system",
  "mono",
  "custom",
];

const KEY = "cp.narrativePrefs";
const EVENT = "cp-narrative-prefs";
const DEFAULTS: NarrativePrefs = {
  sceneTitles: false,
  storyTheme: true,
  choiceFillOnly: false,
  spoilers: false,
  offscreen: "normal",
  storyFont: "default",
  storyCustomFont: "",
  applyFontToUi: false,
  storyFontSize: STORY_FONT_SIZE_DEFAULT,
  storyLineHeight: STORY_LINE_HEIGHT_DEFAULT,
  uiFontScale: UI_FONT_SCALE_DEFAULT,
  autoTurnImage: false,
  autoImageUseAux: true,
  imagePromptLanguage: "en",
  imageBatchCount: 1,
  imageCustomPrompt: "",
  imagePortraitPrompt: DEFAULT_PORTRAIT_STYLE,
  imageScenePrompt: DEFAULT_SCENE_STYLE,
  imageNegativePrompt: DEFAULT_NEGATIVE_PROMPT,
  imageAuxInstruction: "",
  imageAuxSystemPrompt: DEFAULT_AUX_SYSTEM_PROMPT,
};

let cache: { readonly raw: string | null; readonly value: NarrativePrefs } | null = null;

function strField(raw: unknown, fallback: string): string {
  return typeof raw === "string" ? raw : fallback;
}

function clampNumber(raw: unknown, min: number, max: number, fallback: number, step = 1): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return fallback;
  const clamped = Math.min(max, Math.max(min, raw));
  return Math.round(clamped / step) * step;
}

/** 构造安全的 CSS font-family 声明，防止自定义字体名破坏样式语法 */
function buildCustomFontFamily(raw: string): string {
  const names = raw
    .split(/[,，\n]+/)
    .map((part) =>
      part
        .trim()
        .replace(/^["']+|["']+$/g, "")
        .replace(/[;"'\\{}<>]/g, ""),
    )
    .filter((part) => part.length > 0)
    .slice(0, 6);
  if (names.length === 0) return DEFAULT_FONT_BODY;
  const quoted = names.map((name) => (/^[a-zA-Z0-9-]+$/.test(name) ? name : `"${name}"`));
  return `${quoted.join(", ")}, ${DEFAULT_FONT_BODY}`;
}

/** 计算当前生效的正文 font-family */
export function resolveStoryFontFamily(
  prefs: Pick<NarrativePrefs, "storyFont" | "storyCustomFont">,
): string {
  if (prefs.storyFont === "custom") {
    return buildCustomFontFamily(prefs.storyCustomFont);
  }
  return STORY_FONT_STACKS[prefs.storyFont] ?? DEFAULT_FONT_BODY;
}

/** 把字体与字号设置立即同步到 documentElement CSS 变量，全站与剧情正文实时生效 */
export function applyTypographyPrefs(prefs: NarrativePrefs = read()): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const bodyFamily = resolveStoryFontFamily(prefs);
  const scale = prefs.uiFontScale / 100;
  const roundPx = (base: number) => `${Math.round(base * scale * 10) / 10}px`;

  root.style.setProperty("--font-body", bodyFamily);
  if (prefs.applyFontToUi) {
    root.style.setProperty("--font-ui", bodyFamily);
  } else {
    root.style.removeProperty("--font-ui");
  }
  root.style.setProperty("--story-size", `${prefs.storyFontSize}px`);
  root.style.setProperty("--story-leading", String(Number(prefs.storyLineHeight.toFixed(2))));

  if (prefs.uiFontScale === UI_FONT_SCALE_DEFAULT) {
    root.style.removeProperty("--fs-body");
    root.style.removeProperty("--fs-ui");
    root.style.removeProperty("--fs-label");
    root.style.removeProperty("--fs-menu");
  } else {
    root.style.setProperty("--fs-body", roundPx(17));
    root.style.setProperty("--fs-ui", roundPx(15));
    root.style.setProperty("--fs-label", roundPx(12));
    root.style.setProperty("--fs-menu", roundPx(26));
  }
}

let typographyBound = false;

/** 应用启动时安装一次排版偏好同步（含跨标签页 storage 同步） */
export function installTypographyPrefs(): void {
  applyTypographyPrefs(read());
  if (typographyBound || typeof window === "undefined") return;
  typographyBound = true;
  const sync = () => applyTypographyPrefs(read());
  window.addEventListener(EVENT, sync);
  window.addEventListener("storage", sync);
}

function read(): NarrativePrefs {
  const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(KEY);
  if (cache && cache.raw === raw) return cache.value;
  let value = DEFAULTS;
  if (raw !== null) {
    try {
      const parsed = JSON.parse(raw) as Partial<Record<keyof NarrativePrefs, unknown>>;
      const lang = LANGUAGES.find((l) => l === parsed.imagePromptLanguage) ?? "en";
      value = {
        sceneTitles: parsed.sceneTitles === true,
        storyTheme: parsed.storyTheme !== false,
        choiceFillOnly: parsed.choiceFillOnly === true,
        spoilers: parsed.spoilers === true,
        offscreen: PACES.find((p) => p === parsed.offscreen) ?? "normal",
        storyFont: FONT_PRESETS.find((f) => f === parsed.storyFont) ?? "default",
        storyCustomFont: strField(parsed.storyCustomFont, "").slice(0, 120),
        applyFontToUi: parsed.applyFontToUi === true,
        storyFontSize: clampNumber(
          parsed.storyFontSize,
          STORY_FONT_SIZE_MIN,
          STORY_FONT_SIZE_MAX,
          STORY_FONT_SIZE_DEFAULT,
          1,
        ),
        storyLineHeight: Number(
          clampNumber(
            parsed.storyLineHeight,
            STORY_LINE_HEIGHT_MIN,
            STORY_LINE_HEIGHT_MAX,
            STORY_LINE_HEIGHT_DEFAULT,
            0.05,
          ).toFixed(2),
        ),
        uiFontScale: clampNumber(
          parsed.uiFontScale,
          UI_FONT_SCALE_MIN,
          UI_FONT_SCALE_MAX,
          UI_FONT_SCALE_DEFAULT,
          5,
        ),
        autoTurnImage: parsed.autoTurnImage === true,
        autoImageUseAux: parsed.autoImageUseAux !== false,
        imagePromptLanguage: lang,
        imageBatchCount: BATCH_COUNTS.find((n) => n === parsed.imageBatchCount) ?? 1,
        imageCustomPrompt: strField(parsed.imageCustomPrompt, ""),
        imagePortraitPrompt: strField(
          parsed.imagePortraitPrompt,
          lang === "zh" ? DEFAULT_PORTRAIT_STYLE_ZH : DEFAULT_PORTRAIT_STYLE,
        ),
        imageScenePrompt: strField(
          parsed.imageScenePrompt,
          lang === "zh" ? DEFAULT_SCENE_STYLE_ZH : DEFAULT_SCENE_STYLE,
        ),
        imageNegativePrompt: strField(
          parsed.imageNegativePrompt,
          lang === "zh" ? DEFAULT_NEGATIVE_PROMPT_ZH : DEFAULT_NEGATIVE_PROMPT,
        ),
        imageAuxInstruction: strField(parsed.imageAuxInstruction, ""),
        imageAuxSystemPrompt: strField(parsed.imageAuxSystemPrompt, DEFAULT_AUX_SYSTEM_PROMPT),
      };
    } catch {
      value = DEFAULTS;
    }
  }
  cache = { raw, value };
  return value;
}

/** 给接口层用：现在开没开剧透 */
export function spoilersOn(): boolean {
  return read().spoilers;
}

/** 给接口层用：城里的动静多久跑一次 */
export function offscreenPace(): OffscreenPace {
  return read().offscreen;
}

/** 读取玩家在设置中自定义的生图提示词配置 */
export function imageStyleConfig(override?: Partial<ImageStyleConfig>): ImageStyleConfig {
  const prefs = read();
  return {
    promptLanguage: prefs.imagePromptLanguage,
    customPrompt: prefs.imageCustomPrompt,
    portraitStyle: prefs.imagePortraitPrompt,
    sceneStyle: prefs.imageScenePrompt,
    negativePrompt: prefs.imageNegativePrompt,
    auxInstruction: prefs.imageAuxInstruction,
    auxSystemPrompt: prefs.imageAuxSystemPrompt,
    ...override,
  };
}

function save(next: NarrativePrefs): void {
  localStorage.setItem(KEY, JSON.stringify(next));
  applyTypographyPrefs(next);
  window.dispatchEvent(new Event(EVENT));
}

export function setNarrativePref(key: NarrativeToggle, on: boolean): void {
  save({ ...read(), [key]: on });
}

export function setOffscreenPace(pace: OffscreenPace): void {
  save({ ...read(), offscreen: pace });
}

export function setStoryFont(font: StoryFontPreset): void {
  save({ ...read(), storyFont: font });
}

export function setStoryCustomFont(value: string): void {
  save({ ...read(), storyCustomFont: value.slice(0, 120) });
}

export function setStoryFontSize(size: number): void {
  const clamped = clampNumber(
    size,
    STORY_FONT_SIZE_MIN,
    STORY_FONT_SIZE_MAX,
    STORY_FONT_SIZE_DEFAULT,
    1,
  );
  save({ ...read(), storyFontSize: clamped });
}

export function setStoryLineHeight(leading: number): void {
  const clamped = Number(
    clampNumber(
      leading,
      STORY_LINE_HEIGHT_MIN,
      STORY_LINE_HEIGHT_MAX,
      STORY_LINE_HEIGHT_DEFAULT,
      0.05,
    ).toFixed(2),
  );
  save({ ...read(), storyLineHeight: clamped });
}

export function setUiFontScale(scale: number): void {
  const clamped = clampNumber(
    scale,
    UI_FONT_SCALE_MIN,
    UI_FONT_SCALE_MAX,
    UI_FONT_SCALE_DEFAULT,
    5,
  );
  save({ ...read(), uiFontScale: clamped });
}

export function resetTypographyPrefs(): void {
  save({
    ...read(),
    storyFont: "default",
    storyCustomFont: "",
    applyFontToUi: false,
    storyFontSize: STORY_FONT_SIZE_DEFAULT,
    storyLineHeight: STORY_LINE_HEIGHT_DEFAULT,
    uiFontScale: UI_FONT_SCALE_DEFAULT,
  });
}

export function setImagePromptLanguage(lang: ImagePromptLanguage): void {
  const current = read();
  const isDefaultPortrait =
    current.imagePortraitPrompt === DEFAULT_PORTRAIT_STYLE ||
    current.imagePortraitPrompt === DEFAULT_PORTRAIT_STYLE_ZH;
  const isDefaultScene =
    current.imageScenePrompt === DEFAULT_SCENE_STYLE ||
    current.imageScenePrompt === DEFAULT_SCENE_STYLE_ZH;
  const isDefaultNeg =
    current.imageNegativePrompt === DEFAULT_NEGATIVE_PROMPT ||
    current.imageNegativePrompt === DEFAULT_NEGATIVE_PROMPT_ZH;
  save({
    ...current,
    imagePromptLanguage: lang,
    ...(isDefaultPortrait
      ? {
          imagePortraitPrompt: lang === "zh" ? DEFAULT_PORTRAIT_STYLE_ZH : DEFAULT_PORTRAIT_STYLE,
        }
      : {}),
    ...(isDefaultScene
      ? {
          imageScenePrompt: lang === "zh" ? DEFAULT_SCENE_STYLE_ZH : DEFAULT_SCENE_STYLE,
        }
      : {}),
    ...(isDefaultNeg
      ? {
          imageNegativePrompt: lang === "zh" ? DEFAULT_NEGATIVE_PROMPT_ZH : DEFAULT_NEGATIVE_PROMPT,
        }
      : {}),
  });
}

export function setImageBatchCount(count: ImageBatchCount): void {
  save({ ...read(), imageBatchCount: count });
}

export function setImagePromptField(key: ImagePromptField, value: string): void {
  save({ ...read(), [key]: value });
}

export function resetImagePromptFields(): void {
  const current = read();
  const zh = current.imagePromptLanguage === "zh";
  save({
    ...current,
    imageCustomPrompt: "",
    imagePortraitPrompt: zh ? DEFAULT_PORTRAIT_STYLE_ZH : DEFAULT_PORTRAIT_STYLE,
    imageScenePrompt: zh ? DEFAULT_SCENE_STYLE_ZH : DEFAULT_SCENE_STYLE,
    imageNegativePrompt: zh ? DEFAULT_NEGATIVE_PROMPT_ZH : DEFAULT_NEGATIVE_PROMPT,
    imageAuxInstruction: "",
    imageAuxSystemPrompt: DEFAULT_AUX_SYSTEM_PROMPT,
  });
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function useNarrativePrefs(): NarrativePrefs {
  return useSyncExternalStore(subscribe, read, () => DEFAULTS);
}
