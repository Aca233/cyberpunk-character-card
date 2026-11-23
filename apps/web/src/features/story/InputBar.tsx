import type { TurnInput } from "@cp/core";
import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Asset, cssUrl, NineSlice } from "../../ui/Asset";
import { Button } from "../../ui/Button";
import { CellFrame } from "../../ui/FrameBox";
import { ITEM_CELL_SLICE } from "../../ui/Panel";
import { useCardTilt } from "../../ui/useCardTilt";
import { DeckQuickbar, type HackingView, type HackTarget } from "./DeckQuickbar";
import styles from "./story.module.css";

const MAX = 2000;
const WARN_AT = 1600;
const SEND_MODE_KEY = "cp.inputSendMode";
const SHADOW_SLICE = 40;

type SendMode = "enter" | "ctrlEnter";

function readSendMode(): SendMode {
  if (typeof localStorage === "undefined") return "enter";
  try {
    return localStorage.getItem(SEND_MODE_KEY) === "ctrlEnter" ? "ctrlEnter" : "enter";
  } catch {
    return "enter";
  }
}

function writeSendMode(mode: SendMode): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(SEND_MODE_KEY, mode);
  } catch {
    // 隐私模式或配额受限时忽略
  }
}

function supportsFieldSizing(): boolean {
  return typeof CSS !== "undefined" && CSS.supports("field-sizing", "content");
}

