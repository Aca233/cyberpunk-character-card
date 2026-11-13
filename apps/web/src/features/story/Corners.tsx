import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { AssetId } from "../../assets";
import { Asset, cssUrl, NineSlice } from "../../ui/Asset";
import { Bar } from "../../ui/Bar";
import { Panel } from "../../ui/Panel";
import { itemArtOf, portraitOf } from "./art";
import styles from "./corners.module.css";
import neural from "./neural.module.css";
import { Profile } from "./Profile";
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
/** 原作 map.shadowSmall 模糊方块（109×109）：四边各留 40 原图像素当软边，中间拉伸 */
const SHADOW_SLICE = 40;

/**
 * 立体感（用户定的，计划第十二节第 9 条）：框后面垫一层原作阴影素材，往右下错开，块像浮在画面上。
 * 不用 CSS 的 box-shadow 或滤镜，位置和错开量见 corners.module.css 的 .shadow
 */
function BlockShadow() {
  return (
    <NineSlice
      id="map.shadowSmall"
      tint="rgb(0 0 0 / 70%)"
      slice={SHADOW_SLICE}
      className={styles.shadow}
    />
  );
}

const WOUND_LABELS = { none: "", light: "轻伤", severe: "重伤", zero: "失去意识" } as const;
/** 左中最多列几个人，再多的进联系人 */
const PRESENT_MAX = 8;
/** 追踪最多几条；展开后列全部 */
const TRACK_MAX = 3;

/** 每一块都拿到同一份展开状态，同一时间只展开一处 */
export interface PeekState {
  readonly expand: Expand | null;
  readonly setExpand: SetExpand;
}

/** 钉住后块里的页签：原作 tab.bg，切法同神经界面 */
export function PinTabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  /** id、名字、角标数 */
  readonly tabs: readonly (readonly [T, string, number])[];
  readonly value: T;
  readonly onChange: (id: T) => void;
}) {
  return (
    <nav className={neural.pinTabs}>
      {tabs.map(([id, name, badge]) => (
        <button
          key={id}
          type="button"
          className={neural.tab}
          aria-pressed={id === value}
          onClick={() => onChange(id)}
        >
          <NineSlice id="tab.bg" tint="currentColor" slice={14} className={neural.tabBg} />
          <span className={neural.inner}>
            {name}
            {badge > 0 && <b className={neural.badge}>{badge}</b>}
          </span>
        </button>
      ))}
    </nav>
  );
}

/**
 * 一侧的三块排成一列（第十二节第 9 条）：一块长高时把同侧别的块推开，不盖住；
 * 别的块缩成一行读数，留在原位
 */
export function CornerSide({
  side,
  children,
}: {
  readonly side: "left" | "right";
  readonly children: ReactNode;
}) {
  return (
    <div className={styles.side} data-side={side}>
      {children}
    </div>
  );
}

/** 长出来的部分最低留这么高，列再矮也不压成一条缝 */
const ROOM_MIN = 160;

/**
 * 长出来的部分最多长到同侧这一列剩下的高度（第十二节第 10 条）：同侧别的块收成一行后空出多少就用多少，
 * 内容放得下就不出滚动条，放不下才在里面滚。量的是块里除了长出来那部分以外的高度，长高动画不影响结果
 */
