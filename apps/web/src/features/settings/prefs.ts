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

const KEY = "cp.narrativePrefs";
const EVENT = "cp-narrative-prefs";
const DEFAULTS: NarrativePrefs = {
  sceneTitles: false,
  storyTheme: true,
  choiceFillOnly: false,
  spoilers: false,
  offscreen: "normal",
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
  window.dispatchEvent(new Event(EVENT));
}

export function setNarrativePref(key: NarrativeToggle, on: boolean): void {
  save({ ...read(), [key]: on });
}

export function setOffscreenPace(pace: OffscreenPace): void {
  save({ ...read(), offscreen: pace });
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
