import { useSyncExternalStore } from "react";
import {
  AUDIO_LABELS,
  audioAssetsReady,
  audioAssetUrl,
  type BgmId,
  loadedAudioCount,
  type SfxAssetId,
  subscribeAudioIndex,
} from "../assets";
import { audioPrefs, subscribeAudioPrefs } from "./prefs";
import { playSynthCue, type SfxCue } from "./synth";

export type DuckReason = "esc" | "settings" | "dialog" | "holocall" | "media";

export interface AudioSnapshot {
  /** 浏览器自动播放限制是否已由用户交互解锁 */
  readonly unlocked: boolean;
  /** 当前实际播放中的原版 BGM（含试听覆盖） */
  readonly activeBgm: BgmId | null;
  /** 当前场景期望的 BGM */
  readonly sceneBgm: BgmId | null;
  /** 设置页试听覆盖的 BGM */
  readonly previewBgm: BgmId | null;
  /** 当前 BGM 标签 */
  readonly activeLabel: string | null;
  /** BGM 是否正在发声 */
  readonly playing: boolean;
  /** 是否处于闪避压低状态 */
  readonly ducked: boolean;
  /** 原版音频素材索引是否就绪 */
  readonly originalReady: boolean;
  /** 已就绪的原版音频条数 */
  readonly originalCount: number;
}

interface AssetCueSpec {
  readonly asset: SfxAssetId;
  readonly gain: number;
  readonly rate?: number;
  readonly jitter?: number;
}

/** 优先映射到《赛博朋克 2077》原版解包音效的语义事件 */
const CUE_TO_ASSET: Partial<Record<SfxCue, AssetCueSpec>> = {
  boot: { asset: "sfx.boot", gain: 0.72 },
  click: { asset: "sfx.click", gain: 0.48, jitter: 0.04 },
  confirm: { asset: "sfx.click", gain: 0.58, rate: 1.09, jitter: 0.025 },
  panelOpen: { asset: "sfx.panel", gain: 0.52 },
  turnSubmit: { asset: "sfx.data", gain: 0.56 },
  turnDone: { asset: "sfx.notify", gain: 0.42 },
  notify: { asset: "sfx.notify", gain: 0.56 },
  scan: { asset: "sfx.scan", gain: 0.58 },
  quest: { asset: "sfx.quest", gain: 0.72 },
  warning: { asset: "sfx.warning", gain: 0.66 },
  heartbeat: { asset: "sfx.heartbeat", gain: 0.68 },
  sandevistan: { asset: "sfx.sandevistan", gain: 0.78 },
  cyberware: { asset: "sfx.cyberware", gain: 0.72 },
  glitch: { asset: "sfx.glitch", gain: 0.66 },
  farewell: { asset: "sfx.farewell", gain: 0.76 },
};

/** 防止短时间高频触发造成破音或刺耳连响的冷却毫秒数 */
const COOLDOWN_MS: Partial<Record<SfxCue, number>> = {
  hover: 48,
  click: 35,
  confirm: 50,
  tab: 50,
  panelOpen: 110,
  panelClose: 110,
  notify: 220,
  eddies: 120,
  warning: 320,
  holocall: 900,
  glitch: 400,
  scan: 240,
};

const CORE_PRELOAD_SFX: readonly SfxAssetId[] = [
  "sfx.click",
  "sfx.data",
  "sfx.panel",
  "sfx.notify",
  "sfx.warning",
  "sfx.scan",
];

const CROSSFADE_MS = 1600;
const DUCK_SMOOTH_MS = 320;

interface Deck {
  readonly el: HTMLAudioElement;
  bgm: BgmId | null;
  weight: number;
}

const listeners = new Set<() => void>();
const duckReasons = new Set<DuckReason>();
const lastPlayedAt = new Map<string, number>();
const bufferCache = new Map<SfxAssetId, AudioBuffer>();
const bufferLoading = new Map<SfxAssetId, Promise<AudioBuffer | null>>();

