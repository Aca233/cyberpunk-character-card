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
import { CellFrame } from "../../ui/FrameBox";
import { Panel } from "../../ui/Panel";
import { shopPoiIconOf, weaponHudIconOf } from "./art";
import styles from "./corners.module.css";
import neural from "./neural.module.css";
import {
  AffinityMeter,
  affinityTone,
  type CombatFoe,
  formatAffinity,
  NpcPortrait,
  Profile,
  profileTone,
  type SquadMember,
  threatOfHumanity,
} from "./Profile";
import { type Expand, type SetExpand, usePeek } from "./peek";
import story from "./story.module.css";
import {
  districtIcon,
  locationLabel,
  neuroTelemetry,
  npcWoundSummary,
  trackTelemetry,
  type View,
  woundTelemetry,
} from "./view";

/**
 * 四角（2077-interface-plan.md 第九节）：A 生物监测左上、S 在场的人左中、G 未读左下、
 * B 地点右上、C 追踪右中、H 随身武器与物品栏右下，横幅在中列顶上。
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
      // 收起时 .personSummary 先保持占位再缩到 0fr，过渡完再重算一次才能释放完整高度
      const next = Math.max(ROOM_MIN, Math.floor(side.clientHeight - used - fixed));
      setRoom((prev) => (prev === next ? prev : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(side);
    ro.observe(block);
    for (const c of side.children) if (c !== block) ro.observe(c);
    const settle = window.setTimeout(measure, GROW_MS + 25);
    return () => {
      window.clearTimeout(settle);
      ro.disconnect();
    };
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
  head,
  line,
  children,
}: {
  readonly open: boolean;
  readonly title?: ReactNode;
  /** 标题右边写这块对应的键 */
  readonly hint?: string;
  /** 自定义顶栏（如生物监测直接放页签+快捷键，避免多层叠标题） */
  readonly head?: ReactNode;
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
          {head !== undefined ? (
            head
          ) : title !== undefined ? (
            <header className={styles.peekHead}>
              <span>{title}</span>
              {hint && <kbd>{hint}</kbd>}
            </header>
          ) : null}
          {children}
        </div>
      </div>
    </div>
  );
}

