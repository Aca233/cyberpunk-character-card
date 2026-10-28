import type { CSSProperties, ReactNode } from "react";
import type { AssetId } from "../../assets";
import { ActionButton } from "../../ui/ActionButton";
import { Asset, cssUrl, NineSlice } from "../../ui/Asset";
import { Bar } from "../../ui/Bar";
import { Panel } from "../../ui/Panel";
import styles from "./corners.module.css";
import { Profile } from "./Phone";
import { type Expand, type SetExpand, usePeek } from "./peek";
import { QuickhackWheel } from "./QuickhackWheel";
import story from "./story.module.css";
import { districtIcon, locationLabel, type View } from "./view";

/**
 * 四角（2077-interface-plan.md 第九节）：A 生物监测左上、S 在场的人左中、G 未读左下、
 * B 地点右上、C 追踪右中、H 武器和快速破解右下，横幅在中列顶上。
 * 第十二节：鼠标停在块上就地展开概要，朝屏幕中间展开、盖在中列上，块本身不动；点块钉住或跳到完整内容。
 * 素材和切法照 U0 视觉稿 NeuralMock，不用 CSS 画边框
 */

/** 九宫格切法照正式页面里同一张素材的用法 */
const CELL_SLICE = [20, 30, 30, 20] as const; // MapPanel 筛选格 map.filterCell*
const TOOLTIP_SLICE = [10, 30, 70, 10] as const; // MapPanel 地图提示 map.tooltip*
const PANEL_SLICE = [20, 20, 30, 30] as const; // MapPanel 侧板 map.panel*
const SLOT_SLICE = [20, 38, 50, 38] as const; // 原 Hud 武器格 hud.slot*

const WOUND_LABELS = { none: "", light: "轻伤", severe: "重伤", zero: "失去意识" } as const;
/** 左中最多列几个人，再多的进联系人 */
const PRESENT_MAX = 8;
/** 追踪最多几条；展开后列全部 */
const TRACK_MAX = 3;
/** 未读展开后每个频道列几条 */
const UNREAD_PEEK = 3;

const ATTRS: readonly (readonly [keyof View["character"]["attributes"], string, AssetId])[] = [
  ["body", "肉体", "attr.body"],
  ["reflexes", "反应", "attr.reflexes"],
  ["tech", "技术", "attr.tech"],
  ["intelligence", "智力", "attr.intelligence"],
  ["cool", "镇定", "attr.cool"],
];

/** 每一块都拿到同一份展开状态，同一时间只展开一处 */
export interface PeekState {
  readonly expand: Expand | null;
  readonly setExpand: SetExpand;
}

/** 展开出来的那部分：原作 map.panel 侧板，叠在块自己上面，只占这一侧四角那一列；底色微透，字照常清楚 */
function PeekPanel({
  side,
  align = "top",
  title,
  line,
  children,
}: {
  /** 块在屏幕哪一侧；展开层贴着这一侧 */
  readonly side: "left" | "right";
  /** 底部的块向上长 */
  readonly align?: "top" | "bottom";
  readonly title: string;
  readonly line: string;
  readonly children: ReactNode;
}) {
  return (
    <div
      className={styles.peek}
      data-side={side}
      data-align={align}
      data-peek-panel=""
      style={{ "--accent": line } as CSSProperties}
    >
      <NineSlice id="map.panelBg" tint="rgb(8 8 14 / 92%)" slice={PANEL_SLICE} />
      <NineSlice id="map.panelFg" tint={line} slice={PANEL_SLICE} className={styles.peekFrame} />
      <div className={`${styles.inner} ${styles.peekBody}`}>
        <header className={styles.peekHead}>
          <span>{title}</span>
          <span
            className={styles.peekLine}
            style={{ maskImage: cssUrl("tab.line"), WebkitMaskImage: cssUrl("tab.line") }}
            aria-hidden
          />
        </header>
        {children}
      </div>
    </div>
  );
}

