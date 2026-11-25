import { useState } from "react";
import type { AssetId } from "../../assets";
import { Asset, cssUrl } from "../../ui/Asset";
import { Button } from "../../ui/Button";
import { countdown } from "./Journal";
import styles from "./tracker.module.css";
import { type TrackItem, trackTelemetry, type View } from "./view";

type TrackFilter = "all" | "bills" | "active" | "offered" | "closed";
type JobView = View["jobs"]["list"][number];

/** 4 小时（240 分钟）内到期视为临期预警 */
const SOON_MINUTES = 240;

const RISK_META: Readonly<Record<number, { readonly label: string }>> = {
  1: { label: "低危" },
  2: { label: "常规" },
  3: { label: "中危" },
  4: { label: "高危" },
  5: { label: "极危" },
};

function clampRisk(risk: number): 1 | 2 | 3 | 4 | 5 {
  if (risk <= 1) return 1;
  if (risk >= 5) return 5;
  return Math.round(risk) as 1 | 2 | 3 | 4 | 5;
}

function isSoon(dueIn: number | null, overdue: boolean): boolean {
  return !overdue && dueIn !== null && dueIn > 0 && dueIn <= SOON_MINUTES;
}

function outcomeTone(status: JobView["status"]): "good" | "warn" | "bad" | "muted" {
  if (status === "clean") return "good";
  if (status === "flawed") return "warn";
  if (status === "failed" || status === "betrayed") return "bad";
  return "muted";
}

function entryIconOf(item: TrackItem): { readonly id: AssetId; readonly tint: string } {
  if (item.status === "overdue") {
    return { id: "notify.warning", tint: "var(--cp-danger)" };
  }
  if (item.source === "ncpd") {
    return { id: "map.poi.police", tint: "#7ca8ff" };
  }
  if (item.source === "arcs") {
    return { id: "notify.journal", tint: "var(--voice-humanity)" };
  }
  if (item.source === "sidegigs") {
    return { id: "notify.streetCred", tint: "var(--cp-yellow)" };
  }
  if (item.source === "deadline") {
    return {
      id: "status.timeCircle",
      tint: isSoon(item.dueIn, false) ? "#ff9c42" : "var(--cp-yellow)",
    };
  }
  return {
    id: item.icon,
    tint: item.status === "offered" ? "var(--cp-cyan)" : "var(--cp-yellow)",
  };
}

function entryToneOf(item: TrackItem): "overdue" | "soon" | "ncpd" | "arc" | "offered" | undefined {
  if (item.status === "overdue") return "overdue";
  if (isSoon(item.dueIn, false)) return "soon";
  if (item.source === "ncpd") return "ncpd";
  if (item.source === "arcs") return "arc";
  if (item.status === "offered") return "offered";
  return undefined;
}

function formatDueText(
  dueLabel: string | null,
  dueIn: number | null,
  overdue: boolean,
): string | null {
  if (!dueLabel) return null;
  if (overdue) return dueLabel;
  if (dueIn !== null && dueIn > 0) return countdown(dueIn);
  return dueLabel;
}

function SectionHead({
  title,
  count,
  tone = "yellow",
}: {
  readonly title: string;
  readonly count: number;
  readonly tone?: "yellow" | "bad" | "cyan" | "muted";
}) {
  return (
    <div className={styles.sectionHead}>
      <span className={styles.sectionDiamond} data-tone={tone} aria-hidden />
      <h3 className={styles.sectionTitle}>{title}</h3>
      <span className={styles.sectionRule} data-tone={tone} aria-hidden />
      <span className={styles.sectionCount}>{String(count).padStart(2, "0")}</span>
    </div>
  );
}

function RiskMeter({ risk }: { readonly risk: number }) {
  const level = clampRisk(risk);
  const label = RISK_META[level]?.label ?? "中危";
  return (
    <span
      className={styles.riskMeter}
      data-level={level}
      title={`评估风险：${level}/5（${label}）`}
    >
      <span className={styles.riskBars} aria-hidden>
        {[1, 2, 3, 4, 5].map((i) => (
          <i key={i} className={styles.riskSeg} data-on={i <= level || undefined} />
        ))}
      </span>
      <span className={styles.riskLabel}>{label}</span>
    </span>
  );
}

