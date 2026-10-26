import { useEffect, useState } from "react";
import { Button } from "../../ui/Button";
import { Panel } from "../../ui/Panel";
import styles from "./story.module.css";
import type { View } from "./view";

type Scene = View["memory"]["scenes"][number];
type Importance = Scene["importance"];

const IMPORTANCE: readonly [Importance, string][] = [
  ["minor", "小事"],
  ["normal", "普通"],
  ["key", "关键"],
];
/** 和核心里摘要标题、正文的长度上限一致 */
const TITLE_CHARS = 24;
const TEXT_CHARS = 200;
/** 共同记忆一条的长度上限，和 npc 的 memory 指令一致 */
const BOND_CHARS = 120;

/** 发给后端的 editMemory 动作（不含 type） */
export interface MemoryEdit {
  readonly what: "scene" | "bond";
  readonly action: "edit" | "remove";
  readonly scene?: number;
  readonly npc?: string;
  readonly index?: number;
  readonly before: string;
  readonly title?: string;
  readonly text?: string;
  readonly importance?: Importance;
}

interface Draft {
  readonly key: string;
  readonly title: string;
  readonly text: string;
  readonly importance: Importance;
}

function DraftForm({
  draft,
  withTitle,
  saving,
  onChange,
  onSave,
  onCancel,
}: {
  readonly draft: Draft;
  readonly withTitle: boolean;
  readonly saving: boolean;
  readonly onChange: (draft: Draft) => void;
  readonly onSave: () => void;
  readonly onCancel: () => void;
}) {
  return (
    <div className={styles.memoryForm}>
      {withTitle && (
        <div className={styles.habitForm}>
          <input
            className={styles.habitInput}
            aria-label="标题"
            value={draft.title}
            maxLength={TITLE_CHARS}
            onChange={(e) => onChange({ ...draft, title: e.target.value })}
          />
          <select
            className={styles.habitInput}
            aria-label="分量"
            value={draft.importance}
            onChange={(e) => onChange({ ...draft, importance: e.target.value as Importance })}
          >
            {IMPORTANCE.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </div>
      )}
      <textarea
        className={styles.memoryText}
        aria-label="内容"
        rows={3}
        value={draft.text}
        maxLength={withTitle ? TEXT_CHARS : BOND_CHARS}
        onChange={(e) => onChange({ ...draft, text: e.target.value })}
      />
      <div className={styles.memoryActions}>
        <Button
          primary
          disabled={saving || draft.text.trim() === "" || (withTitle && draft.title.trim() === "")}
          onClick={onSave}
        >
          保存
        </Button>
        <Button onClick={onCancel}>取消</Button>
      </div>
    </div>
  );
}

/** 记忆面板：看、改、删 AI 记下的场景摘要和共同记忆；每次改动都留修改记录。不调用模型 */
export function MemoryPanel({
  view,
  onEdit,
  onClose,
}: {
  readonly view: View;
  /** 正在生成时是 undefined：只能看 */
  readonly onEdit?: ((edit: MemoryEdit) => Promise<void>) | undefined;
  readonly onClose: () => void;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Esc 先收起正在改的表单或删除确认，再按一次关面板
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (draft || confirming) {
        setDraft(null);
        setConfirming(null);
      } else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, draft, confirming]);

  const run = async (edit: MemoryEdit) => {
    if (!onEdit) return;
    setSaving(true);
    try {
      await onEdit(edit);
      setDraft(null);
      setConfirming(null);
    } catch {
      // 失败原因由提示条说明；表单留着，可以改完再存
    } finally {
      setSaving(false);
    }
  };

  const controls = (key: string, start: () => void, remove: () => void) => {
    if (!onEdit || draft?.key === key) return null;
    return (
      <div className={styles.memoryActions}>
        {confirming === key ? (
          <>
            <span className={styles.dim}>删掉以后 AI 就不记得这条了。</span>
            <Button primary disabled={saving} onClick={remove}>
              删掉
            </Button>
            <Button onClick={() => setConfirming(null)}>留着</Button>
          </>
        ) : (
          <>
            <Button
              disabled={saving}
              onClick={() => {
                setConfirming(null);
                start();
              }}
            >
              改
            </Button>
            <Button
              disabled={saving}
              onClick={() => {
                setDraft(null);
                setConfirming(key);
              }}
            >
              删
            </Button>
          </>
        )}
      </div>
    );
  };

  const scenes = view.memory.scenes;
  const bonds = view.npcs.filter((n) => n.memories.length > 0);
  const edits = view.memory.edits;

  return (
    <div className={styles.journalBackdrop}>
      <div role="dialog" aria-label="记忆" className={styles.journal}>
        <Panel as="div" title="记忆" line="var(--cp-yellow)">
          <div className={styles.docHead}>
            <p className={`${styles.dim} ${styles.docNote}`}>
              AI
              写故事时参考这些：每场的摘要，和你同每个人的共同记忆。记错了可以改、可以删，每次改动都记在最下面。撤销或重新生成一轮时，那一轮写下的记忆会一起撤回。回合日志只读，不在这里改。
            </p>
            <Button onClick={onClose}>关闭</Button>
          </div>
          <div className={styles.docBody}>
            <section>
              <h3 className={styles.mapTitle}>场景摘要</h3>
              {scenes.length === 0 ? (
                <p className={styles.dim}>还没有场景摘要：一场戏结束后 AI 会写一条。</p>
              ) : (
                <ul className={styles.factionList}>
                  {scenes.map((s) => {
                    const key = `s-${s.scene}`;
                    return (
                      <li key={key} className={styles.factionCard}>
                        <div className={styles.factionHead}>
                          <b>
                            第 {s.scene} 场 · {s.title}
                          </b>
                          <span className={styles.dim}>{s.at}</span>
                          <span className={styles.memoryTag} data-importance={s.importance}>
                            {s.importanceLabel}
                          </span>
                          {s.edited && <span className={styles.dim}>改过</span>}
                        </div>
                        {draft?.key === key ? (
                          <DraftForm
                            draft={draft}
                            withTitle
                            saving={saving}
                            onChange={setDraft}
                            onCancel={() => setDraft(null)}
                            onSave={() =>
                              void run({
                                what: "scene",
                                action: "edit",
                                scene: s.scene,
                                before: s.text,
                                title: draft.title.trim(),
                                text: draft.text.trim(),
                                importance: draft.importance,
                              })
                            }
                          />
                        ) : (
                          <p className={styles.factionReason}>{s.text}</p>
                        )}
                        {s.people.length > 0 && (
                          <p className={styles.factionLine}>在场：{s.people.join("、")}</p>
                        )}
                        {controls(
                          key,
                          () =>
                            setDraft({
                              key,
                              title: s.title,
                              text: s.text,
                              importance: s.importance,
                            }),
                          () =>
                            void run({
                              what: "scene",
                              action: "remove",
                              scene: s.scene,
                              before: s.text,
                            }),
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
            <section>
              <h3 className={styles.mapTitle}>共同记忆</h3>
              {bonds.length === 0 ? (
                <p className={styles.dim}>还没有和谁的共同记忆。</p>
              ) : (
                <ul className={styles.factionList}>
                  {bonds.map((n) => (
                    <li key={n.id} className={styles.factionCard}>
                      <div className={styles.factionHead}>
                        <b>{n.name}</b>
                        {n.alias && <span className={styles.dim}>{n.alias}</span>}
                        {!n.alive && <span className={styles.dim}>已故</span>}
                      </div>
                      <ul className={styles.memoryBonds}>
                        {n.memories.map((m, i) => {
                          const key = `b-${n.id}-${i}`;
                          return (
                            <li key={key}>
                              {draft?.key === key ? (
                                <DraftForm
                                  draft={draft}
                                  withTitle={false}
                                  saving={saving}
                                  onChange={setDraft}
                                  onCancel={() => setDraft(null)}
                                  onSave={() =>
                                    void run({
                                      what: "bond",
                                      action: "edit",
                                      npc: n.id,
                                      index: i,
                                      before: m,
                                      text: draft.text.trim(),
                                    })
                                  }
                                />
                              ) : (
                                <p className={styles.factionLine}>{m}</p>
                              )}
                              {controls(
                                key,
                                () => setDraft({ key, title: "", text: m, importance: "normal" }),
                                () =>
                                  void run({
                                    what: "bond",
                                    action: "remove",
                                    npc: n.id,
                                    index: i,
                                    before: m,
                                  }),
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section>
              <h3 className={styles.mapTitle}>修改记录</h3>
              {edits.length === 0 ? (
                <p className={styles.dim}>还没改过。</p>
              ) : (
                <ul className={styles.factionList}>
                  {edits.map((e) => (
                    <li
                      key={`${e.at}|${e.ref}|${e.action}|${e.before}|${e.after ?? ""}`}
                      className={styles.factionLine}
                    >
                      <span className={styles.dim}>{e.at}</span> {e.what}（{e.ref}）{e.action}：「
                      {e.before}」{e.after !== null && ` → 「${e.after}」`}
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <p className={`${styles.dim} ${styles.docNote}`}>
              章节摘要和状态库还没有做，暂时不能在这里看。
            </p>
          </div>
        </Panel>
      </div>
    </div>
  );
}
