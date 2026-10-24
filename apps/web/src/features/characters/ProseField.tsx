import {
  type CharacterCard,
  PROSE_BLOCK_INFO,
  PROSE_MODE_LABELS,
  type ProseBlock,
  type ProseMode,
} from "@cp/core";
import { useEffect, useRef, useState } from "react";
import { ApiError, api } from "../../api/client";
import styles from "./characters.module.css";

/**
 * 角色正文的一个区块：可以手写，也可以交给辅助模型生成、重写、续写、润色（每次花一次模型调用），
 * 边写边显示，中途能停，停下时保留已经写出的部分；写完能撤销一步。锁定后模型不改它，
 * 写别的区块时把它当定稿
 */
export function ProseField({
  block,
  card,
  onChange,
}: {
  readonly block: ProseBlock;
  readonly card: CharacterCard;
  readonly onChange: (patch: Partial<CharacterCard>) => void;
}) {
  const { label, max, hint } = PROSE_BLOCK_INFO[block];
  const value = card[block];
  const locked = card.locked.includes(block);
  const [streaming, setStreaming] = useState<{ base: string; text: string } | null>(null);
  const [previous, setPrevious] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [instruction, setInstruction] = useState("");
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  const run = async (mode: ProseMode) => {
    const controller = new AbortController();
    abort.current = controller;
    const base = mode === "continue" ? value : "";
    let text = "";
    setError(null);
    setNote(null);
    setStreaming({ base, text });
    const finish = () => {
      if (text !== "") {
        setPrevious(value);
        onChange({ [block]: (base + text).slice(0, max) });
      }
    };
    try {
      const result = await api.streamProse(
        { card, block, mode, ...(instruction.trim() ? { instruction: instruction.trim() } : {}) },
        (piece) => {
          text += piece;
          setStreaming({ base, text });
        },
        controller.signal,
      );
      finish();
      if (result.truncated) setNote(`模型写超了 ${max} 字，后面的截掉了`);
    } catch (caught) {
      if (controller.signal.aborted) {
        finish();
        if (text !== "") setNote("已停止，保留了写出来的部分");
      } else {
        setError(caught instanceof ApiError ? caught.message : "写正文时出错了，可以重试");
      }
    } finally {
      abort.current = null;
      setStreaming(null);
    }
  };

  const shown = streaming ? streaming.base + streaming.text : value;
  const busy = streaming !== null;
  const empty = value.trim() === "";
  const modes: ProseMode[] = empty ? ["generate"] : ["rewrite", "continue", "polish"];

  return (
    <div className={styles.prose} data-locked={locked || undefined}>
      <label className={styles.field}>
        <span>
          {label}
          {locked && " · 已锁定"}
          <small>
            {shown.length} / {max}
          </small>
        </span>
        <textarea
          rows={block === "past" || block === "examples" ? 5 : 3}
          maxLength={max}
          value={shown}
          readOnly={busy}
          aria-busy={busy}
          placeholder={hint}
          onChange={(event) => {
            setPrevious(null);
            onChange({ [block]: event.target.value });
          }}
        />
      </label>
      <div className={styles.slotTools}>
        {busy ? (
          <button
            type="button"
            className={styles.toolButton}
            onClick={() => abort.current?.abort()}
          >
            停止
          </button>
        ) : (
          modes.map((mode) => (
            <button
              type="button"
              key={mode}
              className={styles.toolButton}
              disabled={locked || card.name.trim() === ""}
              title={
                locked
                  ? "锁定了，模型不会改它"
                  : card.name.trim() === ""
                    ? "先给角色起个名字"
                    : "交给辅助模型写；会花一次模型调用"
              }
              onClick={() => void run(mode)}
            >
              {PROSE_MODE_LABELS[mode]}
            </button>
          ))
        )}
        <button
          type="button"
          className={styles.toolButton}
          aria-pressed={asking}
          disabled={busy || locked}
          onClick={() => setAsking((a) => !a)}
        >
          要求
        </button>
        {previous !== null && !busy && (
          <button
            type="button"
            className={styles.toolButton}
            onClick={() => {
              onChange({ [block]: previous });
              setPrevious(null);
              setNote(null);
            }}
          >
            撤销
          </button>
        )}
        <button
          type="button"
          className={styles.toolButton}
          aria-pressed={locked}
          disabled={busy}
          title="锁定后模型不会改它，写别的区块时当作定稿；手写照样可以改"
          onClick={() =>
            onChange({
              locked: locked ? card.locked.filter((b) => b !== block) : [...card.locked, block],
            })
          }
        >
          {locked ? "解锁" : "锁定"}
        </button>
      </div>
      {asking && !locked && (
        <label className={styles.field}>
          <span>
            给模型的要求
            <small>{instruction.length} / 200</small>
          </span>
          <input
            maxLength={200}
            value={instruction}
            placeholder="例如：更冷一点；提到她妹妹；少写打斗"
            onChange={(event) => setInstruction(event.target.value)}
          />
        </label>
      )}
      {note && (
        <p className={styles.note} role="status">
          {note}
        </p>
      )}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