function BillCard({
  item,
  eddies,
  atDocHere,
  onPayRent,
  onOpenRipperdoc,
  onLocatePlace,
}: {
  readonly item: TrackItem;
  readonly eddies: number;
  readonly atDocHere: boolean;
  readonly onPayRent?: ((homeId: string) => void) | undefined;
  readonly onOpenRipperdoc?: (() => void) | undefined;
  readonly onLocatePlace?: ((placeId: string) => void) | undefined;
}) {
  const overdue = item.status === "overdue";
  const soon = isSoon(item.dueIn, overdue);
  const canPayRentHere = item.source === "rent" && Boolean(item.homeId) && Boolean(onPayRent);
  const amount = item.amount ?? null;
  const shortfall = amount !== null && amount > eddies ? amount - eddies : 0;
  const dueText = formatDueText(item.dueLabel, item.dueIn, overdue);

  return (
    <li className={styles.card} data-tone={overdue ? "overdue" : soon ? "soon" : undefined}>
      <div className={styles.cardHead}>
        <div className={styles.cardTitleGroup}>
          <Asset
            id={item.icon}
            tint={overdue ? "var(--cp-danger)" : soon ? "#ff9c42" : "var(--cp-yellow)"}
            height={17}
            className={styles.cardIcon}
          />
          <strong className={styles.cardTitle}>{item.title}</strong>
        </div>
        <div className={styles.cardHeadRight}>
          {amount !== null && (
            <span className={styles.rewardTag}>{amount.toLocaleString("en-US")} €</span>
          )}
          {dueText && (
            <time
              className={styles.duePill}
              data-tone={overdue ? "overdue" : soon ? "soon" : undefined}
            >
              {dueText}
            </time>
          )}
        </div>
      </div>

      <div className={styles.metaRow}>
        <span className={styles.pill} data-tone={overdue ? "bad" : "yellow"}>
          {item.sourceLabel}
        </span>
        {item.location && (
          <span className={styles.metaLoc}>
            <Asset id="map.pinDest" tint="var(--cp-cyan)" height={12} />
            <span>{item.location}</span>
          </span>
        )}
        {amount !== null && (
          <span className={styles.pill} data-tone={shortfall > 0 ? "bad" : "good"}>
            {shortfall > 0 ? `还差 ${shortfall.toLocaleString("en-US")} €` : "余额充足"}
          </span>
        )}
        {item.dueLabel && dueText !== item.dueLabel && <span>{item.dueLabel}</span>}
      </div>

      <div className={styles.actions}>
        {canPayRentHere && onPayRent && item.homeId && (
          <Button
            small
            primary
            disabled={shortfall > 0}
            reason={
              shortfall > 0
                ? `随身欧元不足，还差 ${shortfall.toLocaleString("en-US")} €`
                : undefined
            }
            onClick={() => onPayRent(item.homeId as string)}
          >
            {overdue ? "缴租解锁" : "缴纳房租"}
          </Button>
        )}
        {atDocHere && onOpenRipperdoc && (
          <Button small primary onClick={onOpenRipperdoc}>
            打开诊所还款
          </Button>
        )}
        {!atDocHere && item.locationId && onLocatePlace && (
          <Button small onClick={() => onLocatePlace(item.locationId as string)}>
            地图定位
          </Button>
        )}
      </div>
    </li>
  );
}

