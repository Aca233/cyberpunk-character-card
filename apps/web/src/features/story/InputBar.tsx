import type { TurnInput } from "@cp/core";
import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Asset } from "../../ui/Asset";
import styles from "./story.module.css";

const MAX = 2000;
const WARN_AT = 1600;
const SEND_MODE_KEY = "cp.inputSendMode";

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

/** 神经终端输入条：一体化赛博命令终端，支持键位切换、长文展开、斯安威斯坦开关与键盘流闭环 */
export function InputBar({
  busy,
  streaming,
  disabled,
  reason,
  draft,
  onDraft,
  onSend,
  onStop,
  reply,
  onCancelReply,
  sandevistan,
  lastSentText,
  inputRef,
}: {
  readonly busy: boolean;
  readonly streaming: boolean;
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
  /** 本存档最近一条玩家发出的自由行动（空框按 ↑ 调回） */
  readonly lastSentText?: string | undefined;
  /** 外部快捷键（如 /）聚焦用 */
  readonly inputRef?: RefObject<HTMLTextAreaElement | null> | undefined;
}) {
  const area = useRef<HTMLTextAreaElement | null>(null);
  const [sendMode, setSendMode] = useState<SendMode>(readSendMode);
  const [expanded, setExpanded] = useState(false);

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
  const canSend = !busy && !disabled && text !== "" && !tooLong;
  const hasRawText = draft.text !== "";

  // 加速义体损坏或卸下时自动取消未发送草稿里的开关
  useEffect(() => {
    if (!boostAvailable && draft.sandevistan === true) {
      onDraft({ sandevistan: false });
    }
  }, [boostAvailable, draft.sandevistan, onDraft]);

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
    onSend({
      text,
      ...(reply && draft.replyTo !== undefined ? { replyTo: draft.replyTo } : {}),
      ...(boostOn ? { sandevistan: true } : {}),
    });
  };

  const clearDraft = () => {
    onDraft({ text: "" });
    area.current?.focus();
  };

  if (disabled) {
    return (
      <div className={styles.inputLocked} role="status" aria-live="polite">
        <Asset id="notify.attention" height={14} tint="currentColor" />
        <span className={styles.inputLockedTag}>LINK CLOSED</span>
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

  const sendHint =
    sendMode === "enter"
      ? "Enter 发送 · Shift+Enter 换行（点击切换为 Ctrl+Enter 发送）"
      : "Ctrl+Enter 发送 · Enter 换行（点击切换为 Enter 发送）";

  const sendDisabledReason = busy
    ? "正在推演当前回合，可先起草下一步行动"
    : tooLong
      ? `已超过 ${MAX} 字上限，请精简后再发送`
      : text === ""
        ? "输入你的行动或对白"
        : undefined;

  return (
    <form
      className={styles.inputBar}
      data-busy={busy || undefined}
      data-streaming={streaming || undefined}
      data-boost={boostOn || undefined}
      data-reply={reply ? "" : undefined}
      data-invalid={tooLong || undefined}
      data-expanded={expanded || undefined}
      data-has-text={hasRawText || undefined}
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      <div className={styles.composerFrame}>
        <div className={styles.composerInner}>
          {busy && <div className={styles.composerProgress} aria-hidden="true" />}

          {reply && (
            <div className={styles.replyBanner}>
              <span className={styles.replyBadge}>REPLY</span>
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
                      strokeWidth="1.6"
                      strokeLinecap="square"
                    />
                  </svg>
                </button>
              )}
            </div>
          )}

          <div className={styles.editorWrap}>
            <span className={styles.promptGlyph} aria-hidden="true">
              {boostOn ? "»" : "›"}
            </span>
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
                  if (expanded) {
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
                <button
                  type="button"
                  className={styles.chipToggle}
                  data-active={boostOn || undefined}
                  aria-pressed={boostOn}
                  title={
                    boostOn
                      ? `已开启「${sandevistan.name}」：本轮将进入慢动作加速判定（点击关闭）`
                      : `开启「${sandevistan.name}」：在慢动作内完成连贯高危动作`
                  }
                  onClick={() => {
                    onDraft({ sandevistan: !boostOn });
                    area.current?.focus();
                  }}
                >
                  <Asset id="cyber.os" height={13} tint="currentColor" />
                  <span>{sandevistan.name}</span>
                </button>
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
                <button
                  type="button"
                  className={styles.modeToggle}
                  onClick={toggleSendMode}
                  title={sendHint}
                >
                  <kbd className={styles.miniKey}>
                    {sendMode === "enter" ? "Enter" : "Ctrl+Enter"}
                  </kbd>
                  <span>发送</span>
                </button>
              )}

              {!busy && !tooLong && (
                <span className={styles.shortcutNote} aria-hidden="true">
                  / 聚焦 · Esc 退出
                </span>
              )}
            </div>

            <div className={styles.footerRight}>
              {len > 0 && (
                <span
                  className={styles.charMeter}
                  data-warn={nearLimit || undefined}
                  data-over={tooLong || undefined}
                  aria-live={tooLong ? "polite" : undefined}
                >
                  {nearLimit || tooLong ? `${len}/${MAX}` : `${len} 字`}
                </span>
              )}

              {hasRawText && (
                <button
                  type="button"
                  className={styles.iconTool}
                  onClick={clearDraft}
                  title="清空草稿"
                  aria-label="清空草稿"
                >
                  清空
                </button>
              )}

              <button
                type="button"
                className={styles.iconTool}
                data-active={expanded || undefined}
                aria-pressed={expanded}
                onClick={() => {
                  setExpanded((v) => !v);
                  area.current?.focus();
                }}
                title={expanded ? "收起编辑区（Alt+E）" : "展开长文编辑区（Alt+E）"}
                aria-label={expanded ? "收起编辑区" : "展开长文编辑区"}
              >
                <svg viewBox="0 0 14 14" width="12" height="12" aria-hidden="true">
                  {expanded ? (
                    <path
                      d="M3 5.5 7 9.5 11 5.5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="square"
                    />
                  ) : (
                    <path
                      d="M3 8.5 7 4.5 11 8.5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="square"
                    />
                  )}
                </svg>
                <span>{expanded ? "收起" : "展开"}</span>
              </button>

              {streaming ? (
                <button
                  type="button"
                  className={styles.stopBtn}
                  onClick={onStop}
                  title="中断当前回合生成（不会写入存档）"
                >
                  <span className={styles.stopSquare} aria-hidden="true" />
                  <span>停止生成</span>
                </button>
              ) : (
                <button
                  type="submit"
                  className={styles.sendBtn}
                  data-ready={canSend || undefined}
                  data-boost={boostOn || undefined}
                  disabled={!canSend}
                  title={
                    sendDisabledReason ?? (sendMode === "enter" ? "Enter 发送" : "Ctrl+Enter 发送")
                  }
                >
                  {!busy && <Asset id="key.enter" height={15} tint="currentColor" />}
                  <span>{busy ? "推演中…" : "发送"}</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </form>
  );
}
