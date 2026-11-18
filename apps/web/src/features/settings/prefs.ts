import {
  DEFAULT_NEGATIVE_PROMPT,
  DEFAULT_PORTRAIT_STYLE,
  DEFAULT_SCENE_STYLE,
  type ImageStyleConfig,
  type OffscreenPace,
} from "@cp/core";
import { useSyncExternalStore } from "react";

/** 叙事与文生图偏好：只存在这台浏览器里 */
export interface NarrativePrefs {
  /** 场景开头打出一行标题卡：城区 · 地点 · 时间 · 天气 */
  readonly sceneTitles: boolean;
  /** 剧透调试视图：上下文查看器、存为测评用例；打开时屏幕顶部常驻「剧透」 */
  readonly spoilers: boolean;
  /** 城里的动静（场外生态推演）多久跑一次；每轮随请求带给后端 */
  readonly offscreen: OffscreenPace;
  /** 回合叙事结束后自动生成本轮场景插图 */
  readonly autoTurnImage: boolean;
  /** 提炼生图提示词时优先调用辅助模型 */
  readonly autoImageUseAux: boolean;
  /** 角色/NPC 肖像通用画风提示词 */
  readonly imagePortraitPrompt: string;
  /** 回合场景插图通用画风提示词 */
  readonly imageScenePrompt: string;
  /** 默认反向提示词 */
  readonly imageNegativePrompt: string;
  /** 交给辅助模型的额外生图导演要求 */
  readonly imageAuxInstruction: string;
}

export type NarrativeToggle = "sceneTitles" | "spoilers" | "autoTurnImage" | "autoImageUseAux";

export type ImagePromptField =
  | "imagePortraitPrompt"
  | "imageScenePrompt"
  | "imageNegativePrompt"
  | "imageAuxInstruction";

const PACES: readonly OffscreenPace[] = ["off", "slow", "normal", "fast"];

const KEY = "cp.narrativePrefs";
const EVENT = "cp-narrative-prefs";
const DEFAULTS: NarrativePrefs = {
  sceneTitles: false,
  spoilers: false,
  offscreen: "normal",
  autoTurnImage: false,
  autoImageUseAux: true,
  imagePortraitPrompt: DEFAULT_PORTRAIT_STYLE,
  imageScenePrompt: DEFAULT_SCENE_STYLE,
  imageNegativePrompt: DEFAULT_NEGATIVE_PROMPT,
  imageAuxInstruction: "",
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
      value = {
        sceneTitles: parsed.sceneTitles === true,
        spoilers: parsed.spoilers === true,
        offscreen: PACES.find((p) => p === parsed.offscreen) ?? "normal",
        autoTurnImage: parsed.autoTurnImage === true,
        autoImageUseAux: parsed.autoImageUseAux !== false,
        imagePortraitPrompt: strField(parsed.imagePortraitPrompt, DEFAULT_PORTRAIT_STYLE),
        imageScenePrompt: strField(parsed.imageScenePrompt, DEFAULT_SCENE_STYLE),
        imageNegativePrompt: strField(parsed.imageNegativePrompt, DEFAULT_NEGATIVE_PROMPT),
        imageAuxInstruction: strField(parsed.imageAuxInstruction, ""),
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
export function imageStyleConfig(): ImageStyleConfig {
  const prefs = read();
  return {
    portraitStyle: prefs.imagePortraitPrompt,
    sceneStyle: prefs.imageScenePrompt,
    negativePrompt: prefs.imageNegativePrompt,
    auxInstruction: prefs.imageAuxInstruction,
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

export function setImagePromptField(key: ImagePromptField, value: string): void {
  save({ ...read(), [key]: value });
}

export function resetImagePromptFields(): void {
  save({
    ...read(),
    imagePortraitPrompt: DEFAULT_PORTRAIT_STYLE,
    imageScenePrompt: DEFAULT_SCENE_STYLE,
    imageNegativePrompt: DEFAULT_NEGATIVE_PROMPT,
    imageAuxInstruction: "",
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