/** A 生物监测：神经界面层。等级框、血条、RAM 写法同原 Hud；展开后是属性、声望、人性、治疗品和已装义体 */
export function BioMonitor({
  view,
  peek,
  onCharacter,
  onCyberware,
}: {
  readonly view: View;
  readonly peek: PeekState;
  /** 打开左边缘抽屉的人物页 */
  readonly onCharacter: () => void;
  /** 打开神经界面的义体页 */
  readonly onCyberware: () => void;
}) {
  const { health, character, hacking, humanity, inventory } = view;
  const low = health.wound === "severe" || health.wound === "zero";
  const wound = WOUND_LABELS[health.wound];
  const p = usePeek("bio", peek.expand, peek.setExpand);
  return (
    // biome-ignore lint/a11y/useSemanticElements: 块里套着面板和按钮，不能整个换成 button
    <div
      className={`${styles.block} ${styles.bio}`}
      data-layer="os"
      data-low={low || undefined}
      data-open={p.open || undefined}
      data-pinned={p.pinned || undefined}
      role="button"
      tabIndex={0}
      aria-expanded={p.open}
      {...p.bind}
    >
      <Panel as="section" title="生物监测" line="var(--cp-red)">
        <div className={styles.bioRow}>
          <span className={styles.level}>
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
      {p.open && (
        <PeekPanel side="left" title={character.name ?? "人物"} line="var(--cp-red)">
          <ul className={styles.peekAttrs}>
            {ATTRS.map(([key, label, icon]) => (
              <li key={key}>
                <Asset id={icon} tint="var(--cp-cyan)" height={18} />
                {label}
                <b>{character.attributes[key] ?? "—"}</b>
              </li>
            ))}
          </ul>
          <dl className={styles.peekFacts}>
            <dt>街头声望</dt>
            <dd>
              {character.streetCred} 级 · {character.credTier}
            </dd>
            <dt>人性</dt>
            <dd>
              {humanity.current}/{humanity.cap} · {humanity.stageLabel}
            </dd>
            {inventory.healing && (
              <>
                <dt>治疗</dt>
                <dd>
                  {view.names.items[inventory.healing.id] ?? inventory.healing.id}{" "}
                  {inventory.healing.charges}/{inventory.healing.max}
                </dd>
              </>
            )}
            {character.attributePoints > 0 && (
              <>
                <dt>属性点</dt>
                <dd data-tone="good">{character.attributePoints}</dd>
              </>
            )}
          </dl>
          {view.cyberware.length > 0 && (
            <ul className={styles.peekChips} aria-label="已装义体">
              {view.cyberware.map((c) => (
                <li key={c.id} data-broken={c.broken || undefined}>
                  <ActionButton onClick={onCyberware}>{c.name}</ActionButton>
                </li>
              ))}
            </ul>
          )}
          <footer className={styles.peekFoot}>
            <ActionButton onClick={onCharacter}>人物</ActionButton>
          </footer>
        </PeekPanel>
      )}
    </div>
  );
}

type Npc = View["npcs"][number];

/** S 里的一个人：鼠标停在名字上，旁边展开人物档案 */
function PresentPerson({
  person,
  index,
  scan,
  peek,
  onContacts,
}: {
  readonly person: Npc;
  readonly index: number;
  readonly scan: boolean;
  readonly peek: PeekState;
  readonly onContacts: () => void;
}) {
  const s = person.body?.scan ?? null;
  const p = usePeek(`person:${person.id}`, peek.expand, peek.setExpand);
  // 按住 Tab 扫描时让给扫描卡
  const open = p.open && !scan;
  return (
    // biome-ignore lint/a11y/useSemanticElements: 名字格是列表项，里面套着九宫格和展开面板，不能换成 button
    <li
      className={styles.person}
      style={{ "--i": index } as CSSProperties}
      data-open={open || undefined}
      data-pinned={p.pinned || undefined}
      // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: 名字格本身就是可点的锁定框
      role="button"
      tabIndex={0}
      aria-expanded={open}
      {...p.bind}
    >
      <NineSlice id="map.filterCellBg" tint="rgb(14 14 23 / 72%)" slice={CELL_SLICE} />
      <NineSlice id="map.filterCellFg" tint="var(--person-line)" slice={CELL_SLICE} />
      <div className={styles.inner}>
        <b>{person.name}</b>
        <small>{person.met ? (person.relation ?? person.role) : "底细不明"}</small>
      </div>
      <span className={styles.scanCard} aria-hidden={!scan}>
        <NineSlice id="map.tooltipBg" tint="rgb(14 14 23 / 88%)" slice={TOOLTIP_SLICE} />
        <NineSlice id="map.tooltipFg" tint="var(--cp-cyan)" slice={TOOLTIP_SLICE} />
        <span className={styles.inner}>
          {s ? (
            <>
              威胁 <em data-threat={s.threat}>{s.threat === "skull" ? "骷髅" : s.threatLabel}</em>
              {` · ${s.tier}`}
            </>
          ) : (
            "没扫描过"
          )}
          {person.met ? " · 认识" : ""}
        </span>
      </span>
      {open && (
        <PeekPanel side="left" title={person.name} line="var(--cp-cyan)">
          <div className={styles.peekScroll}>
            <Profile npc={person} />
          </div>
          <footer className={styles.peekFoot}>
            <ActionButton onClick={onContacts}>联系人</ActionButton>
          </footer>
        </PeekPanel>
      )}
    </li>
  );
}