/** 剧情神经输入终端：一体化三段式布局 + 原作 notify.itemCell 九宫格壳体、map.shadowSmall 软投影与正式 Button */
export function InputBar({
  busy,
  streaming,
  stopping = false,
  disabled,
  reason,
  draft,
  onDraft,
  onSend,
  onStop,
  reply,
  onCancelReply,
  sandevistan,
  hacking,
  hackTargets,
  onOpenDeckTab,
  lastSentText,
  inputRef,
}: {
  readonly busy: boolean;
  readonly streaming: boolean;
  readonly stopping?: boolean | undefined;
  readonly disabled: boolean;
  readonly reason?: string | undefined;
  readonly draft: TurnInput;
  readonly onDraft: (draft: Partial<TurnInput>) => void;
  readonly onSend: (input: TurnInput) => void;
  readonly onStop: () => void;
  /** 正在回复的消息 */
  readonly reply?: { readonly name: string; readonly text: string } | undefined;
  readonly onCancelReply?: (() => void) | undefined;
  /** 角色已安装且未损坏的加速义体 */
  readonly sandevistan?: { readonly id: string; readonly name: string } | null | undefined;
  /** 角色已安装且完好的网络接入仓 */
  readonly hacking?: HackingView | null | undefined;
  /** 当前在场可点选的破解目标 */
  readonly hackTargets?: readonly HackTarget[] | undefined;
  /** 打开左上角「接入仓」独立页签 */
  readonly onOpenDeckTab?: (() => void) | undefined;
  /** 本存档最近一条玩家发出的自由行动（空框按 ↑ 调回） */
  readonly lastSentText?: string | undefined;
  /** 外部快捷键（如 /）聚焦用 */
  readonly inputRef?: RefObject<HTMLTextAreaElement | null> | undefined;
}) {
  const area = useRef<HTMLTextAreaElement | null>(null);
  const [sendMode, setSendMode] = useState<SendMode>(readSendMode);
  const [expanded, setExpanded] = useState(false);
  const [deckOpen, setDeckOpen] = useState(false);
  const [selectedTargetKey, setSelectedTargetKey] = useState<string | null>(null);
  const tilt = useCardTilt<HTMLDivElement>({
    disabled: disabled || expanded || busy,
    maxRotate: 4.8,
    shadowShift: 4.5,
    pressDepth: 6,
  });

  const setAreaRef = useCallback(
    (node: HTMLTextAreaElement | null) => {
      area.current = node;
      if (inputRef) inputRef.current = node;
    },
    [inputRef],
  );

  const text = draft.text.trim();
  const len = text.length;
  const tooLong = len > MAX;
  const nearLimit = !tooLong && len >= WARN_AT;
  const boostAvailable = sandevistan != null;
  const boostOn = boostAvailable && draft.sandevistan === true;
  const deckAvailable = hacking != null;
  const activeDeckOpen = deckAvailable && deckOpen;
  const canSend = !busy && !disabled && text !== "" && !tooLong;
  const hasRawText = draft.text !== "";

  // 加速义体损坏或卸下时自动取消未发送草稿里的开关
  useEffect(() => {
    if (!boostAvailable && draft.sandevistan === true) {
      onDraft({ sandevistan: false });
    }
  }, [boostAvailable, draft.sandevistan, onDraft]);

  // 接入仓卸下或损毁时收起快捷栏；目标离场时清除选中项
  useEffect(() => {
    if (!deckAvailable && deckOpen) {
      setDeckOpen(false);
      setSelectedTargetKey(null);
    }
  }, [deckAvailable, deckOpen]);

  useEffect(() => {
    if (
      selectedTargetKey !== null &&
      !(hackTargets ?? []).some((t) => t.key === selectedTargetKey)
    ) {
      setSelectedTargetKey(null);
    }
  }, [hackTargets, selectedTargetKey]);

  // 兼容不支持 field-sizing: content 的浏览器：按内容自动调整高度
  useLayoutEffect(() => {
    const el = area.current;
    if (!el || supportsFieldSizing()) return;
    if (expanded || draft.text === "") {
      el.style.height = "";
      return;
    }
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [draft.text, expanded]);

  // 点选「回复」或外部写入草稿时，把焦点放进输入框并将光标移至末尾
  const last = useRef(draft.text);
  const lastReplyTo = useRef(draft.replyTo);
  useEffect(() => {
    const textInjected =
      draft.text !== last.current && document.activeElement !== area.current && draft.text !== "";
    const replySelected = draft.replyTo !== undefined && draft.replyTo !== lastReplyTo.current;
    if (textInjected || replySelected) {
      const el = area.current;
      if (el) {
        el.focus();
        const end = el.value.length;
        el.setSelectionRange(end, end);
      }
    }
    last.current = draft.text;
    lastReplyTo.current = draft.replyTo;
  }, [draft.text, draft.replyTo]);

  const toggleSendMode = () => {
    setSendMode((prev) => {
      const next: SendMode = prev === "enter" ? "ctrlEnter" : "enter";
      writeSendMode(next);
      return next;
    });
  };

  const send = () => {
    if (!canSend) return;
    if (expanded) setExpanded(false);
    if (deckOpen) {
      setDeckOpen(false);
      setSelectedTargetKey(null);
    }
    onSend({
      text,
      ...(reply && draft.replyTo !== undefined ? { replyTo: draft.replyTo } : {}),
      ...(boostOn ? { sandevistan: true } : {}),
    });
  };

  const applyHackDraft = (line: string) => {
    onDraft({
      text: draft.text.trim() ? `${draft.text}\n${line}` : line,
    });
    setDeckOpen(false);
    setSelectedTargetKey(null);
    requestAnimationFrame(() => {
      const el = area.current;
      if (el) {
        el.focus();
        const end = el.value.length;
        el.setSelectionRange(end, end);
      }
    });
  };

  const clearDraft = () => {
    onDraft({ text: "" });
    area.current?.focus();
  };

  if (disabled) {
    return (
      <div className={styles.inputLocked} role="status" aria-live="polite">
        <NineSlice
          id="map.shadowSmall"
          tint="rgb(0 0 0 / 44%)"
          slice={SHADOW_SLICE}
          className={styles.composerShadow}
        />
        <CellFrame />
        <Asset id="notify.attention" height={14} tint="var(--cp-red)" />
        <span id="story-input-hint" className={styles.inputLockedText}>
          {reason ?? "当前存档已结束，仅供回看"}
        </span>
      </div>
    );
  }

  const placeholder = reply
    ? `回复 ${reply.name}（可直接答应接活、谈条件或回绝…）`
    : boostOn && sandevistan
      ? `写下 ${sandevistan.name} 慢动作内的连贯动作…`
      : busy
        ? "正在推演本轮剧情，可先起草下一步行动…"
        : "写下你的行动、对白或想法…";

  const sendDisabledReason = busy
    ? "正在推演当前回合，可先起草下一步行动"
    : tooLong
      ? `已超过 ${MAX} 字上限，请精简后再发送`
      : text === ""
        ? "输入你的行动或对白"
        : undefined;

  const scanUrl = cssUrl("fx.scanlines");

  return (
    <form
      className={styles.inputBar}
      data-busy={busy || undefined}
      data-boost={boostOn || undefined}
      data-deck={activeDeckOpen || undefined}
      data-reply={reply ? "" : undefined}
      data-invalid={tooLong || undefined}
      data-expanded={expanded || undefined}
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      <div className={styles.composerShell} {...tilt}>
        <NineSlice
          id="map.shadowSmall"
          tint="rgb(0 0 0 / 48%)"
          slice={SHADOW_SLICE}
          className={styles.composerShadow}
        />
        <NineSlice
          id="notify.itemCellBg"
          tint="var(--composer-fill)"
          slice={ITEM_CELL_SLICE}
          className={styles.composerBg}
        />
        <NineSlice
          id="notify.itemCellBg"
          tint="transparent"
          slice={ITEM_CELL_SLICE}
          className={styles.composerGlare}
        />
        {scanUrl && (
          <NineSlice
            id="notify.itemCellBg"
            tint="transparent"
            slice={ITEM_CELL_SLICE}
            className={styles.composerScan}
            style={{ backgroundImage: scanUrl }}
          />
        )}
        <NineSlice
          id="notify.itemCellFg"
          tint="var(--composer-line)"
          slice={ITEM_CELL_SLICE}
          className={styles.composerFg}
        />

        {busy && <span className={styles.composerSweep} aria-hidden="true" />}

        <div className={styles.composerBody}>
          {reply && (
            <div className={styles.replyBanner}>
              <span className={styles.replyTag}>REPLY</span>
              <span className={styles.replyText}>
                回复 <b>{reply.name}</b>：{reply.text}
              </span>
              {onCancelReply && (
                <button
                  type="button"
                  className={styles.replyClose}
                  onClick={onCancelReply}
                  aria-label="取消回复"
                  title="取消回复"
                >
                  <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">
                    <path
                      d="M2.2 2.2 9.8 9.8M9.8 2.2 2.2 9.8"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="square"
                    />
                  </svg>
                </button>
              )}
            </div>
          )}

          <div className={styles.editorWrap}>
            <span className={styles.promptBar} aria-hidden="true" />
            <textarea
              ref={setAreaRef}
              className={styles.textarea}
              rows={expanded ? 6 : 1}
              value={draft.text}
              placeholder={placeholder}
              aria-label="你的行动"
              aria-invalid={tooLong || undefined}
              onChange={(e) => onDraft({ text: e.target.value })}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing) return;
                if (e.key === "Escape") {
                  e.preventDefault();
                  if (activeDeckOpen) {
                    setDeckOpen(false);
                    setSelectedTargetKey(null);
                  } else if (expanded) {
                    setExpanded(false);
                  } else {
                    e.currentTarget.blur();
                  }
                  return;
                }
                if (e.altKey && !e.ctrlKey && !e.metaKey && e.key.toLowerCase() === "e") {
                  e.preventDefault();
                  setExpanded((v) => !v);
                  return;
                }
                if (
                  e.key === "ArrowUp" &&
                  !e.shiftKey &&
                  !e.ctrlKey &&
                  !e.metaKey &&
                  !e.altKey &&
                  draft.text === "" &&
                  lastSentText
                ) {
                  e.preventDefault();
                  onDraft({ text: lastSentText });
                  const target = e.currentTarget;
                  requestAnimationFrame(() => {
                    const end = target.value.length;
                    target.setSelectionRange(end, end);
                  });
                  return;
                }
                if (e.key === "Enter") {
                  if (e.ctrlKey || e.metaKey) {
                    e.preventDefault();
                    send();
                    return;
                  }
                  if (sendMode === "enter" && !e.shiftKey && !e.altKey) {
                    e.preventDefault();
                    send();
                  }
                }
              }}
            />
          </div>

          <div className={styles.composerFooter}>
            <div className={styles.footerLeft}>
              {boostAvailable && sandevistan && (
                <Button
                  small
                  pressed={boostOn}
                  onClick={() => {
                    onDraft({ sandevistan: !boostOn });
                    area.current?.focus();
                  }}
                >
                  <span className={styles.boostBtnInner}>
                    <Asset id="cyber.os" height={12} tint="currentColor" />
                    <span>{sandevistan.name}</span>
                  </span>
                </Button>
              )}

              {deckAvailable && hacking && (
                <Button
                  small
                  pressed={activeDeckOpen}
                  onClick={() => {
                    setDeckOpen((open) => !open);
                    setSelectedTargetKey(null);
                  }}
                >
                  <span
                    className={styles.boostBtnInner}
                    title={[
                      `${hacking.deckName} · 热负荷 ${hacking.thermal.label}（${hacking.thermal.heat}/${hacking.thermal.maxHeat}）`,
                      hacking.traceAlert
                        ? `反追踪警报：${hacking.traceAlert.target}（${hacking.traceAlert.at}）`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  >
                    <Asset id="cyber.os" height={12} tint="currentColor" />
                    <span>{hacking.deckName}</span>
                    {hacking.thermal.heat > 0 && (
                      <span className={styles.deckBtnMeter} data-level={hacking.thermal.level}>
                        {hacking.thermal.level === "critical"
                          ? `过载 ${hacking.thermal.heat}/${hacking.thermal.maxHeat}`
                          : `${hacking.thermal.heat}/${hacking.thermal.maxHeat}`}
                      </span>
                    )}
                    {hacking.traceAlert && <span className={styles.deckBtnAlert}>反追踪</span>}
                  </span>
                </Button>
              )}

              {tooLong ? (
                <span className={styles.footerAlert} role="alert">
                  超出上限，精简 {len - MAX} 字后发送
                </span>
              ) : busy ? (
                <span className={styles.footerStatus}>
                  <i className={styles.statusDot} aria-hidden="true" />
                  <span>推演中 · 可预写下一步</span>
                </span>
              ) : (
                <>
                  <button
                    type="button"
                    className={styles.metaLink}
                    title={
                      sendMode === "enter"
                        ? "Enter 发送 · Shift+Enter 换行（点击切换为 Ctrl+Enter 发送）"
                        : "Ctrl+Enter 发送 · Enter 换行（点击切换为 Enter 发送）"
                    }
                    onClick={toggleSendMode}
                  >
                    {sendMode === "enter" ? "Enter 发送" : "Ctrl+Enter 发送"}
                  </button>
                  <span className={styles.shortcutNote} aria-hidden="true">
                    · / 聚焦 · Esc 退出
                  </span>
                </>
              )}
            </div>

            <div className={styles.footerRight}>
              {len > 0 && (
                <span
                  className={styles.charMeter}
                  data-warn={nearLimit || undefined}
                  data-over={tooLong || undefined}
                >
                  {nearLimit || tooLong ? `${len}/${MAX}` : `${len} 字`}
                </span>
              )}

              {hasRawText && (
                <button type="button" className={styles.metaLink} onClick={clearDraft}>
                  清空
                </button>
              )}

              <button
                type="button"
                className={styles.metaLink}
                data-active={expanded || undefined}
                aria-pressed={expanded}
                title={expanded ? "收起编辑区（Alt+E）" : "展开长文编辑区（Alt+E）"}
                onClick={() => {
                  setExpanded((v) => !v);
                  area.current?.focus();
                }}
              >
                <span className={styles.expandInner}>
                  <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
                    {expanded ? (
                      <path
                        d="M2.5 4.5 6 8 9.5 4.5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="square"
                      />
                    ) : (
                      <path
                        d="M2.5 7.5 6 4 9.5 7.5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="square"
                      />
                    )}
                  </svg>
                  <span>{expanded ? "收起" : "展开"}</span>
                </span>
              </button>

              <span className={styles.footerAction}>
                {busy || streaming ? (
                  <Button
                    small
                    onClick={onStop}
                    disabled={stopping}
                    reason={stopping ? "正在停止当前回合" : undefined}
                  >
                    {stopping ? "正在停止…" : "停止生成"}
                  </Button>
                ) : (
                  <Button
                    type="submit"
                    primary
                    small
                    keyId="key.enter"
                    disabled={!canSend}
                    reason={sendDisabledReason}
                  >
                    发送
                  </Button>
                )}
              </span>
            </div>
          </div>
        </div>
      </div>

      {activeDeckOpen && hacking && (
        <DeckQuickbar
          hacking={hacking}
          targets={hackTargets ?? []}
          selectedKey={selectedTargetKey}
          onSelectTarget={setSelectedTargetKey}
          onPickDraft={applyHackDraft}
          onOpenDeckTab={onOpenDeckTab}
          onClose={() => {
            setDeckOpen(false);
            setSelectedTargetKey(null);
          }}
        />
      )}
    </form>
  );
}
