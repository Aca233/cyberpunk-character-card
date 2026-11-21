import styles from "./thought-block.module.css";

/** 思维链展示块：默认折叠，点击展开查看完整思考过程，避免干扰正文阅读。 */
export function ThoughtBlock({
  thought,
  streaming = false,
}: {
  readonly thought: string;
  /** 正在思考中且尚未输出正文时显示轻量呼吸状态 */
  readonly streaming?: boolean;
}) {
  const trimmed = thought.trim();
  if (trimmed === "") return null;
  const charCount = [...trimmed].length;
  const lines = trimmed
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line !== "");

  return (
    <details className={styles.thought} data-streaming={streaming || undefined}>
      <summary className={styles.summary}>
        <span className={styles.arrow} aria-hidden>
          ▸
        </span>
        <span className={styles.tag}>{streaming ? "NEURAL // 正在思考…" : "NEURAL // 思维链"}</span>
        <span className={styles.meta}>{charCount.toLocaleString()} 字</span>
      </summary>
      <div className={styles.body}>
        {lines.map((line, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: 思考段落按顺序展示，不会重排
          <p key={i} className={styles.line}>
            {line}
          </p>
        ))}
      </div>
    </details>
  );
}
