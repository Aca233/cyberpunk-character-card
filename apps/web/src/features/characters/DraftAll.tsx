import {
  type CharacterCard,
  type DraftBlock,
  draftAcquaintances,
  draftTargets,
  PROSE_BLOCK_INFO,
  splitDraft,
} from "@cp/core";
import { useEffect, useRef, useState } from "react";
import { ApiError, api } from "../../api/client";
import styles from "./characters.module.css";

/**
 * 一键成稿（第三期，用户定的 2026-10-30："保留逐块重写、续写、润色、锁定，加一键成稿"）：
 * 一次写外貌、背景故事、性格、说话方式里没锁定的几块，顺带补第 3 步空着的旧识"是什么事"。
 * 玩家点了才调模型（花一次模型调用）；边写边显示原文，中途能停，写完能整体撤销一步
 */
export function DraftAll({
  card,
  onChange,
}: {
  readonly card: CharacterCard;
  readonly onChange: (patch: Partial<CharacterCard>) => void;
}) {
  const [streaming, setStreaming] = useState<string | null>(null);
  const [previous, setPrevious] = useState<Partial<CharacterCard> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [instruction, setInstruction] = useState("");
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  const prose = { ...card, board: card.board ?? undefined };
  const targets = draftTargets(prose);
  const needs = draftAcquaintances(prose);
  const nothing = targets.length === 0 && needs.length === 0;
  const noName = card.name.trim() === "";

  const run = async () => {
    const controller = new AbortController();
    abort.current = controller;
    const start = card;
    let text = "";
    setError(null);
    setNote(null);
    setStreaming("");
    /** 拆开写进没锁定的区块、补空着的旧识；返回写进了几块、补了几个人 */
    const apply = () => {
      const result = splitDraft(text, { ...start, board: start.board ?? undefined });
      const blocks = Object.keys(result.blocks) as DraftBlock[];
      const undo: Partial<CharacterCard> = {};
      for (const b of blocks) undo[b] = start[b];
      const filled = Object.keys(result.notes).length;
      let board = start.board;
      if (board && filled > 0) {
        undo.board = board;
        board = {
          ...board,
          acquaintances: board.acquaintances.map((a) => {
            const written = result.notes[a.id];
            return a.note === "" && written ? { ...a, note: written } : a;
          }),
        };
      }
      if (blocks.length > 0 || filled > 0) {
        setPrevious(undo);
        onChange({ ...result.blocks, ...(filled > 0 && board ? { board } : {}) });
      }
      return { wrote: blocks.length, filled, cut: result.cut };
    };
    try {
      const result = await api.draftCharacter(
        { card: start, ...(instruction.trim() ? { instruction: instruction.trim() } : {}) },
        (piece) => {
          text += piece;
          setStreaming(text);
        },
        controller.signal,
      );
      const { wrote, filled, cut } = apply();
      if (wrote === 0 && filled === 0) {
        setError("模型没按格式写，拆不出区块，可以重试");
      } else {
        const parts = [
          wrote > 0 ? `写进了 ${wrote} 块` : "",
          filled > 0 ? `补了 ${filled} 个旧识的事` : "",
          cut.length > 0
            ? `${cut.map((b) => `「${PROSE_BLOCK_INFO[b].label}」`).join("")}超了字数，截短了`
            : "",
          result.truncated ? "模型写超了总字数，最后的截掉了" : "",
        ].filter((p) => p !== "");
        setNote(parts.join("；"));
      }
    } catch (caught) {
      if (controller.signal.aborted) {
        const { wrote, filled } = apply();
        setNote(
          wrote > 0 || filled > 0
            ? "已停止，保留了写出来的部分（最后一块可能没写完）"
            : "已停止，还没写出完整的区块",
        );
      } else {
        setError(caught instanceof ApiError ? caught.message : "成稿时出错了，可以重试");
      }
    } finally {
      abort.current = null;
      setStreaming(null);
    }
  };

  const busy = streaming !== null;
  const scope = [
    ...targets.map((b) => `「${PROSE_BLOCK_INFO[b].label}」`),
    needs.length > 0 ? `${needs.length} 个旧识的事` : "",
  ]
    .filter((p) => p !== "")
    .join("、");

  return (
    <div className={styles.prose}>
      {/* 说明缩成一句（用户 2026-10-31："解释性说明一大堆"） */}
      <p className={styles.note}>一键写：{scope || "没有能写的"}</p>
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
          <button
            type="button"
            className={styles.toolButton}
            disabled={noName || nothing}
            title={
              noName
                ? "先给角色起个名字"
                : nothing
                  ? "四块都锁定了，旧识也都写了"
                  : "交给辅助模型写；会花一次模型调用"
            }
            onClick={() => void run()}
          >
            一键成稿
          </button>
        )}
        <button
          type="button"
          className={styles.toolButton}
          aria-pressed={asking}
          disabled={busy}
          onClick={() => setAsking((a) => !a)}
        >
          要求
        </button>
        {previous !== null && !busy && (
          <button
            type="button"
            className={styles.toolButton}
            onClick={() => {
              onChange(previous);
              setPrevious(null);
              setNote(null);
            }}
          >
            撤销成稿
          </button>
        )}
      </div>
      {asking && (
        <label className={styles.field}>
          <span>
            给模型的要求
            <small>{instruction.length} / 200</small>
          </span>
          <input
            maxLength={200}
            value={instruction}
            placeholder="例如：整体冷一点；背景故事少写打斗"
            onChange={(event) => setInstruction(event.target.value)}
          />
        </label>
      )}
      {busy && (
        <label className={styles.field}>
          <span>
            正在写
            <small>{streaming.length} 字</small>
          </span>
          <textarea rows={8} readOnly aria-busy value={streaming} />
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