let audioCtx: AudioContext | null = null;
let sfxBus: GainNode | null = null;
let decks: [Deck, Deck] | null = null;
let activeDeckIdx: 0 | 1 = 0;

let unlocked = false;
let unlockInstalled = false;
let listenersInstalled = false;
let sceneBgm: BgmId | null = null;
let previewBgmId: BgmId | null = null;
let currentDuckGain = 1;
let targetDuckGain = 1;
let fadeRaf: number | null = null;
let fadeState: {
  readonly fromIdx: 0 | 1;
  readonly toIdx: 0 | 1;
  readonly startedAt: number;
  readonly duration: number;
} | null = null;
let duckRaf: number | null = null;
let corePreloaded = false;
let snapshot: AudioSnapshot = buildSnapshot();

function effectiveBgm(): BgmId | null {
  return previewBgmId ?? sceneBgm;
}

function effectiveBgmTargetVolume(): number {
  const prefs = audioPrefs();
  if (prefs.muted || !prefs.bgmEnabled) return 0;
  // 留出音乐动态余量，确保阅读剧情时不喧宾夺主
  return Math.max(0, Math.min(1, prefs.masterVolume * prefs.bgmVolume * 0.72));
}

function effectiveSfxVolume(): number {
  const prefs = audioPrefs();
  if (prefs.muted || !prefs.sfxEnabled) return 0;
  return Math.max(0, Math.min(1, prefs.masterVolume * prefs.sfxVolume));
}

function computeDuckTarget(): number {
  if (duckReasons.has("media")) return 0.08;
  if (duckReasons.has("holocall")) return 0.34;
  if (duckReasons.size > 0) return 0.48;
  return 1;
}

function buildSnapshot(): AudioSnapshot {
  const active = decks ? decks[activeDeckIdx].bgm : null;
  const deckEl = decks ? decks[activeDeckIdx].el : null;
  const playing = Boolean(
    deckEl && !deckEl.paused && effectiveBgmTargetVolume() > 0 && active !== null,
  );
  return {
    unlocked,
    activeBgm: active,
    sceneBgm,
    previewBgm: previewBgmId,
    activeLabel: active ? AUDIO_LABELS[active] : null,
    playing,
    ducked: duckReasons.size > 0,
    originalReady: audioAssetsReady(),
    originalCount: loadedAudioCount(),
  };
}

function emit(): void {
  snapshot = buildSnapshot();
  for (const listener of listeners) listener();
}

function ensureContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!audioCtx) {
    const Ctor =
      window.AudioContext ??
      (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    audioCtx = new Ctor();
    sfxBus = audioCtx.createGain();
    sfxBus.gain.value = effectiveSfxVolume();
    sfxBus.connect(audioCtx.destination);
  }
  if (audioCtx.state === "suspended") {
    void audioCtx.resume().catch(() => {});
  }
  if (sfxBus) {
    sfxBus.gain.value = effectiveSfxVolume();
  }
  return audioCtx;
}

function ensureDecks(): [Deck, Deck] | null {
  if (typeof Audio === "undefined") return null;
  if (!decks) {
    const make = (): Deck => {
      const el = new Audio();
      el.loop = true;
      el.preload = "auto";
      el.volume = 0;
      return { el, bgm: null, weight: 0 };
    };
    decks = [make(), make()];
  }
  return decks;
}

function applyDeckVolumes(): void {
  if (!decks) return;
  const base = effectiveBgmTargetVolume() * currentDuckGain;
  for (const deck of decks) {
    deck.el.volume = Math.max(0, Math.min(1, base * deck.weight));
  }
}

function stopFade(): void {
  if (fadeRaf !== null) {
    cancelAnimationFrame(fadeRaf);
    fadeRaf = null;
  }
  fadeState = null;
}

