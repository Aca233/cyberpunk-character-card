import { useSyncExternalStore } from "react";

/** 音频偏好：存于本机浏览器 localStorage，修改后即时生效 */
export interface AudioPrefs {
  /** 总静音 */
  readonly muted: boolean;
  /** 主音量（0..1） */
  readonly masterVolume: number;
  /** 背景音乐开关 */
  readonly bgmEnabled: boolean;
  /** 背景音乐音量（0..1） */
  readonly bgmVolume: number;
  /** 音效开关 */
  readonly sfxEnabled: boolean;
  /** 音效音量（0..1） */
  readonly sfxVolume: number;
  /** 界面悬停微交互音（轻量触感滴声） */
  readonly uiHoverSfx: boolean;
}

const KEY = "cp.audioPrefs";
const EVENT = "cp-audio-prefs";

export const DEFAULT_AUDIO_PREFS: AudioPrefs = {
  muted: false,
  masterVolume: 0.78,
  bgmEnabled: true,
  bgmVolume: 0.52,
  sfxEnabled: true,
  sfxVolume: 0.82,
  uiHoverSfx: true,
};

let cache: { readonly raw: string | null; readonly value: AudioPrefs } | null = null;

function clampUnit(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(1, Math.round(value * 100) / 100));
}

function read(): AudioPrefs {
  const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(KEY);
  if (cache && cache.raw === raw) return cache.value;
  let value = DEFAULT_AUDIO_PREFS;
  if (raw !== null) {
    try {
      const parsed = JSON.parse(raw) as Partial<Record<keyof AudioPrefs, unknown>>;
      value = {
        muted: parsed.muted === true,
        masterVolume: clampUnit(parsed.masterVolume, DEFAULT_AUDIO_PREFS.masterVolume),
        bgmEnabled: parsed.bgmEnabled !== false,
        bgmVolume: clampUnit(parsed.bgmVolume, DEFAULT_AUDIO_PREFS.bgmVolume),
        sfxEnabled: parsed.sfxEnabled !== false,
        sfxVolume: clampUnit(parsed.sfxVolume, DEFAULT_AUDIO_PREFS.sfxVolume),
        uiHoverSfx: parsed.uiHoverSfx !== false,
      };
    } catch {
      value = DEFAULT_AUDIO_PREFS;
    }
  }
  cache = { raw, value };
  return value;
}

function save(next: AudioPrefs): void {
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(KEY, JSON.stringify(next));
  }
  cache = null;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(EVENT));
  }
}

export function audioPrefs(): AudioPrefs {
  return read();
}

export function setAudioPref<K extends keyof AudioPrefs>(key: K, value: AudioPrefs[K]): void {
  const nextValue =
    typeof value === "number" ? (clampUnit(value, DEFAULT_AUDIO_PREFS[key] as number) as AudioPrefs[K]) : value;
  save({ ...read(), [key]: nextValue });
}

export function toggleMute(): boolean {
  const next = !read().muted;
  save({ ...read(), muted: next });
  return next;
}

export function resetAudioPrefs(): void {
  save(DEFAULT_AUDIO_PREFS);
}

export function subscribeAudioPrefs(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function useAudioPrefs(): AudioPrefs {
  return useSyncExternalStore(subscribeAudioPrefs, read, () => DEFAULT_AUDIO_PREFS);
}
