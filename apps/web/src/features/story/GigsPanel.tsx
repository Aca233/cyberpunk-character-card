import { Panel } from "../../ui/Panel";
import styles from "./story.module.css";
import type { View } from "./view";

/** 拳赛和赛车：这里能比的、正在比的、赢过的；报名在输入里说 */
export function GigsPanel({ gigs }: { readonly gigs: View["sidegigs"] }) {
  const here = gigs.list.filter((g) => g.here);
  const beaten = gigs.list.filter((g) => g.beaten);
  if (!gigs.active && here.length === 0 && beaten.length === 0) return null;
  return (
    <Panel as="div" title="拳赛和赛车" line="var(--cp-yellow)">
      {gigs.active && (
        <p className={styles.squadOwed}>
          正在比：{gigs.active.kindLabel}「{gigs.active.name}」 · 对手{gigs.active.opponent}
        </p>
      )}
      {here.length > 0 && (
        <ul className={styles.npcList}>
          {here.map((g) => (
            <li key={g.id}>
              <details className={styles.npcCard}>
                <summary>
                  <strong>{g.name}</strong>
                  <span className={styles.npcStatus}>
                    {g.beaten ? "赢过" : g.rematch ? `${g.rematch} 后再比` : g.kindLabel}
                  </span>
                  <span className={styles.npcRole}>
                    {g.opponent} · {g.tierLabel}
                  </span>
                </summary>
                <div className={styles.npcDetail}>
                  <p>
                    押金 {g.stake.toLocaleString("en-US")} · 奖金 {g.purse.toLocaleString("en-US")}{" "}
                    欧元
                  </p>
                  <p>{g.note}</p>
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}
      {here.length > 0 && !gigs.active && <p className={styles.dim}>想报名就在输入里说。</p>}
      {beaten.length > 0 && (
        <p className={styles.dim}>
          赢过：{beaten.map((g) => `${g.name}（${g.opponent}）`).join("、")}
        </p>
      )}
    </Panel>
  );
}