function tickFade(now: number): void {
  if (!fadeState || !decks) {
    fadeRaf = null;
    return;
  }
  const t = Math.min(1, Math.max(0, (now - fadeState.startedAt) / fadeState.duration));
  // 等功率交叉淡入淡出曲线（sin / cos），中间衔接平稳无塌陷
  const inWeight = Math.sin(t * Math.PI * 0.5);
  const outWeight = Math.cos(t * Math.PI * 0.5);
  const fromDeck = decks[fadeState.fromIdx];
  const toDeck = decks[fadeState.toIdx];
  fromDeck.weight = outWeight;
  toDeck.weight = inWeight;
  applyDeckVolumes();

  if (t >= 1) {
    fromDeck.weight = 0;
    fromDeck.el.pause();
    fromDeck.bgm = null;
    toDeck.weight = 1;
    applyDeckVolumes();
    fadeState = null;
    fadeRaf = null;
    emit();
    return;
  }
  fadeRaf = requestAnimationFrame(tickFade);
}

function animateDuck(): void {
  if (duckRaf !== null) {
    cancelAnimationFrame(duckRaf);
    duckRaf = null;
  }
  const startGain = currentDuckGain;
  const endGain = targetDuckGain;
  if (Math.abs(endGain - startGain) < 0.005) {
    currentDuckGain = endGain;
    applyDeckVolumes();
    return;
  }
  const startedAt = performance.now();
  const step = (now: number) => {
    const t = Math.min(1, (now - startedAt) / DUCK_SMOOTH_MS);
    const eased = 1 - (1 - t) * (1 - t);
    currentDuckGain = startGain + (endGain - startGain) * eased;
    applyDeckVolumes();
    if (t < 1) {
      duckRaf = requestAnimationFrame(step);
    } else {
      currentDuckGain = endGain;
      duckRaf = null;
    }
  };
  duckRaf = requestAnimationFrame(step);
}

function isHidden(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}

function syncBgm(crossfadeMs = CROSSFADE_MS): void {
  const pair = ensureDecks();
  if (!pair) return;

  const desired = effectiveBgm();
  const vol = effectiveBgmTargetVolume();
  const current = pair[activeDeckIdx];

  // 静音、关闭 BGM、页面不可见或无目标曲目时静默暂停
  if (!desired || vol <= 0 || isHidden()) {
    stopFade();
    for (const d of pair) {
      d.weight = 0;
      d.el.volume = 0;
      if (!d.el.paused) d.el.pause();
      if (!desired) d.bgm = null;
    }
    emit();
    return;
  }

  const url = audioAssetUrl(desired);
  if (!url) {
    emit();
    return;
  }

  // 目标曲目已在当前主轨上：仅确保它在播放并同步音量
  if (current.bgm === desired) {
    if (current.el.paused && unlocked) {
      current.weight = 1;
      applyDeckVolumes();
      void current.el
        .play()
        .then(() => emit())
        .catch(() => {
          unlocked = false;
          emit();
        });
    } else {
      applyDeckVolumes();
      emit();
    }
    return;
  }

  // 未解锁前先记住目标，不硬调 play 避免浏览器控制台报 NotAllowedError
  if (!unlocked) {
    emit();
    return;
  }

  const nextIdx: 0 | 1 = activeDeckIdx === 0 ? 1 : 0;
  const fromIdx = activeDeckIdx;
  const fromDeck = pair[fromIdx];
  const toDeck = pair[nextIdx];

  stopFade();
  toDeck.bgm = desired;
  toDeck.el.src = url;
  toDeck.el.currentTime = 0;
  toDeck.el.loop = true;
  toDeck.weight = fromDeck.bgm && !fromDeck.el.paused ? 0 : 1;
  activeDeckIdx = nextIdx;
  applyDeckVolumes();

  void toDeck.el
    .play()
    .then(() => {
      if (fromDeck.bgm && !fromDeck.el.paused && crossfadeMs > 0) {
        fadeState = {
          fromIdx,
          toIdx: nextIdx,
          startedAt: performance.now(),
          duration: crossfadeMs,
        };
        fadeRaf = requestAnimationFrame(tickFade);
      } else {
        fromDeck.weight = 0;
        fromDeck.el.pause();
        fromDeck.bgm = null;
        toDeck.weight = 1;
        applyDeckVolumes();
      }
      emit();
    })
    .catch(() => {
      // 偶发自动播放拦截时保留目标，待下一次用户交互自动接续
      toDeck.bgm = null;
      unlocked = false;
      emit();
    });
}

