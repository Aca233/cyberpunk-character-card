import { useEffect } from "react";
import { AUDIO_LABELS, audioAsset, BGM_IDS, SFX_ASSET_IDS } from "../../assets";
import {
  auditionSfxAsset,
  clearBgmPreview,
  playSfx,
  previewBgm,
  resetAudioPrefs,
  type SfxCue,
  setAudioPref,
  useAudioPrefs,
  useAudioState,
} from "../../audio";
import { Asset, cssUrl, NineSlice } from "../../ui/Asset";
import { Button } from "../../ui/Button";
import { ITEM_CELL_SLICE } from "../../ui/Panel";
import { ToggleCheck } from "../../ui/ToggleCheck";
import audioStyles from "./audio-settings.module.css";
import ms from "./model-settings.module.css";
import styles from "./settings.module.css";

const SYNTH_AUDITION: readonly { readonly cue: SfxCue; readonly label: string }[] = [
  { cue: "hover", label: "悬停微动" },
  { cue: "click", label: "按键点击" },
  { cue: "confirm", label: "主操作确认" },
  { cue: "tab", label: "页签切换" },
  { cue: "panelOpen", label: "面板展开" },
  { cue: "eddies", label: "欧元转账" },
  { cue: "holocall", label: "全息来电" },
  { cue: "error", label: "操作拒绝" },
];

function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return "";
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m > 0 ? `${m}:${String(s).padStart(2, "0")}` : `${sec.toFixed(1)}s`;
}

