import type { TurnInput } from "@cp/core";
import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ActionButton } from "../../ui/ActionButton";
import { Asset, NineSlice } from "../../ui/Asset";
import { Button } from "../../ui/Button";
import { CellFrame } from "../../ui/FrameBox";
import styles from "./story.module.css";

const MAX = 2000;
const WARN_AT = 1600;
const SEND_MODE_KEY = "cp.inputSendMode";
const CELL_SLICE = [20, 30, 30, 20] as const;
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

/** 剧情神经输入槽：沿用原作 CellFrame 九宫格与 Button 组件，保持 HUD 统一质感与完整键盘流 */
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
        <NineSlice
          id="map.shadowSmall"
          tint="rgb(0 0 0 / 42%)"
          slice={SHADOW_SLICE}
          className={styles.inputShadow}
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
        : sendMode === "enter"
          ? "写下你的行动或对白…（Enter 发送 · Shift+Enter 换行）"
          : "写下你的行动或对白…（Ctrl+Enter 发送 · Enter 换行）";

  const sendDisabledReason = busy
    ? "正在推演当前回合，可先起草下一步行动"
    : tooLong
      ? `超过 ${MAX} 字上限`
      : undefined;

  return (
    <form
      className={styles.inputBar}
      data-busy={busy || undefined}
      data-boost={boostOn || undefined}
      data-reply={reply ? "" : undefined}
      data-invalid={tooLong || undefined}
      data-expanded={expanded || undefined}
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      {reply && (
        <p className={styles.replyBanner}>
          <span className={styles.replyText}>
            回复 <b>{reply.name}</b>：{reply.text}
          </span>
          {onCancelReply && <ActionButton onClick={onCancelReply}>取消</ActionButton>}
        </p>
      )}

      <div className={styles.inputRow}>
        <div className={styles.inputCell}>
          <NineSlice
            id="map.shadowSmall"
            tint="rgb(0 0 0 / 46%)"
            slice={SHADOW_SLICE}
            className={styles.inputShadow}
          />
          <CellFrame
            surface={
              <NineSlice
                id="map.filterCellBg"
                tint="transparent"
                slice={CELL_SLICE}
                className={styles.inputGlare}
              />
            }
          />
          {busy && <span className={styles.inputSweep} aria-hidden="true" />}
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

        <div className={styles.inputSubmit}>
          {streaming ? (
            <Button onClick={onStop}>停止生成</Button>
          ) : (
            <Button
              type="submit"
              primary
              keyId={busy ? undefined : "key.enter"}
              disabled={!canSend}
              reason={sendDisabledReason}
            >
              {busy ? "推演中…" : "发送"}
            </Button>
          )}
        </div>
      </div>

      <div className={styles.inputMeta}>
        <div className={styles.inputMetaLeft}>
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
          {tooLong ? (
            <span className={styles.inputAlert} role="alert">
              已超出上限（{len}/{MAX} 字），精简后再发送
            </span>
          ) : (
            busy && (
              <span className={styles.inputBusyNote}>
                <i className={styles.statusDot} aria-hidden="true" />
                <span>推演中 · 可提前起草下一轮</span>
              </span>
            )
          )}
        </div>

        <div className={styles.inputMetaRight}>
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
            title="Alt+E 切换长文编辑高度"
            onClick={() => {
              setExpanded((v) => !v);
              area.current?.focus();
            }}
          >
            {expanded ? "收起" : "展开"}
          </button>
          <button
            type="button"
            className={styles.metaLink}
            title="点击切换发送键位（Ctrl+Enter 始终可发送）"
            onClick={toggleSendMode}
          >
            {sendMode === "enter" ? "Enter 发送" : "Ctrl+Enter 发送"}
          </button>
        </div>
      </div>
    </form>
  );
}
