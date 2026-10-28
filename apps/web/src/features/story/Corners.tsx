import type { CSSProperties, ReactNode } from "react";
import type { AssetId } from "../../assets";
import { ActionButton } from "../../ui/ActionButton";
import { Asset, NineSlice } from "../../ui/Asset";
import { Bar } from "../../ui/Bar";
import { Panel } from "../../ui/Panel";
import styles from "./corners.module.css";
import { QuickhackWheel } from "./QuickhackWheel";
import story from "./story.module.css";
import { districtIcon, locationLabel, type View } from "./view";

/**
 * U1 四角（2077-interface-plan.md 第九节）：A 生物监测左上、S 在场的人左中、G 未读左下、
 * B 地点右上、C 追踪右中、H 武器和快速破解右下，横幅在中列顶上。
 * 素材和切法照 U0 视觉稿 NeuralMock，不用 CSS 画边框；U0 把 G 放在地点下面，这里照计划放左下
 */

/** 九宫格切法照正式页面里同一张素材的用法 */
const CELL_SLICE = [20, 30, 30, 20] as const; // MapPanel 筛选格 map.filterCell*
const TOOLTIP_SLICE = [10, 30, 70, 10] as const; // MapPanel 地图提示 map.tooltip*
const PANEL_SLICE = [20, 20, 30, 30] as const; // MapPanel 侧板 map.panel*
const SLOT_SLICE = [20, 38, 50, 38] as const; // 原 Hud 武器格 hud.slot*

const WOUND_LABELS = { none: "", light: "轻伤", severe: "重伤", zero: "失去意识" } as const;
/** 左中最多列几个人，再多的进人物页 */
const PRESENT_MAX = 8;
/** 追踪最多几条 */
const TRACK_MAX = 3;

