import { useEffect, useState } from "react";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { Panel } from "../../ui/Panel";
import styles from "./story.module.css";
import type { View } from "./view";

type Job = View["jobs"]["list"][number];
type Tab = "active" | "board" | "closed";

const TABS: readonly (readonly [Tab, string])[] = [
  ["active", "进行中"],
  ["board", "委托板"],
  ["closed", "已结束"],
];

/** 期限倒计时：还剩几小时几分，过了就是已超期 */
export function countdown(minutes: number): string {
  if (minutes <= 0) return "已超期";
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days > 0) return `还剩 ${days} 天 ${hours} 小时`;
  if (hours > 0) return `还剩 ${hours} 小时 ${mins} 分`;
  return `还剩 ${mins} 分`;
}

function tabOf(job: Job): Tab {
  if (job.status === "offered") return "board";
  return job.open ? "active" : "closed";
}

/** 按中间人分组；没有中间人的放在最后 */
function groupByFixer(jobs: readonly Job[]): [string, Job[]][] {
  const groups = new Map<string, Job[]>();
  for (const job of jobs) {
    const key = job.fixer ?? "熟人和其他";
    groups.set(key, [...(groups.get(key) ?? []), job]);
  }
  return [...groups].sort(([a], [b]) => (a === "熟人和其他" ? 1 : b === "熟人和其他" ? -1 : 0));
}

