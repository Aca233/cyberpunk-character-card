import { useSyncExternalStore } from "react";

/** 叙事偏好：只存在这台浏览器里；都默认关闭 */
export interface NarrativePrefs {
  /** 场景开头打出一行标题卡：城区 · 地点 · 时间 */
  readonly sceneTitles: boolean;
  /** 接到大单、首领现身、拿到不朽物品时弹特写卡 */
  readonly closeups: boolean;
}

const KEY = "cp.narrativePrefs";
const EVENT = "cp-narrative-prefs";
const DEFAULTS: NarrativePrefs = { sceneTitles: false, closeups: false };

let cache: { readonly raw: string | null; readonly value: NarrativePrefs } | null = null;

function read(): NarrativePrefs {
  const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(KEY);
  if (cache && cache.raw === raw) return cache.value;
  let value = DEFAULTS;
  if (raw !== null) {
    try {
      const parsed = JSON.parse(raw) as Partial<Record<keyof NarrativePrefs, unknown>>;
      value = { sceneTitles: parsed.sceneTitles === true, closeups: parsed.closeups === true };
    } catch {
      value = DEFAULTS;
    }
  }
  cache = { raw, value };
  return value;
}

export function setNarrativePref(key: keyof NarrativePrefs, on: boolean): void {
  localStorage.setItem(KEY, JSON.stringify({ ...read(), [key]: on }));
  window.dispatchEvent(new Event(EVENT));
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
