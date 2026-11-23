import { useEffect, useState } from "react";
import {
  getActiveBgmTime,
  playSfx,
  seekActiveBgm,
  setAudioPref,
  unlockAudioNow,
  useAudioPrefs,
} from "../../audio";
import {
  EDGERUNNERS_LYRICS,
  type EdgerunnersLyricLine,
  findActiveLyricIndex,
  type LyricWordSpan,
} from "./edgerunnersLyrics";
import { useReducedMotion } from "./ShellBackdrop";
import { useShellTheme } from "./store";
import styles from "./theme-lyrics.module.css";

export type FoliaLyricMode = "lumiere" | "tilt" | "partita";

const MODE_STORAGE_KEY = "cp.foliaLyricMode";

const FOLIA_MODES: readonly {
  readonly id: FoliaLyricMode;
  readonly label: string;
  readonly desc: string;
}[] = [
  { id: "lumiere", label: "✦ 流光", desc: "Folia Lumiere · 逐词霓虹遮罩扫掠与脉冲抬升" },
  { id: "tilt", label: "✦ 倾诉", desc: "Folia Tilt · 主副句交错斜切与奇偶字符错落波浪" },
  { id: "partita", label: "✦ 云阶", desc: "Folia Partita · 3D 透视斜向阶梯与导引光轨" },
];

function readSavedMode(): FoliaLyricMode {
  if (typeof localStorage === "undefined") return "lumiere";
  const raw = localStorage.getItem(MODE_STORAGE_KEY);
  if (raw === "tilt" || raw === "partita" || raw === "lumiere") return raw;
  return "lumiere";
}

