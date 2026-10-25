import type { OffscreenPace, travelRules } from "@cp/core";
import { useSyncExternalStore } from "react";

/** 叙事偏好：只存在这台浏览器里；开关默认关闭，城里的动静默认常规 */
export interface NarrativePrefs {
  /** 场景开头打出一行标题卡：城区 · 地点 · 时间 */
  readonly sceneTitles: boolean;
  /** 接到大单、首领现身、拿到不朽物品时弹特写卡 */
  readonly closeups: boolean;
  /** 剧透调试视图：上下文查看器、存为测评用例；打开时屏幕顶部常驻「剧透」 */
  readonly spoilers: boolean;
  /** 智力检定确认前先玩原作的入侵协议矩阵，解开的序列换算成加成；默认关 */
  readonly breachMatrix: boolean;
  /** 城里的动静（场外推演）多久跑一次；每轮随请求带给后端 */
  readonly offscreen: OffscreenPace;
  /** 路上偶遇的频率；每轮随请求带给后端 */
  readonly encounters: EncounterPace;
}

export type EncounterPace = travelRules.EncounterPace;

export type NarrativeToggle = Exclude<keyof NarrativePrefs, "offscreen" | "encounters">;
const PACES: readonly OffscreenPace[] = ["off", "slow", "normal", "fast"];
const ENCOUNTER_PACES: readonly EncounterPace[] = ["off", "rare", "normal", "often"];

const KEY = "cp.narrativePrefs";
const EVENT = "cp-narrative-prefs";
const DEFAULTS: NarrativePrefs = {
  sceneTitles: false,
  closeups: false,
  spoilers: false,
  breachMatrix: false,
  offscreen: "normal",
  encounters: "normal",
};

let cache: { readonly raw: string | null; readonly value: NarrativePrefs } | null = null;

function read(): NarrativePrefs {
  const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(KEY);
  if (cache && cache.raw === raw) return cache.value;
  let value = DEFAULTS;
  if (raw !== null) {
    try {
      const parsed = JSON.parse(raw) as Partial<Record<keyof NarrativePrefs, unknown>>;
      value = {
        sceneTitles: parsed.sceneTitles === true,
        closeups: parsed.closeups === true,
        spoilers: parsed.spoilers === true,
        breachMatrix: parsed.breachMatrix === true,
        offscreen: PACES.find((p) => p === parsed.offscreen) ?? "normal",
        encounters: ENCOUNTER_PACES.find((p) => p === parsed.encounters) ?? "normal",
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

/** 给接口层用：路上偶遇的频率 */
export function encounterPace(): EncounterPace {
  return read().encounters;
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

export function setEncounterPace(pace: EncounterPace): void {
  save({ ...read(), encounters: pace });
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
