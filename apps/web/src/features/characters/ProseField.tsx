import {
  type CharacterCard,
  PROSE_BLOCK_INFO,
  PROSE_MODE_LABELS,
  type ProseBlock,
  type ProseMode,
} from "@cp/core";
import { useEffect, useRef, useState } from "react";
import { ApiError, api } from "../../api/client";
import { ActionButton } from "../../ui/ActionButton";
import { Button } from "../../ui/Button";
import { CellFrame, FrameBox } from "../../ui/FrameBox";
import styles from "./characters.module.css";

/**
 * 角色正文区块：可手写，也可交由辅助模型单块生成、重写、续写、润色，
 * 边写边流式显示，中途可停并保留已输出内容，支持单步撤销与锁定定稿。
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
      if (result.truncated) setNote(`字数超出 ${max} 字上限，多余内容已截断`);
    } catch (caught) {
      if (controller.signal.aborted) {
        finish();
        if (text !== "") setNote("已停止生成，保留了已输出内容");
      } else {
        setError(caught instanceof ApiError ? caught.message : "文本生成失败，请重试");
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
    <div
      className={styles.prose}
      data-locked={locked || undefined}
      data-filled={!empty || undefined}
    >
      <CellFrame />
      <div className={styles.proseHead}>
        <span className={styles.proseTitleWrap}>
          <strong className={styles.proseTitle}>{label}</strong>
          {locked && <span className={styles.proseLockBadge}>已锁定</span>}
          <small className={styles.proseCount}>
            {shown.length} / {max}
          </small>
        </span>
        <div className={styles.slotTools}>
          {busy ? (
            <Button small onClick={() => abort.current?.abort()}>
              停止
            </Button>
          ) : (
            modes.map((mode) => (
              <Button
                key={mode}
                small
                disabled={locked || card.name.trim() === ""}
                reason={locked ? "已锁定定稿，模型不会改动此区块" : "请先给角色起个名字"}
                onClick={() => void run(mode)}
              >
                {PROSE_MODE_LABELS[mode]}
              </Button>
            ))
          )}
          <Button
            small
            pressed={asking}
            disabled={busy || locked}
            reason={locked ? "解锁后可调整 AI 生成要求" : undefined}
            onClick={() => setAsking((a) => !a)}
          >
            要求
          </Button>
          {previous !== null && !busy && (
            <ActionButton
              onClick={() => {
                onChange({ [block]: previous });
                setPrevious(null);
                setNote(null);
              }}
            >
              撤销
            </ActionButton>
          )}
          <Button
            small
            pressed={locked}
            disabled={busy}
            onClick={() =>
              onChange({
                locked: locked ? card.locked.filter((b) => b !== block) : [...card.locked, block],
              })
            }
          >
            {locked ? "解锁" : "锁定"}
          </Button>
        </div>
      </div>

      {asking && !locked && (
        <label className={styles.field}>
          <span>
            生成要求 / 补充设定
            <small>{instruction.length} / 200</small>
          </span>
          <FrameBox className={styles.compactBox}>
            <input
              maxLength={200}
              value={instruction}
              placeholder="例如：更冷一点；提到她妹妹；少写打斗"
              onChange={(event) => setInstruction(event.target.value)}
            />
          </FrameBox>
        </label>
      )}

      <label className={styles.field}>
        <FrameBox className={styles.inputBox}>
          <textarea
            rows={4}
            maxLength={max}
            value={shown}
            readOnly={busy}
            aria-busy={busy}
            aria-label={label}
            placeholder={hint}
            onChange={(event) => {
              setPrevious(null);
              onChange({ [block]: event.target.value });
            }}
          />
        </FrameBox>
      </label>

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
