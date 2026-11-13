import { ActionButton } from "../../ui/ActionButton";
import styles from "./story.module.css";

export type HabitAction = "add" | "confirm" | "dismiss" | "remove";

/** 角色卡上的习惯栏（没有习惯且没有 AI 提议时不占位） */
export function Habits({
  habits,
  offers,
  onHabit,
}: {
  readonly habits: readonly string[];
  /** 叙事模型提议、等玩家确认的习惯 */
  readonly offers: readonly string[];
  /** 改习惯；正在生成时不传，按钮不显示 */
  readonly onHabit?: ((action: HabitAction, text: string) => void) | undefined;
}) {
  if (habits.length === 0 && offers.length === 0) return null;
  return (
    <section className={styles.habits} aria-label="习惯">
      <h4 className={styles.habitsTitle}>习惯</h4>
      <ul className={styles.habitList}>
        {habits.map((h) => (
          <li key={h} className={styles.habitItem}>
            <span className={styles.habitText}>{h}</span>
            {onHabit && (
              <ActionButton
                title="删掉这条习惯"
                label={`删掉习惯：${h}`}
                onClick={() => onHabit("remove", h)}
              >
                ×
              </ActionButton>
            )}
          </li>
        ))}
        {offers.map((h) => (
          <li key={`offer-${h}`} className={styles.habitItem} data-offer="">
            <span className={styles.habitText}>{h}</span>
            <small>AI 提议</small>
            {onHabit && (
              <>
                <ActionButton onClick={() => onHabit("confirm", h)}>记下</ActionButton>
                <ActionButton onClick={() => onHabit("dismiss", h)}>不要</ActionButton>
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