function JobCard({
  job,
  mode,
  defaultOpen,
  placeId,
  place,
  onLocatePlace,
  onAcceptJob,
  onDraftAction,
}: {
  readonly job: JobView;
  readonly mode: "active" | "offered";
  readonly defaultOpen: boolean;
  readonly placeId: string | null;
  readonly place: string | null;
  readonly onLocatePlace?: ((placeId: string) => void) | undefined;
  readonly onAcceptJob?: ((jobId: string) => void) | undefined;
  readonly onDraftAction?: ((text: string) => void) | undefined;
}) {
  const overdue = job.overdue;
  const soon = isSoon(job.dueIn, overdue);
  const cardTone = overdue ? "overdue" : soon ? "soon" : mode === "offered" ? "offered" : undefined;
  const dueBadge = overdue
    ? "已超期"
    : job.dueIn !== null
      ? countdown(job.dueIn)
      : mode === "offered"
        ? "待接"
        : null;
  const dueTone = overdue ? "overdue" : soon ? "soon" : mode === "offered" ? "offered" : undefined;

  return (
    <details className={styles.gigCard} data-tone={cardTone} open={defaultOpen}>
      <summary className={styles.gigSummary}>
        <div className={styles.gigSummaryLeft}>
          <span className={styles.chevron} aria-hidden>
            ▸
          </span>
          <Asset
            id={
              overdue
                ? "notify.warning"
                : mode === "offered"
                  ? "map.poi.quest"
                  : "notify.questUpdate"
            }
            tint={
              overdue
                ? "var(--cp-danger)"
                : soon
                  ? "#ff9c42"
                  : mode === "offered"
                    ? "var(--cp-cyan)"
                    : "var(--cp-yellow)"
            }
            height={16}
            className={styles.cardIcon}
          />
          <strong className={styles.gigTitle}>{job.title}</strong>
          {job.kindLabel && (
            <span className={styles.pill} data-tone={mode === "offered" ? "cyan" : "yellow"}>
              {job.kindLabel}
            </span>
          )}
        </div>
        <div className={styles.cardHeadRight}>
          {job.reward > 0 && (
            <span className={styles.rewardTag}>{job.reward.toLocaleString("en-US")} €</span>
          )}
          {dueBadge && (
            <span className={styles.duePill} data-tone={dueTone}>
              {dueBadge}
            </span>
          )}
        </div>
      </summary>

      <div className={styles.gigBody}>
        <div className={styles.metaGrid}>
          <div className={styles.metaCell}>
            <span className={styles.metaLabel}>{job.fixer ? "牵线 // 委托方" : "委托方"}</span>
            <span className={styles.metaValue}>
              {job.fixer && <Asset id="map.poi.fixer" tint="var(--cp-yellow)" height={12} />}
              <span>
                {job.fixer ? (
                  <>
                    {job.fixer}
                    <span className={styles.metaValueSub}> · {job.client}</span>
                  </>
                ) : (
                  job.client
                )}
              </span>
            </span>
          </div>

          <div className={styles.metaCell}>
            <span className={styles.metaLabel}>风险评估</span>
            <span className={styles.metaValue}>
              <RiskMeter risk={job.risk} />
            </span>
          </div>

          {place && (
            <div className={styles.metaCell}>
              <span className={styles.metaLabel}>目标地点</span>
              <span className={styles.metaValue}>
                <Asset id="map.pinDest" tint="var(--cp-cyan)" height={12} />
                <span>{place}</span>
              </span>
            </div>
          )}

          {job.due !== null && (
            <div className={place ? styles.metaCell : `${styles.metaCell} ${styles.metaCellFull}`}>
              <span className={styles.metaLabel}>截止期限</span>
              <span className={styles.metaValue}>
                <Asset
                  id="status.timeCircle"
                  tint={overdue ? "var(--cp-danger)" : soon ? "#ff9c42" : "var(--cp-yellow)"}
                  height={12}
                />
                <span>
                  {job.due}
                  {job.dueIn !== null && !overdue && (
                    <span className={styles.metaValueSub}> · {countdown(job.dueIn)}</span>
                  )}
                </span>
              </span>
            </div>
          )}
        </div>

        {job.notes.length > 0 && (
          <div className={styles.notesBox}>
            <div className={styles.notesHead}>
              <span>{"PROGRESS // 进展记录"}</span>
              <span>{job.notes.length} 步</span>
            </div>
            <ol className={styles.timeline}>
              {job.notes.map((note, i) => (
                <li
                  // biome-ignore lint/suspicious/noArrayIndexKey: 进展笔记按序追加
                  key={i}
                  className={styles.timelineItem}
                  data-latest={i === job.notes.length - 1 || undefined}
                >
                  {note}
                </li>
              ))}
            </ol>
          </div>
        )}

        <div className={styles.actions}>
          {mode === "offered" && onAcceptJob && (
            <Button small primary onClick={() => onAcceptJob(job.id)}>
              接下这单
            </Button>
          )}
          {placeId && onLocatePlace && (
            <Button small onClick={() => onLocatePlace(placeId)}>
              地图定位{place ? ` · ${place}` : ""}
            </Button>
          )}
          {mode === "active" && onDraftAction && (
            <Button
              small
              primary
              onClick={() =>
                onDraftAction(`着手推进「${job.title}」${place ? `（${place}）` : ""}：`)
              }
            >
              写入行动
            </Button>
          )}
          {mode === "offered" && onDraftAction && (
            <Button
              small
              onClick={() =>
                onDraftAction(`联系${job.fixer ?? job.client}，细问「${job.title}」的细节和条件：`)
              }
            >
              先谈条件
            </Button>
          )}
        </div>
      </div>
    </details>
  );
}

