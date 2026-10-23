import type { TurnInput } from "@cp/core";
import { useEffect, useRef } from "react";
import { Button } from "../../ui/Button";
import styles from "./story.module.css";
import { MODE_HINTS, MODE_LABELS, MODES } from "./view";

const MAX = 2000;

/** 输入框：做 / 说 / 想 / 出戏；Enter 发送，Shift+Enter 换行；生成时变成“停止生成” */
export function InputBar({
  busy,
  streaming,
  disabled,
  reason,
  draft,
  onDraft,
  onSend,
  onStop,
}: {
  readonly busy: boolean;
  readonly streaming: boolean;
  readonly disabled: boolean;
  readonly reason?: string | undefined;
  readonly draft: TurnInput;
  readonly onDraft: (draft: Partial<TurnInput>) => void;
  readonly onSend: (input: TurnInput) => void;
  readonly onStop: () => void;
}) {
  const area = useRef<HTMLTextAreaElement>(null);
  const text = draft.text.trim();
  const tooLong = text.length > MAX;
  const canSend = !busy && !disabled && text !== "" && !tooLong;

  // 改写检定时文字被放进输入框：把焦点也放过去
  const last = useRef(draft.text);
  useEffect(() => {
    if (
      draft.text !== last.current &&
      document.activeElement !== area.current &&
      draft.text !== ""
    ) {
      area.current?.focus();
    }
    last.current = draft.text;
  }, [draft.text]);

  const send = () => {
    if (canSend) onSend({ mode: draft.mode, text });
  };

  return (
    <form
      className={styles.inputBar}
      data-mode={draft.mode}
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      <div className={styles.modes} role="tablist" aria-label="输入方式">
        {MODES.map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={draft.mode === m}
            className={styles.mode}
            data-mode={m}
            onClick={() => {
              onDraft({ mode: m });
              area.current?.focus();
            }}
          >
            {MODE_LABELS[m]}
          </button>
        ))}
        <span className={styles.modeHint}>
          {disabled && reason ? reason : MODE_HINTS[draft.mode]}
        </span>
      </div>
      <div className={styles.inputRow}>
        <textarea
          ref={area}
          className={styles.textarea}
          rows={2}
          value={draft.text}
          disabled={disabled}
          placeholder={MODE_HINTS[draft.mode]}
          aria-label="你的行动"
          onChange={(e) => onDraft({ text: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
        />
        {streaming ? (
          <Button onClick={onStop}>停止生成</Button>
        ) : (
          <Button
            type="submit"
            primary
            keyId="key.enter"
            disabled={!canSend}
            reason={busy ? "正在提交" : tooLong ? `超过 ${MAX} 字` : undefined}
          >
            发送
          </Button>
        )}
      </div>
      {tooLong && (
        <p className={styles.warn}>
          {text.length}/{MAX} 字，太长了
        </p>
      )}
    </form>
  );
}