/** A 生物监测（3.0）：创伤刻痕、神经稳态与外设/救援遥测 */
export function BioMonitor({
  view,
  peek,
  full,
  tabs,
  wide = false,
  diag = false,
}: {
  readonly view: View;
  readonly peek: PeekState;
  /** 钉住（点块或按 P）时块里放的完整人物/义体页 */
  readonly full: ReactNode;
  /** 展开后顶栏放人物/义体切换页签 */
  readonly tabs?: ReactNode;
  /** 义体页签：展开时朝中列加宽，人体和两侧部位格照原作排开，不挤成长条（第十二节第 11 条） */
  readonly wide?: boolean;
  /** 人物/生物检测页签：展开时中幅加宽以并排展示生理躯体扫描与遥测卡 */
  readonly diag?: boolean;
}) {
  const {
    health,
    combat,
    character,
    hacking,
    sandevistan,
    humanity,
    psychosis,
    trauma,
    time,
    cyberware,
  } = view;
  const brokenCount = cyberware.filter((c) => c.broken).length;
  const wound = woundTelemetry(health, combat, cyberware);
  const low = wound.tone === "bad" || wound.tone === "dead" || health.condition !== "up";
  const neuro = neuroTelemetry(humanity, psychosis);
  const p = usePeek("bio", peek.expand, peek.setExpand);
  // 整块收起时等内容收完再变回原宽；还开着时切页签直接跟着变，宽度由 CSS 过渡
  const lingeredWide = useLinger(wide && p.open);
  const lingeredDiag = useLinger(diag && p.open);
  const wideOn = p.open ? wide : lingeredWide;
  const diagOn = p.open ? diag && !wide : !wideOn && lingeredDiag;
  const resizing = useResizing(wideOn || diagOn, p.open);

  const humanityPct = `${Math.max(0, Math.min(100, humanity.current))}%`;

  return (
    // biome-ignore lint/a11y/useSemanticElements: 块里套着面板和按钮，不能整个换成 button
    <div
      className={`${styles.block} ${styles.bio}`}
      data-layer="os"
      data-low={low || undefined}
      data-open={p.open || undefined}
      data-pinned={p.pinned || undefined}
      data-wide={wideOn || undefined}
      data-diag={diagOn || undefined}
      data-resizing={resizing || undefined}
      role="button"
      tabIndex={0}
      aria-expanded={p.open}
      {...p.bind}
    >
      <BlockShadow />
      <Panel as="section" title="生物监测" line="var(--cp-red)">
        {/* 常态摘要包一层折叠容器：展开人物/义体时同步收起，避免顶栏被拉成超长横条并消除上下重复读数 */}
        <div className={styles.bioSummary}>
          <div className={styles.bioSummaryInner}>
            <div className={styles.bioRow}>
              <span
                className={styles.level}
                title={`街头名声 · ${character.credTier}：${character.credWorld}`}
              >
                <Asset id="hud.levelFrame" tint="var(--cp-red)" height={44} />
                <Asset
                  id="notify.streetCred"
                  tint="var(--cp-red)"
                  height={20}
                  className={styles.levelIcon}
                />
              </span>
              <div className={styles.trauma}>
                <div className={styles.woundHead}>
                  <span className={styles.woundText} data-tone={wound.tone}>
                    {wound.title}
                    {health.painSuppressed && wound.level === 2 ? " · 镇痛" : ""}
                  </span>
                  <span className={styles.woundCode} data-tone={wound.tone}>
                    {wound.code}
                  </span>
                </div>
                <div className={styles.woundList}>
                  {wound.items.length > 0 ? (
                    <>
                      {wound.items.slice(0, 2).map((item) => (
                        <span
                          key={item.id}
                          className={styles.woundChip}
                          data-tone={item.tone}
                          title={`${item.headline} · ${item.cause}（${item.careNote}）`}
                        >
                          <b className={styles.woundPart}>{item.partLabel}</b>
                          <span className={styles.woundDesc}>
                            {item.tierLabel} · {item.cause}
                          </span>
                          <em className={styles.woundCare}>{item.careTag}</em>
                        </span>
                      ))}
                      {wound.items.length > 2 && (
                        <span className={styles.woundMore}>
                          +{wound.items.length - 2} 处伤势，点开生物监测查看
                        </span>
                      )}
                    </>
                  ) : wound.scars.length > 0 ? (
                    <p
                      className={styles.woundNominal}
                      data-scar
                      title={wound.scars.map((s) => s.summary).join("；")}
                    >
                      无新伤 · 留疤：{wound.scars[0]?.partLabel}
                      {wound.scars.length > 1 ? ` 等 ${wound.scars.length} 处` : ""}
                    </p>
                  ) : (
                    <p className={styles.woundNominal}>无外伤记录 · 各部位机能正常</p>
                  )}
                </div>
                <div className={styles.bioHwBar}>
                  {hacking ? (
                    <>
                      <span
                        className={styles.bioMiniGauge}
                        title={`${hacking.deckName ?? "网络接入仓"} · ${
                          hacking.ram <= 0
                            ? "算力耗尽"
                            : hacking.ram < hacking.ramMax
                              ? "算力消耗中"
                              : "算力就绪"
                        }`}
                      >
                        <span
                          className={styles.bioMiniFill}
                          data-hw="ram"
                          data-tone={hacking.ram <= 0 ? "bad" : undefined}
                          style={{
                            width: `${
                              hacking.ramMax > 0
                                ? Math.max(
                                    0,
                                    Math.min(100, Math.round((hacking.ram / hacking.ramMax) * 100)),
                                  )
                                : 0
                            }%`,
                          }}
                        />
                      </span>
                      <span className={styles.bioHwText}>
                        {hacking.ram <= 0
                          ? "算力耗尽"
                          : hacking.ram < hacking.ramMax
                            ? "算力消耗"
                            : "算力就绪"}
                      </span>
                    </>
                  ) : sandevistan ? (
                    <span className={styles.bioSandy}>SNV · {sandevistan.name} · 就绪</span>
                  ) : (
                    <>
                      <span className={styles.bioMiniGauge} title={`神经稳态 · ${neuro.summary}`}>
                        <span
                          className={styles.bioMiniFill}
                          data-tone={neuro.tone}
                          style={{ width: humanityPct }}
                        />
                      </span>
                      <span className={styles.bioHwText}>SYNC · {humanity.stageLabel}</span>
                    </>
                  )}
                </div>
              </div>
            </div>
            <p className={styles.bioLine}>
              <span
                data-stage={humanity.stage}
                data-tone={neuro.tone}
                title={
                  psychosis.suppressant.until
                    ? `免疫抑剂药效至 ${psychosis.suppressant.until}`
                    : psychosis.suppressant.withdrawal
                      ? "停药戒断反应：手抖、冷汗与焦躁"
                      : neuro.summary
                }
              >
                神经 · {humanity.stageLabel}
                {psychosis.blackoutOpen
                  ? " · 记忆盲区"
                  : psychosis.suppressant.until
                    ? " · 阻断"
                    : psychosis.suppressant.withdrawal
                      ? " · 戒断"
                      : ""}
              </span>
              {health.lostLimbs.length > 0 ? (
                <span className={styles.bioAlert}>肢体缺损</span>
              ) : brokenCount > 0 ? (
                <span className={styles.bioAlert}>义体损毁</span>
              ) : time.blackLaceWithdrawal ? (
                <span className={styles.bioAlert}>黑蕾丝戒断</span>
              ) : time.fatigued ? (
                <span className={styles.bioWarn}>熬夜疲劳</span>
              ) : trauma.active ? (
                <span
                  className={trauma.dispatch.ok ? styles.bioGood : styles.bioWarn}
                  title={
                    trauma.dispatch.ok ? "创伤小组信号实时可达" : `受阻：${trauma.dispatch.why}`
                  }
                >
                  TT {trauma.tierLabel}
                  {trauma.dispatch.ok ? "" : " · 受阻"}
                </span>
              ) : hacking ? (
                <span title={hacking.deckName ?? undefined}>{hacking.deckName ?? "接入仓"}</span>
              ) : (
                <span title={character.credWorld}>{character.credTier}</span>
              )}
            </p>
          </div>
        </div>
        <Grow
          open={p.open}
          line="var(--cp-red)"
          head={
            <header className={styles.bioDrawerHead}>
              {tabs ?? <span className={styles.bioDrawerTitle}>人物</span>}
              <span className={styles.bioDrawerMeta}>
                {character.name && <em>{character.name}</em>}
                <kbd>P</kbd>
              </span>
            </header>
          }
        >
          {full}
        </Grow>
      </Panel>
    </div>
  );
}

type Npc = View["npcs"][number];
type Fixer = View["jobs"]["fixers"][number];

interface PersonBadge {
  readonly label: string;
  readonly tint: string;
  readonly lightInk?: boolean;
}

function isNestedInteractive(target: EventTarget | null, currentTarget: EventTarget): boolean {
  return (
    target instanceof Element &&
    target.closest("button, input, textarea, select, a, [role='button'], details, summary") !==
      currentTarget
  );
}

