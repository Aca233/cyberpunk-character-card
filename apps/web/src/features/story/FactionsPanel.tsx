import { useEffect } from "react";
import { Button } from "../../ui/Button";
import { Panel } from "../../ui/Panel";
import styles from "./story.module.css";
import type { View } from "./view";

type Faction = View["factions"]["list"][number];

const GROUPS: readonly [Faction["kind"], string][] = [
  ["gang", "帮派"],
  ["corp", "公司"],
  ["law", "执法"],
  ["service", "服务"],
];

/** 势力页：按帮派、公司、执法、服务分组；每张卡写态度标签和一句理由、地盘和关系。不调用模型 */
export function FactionsPanel({
  view,
  onClose,
}: {
  readonly view: View;
  readonly onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const here = view.factions.list.filter((f) => f.here);

  return (
    <div className={styles.journalBackdrop}>
      <div role="dialog" aria-label="势力" className={styles.journal}>
        <Panel as="div" title="势力" line="var(--cp-yellow)">
          <div className={styles.docHead}>
            <p className={`${styles.dim} ${styles.docNote}`}>
              {here.length > 0
                ? `这里（${view.factions.district}）是${here.map((f) => f.name).join("、")}的地盘。`
                : "这里不是哪个帮派的地盘。"}
              态度由 AI 按发生的事调整，每次都写了理由。
            </p>
            <Button onClick={onClose}>关闭</Button>
          </div>
          <div className={styles.docBody}>
            {GROUPS.map(([kind, label]) => {
              const list = view.factions.list.filter((f) => f.kind === kind);
              if (list.length === 0) return null;
              return (
                <section key={kind}>
                  <h3 className={styles.mapTitle}>{label}</h3>
                  <ul className={styles.factionList}>
                    {list.map((f) => (
                      <li
                        key={f.id}
                        className={styles.factionCard}
                        style={{ borderLeftColor: f.color }}
                        data-here={f.here || undefined}
                      >
                        <div className={styles.factionHead}>
                          <b>{f.name}</b>
                          <span className={styles.dim}>{f.en}</span>
                          <span className={styles.factionAttitude} data-attitude={f.attitude}>
                            {f.attitudeLabel}
                          </span>
                        </div>
                        {f.reason && (
                          <p className={styles.factionReason}>
                            {f.reason}
                            {f.changedAt && <span className={styles.dim}>（{f.changedAt}）</span>}
                          </p>
                        )}
                        <p className={styles.factionLine}>{f.style}</p>
                        {f.id === "ncpd" &&
                          view.heat.bounties.map((b) => (
                            <p key={b.id} className={styles.factionReason}>
                              悬赏 {b.reward.toLocaleString("en-US")} 欧元（{b.since} 起）：
                              {b.reasons.join("；")}
                              {b.hunterName ? ` · 赏金猎人${b.hunterName}在追你` : ""}
                            </p>
                          ))}
                        <p className={styles.factionLine}>
                          {f.turf.length > 0
                            ? `地盘：${f.turf.join("、")}${f.turfNote ? `（${f.turfNote}）` : ""}`
                            : "没有固定地盘"}
                          {f.allies.length > 0 && ` · 盟友：${f.allies.join("、")}`}
                          {f.enemies.length > 0 && ` · 仇敌：${f.enemies.join("、")}`}
                        </p>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        </Panel>
      </div>
    </div>
  );
}
