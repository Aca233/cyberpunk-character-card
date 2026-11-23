import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { playSfx } from "../../audio";
import { Asset, cssUrl, NineSlice } from "../../ui/Asset";
import { Button } from "../../ui/Button";
import { useLayer } from "../../ui/layers";
import { ITEM_CELL_SLICE } from "../../ui/Panel";
import { ToggleCheck } from "../../ui/ToggleCheck";
import { useCardTilt } from "../../ui/useCardTilt";
import { setNarrativePref, useNarrativePrefs } from "../settings/prefs";
import { formatBytes, SHELL_THEMES, type ShellThemeId, type ShellThemeSpec } from "./catalog";
import {
  cancelThemeDownload,
  clearThemeCache,
  downloadAndSelectTheme,
  selectShellTheme,
  type ThemeRuntimeEntry,
  useShellTheme,
} from "./store";
import styles from "./theme-modal.module.css";

interface ThemeModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

export function ThemeModal({ open, onClose }: ThemeModalProps) {
  if (!open) return null;
  return createPortal(<ThemeModalBody onClose={onClose} />, document.body);
}

function ThemeModalBody({ onClose }: { readonly onClose: () => void }) {
  useLayer(onClose);
  const { storyTheme } = useNarrativePrefs();

  useEffect(() => {
    playSfx("panelOpen");
  }, []);

  return (
    <div
      className={styles.backdrop}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="shell-theme-modal-title"
        className={styles.modal}
      >
        <NineSlice
          id="notify.itemCellBg"
          slice={ITEM_CELL_SLICE}
          tint="var(--cp-panel-strong)"
          className={styles.slice}
        />
        <NineSlice
          id="notify.itemCellFg"
          slice={ITEM_CELL_SLICE}
          tint="var(--cp-red)"
          className={styles.slice}
        />

        <div className={styles.inner}>
          <header className={styles.head}>
            <div className={styles.headLeft}>
              <Asset
                id="panel.glowLeft"
                height={24}
                tint="var(--cp-cyan)"
                className={styles.headGlow}
              />
              <div className={styles.headTitles}>
                <span className={styles.code}>{"UI // SHELL_THEME"}</span>
                <h2 id="shell-theme-modal-title" className={styles.title}>
                  界面主题
                </h2>
              </div>
            </div>
            <div className={styles.headRight}>
              <span className={styles.scopeChip}>
                {storyTheme
                  ? "作用于主菜单 · 设置 · 角色 · 局内剧情"
                  : "作用于主菜单 · 设置 · 角色工作台"}
              </span>
              <Button small keyId="key.esc" onClick={onClose}>
                关闭
              </Button>
            </div>
          </header>

          <span
            className={styles.divider}
            style={{ maskImage: cssUrl("tab.line"), WebkitMaskImage: cssUrl("tab.line") }}
            aria-hidden
          />

          <ThemeGrid />

          <footer className={styles.foot}>
            <span className={styles.footNote}>
              可下载主题仅在点击后拉取并缓存在本机浏览器中（不占首次访问流量）；也可在「设置 →
              叙事偏好」中随时开关局内主题同步。
            </span>
          </footer>
        </div>
      </section>
    </div>
  );
}

/** 可复用的主题卡片网格：供弹窗与主菜单右侧舞台直接切换/下载，无需二次跳转 */
export function ThemeGrid({ compact = false }: { readonly compact?: boolean }) {
  const { effectiveId, entries } = useShellTheme();
  const { storyTheme } = useNarrativePrefs();
  const [confirmClearId, setConfirmClearId] = useState<ShellThemeId | null>(null);
  const [clearingId, setClearingId] = useState<ShellThemeId | null>(null);

  const handleSelect = (id: ShellThemeId) => {
    setConfirmClearId(null);
    if (selectShellTheme(id)) {
      playSfx("confirm");
    }
  };

  const handleDownload = async (id: ShellThemeId) => {
    setConfirmClearId(null);
    playSfx("click");
    const ok = await downloadAndSelectTheme(id);
    if (ok) {
      playSfx("confirm");
    }
  };

  const handleCancel = (id: ShellThemeId) => {
    cancelThemeDownload(id);
    playSfx("click");
  };

  const handleClear = async (id: ShellThemeId) => {
    setClearingId(id);
    try {
      await clearThemeCache(id);
      setConfirmClearId(null);
      playSfx("click");
    } finally {
      setClearingId(null);
    }
  };

  return (
    <div className={styles.gridWrap} data-compact={compact || undefined}>
      <label className={styles.storyToggleBar} htmlFor="pref-story-theme-inline">
        <div className={styles.storyToggleText}>
          <strong>局内应用界面主题</strong>
          <span>
            {storyTheme
              ? "已开启：局内剧情同步使用当前主题动态壁纸与配色"
              : "已关闭：局内剧情按当前地点与时段显示夜之城实景"}
          </span>
        </div>
        <ToggleCheck
          id="pref-story-theme-inline"
          variant="switch"
          checked={storyTheme}
          onChange={(next) => setNarrativePref("storyTheme", next)}
          aria-label="局内应用界面主题"
        />
      </label>
      <div className={styles.grid} data-compact={compact || undefined}>
        {SHELL_THEMES.map((theme) => (
          <ThemeCard
            key={theme.id}
            theme={theme}
            entry={entries[theme.id]}
            active={effectiveId === theme.id}
            compact={compact}
            confirmingClear={confirmClearId === theme.id}
            clearing={clearingId === theme.id}
            onSelect={() => handleSelect(theme.id)}
            onDownload={() => void handleDownload(theme.id)}
            onCancel={() => handleCancel(theme.id)}
            onRequestClear={() => setConfirmClearId(theme.id)}
            onCancelClear={() => setConfirmClearId(null)}
            onConfirmClear={() => void handleClear(theme.id)}
          />
        ))}
      </div>
    </div>
  );
}