/** 日志：左边按类别和中间人分组，右边是选中委托的详情；委托板是单独一栏，接单先确认 */
export function Journal({
  view,
  initialTab,
  onAccept,
  onClose,
}: {
  readonly view: View;
  readonly initialTab: Tab;
  /** 接下一单；正在生成时不传，按钮不能点 */
  readonly onAccept?: ((id: string) => Promise<void>) | undefined;
  readonly onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const jobs = view.jobs.list.filter((j) => tabOf(j) === tab);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = jobs.find((j) => j.id === selectedId) ?? jobs[0] ?? null;
  const [confirming, setConfirming] = useState<Job | null>(null);
  const [accepting, setAccepting] = useState(false);

  // 确认框开着时 Esc 只关确认框
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !confirming) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirming, onClose]);

  const counts = Object.fromEntries(
    TABS.map(([t]) => [t, view.jobs.list.filter((j) => tabOf(j) === t).length]),
  ) as Record<Tab, number>;
  const fixer = (name: string | null) => view.jobs.fixers.find((f) => f.name === name) ?? null;

  const accept = async (job: Job) => {
    if (!onAccept) return;
    setAccepting(true);
    try {
      await onAccept(job.id);
      setConfirming(null);
      setTab("active");
      setSelectedId(job.id);
    } finally {
      setAccepting(false);
    }
  };

  return (
    <div className={styles.journalBackdrop}>
      <div role="dialog" aria-label="日志" className={styles.journal}>
        <Panel as="div" title="日志" line="var(--cp-red)">
          <nav className={styles.journalTabs}>
            {TABS.map(([t, label]) => (
              <button
                key={t}
                type="button"
                data-active={t === tab || undefined}
                onClick={() => {
                  setTab(t);
                  setSelectedId(null);
                }}
              >
                {label}
                <b>{counts[t]}</b>
              </button>
            ))}
            <Button onClick={onClose}>关闭</Button>
          </nav>

          <div className={styles.journalBody}>
            <div className={styles.journalList}>
              {jobs.length === 0 && (
                <p className={styles.dim}>
                  {tab === "board"
                    ? "委托板上眼下没有挂着的单子。中间人会打电话来派活。"
                    : tab === "active"
                      ? "眼下没有接下的委托。"
                      : "还没有结束的委托。"}
                </p>
              )}
              {(tab === "closed" ? [["", jobs] as [string, Job[]]] : groupByFixer(jobs)).map(
                ([group, list]) => (
                  <section key={group}>
                    {group && <h3>{group}</h3>}
                    <ul>
                      {list.map((job) => (
                        <li key={job.id}>
                          <button
                            type="button"
                            data-active={job.id === selected?.id || undefined}
                            data-overdue={job.overdue || undefined}
                            onClick={() => setSelectedId(job.id)}
                          >
                            <strong>{job.title}</strong>
                            <span>
                              {"★".repeat(job.risk)} · {job.reward.toLocaleString("en-US")} 欧元
                              {job.dueIn !== null && job.open && ` · ${countdown(job.dueIn)}`}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                ),
              )}
            </div>

            {selected && (
              <article className={styles.journalDetail}>
                <h3>{selected.title}</h3>
                <p className={styles.journalStars} title={`风险 ${selected.risk} 星`}>
                  {"★".repeat(selected.risk)}
                  <span className={styles.starsEmpty}>{"★".repeat(5 - selected.risk)}</span>
                </p>
                <dl className={styles.settle}>
                  <div>
                    <dt>状态</dt>
                    <dd>{selected.statusLabel}</dd>
                  </div>
                  <div>
                    <dt>雇主</dt>
                    <dd>{selected.client}</dd>
                  </div>
                  {selected.fixer && (
                    <div>
                      <dt>中间人</dt>
                      <dd>
                        {selected.fixer}
                        {fixer(selected.fixer) && `（信任 ${fixer(selected.fixer)?.trust}）`}
                      </dd>
                    </div>
                  )}
                  {selected.location && (
                    <div>
                      <dt>地点</dt>
                      <dd>{selected.location}</dd>
                    </div>
                  )}
                  <div>
                    <dt>报酬</dt>
                    <dd>
                      {selected.paid === null
                        ? `${selected.reward.toLocaleString("en-US")} 欧元`
                        : `到手 ${selected.paid.toLocaleString("en-US")} 欧元`}
                    </dd>
                  </div>
                  {selected.due !== null && (
                    <div>
                      <dt>期限</dt>
                      <dd data-tone={selected.open && selected.overdue ? "bad" : undefined}>
                        {selected.due}
                        {selected.open &&
                          selected.dueIn !== null &&
                          ` · ${countdown(selected.dueIn)}`}
                      </dd>
                    </div>
                  )}
                </dl>
                {selected.notes.length > 0 && (
                  <>
                    <h4>进展</h4>
                    <ol className={styles.journalNotes}>
                      {selected.notes.map((note, i) => (
                        // biome-ignore lint/suspicious/noArrayIndexKey: 笔记只追加，第几条就是身份
                        <li key={i}>{note}</li>
                      ))}
                    </ol>
                  </>
                )}
                {selected.summary && <p className={styles.settleSummary}>“{selected.summary}”</p>}
                {selected.status === "offered" && (
                  <div className={styles.journalActions}>
                    <Button
                      primary
                      disabled={!onAccept}
                      reason="这一轮还在进行，稍后再接"
                      onClick={() => setConfirming(selected)}
                    >
                      接下这单
                    </Button>
                  </div>
                )}
              </article>
            )}
          </div>
        </Panel>
      </div>

      {confirming && (
        <Dialog
          title={`接下委托：${confirming.title}`}
          tone="info"
          onClose={() => setConfirming(null)}
          actions={
            <>
              <Button primary disabled={accepting} onClick={() => void accept(confirming)}>
                接下
              </Button>
              <Button onClick={() => setConfirming(null)}>再想想</Button>
            </>
          }
        >
          <p>
            {confirming.risk} 星 · {confirming.reward.toLocaleString("en-US")} 欧元 · 雇主{" "}
            {confirming.client}
          </p>
          <p>
            {confirming.due === null
              ? "这单没有期限。"
              : `期限 ${confirming.due}。接下后超期没完成，${confirming.fixer ?? "雇主"}会对你失去信任；没接的单子过期不扣。`}
          </p>
        </Dialog>
      )}
    </div>
  );
}
