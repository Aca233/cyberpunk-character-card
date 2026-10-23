import type { TurnInput } from "@cp/core";
import { useEffect, useRef } from "react";
import { Button } from "../../ui/Button";
import styles from "./story.module.css";

const MAX = 2000;
const HINT = "动作、台词、心里话都直接写；想跳出角色问规则或现状，也直接问";

/** 只有一个输入框；Enter 发送，Shift+Enter 换行；生成时变成“停止生成” */
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
    if (canSend) onSend({ text });
  };

  return (
    <form
      className={styles.inputBar}
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      <div className={styles.inputRow}>
        <textarea
          ref={area}
          className={styles.textarea}
          rows={2}
          value={draft.text}
          disabled={disabled}
          placeholder="你要做什么、说什么？"
          aria-label="你的行动"
          aria-describedby="story-input-hint"
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
      {tooLong ? (
        <p className={styles.warn}>
          {text.length}/{MAX} 字，太长了
        </p>
      ) : (
        <span id="story-input-hint" className={styles.hint}>
          {disabled && reason ? reason : HINT}
        </span>
      )}
    </form>
  );
}
