import { useState } from "react";
import { Button } from "../../ui/Button";
import { useLayer } from "../../ui/layers";
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

/**
 * 数据库页的履历栏：AI 在剧情告一段落时写的总结、委托的结局、死亡和收尾，按时间排；
 * 底部可以给这个角色的故事收尾，收尾后存档只读，角色进传说名册
 */
export function ChronicleBody({
  view,
  onEnd,
}: {
  readonly view: View;
  /** 正在生成、已经死了或已经收尾时是 undefined：只能看 */
  readonly onEnd?: ((how: StoryEnd, epitaph: string | undefined) => Promise<void>) | undefined;
}) {
  const [confirming, setConfirming] = useState(false);
  const [how, setHow] = useState<StoryEnd>("retired");
  const [epitaph, setEpitaph] = useState("");
  const [saving, setSaving] = useState(false);

  // 收尾确认开着时 Esc 先收起它；没开时交给神经界面关闭
  useLayer(() => setConfirming(false), confirming);

  const end = async () => {
    if (!onEnd) return;
    setSaving(true);
    try {
      await onEnd(how, epitaph.trim() || undefined);
      setConfirming(false);
    } catch {
      // 失败原因由提示条说明；确认框留着
    } finally {
      setSaving(false);
    }
  };

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
      {onEnd && !view.ended && (
        <section>
          <h3 className={styles.mapTitle}>结束这个角色的故事</h3>
          {confirming ? (
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
              <div className={styles.habitForm}>
                <input
                  value={epitaph}
                  maxLength={EPITAPH_CHARS}
                  placeholder="留一句话（可以不写）"
                  aria-label="留给名册的一句话"
                  onChange={(e) => setEpitaph(e.target.value)}
                />
              </div>
              <p className={styles.dim}>
                收尾之后不能再继续这份存档，角色会进主菜单的传说名册，之后的新角色开局时 AI
                会知道这个人。
              </p>
              <div className={styles.memoryActions}>
                <Button primary disabled={saving} onClick={() => void end()}>
                  确定收尾
                </Button>
                <Button disabled={saving} onClick={() => setConfirming(false)}>
                  再想想
                </Button>
              </div>
            </div>
          ) : (
            <Button onClick={() => setConfirming(true)}>结束这个角色的故事</Button>
          )}
        </section>
      )}
    </div>
  );
}
