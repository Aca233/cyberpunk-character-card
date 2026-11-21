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
 * 自己写一块模块：先写设定，交给辅助模型解读（花一次模型调用），也可以不用模型直接手写；
 * 解读结果可以改名字与说明，确认后才插上
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
  const label = BOARD_SLOT_LABELS[slot];
  const patch = (next: Partial<BoardModule>) => setDraft((d) => (d ? { ...d, ...next } : d));
  const valid = draft !== null && BoardModuleSchema.safeParse(draft).success;

  return (
    <div className={styles.customForm}>
      <CellFrame />
      <label className={styles.field}>
        <span>
          自定义{label}
          <small>{text.length} / 600</small>
        </span>
        <FrameBox className={styles.inputBox}>
          <textarea
            rows={3}
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
          primary
          disabled={interpret.isPending || text.trim().length < 4}
          reason="请先输入至少 4 个字的设定再让 AI 解析"
          onClick={() => interpret.mutate()}
        >
          {interpret.isPending ? "解析中…" : draft ? "重新解析" : "AI 解析模块"}
        </Button>
        {!draft && (
          <ActionButton
            title="跳过 AI 解析，直接手动填写模块名与效果"
            onClick={() =>
              setDraft({ ...blankModule(slot), label: text.trim().slice(0, 24) || "未命名" })
            }
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
            <span>模块名</span>
            <FrameBox className={styles.compactBox}>
              <input
                maxLength={24}
                value={draft.label}
                onChange={(event) => patch({ label: event.target.value })}
              />
            </FrameBox>
          </label>
          <label className={styles.field}>
            <span>{slot === "flaw" ? "负面影响说明" : "能力 / 经验说明"}</span>
            <FrameBox className={styles.inputBox}>
              <textarea
                rows={3}
                maxLength={200}
                value={draft.ability}
                onChange={(event) => patch({ ability: event.target.value })}
              />
            </FrameBox>
          </label>
          <div className={styles.slotTools}>
            <Button
              small
              primary
              disabled={!valid}
              reason="请确保模块名已填写且内容合规"
              onClick={() => {
                const mod: BoardModule = {
                  ...draft,
                  label: draft.label.trim(),
                  hook: "",
                  people: [],
                  custom: true,
                  packId: draft.packId ?? "local",
                };
                saveLocalCustomModule(mod);
                onAccept(mod);
              }}
            >
              加入角色并存入创意库
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
