import { characterRules } from "@cp/core";
import { type FormEvent, useState } from "react";
import styles from "./story.module.css";

export type HabitAction = "add" | "confirm" | "dismiss" | "remove";

/** 侧栏：别人眼里的你，和角色卡上的习惯栏 */
export function Habits({
  perceived,
  habits,
  offers,
  onHabit,
}: {
  readonly perceived: string;
  readonly habits: readonly string[];
  /** 主持人提议、等玩家确认的习惯 */
  readonly offers: readonly string[];
  /** 改习惯；正在生成时不传，按钮不显示 */
  readonly onHabit?: ((action: HabitAction, text: string) => void) | undefined;
}) {
  const [draft, setDraft] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (text === "" || !onHabit) return;
    onHabit("add", text);
    setDraft("");
  };
  return (
    <section className={styles.habits} aria-label="别人眼里的你和习惯">
      <p className={styles.perceived} title="别人眼里的你：NPC 的第一反应照这一行写">
        {perceived}
      </p>
      <h4 className={styles.habitsTitle}>习惯</h4>
      {habits.length === 0 && offers.length === 0 && (
        <p className={styles.dim}>还没有习惯。可以自己写，也会在剧情里慢慢形成。</p>
      )}
      <ul className={styles.habitList}>
        {habits.map((h) => (
          <li key={h} className={styles.habitItem}>
            <span className={styles.habitText}>{h}</span>
            {onHabit && (
              <button
                type="button"
                className={styles.habitButton}
                title="删掉这条习惯"
                onClick={() => onHabit("remove", h)}
              >
                ×
              </button>
            )}
          </li>
        ))}
        {offers.map((h) => (
          <li key={`offer-${h}`} className={styles.habitItem} data-offer="">
            <span className={styles.habitText}>{h}</span>
            <small>主持人提议</small>
            {onHabit && (
              <>
                <button
                  type="button"
                  className={styles.habitButton}
                  onClick={() => onHabit("confirm", h)}
                >
                  记下
                </button>
                <button
                  type="button"
                  className={styles.habitButton}
                  onClick={() => onHabit("dismiss", h)}
                >
                  不要
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
      {onHabit && habits.length < characterRules.HABITS_MAX && (
        <form className={styles.habitForm} onSubmit={submit}>
          <input
            className={styles.habitInput}
            value={draft}
            maxLength={40}
            placeholder="常去的店、睡前做什么……"
            aria-label="新习惯"
            onChange={(e) => setDraft(e.target.value)}
          />
          <button type="submit" className={styles.habitButton} disabled={draft.trim() === ""}>
            记下
          </button>
        </form>
      )}
    </section>
  );
}