function formatClock(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const total = Math.floor(sec);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function clamp01(value: number): number {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

interface ThemeLyricsStageProps {
  readonly immersive: boolean;
  readonly onToggleImmersive: () => void;
}

export function ThemeLyricsStage({ immersive }: ThemeLyricsStageProps) {
  const { effectiveId } = useShellTheme();
  const audioPrefs = useAudioPrefs();
  const reducedMotion = useReducedMotion();

  const [mode, setMode] = useState<FoliaLyricMode>(readSavedMode);
  const [clock, setClock] = useState<{ currentTime: number; duration: number; playing: boolean }>({
    currentTime: 0,
    duration: 246.7,
    playing: false,
  });

  const hasThemeSong = effectiveId !== "night-city";

  useEffect(() => {
    if (!hasThemeSong) return;
    let raf = 0;
    const tick = () => {
      const snap = getActiveBgmTime();
      setClock((prev) => {
        if (
          Math.abs(prev.currentTime - snap.currentTime) < 0.016 &&
          prev.playing === snap.playing
        ) {
          return prev;
        }
        return {
          currentTime: snap.currentTime,
          duration: snap.duration,
          playing: snap.playing,
        };
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [hasThemeSong]);

  if (!hasThemeSong) return null;

  const activeIdx = findActiveLyricIndex(clock.currentTime);
  const activeLine = EDGERUNNERS_LYRICS[activeIdx] ?? EDGERUNNERS_LYRICS[0];
  const prevLine = activeIdx > 0 ? EDGERUNNERS_LYRICS[activeIdx - 1] : undefined;
  const nextLine =
    activeIdx + 1 < EDGERUNNERS_LYRICS.length ? EDGERUNNERS_LYRICS[activeIdx + 1] : undefined;

  if (!activeLine) return null;

  const currentModeSpec = FOLIA_MODES.find((m) => m.id === mode) ?? FOLIA_MODES[0];

  const cycleMode = () => {
    if (audioPrefs.muted) setAudioPref("muted", false);
    if (!audioPrefs.bgmEnabled) setAudioPref("bgmEnabled", true);
    unlockAudioNow();
    const idx = FOLIA_MODES.findIndex((m) => m.id === mode);
    const next = FOLIA_MODES[(idx + 1) % FOLIA_MODES.length]?.id ?? "lumiere";
    setMode(next);
    try {
      localStorage.setItem(MODE_STORAGE_KEY, next);
    } catch {
      // 忽略存储受限
    }
    playSfx("tab");
  };

  const handleSeek = (line: EdgerunnersLyricLine) => {
    if (audioPrefs.muted) setAudioPref("muted", false);
    if (!audioPrefs.bgmEnabled) setAudioPref("bgmEnabled", true);
    seekActiveBgm(line.startTime + 0.01);
    playSfx("click");
  };

  return (
    <aside
      className={styles.stage}
      data-shell-lyrics
      data-immersive={immersive || undefined}
      data-chorus={activeLine.isChorus || undefined}
      aria-label="主题配乐动态歌词舞台"
    >
      <div className={styles.viewport} data-mode={mode}>
        {prevLine && (
          <button
            type="button"
            className={styles.contextLine}
            onClick={() => handleSeek(prevLine)}
            title="点击跳回上一句歌词"
          >
            <span>{prevLine.en}</span>
            {(immersive || mode === "partita") && (
              <span className={styles.contextZh}>{prevLine.zh}</span>
            )}
          </button>
        )}

        <div key={activeLine.id} className={styles.activeBlock}>
          {mode === "tilt" ? (
            <TiltActiveLine
              line={activeLine}
              currentTime={clock.currentTime}
              reducedMotion={reducedMotion}
            />
          ) : (
            <LumiereActiveLine
              line={activeLine}
              currentTime={clock.currentTime}
              reducedMotion={reducedMotion}
            />
          )}

          <div className={styles.zhRow}>
            <span>{activeLine.zh}</span>
          </div>
        </div>

        {nextLine && (
          <button
            type="button"
            className={styles.contextLine}
            onClick={() => handleSeek(nextLine)}
            title="点击跳到下一句歌词"
          >
            <span>{nextLine.en}</span>
            {(immersive || mode === "partita") && (
              <span className={styles.contextZh}>{nextLine.zh}</span>
            )}
          </button>
        )}

        <button
          type="button"
          className={styles.watermark}
          onClick={cycleMode}
          title={`${currentModeSpec?.desc ?? ""}（点击切换歌词动效风格）`}
        >
          <span className={styles.eq} data-playing={clock.playing || undefined} aria-hidden>
            <i className={styles.eqBar} />
            <i className={styles.eqBar} />
            <i className={styles.eqBar} />
            <i className={styles.eqBar} />
          </span>
          <span>I REALLY WANT TO STAY AT YOUR HOUSE</span>
          <span className={styles.watermarkDot}>·</span>
          <span className={styles.watermarkMode}>{currentModeSpec?.label}</span>
          <span className={styles.watermarkClock}>{formatClock(clock.currentTime)}</span>
        </button>
      </div>
    </aside>
  );
}

/** 将 joinNext 标记的连续音节（如 self- + control）聚合成同一不换行词簇，同时保留逐音节时间轴 */
function groupWordClusters(words: readonly LyricWordSpan[]): readonly (readonly LyricWordSpan[])[] {
  const clusters: LyricWordSpan[][] = [];
  let current: LyricWordSpan[] = [];
  for (const word of words) {
    current.push(word);
    if (!word.joinNext) {
      clusters.push(current);
      current = [];
    }
  }
  if (current.length > 0) clusters.push(current);
  return clusters;
}

function wordProgressAt(word: LyricWordSpan, currentTime: number): number {
  const span = Math.max(0.04, word.endTime - word.startTime);
  return clamp01((currentTime - word.startTime) / span);
}

/**
 * 模式 1 & 3（流光 Lumiere / 云阶 Partita）：
 * 基于 .fia 逐词绝对时间戳驱动渐进裁剪高光扫掠 + 正在演唱词的正弦波抬升与放大脉冲
 */
function LumiereActiveLine({
  line,
  currentTime,
  reducedMotion,
}: {
  readonly line: EdgerunnersLyricLine;
  readonly currentTime: number;
  readonly reducedMotion: boolean;
}) {
  const clusters = groupWordClusters(line.words);

  const renderWord = (word: LyricWordSpan) => {
    const wordProgress = wordProgressAt(word, currentTime);
    const activePulse =
      !reducedMotion && wordProgress > 0 && wordProgress < 1 ? Math.sin(wordProgress * Math.PI) : 0;
    const scale = 1 + activePulse * (line.isChorus ? 0.17 : 0.12);
    const lift = -activePulse * (line.isChorus ? 4 : 2.5);
    const clipRight = ((1 - wordProgress) * 100).toFixed(1);

    return (
      <span
        key={`${line.id}-${word.key}`}
        className={styles.lumiereWord}
        data-emphasis={word.emphasis || undefined}
        style={
          activePulse > 0.005
            ? {
                transform: `translateY(${lift.toFixed(2)}px) scale(${scale.toFixed(3)})`,
              }
            : undefined
        }
      >
        <span>{word.text}</span>
        {wordProgress > 0 && (
          <span
            className={styles.lumiereWordLit}
            style={{
              clipPath: `inset(-25% ${clipRight}% -25% -15%)`,
            }}
            aria-hidden
          >
            {word.text}
          </span>
        )}
      </span>
    );
  };

  return (
    <div className={styles.lumiereWrap}>
      <div className={styles.lumiereWords}>
        {clusters.map((cluster) =>
          cluster.length === 1 && cluster[0] ? (
            renderWord(cluster[0])
          ) : (
            <span key={`${line.id}-c-${cluster[0]?.key ?? ""}`} className={styles.wordCluster}>
              {cluster.map(renderWord)}
            </span>
          ),
        )}
      </div>
    </div>
  );
}

/**
 * 模式 2（倾诉 Tilt — 致敬 ymzhen/folia VisualizerTilt）：
 * 将长句拆为水平主行 + 斜体大字交错行，斜体行奇偶字符上下错落（yStagger）并随演唱时间波浪跳动
 */
function TiltActiveLine({
  line,
  currentTime,
  reducedMotion,
}: {
  readonly line: EdgerunnersLyricLine;
  readonly currentTime: number;
  readonly reducedMotion: boolean;
}) {
  const clusters = groupWordClusters(line.words);
  const splitClusterIdx = clusters.length > 3 ? Math.ceil(clusters.length * 0.5) : 0;
  const primaryClusters = splitClusterIdx > 0 ? clusters.slice(0, splitClusterIdx) : [];
  const tiltWords = (splitClusterIdx > 0 ? clusters.slice(splitClusterIdx) : clusters).flat();

  const chars: {
    readonly id: string;
    readonly ch: string;
    readonly pos: number;
    readonly startTime: number;
    readonly endTime: number;
  }[] = [];

  let pos = 0;
  for (let wi = 0; wi < tiltWords.length; wi++) {
    const word = tiltWords[wi];
    if (!word) continue;
    const letters = Array.from(word.text);
    const wordSpan = Math.max(0.04, word.endTime - word.startTime);
    for (let ci = 0; ci < letters.length; ci++) {
      const ch = letters[ci] ?? "";
      const cStart = word.startTime + (ci / Math.max(1, letters.length)) * wordSpan;
      const cEnd = word.startTime + ((ci + 1) / Math.max(1, letters.length)) * wordSpan;
      chars.push({
        id: `${line.id}-tc-${pos}-${ch}`,
        ch,
        pos,
        startTime: cStart,
        endTime: cEnd,
      });
      pos++;
    }
    if (!word.joinNext && wi < tiltWords.length - 1) {
      chars.push({
        id: `${line.id}-tc-${pos}-sp`,
        ch: " ",
        pos,
        startTime: word.endTime,
        endTime: word.endTime,
      });
      pos++;
    }
  }

  return (
    <div className={styles.tiltWrap}>
      {primaryClusters.length > 0 && (
        <div className={styles.tiltPrimary}>
          {primaryClusters.map((cluster) => (
            <span key={`${line.id}-pc-${cluster[0]?.key ?? ""}`} className={styles.wordCluster}>
              {cluster.map((w) => {
                const wp = wordProgressAt(w, currentTime);
                return (
                  <span
                    key={`${line.id}-${w.key}`}
                    style={{
                      opacity: 0.45 + wp * 0.55,
                      color: wp > 0.5 ? "var(--cp-text)" : "var(--cp-text-dim)",
                    }}
                  >
                    {w.text}
                  </span>
                );
              })}
            </span>
          ))}
        </div>
      )}

      <div className={styles.tiltItalicRow}>
        {chars.map((item) => {
          const isSpace = item.ch === " ";
          const midTime = (item.startTime + item.endTime) * 0.5;
          const timeDist = Math.abs(currentTime - midTime);
          const pulse =
            !reducedMotion && !isSpace && currentTime >= line.startTime && timeDist < 0.28
              ? Math.cos((timeDist / 0.28) * Math.PI * 0.5)
              : 0;
          const yStagger = isSpace || reducedMotion ? 0 : (item.pos % 2 === 0 ? -1 : 1) * 3.2;
          const yLift = yStagger - pulse * 4.2;
          const scale = 1 + pulse * 0.18;
          const lit = currentTime >= item.startTime - 0.02;

          return (
            <span
              key={item.id}
              className={styles.tiltChar}
              style={{
                opacity: lit ? 1 : 0.36,
                transform: isSpace
                  ? undefined
                  : `translateY(${yLift.toFixed(2)}px) scale(${scale.toFixed(3)})`,
                minWidth: isSpace ? "0.32em" : undefined,
              }}
            >
              {isSpace ? "\u00A0" : item.ch}
            </span>
          );
        })}
      </div>
    </div>
  );
}
