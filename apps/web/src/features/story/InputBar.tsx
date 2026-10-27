import type { TurnInput } from "@cp/core";
import { useEffect, useRef } from "react";
import { ActionButton } from "../../ui/ActionButton";
import { Button } from "../../ui/Button";
import styles from "./story.module.css";

const MAX = 2000;

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
  boost,
  reply,
  onCancelReply,
}: {
  readonly busy: boolean;
  readonly streaming: boolean;
  readonly disabled: boolean;
  readonly reason?: string | undefined;
  readonly draft: TurnInput;
  readonly onDraft: (draft: Partial<TurnInput>) => void;
  readonly onSend: (input: TurnInput) => void;
  readonly onStop: () => void;
  /** 生死瞬间、装着能用的加速义体时才有：可以开斯安威斯坦 */
  readonly boost?:
    | { readonly name: string; readonly slots: number; readonly cost: number }
    | undefined;
  /** 正在回复的消息 */
  readonly reply?: { readonly name: string; readonly text: string } | undefined;
  readonly onCancelReply?: (() => void) | undefined;
}) {
  const area = useRef<HTMLTextAreaElement>(null);
  const text = draft.text.trim();
  const tooLong = text.length > MAX;
  const canSend = !busy && !disabled && text !== "" && !tooLong;
  const boosting = boost !== undefined && draft.sandevistan === true;
  // 只在有用的时候提示：输入框不能用的原因、斯安威斯坦的规则；平时不写说明
  const hint =
    disabled && reason
      ? reason
      : boosting
        ? `斯安威斯坦开着：最多 ${boost?.slots} 个动作，不确定的部分合并成一次掷骰，人性 −${boost?.cost}`
        : null;

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
    if (!canSend) return;
    onSend({
      text,
      ...(boosting ? { sandevistan: true } : {}),
      ...(reply && draft.replyTo !== undefined ? { replyTo: draft.replyTo } : {}),
    });
  };

  return (
    <form
      className={styles.inputBar}
      data-boost={boosting || undefined}
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      {reply && (
        <p className={styles.replyChip}>
          <span className={styles.replyText}>
            回复 {reply.name}：{reply.text}
          </span>
          {onCancelReply && <ActionButton onClick={onCancelReply}>取消</ActionButton>}
        </p>
      )}
      <div className={styles.inputRow}>
        <textarea
          ref={area}
          className={styles.textarea}
          rows={2}
          value={draft.text}
          disabled={disabled}
          placeholder={
            boosting ? `时间慢下来了：这一瞬间要做的事（最多 ${boost?.slots} 件）` : undefined
          }
          aria-label="你的行动"
          aria-describedby={hint ? "story-input-hint" : undefined}
          onChange={(e) => onDraft({ text: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
        />
        {boost && !streaming && (
          <Button disabled={busy || disabled} onClick={() => onDraft({ sandevistan: !boosting })}>
            {boosting ? "关掉义体" : `开${boost.name}`}
          </Button>
        )}
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
        hint && (
          <span id="story-input-hint" className={styles.hint}>
            {hint}
          </span>
        )
      )}
    </form>
  );
}
