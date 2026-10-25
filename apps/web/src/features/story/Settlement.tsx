import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import styles from "./story.module.css";
import type { View } from "./view";

export type SettledJob = View["jobs"]["list"][number];

const GOOD = new Set(["clean", "flawed"]);

function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

/** 委托结束后弹出的结算卡：结局、报酬、声望、中间人好感、人性和一句总评 */
export function SettlementCard({
  job,
  onClose,
}: {
  readonly job: SettledJob;
  readonly onClose: () => void;
}) {
  const s = job.settlement;
  const rows: [string, string, "good" | "bad" | undefined][] = [
    [
      "报酬",
      job.paid === null
        ? "—"
        : `${job.paid.toLocaleString("en-US")} 欧元${job.paid !== job.reward ? `（说好的 ${job.reward.toLocaleString("en-US")}）` : ""}`,
      job.paid !== null && job.paid > 0 ? "good" : undefined,
    ],
  ];
  for (const c of s?.squad ?? []) {
    rows.push([`分给${c.name}`, `−${c.cut.toLocaleString("en-US")} 欧元`, undefined]);
  }
  if (s && s.streetCred > 0) rows.push(["街头声望", `+${s.streetCred} 级`, "good"]);
  if (s?.affinity && job.fixer) {
    const delta = s.affinity.to - s.affinity.from;
    rows.push([
      `${job.fixer}的好感`,
      `${s.affinity.from} → ${s.affinity.to}（${signed(delta)}）`,
      delta > 0 ? "good" : delta < 0 ? "bad" : undefined,
    ]);
  }
  if (s && s.humanity !== null && s.humanity !== 0) {
    rows.push(["人性", signed(s.humanity), s.humanity > 0 ? "good" : "bad"]);
  }
  return (
    <Dialog
      title={`委托${job.statusLabel}：${job.title}`}
      tone={GOOD.has(job.status) ? "info" : "danger"}
      onClose={onClose}
      actions={
        <Button primary onClick={onClose}>
          继续
        </Button>
      }
    >
      <p className={styles.settleMeta}>
        {job.risk} 星 · 雇主 {job.client}
        {job.fixer ? ` · 中间人 ${job.fixer}` : ""}
      </p>
      <dl className={styles.settle}>
        {rows.map(([label, value, tone]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd data-tone={tone}>{value}</dd>
          </div>
        ))}
      </dl>
      {job.summary && <p className={styles.settleSummary}>“{job.summary}”</p>}
    </Dialog>
  );
}
