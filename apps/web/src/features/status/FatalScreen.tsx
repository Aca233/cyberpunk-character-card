import styles from "./status.module.css";

/** 素材索引都读不到时用：这时不能用任何原作素材，只写清原因和怎么修 */
export function FatalScreen({
  title,
  message,
}: {
  readonly title: string;
  readonly message: string;
}) {
  return (
    <main className={styles.fatal}>
      <h1>{title}</h1>
      <p>{message}</p>
    </main>
  );
}