function TrackEntryCard({
  item,
  onLocatePlace,
  onDraftAction,
}: {
  readonly item: TrackItem;
  readonly onLocatePlace?: ((placeId: string) => void) | undefined;
  readonly onDraftAction?: ((text: string) => void) | undefined;
}) {
  const overdue = item.status === "overdue";
  const soon = isSoon(item.dueIn, overdue);
  const icon = entryIconOf(item);
  const tone = entryToneOf(item);
  const dueText = formatDueText(item.dueLabel, item.dueIn, overdue);
  const sourcePillTone = overdue
    ? "bad"
    : item.source === "ncpd"
      ? "ncpd"
      : item.source === "arcs"
        ? "arc"
        : item.status === "offered"
          ? "cyan"
          : "yellow";

  return (
    <li className={styles.card} data-tone={tone}>
      <div className={styles.cardHead}>
        <div className={styles.cardTitleGroup}>
          <Asset id={icon.id} tint={icon.tint} height={16} className={styles.cardIcon} />
          <strong className={styles.cardTitle}>{item.title}</strong>
        </div>
        {dueText && (
          <div className={styles.cardHeadRight}>
            <time
              className={styles.duePill}
              data-tone={
                overdue
                  ? "overdue"
                  : soon
                    ? "soon"
                    : item.status === "offered"
                      ? "offered"
                      : undefined
              }
            >
              {dueText}
            </time>
          </div>
        )}
      </div>

      <div className={styles.metaRow}>
        <span className={styles.pill} data-tone={sourcePillTone}>
          {item.sourceLabel}
        </span>
        {item.location && !item.progress?.includes(item.location) && (
          <span className={styles.metaLoc}>
            <Asset id="map.pinDest" tint="var(--cp-cyan)" height={12} />
            <span>{item.location}</span>
          </span>
        )}
        {item.dueLabel && dueText !== item.dueLabel && <span>{item.dueLabel}</span>}
      </div>

      {item.progress && <p className={styles.progressText}>{item.progress}</p>}

      {(item.locationId || onDraftAction) && (
        <div className={styles.actions}>
          {item.locationId && onLocatePlace && (
            <Button small onClick={() => onLocatePlace(item.locationId as string)}>
              地图定位
            </Button>
          )}
          {onDraftAction && (
            <Button
              small
              primary={item.status !== "offered"}
              onClick={() =>
                onDraftAction(
                  item.source === "ncpd"
                    ? `赶去查看警情「${item.title}」${item.location ? `（${item.location}）` : ""}`
                    : item.status === "offered"
                      ? `跟进「${item.title}」：`
                      : `处理「${item.title}」：`,
                )
              }
            >
              写入行动
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

function ClosedJobCard({ job }: { readonly job: JobView }) {
  const tone = outcomeTone(job.status);
  const cardTone = tone === "good" ? "good" : tone === "bad" ? "overdue" : "muted";
  const settlement = job.settlement;

  return (
    <li className={styles.card} data-tone={cardTone}>
      <div className={styles.cardHead}>
        <div className={styles.cardTitleGroup}>
          <strong className={styles.cardTitle}>{job.title}</strong>
        </div>
        <div className={styles.cardHeadRight}>
          {job.paid !== null && job.paid > 0 && (
            <span className={styles.rewardTag}>+{job.paid.toLocaleString("en-US")} €</span>
          )}
          <span className={styles.pill} data-tone={tone === "warn" ? "yellow" : tone}>
            {job.statusLabel}
          </span>
        </div>
      </div>

      <div className={styles.metaRow}>
        <span>{job.fixer ? `${job.fixer} · ${job.client}` : job.client}</span>
        {job.kindLabel && <span className={styles.pill}>{job.kindLabel}</span>}
      </div>

      {job.summary && <p className={styles.progressText}>{job.summary}</p>}

      {settlement && settlement.humanity !== null && settlement.humanity !== 0 && (
        <div className={styles.settlementRow}>
          <span className={styles.pill} data-tone={settlement.humanity > 0 ? "cyan" : "bad"}>
            人性 {settlement.humanity > 0 ? `+${settlement.humanity}` : settlement.humanity}
          </span>
        </div>
      )}
    </li>
  );
}

/** 追踪面板（J）：统一展示账务欠款、在办委托、约定/赛事/心事、待决风声与近期结案 */
export function TrackerPanel({
  view,
  onLocatePlace,
  onAcceptJob,
  onPayRent,
  onOpenRipperdoc,
  onOpenMap,
  onDraftAction,
}: {
  readonly view: View;
  readonly onLocatePlace?: ((placeId: string) => void) | undefined;
  readonly onAcceptJob?: ((jobId: string) => void) | undefined;
  readonly onPayRent?: ((homeId: string) => void) | undefined;
  readonly onOpenRipperdoc?: (() => void) | undefined;
  readonly onOpenMap?: (() => void) | undefined;
  readonly onDraftAction?: ((text: string) => void) | undefined;
}) {
  const [filter, setFilter] = useState<TrackFilter>("all");
  const track = trackTelemetry(view);
  const eddies = view.money.eddies;
  const destinations = view.travel?.destinations ?? [];
  const placeNames = new Map(destinations.map((d) => [d.id, d.name]));
  const placeIdOf = (loc: string | null): string | null =>
    loc !== null && placeNames.has(loc) ? loc : null;

  const activeJobs = [...view.jobs.list.filter((j) => j.status === "active")].sort((a, b) => {
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
    if (a.dueIn !== null && b.dueIn !== null) return a.dueIn - b.dueIn;
    if (a.dueIn !== null) return -1;
    if (b.dueIn !== null) return 1;
    return 0;
  });

  const offeredJobs = [...view.jobs.list.filter((j) => j.status === "offered")].sort((a, b) => {
    if (a.dueIn !== null && b.dueIn !== null) return a.dueIn - b.dueIn;
    if (a.dueIn !== null) return -1;
    if (b.dueIn !== null) return 1;
    return 0;
  });

  const closedJobs = [...view.jobs.list.filter((j) => !j.open)].reverse();
  const billItems = track.active.filter((item) => item.kind === "bill");
  const otherActive = track.active.filter((item) => item.source !== "jobs" && item.kind !== "bill");
  const otherOffered = track.offered.filter((item) => item.source !== "jobs");

  const activeBucketCount = activeJobs.length + otherActive.length;
  const offeredBucketCount = offeredJobs.length + otherOffered.length;
  const openTotalCount = billItems.length + activeBucketCount + offeredBucketCount;
  const hasAnythingOpen = openTotalCount > 0;
  const billHasOverdue = billItems.some((item) => item.status === "overdue");
  const activeHasOverdue =
    activeJobs.some((j) => j.overdue) || otherActive.some((item) => item.status === "overdue");

  interface FilterBucket {
    readonly key: TrackFilter;
    readonly label: string;
    readonly count: number;
    readonly tone?: "cyan" | "bad" | "muted" | undefined;
    readonly alert?: boolean | undefined;
  }

  const availableBuckets: FilterBucket[] = [];
  if (billItems.length > 0) {
    availableBuckets.push({
      key: "bills",
      label: "账务",
      count: billItems.length,
      tone: billHasOverdue ? "bad" : undefined,
      alert: billHasOverdue,
    });
  }
  if (activeBucketCount > 0) {
    availableBuckets.push({
      key: "active",
      label: "在办",
      count: activeBucketCount,
      alert: activeHasOverdue,
    });
  }
  if (offeredBucketCount > 0) {
    availableBuckets.push({
      key: "offered",
      label: "待决",
      count: offeredBucketCount,
      tone: "cyan",
    });
  }
  if (closedJobs.length > 0) {
    availableBuckets.push({
      key: "closed",
      label: "结案",
      count: closedJobs.length,
      tone: "muted",
    });
  }

  const showFilterBar = availableBuckets.length >= 2 || (!hasAnythingOpen && closedJobs.length > 0);
  const validFilter =
    filter === "all" || availableBuckets.some((b) => b.key === filter) ? filter : "all";

  const showBills = (validFilter === "all" || validFilter === "bills") && billItems.length > 0;
  const showActiveJobs =
    (validFilter === "all" || validFilter === "active") && activeJobs.length > 0;
  const showOtherActive =
    (validFilter === "all" || validFilter === "active") && otherActive.length > 0;
  const showOffered =
    (validFilter === "all" || validFilter === "offered") &&
    (offeredJobs.length > 0 || otherOffered.length > 0);
  const showClosedFull = validFilter === "closed" && closedJobs.length > 0;
  const showClosedFold = validFilter === "all" && closedJobs.length > 0;

  return (
    <div className={styles.shell}>
      {(showFilterBar || track.overdueCount > 0) && (
        <div className={styles.toolbar}>
          {showFilterBar && (
            <nav className={styles.filters} aria-label="追踪分类筛选">
              <button
                type="button"
                className={styles.filterChip}
                aria-pressed={validFilter === "all"}
                onClick={() => setFilter("all")}
              >
                <span>全部</span>
                <span className={styles.filterCount}>{openTotalCount}</span>
              </button>
              {availableBuckets.map((bucket) => (
                <button
                  key={bucket.key}
                  type="button"
                  className={styles.filterChip}
                  data-tone={bucket.tone}
                  aria-pressed={validFilter === bucket.key}
                  onClick={() => setFilter(bucket.key)}
                >
                  {bucket.alert && <i className={styles.filterAlertDot} aria-hidden />}
                  <span>{bucket.label}</span>
                  <span className={styles.filterCount}>{bucket.count}</span>
                </button>
              ))}
            </nav>
          )}

          {track.overdueCount > 0 && validFilter !== "closed" && (
            <div className={styles.overdueStrip} role="status">
              <Asset id="notify.warning" tint="var(--cp-danger)" height={15} />
              <span>
                <b>{track.overdueCount} 项已超期或锁定</b> · 拖延可能触发违约、涨息或门锁扣押
              </span>
            </div>
          )}
        </div>
      )}

      <div className={styles.scroll}>
        {!hasAnythingOpen && validFilter === "all" && (
          <div className={styles.empty}>
            <span
              className={styles.emptyGrid}
              style={{ backgroundImage: cssUrl("fx.grid") }}
              aria-hidden
            />
            <Asset
              id="notify.journal"
              tint="var(--cp-yellow)"
              height={26}
              className={styles.emptyIcon}
            />
            <span className={styles.emptyCode}>{"TRACKER // STANDBY"}</span>
            <p className={styles.emptyTitle}>眼下没有待办单子、账务或风声</p>
            <p className={styles.emptyDesc}>
              在夜之城四处走动、联系中间人打听活计或翻看街头风声，谈妥与挂上的事项都会自动收录到这里。
            </p>
            {onOpenMap && (
              <div className={styles.emptyActions}>
                <Button small primary onClick={onOpenMap}>
                  打开夜之城地图
                </Button>
              </div>
            )}
          </div>
        )}

        {showBills && (
          <section className={styles.section}>
            <SectionHead
              title="账务与欠款"
              count={billItems.length}
              tone={billHasOverdue ? "bad" : "yellow"}
            />
            <ul className={styles.list}>
              {billItems.map((item) => {
                const atDocHere =
                  item.source === "debt" &&
                  view.ripperdoc !== null &&
                  item.docId !== undefined &&
                  view.ripperdoc.id === item.docId;
                return (
                  <BillCard
                    key={item.id}
                    item={item}
                    eddies={eddies}
                    atDocHere={atDocHere}
                    onPayRent={onPayRent}
                    onOpenRipperdoc={onOpenRipperdoc}
                    onLocatePlace={onLocatePlace}
                  />
                );
              })}
            </ul>
          </section>
        )}

        {showActiveJobs && (
          <section className={styles.section}>
            <SectionHead
              title="手头在办"
              count={activeJobs.length}
              tone={activeJobs.some((j) => j.overdue) ? "bad" : "yellow"}
            />
            <div className={styles.list}>
              {activeJobs.map((job, idx) => {
                const placeId = placeIdOf(job.location);
                const place =
                  job.location === null ? null : (placeNames.get(job.location) ?? job.location);
                return (
                  <JobCard
                    key={job.id}
                    job={job}
                    mode="active"
                    defaultOpen={activeJobs.length <= 3 || idx < 2}
                    placeId={placeId}
                    place={place}
                    onLocatePlace={onLocatePlace}
                    onDraftAction={onDraftAction}
                  />
                );
              })}
            </div>
          </section>
        )}

        {showOtherActive && (
          <section className={styles.section}>
            <SectionHead
              title={activeJobs.length > 0 ? "约定与进行中" : "正在进行"}
              count={otherActive.length}
              tone={otherActive.some((item) => item.status === "overdue") ? "bad" : "yellow"}
            />
            <ul className={styles.list}>
              {otherActive.map((item) => (
                <TrackEntryCard
                  key={item.id}
                  item={item}
                  onLocatePlace={onLocatePlace}
                  onDraftAction={onDraftAction}
                />
              ))}
            </ul>
          </section>
        )}

        {showOffered && (
          <section className={styles.section}>
            <SectionHead
              title="待决风声与委托"
              count={offeredJobs.length + otherOffered.length}
              tone="cyan"
            />
            <div className={styles.list}>
              {offeredJobs.map((job, idx) => {
                const placeId = placeIdOf(job.location);
                const place =
                  job.location === null ? null : (placeNames.get(job.location) ?? job.location);
                return (
                  <JobCard
                    key={job.id}
                    job={job}
                    mode="offered"
                    defaultOpen={
                      offeredJobs.length <= 3 ||
                      (activeBucketCount === 0 && billItems.length === 0 && idx < 2)
                    }
                    placeId={placeId}
                    place={place}
                    onLocatePlace={onLocatePlace}
                    onAcceptJob={onAcceptJob}
                    onDraftAction={onDraftAction}
                  />
                );
              })}
              {otherOffered.length > 0 && (
                <ul className={styles.list}>
                  {otherOffered.map((item) => (
                    <TrackEntryCard
                      key={item.id}
                      item={item}
                      onLocatePlace={onLocatePlace}
                      onDraftAction={onDraftAction}
                    />
                  ))}
                </ul>
              )}
            </div>
          </section>
        )}

        {showClosedFull && (
          <section className={styles.section}>
            <SectionHead title="近期结案档案" count={closedJobs.length} tone="muted" />
            <ul className={styles.list}>
              {closedJobs.map((job) => (
                <ClosedJobCard key={job.id} job={job} />
              ))}
            </ul>
          </section>
        )}

        {showClosedFold && (
          <details className={styles.historyWrap}>
            <summary className={styles.historySummary}>
              <span className={styles.historyChevron} aria-hidden>
                ▸
              </span>
              <span>近期结案档案</span>
              <span className={styles.sectionCount}>
                {String(closedJobs.length).padStart(2, "0")}
              </span>
            </summary>
            <ul className={styles.list}>
              {closedJobs.map((job) => (
                <ClosedJobCard key={job.id} job={job} />
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  );
}
