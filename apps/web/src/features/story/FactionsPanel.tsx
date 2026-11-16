import styles from "./story.module.css";
import type { View } from "./view";

type Faction = View["factions"]["list"][number];

const GROUPS: readonly [Faction["kind"], string][] = [
  ["gang", "帮派"],
  ["corp", "公司"],
  ["law", "执法"],
  ["service", "服务"],
];

/** 联系人页的势力栏：按帮派、公司、执法、服务分组；每张卡写态度标签和一句理由、地盘和关系。不调用模型 */
export function FactionsBody({ view }: { readonly view: View }) {
  const here = view.factions.list.filter((f) => f.here);

  return (
    <>
      <p className={`${styles.dim} ${styles.docNote}`}>
        {here.length > 0
          ? `这里（${view.factions.district}）是${here.map((f) => f.name).join("、")}的地盘。`
          : "这里不是哪个帮派的地盘。"}
      </p>
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
                      view.ncpd.alerts.map((a) => (
                        <p key={a.id} className={styles.factionLine}>
                          警情「{a.label}」在{a.locationName}（{a.district}，赏金 {a.reward} 欧元，
                          {a.until} 前）：{a.note}
                        </p>
                      ))}
                    {f.id === "trauma-team" && (
                      <p className={view.trauma.active ? styles.factionReason : styles.factionLine}>
                        {view.trauma.active
                          ? `会籍：${view.trauma.tierLabel}，到 ${view.trauma.until}；${view.trauma.dispatch.ok ? "现在倒下会来" : `现在不会来（${view.trauma.dispatch.why}）`}`
                          : `没有会籍${view.trauma.lapsed ? `（${view.trauma.lapsed} 过期了）` : ""}：银卡 ${view.trauma.prices.silver.toLocaleString("en-US")}、白金卡 ${view.trauma.prices.platinum.toLocaleString("en-US")} 欧元一期 30 天。银卡交火结束后来、只救倒下；白金卡交火中也来、能救濒死；恶土、狗镇不进`}
                        {view.trauma.rescues > 0 && ` · 救过你 ${view.trauma.rescues} 次`}
                      </p>
                    )}
                    {f.id === "ncpd" && view.ncpd.cleared > 0 && (
                      <p className={styles.factionLine}>处理过 {view.ncpd.cleared} 条警情</p>
                    )}
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
                      {f.turf.join("、") !== f.baseTurf.join("、") &&
                        ` · 原来的地盘：${f.baseTurf.length > 0 ? f.baseTurf.join("、") : "没有"}`}
                    </p>
                    {f.news.map((n) => (
                      <p key={`${n.at}-${n.turf}`} className={styles.factionLine}>
                        {n.turf}
                        <span className={styles.dim}>（{n.time}）</span>
                      </p>
                    ))}
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </>
  );
}
