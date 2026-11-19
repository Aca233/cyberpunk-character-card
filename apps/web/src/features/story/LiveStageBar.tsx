import { useEffect, useState } from "react";
import type { CompletedStage, LiveStage } from "./store";
import styles from "./story.module.css";

function formatElapsed(ms: number): string {
  return `${(Math.max(0, ms) / 1000).toFixed(1)}s`;
}

/** 游戏与设置共用同一份调用阶段和计时，切页不会重置耗时。 */
export function LiveStageBar({
  stage,
  trace,
}: {
  readonly stage: LiveStage | null;
  readonly trace: readonly CompletedStage[];
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!stage) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(timer);
  }, [stage]);

  if (!stage && trace.length === 0) return null;
  const visibleTrace = trace.filter((t) => t.ms >= 150);

  return (
    <div className={styles.liveStage} aria-live="polite">
      {visibleTrace.length > 0 && (
        <div className={styles.liveStageTrace}>
          {visibleTrace.map((item, idx) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: 已完成阶段按推进顺序追加
            <span key={`${item.label}-${idx}`} className={styles.liveStageDone}>
              ✓ {item.label} {formatElapsed(item.ms)}
            </span>
          ))}
        </div>
      )}
      {stage && (
        <div className={styles.liveStageNow}>
          <span className={styles.liveStageDot} aria-hidden />
          <strong className={styles.liveStageLabel}>{stage.label}</strong>
          {stage.model && <code className={styles.liveStageModel}>{stage.model}</code>}
          {stage.detail && <span className={styles.liveStageDetail}>{stage.detail}</span>}
          <span className={styles.liveStageTimer}>{formatElapsed(now - stage.startedAt)}</span>
        </div>
      )}
    </div>
  );
}