async function loadSfxBuffer(id: SfxAssetId): Promise<AudioBuffer | null> {
  const cached = bufferCache.get(id);
  if (cached) return cached;
  const pending = bufferLoading.get(id);
  if (pending) return pending;

  const url = audioAssetUrl(id);
  const ctx = ensureContext();
  if (!url || !ctx) return null;

  const task = fetch(url)
    .then(async (res) => {
      if (!res.ok) return null;
      const arr = await res.arrayBuffer();
      return await ctx.decodeAudioData(arr);
    })
    .then((buf) => {
      if (buf) bufferCache.set(id, buf);
      return buf;
    })
    .catch(() => null)
    .finally(() => {
      bufferLoading.delete(id);
    });
  bufferLoading.set(id, task);
  return task;
}

function playBuffer(
  ctx: AudioContext,
  dest: AudioNode,
  buf: AudioBuffer,
  gain = 0.75,
  rate = 1,
  jitter = 0,
): void {
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const variance = jitter > 0 ? 1 + (Math.random() * 2 - 1) * jitter : 1;
  src.playbackRate.value = Math.max(0.5, Math.min(2, rate * variance));
  const amp = ctx.createGain();
  amp.gain.value = gain;
  src.connect(amp);
  amp.connect(dest);
  src.start();
}

export function preloadCoreSfx(): void {
  if (corePreloaded || !audioAssetsReady() || !unlocked) return;
  corePreloaded = true;
  for (const id of CORE_PRELOAD_SFX) {
    void loadSfxBuffer(id);
  }
}

/** 触发语义音效：优先播放原版解包素材，未覆盖的微交互或缺失时使用赛博合成层 */
export function playSfx(cue: SfxCue): void {
  const prefs = audioPrefs();
  if (prefs.muted || !prefs.sfxEnabled) return;
  if (cue === "hover" && !prefs.uiHoverSfx) return;

  const now = performance.now();
  const minGap = COOLDOWN_MS[cue] ?? 0;
  if (minGap > 0) {
    const prev = lastPlayedAt.get(cue) ?? 0;
    if (now - prev < minGap) return;
    lastPlayedAt.set(cue, now);
  }

  const ctx = ensureContext();
  if (!ctx || !sfxBus) return;
  if (ctx.state === "suspended" && !unlocked) return;

  const mapped = CUE_TO_ASSET[cue];
  if (mapped && audioAssetUrl(mapped.asset)) {
    const cached = bufferCache.get(mapped.asset);
    if (cached) {
      playBuffer(ctx, sfxBus, cached, mapped.gain, mapped.rate ?? 1, mapped.jitter ?? 0);
      return;
    }
    // 首次未缓存时异步解码并播放，同时不阻塞交互
    void loadSfxBuffer(mapped.asset).then((buf) => {
      if (buf && sfxBus && effectiveSfxVolume() > 0) {
        playBuffer(ctx, sfxBus, buf, mapped.gain, mapped.rate ?? 1, mapped.jitter ?? 0);
      }
    });
    return;
  }

  playSynthCue(ctx, sfxBus, cue);
}

/** 直接试听某条原版音效素材（供设置页试听按钮使用） */
export function auditionSfxAsset(id: SfxAssetId): void {
  const prefs = audioPrefs();
  if (prefs.muted) return;
  unlockAudioNow();
  const ctx = ensureContext();
  if (!ctx || !sfxBus) return;
  const cached = bufferCache.get(id);
  if (cached) {
    playBuffer(ctx, sfxBus, cached, 0.78, 1, 0);
    return;
  }
  void loadSfxBuffer(id).then((buf) => {
    if (buf && sfxBus && !audioPrefs().muted) {
      playBuffer(ctx, sfxBus, buf, 0.78, 1, 0);
    }
  });
}