interface ThemeCardProps {
  readonly theme: ShellThemeSpec;
  readonly entry: ThemeRuntimeEntry;
  readonly active: boolean;
  readonly compact: boolean;
  readonly confirmingClear: boolean;
  readonly clearing: boolean;
  readonly onSelect: () => void;
  readonly onDownload: () => void;
  readonly onCancel: () => void;
  readonly onRequestClear: () => void;
  readonly onCancelClear: () => void;
  readonly onConfirmClear: () => void;
}

function ThemeCard({
  theme,
  entry,
  active,
  compact,
  confirmingClear,
  clearing,
  onSelect,
  onDownload,
  onCancel,
  onRequestClear,
  onCancelClear,
  onConfirmClear,
}: ThemeCardProps) {
  const previewBg = theme.media ? `url("${theme.media.posterUrl}")` : cssUrl("menu.nightCity");
  const isDownloading = entry.status === "downloading";
  const isCached = entry.status === "cached";
  const isError = entry.status === "error";

  const loaded = entry.loadedBytes ?? 0;
  const total = entry.totalBytes ?? theme.media?.estimatedBytes ?? 1;
  const pct = isDownloading ? Math.min(100, Math.round((loaded / Math.max(total, 1)) * 100)) : 0;

  const statusLabel = active
    ? "使用中"
    : !theme.downloadable
      ? "内置可用"
      : isDownloading
        ? `下载中 ${pct}%`
        : isCached
          ? "已缓存"
          : isError
            ? "下载失败"
            : "未下载";

  const statusTone = active
    ? "active"
    : isDownloading
      ? "busy"
      : isError
        ? "error"
        : isCached || !theme.downloadable
          ? "ready"
          : "idle";

  const sizeBytes = entry.cachedBytes ?? theme.media?.estimatedBytes ?? 0;
  const tilt = useCardTilt<HTMLElement>({
    maxRotate: 5.5,
    shadowShift: 5,
  });

  return (
    <article className={styles.card} data-active={active || undefined} {...tilt}>
      <div className={styles.preview} style={{ backgroundImage: previewBg }}>
        <span className={styles.previewShade} aria-hidden />
        <span className={styles.previewBadge}>{theme.badge}</span>
        <span className={styles.statusChip} data-tone={statusTone}>
          {statusLabel}
        </span>
        <div className={styles.palette} aria-hidden>
          {theme.palette.map((color) => (
            <span
              key={color}
              className={styles.swatch}
              style={{ backgroundColor: color }}
              title={color}
            />
          ))}
        </div>
      </div>

      <div className={styles.cardBody}>
        <div className={styles.cardHead}>
          {!compact && <span className={styles.cardCode}>{theme.code}</span>}
          <h3 className={styles.cardTitle}>{theme.name}</h3>
        </div>
        {!compact && <p className={styles.cardSummary}>{theme.summary}</p>}
        <p className={styles.cardMeta}>
          {theme.downloadable && theme.media
            ? isCached
              ? `${theme.media.specLabel} · 本地已缓存 ${formatBytes(sizeBytes)}`
              : `${theme.media.specLabel} · 约 ${formatBytes(sizeBytes)}`
            : theme.details}
        </p>

        {isDownloading && (
          <div className={styles.progressBox} aria-live="polite">
            <div className={styles.progressHead}>
              <span>正在下载动态主题并写入本地缓存…</span>
              <span className="num">
                {formatBytes(loaded)} / {formatBytes(total)} · {pct}%
              </span>
            </div>
            <div
              className={styles.progressRail}
              role="progressbar"
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <span className={styles.progressFill} style={{ width: `${pct}%` }} />
            </div>
          </div>
        )}

        {isError && entry.error && <p className={styles.error}>{entry.error}</p>}

        <div className={styles.cardActions}>
          {!theme.downloadable ? (
            active ? (
              <span className={styles.activeHint}>当前正在使用</span>
            ) : (
              <Button primary small onClick={onSelect}>
                切换为此主题
              </Button>
            )
          ) : isDownloading ? (
            <Button small onClick={onCancel}>
              取消下载
            </Button>
          ) : isCached ? (
            confirmingClear ? (
              <>
                <span className={styles.confirmText}>
                  {active ? "清除缓存将切回默认主题" : "删除本机视频缓存？"}
                </span>
                <Button small disabled={clearing} onClick={onCancelClear}>
                  取消
                </Button>
                <Button primary small disabled={clearing} onClick={onConfirmClear}>
                  {clearing ? "清理中…" : "确认清除"}
                </Button>
              </>
            ) : (
              <>
                {active ? (
                  <span className={styles.activeHint}>当前正在使用</span>
                ) : (
                  <Button primary small onClick={onSelect}>
                    启用主题
                  </Button>
                )}
                <Button small onClick={onRequestClear}>
                  清除缓存
                </Button>
              </>
            )
          ) : (
            <Button primary small onClick={onDownload}>
              {isError
                ? `重试下载（${formatBytes(sizeBytes)}）`
                : `下载并启用（${formatBytes(sizeBytes)}）`}
            </Button>
          )}
        </div>
      </div>
    </article>
  );
}
