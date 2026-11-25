import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import styles from "./story.module.css";
import type { View } from "./view";

export type SettledJob = View["jobs"]["list"][number];

const GOOD = new Set(["clean", "flawed"]);

/** 委托结束后弹出的结算卡：结局、报酬、人性和一句总评 */
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
  if (s && s.humanity !== null && s.humanity !== 0) {
    rows.push([
      "神经稳态",
      s.humanity > 0 ? "有所缓和" : "负荷加重",
      s.humanity > 0 ? "good" : "bad",
    ]);
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
        雇主 {job.client}
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

export type EndedNemesis = View["nemesesEnded"][number];

/** 了结宿敌后弹出的结算卡：怎么结下的梁子、怎么了结的 */
export function NemesisSettlementCard({
  nemesis,
  onClose,
}: {
  readonly nemesis: EndedNemesis;
  readonly onClose: () => void;
}) {
  const rows: [string, string, "good" | undefined][] = [
    ["结下梁子", `${nemesis.since} · ${nemesis.how}`, undefined],
    ["了结", `${nemesis.at} · ${nemesis.endLabel}`, undefined],
  ];
  return (
    <Dialog
      title={`宿敌了结：${nemesis.name}`}
      tone="info"
      onClose={onClose}
      actions={
        <Button primary onClick={onClose}>
          继续
        </Button>
      }
    >
      <dl className={styles.settle}>
        {rows.map(([label, value, tone]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd data-tone={tone}>{value}</dd>
          </div>
        ))}
      </dl>
      <p className={styles.settleSummary}>“{nemesis.text}”</p>
    </Dialog>
  );
}