/** 设定当前场景应播放的 BGM（由路由与剧情导演调用） */
export function setBgmTarget(bgm: BgmId | null, crossfadeMs = CROSSFADE_MS): void {
  if (sceneBgm === bgm) return;
  sceneBgm = bgm;
  if (previewBgmId === null) {
    syncBgm(crossfadeMs);
  } else {
    emit();
  }
}

/** 在设置页试听任意原版 BGM；再次点击同一曲目则停止试听恢复场景配乐 */
export function previewBgm(bgm: BgmId): void {
  unlockAudioNow();
  previewBgmId = previewBgmId === bgm ? null : bgm;
  syncBgm(500);
}

/** 退出设置页时清除试听覆盖，无缝切回当前场景配乐 */
export function clearBgmPreview(): void {
  if (previewBgmId === null) return;
  previewBgmId = null;
  syncBgm(800);
}

/** 设置或取消某项闪避压低（Esc / 设置 / 全息来电 / 正文内嵌录音） */
export function setAudioDuck(reason: DuckReason, active: boolean): void {
  const had = duckReasons.has(reason);
  if (had === active) return;
  if (active) duckReasons.add(reason);
  else duckReasons.delete(reason);
  targetDuckGain = computeDuckTarget();
  animateDuck();
  emit();
}

export function unlockAudioNow(): void {
  if (!unlocked) {
    unlocked = true;
    ensureContext();
    preloadCoreSfx();
    syncBgm(900);
  } else {
    ensureContext();
    if (
      decks &&
      effectiveBgm() &&
      decks[activeDeckIdx].el.paused &&
      effectiveBgmTargetVolume() > 0
    ) {
      syncBgm(500);
    }
  }
}

function ensureGlobalListeners(): void {
  if (listenersInstalled || typeof window === "undefined") return;
  listenersInstalled = true;

  subscribeAudioPrefs(() => {
    if (sfxBus) sfxBus.gain.value = effectiveSfxVolume();
    syncBgm(350);
  });

  subscribeAudioIndex(() => {
    if (unlocked) preloadCoreSfx();
    syncBgm(600);
  });

  document.addEventListener("visibilitychange", () => {
    syncBgm(400);
  });

  // 监测正文内嵌 <audio> 录音播放，自动闪避 BGM，停止时恢复
  const onMediaPlay = (event: Event) => {
    if (event.target instanceof HTMLAudioElement && decks?.every((d) => d.el !== event.target)) {
      setAudioDuck("media", true);
    }
  };
  const onMediaStop = (event: Event) => {
    if (event.target instanceof HTMLAudioElement && decks?.every((d) => d.el !== event.target)) {
      const anyOtherPlaying = Array.from(document.querySelectorAll("audio")).some(
        (el) => el !== event.target && !el.paused,
      );
      if (!anyOtherPlaying) setAudioDuck("media", false);
    }
  };
  document.addEventListener("play", onMediaPlay, true);
  document.addEventListener("pause", onMediaStop, true);
  document.addEventListener("ended", onMediaStop, true);
}

/** 安装首次交互解锁监听器（启动时调用一次即可） */
export function installAudioUnlock(): void {
  ensureGlobalListeners();
  if (unlockInstalled || typeof window === "undefined") return;
  unlockInstalled = true;

  const onFirstGesture = () => {
    unlockAudioNow();
    window.removeEventListener("pointerdown", onFirstGesture, true);
    window.removeEventListener("keydown", onFirstGesture, true);
    window.removeEventListener("touchstart", onFirstGesture, true);
  };
  window.addEventListener("pointerdown", onFirstGesture, { capture: true, passive: true });
  window.addEventListener("keydown", onFirstGesture, { capture: true, passive: true });
  window.addEventListener("touchstart", onFirstGesture, { capture: true, passive: true });
}

export function subscribeAudioState(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getAudioSnapshot(): AudioSnapshot {
  return snapshot;
}

export function useAudioState(): AudioSnapshot {
  return useSyncExternalStore(subscribeAudioState, getAudioSnapshot, getAudioSnapshot);
}
