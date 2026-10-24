import { useEffect, useRef, useState } from "react";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { useNarrativePrefs } from "../settings/prefs";
import styles from "./story.module.css";
import type { View } from "./view";

type Closeup = NonNullable<View["turns"][number]["closeup"]>;

const KIND_LABELS: Readonly<Record<Closeup["kind"], string>> = {
  bigJob: "大单",
  boss: "首领现身",
  iconic: "不朽物品",
};

/** 特写卡：新写下的回合带特写时弹出，和结算卡同一套样式；打开存档时已有的不弹 */
export function CloseupQueue({ turns }: { readonly turns: View["turns"] }) {
  const prefs = useNarrativePrefs();
  const [queue, setQueue] = useState<readonly Closeup[]>([]);
  const seen = useRef<number | null>(null);
  useEffect(() => {
    const last = turns.at(-1)?.seq ?? -1;
    const from = seen.current;
    seen.current = from === null ? last : Math.max(from, last);
    if (from === null || !prefs.closeups) return;
    const fresh = turns.flatMap((t) => (t.seq > from && t.closeup ? [t.closeup] : []));
    if (fresh.length > 0) setQueue((q) => [...q, ...fresh]);
  }, [turns, prefs.closeups]);
  const current = queue[0];
  if (!current) return null;
  const close = () => setQueue((q) => q.slice(1));
  return (
    <Dialog
      title={current.title}
      onClose={close}
      actions={
        <Button primary onClick={close}>
          继续
        </Button>
      }
    >
      <div className={styles.settle} data-kind={current.kind}>
        <p className={styles.closeupKind}>{KIND_LABELS[current.kind]}</p>
        <p className={styles.settleSummary}>{current.detail}</p>
      </div>
    </Dialog>
  );
}