/** S 在场的人：义眼叠加层。每人一格 map.filterCell，按住 Tab 展开扫描卡；高度跟人数走 */
export function Present({
  view,
  scan,
  peek,
  onContacts,
}: {
  readonly view: View;
  readonly scan: boolean;
  readonly peek: PeekState;
  /** 打开左边缘抽屉的联系人页 */
  readonly onContacts: () => void;
}) {
  const people = view.npcs.filter((n) => n.here && n.alive).slice(0, PRESENT_MAX);
  if (people.length === 0) return null;
  const open = people.some((n) => peek.expand?.id === `person:${n.id}`);
  return (
    <section
      className={`${styles.block} ${styles.present}`}
      data-layer="optics"
      data-scan={scan || undefined}
      data-open={open || undefined}
      aria-label="在场的人"
    >
      <header className={styles.label}>
        <Asset id="interaction.scan" tint="currentColor" height={18} />
        {scan ? "正在扫描…" : "在场"}
      </header>
      <ul>
        {people.map((n, i) => (
          <PresentPerson
            key={n.id}
            person={n}
            index={i}
            scan={scan}
            peek={peek}
            onContacts={onContacts}
          />
        ))}
      </ul>
    </section>
  );
}

/** G 未读：map.panel 侧板，图标是原作通知图标；都读完了就不显示。展开后各频道列最新几条，点了去消息 */
export function Unread({
  view,
  peek,
  onMessages,
}: {
  readonly view: View;
  readonly peek: PeekState;
  /** 打开右边缘抽屉的消息页 */
  readonly onMessages: () => void;
}) {
  const p = usePeek("unread", peek.expand, peek.setExpand, onMessages);
  const feed = view.phone.feedUnread;
  const items: readonly { readonly label: string; readonly icon: AssetId; readonly n: number }[] = [
    { label: "消息", icon: "notify.attention", n: view.phone.unread },
    { label: "新闻", icon: "notify.journal", n: feed.news.length },
    { label: "警用频段", icon: "map.poi.police", n: feed.police.length },
  ];
  const shown = items.filter((i) => i.n > 0);
  if (shown.length === 0) return null;
  const latest = (channel: "news" | "police") =>
    view.feed
      .filter((f) => f.channel === channel)
      .sort((a, b) => b.at - a.at)
      .slice(0, UNREAD_PEEK);
  const groups = [
    {
      label: "消息",
      rows: view.phone.messages
        .slice(0, UNREAD_PEEK)
        .map((m) => ({ key: `m${m.id}`, from: m.name, text: m.text, at: m.at, unread: !m.read })),
    },
    ...(["news", "police"] as const).map((c) => ({
      label: c === "news" ? "新闻" : "警用频段",
      rows: latest(c).map((f) => ({
        key: f.id,
        from: f.from,
        text: f.text,
        at: f.time,
        unread: f.unread,
      })),
    })),
  ].filter((g) => g.rows.length > 0);
  return (
    // biome-ignore lint/a11y/useSemanticElements: 块里套着九宫格和展开面板，不能整个换成 button
    <div
      className={`${styles.block} ${styles.unread}`}
      data-layer="os"
      data-open={p.open || undefined}
      aria-label="未读"
      role="button"
      tabIndex={0}
      aria-expanded={p.open}
      {...p.bind}
    >
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
      {p.open && (
        <PeekPanel side="left" align="bottom" title="未读" line="var(--cp-red)">
          {groups.map((g) => (
            <section key={g.label} className={styles.peekGroup}>
              <h4>{g.label}</h4>
              <ul className={styles.peekRows}>
                {g.rows.map((r) => (
                  <li key={r.key} data-unread={r.unread || undefined}>
                    <b>{r.from}</b>
                    <small>{r.at}</small>
                    <p>{r.text}</p>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </PeekPanel>
      )}
    </div>
  );
}

/** B 地点、时间、热度：义眼叠加层，原作 zone_update 的框；展开后是威胁列表，点了打开大地图 */
export function Zone({
  view,
  peek,
  onMap,
}: {
  readonly view: View;
  readonly peek: PeekState;
  readonly onMap: () => void;
}) {
  const { heat, stealth } = view;
  const bounty = heat.bounties.reduce((sum, b) => sum + b.reward, 0);
  const p = usePeek("zone", peek.expand, peek.setExpand, onMap);
  const threats = [...view.threats].sort((a, b) => b.level - a.level);
  return (
    // biome-ignore lint/a11y/useSemanticElements: 块里套着原作框和展开面板，不能整个换成 button
    <div
      className={`${styles.block} ${styles.zone}`}
      data-layer="optics"
      data-open={p.open || undefined}
      aria-label="地点"
      role="button"
      tabIndex={0}
      aria-expanded={p.open}
      {...p.bind}
    >
      <Asset id="hud.zoneFrame" tint="var(--cp-yellow)" height={96} className={styles.zoneFrame} />
      <div className={styles.zoneText}>
        <b>{view.names.location ?? locationLabel(view.location)}</b>
        <span>
          {view.time.text} · {view.time.periodLabel} · <span>{view.weather.label}</span>
        </span>
        <span className={styles.heat}>
          {"★".repeat(heat.stars)}
          <span className={styles.starsEmpty}>{"★".repeat(5 - heat.stars)}</span>
          {bounty > 0 && <small>{` 悬赏 ${bounty.toLocaleString("en-US")} 欧元`}</small>}
          {stealth.level > 0 && <small data-alert={stealth.level}>{` ◆ ${stealth.label}`}</small>}
        </span>
      </div>
      {/* 原作地区徽章自带颜色，有的没有透明底，不能当蒙版染色 */}
      <Asset id={districtIcon(view.names.district ?? view.location)} height={44} />
      {p.open && (
        <PeekPanel side="right" title="威胁" line="var(--cp-cyan)">
          <p className={styles.peekNote}>{view.weather.note}</p>
          {threats.length === 0 ? (
            <p className={styles.peekNote}>没人盯上你。</p>
          ) : (
            <ul className={styles.peekRows}>
              {threats.map((t) => (
                <li key={t.id} data-level={t.level}>
                  <b>{t.who}</b>
                  <small>
                    {t.sourceLabel} · {"★".repeat(t.level)}
                    <span className={styles.starsEmpty}>{"★".repeat(5 - t.level)}</span>
                  </small>
                  <p>{t.reason}</p>
                </li>
              ))}
            </ul>
          )}
        </PeekPanel>
      )}
    </div>
  );
}

/** C 追踪：待办里最急的几条（超期的先），在超梦里时加一条线索进度；children 是 D 系统通知，紧贴在下面。
 * 展开后按期限列全部待办，点了去日志 */
export function Track({
  view,
  peek,
  onJournal,
  children,
}: {
  readonly view: View;
  readonly peek: PeekState;
  /** 打开右边缘抽屉的日志页 */
  readonly onJournal: () => void;
  readonly children?: ReactNode;
}) {
  const p = usePeek("track", peek.expand, peek.setExpand, onJournal);
  const tracked = view.objectives
    .filter((o) => o.status !== "offered")
    .sort((a, b) => Number(b.status === "overdue") - Number(a.status === "overdue"));
  const bd = view.braindance.active;
  const rowOf = (o: View["objectives"][number]) => ({
    key: o.id,
    icon: "notify.questUpdate" as AssetId,
    title: o.title,
    note: [
      o.status === "offered" ? "可接" : o.sourceLabel,
      o.due === null ? null : o.status === "overdue" ? "已超期" : `${o.due} 前`,
      o.progress,
    ]
      .filter(Boolean)
      .join(" · "),
    overdue: o.status === "overdue",
  });
  const bdRow = bd
    ? [
        {
          key: "bd",
          icon: "braindance.clue" as AssetId,
          title: `超梦：${bd.title}`,
          note: `关键线索 ${bd.keys.found}/${bd.keys.total}`,
          overdue: false,
        },
      ]
    : [];
  const rows = [...bdRow, ...tracked.map(rowOf)].slice(0, TRACK_MAX);
  // 展开后：全部待办，超期的在前，其余按离期限的远近，没期限的最后
  const all = [
    ...bdRow,
    ...[...view.objectives]
      .sort((a, b) => (a.dueIn ?? Number.POSITIVE_INFINITY) - (b.dueIn ?? Number.POSITIVE_INFINITY))
      .map(rowOf),
  ];
  if (rows.length === 0 && !children) return null;
  return (
    <div
      className={`${styles.block} ${styles.track}`}
      data-layer="optics"
      data-open={p.open || undefined}
    >
      {rows.length > 0 && (
        // biome-ignore lint/a11y/useSemanticElements: 追踪框里套着面板和展开面板，不能整个换成 button
        <div
          className={styles.trackHit}
          role="button"
          tabIndex={0}
          aria-expanded={p.open}
          {...p.bind}
        >
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
          {p.open && (
            <PeekPanel side="right" title={`待办 ${all.length}`} line="var(--cp-yellow)">
              <ul className={`${styles.trackList} ${styles.peekScroll}`}>
                {all.map((r) => (
                  <li key={r.key} data-overdue={r.overdue || undefined}>
                    <Asset id={r.icon} tint="var(--cp-yellow)" height={20} />
                    <span>
                      <b>{r.title}</b>
                      {r.note && <small>{r.note}</small>}
                    </span>
                  </li>
                ))}
              </ul>
            </PeekPanel>
          )}
        </div>
      )}
      {children}
    </div>
  );
}

/** H 武器和快速破解：武器格同原 Hud（hud.slot*），快速破解用现有轮盘；展开后列三个武器格和快捷位，点了开物品栏 */
export function Weapon({
  view,
  peek,
  onQuickhack,
  onInventory,
}: {
  readonly view: View;
  readonly peek: PeekState;
  /** 生成中为 undefined：轮盘不出 */
  readonly onQuickhack?: ((name: string) => void) | undefined;
  /** 打开神经界面的物品栏 */
  readonly onInventory: () => void;
}) {
  const { inventory, hacking } = view;
  const p = usePeek("weapon", peek.expand, peek.setExpand, onInventory);
  const weaponId = inventory.active === null ? null : (inventory.weapons[inventory.active] ?? null);
  const weapon = weaponId === null ? null : (view.names.items[weaponId] ?? weaponId);
  const nameOf = (id: string) => view.names.items[id] ?? id;
  return (
    // biome-ignore lint/a11y/useSemanticElements: 块里套着快速破解轮盘的按钮，不能整个换成 button
    <div
      className={`${styles.block} ${styles.weapon}`}
      data-layer="os"
      data-open={p.open || undefined}
      aria-label="武器"
      role="button"
      tabIndex={0}
      aria-expanded={p.open}
      {...p.bind}
    >
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
      <div className={styles.slot}>
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
      {p.open && (
        <PeekPanel side="right" align="bottom" title="装备" line="var(--cp-cyan)">
          <ol className={styles.peekSlots}>
            {[0, 1, 2].map((i) => {
              const id = inventory.weapons[i] ?? null;
              return (
                <li key={i} data-active={inventory.active === i || undefined}>
                  <Asset id={`key.${i + 1}` as AssetId} tint="currentColor" height={18} />
                  {id === null ? <span className={styles.peekNote}>空</span> : nameOf(id)}
                </li>
              );
            })}
          </ol>
          <dl className={styles.peekFacts}>
            {inventory.healing && (
              <>
                <dt>治疗</dt>
                <dd>
                  {nameOf(inventory.healing.id)} {inventory.healing.charges}/{inventory.healing.max}
                </dd>
              </>
            )}
            {inventory.grenade && (
              <>
                <dt>手雷</dt>
                <dd>
                  {nameOf(inventory.grenade.id)} {inventory.grenade.charges}/{inventory.grenade.max}
                </dd>
              </>
            )}
            {hacking && hacking.ramMax > 0 && (
              <>
                <dt>RAM</dt>
                <dd>
                  {hacking.ram}/{hacking.ramMax}
                </dd>
              </>
            )}
          </dl>
        </PeekPanel>
      )}
    </div>
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