export function AudioSettings() {
  const prefs = useAudioPrefs();
  const state = useAudioState();

  useEffect(() => {
    return () => clearBgmPreview();
  }, []);

  const pct = (v: number) => `${Math.round(v * 100)}%`;

  return (
    <div className={styles.prefsRoot}>
      <div className={styles.prefsSummary}>
        <div className={styles.prefsSummaryLeft}>
          <span className={styles.prefsTag}>{"AUDIO // CYBERPUNK_OST"}</span>
          <span className={styles.dim}>
            {state.originalReady
              ? `已载入原版解包音频 ${state.originalCount} 条 · 快捷静音 Alt+M`
              : "未检测到原版音频索引（运行 pnpm pick-assets 生成）· 当前使用合成微交互"}
          </span>
        </div>
        <div className={styles.presetStats}>
          <span className={styles.statChip} data-tone={prefs.muted ? "warn" : "ok"}>
            {prefs.muted ? "已静音" : `主音量 ${pct(prefs.masterVolume)}`}
          </span>
          {state.activeLabel && (
            <span className={styles.statChip} data-tone={state.previewBgm ? "warn" : "ok"}>
              {state.previewBgm ? `试听：${state.activeLabel}` : `当前：${state.activeLabel}`}
            </span>
          )}
          <Button small onClick={resetAudioPrefs}>
            恢复默认
          </Button>
        </div>
      </div>

      <div className={audioStyles.audioGrid}>
        <section className={styles.prefGroup} aria-label="声道与音量">
          <NineSlice
            id="notify.itemCellBg"
            slice={ITEM_CELL_SLICE}
            tint="var(--cp-surface)"
            className={styles.slice}
          />
          <NineSlice
            id="notify.itemCellFg"
            slice={ITEM_CELL_SLICE}
            tint="var(--cp-red-dim)"
            className={styles.slice}
          />
          <div className={styles.groupHeader}>
            <Asset id="panel.glowLeft" height={18} tint="var(--cp-cyan)" />
            <span className={ms.kicker}>01 / 声道与音量</span>
          </div>
          <span
            className={styles.thinLine}
            style={{ maskImage: cssUrl("tab.line"), WebkitMaskImage: cssUrl("tab.line") }}
            aria-hidden
          />

          <div className={styles.prefRows}>
            <div className={styles.prefRow}>
              <label className={styles.prefText} htmlFor="audio-muted">
                <strong>全部静音</strong>
                <small>一键关闭所有音乐与音效（随时可按 Alt+M 切换）</small>
              </label>
              <span className={styles.prefControl}>
                <ToggleCheck
                  id="audio-muted"
                  variant="switch"
                  checked={prefs.muted}
                  onChange={(v) => setAudioPref("muted", v)}
                />
              </span>
            </div>

            <div className={audioStyles.sliderRow}>
              <div className={audioStyles.sliderHead}>
                <label className={styles.prefText} htmlFor="audio-master">
                  <strong>主音量</strong>
                </label>
                <span className={audioStyles.sliderVal} data-dim={prefs.muted || undefined}>
                  {pct(prefs.masterVolume)}
                </span>
              </div>
              <input
                id="audio-master"
                type="range"
                min={0}
                max={100}
                step={2}
                disabled={prefs.muted}
                value={Math.round(prefs.masterVolume * 100)}
                className={audioStyles.range}
                onChange={(e) => setAudioPref("masterVolume", Number(e.target.value) / 100)}
              />
            </div>

            <div className={styles.prefRow}>
              <label className={styles.prefText} htmlFor="audio-bgm-on">
                <strong>背景音乐（原版自适应配乐）</strong>
                <small>随主菜单、夜之城探索、潜入、潜网、交火、安全屋与终章自动平滑切换</small>
              </label>
              <span className={styles.prefControl}>
                <ToggleCheck
                  id="audio-bgm-on"
                  variant="switch"
                  checked={prefs.bgmEnabled}
                  disabled={prefs.muted}
                  onChange={(v) => setAudioPref("bgmEnabled", v)}
                />
              </span>
            </div>

            <div className={audioStyles.sliderRow}>
              <div className={audioStyles.sliderHead}>
                <label className={styles.prefText} htmlFor="audio-bgm-vol">
                  <strong>音乐音量</strong>
                </label>
                <span
                  className={audioStyles.sliderVal}
                  data-dim={prefs.muted || !prefs.bgmEnabled || undefined}
                >
                  {pct(prefs.bgmVolume)}
                </span>
              </div>
              <input
                id="audio-bgm-vol"
                type="range"
                min={0}
                max={100}
                step={2}
                disabled={prefs.muted || !prefs.bgmEnabled}
                value={Math.round(prefs.bgmVolume * 100)}
                className={audioStyles.range}
                onChange={(e) => setAudioPref("bgmVolume", Number(e.target.value) / 100)}
              />
            </div>

            <div className={styles.prefRow}>
              <label className={styles.prefText} htmlFor="audio-sfx-on">
                <strong>游戏与界面音效</strong>
                <small>按钮点击、斯安威斯坦、义体植入、岐路司扫描、委托结算与全息来电</small>
              </label>
              <span className={styles.prefControl}>
                <ToggleCheck
                  id="audio-sfx-on"
                  variant="switch"
                  checked={prefs.sfxEnabled}
                  disabled={prefs.muted}
                  onChange={(v) => setAudioPref("sfxEnabled", v)}
                />
              </span>
            </div>

            <div className={audioStyles.sliderRow}>
              <div className={audioStyles.sliderHead}>
                <label className={styles.prefText} htmlFor="audio-sfx-vol">
                  <strong>音效音量</strong>
                </label>
                <span
                  className={audioStyles.sliderVal}
                  data-dim={prefs.muted || !prefs.sfxEnabled || undefined}
                >
                  {pct(prefs.sfxVolume)}
                </span>
              </div>
              <input
                id="audio-sfx-vol"
                type="range"
                min={0}
                max={100}
                step={2}
                disabled={prefs.muted || !prefs.sfxEnabled}
                value={Math.round(prefs.sfxVolume * 100)}
                className={audioStyles.range}
                onChange={(e) => setAudioPref("sfxVolume", Number(e.target.value) / 100)}
              />
            </div>

            <div className={styles.prefRow}>
              <label className={styles.prefText} htmlFor="audio-hover">
                <strong>悬停微交互音</strong>
                <small>鼠标掠过按钮与菜单项时的轻触高频微滴</small>
              </label>
              <span className={styles.prefControl}>
                <ToggleCheck
                  id="audio-hover"
                  variant="switch"
                  checked={prefs.uiHoverSfx}
                  disabled={prefs.muted || !prefs.sfxEnabled}
                  onChange={(v) => setAudioPref("uiHoverSfx", v)}
                />
              </span>
            </div>
          </div>
        </section>

        <section className={styles.prefGroup} aria-label="原版配乐试听">
          <NineSlice
            id="notify.itemCellBg"
            slice={ITEM_CELL_SLICE}
            tint="var(--cp-surface)"
            className={styles.slice}
          />
          <NineSlice
            id="notify.itemCellFg"
            slice={ITEM_CELL_SLICE}
            tint="var(--cp-red-dim)"
            className={styles.slice}
          />
          <div className={styles.groupHeader}>
            <Asset id="panel.glowLeft" height={18} tint="var(--cp-cyan)" />
            <span className={ms.kicker}>02 / 原版配乐试听</span>
            {state.previewBgm && (
              <div className={styles.groupAction}>
                <Button small onClick={clearBgmPreview}>
                  恢复场景配乐
                </Button>
              </div>
            )}
          </div>
          <span
            className={styles.thinLine}
            style={{ maskImage: cssUrl("tab.line"), WebkitMaskImage: cssUrl("tab.line") }}
            aria-hidden
          />
          <div className={audioStyles.trackList}>
            {BGM_IDS.map((id) => {
              const info = audioAsset(id);
              const isPreview = state.previewBgm === id;
              const isActive = state.activeBgm === id && state.playing;
              return (
                <button
                  key={id}
                  type="button"
                  className={audioStyles.trackBtn}
                  data-active={isActive || undefined}
                  data-preview={isPreview || undefined}
                  data-sfx="none"
                  disabled={!info || prefs.muted || !prefs.bgmEnabled}
                  onClick={() => previewBgm(id)}
                >
                  <span className={audioStyles.trackLeft}>
                    <Asset
                      id={isActive || isPreview ? "braindance.soundOn" : "braindance.sound"}
                      height={16}
                      tint="currentColor"
                    />
                    <span className={audioStyles.trackName}>{AUDIO_LABELS[id]}</span>
                  </span>
                  <span className={audioStyles.trackMeta}>
                    {isPreview
                      ? "试听中 · 点击恢复"
                      : isActive
                        ? "播放中"
                        : info
                          ? formatDuration(info.duration)
                          : "未就绪"}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      </div>

      <section className={styles.prefGroup} aria-label="原版音效试听">
        <NineSlice
          id="notify.itemCellBg"
          slice={ITEM_CELL_SLICE}
          tint="var(--cp-surface)"
          className={styles.slice}
        />
        <NineSlice
          id="notify.itemCellFg"
          slice={ITEM_CELL_SLICE}
          tint="var(--cp-red-dim)"
          className={styles.slice}
        />
        <div className={styles.groupHeader}>
          <Asset id="panel.glowLeft" height={18} tint="var(--cp-cyan)" />
          <span className={ms.kicker}>03 / 音效试听（原版优先 + 微交互补齐）</span>
        </div>
        <span
          className={styles.thinLine}
          style={{ maskImage: cssUrl("tab.line"), WebkitMaskImage: cssUrl("tab.line") }}
          aria-hidden
        />
        <div className={audioStyles.sfxGrid}>
          {SFX_ASSET_IDS.map((id) => {
            const info = audioAsset(id);
            return (
              <button
                key={id}
                type="button"
                className={audioStyles.sfxBtn}
                data-sfx="none"
                disabled={!info || prefs.muted || !prefs.sfxEnabled}
                onClick={() => auditionSfxAsset(id)}
              >
                <span>{AUDIO_LABELS[id]}</span>
                <span className={audioStyles.sfxTag}>原版</span>
              </button>
            );
          })}
          {SYNTH_AUDITION.map((item) => (
            <button
              key={item.cue}
              type="button"
              className={audioStyles.sfxBtn}
              data-sfx="none"
              disabled={prefs.muted || !prefs.sfxEnabled}
              onClick={() => playSfx(item.cue)}
            >
              <span>{item.label}</span>
              <span className={audioStyles.sfxTag}>UI</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
