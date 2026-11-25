import {
  BOARD_SLOT_LABELS,
  type Board,
  type BoardModule,
  BoardModuleSchema,
  type BoardSlot,
} from "@cp/core";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../../api/client";
import { ActionButton } from "../../ui/ActionButton";
import { Button } from "../../ui/Button";
import { CellFrame, FrameBox } from "../../ui/FrameBox";
import styles from "./characters.module.css";
import { saveLocalCustomModule } from "./creator";

function blankModule(slot: BoardSlot): BoardModule {
  return BoardModuleSchema.parse({
    id: `custom-${Date.now().toString(36)}`,
    slot,
    label: "未命名",
    custom: true,
  });
}

function parseTagsInput(raw: string): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const part of raw.split(/[\s,，、/]+/)) {
    const trimmed = part.trim().slice(0, 12);
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    tags.push(trimmed);
    if (tags.length >= 6) break;
  }
  return tags;
}

function slotPlaceholder(slot: BoardSlot): string {
  if (slot === "origin") {
    return "角色来自哪个阶层、企业部门、帮派或恶土聚落？带着什么看家门路……";
  }
  if (slot === "past") {
    return "入城前亲历过哪段转折事件、险境逃生或特殊活计？练出了什么经验……";
  }
  if (slot === "flaw") {
    return "背着什么债务、旧伤、通缉令或难以摆脱的处境短板……";
  }
  return "这项性格作风或硬实力是怎么练出来的，在实战中有什么用处。";
}

/**
 * 新建或修改一块本地自定义模块：
 * - 新建模式：可先写设定交由 AI 解析，也可以直接手写，确认后加入角色并存入本地创意库。
 * - 编辑模式（传入 initial）：直接展开原模块的名称、说明与标签进行修改，也支持重新 AI 解析并保留原 id 原地更新。
 */
export function CustomModuleForm({
  slot,
  board,
  initial,
  onAccept,
  onCancel,
}: {
  readonly slot: BoardSlot;
  readonly board: Board;
  readonly initial?: BoardModule;
  readonly onAccept: (module: BoardModule) => void;
  readonly onCancel: () => void;
}) {
  const editing = Boolean(initial);
  const [text, setText] = useState(() => initial?.ability ?? "");
  const [draft, setDraft] = useState<BoardModule | null>(() => (initial ? { ...initial } : null));
  const [tagsText, setTagsText] = useState(() => (initial ? initial.tags.join("、") : ""));
  const [warnings, setWarnings] = useState<readonly string[]>([]);
  const interpret = useMutation({
    mutationFn: () => api.interpretModule({ slot, text, board }),
    onSuccess: (reading) => {
      const next: BoardModule = initial
        ? {
            ...reading.module,
            id: initial.id,
            slot: initial.slot,
            custom: true,
            packId: initial.packId ?? "local",
          }
        : reading.module;
      setDraft(next);
      setTagsText(next.tags.join("、"));
      setWarnings(reading.warnings);
    },
  });
  const label = BOARD_SLOT_LABELS[slot];
  const patch = (next: Partial<BoardModule>) => setDraft((d) => (d ? { ...d, ...next } : d));
  const candidate: BoardModule | null = draft
    ? {
        ...draft,
        label: draft.label.trim(),
        tags: parseTagsInput(tagsText),
        ability: draft.ability.trim(),
        hook: draft.hook ?? "",
        people: draft.people ?? [],
        custom: true,
        packId: draft.packId ?? "local",
      }
    : null;
  const valid = candidate !== null && BoardModuleSchema.safeParse(candidate).success;

  return (
    <div className={styles.customForm}>
      <CellFrame />
      <label className={styles.field}>
        <span>
          {editing ? `编辑自创${label}（可选：输入新描述交给 AI 重新解析）` : `自定义${label}`}
          <small>{text.length} / 600</small>
        </span>
        <FrameBox className={styles.inputBox}>
          <textarea
            rows={editing ? 2 : 3}
            maxLength={600}
            value={text}
            placeholder={slotPlaceholder(slot)}
            onChange={(event) => setText(event.target.value)}
          />
        </FrameBox>
      </label>
      <div className={styles.slotTools}>
        <Button
          small
          primary={!editing}
          disabled={interpret.isPending || text.trim().length < 4}
          reason="请先输入至少 4 个字的设定再让 AI 解析"
          onClick={() => interpret.mutate()}
        >
          {interpret.isPending ? "解析中…" : draft ? "AI 重新解析" : "AI 解析模块"}
        </Button>
        {!draft && (
          <ActionButton
            title="跳过 AI 解析，直接手动填写模块名与效果"
            onClick={() => {
              const blank = { ...blankModule(slot), label: text.trim().slice(0, 24) || "未命名" };
              setDraft(blank);
              setTagsText("");
            }}
          >
            直接手写
          </ActionButton>
        )}
        <ActionButton onClick={onCancel}>取消</ActionButton>
      </div>
      {interpret.isError && (
        <p className={styles.error} role="alert">
          {interpret.error.message}
        </p>
      )}
      {warnings.length > 0 && (
        <ul className={styles.warnings}>
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
      {draft && (
        <div className={styles.customDraft}>
          <label className={styles.field}>
            <span>
              模块名
              <small>{draft.label.length} / 24</small>
            </span>
            <FrameBox className={styles.compactBox}>
              <input
                maxLength={24}
                value={draft.label}
                onChange={(event) => patch({ label: event.target.value })}
              />
            </FrameBox>
          </label>
          <label className={styles.field}>
            <span>
              {slot === "flaw" ? "负面影响说明" : "能力 / 经验说明"}
              <small>{draft.ability.length} / 200</small>
            </span>
            <FrameBox className={styles.inputBox}>
              <textarea
                rows={3}
                maxLength={200}
                value={draft.ability}
                onChange={(event) => patch({ ability: event.target.value })}
              />
            </FrameBox>
          </label>
          <label className={styles.field}>
            <span>
              标签（可选，空格或顿号分隔，最多 6 个）
              <small>{parseTagsInput(tagsText).length} / 6</small>
            </span>
            <FrameBox className={styles.compactBox}>
              <input
                maxLength={84}
                value={tagsText}
                placeholder="例如：潜入、黑客、街头"
                onChange={(event) => setTagsText(event.target.value)}
              />
            </FrameBox>
          </label>
          <div className={styles.slotTools}>
            <Button
              small
              primary
              disabled={!valid || !candidate}
              reason="请确保模块名已填写且内容合规"
              onClick={() => {
                if (!candidate) return;
                saveLocalCustomModule(candidate);
                onAccept(candidate);
              }}
            >
              {editing ? "保存修改" : "加入角色并存入创意库"}
            </Button>
            {editing && <ActionButton onClick={onCancel}>放弃修改</ActionButton>}
          </div>
        </div>
      )}
    </div>
  );
}
