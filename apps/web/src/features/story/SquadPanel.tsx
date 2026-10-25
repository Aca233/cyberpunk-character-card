import { useState } from "react";
import { Button } from "../../ui/Button";
import { Panel } from "../../ui/Panel";
import styles from "./story.module.css";
import type { View } from "./view";

export type SquadAction = "accept" | "decline" | "dismiss" | "pay";

/** 小队面板：入队请求（两步确认）、队员卡、发薪和请走 */
export function SquadPanel({
  squad,
  onSquad,
}: {
  readonly squad: View["squad"];
  /** 正在生成时不传，按钮不显示 */
  readonly onSquad?: ((action: SquadAction, npc: string) => void) | undefined;
}) {
  const [confirm, setConfirm] = useState<string | null>(null);
  return (
    <Panel as="div" title={`小队 ${squad.members.length}/${squad.max}`} line="var(--cp-cyan)">
      {squad.offers.map((o) => (
        <div key={o.npc} className={styles.squadOffer}>
          <p>
            <strong>{o.name}</strong> 想入队 · {o.kindLabel} · {o.terms}
          </p>
          <p className={styles.dim}>
            专长：{o.specialty}；个人麻烦：{o.trouble}
          </p>
          {onSquad &&
            (confirm === `accept:${o.npc}` ? (
              <div className={styles.squadActions}>
                <span>
                  {o.kind === "hired"
                    ? `确认入队？先付第一周 ${o.wage.toLocaleString("en-US")} 欧元`
                    : "确认入队？"}
                </span>
                <Button
                  onClick={() => {
                    setConfirm(null);
                    onSquad("accept", o.npc);
                  }}
                >
                  确认
                </Button>
                <Button onClick={() => setConfirm(null)}>再想想</Button>
              </div>
            ) : (
              <div className={styles.squadActions}>
                <Button onClick={() => setConfirm(`accept:${o.npc}`)}>收下</Button>
                <Button onClick={() => onSquad("decline", o.npc)}>回绝</Button>
              </div>
            ))}
        </div>
      ))}
      {squad.members.length === 0 ? (
        <p className={styles.dim}>还没有队员；有人在剧情里答应跟你干时，会在这里等你确认。</p>
      ) : (
        <ul className={styles.npcList}>
          {squad.members.map((m) => (
            <li key={m.npc}>
              <details className={styles.npcCard}>
                <summary>
                  <strong>{m.name}</strong>
                  <span className={styles.npcStatus}>{m.statusLabel}</span>
                  <span className={styles.npcRole}>{m.specialty}</span>
                  <span className={styles.npcAffinity}>
                    好感 {m.affinity > 0 ? "+" : ""}
                    {m.affinity}
                  </span>
                </summary>
                <div className={styles.npcDetail}>
                  <p>
                    {m.kindLabel} · {m.terms} · {m.since} 入队
                  </p>
                  {m.paidUntil && <p>薪水付到 {m.paidUntil}</p>}
                  {m.owed > 0 && (
                    <p className={styles.squadOwed}>
                      欠薪 {m.owed} 周，{m.leavesAt} 前不发就走
                    </p>
                  )}
                  {m.doing && <p>在做：{m.doing}</p>}
                  <p>个人麻烦：{m.trouble}</p>
                  {onSquad && (
                    <div className={styles.squadActions}>
                      {m.canPay && <Button onClick={() => onSquad("pay", m.npc)}>发薪</Button>}
                      {confirm === `dismiss:${m.npc}` ? (
                        <>
                          <Button
                            onClick={() => {
                              setConfirm(null);
                              onSquad("dismiss", m.npc);
                            }}
                          >
                            确认请走
                          </Button>
                          <Button onClick={() => setConfirm(null)}>算了</Button>
                        </>
                      ) : (
                        <Button onClick={() => setConfirm(`dismiss:${m.npc}`)}>请走</Button>
                      )}
                    </div>
                  )}
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}
      {squad.gone.length > 0 && (
        <p className={styles.dim}>
          离开的：{squad.gone.map((g) => `${g.name}（${g.why}，${g.at}）`).join("、")}
        </p>
      )}
    </Panel>
  );
}