/** A 生物监测：神经界面层。等级框、血条、RAM 写法同原 Hud；U1 临时在这里打开旧角色栏 */
export function BioMonitor({
  view,
  onSheet,
}: {
  readonly view: View;
  readonly onSheet: () => void;
}) {
  const { health, character, hacking } = view;
  const low = health.wound === "severe" || health.wound === "zero";
  const wound = WOUND_LABELS[health.wound];
  return (
    <div className={`${styles.block} ${styles.bio}`} data-layer="os" data-low={low || undefined}>
      <Panel as="section" title="生物监测" line="var(--cp-red)">
        <div className={styles.bioRow}>
          <span className={styles.level} title="街头声望">
            <Asset id="hud.levelFrame" tint="var(--cp-red)" height={44} />
            <b>{character.streetCred}</b>
          </span>
          <div className={styles.hp}>
            <Bar
              id="hud.healthbar"
              value={health.hp}
              max={health.max}
              color={low ? "var(--cp-hp-low)" : "var(--cp-hp)"}
              width={280}
              label={`生命 ${health.hp}/${health.max}`}
            />
            <span className={styles.hpText} data-low={low || undefined}>
              HP {health.hp}/{health.max}
              {wound && ` · ${wound}`}
              {health.condition !== "up" && ` · ${health.conditionLabel}`}
            </span>
          </div>
          <ActionButton onClick={onSheet}>角色</ActionButton>
        </div>
        {hacking && hacking.ramMax > 0 && (
          <div
            className={styles.ram}
            role="img"
            aria-label={`${hacking.deckName} RAM ${hacking.ram}/${hacking.ramMax}`}
          >
            {Array.from({ length: hacking.ramMax }, (_, i) => (
              <span
                // biome-ignore lint/suspicious/noArrayIndexKey: 格子按位置排，没有别的 id
                key={i}
                className={styles.ramCell}
                data-on={i < hacking.ram || undefined}
                style={{ "--i": i } as CSSProperties}
              >
                <Asset id="hud.ramBar" tint="var(--cp-cyan)" height={14} />
              </span>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

/** S 在场的人：义眼叠加层。每人一格 map.filterCell，按住 Tab 展开扫描卡；高度跟人数走 */
export function Present({ view, scan }: { readonly view: View; readonly scan: boolean }) {
  const people = view.npcs.filter((n) => n.here && n.alive).slice(0, PRESENT_MAX);
  if (people.length === 0) return null;
  return (
    <section
      className={`${styles.block} ${styles.present}`}
      data-layer="optics"
      data-scan={scan || undefined}
      aria-label="在场的人"
    >
      <header className={styles.label}>
        <Asset id="interaction.scan" tint="currentColor" height={18} />
        {scan ? "正在扫描…" : "在场"}
      </header>
      <ul>
        {people.map((p, i) => {
          const s = p.body?.scan ?? null;
          return (
            <li key={p.id} className={styles.person} style={{ "--i": i } as CSSProperties}>
              <NineSlice id="map.filterCellBg" tint="rgb(14 14 23 / 72%)" slice={CELL_SLICE} />
              <NineSlice id="map.filterCellFg" tint="var(--person-line)" slice={CELL_SLICE} />
              <div className={styles.inner}>
                <b>{p.name}</b>
                <small>{p.met ? (p.relation ?? p.role) : "底细不明"}</small>
              </div>
              <span className={styles.scanCard} aria-hidden={!scan}>
                <NineSlice id="map.tooltipBg" tint="rgb(14 14 23 / 88%)" slice={TOOLTIP_SLICE} />
                <NineSlice id="map.tooltipFg" tint="var(--cp-cyan)" slice={TOOLTIP_SLICE} />
                <span className={styles.inner}>
                  {s ? (
                    <>
                      威胁{" "}
                      <em data-threat={s.threat}>
                        {s.threat === "skull" ? "骷髅" : s.threatLabel}
                      </em>
                      {` · ${s.tier}`}
                    </>
                  ) : (
                    "没扫描过"
                  )}
                  {p.met ? " · 认识" : ""}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** G 未读：map.panel 侧板，图标是原作通知图标；都读完了就不显示 */
export function Unread({ view }: { readonly view: View }) {
  const feed = view.phone.feedUnread;
  const items: readonly { readonly label: string; readonly icon: AssetId; readonly n: number }[] = [
    { label: "消息", icon: "notify.attention", n: view.phone.unread },
    { label: "新闻", icon: "notify.journal", n: feed.news.length },
    { label: "警用频段", icon: "map.poi.police", n: feed.police.length },
  ];
  const shown = items.filter((i) => i.n > 0);
  if (shown.length === 0) return null;
  return (
    <section className={`${styles.block} ${styles.unread}`} data-layer="os" aria-label="未读">
      <NineSlice id="map.panelBg" tint="rgb(14 14 23 / 72%)" slice={PANEL_SLICE} />
      <NineSlice id="map.panelFg" tint="var(--cp-red)" slice={PANEL_SLICE} />
      <div className={styles.inner}>
        {shown.map((i) => (
          <span key={i.label}>
            <Asset id={i.icon} tint="var(--cp-red)" height={18} />
            {i.label} <b>{i.n}</b>
          </span>
        ))}
      </div>
    </section>
  );
}

/** B 地点、时间、热度：义眼叠加层，原作 zone_update 的框；悬赏和潜入警戒挂在热度后面 */
export function Zone({ view }: { readonly view: View }) {
  const { heat, stealth } = view;
  const bounty = heat.bounties.reduce((sum, b) => sum + b.reward, 0);
  return (
    <section className={`${styles.block} ${styles.zone}`} data-layer="optics" aria-label="地点">
      <Asset id="hud.zoneFrame" tint="var(--cp-yellow)" height={96} className={styles.zoneFrame} />
      <div className={styles.zoneText}>
        <b>{view.names.location ?? locationLabel(view.location)}</b>
        <span>
          {view.time.text} · {view.time.periodLabel} ·{" "}
          <span title={view.weather.note}>{view.weather.label}</span>
        </span>
        <span
          className={styles.heat}
          title={`警方热度 ${heat.stars} 星${heat.lastSeen ? `，最后一次被看见：${heat.lastSeen}` : ""}`}
        >
          {"★".repeat(heat.stars)}
          <span className={styles.starsEmpty}>{"★".repeat(5 - heat.stars)}</span>
          {bounty > 0 && (
            <small title={heat.bounties.map((b) => b.reasons.join("；")).join("；")}>
              {` 悬赏 ${bounty.toLocaleString("en-US")} 欧元`}
            </small>
          )}
          {stealth.level > 0 && <small data-alert={stealth.level}>{` ◆ ${stealth.label}`}</small>}
        </span>
      </div>
      {/* 原作地区徽章自带颜色，有的没有透明底，不能当蒙版染色 */}
      <Asset id={districtIcon(view.names.district ?? view.location)} height={44} />
    </section>
  );
}

/** C 追踪：待办里最急的几条（超期的先），在超梦里时加一条线索进度；children 是 D 系统通知，紧贴在下面 */
export function Track({ view, children }: { readonly view: View; readonly children?: ReactNode }) {
  const tracked = view.objectives
    .filter((o) => o.status !== "offered")
    .sort((a, b) => Number(b.status === "overdue") - Number(a.status === "overdue"));
  const bd = view.braindance.active;
  const rows = [
    ...(bd
      ? [
          {
            key: "bd",
            icon: "braindance.clue" as AssetId,
            title: `超梦：${bd.title}`,
            note: `关键线索 ${bd.keys.found}/${bd.keys.total}`,
            overdue: false,
          },
        ]
      : []),
    ...tracked.map((o) => ({
      key: o.id,
      icon: "notify.questUpdate" as AssetId,
      title: o.title,
      note: [
        o.sourceLabel,
        o.due === null ? null : o.status === "overdue" ? "已超期" : `${o.due} 前`,
        o.progress,
      ]
        .filter(Boolean)
        .join(" · "),
      overdue: o.status === "overdue",
    })),
  ].slice(0, TRACK_MAX);
  if (rows.length === 0 && !children) return null;
  return (
    <div className={`${styles.block} ${styles.track}`} data-layer="optics">
      {rows.length > 0 && (
        <Panel as="section" title="追踪" line="var(--cp-yellow)">
          <ul className={styles.trackList}>
            {rows.map((r) => (
              <li key={r.key} data-overdue={r.overdue || undefined}>
                <Asset id={r.icon} tint="var(--cp-yellow)" height={22} />
                <span>
                  <b>{r.title}</b>
                  {r.note && <small>{r.note}</small>}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
      {children}
    </div>
  );
}

/** H 武器和快速破解：武器格同原 Hud（hud.slot*），快速破解用现有轮盘 */
export function Weapon({
  view,
  onQuickhack,
}: {
  readonly view: View;
  /** 生成中为 undefined：轮盘不出 */
  readonly onQuickhack?: ((name: string) => void) | undefined;
}) {
  const { inventory, hacking } = view;
  const weaponId = inventory.active === null ? null : (inventory.weapons[inventory.active] ?? null);
  const weapon = weaponId === null ? null : (view.names.items[weaponId] ?? weaponId);
  return (
    <section className={`${styles.block} ${styles.weapon}`} data-layer="os" aria-label="武器">
      {hacking && hacking.programs.length > 0 && onQuickhack && (
        <div className={styles.qhSlot} data-layer="deck">
          <QuickhackWheel
            ram={hacking.ram}
            ramMax={hacking.ramMax}
            programs={hacking.programs}
            onPick={onQuickhack}
          />
        </div>
      )}
      <div className={styles.slot} title={weapon ?? "空手"}>
        <NineSlice id="hud.slotBg" tint="rgb(14 14 23 / 85%)" slice={SLOT_SLICE} />
        <NineSlice id="hud.slotFg" tint="rgb(94 246 255 / 80%)" slice={SLOT_SLICE} />
        <div className={styles.inner}>
          {weapon === null ? (
            <Asset id="weapon.fists" tint="var(--cp-cyan)" height={30} alt="空手" />
          ) : (
            <b>{weapon}</b>
          )}
        </div>
      </div>
    </section>
  );
}

/** 横幅：交战、对峙、潜网、闪回，同时只出一个（交战最先） */
export function Banner({ view }: { readonly view: View }) {
  const { combat, character } = view;
  const dive = view.hacking?.dive ?? null;
  if (combat.active) {
    const a = combat.active;
    return (
      <Panel as="section" line="var(--cp-red)" className={styles.banner}>
        <div className={styles.bannerRow} role="status">
          <Asset id="notify.warning" tint="var(--cp-red)" height={26} />
          <b>交战</b>
          <span className={story.combatTitle}>
            第 {a.moment}/{a.moments} 段
          </span>
          <span className={story.combatResults}>
            {Array.from({ length: a.moments }, (_, i) => (
              <i
                // biome-ignore lint/suspicious/noArrayIndexKey: 第几段就是格子的身份
                key={i}
                data-result={i + 1 < a.moment ? "done" : i + 1 === a.moment ? "now" : "todo"}
              />
            ))}
          </span>
          <small>
            快捷动作 {a.quick}/{a.quickMax}
          </small>
        </div>
        <div className={styles.bannerLines}>
          {a.objective && <span>目标：{a.objective}</span>}
          <span>败局：{a.defeat}</span>
          <span>
            {[
              ...a.enemies.map((e) => `${e.group}×${e.count}`),
              ...a.foes.map((f) =>
                f.scanned || f.state !== "up"
                  ? `${f.name}（${f.stateLabel}）`
                  : `${f.name}（未扫描）`,
              ),
            ].join("、")}
          </span>
          {a.edgeLabel && <span>{a.edgeLabel}</span>}
          {a.dyingMomentsLeft !== null && (
            <span className={story.dying}>濒死：{a.dyingMomentsLeft} 段内要被救回</span>
          )}
        </div>
      </Panel>
    );
  }
  if (combat.standoff) {
    const s = combat.standoff;
    return (
      <Panel as="section" line="var(--cp-yellow)" className={styles.banner}>
        <div className={styles.bannerRow} role="status">
          <Asset id="notify.warning" tint="var(--cp-yellow)" height={26} />
          <b>对峙</b>
          <span>和{s.opponent}</span>
          <small data-out={s.left === 0 || undefined}>
            {s.left > 0 ? `还剩 ${s.left} 轮` : "时间到了，对方要动手"}
          </small>
        </div>
      </Panel>
    );
  }
  if (dive) {
    return (
      <Panel as="section" line="var(--cp-netwatch)" className={styles.banner}>
        <div className={styles.bannerRow} role="status" data-layer="deck">
          <Asset id="interaction.hack" tint="var(--cp-cyan)" height={26} />
          <b>潜网</b>
          <span>
            第 {dive.layer}/{dive.layers} 层 · {dive.label}
          </span>
          <small>
            肉身躺在{dive.chair}，{dive.guard}守着
          </small>
        </div>
      </Panel>
    );
  }
  if (character.flashback) {
    const f = character.flashback;
    return (
      <Panel as="section" line="var(--voice-past)" className={styles.banner}>
        <div className={styles.bannerRow} role="status">
          <b>闪回</b>
          <span>{f.past}</span>
          <small>
            第 {f.turn}/{f.turns} 轮
          </small>
        </div>
      </Panel>
    );
  }
  return null;
}
