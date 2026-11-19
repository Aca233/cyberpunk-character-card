import { CellFrame } from "../../ui/FrameBox";
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
export function FactionsBody({ view }: { readonly view: View }) {
  const here = view.factions.list.filter((f) => f.here);

  return (
    <>
      <p className={`${styles.dim} ${styles.docNote}`} data-factions-note>
        <span>{view.factions.district ? `当前位置 · ${view.factions.district}` : "当前位置"}</span>
        <b>{here.length > 0 ? here.map((f) => f.name).join("、") : "无帮派控制"}</b>
        <span>{view.factions.list.length} 个组织</span>
      </p>
      <div className={styles.docBody} data-factions>
        {GROUPS.map(([kind, label]) => {
          const list = view.factions.list.filter((f) => f.kind === kind);
          if (list.length === 0) return null;
          return (
            <section key={kind} className={styles.factionGroup}>
              <h3 className={styles.feedSubhead}>
                {label} <span className={styles.dim}>{list.length}</span>
              </h3>
              <ul className={styles.factionList}>
                {list.map((f) => (
                  <li
                    key={f.id}
                    className={styles.feedCard}
                    data-channel="street"
                    data-here={f.here || undefined}
                  >
                    <CellFrame />
                    <header className={styles.feedHead}>
                      <span className={styles.feedSource}>
                        <i
                          className={styles.factionMarker}
                          style={{ backgroundColor: f.color }}
                          aria-hidden="true"
                        />
                        {f.en}
                      </span>
                      <span
                        className={styles.contactBadge}
                        data-tone={
                          f.attitude === "kos" || f.attitude === "hostile"
                            ? "danger"
                            : f.attitude === "friendly" || f.attitude === "family"
                              ? "cyan"
                              : undefined
                        }
                      >
                        {f.attitudeLabel}
                      </span>
                    </header>
                    <b className={styles.feedTitle}>{f.name}</b>
                    {f.reason && (
                      <p className={styles.feedNote}>
                        {f.reason}
                        {f.changedAt && <span className={styles.dim}>（{f.changedAt}）</span>}
                      </p>
                    )}
                    <p className={styles.feedText}>{f.style}</p>
                    {f.id === "ncpd" &&
                      view.ncpd.alerts.map((a) => (
                        <p key={a.id} className={styles.feedNote}>
                          警情「{a.label}」在{a.locationName}（{a.district}，赏金 {a.reward} 欧元，
                          {a.until} 前）：{a.note}
                        </p>
                      ))}
                    {f.id === "trauma-team" && (
                      <p className={styles.feedNote}>
                        {view.trauma.active
                          ? `会籍：${view.trauma.tierLabel}，到 ${view.trauma.until}；${view.trauma.coverage.ok ? "救援保障待命" : `现在不会来（${view.trauma.coverage.why}）`}`
                          : `没有会籍${view.trauma.lapsed ? `（${view.trauma.lapsed} 过期了）` : ""}：银卡 ${view.trauma.prices.silver.toLocaleString("en-US")}、白金卡 ${view.trauma.prices.platinum.toLocaleString("en-US")} 欧元一期 30 天。银卡交火结束后来、只救倒下；白金卡交火中也来、能救濒死；恶土、狗镇不进`}
                        {view.trauma.rescues > 0 && ` · 救过你 ${view.trauma.rescues} 次`}
                      </p>
                    )}
                    {f.id === "ncpd" && view.ncpd.cleared > 0 && (
                      <p className={styles.feedNote}>处理过 {view.ncpd.cleared} 条警情</p>
                    )}
                    {f.id === "ncpd" &&
                      view.heat.bounties.map((b) => (
                        <p key={b.id} className={styles.feedNote}>
                          悬赏 {b.reward.toLocaleString("en-US")} 欧元（{b.since} 起）：
                          {b.reasons.join("；")}
                          {b.hunterName ? ` · 赏金猎人${b.hunterName}在追你` : ""}
                        </p>
                      ))}
                    <p className={styles.feedNote}>
                      {f.turf.length > 0
                        ? `地盘：${f.turf.join("、")}${f.turfNote ? `（${f.turfNote}）` : ""}`
                        : "暂无固定地盘"}
                      {f.allies.length > 0 && ` · 盟友：${f.allies.join("、")}`}
                      {f.enemies.length > 0 && ` · 仇敌：${f.enemies.join("、")}`}
                      {f.turf.join("、") !== f.baseTurf.join("、") &&
                        ` · 原来的地盘：${f.baseTurf.length > 0 ? f.baseTurf.join("、") : "没有"}`}
                    </p>
                    {f.news.map((n) => (
                      <p key={`${n.at}-${n.turf}`} className={styles.feedNote}>
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