function personBadges(
  person: Npc,
  fixer: Fixer | undefined,
  squad: SquadMember | undefined,
  foe: CombatFoe | undefined,
): PersonBadge[] {
  const badges: PersonBadge[] = [];
  if (foe) {
    badges.push({ label: foe.stateLabel, tint: "var(--cp-danger)", lightInk: true });
  }
  if (person.nemesis && !person.nemesis.ended) {
    badges.push({ label: "宿敌", tint: "var(--cp-red)", lightInk: true });
  }
  if (squad) {
    badges.push({ label: "小队", tint: "var(--cp-yellow)" });
  }
  if (fixer) {
    badges.push({ label: "中间人", tint: "var(--cp-yellow)" });
  }
  // 具象创口在 .personWound 单独一行展示部位与原因；仅当只有模糊等级时兜底用小牌提示
  const hasDetailedWounds = (person.body?.injuries?.length ?? 0) > 0;
  const wound = !hasDetailedWounds && person.body ? npcWoundSummary(person.body) : null;
  if (wound?.badge) {
    const high = wound.threat === "high";
    badges.push({
      label: wound.badge,
      tint: high ? "var(--cp-danger)" : "var(--cp-yellow)",
      lightInk: high,
    });
  }
  return badges.slice(0, 3);
}

/** S 里的一个人：鼠标停在名字格上展开人物档案，点击固定/取消固定 */
function PresentPerson({
  person,
  fixer,
  squad,
  foe,
  index,
  scan,
  peek,
  onScan,
}: {
  readonly person: Npc;
  readonly fixer?: Fixer | undefined;
  readonly squad?: SquadMember | undefined;
  readonly foe?: CombatFoe | undefined;
  readonly index: number;
  readonly scan: boolean;
  readonly peek: PeekState;
  readonly onScan?: ((id: string) => void) | undefined;
}) {
  const s = person.body?.scan ?? null;
  const injuries = person.body?.injuries ?? [];
  const wound = npcWoundSummary(person.body);
  const p = usePeek(`person:${person.id}`, peek.expand, peek.setExpand);
  // 按住 Tab 扫描时让给扫描卡
  const open = p.open && !scan;
  // 名字格展开时加宽：收起时等档案收完再缩回原宽，不在收到一半时把档案挤成窄条
  const wideOn = useLinger(open);
  const tone = profileTone(person, squad, foe);
  const subLabel = foe
    ? [
        foe.gang ?? (person.met ? person.role : "敌对目标"),
        foe.carry.length > 0 ? `可拾取 ${foe.carry.length} 件` : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : person.met
      ? `${person.role}${person.faction && person.faction !== "无" ? ` · ${person.faction}` : ""}`
      : person.nemesis
        ? "交过手 · 底细不明"
        : "底细不明";
  const badges = personBadges(person, fixer, squad, foe);
  const humanityThreat = s ? threatOfHumanity(s.humanityStage) : undefined;
  const scanAlert = Boolean(foe) || wound.threat === "high" || humanityThreat === "high";
  const scanStatusText = foe
    ? injuries.length > 0
      ? `${foe.stateLabel} · ${wound.headline}`
      : wound.badge
        ? `${foe.stateLabel} · ${wound.badge}`
        : foe.stateLabel
    : injuries.length > 0
      ? wound.headline
      : (wound.badge ?? (person.alive ? "存活" : "死亡"));
  const scanStatusThreat = foe || wound.threat === "high" ? "high" : wound.threat;
  const scanWoundText =
    injuries.length > 0
      ? injuries
          .slice(0, 2)
          .map((inj) => `${inj.partLabel}${inj.tierLabel}（${inj.cause}）`)
          .join("；")
      : null;
  const chromePreview =
    s && s.chrome.length > 0
      ? `${s.chrome
          .slice(0, 2)
          .map((c) => c.name)
          .join(" / ")}${s.chrome.length > 2 ? ` +${s.chrome.length - 2}` : ""}`
      : "";
  const togglePin = () => {
    if (p.pinned) p.close();
    else peek.setExpand({ id: `person:${person.id}`, pinned: true });
  };
  return (
    // biome-ignore lint/a11y/useSemanticElements: 名字格是列表项，里面套着九宫格和展开面板，不能换成 button
    <li
      className={styles.person}
      style={{ "--i": index } as CSSProperties}
      data-open={wideOn || undefined}
      data-active={open || undefined}
      data-pinned={p.pinned || undefined}
      data-tone={tone}
      // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: 名字格本身就是可点的锁定框
      role="button"
      tabIndex={0}
      aria-expanded={open}
      aria-label={`${person.name}，${subLabel}${wound.detail ? `，${wound.detail}` : ""}，点击${p.pinned ? "取消固定" : "固定展开"}，按 Esc 收起`}
      onClick={(event) => {
        if (isNestedInteractive(event.target, event.currentTarget)) return;
        togglePin();
      }}
      onKeyDown={(event) => {
        if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          togglePin();
        }
      }}
      {...p.bind}
    >
      <BlockShadow />
      <NineSlice
        id="map.filterCellBg"
        tint="var(--person-bg, rgb(14 14 23 / 88%))"
        slice={CELL_SLICE}
      />
      <NineSlice id="map.filterCellFg" tint="var(--person-line)" slice={CELL_SLICE} />
      <NineSlice
        id="panel.glowLeft"
        tint="var(--person-glow, rgb(94 246 255 / 14%))"
        slice={[16, 20, 16, 20]}
        className={styles.personGlow}
      />
      <NineSlice
        id="cyber.cellRarity"
        tint="var(--person-rail, var(--cp-cyan))"
        slice={0}
        className={styles.personRail}
      />
      <NineSlice
        id="cyber.cellTexture"
        tint="var(--person-circuit, rgb(94 246 255 / 7%))"
        slice={0}
        className={styles.personCircuit}
      />
      <span
        className={styles.personGrid}
        style={{ backgroundImage: cssUrl("fx.grid") }}
        aria-hidden
      />
      {/* 常态的名字格：折叠时隐藏并滑入完整档案，避免头像和名字上下重复 */}
      <div className={styles.personSummary}>
        <div className={`${styles.inner} ${styles.personRow}`}>
          <NpcPortrait
            npc={person}
            className={styles.personFace}
            artClassName={styles.personFaceArt}
            line="var(--face-line, var(--person-line))"
          />
          <span className={styles.personText}>
            <span className={styles.personHead}>
              <b className={styles.personName}>{person.name}</b>
              {person.met && person.alias && <em className={styles.personAlias}>{person.alias}</em>}
            </span>
            <small className={styles.personSub} data-tone={foe ? "hostile" : undefined}>
              {subLabel}
            </small>
            {injuries.length > 0 && wound.detail && (
              <small className={styles.personWound} data-threat={wound.threat} title={wound.detail}>
                {wound.detail}
              </small>
            )}
            {badges.length > 0 && (
              <span className={styles.personBadges}>
                {badges.map((b) => (
                  <span
                    key={b.label}
                    className={styles.personBadge}
                    data-ink={b.lightInk ? "light" : undefined}
                  >
                    <NineSlice id="cyber.gaugeLabel" tint={b.tint} slice={4} />
                    <b>{b.label}</b>
                  </span>
                ))}
              </span>
            )}
          </span>
          <span className={styles.personSide}>
            {person.met && person.affinity !== 0 && (
              <>
                <span
                  className={styles.personAffinity}
                  data-tone={affinityTone(person.affinity)}
                  title={`好感 ${formatAffinity(person.affinity)}`}
                >
                  {formatAffinity(person.affinity)}
                </span>
                <AffinityMeter affinity={person.affinity} className={styles.personMeter} />
              </>
            )}
            <span
              className={styles.personState}
              data-pinned={p.pinned || undefined}
              data-scanned={Boolean(s) || undefined}
            >
              {p.pinned ? "已固定" : s ? "已扫 ›" : "档案 ›"}
            </span>
          </span>
        </div>
      </div>
      <span className={styles.scanCard} data-alert={scanAlert || undefined} aria-hidden={!scan}>
        <NineSlice id="map.tooltipBg" tint="rgb(10 10 18 / 96%)" slice={TOOLTIP_SLICE} />
        <NineSlice
          id="map.tooltipFg"
          tint={scanAlert ? "var(--cp-danger)" : "var(--cp-cyan)"}
          slice={TOOLTIP_SLICE}
        />
        <span className={`${styles.inner} ${styles.scanInner}`}>
          <span className={styles.scanTop}>
            <em>{s ? "KIROSHI // 已扫描" : "KIROSHI // 未扫描"}</em>
            <em data-threat={scanStatusThreat}>{scanStatusText}</em>
          </span>
          {scanWoundText && (
            <span className={styles.scanWound} data-threat={wound.threat}>
              创伤：{scanWoundText}
            </span>
          )}
          <span className={styles.scanMeta}>
            {s ? (
              <>
                义体 <em>{s.chrome.length}</em> 件{chromePreview && ` (${chromePreview})`} · 神经{" "}
                <em data-threat={humanityThreat}>{s.humanityStage}</em>
              </>
            ) : (
              <>{person.met ? "已建档" : "底细不明"} · 悬停或点击人物栏后扫描</>
            )}
          </span>
        </span>
      </span>
      {/* 瞄着谁就只看谁（用户定的）：不再带「联系人 / 所有人」页签，联系人列表去消息页看 */}
      <Grow
        open={open}
        title={
          <span className={styles.personPeekTitle}>
            <Asset id="fluff.code" tint="currentColor" height={10} />
            <span>{`档案 // ${person.name}`}</span>
          </span>
        }
        hint={p.pinned ? "已固定 · ESC / 再点收起" : "点击固定"}
        line={
          tone === "hostile"
            ? "var(--cp-danger)"
            : tone === "nemesis"
              ? "var(--cp-red)"
              : "var(--cp-cyan)"
        }
      >
        <Profile npc={person} fixer={fixer} squad={squad} foe={foe} onScan={onScan} />
      </Grow>
    </li>
  );
}

