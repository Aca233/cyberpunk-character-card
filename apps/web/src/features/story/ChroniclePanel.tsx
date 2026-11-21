import { useState } from "react";
import { Button } from "../../ui/Button";
import { FrameBox } from "../../ui/FrameBox";
import { useLayer } from "../../ui/layers";
import { Panel } from "../../ui/Panel";
import styles from "./story.module.css";
import type { View } from "./view";

type Entry = View["chronicle"][number];
export type StoryEnd = "retired" | "ended";

/** 和核心里收尾那句话的长度上限一致 */
const EPITAPH_CHARS = 80;

const KIND_LABELS: Readonly<Record<Entry["kind"], string>> = {
  arc: "剧情",
  job: "委托",
  death: "死亡",
  ended: "收尾",
};

const ENDS: readonly [StoryEnd, string, string][] = [
  ["retired", "退休", "离开这行，活着走出去。"],
  ["ended", "故事停在这里", "不交代去向，就停在现在这一刻。"],
];

/** 生物监测页的履历栏：AI 在剧情告一段落时写的总结、委托的结局、死亡和收尾，按时间排 */
export function ChronicleBody({ view }: { readonly view: View }) {
  const entries = view.chronicle;

  return (
    <div className={styles.docBody}>
      {view.restarts > 0 && (
        <p className={`${styles.dim} ${styles.docNote}`}>重来过 {view.restarts} 个场景。</p>
      )}
      <section>
        {entries.length === 0 ? (
          <p className={styles.dim}>还没有记下什么。</p>
        ) : (
          <ul className={styles.factionList}>
            {entries.map((e) => (
              <li
                key={`${e.at}|${e.kind}|${e.title}`}
                className={styles.factionLine}
                data-kind={e.kind}
              >
                <span className={styles.dim}>
                  {e.time} · {KIND_LABELS[e.kind]}
                </span>{" "}
                <b>{e.title}</b>
                {e.text && <p>{e.text}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>
      {view.ended && (
        <p className={styles.docNote}>
          故事在 {view.ended.at} 收了尾：{view.ended.label}
          {view.ended.epitaph && `——「${view.ended.epitaph}」`}。这份存档只能回看。
        </p>
      )}
    </div>
  );
}

/** 从 Esc 系统菜单打开的收尾弹窗：退休或将故事停在当下，结束后存档只读 */
export function EndStoryModal({
  onEnd,
  onClose,
}: {
  readonly onEnd: (how: StoryEnd, epitaph: string | undefined) => Promise<void>;
  readonly onClose: () => void;
}) {
  const [how, setHow] = useState<StoryEnd>("retired");
  const [epitaph, setEpitaph] = useState("");
  const [saving, setSaving] = useState(false);

  useLayer(onClose);

  const end = async () => {
    setSaving(true);
    try {
      await onEnd(how, epitaph.trim() || undefined);
      onClose();
    } catch {
      // 失败原因由提示条说明；弹窗留着
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.journalBackdrop}>
      <div role="dialog" aria-label="结束故事" className={styles.journal}>
        <Panel as="div" title="结束这个角色的故事" line="var(--cp-red)" frame>
          <div className={styles.memoryForm}>
            {ENDS.map(([id, label, hint]) => (
              <label key={id} className={styles.factionLine}>
                <input
                  type="radio"
                  name="story-end"
                  checked={how === id}
                  onChange={() => setHow(id)}
                />{" "}
                <b>{label}</b> <span className={styles.dim}>{hint}</span>
              </label>
            ))}
            <FrameBox>
              <input
                value={epitaph}
                maxLength={EPITAPH_CHARS}
                placeholder="留一句话（可以不写）"
                aria-label="收尾寄语"
                onChange={(e) => setEpitaph(e.target.value)}
              />
            </FrameBox>
            <p className={styles.dim}>收尾之后不能再继续这份存档，只能留作履历回看。</p>
            <div className={styles.memoryActions}>
              <Button primary disabled={saving} onClick={() => void end()}>
                确定收尾
              </Button>
              <Button disabled={saving} onClick={onClose}>
                再想想
              </Button>
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}
