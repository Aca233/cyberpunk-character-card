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

export interface ThemeBgmSpec {
  readonly id: string;
  readonly url: string;
  readonly label: string;
}

export interface AudioSnapshot {
  /** 浏览器自动播放限制是否已由用户交互解锁 */
  readonly unlocked: boolean;
  /** 当前实际播放中的原版 BGM（含试听覆盖） */
  readonly activeBgm: BgmId | null;
  /** 当前实际播放中的曲目唯一键（原版 BgmId 或主题专属曲目 id） */
  readonly activeTrackKey: string | null;
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

/** 优先映射到《赛博朋克 2077》原版解包音效的剧情与事件（界面悬停/点击/面板滑开由轻柔阻尼微动层负责） */
const CUE_TO_ASSET: Partial<Record<SfxCue, AssetCueSpec>> = {
  boot: { asset: "sfx.boot", gain: 0.68 },
  turnSubmit: { asset: "sfx.data", gain: 0.5 },
  turnDone: { asset: "sfx.notify", gain: 0.45 },
  notify: { asset: "sfx.notify", gain: 0.58 },
  scan: { asset: "sfx.scan", gain: 0.58 },
  quest: { asset: "sfx.quest", gain: 0.7 },
  warning: { asset: "sfx.warning", gain: 0.56 },
  heartbeat: { asset: "sfx.heartbeat", gain: 0.62 },
  sandevistan: { asset: "sfx.sandevistan", gain: 0.72 },
  cyberware: { asset: "sfx.cyberware", gain: 0.68 },
  glitch: { asset: "sfx.glitch", gain: 0.6 },
  farewell: { asset: "sfx.farewell", gain: 0.72 },
};

/** 防止短时间高频触发造成破音或刺耳连响的冷却毫秒数 */
const COOLDOWN_MS: Partial<Record<SfxCue, number>> = {
  hover: 42,
  click: 35,
  confirm: 45,
  tab: 45,
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
  "sfx.data",
  "sfx.notify",
  "sfx.warning",
  "sfx.scan",
];

const CROSSFADE_MS = 1600;
const DUCK_SMOOTH_MS = 320;

interface Deck {
  readonly el: HTMLAudioElement;
  key: string | null;
  bgm: BgmId | null;
  label: string | null;
  weight: number;
}

interface DesiredTrack {
  readonly key: string;
  readonly bgm: BgmId | null;
  readonly url: string | null;
  readonly label: string;
}

const THEME_OVERRIDABLE_BGMS: ReadonlySet<BgmId> = new Set(["bgm.menu", "bgm.creator"]);

const listeners = new Set<() => void>();
const duckReasons = new Set<DuckReason>();
const lastPlayedAt = new Map<string, number>();
const rawByteCache = new Map<SfxAssetId, ArrayBuffer>();
const rawByteLoading = new Map<SfxAssetId, Promise<ArrayBuffer | null>>();
const bufferCache = new Map<SfxAssetId, AudioBuffer>();
const bufferLoading = new Map<SfxAssetId, Promise<AudioBuffer | null>>();

let audioCtx: AudioContext | null = null;
let sfxBus: GainNode | null = null;
let decks: [Deck, Deck] | null = null;
let activeDeckIdx: 0 | 1 = 0;

let unlocked = false;
let listenersInstalled = false;
let unlockArmed = false;
let sceneBgm: BgmId | null = null;
let previewBgmId: BgmId | null = null;
let themeBgmOverride: ThemeBgmSpec | null = null;
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

function resolveDesiredTrack(): DesiredTrack | null {
  if (previewBgmId !== null) {
    return {
      key: previewBgmId,
      bgm: previewBgmId,
      url: audioAssetUrl(previewBgmId) ?? null,
      label: AUDIO_LABELS[previewBgmId],
    };
  }
  if (sceneBgm === null) return null;
  if (themeBgmOverride !== null && THEME_OVERRIDABLE_BGMS.has(sceneBgm)) {
    return {
      key: themeBgmOverride.id,
      bgm: null,
      url: themeBgmOverride.url,
      label: themeBgmOverride.label,
    };
  }
  return {
    key: sceneBgm,
    bgm: sceneBgm,
    url: audioAssetUrl(sceneBgm) ?? null,
    label: AUDIO_LABELS[sceneBgm],
  };
}

function effectiveBgmTargetVolume(): number {
  const prefs = audioPrefs();
  if (prefs.muted || !prefs.bgmEnabled) return 0;
  // 留出音乐动态余量，确保阅读剧情时不喧宾夺主
  return Math.max(0, Math.min(1, prefs.masterVolume * prefs.bgmVolume * 0.68));
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
  const activeDeck = decks ? decks[activeDeckIdx] : null;
  const active = activeDeck ? activeDeck.bgm : null;
  const activeKey = activeDeck ? activeDeck.key : null;
  const activeLabel = activeDeck ? activeDeck.label : null;
  const deckEl = activeDeck ? activeDeck.el : null;
  const playing = Boolean(
    deckEl && !deckEl.paused && effectiveBgmTargetVolume() > 0 && activeKey !== null,
  );
  return {
    unlocked,
    activeBgm: active,
    activeTrackKey: activeKey,
    sceneBgm,
    previewBgm: previewBgmId,
    activeLabel,
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

function isNotAllowedError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "NotAllowedError";
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
    // 浏览器若已允许当前站点自动播放（AudioContext 直接为 running），立即可用无需等首次点击
    if (audioCtx.state === "running") {
      unlocked = true;
    }
    audioCtx.addEventListener("statechange", () => {
      if (audioCtx?.state === "running" && !unlocked) {
        unlocked = true;
        preloadCoreSfx();
        syncBgm(700);
        emit();
      }
    });
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
      return { el, key: null, bgm: null, label: null, weight: 0 };
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
    fromDeck.key = null;
    fromDeck.bgm = null;
    fromDeck.label = null;
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

function armGestureUnlock(): void {
  if (unlockArmed || typeof window === "undefined") return;
  unlockArmed = true;
  const onGesture = () => {
    unlockArmed = false;
    window.removeEventListener("pointerdown", onGesture, true);
    window.removeEventListener("keydown", onGesture, true);
    window.removeEventListener("touchstart", onGesture, true);
    unlockAudioNow();
  };
  window.addEventListener("pointerdown", onGesture, { capture: true, passive: true });
  window.addEventListener("keydown", onGesture, { capture: true, passive: true });
  window.addEventListener("touchstart", onGesture, { capture: true, passive: true });
}

function syncBgm(crossfadeMs = CROSSFADE_MS): void {
  const pair = ensureDecks();
  if (!pair) return;

  const desired = resolveDesiredTrack();
  const vol = effectiveBgmTargetVolume();
  const current = pair[activeDeckIdx];

  // 静音、关闭 BGM、页面不可见或无目标曲目时静默暂停
  if (!desired || vol <= 0 || isHidden()) {
    stopFade();
    for (const d of pair) {
      d.weight = 0;
      d.el.volume = 0;
      if (!d.el.paused) d.el.pause();
      if (!desired) {
        d.key = null;
        d.bgm = null;
        d.label = null;
      }
    }
    emit();
    return;
  }

  const url = desired.url;
  if (!url) {
    emit();
    return;
  }

  // 目标曲目已在当前主轨上：仅确保它在播放并同步音量
  if (current.key === desired.key) {
    current.label = desired.label;
    if (current.el.paused) {
      current.weight = 1;
      applyDeckVolumes();
      void current.el
        .play()
        .then(() => {
          unlocked = true;
          emit();
        })
        .catch((err) => {
          // 仅自动播放受限时重挂解锁监听，绝不因 AbortError 锁死音频
          if (isNotAllowedError(err)) {
            unlocked = false;
            armGestureUnlock();
            emit();
          }
        });
    } else {
      applyDeckVolumes();
      emit();
    }
    return;
  }

  const nextIdx: 0 | 1 = activeDeckIdx === 0 ? 1 : 0;
  const fromIdx = activeDeckIdx;
  const fromDeck = pair[fromIdx];
  const toDeck = pair[nextIdx];

  stopFade();
  toDeck.key = desired.key;
  toDeck.bgm = desired.bgm;
  toDeck.label = desired.label;
  toDeck.el.src = url;
  toDeck.el.currentTime = 0;
  toDeck.el.loop = true;
  toDeck.weight = fromDeck.key && !fromDeck.el.paused ? 0 : 1;
  activeDeckIdx = nextIdx;
  applyDeckVolumes();

  void toDeck.el
    .play()
    .then(() => {
      unlocked = true;
      if (toDeck.key !== desired.key) return;
      if (fromDeck.key && !fromDeck.el.paused && crossfadeMs > 0) {
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
        fromDeck.key = null;
        fromDeck.bgm = null;
        fromDeck.label = null;
        toDeck.weight = 1;
        applyDeckVolumes();
      }
      emit();
    })
    .catch((err) => {
      if (isNotAllowedError(err)) {
        toDeck.key = null;
        toDeck.bgm = null;
        toDeck.label = null;
        unlocked = false;
        armGestureUnlock();
        emit();
      }
    });
}

async function fetchSfxBytes(id: SfxAssetId): Promise<ArrayBuffer | null> {
  const cached = rawByteCache.get(id);
  if (cached) return cached;
  const pending = rawByteLoading.get(id);
  if (pending) return pending;

  const url = audioAssetUrl(id);
  if (!url) return null;

  const task = fetch(url)
    .then(async (res) => {
      if (!res.ok) return null;
      const arr = await res.arrayBuffer();
      rawByteCache.set(id, arr);
      return arr;
    })
    .catch(() => null)
    .finally(() => {
      rawByteLoading.delete(id);
    });
  rawByteLoading.set(id, task);
  return task;
}

async function loadSfxBuffer(id: SfxAssetId): Promise<AudioBuffer | null> {
  const cached = bufferCache.get(id);
  if (cached) return cached;
  const pending = bufferLoading.get(id);
  if (pending) return pending;

  const ctx = ensureContext();
  if (!ctx) return null;

  const task = fetchSfxBytes(id)
    .then(async (raw) => {
      if (!raw) return null;
      // decodeAudioData 会 detach 传入的 ArrayBuffer，必须 slice 副本
      return await ctx.decodeAudioData(raw.slice(0));
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
  gain = 0.82,
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
  if (!audioAssetsReady()) return;
  // 先预拉原版短音效原始字节（无需等待 AudioContext 解锁）
  for (const id of CORE_PRELOAD_SFX) {
    void fetchSfxBytes(id);
  }
  if (corePreloaded || !unlocked) return;
  corePreloaded = true;
  for (const id of CORE_PRELOAD_SFX) {
    void loadSfxBuffer(id);
  }
}

function emitCueNow(ctx: AudioContext, dest: AudioNode, cue: SfxCue): void {
  const mapped = CUE_TO_ASSET[cue];
  if (mapped && audioAssetUrl(mapped.asset)) {
    const cached = bufferCache.get(mapped.asset);
    if (cached) {
      playBuffer(ctx, dest, cached, mapped.gain, mapped.rate ?? 1, mapped.jitter ?? 0);
      return;
    }
    void loadSfxBuffer(mapped.asset).then((buf) => {
      if (buf && sfxBus && effectiveSfxVolume() > 0) {
        playBuffer(ctx, sfxBus, buf, mapped.gain, mapped.rate ?? 1, mapped.jitter ?? 0);
      }
    });
    return;
  }

  playSynthCue(ctx, dest, cue);
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

  if (ctx.state === "running") {
    if (!unlocked) {
      unlocked = true;
      preloadCoreSfx();
    }
    emitCueNow(ctx, sfxBus, cue);
    return;
  }

  // 悬停不能触发浏览器音频解锁，处于 suspended 时直接静默跳过，避免堆积延迟响声
  if (cue === "hover") {
    return;
  }

  // 非悬停音（点击 / 确认 / 切换等）：趁当前用户手势立即 resume 并在恢复后马上出声
  const dest = sfxBus;
  void ctx
    .resume()
    .then(() => {
      if (ctx.state === "running" && effectiveSfxVolume() > 0) {
        if (!unlocked) {
          unlocked = true;
          preloadCoreSfx();
        }
        emitCueNow(ctx, dest, cue);
      }
    })
    .catch(() => {});
}

/** 直接试听某条原版音效素材（供设置页试听按钮使用） */
export function auditionSfxAsset(id: SfxAssetId): void {
  const prefs = audioPrefs();
  if (prefs.muted) return;
  unlockAudioNow();
  const ctx = ensureContext();
  if (!ctx || !sfxBus) return;
  const play = () => {
    if (!sfxBus || audioPrefs().muted) return;
    const cached = bufferCache.get(id);
    if (cached) {
      playBuffer(ctx, sfxBus, cached, 0.88, 1, 0);
      return;
    }
    void loadSfxBuffer(id).then((buf) => {
      if (buf && sfxBus && !audioPrefs().muted) {
        playBuffer(ctx, sfxBus, buf, 0.88, 1, 0);
      }
    });
  };
  if (ctx.state === "running") {
    play();
  } else {
    void ctx
      .resume()
      .then(play)
      .catch(() => {});
  }
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

/** 设定主题专属配乐覆盖（当选用雨夜窗畔 / 月球舷窗 / 月面余光等主题时无缝接管主菜单与常规背景音乐） */
export function setThemeBgmOverride(spec: ThemeBgmSpec | null, crossfadeMs = CROSSFADE_MS): void {
  const prevId = themeBgmOverride?.id ?? null;
  const nextId = spec?.id ?? null;
  if (prevId === nextId && themeBgmOverride?.url === spec?.url) return;
  themeBgmOverride = spec;
  if (previewBgmId === null) {
    syncBgm(crossfadeMs);
  } else {
    emit();
  }
}

/** 读取当前正在播放的 BGM 实时进度（供主菜单 Folia 风格歌词舞台以 60fps 驱动逐词同步） */
export function getActiveBgmTime(): {
  readonly currentTime: number;
  readonly duration: number;
  readonly playing: boolean;
  readonly trackKey: string | null;
} {
  const activeDeck = decks ? decks[activeDeckIdx] : null;
  if (!activeDeck) {
    return { currentTime: 0, duration: 0, playing: false, trackKey: null };
  }
  const el = activeDeck.el;
  return {
    currentTime: Number.isFinite(el.currentTime) ? el.currentTime : 0,
    duration: Number.isFinite(el.duration) && el.duration > 0 ? el.duration : 246.7,
    playing: !el.paused && effectiveBgmTargetVolume() > 0 && activeDeck.key !== null,
    trackKey: activeDeck.key,
  };
}

/** 点击歌词行或进度条时直接跳转当前 BGM 播放时间点 */
export function seekActiveBgm(timeSec: number): void {
  unlockAudioNow();
  const activeDeck = decks ? decks[activeDeckIdx] : null;
  if (!activeDeck) return;
  const el = activeDeck.el;
  const clamped = Math.max(0, timeSec);
  try {
    el.currentTime = clamped;
  } catch {
    // 音频尚未加载完元数据时忽略
  }
  if (el.paused && effectiveBgmTargetVolume() > 0) {
    void el
      .play()
      .then(() => emit())
      .catch(() => {});
  } else {
    emit();
  }
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
  const ctx = ensureContext();
  if (ctx && ctx.state === "suspended") {
    void ctx.resume().catch(() => {});
  }
  if (!unlocked) {
    unlocked = true;
    preloadCoreSfx();
    syncBgm(900);
  } else {
    preloadCoreSfx();
    if (
      decks &&
      resolveDesiredTrack() &&
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
    preloadCoreSfx();
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

/** 安装首次交互解锁监听器并预拉核心短音效（启动时调用一次即可） */
export function installAudioUnlock(): void {
  ensureGlobalListeners();
  ensureContext();
  preloadCoreSfx();
  if (!unlocked) {
    armGestureUnlock();
  }
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