/** 无独立人物卡但在交战中的场内敌手（杂兵或临时对手） */
function PresentFoe({ foe, index }: { readonly foe: CombatFoe; readonly index: number }) {
  const dead = foe.state === "dead" || foe.state === "fled";
  const sub = [
    foe.gang ?? "敌对目标",
    foe.carry.length > 0 ? `可拾取：${foe.carry.map((i) => i.name).join("、")}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <li className={styles.person} style={{ "--i": index } as CSSProperties} data-tone="hostile">
      <BlockShadow />
      <NineSlice
        id="map.filterCellBg"
        tint="var(--person-bg, rgb(14 14 23 / 88%))"
        slice={CELL_SLICE}
      />
      <NineSlice id="map.filterCellFg" tint="var(--person-line)" slice={CELL_SLICE} />
      <NineSlice
        id="panel.glowLeft"
        tint="var(--person-glow, rgb(255 0 60 / 20%))"
        slice={[16, 20, 16, 20]}
        className={styles.personGlow}
      />
      <NineSlice
        id="cyber.cellRarity"
        tint="var(--person-rail, var(--cp-danger))"
        slice={0}
        className={styles.personRail}
      />
      <div className={styles.personSummary}>
        <div className={`${styles.inner} ${styles.personRow}`}>
          <span className={styles.personFace} data-dead={dead || undefined} aria-hidden>
            <NineSlice id="map.filterCellBg" tint="rgb(24 10 14 / 86%)" slice={CELL_SLICE} />
            <Asset id="portrait.unknown" className={styles.personFaceArt} />
            <NineSlice id="map.filterCellFg" tint="var(--cp-danger)" slice={CELL_SLICE} />
          </span>
          <span className={styles.personText}>
            <span className={styles.personHead}>
              <b className={styles.personName}>{foe.name}</b>
            </span>
            <small className={styles.personSub} data-tone="hostile">
              {sub}
            </small>
            <span className={styles.personBadges}>
              <span className={styles.personBadge} data-ink="light">
                <NineSlice id="cyber.gaugeLabel" tint="var(--cp-danger)" slice={4} />
                <b>{foe.stateLabel}</b>
              </span>
            </span>
          </span>
          <span className={styles.personSide}>
            <span className={styles.personState}>交战</span>
          </span>
        </div>
      </div>
    </li>
  );
}

/** S 在场的人：义眼叠加层。整合在场人物卡与交战敌手，按住 Tab 展开扫描卡；高度跟人数走 */
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
  const herePeople = view.npcs.filter((n) => n.here && n.alive);
  const foes = view.combat.active?.foes ?? [];
  const extraFoes = foes.filter(
    (f) => !herePeople.some((n) => f.npc === n.id || f.id === n.id || f.name === n.name),
  );
  const totalCount = herePeople.length + extraFoes.length;
  if (totalCount === 0) return null;
  const people = herePeople.slice(0, PRESENT_MAX);
  const shownExtraFoes = extraFoes.slice(0, Math.max(0, PRESENT_MAX - people.length));
  const overflow = totalCount - people.length - shownExtraFoes.length;
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
        <span>{scan ? "Kiroshi · 正在扫描" : "在场"}</span>
        <em className={styles.presentCount}>
          {overflow > 0 ? `${people.length + shownExtraFoes.length}/${totalCount}` : totalCount}
        </em>
        <span
          className={styles.labelLine}
          style={{ maskImage: cssUrl("tab.line"), WebkitMaskImage: cssUrl("tab.line") }}
          aria-hidden
        />
        <kbd className={styles.labelHint}>{scan ? "SCAN" : open ? "ESC" : "TAB"}</kbd>
      </header>
      <ul>
        {people.map((n, i) => (
          <PresentPerson
            key={n.id}
            person={n}
            fixer={view.jobs.fixers.find((f) => f.id === n.id)}
            squad={view.squad.members.find((m) => m.npc === n.id)}
            foe={foes.find((f) => f.npc === n.id || f.id === n.id || f.name === n.name)}
            index={i}
            scan={scan}
            peek={peek}
            onScan={onScan}
          />
        ))}
        {shownExtraFoes.map((f, i) => (
          <PresentFoe key={f.id} foe={f} index={people.length + i} />
        ))}
      </ul>
      {overflow > 0 && (
        <p className={styles.presentMore}>另有 {overflow} 人在场 · 全部人物见联系人</p>
      )}
    </section>
  );
}

/** G 未读：map.panel 侧板，整合消息 / 新闻 / 芯片三个入口；收起时显示未读计数，点开或按 T 读详情 */
export function Unread({
  view,
  peek,
  full,
  tabs,
  wide = false,
}: {
  readonly view: View;
  readonly peek: PeekState;
  /** 钉住（点块或按 T）时块里放的消息、新闻与芯片 */
  readonly full: ReactNode;
  /** 消息、新闻、芯片页签：块往上长，页签放在底下挨着常态那一行，不跟内容一起滚走（用户定的） */
  readonly tabs?: ReactNode;
  /** 私信或芯片页签：展开时朝中列加宽，左侧列表、右侧正文，不上下挤成一条（第十二节第 12 条） */
  readonly wide?: boolean;
}) {
  const p = usePeek("unread", peek.expand, peek.setExpand);
  // 私信/芯片加宽：整块收起时等对话收完再变回原宽；还开着时切页签直接跟着变，宽度由 CSS 过渡（计划第十二节第 12 条）
  const lingered = useLinger(wide && p.open);
  const wideOn = p.open ? wide : lingered;
  const resizing = useResizing(wideOn, p.open);
  const feed = view.phone.feedUnread;
  const newsCount = feed.news.length + feed.street.length;
  const items: readonly { readonly label: string; readonly icon: AssetId; readonly n: number }[] = [
    { label: "消息", icon: "notify.attention", n: view.phone.unread },
    { label: "新闻", icon: "notify.journal", n: newsCount },
    { label: "芯片", icon: "interaction.jackIn", n: view.shards.unread },
  ];
  const shown = items.filter((i) => i.n > 0);
  // 一直显示：这里就是消息与芯片的入口，读完了也要找得到
  const newest = view.phone.messages.find((m) => !m.read) ?? null;
  const totalUnread = view.phone.unread + newsCount + view.shards.unread;
  const togglePin = () => {
    if (p.pinned) p.close();
    else peek.setExpand({ id: "unread", pinned: true });
  };
  return (
    // biome-ignore lint/a11y/useSemanticElements: 块里套着九宫格和展开面板，不能整个换成 button
    <div
      className={`${styles.block} ${styles.unread}`}
      data-layer="os"
      data-open={p.open || undefined}
      data-pinned={p.pinned || undefined}
      data-wide={wideOn || undefined}
      data-resizing={resizing || undefined}
      aria-label={`未读消息，点击${p.pinned ? "取消固定" : "固定展开"}，按 T 或 Esc 收起`}
      role="button"
      tabIndex={0}
      aria-expanded={p.open}
      onClick={(event) => {
        if (isNestedInteractive(event.target, event.currentTarget)) return;
        // 已经钉住时点击展开正文区（复制消息、漏点输入框边缘）不顺手关掉整块，点外框或底栏再收起
        if (
          p.pinned &&
          event.target instanceof Element &&
          event.target.closest(`.${styles.grow}`)
        ) {
          return;
        }
        togglePin();
      }}
      onKeyDown={(event) => {
        if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          togglePin();
        }
      }}
      onFocusCapture={(event) => {
        // 悬停展开后点进输入框或联系人列表立即钉住，避免鼠标微移离开 300ms 后面板自动收起
        if (p.open && !p.pinned && event.target !== event.currentTarget) {
          peek.setExpand({ id: "unread", pinned: true });
        }
      }}
      {...p.bind}
    >
      <BlockShadow />
      <NineSlice id="map.panelBg" tint="rgb(14 14 23 / 72%)" slice={PANEL_SLICE} />
      <NineSlice id="map.panelFg" tint="var(--cp-red)" slice={PANEL_SLICE} />
      <div className={`${styles.inner} ${styles.unreadInner}`}>
        <Grow
          open={p.open}
          head={wide ? null : undefined}
          title="消息 · 芯片"
          hint="T"
          line="var(--cp-red)"
        >
          {full}
        </Grow>
        {p.open && tabs ? (
          <div className={styles.unreadTabs}>
            {tabs}
            <span className={styles.unreadTabMeta}>
              <span>{totalUnread > 0 ? `未读 ${totalUnread}` : "全部已读"}</span>
              {wide && <kbd className={styles.unreadKey}>T</kbd>}
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

/** 地点服务条：NineSlice CellFrame + 左侧状态竖条 + POI 图标 + 店名 + 业态标签 */
function ZoneServiceBar({
  icon,
  name,
  tag,
  blackMarket,
  onClick,
}: {
  readonly icon: AssetId;
  readonly name: string;
  readonly tag: string;
  readonly blackMarket?: boolean;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={styles.zoneService}
      data-black-market={blackMarket || undefined}
      onClick={onClick}
    >
      <CellFrame />
      <NineSlice
        id="cyber.cellRarity"
        tint="var(--service-rail, var(--cp-cyan))"
        slice={0}
        className={styles.zoneServiceRail}
      />
      <Asset id={icon} height={15} tint="currentColor" className={styles.zoneServiceIcon} />
      <span className={styles.zoneServiceName}>{name}</span>
      <span className={styles.zoneServiceTag}>{tag}</span>
      <span className={styles.zoneServiceGo} aria-hidden>
        ▸
      </span>
    </button>
  );
}

/**
 * B 地点、时间、热度：义眼叠加层，原作 zone_update 的框。
 * 不再悬停展开（用户定的，计划第十二节第 9 条）：威胁常态就列在框下面，没人盯上就不占地方；
 * 点地点框或按 Enter / 空格打开大地图，同 M 键。
 */
export function Zone({
  view,
  onMap,
  onShop,
  onRipperdoc,
}: {
  readonly view: View;
  readonly onMap: () => void;
  readonly onShop: (id: string) => void;
  readonly onRipperdoc: () => void;
}) {
  const { heat, stealth } = view;
  const bounty = heat.bounties.reduce((sum, b) => sum + b.reward, 0);
  const threats = [...view.threats].sort((a, b) => b.level - a.level);
  const shownThreats = threats.slice(0, ZONE_THREAT_MAX);
  return (
    <div className={`${styles.block} ${styles.zone}`} data-layer="optics">
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
      {(view.shops.length > 0 || view.ripperdoc) && (
        <section className={styles.zoneServices} aria-label="当前地点商家">
          {view.shops.map((shop) => (
            <ZoneServiceBar
              key={shop.id}
              icon={shopPoiIconOf(shop.kind)}
              name={shop.name}
              tag={shop.blackMarket ? "黑市" : "商店"}
              blackMarket={shop.blackMarket}
              onClick={() => onShop(shop.id)}
            />
          ))}
          {view.ripperdoc && (
            <ZoneServiceBar
              icon="map.poi.ripperdoc"
              name={view.ripperdoc.name}
              tag={view.ripperdoc.blackMarket ? "黑市" : "义体诊所"}
              blackMarket={view.ripperdoc.blackMarket}
              onClick={onRipperdoc}
            />
          )}
        </section>
      )}
    </div>
  );
}

/** C 追踪：统一展示在办事项/约定与附近可接动向；展开后适度加宽并切换待办/委托，children 是 D 系统通知 */
export function Track({
  view,
  peek,
  full,
  children,
}: {
  readonly view: View;
  readonly peek: PeekState;
  /** 钉住（点块或按 J）时块里放的完整内容 */
  readonly full: ReactNode;
  readonly children?: ReactNode;
}) {
  const p = usePeek("track", peek.expand, peek.setExpand);
  const track = trackTelemetry(view);
  const rows = track.preview.slice(0, TRACK_MAX);
  const statusPill =
    track.overdueCount > 0
      ? ({ tone: "bad", label: `超期 ${track.overdueCount}` } as const)
      : track.activeCount > 0
        ? ({ tone: "warn", label: `在办 ${track.activeCount}` } as const)
        : ({ tone: "muted", label: "空闲" } as const);
  const togglePin = () => {
    if (p.pinned) p.close();
    else peek.setExpand({ id: "track", pinned: true });
  };

  // 一直显示：手头只追真正揽下来的单子与约定
  return (
    <div
      className={`${styles.block} ${styles.track}`}
      data-layer="optics"
      data-open={p.open || undefined}
      data-pinned={p.pinned || undefined}
    >
      {
        // biome-ignore lint/a11y/useSemanticElements: 追踪框里套着可展开详情，不能整个换成 button
        <div
          className={styles.trackHit}
          role="button"
          tabIndex={0}
          aria-expanded={p.open}
          aria-label={`追踪，点击${p.pinned ? "取消固定" : "固定展开"}，按 J 切换，按 Esc 收起`}
          onClick={(event) => {
            if (isNestedInteractive(event.target, event.currentTarget)) return;
            togglePin();
          }}
          onKeyDown={(event) => {
            if (
              event.target === event.currentTarget &&
              (event.key === "Enter" || event.key === " ")
            ) {
              event.preventDefault();
              togglePin();
            }
          }}
          {...p.bind}
        >
          <BlockShadow />
          <Panel as="section" line="var(--cp-yellow)">
            <div className={styles.trackHead}>
              <span className={styles.trackHeadLeft}>
                <h2 className={styles.trackTitle}>追踪</h2>
                <span className={styles.trackStatus} data-tone={statusPill.tone}>
                  {statusPill.label}
                </span>
              </span>
              <kbd className={styles.trackKeyHint}>{p.pinned ? "ESC" : "J"}</kbd>
            </div>
            {/* 常态摘要在展开后收进 0fr，腾出纵向空间 */}
            <div className={styles.trackSummary}>
              <div className={styles.trackSummaryInner}>
                {rows.length === 0 ? (
                  <p className={styles.trackEmpty}>手头眼下没有在办单子或约定</p>
                ) : (
                  <>
                    <ul className={styles.trackList}>
                      {rows.map((r) => {
                        const loc =
                          r.location && !r.progress?.includes(r.location) ? r.location : null;
                        const sub = [r.sourceLabel, r.progress, loc].filter(Boolean).join(" · ");
                        return (
                          <li key={r.id} data-overdue={r.status === "overdue" || undefined}>
                            <Asset
                              id={r.icon}
                              tint={
                                r.status === "overdue" ? "var(--cp-danger)" : "var(--cp-yellow)"
                              }
                              height={20}
                            />
                            <span className={styles.trackItemText}>
                              <span className={styles.trackItemTop}>
                                <b>{r.title}</b>
                                {r.dueLabel && (
                                  <time data-overdue={r.status === "overdue" || undefined}>
                                    {r.dueLabel}
                                  </time>
                                )}
                              </span>
                              {sub && <small>{sub}</small>}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                    {track.activeCount > rows.length && (
                      <p className={styles.trackMore}>
                        +{track.activeCount - rows.length} 项在办 · 展开查看
                      </p>
                    )}
                  </>
                )}
              </div>
            </div>
            <Grow open={p.open} line="var(--cp-yellow)">
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
const MAX_HUD_WEAPONS = 3;

/** H 随身武器与物品栏：平权并排显示随身武器缩略格，治疗与手雷（含超重提醒）稳在底行；hover 预览、点一下钉住 */
export function Weapon({
  view,
  peek,
  full,
  tabs,
}: {
  readonly view: View;
  readonly peek: PeekState;
  /** 展开区里的完整物品栏 */
  readonly full: ReactNode;
  /** 展开区底部的页签 */
  readonly tabs?: ReactNode;
}) {
  const { inventory, money } = view;
  const eddiesText = money.eddies.toLocaleString("en-US");
  const p = usePeek("weapon", peek.expand, peek.setExpand);
  const wideOn = useLinger(p.open);
  const weapons = inventory.carriedWeapons;
  const soleWeapon = weapons.length === 1 ? weapons[0] : undefined;
  const shownWeapons = weapons.slice(0, MAX_HUD_WEAPONS);
  const extraWeapons = weapons.slice(MAX_HUD_WEAPONS);
  const weaponMeta = (w: (typeof weapons)[number]) => {
    const name = view.names.items[w.id] ?? w.id;
    const detail = inventory.details?.[w.id];
    return {
      name,
      subLabel: detail?.subLabel,
      rarity: detail?.rarity ?? inventory.rarity[w.id],
      icon: weaponHudIconOf(w.id, detail?.subLabel),
      tip: [name, detail?.subLabel, w.bulky ? "大件" : null].filter(Boolean).join(" · "),
    };
  };
  return (
    // biome-ignore lint/a11y/useSemanticElements: 块里套着物品栏展开按钮，不能整个换成 button
    <div
      className={`${styles.block} ${styles.weapon}`}
      data-layer="os"
      data-open={p.open || undefined}
      data-pinned={p.pinned || undefined}
      data-wide={wideOn || undefined}
      aria-label="武器、物品栏与车辆，点击固定展开，按 Esc 收起"
      role="button"
      tabIndex={0}
      aria-expanded={p.open}
      onClick={(event) => {
        if (isNestedInteractive(event.target, event.currentTarget)) return;
        if (
          p.pinned &&
          event.target instanceof Element &&
          event.target.closest(`.${styles.grow}`)
        ) {
          return;
        }
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
      {...p.bind}
    >
      <div className={styles.slot}>
        <BlockShadow />
        <NineSlice
          id="hud.slotBg"
          tint={p.open ? "rgb(8 11 18 / 97%)" : "rgb(14 14 23 / 90%)"}
          slice={SLOT_SLICE}
        />
        <NineSlice id="hud.slotFg" tint="rgb(94 246 255 / 80%)" slice={SLOT_SLICE} />
        <Grow open={p.open} title="装备 · 物品栏与车辆" hint="O" line="var(--cp-cyan)">
          {full}
        </Grow>
        {p.open && tabs && <div className={styles.unreadTabs}>{tabs}</div>}
        <div className={styles.inner}>
          <span className={styles.slotMain}>
            {!p.open &&
              (weapons.length === 0 ? (
                <span className={styles.slotHead}>
                  <Asset id="weapon.fists" tint="var(--cp-cyan)" height={22} alt="徒手" />
                  <b>徒手</b>
                </span>
              ) : soleWeapon ? (
                (() => {
                  const meta = weaponMeta(soleWeapon);
                  return (
                    <div
                      className={styles.slotWeaponSingle}
                      data-rarity={meta.rarity ?? undefined}
                      data-bulky={soleWeapon.bulky || undefined}
                      title={meta.tip}
                    >
                      <span className={styles.slotWeaponRail} aria-hidden />
                      <span className={styles.slotWeaponSingleText}>
                        <b>
                          {meta.name}
                          {soleWeapon.count > 1 && (
                            <small className={styles.slotWeaponCount}> ×{soleWeapon.count}</small>
                          )}
                        </b>
                        {meta.subLabel && <small className={styles.slotSub}>{meta.subLabel}</small>}
                      </span>
                      <Asset
                        id={meta.icon}
                        tint="var(--cp-cyan)"
                        height={28}
                        className={styles.slotWeaponArt}
                      />
                    </div>
                  );
                })()
              ) : (
                <ul className={styles.slotWeapons} aria-label="随身武器">
                  {shownWeapons.map((w) => {
                    const meta = weaponMeta(w);
                    return (
                      <li
                        key={w.id}
                        className={styles.slotWeapon}
                        data-rarity={meta.rarity ?? undefined}
                        data-bulky={w.bulky || undefined}
                        title={meta.tip}
                      >
                        <span className={styles.slotWeaponRail} aria-hidden />
                        <Asset
                          id={meta.icon}
                          tint="var(--cp-cyan)"
                          height={20}
                          className={styles.slotWeaponArt}
                        />
                        <span className={styles.slotWeaponName}>
                          {meta.name}
                          {w.count > 1 && (
                            <small className={styles.slotWeaponCount}> ×{w.count}</small>
                          )}
                        </span>
                      </li>
                    );
                  })}
                  {extraWeapons.length > 0 && (
                    <li
                      className={styles.slotWeaponMore}
                      title={extraWeapons.map((w) => view.names.items[w.id] ?? w.id).join("、")}
                    >
                      +{extraWeapons.length}
                    </li>
                  )}
                </ul>
              ))}
            <span className={styles.slotFoot}>
              <small className={styles.slotLine}>
                {p.open && (
                  <>
                    {weapons.length > 0 ? `随身武器 ${weapons.length} 把` : "徒手"}
                    {" · "}
                  </>
                )}
                {inventory.healing
                  ? `治疗 ${inventory.healing.charges}/${inventory.healing.max}`
                  : "无治疗品"}
                {" · "}
                {inventory.grenade
                  ? `手雷 ${inventory.grenade.charges}/${inventory.grenade.max}`
                  : "无手雷"}
                {inventory.bulky.overloaded && (
                  <span className={styles.slotOverload}>
                    {" · "}沉重 {inventory.bulky.count}/{inventory.bulky.max}
                  </span>
                )}
              </small>
              <span className={styles.slotFootMeta}>
                <span className={styles.slotCash} title={`随身欧元：${eddiesText} 欧元`}>
                  <Asset id="notify.cash" tint="var(--cp-yellow)" height={11} />
                  <strong>{eddiesText}</strong>
                  <small className={styles.slotCashUnit}>欧元</small>
                </span>
                <kbd className={styles.slotHint}>{p.pinned ? "ESC" : "O"}</kbd>
              </span>
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}

const HOLO_SLICE = [4, 20, 20, 4] as const;

/** 全息来电 HUD（仅在有来电呼入时出现在左栏，照原作左上角全息头像+声波条） */
export function HoloCall({
  view,
  onOpenPhone,
}: {
  readonly view: View;
  readonly onOpenPhone: () => void;
}) {
  const incoming = view.calls?.incoming;
  if (!incoming) return null;
  const npc = view.npcs.find((n) => n.id === incoming.from);
  const caller = {
    id: incoming.from,
    name: incoming.name,
    met: npc?.met ?? true,
    alive: npc?.alive ?? true,
  };
  const scanlineImg = cssUrl("fx.scanlines");

  return (
    <button
      type="button"
      className={`${styles.block} ${styles.holocall}`}
      data-layer="optics"
      onClick={onOpenPhone}
      aria-label={`全息来电：${incoming.name}，点击查看消息`}
    >
      <BlockShadow />
      <NineSlice id="dialog.lineSelect" tint="rgb(10 18 28 / 92%)" slice={HOLO_SLICE} />
      <NineSlice
        id="panel.glowLeft"
        tint="rgb(94 246 255 / 22%)"
        slice={[16, 20, 16, 20]}
        className={styles.holoGlow}
      />
      <div className={`${styles.inner} ${styles.holoRow}`}>
        <span className={styles.holoFaceWrap}>
          <NpcPortrait
            npc={caller}
            className={styles.personFace}
            artClassName={styles.personFaceArt}
            line="var(--cp-cyan)"
          />
          {scanlineImg && (
            <span
              className={styles.holoScan}
              style={{ backgroundImage: scanlineImg }}
              aria-hidden
            />
          )}
        </span>
        <span className={styles.holoMeta}>
          <small>{"HOLOCALL // 来电接入"}</small>
          <b>{incoming.name}</b>
          <span>{incoming.statusLabel} · 点击查看终端</span>
        </span>
        <span className={styles.holoWave} aria-hidden>
          <i />
          <i />
          <i />
          <i />
        </span>
      </div>
    </button>
  );
}

/** 横幅：交战、对峙、潜网、闪回，同时只出一个（交战最先） */
export function Banner({ view }: { readonly view: View }) {
  const { combat, character, humanity, psychosis } = view;
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
  if (psychosis.blackoutOpen) {
    return (
      <Panel as="section" line="var(--cp-red)" className={styles.banner}>
        <div className={styles.bannerRow} role="status">
          <Asset id="notify.warning" tint="var(--cp-red)" height={26} />
          <b>神经过载</b>
          <span>记忆区段正在丢失——你的手在动，意识却像隔着磨砂玻璃</span>
        </div>
      </Panel>
    );
  }
  if (psychosis.suppressant.withdrawal) {
    return (
      <Panel as="section" line="var(--cp-red)" className={styles.banner}>
        <div className={styles.bannerRow} role="status">
          <Asset id="notify.warning" tint="var(--cp-red)" height={26} />
          <b>戒断反应</b>
          <span>冷汗浸透领口，视神经底层泛起噪点——停药太久了</span>
        </div>
      </Panel>
    );
  }
  if (humanity.current === 0 && !humanity.suppressed) {
    return (
      <Panel as="section" line="var(--voice-humanity)" className={styles.banner}>
        <div className={styles.bannerRow} role="status">
          <Asset id="notify.attention" tint="var(--voice-humanity)" height={26} />
          <b>义体排异</b>
          <span>金属与神经的接缝在尖叫；委托与街道照旧转动，只是理智已悬在刀尖上</span>
        </div>
      </Panel>
    );
  }
  return null;
}
