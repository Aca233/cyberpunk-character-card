import {
  type CharacterCard,
  type DraftBlock,
  draftAcquaintances,
  draftTargets,
  PROSE_BLOCK_INFO,
  type ProseBlock,
  splitDraft,
} from "@cp/core";
import { useEffect, useRef, useState } from "react";
import { ApiError, api } from "../../api/client";
import { ActionButton } from "../../ui/ActionButton";
import { Button } from "../../ui/Button";
import { CellFrame, FrameBox } from "../../ui/FrameBox";
import styles from "./characters.module.css";

const CORE_DRAFT_BLOCKS: readonly DraftBlock[] = ["look", "past", "personality", "voice"];

const TONE_PRESETS: readonly string[] = [
  "冷峻黑色电影风",
  "街头痞气与冷幽默",
  "创伤与宿命感",
  "干练职业佣兵",
  "简练克制少修饰",
];

/**
 * 一键成稿：一次写外貌、背景故事、性格、说话方式里未锁定的区块，顺带补空着的旧识过节。
 * 边写边流式显示原文，中途能停，写完能整体撤销一步；支持一键锁定已填项或点选文风基调。
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

  const filledCoreBlocks = CORE_DRAFT_BLOCKS.filter((b) => card[b].trim() !== "");
  const unlockedFilledBlocks = filledCoreBlocks.filter((b) => !card.locked.includes(b));

  const lockFilled = () => {
    const nextLocked = [...new Set<ProseBlock>([...card.locked, ...filledCoreBlocks])];
    onChange({ locked: nextLocked });
  };

  const unlockAll = () => {
    onChange({ locked: [] });
  };

  const toggleTone = (tone: string) => {
    setAsking(true);
    setInstruction((curr) => {
      if (curr.includes(tone)) {
        return curr
          .replace(tone, "")
          .replace(/[；;、\s]+/g, "；")
          .replace(/^；|；$/g, "");
      }
      return curr.trim() ? `${curr.trim()}；${tone}` : tone;
    });
  };

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
        setError("模型未按格式返回，拆不出区块，请重试");
      } else {
        const parts = [
          wrote > 0 ? `已写入 ${wrote} 个区块` : "",
          filled > 0 ? `补全了 ${filled} 位旧识的过往交集` : "",
          cut.length > 0
            ? `${cut.map((b) => `「${PROSE_BLOCK_INFO[b].label}」`).join("")}超出字数已截断`
            : "",
          result.truncated ? "总字数达上限已截尾" : "",
        ].filter((p) => p !== "");
        setNote(parts.join("；"));
      }
    } catch (caught) {
      if (controller.signal.aborted) {
        const { wrote, filled } = apply();
        setNote(
          wrote > 0 || filled > 0
            ? "已停止，保留了已写出内容（最后一块可能未写完）"
            : "已停止，尚未写出完整区块",
        );
      } else {
        setError(caught instanceof ApiError ? caught.message : "成稿时出错，请重试");
      }
    } finally {
      abort.current = null;
      setStreaming(null);
    }
  };

  const busy = streaming !== null;
  const scope = [
    ...targets.map((b) => `「${PROSE_BLOCK_INFO[b].label}」`),
    needs.length > 0 ? `${needs.length} 位旧识交集` : "",
  ]
    .filter((p) => p !== "")
    .join("、");

  return (
    <div className={styles.draftAllBox}>
      <CellFrame />
      <div className={styles.draftAllHead}>
        <div>
          <strong className={styles.draftAllTitle}>AI 角色小传协同成稿</strong>
          <p className={styles.note}>
            {noName
              ? "请先在「身份与出身」填写角色姓名，再调用 AI 成稿"
              : `待生成范围：${scope || "所有核心区块与旧识交集均已定稿"}`}
          </p>
        </div>
        <div className={styles.slotTools}>
          {busy ? (
            <Button small onClick={() => abort.current?.abort()}>
              停止生成
            </Button>
          ) : (
            <Button
              small
              primary
              disabled={noName || nothing}
              reason={noName ? "请先给角色起个名字" : "生平区块均已锁定，旧识恩怨也已补齐"}
              onClick={() => void run()}
            >
              ✦ 一键生成生平
            </Button>
          )}
          <Button small pressed={asking} disabled={busy} onClick={() => setAsking((a) => !a)}>
            文风与要求
          </Button>
          {unlockedFilledBlocks.length > 0 && !busy && (
            <ActionButton
              title="将目前已填写的区块全部锁定，AI 仅补写空白区块"
              onClick={lockFilled}
            >
              仅补空白项
            </ActionButton>
          )}
          {card.locked.length > 0 && !busy && (
            <ActionButton title="解除所有区块的锁定状态" onClick={unlockAll}>
              全部解锁 ({card.locked.length})
            </ActionButton>
          )}
          {previous !== null && !busy && (
            <ActionButton
              onClick={() => {
                onChange(previous);
                setPrevious(null);
                setNote(null);
              }}
            >
              撤销成稿
            </ActionButton>
          )}
        </div>
      </div>

      {asking && (
        <div className={styles.draftAllAsk}>
          <div className={styles.tonePills}>
            {TONE_PRESETS.map((tone) => (
              <Button
                key={tone}
                small
                pressed={instruction.includes(tone)}
                onClick={() => toggleTone(tone)}
              >
                {tone}
              </Button>
            ))}
          </div>
          <label className={styles.field}>
            <span>
              生成要求 / 补充设定
              <small>{instruction.length} / 200</small>
            </span>
            <FrameBox className={styles.compactBox}>
              <input
                maxLength={200}
                value={instruction}
                placeholder="例如：整体冷一点；背景故事少写打斗；突出在荒坂反情报部的旧伤"
                onChange={(event) => setInstruction(event.target.value)}
              />
            </FrameBox>
          </label>
        </div>
      )}

      {busy && (
        <label className={styles.field}>
          <span>
            正在流式撰写生平…
            <small>{streaming.length} 字</small>
          </span>
          <FrameBox className={styles.inputBox}>
            <textarea rows={7} readOnly aria-busy value={streaming} />
          </FrameBox>
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
