import {
  BOARD_SLOT_LABELS,
  type Board,
  type BoardModule,
  BoardModuleSchema,
  type BoardSlot,
  MODULE_POINTS,
} from "@cp/core";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../../api/client";
import styles from "./characters.module.css";

function blankModule(slot: BoardSlot): BoardModule {
  return BoardModuleSchema.parse({
    id: `custom-${Date.now().toString(36)}`,
    slot,
    label: "未命名",
    points: MODULE_POINTS[slot][0],
    custom: true,
  });
}

/**
 * 自己写一块模块：先写设定，交给辅助模型解读（花一次模型调用），也可以不用模型直接手写；
 * 解读结果可以改名字、标价、能力和钩子，确认后才插上
 */
export function CustomModuleForm({
  slot,
  board,
  onAccept,
  onCancel,
}: {
  readonly slot: BoardSlot;
  readonly board: Board;
  readonly onAccept: (module: BoardModule) => void;
  readonly onCancel: () => void;
}) {
  const [text, setText] = useState("");
  const [draft, setDraft] = useState<BoardModule | null>(null);
  const [warnings, setWarnings] = useState<readonly string[]>([]);
  const interpret = useMutation({
    mutationFn: () => api.interpretModule({ slot, text, board }),
    onSuccess: (reading) => {
      setDraft(reading.module);
      setWarnings(reading.warnings);
    },
  });
  const [min, max] = MODULE_POINTS[slot];
  const label = BOARD_SLOT_LABELS[slot];
  const patch = (next: Partial<BoardModule>) => setDraft((d) => (d ? { ...d, ...next } : d));
  const valid = draft !== null && BoardModuleSchema.safeParse(draft).success;

  return (
    <div className={styles.customForm}>
      <label className={styles.field}>
        <span>
          自己写一块{label}
          <small>{text.length} / 600</small>
        </span>
        <textarea
          rows={3}
          maxLength={600}
          value={text}
          placeholder={
            slot === "flaw"
              ? "欠了谁、得罪了谁、身上落下了什么……"
              : "这段经历或本事是什么，在哪里学的，到什么程度。"
          }
          onChange={(event) => setText(event.target.value)}
        />
      </label>
      <div className={styles.slotTools}>
        <button
          type="button"
          className={styles.toolButton}
          disabled={interpret.isPending || text.trim().length < 4}
          title="交给辅助模型生成标签、能力、钩子和建议标价；会花一次模型调用"
          onClick={() => interpret.mutate()}
        >
          {interpret.isPending ? "解读中…" : draft ? "重新解读" : "交给模型解读"}
        </button>
        {!draft && (
          <button
            type="button"
            className={styles.toolButton}
            onClick={() =>
              setDraft({ ...blankModule(slot), label: text.trim().slice(0, 24) || "未命名" })
            }
          >
            不用模型，直接手写
          </button>
        )}
        <button type="button" className={styles.toolButton} onClick={onCancel}>
          取消
        </button>
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
          <div className={styles.identity}>
            <label className={styles.field}>
              <span>模块名</span>
              <input
                maxLength={24}
                value={draft.label}
                onChange={(event) => patch({ label: event.target.value })}
              />
            </label>
            <label className={styles.field}>
              <span>
                {slot === "flaw" ? "返还点数" : "标价"}
                <small>
                  {min}–{max} 点
                </small>
              </span>
              <input
                type="number"
                min={min}
                max={max}
                value={draft.points}
                onChange={(event) =>
                  patch({ points: Math.min(max, Math.max(min, Number(event.target.value) || min)) })
                }
              />
            </label>
          </div>
          <label className={styles.field}>
            <span>{slot === "flaw" ? "处境" : "能力：能做到什么"}</span>
            <textarea
              rows={2}
              maxLength={200}
              value={draft.ability}
              onChange={(event) => patch({ ability: event.target.value })}
            />
          </label>
          <label className={styles.field}>
            <span>钩子</span>
            <textarea
              rows={2}
              maxLength={200}
              value={draft.hook}
              onChange={(event) => patch({ hook: event.target.value })}
            />
          </label>
          {draft.tags.length > 0 && <p className={styles.moduleTags}>{draft.tags.join(" · ")}</p>}
          {draft.people.length > 0 && (
            <p className={styles.moduleHook}>
              人物：
              {draft.people.map((p) => (p.role ? `${p.name}（${p.role}）` : p.name)).join("、")}
            </p>
          )}
          <div className={styles.slotTools}>
            <button
              type="button"
              className={styles.toolButton}
              disabled={!valid}
              onClick={() => onAccept({ ...draft, label: draft.label.trim() })}
            >
              插上这块{label}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