function useRoomLeft(open: boolean) {
  const clip = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const el = clip.current;
    const block = el?.closest<HTMLElement>("[data-side] > *");
    const side = block?.parentElement;
    if (!el || !block || !side) return;
    const measure = () => {
      const gap = Number.parseFloat(getComputedStyle(side).rowGap) || 0;
      // 收起后 display: none 的不占位，也不算间距
      const others = [...side.children].filter((c) => c !== block && c.getClientRects().length > 0);
      const used = others.reduce((sum, c) => sum + c.getBoundingClientRect().height + gap, 0);
      const fixed = block.getBoundingClientRect().height - el.getBoundingClientRect().height;
      setRoom(Math.max(ROOM_MIN, Math.floor(side.clientHeight - used - fixed)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(side);
    for (const c of side.children) if (c !== block) ro.observe(c);
    return () => ro.disconnect();
  }, [open]);
  return { clip, room };
}

/** 同 corners.module.css 里 .grow 收起的过渡时长（用户嫌拖拉，收短到 160） */
const GROW_MS = 160;

/**
 * 收起时晚一拍撤掉（计划第十二节第 9 条）：长出来那部分先收完，再把加宽的块、档案改回原宽，
 * 免得内容收到一半就被挤成窄条、整块跳一下。打开时立刻生效；减少动态效果时不等
 */
function useLinger(on: boolean): boolean {
  const [held, setHeld] = useState(on);
  useEffect(() => {
    if (on || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setHeld(on);
      return;
    }
    const t = window.setTimeout(() => setHeld(false), GROW_MS);
    return () => window.clearTimeout(t);
  }, [on]);
  return on || held;
}

/** 同 corners.module.css 里 .side > .block 宽度过渡的时长（用户嫌拖拉，收短到 160） */
const WIDTH_MS = 160;

/**
 * 块开着时切到宽度不同的页签（义体→人物、私信→新闻）：宽度过渡那 260ms 里返回 true，
 * CSS 据此先把长出来的内容淡出，宽度到位后再淡入，不让人看到内容一边缩一边重排（用户嫌过渡垃圾，计划第十二节第 11、12 条）。
 * 整块打开、收起不算；减少动态效果时不做
 */
function useResizing(wideOn: boolean, open: boolean): boolean {
  const [resizing, setResizing] = useState(false);
  const prev = useRef(wideOn);
  useEffect(() => {
    const changed = prev.current !== wideOn;
    prev.current = wideOn;
    if (!changed || !open || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    setResizing(true);
    const t = window.setTimeout(() => setResizing(false), WIDTH_MS);
    return () => window.clearTimeout(t);
  }, [wideOn, open]);
  return resizing;
}

/**
 * 块长出来的那部分（第十二节第 9 条）：就在块自己的框里，接在常态内容后面往下长（底部的块往上长），
 * 框跟着变高，不另弹一层。悬停和按键钉住看到的是同一份完整内容；高度有上限，超出就在里面滚，
 * 不会长成一整列侧栏
 */
function Grow({
  open,
  title,
  hint,
  line,
  children,
}: {
  readonly open: boolean;
  readonly title: string;
  /** 标题右边写这块对应的键 */
  readonly hint?: string;
  readonly line: string;
  readonly children: ReactNode;
}) {
  const { clip, room } = useRoomLeft(open);
  return (
    <div
      className={styles.grow}
      data-open={open || undefined}
      aria-hidden={!open}
      style={{ "--accent": line } as CSSProperties}
    >
      <div ref={clip} className={styles.growClip}>
        <div className={styles.growBody} style={room === null ? undefined : { maxHeight: room }}>
          <span
            className={styles.peekLine}
            style={{ maskImage: cssUrl("tab.line"), WebkitMaskImage: cssUrl("tab.line") }}
            aria-hidden
          />
          <header className={styles.peekHead}>
            <span>{title}</span>
            {hint && <kbd>{hint}</kbd>}
          </header>
          {children}
        </div>
      </div>
    </div>
  );
}

/** A 生物监测：神经界面层。等级框、血条、RAM 写法同原 Hud；展开后是属性、声望、人性、治疗品和已装义体 */
export function BioMonitor({
  view,
  peek,
  full,
  wide = false,
}: {
  readonly view: View;
  readonly peek: PeekState;
  /** 钉住（点块或按 P）时块里放的完整人物页 */
  readonly full: ReactNode;
  /** 义体页签：展开时朝中列加宽，人体和两侧部位格照原作排开，不挤成长条（第十二节第 11 条） */
  readonly wide?: boolean;
}) {
  const { health, character, hacking, humanity } = view;
  const low = health.wound === "severe" || health.wound === "zero";
  const wound = WOUND_LABELS[health.wound];
  const p = usePeek("bio", peek.expand, peek.setExpand);
  // 整块收起时等内容收完再变回原宽；还开着时切页签（义体→人物）直接跟着变，宽度由 CSS 过渡，不再停 240ms 再一下缩回（用户嫌过渡垃圾，计划第十二节第 11 条）
  const lingered = useLinger(wide && p.open);
  const wideOn = p.open ? wide : lingered;
  const resizing = useResizing(wideOn, p.open);
  return (
    // biome-ignore lint/a11y/useSemanticElements: 块里套着面板和按钮，不能整个换成 button
    <div
      className={`${styles.block} ${styles.bio}`}
      data-layer="os"
      data-low={low || undefined}
      data-open={p.open || undefined}
      data-char-open={(p.open && !wide) || undefined}
      data-pinned={p.pinned || undefined}
      data-wide={wideOn || undefined}
      data-resizing={resizing || undefined}
      role="button"
      tabIndex={0}
      aria-expanded={p.open}
      {...p.bind}
    >
      <BlockShadow />
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
        <p className={styles.bioLine}>
          <span title={`${character.credWorld}${character.credHalf ? "；再得半级声望就升级" : ""}`}>
            街头声望：{character.credTier}
          </span>
          <span data-stage={humanity.stage}>
            人性 {humanity.current}/{humanity.cap} · {humanity.stageLabel}
          </span>
        </p>
        {/* 已装义体去「义体」页签看，人物页签里不再列一排义体名（用户觉得莫名其妙） */}
        <Grow open={p.open} title={`人物 · ${character.name ?? ""}`} hint="P" line="var(--cp-red)">
          {full}
        </Grow>
      </Panel>
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
  onScan,
}: {
  readonly person: Npc;
  readonly index: number;
  readonly scan: boolean;
  readonly peek: PeekState;
  readonly onScan?: ((id: string) => void) | undefined;
}) {
  const s = person.body?.scan ?? null;
  const p = usePeek(`person:${person.id}`, peek.expand, peek.setExpand);
  // 按住 Tab 扫描时让给扫描卡
  const open = p.open && !scan;
  // 名字格展开时加宽到两倍：收起时等档案收完再缩回原宽，不在收到一半时把档案挤成窄条
  const wideOn = useLinger(open);
  const face = portraitOf(person.id);
  return (
    // biome-ignore lint/a11y/useSemanticElements: 名字格是列表项，里面套着九宫格和展开面板，不能换成 button
    <li
      className={styles.person}
      style={{ "--i": index } as CSSProperties}
      data-open={wideOn || undefined}
      data-pinned={p.pinned || undefined}
      // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: 名字格本身就是可点的锁定框
      role="button"
      tabIndex={0}
      aria-expanded={open}
      {...p.bind}
    >
      <BlockShadow />
      <NineSlice id="map.filterCellBg" tint="rgb(14 14 23 / 72%)" slice={CELL_SLICE} />
      <NineSlice id="map.filterCellFg" tint="var(--person-line)" slice={CELL_SLICE} />
      {/* 常态的名字格左边也挂一个小头像（计划第十二节第 14 条）：原作头像，没有的写名字第一个字 */}
      <div className={`${styles.inner} ${styles.personRow}`}>
        <span className={styles.personFace} data-dead={!person.alive || undefined} aria-hidden>
          {face ? (
            <Asset id={face} className={styles.personFaceArt} />
          ) : (
            <i>{[...person.name][0] ?? "?"}</i>
          )}
        </span>
        <span className={styles.personText}>
          <b>{person.name}</b>
          <small>{person.met ? (person.relation ?? person.role) : "底细不明"}</small>
        </span>
      </div>
      <span className={styles.scanCard} aria-hidden={!scan}>
        <NineSlice id="map.tooltipBg" tint="rgb(14 14 23 / 88%)" slice={TOOLTIP_SLICE} />
        <NineSlice id="map.tooltipFg" tint="var(--cp-cyan)" slice={TOOLTIP_SLICE} />
        <span className={styles.inner}>
          {s ? `义体 ${s.chrome.length} 件 · ${s.humanityStage}` : "没扫描过"}
          {person.met ? " · 认识" : ""}
        </span>
      </span>
      {/* 瞄着谁就只看谁（用户定的）：不再带「联系人 / 所有人」页签，联系人列表去消息页看 */}
      <Grow open={open} title="档案" line="var(--cp-cyan)">
        <Profile npc={person} onScan={onScan} />
      </Grow>
    </li>
  );
}

/** S 在场的人：义眼叠加层。每人一格 map.filterCell，按住 Tab 展开扫描卡；高度跟人数走 */
export function Present({
  view,
  scan,
  peek,
  onScan,
}: {
  readonly view: View;
  readonly scan: boolean;
  readonly peek: PeekState;
  /** 档案里的「扫描」按钮：点一下立刻用义眼扫，不调模型（用户定的，计划第十二节第 14 条） */
  readonly onScan?: ((id: string) => void) | undefined;
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
          <PresentPerson key={n.id} person={n} index={i} scan={scan} peek={peek} onScan={onScan} />
        ))}
      </ul>
    </section>
  );
}

