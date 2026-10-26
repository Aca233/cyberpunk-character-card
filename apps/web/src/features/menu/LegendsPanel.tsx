import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api, type Difficulty, type SavedLegend } from "../../api/client";
import { DIFFICULTY_LABELS } from "../../labels";
import { Asset } from "../../ui/Asset";
import { Button } from "../../ui/Button";
import { Panel } from "../../ui/Panel";
import { EmptyState } from "../status/StatusParts";
import styles from "./menu.module.css";

const KIND_LABELS: Readonly<Record<SavedLegend["chronicle"][number]["kind"], string>> = {
  arc: "剧情",
  job: "委托",
  death: "死亡",
  ended: "收尾",
};

function LegendDetail({
  legend,
  onOpen,
}: {
  readonly legend: SavedLegend;
  readonly onOpen: () => void;
}) {
  const difficulty = DIFFICULTY_LABELS[legend.difficulty as Difficulty] ?? legend.difficulty;
  return (
    <section className={styles.legendDetail} aria-label={`${legend.name}的履历`}>
      <header>
        <b>{legend.name}</b>
        <small>
          {legend.cardLabel} · {legend.endingLabel}
        </small>
      </header>
      {legend.brief && <p>{legend.brief}</p>}
      {legend.epitaph && <p className={styles.legendEpitaph}>「{legend.epitaph}」</p>}
      <dl className={styles.legendFacts}>
        <dt>结局</dt>
        <dd>
          {legend.endingLabel} · {legend.when}
        </dd>
        <dt>在夜之城</dt>
        <dd>{legend.days} 天</dd>
        <dt>街头声望</dt>
        <dd>
          {legend.streetCred} 级 · {legend.credTier}
        </dd>
        <dt>做成的委托</dt>
        <dd>{legend.jobsDone} 单</dd>
        <dt>难度</dt>
        <dd>{difficulty}</dd>
      </dl>
      {legend.chronicle.length > 0 && (
        <ul className={styles.legendChronicle}>
          {legend.chronicle.map((e) => (
            <li key={`${e.at}|${e.kind}|${e.title}`}>
              <small>
                {e.time} · {KIND_LABELS[e.kind]}
              </small>{" "}
              <b>{e.title}</b>
              {e.text && <p>{e.text}</p>}
            </li>
          ))}
        </ul>
      )}
      <Button onClick={onOpen}>回看「{legend.title}」</Button>
    </section>
  );
}

/**
 * 传说名册：死在夜之城、或者玩家收了尾的角色，一人一张塔罗牌（原作素材，按最高属性挑牌是本作改编）；
 * 点开看结局、声望和履历片段，可以回看那份存档
 */
export function LegendsPanel({ onOpen }: { readonly onOpen: (saveId: string) => void }) {
  const legends = useQuery({ queryKey: ["legends"], queryFn: api.legends });
  const [picked, setPicked] = useState<string | null>(null);
  const list = legends.data ?? [];
  const chosen = list.find((l) => l.saveId === picked) ?? null;
  return (
    <Panel title="传说名册">
      <p className={styles.legendNote}>
        死在夜之城、或者收了尾的角色都记在这里。新角色开局时，AI
        会知道最近的几位。牌面按角色最高的属性挑。
      </p>
      {legends.isPending && <p className={styles.legendNote}>正在翻名册…</p>}
      {legends.isError && <p className={styles.error}>{legends.error.message}</p>}
      {legends.isSuccess && list.length === 0 && (
        <div className={styles.tarotEmpty}>
          <Asset id="tarot.back" height={180} />
          <EmptyState text="名册还是空的：还没有角色死在夜之城，也没有谁收了尾。" />
        </div>
      )}
      {list.length > 0 && (
        <ul className={styles.tarotGrid}>
          {list.map((l) => (
            <li key={l.saveId}>
              <button
                type="button"
                className={styles.tarotCard}
                aria-pressed={picked === l.saveId}
                onClick={() => setPicked(picked === l.saveId ? null : l.saveId)}
              >
                <Asset id={`tarot.${l.card}`} height={180} alt={l.cardLabel} />
                <b>{l.name}</b>
                <small>{l.endingLabel}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
      {chosen && <LegendDetail legend={chosen} onOpen={() => onOpen(chosen.saveId)} />}
    </Panel>
  );
}