/** G 未读：map.panel 侧板，图标是原作通知图标；都读完了就不显示。展开后各频道列最新几条，点了去消息 */
export function Unread({
  view,
  peek,
  full,
  tabs,
  wide = false,
}: {
  readonly view: View;
  readonly peek: PeekState;
  /** 钉住（点块或按 T）时块里放的消息、新闻 */
  readonly full: ReactNode;
  /** 消息、新闻、警用频段页签：块往上长，页签放在底下挨着常态那一行，不跟内容一起滚走（用户定的） */
  readonly tabs?: ReactNode;
  /** 私信页签：展开时朝中列加宽，联系人在左、消息和档案在右，不上下挤成一条（第十二节第 12 条） */
  readonly wide?: boolean;
}) {
  const p = usePeek("unread", peek.expand, peek.setExpand);
  // 私信加宽：整块收起时等对话收完再变回原宽；还开着时切页签直接跟着变，宽度由 CSS 过渡（计划第十二节第 12 条）
  const lingered = useLinger(wide && p.open);
  const wideOn = p.open ? wide : lingered;
  const resizing = useResizing(wideOn, p.open);
  const feed = view.phone.feedUnread;
  const items: readonly { readonly label: string; readonly icon: AssetId; readonly n: number }[] = [
    { label: "消息", icon: "notify.attention", n: view.phone.unread },
    { label: "新闻", icon: "notify.journal", n: feed.news.length },
    { label: "警用频段", icon: "map.poi.police", n: feed.police.length },
  ];
  const shown = items.filter((i) => i.n > 0);
  // 一直显示：这里就是消息的入口，读完了也要找得到
  const newest = view.phone.messages.find((m) => !m.read) ?? null;
  const totalUnread = view.phone.unread + feed.news.length + feed.police.length;
  return (
    // biome-ignore lint/a11y/useSemanticElements: 块里套着九宫格和展开面板，不能整个换成 button
    <div
      className={`${styles.block} ${styles.unread}`}
      data-layer="os"
      data-open={p.open || undefined}
      data-wide={wideOn || undefined}
      data-resizing={resizing || undefined}
      aria-label="未读"
      role="button"
      tabIndex={0}
      aria-expanded={p.open}
      {...p.bind}
    >
      <BlockShadow />
      <NineSlice id="map.panelBg" tint="rgb(14 14 23 / 72%)" slice={PANEL_SLICE} />
      <NineSlice id="map.panelFg" tint="var(--cp-red)" slice={PANEL_SLICE} />
      <div className={`${styles.inner} ${styles.unreadInner}`}>
        <Grow open={p.open} title="消息" hint="T" line="var(--cp-red)">
          {full}
        </Grow>
        {p.open && tabs ? (
          <div className={styles.unreadTabs}>
            {tabs}
            <span className={styles.unreadTabMeta}>
              {totalUnread > 0 ? `未读 ${totalUnread}` : "全部已读"}
            </span>
          </div>
        ) : (
          <>
            <div className={styles.unreadCounts}>
              {shown.length === 0 ? (
                <span className={styles.unreadIdle}>
                  <Asset id="notify.attention" tint="var(--cp-red-dim)" height={16} />
                  没有未读消息
                </span>
              ) : (
                shown.map((i) => (
                  <span key={i.label}>
                    <Asset id={i.icon} tint="var(--cp-red)" height={18} />
                    {i.label} <b>{i.n}</b>
                  </span>
                ))
              )}
              <kbd className={styles.unreadKey}>T</kbd>
            </div>
            {newest && (
              <p className={styles.unreadLatest}>
                <b>{newest.name}</b>
                {newest.text}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** 地点块下面常态最多列几条威胁，再多的写「还有几个」，去地图里看 */
const ZONE_THREAT_MAX = 3;

/**
 * B 地点、时间、热度：义眼叠加层，原作 zone_update 的框。
 * 不再悬停展开（用户定的，计划第十二节第 9 条）：威胁常态就列在框下面，没人盯上就不占地方；
 * 点地点框或按 Enter / 空格打开大地图，同 M 键。
 * 存放（用户定的）：只在能存放的地点，框下面多一栏存放，悬停或点击就在这块里往下长，不再弹窗
 */
export function Zone({
  view,
  onMap,
  peek,
  stash,
}: {
  readonly view: View;
  readonly onMap: () => void;
  readonly peek: PeekState;
  /** 能存放的地点才传：长出来的存放内容 */
  readonly stash?: ReactNode;
}) {
  const { heat, stealth } = view;
  const bounty = heat.bounties.reduce((sum, b) => sum + b.reward, 0);
  const threats = [...view.threats].sort((a, b) => b.level - a.level);
  const shownThreats = threats.slice(0, ZONE_THREAT_MAX);
  const s = usePeek("stash", peek.expand, peek.setExpand);
  const open = s.open && stash !== undefined;
  const pinStash = () => peek.setExpand({ id: "stash", pinned: true });
  return (
    <div
      className={`${styles.block} ${styles.zone}`}
      data-layer="optics"
      data-open={open || undefined}
    >
      {/* biome-ignore lint/a11y/useSemanticElements: 地点框里套着原作框和威胁列表，不能整个换成 button */}
      <div
        className={styles.zoneHit}
        aria-label="地点，打开地图"
        role="button"
        tabIndex={0}
        onClick={onMap}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onMap();
          }
        }}
      >
        <div className={styles.zoneHead}>
          <BlockShadow />
          <Asset
            id="hud.zoneFrame"
            tint="var(--cp-yellow)"
            height={96}
            className={styles.zoneFrame}
          />
          <div className={styles.zoneText}>
            <b>{view.names.location ?? locationLabel(view.location)}</b>
            <span>
              {view.time.text} · {view.time.periodLabel} ·{" "}
              {/* 天气说明不再另占一块，放进天气名的悬停提示 */}
              <span title={view.weather.note}>{view.weather.label}</span>
            </span>
            <span className={styles.heat}>
              {"★".repeat(heat.stars)}
              <span className={styles.starsEmpty}>{"★".repeat(5 - heat.stars)}</span>
              {bounty > 0 && <small>{` 悬赏 ${bounty.toLocaleString("en-US")} 欧元`}</small>}
              {stealth.level > 0 && (
                <small data-alert={stealth.level}>{` ◆ ${stealth.label}`}</small>
              )}
            </span>
          </div>
          {/* 原作地区徽章自带颜色，有的没有透明底，不能当蒙版染色 */}
          <Asset id={districtIcon(view.names.district ?? view.location)} height={44} />
        </div>
        {/* 威胁常态就列（用户定的）：不单开一块、不套侧板框（用户嫌丑），贴在地点框下面几行小字，每条一行，原因放进悬停提示；没人盯上就不出 */}
        {shownThreats.length > 0 && (
          <div className={styles.zoneThreats}>
            <ul className={styles.zoneThreatList} aria-label="威胁">
              {shownThreats.map((t) => (
                <li key={t.id} data-level={t.level} title={t.reason}>
                  <span className={styles.zoneThreatStars}>{"★".repeat(t.level)}</span>
                  <b>{t.who}</b>
                  <small>{t.sourceLabel}</small>
                </li>
              ))}
              {threats.length > ZONE_THREAT_MAX && (
                <li className={styles.zoneThreatMore}>
                  还有 {threats.length - ZONE_THREAT_MAX} 个，点开地图看
                </li>
              )}
            </ul>
          </div>
        )}
      </div>
      {/* 存放（用户定的）：能存放的地点才出，同追踪块的写法，原作面板框里一行读数，展开的内容就在框里往下长 */}
      {stash !== undefined && (
        // biome-ignore lint/a11y/useSemanticElements: 存放框里套着面板和按钮，不能整个换成 button
        <div
          className={styles.zoneStash}
          role="button"
          tabIndex={0}
          aria-expanded={open}
          onClick={pinStash}
          onKeyDown={(e) => {
            if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
              e.preventDefault();
              pinStash();
            }
          }}
          {...s.bind}
        >
          <BlockShadow />
          <Panel as="section" title="存放" line="var(--cp-yellow)">
            <p className={styles.zoneStashLine}>
              {view.safehouse.homes
                .filter((h) => h.here)
                .map((h) => `${h.name} · ${h.items.length} 样`)
                .join("、")}
              {view.safehouse.trunks.length > 0 && ` · 后备箱 ${view.safehouse.trunks.length}`}
            </p>
            <Grow open={open} title="存放" line="var(--cp-yellow)">
              {stash}
            </Grow>
          </Panel>
        </div>
      )}
    </div>
  );
}

/** C 追踪：待办里最急的几条（超期的先），在超梦里时加一条线索进度；children 是 D 系统通知，紧贴在下面。
 * 展开后按期限列全部待办，点了去日志 */
export function Track({
  view,
  peek,
  full,
  children,
}: {
  readonly view: View;
  readonly peek: PeekState;
  /** 钉住（点块或按 J）时块里放的待办、委托、数据库 */
  readonly full: ReactNode;
  readonly children?: ReactNode;
}) {
  const p = usePeek("track", peek.expand, peek.setExpand);
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
  // 一直显示：这里就是日志的入口，没有待办也要找得到
  return (
    <div
      className={`${styles.block} ${styles.track}`}
      data-layer="optics"
      data-open={p.open || undefined}
    >
      {
        // biome-ignore lint/a11y/useSemanticElements: 追踪框里套着面板和展开面板，不能整个换成 button
        <div
          className={styles.trackHit}
          role="button"
          tabIndex={0}
          aria-expanded={p.open}
          {...p.bind}
        >
          <BlockShadow />
          <Panel as="section" title="追踪" line="var(--cp-yellow)">
            <ul className={styles.trackList}>
              {rows.length === 0 && <li className={styles.peekNote}>没有待办</li>}
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
            <Grow
              open={p.open}
              title={`日志 · 待办 ${all.length}`}
              hint="J"
              line="var(--cp-yellow)"
            >
              {full}
            </Grow>
          </Panel>
        </div>
      }
      {children}
    </div>
  );
}

/**
 * H 武器和快速破解：武器格同原 Hud（hud.slot*），快速破解用现有轮盘。
 * 悬停或按 O 钉住时，框朝中列平滑加宽、往上长出完整物品栏，常驻武器读数稳在底部。
 */
export function Weapon({
  view,
  peek,
  full,
  tabs,
  onQuickhack,
}: {
  readonly view: View;
  readonly peek: PeekState;
  /** 展开区里的完整物品栏 */
  readonly full: ReactNode;
  /** 展开区底部的页签 */
  readonly tabs?: ReactNode;
  /** 生成中为 undefined：不显示快速破解入口 */
  readonly onQuickhack?: ((name: string) => void) | undefined;
}) {
  const { inventory, hacking } = view;
  const p = usePeek("weapon", peek.expand, peek.setExpand);
  const wideOn = useLinger(p.open);
  const weaponId = inventory.active === null ? null : (inventory.weapons[inventory.active] ?? null);
  const weapon = weaponId === null ? null : (view.names.items[weaponId] ?? weaponId);
  const activeDetail = weaponId === null ? undefined : inventory.details?.[weaponId];
  return (
    // biome-ignore lint/a11y/useSemanticElements: 块里套着快速破解轮盘和物品栏按钮，不能整个换成 button
    <div
      className={`${styles.block} ${styles.weapon}`}
      data-layer="os"
      data-open={p.open || undefined}
      data-pinned={p.pinned || undefined}
      data-wide={wideOn || undefined}
      aria-label="武器与物品栏，点击固定展开，按 Esc 收起"
      role="button"
      tabIndex={0}
      aria-expanded={p.open}
      onClick={(event) => {
        const target = event.target;
        if (
          target instanceof Element &&
          target.closest("button, input, textarea, select, a, [role='button']") !==
            event.currentTarget
        )
          return;
        if (p.pinned) p.close();
        else peek.setExpand({ id: "weapon", pinned: true });
      }}
      onKeyDown={(event) => {
        if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          if (p.pinned) p.close();
          else peek.setExpand({ id: "weapon", pinned: true });
        }
      }}
      onPointerEnter={(event) => {
        if (event.target instanceof Element && event.target.closest("[data-layer='deck']")) return;
        p.bind.onPointerEnter(event);
      }}
      onPointerOver={(event) => {
        const inDeck =
          event.target instanceof Element && event.target.closest("[data-layer='deck']");
        const fromDeck =
          event.relatedTarget instanceof Element &&
          event.relatedTarget.closest("[data-layer='deck']");
        if (inDeck && !fromDeck) p.bind.onPointerLeave(event);
        else if (!inDeck && fromDeck) p.bind.onPointerEnter(event);
      }}
      onPointerMove={(event) => {
        if (event.target instanceof Element && event.target.closest("[data-layer='deck']")) return;
        p.bind.onPointerEnter(event);
      }}
      onPointerLeave={p.bind.onPointerLeave}
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
        <BlockShadow />
        <NineSlice id="hud.slotBg" tint="rgb(14 14 23 / 90%)" slice={SLOT_SLICE} />
        <NineSlice id="hud.slotFg" tint="rgb(94 246 255 / 80%)" slice={SLOT_SLICE} />
        <Grow open={p.open} title="装备 · 物品栏" hint="O" line="var(--cp-cyan)">
          {full}
        </Grow>
        {p.open && tabs && <div className={styles.unreadTabs}>{tabs}</div>}
        <div className={styles.inner}>
          <span className={styles.slotMain}>
            <span className={styles.slotHead}>
              {weapon === null ? (
                <>
                  <Asset id="weapon.fists" tint="var(--cp-cyan)" height={24} alt="徒手" />
                  <b>徒手</b>
                </>
              ) : (
                <>
                  <b>{weapon}</b>
                  {activeDetail?.subLabel && (
                    <small className={styles.slotSub}>{activeDetail.subLabel}</small>
                  )}
                </>
              )}
            </span>
            <small className={styles.slotLine}>
              {inventory.healing
                ? `治疗 ${inventory.healing.charges}/${inventory.healing.max}`
                : "无治疗品"}
              {" · "}
              {inventory.grenade
                ? `手雷 ${inventory.grenade.charges}/${inventory.grenade.max}`
                : "无手雷"}
              {" · "}
              负荷 {inventory.loadout.usedSlots}/{inventory.loadout.maxSlots}
            </small>
          </span>
          {weapon !== null && itemArtOf(weaponId) && (
            <Asset
              id={itemArtOf(weaponId) as AssetId}
              width={148}
              height={54}
              className={`${story.weaponArt} ${styles.slotArt}`}
            />
          )}
          <kbd className={styles.slotHint}>{p.pinned ? "ESC" : "O"}</kbd>
        </div>
      </div>
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
          {a.district && <span className={story.combatTitle}>{a.district}</span>}
        </div>
        <div className={styles.bannerLines}>
          {a.foes.map((f) => (
            <span key={f.id}>
              {f.name}（{f.stateLabel}）{f.gang && ` · ${f.gang}`}
              {f.carry.length > 0 && ` · 可拾取：${f.carry.map((i) => i.name).join("、")}`}
            </span>
          ))}
        </div>
      </Panel>
    );
  }
  // 不在交战中时，继续显示潜网或闪回横幅。
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
