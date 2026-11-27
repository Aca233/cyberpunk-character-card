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
import { ITEM_CELL_SLICE, Panel } from "../../ui/Panel";
import { useCardTilt } from "../../ui/useCardTilt";
import { GeneratedImage } from "../images/GeneratedImage";
import { useSaveImages } from "../images/SaveImagesContext";
import { shopPoiIconOf, weaponHudIconOf } from "./art";
import styles from "./corners.module.css";
import neural from "./neural.module.css";
import {
  type CombatFoe,
  NpcPortrait,
  npcRelationTag,
  Profile,
  profileTone,
  threatOfHumanity,
} from "./Profile";
import { type Expand, type SetExpand, usePeek } from "./peek";
import {
  displayItemName,
  districtIcon,
  locationLabel,
  neuroTelemetry,
  npcWoundSummary,
  trackTelemetry,
  type View,
  woundTelemetry,
} from "./view";
import { weaponPreview } from "./weaponPreview";

/**
 * 四角（2077-interface-plan.md 第九节）：A 生物监测左上、S 在场的人左中、G 未读左下、
 * B 地点右上、C 追踪右中、H 随身武器与物品栏右下，横幅在中列顶上。
 * 点击卡片或按快捷键（P/J/T/O）就地朝屏幕中间展开、盖在中列上，块本身不动；悬停仅触发 3D 按压质感，不自动展开。
 * 素材和切法照 U0 视觉稿 NeuralMock，不用 CSS 画边框
 */

/** 九宫格切法照正式页面里同一张素材的用法 */
const CELL_SLICE = [20, 30, 30, 20] as const; // MapPanel 筛选格 map.filterCell*
const QH_CELL_SLICE = [18, 22, 22, 18] as const; // 原作 qh.cell* 切角读数格
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
      tint="rgb(0 0 0 / 46%)"
      slice={SHADOW_SLICE}
      className={styles.shadow}
    />
  );
}

/**
 * 贴合原作九宫格斜切轮廓的压铸暗面材质 + 随 3D 倾角流动的斜向掠射玻璃高光。
 * 直接用同款九宫格蒙版裁切，保证斜切角、缺口完全吻合不漏矩形死角；展开态自动隐去。
 */
function CardGlare({
  maskId,
  slice,
  tone = "cyan",
}: {
  readonly maskId: AssetId;
  readonly slice: number | readonly [number, number, number, number];
  readonly tone?: "red" | "cyan" | "yellow";
}) {
  const toneClass =
    tone === "red" ? styles.glareRed : tone === "yellow" ? styles.glareYellow : styles.glareCyan;
  return (
    <NineSlice
      id={maskId}
      tint="transparent"
      slice={slice}
      className={`${styles.cardGlare} ${toneClass}`}
    />
  );
}

/**
 * 贴合原作九宫格斜切框线（*Fg）的赛博能量流光边框：
 * 用同款 *Fg 蒙版裁切双光束旋转锥形渐变 + 悬停电弧追踪热点，零矩形漏边、完整走过斜切角与缺口；
 * 展开抽屉后自动收敛为柔和呼吸流光，低血/敌对/紧急态自动提速增亮。
 */
function CardBorderFx({
  maskId,
  slice,
  tone = "cyan",
  phase = 0,
  urgent = false,
}: {
  readonly maskId: AssetId;
  readonly slice: number | readonly [number, number, number, number];
  readonly tone?: "red" | "cyan" | "yellow" | "danger";
  /** 错开各角卡片的光束起始相位（秒，负值表示从周期中间起跑，避免全屏齐步转） */
  readonly phase?: number;
  readonly urgent?: boolean;
}) {
  const toneClass =
    tone === "danger"
      ? styles.borderFxDanger
      : tone === "red"
        ? styles.borderFxRed
        : tone === "yellow"
          ? styles.borderFxYellow
          : styles.borderFxCyan;
  const style =
    phase !== 0 ? ({ ["--border-delay" as string]: `${phase}s` } as CSSProperties) : undefined;
  return (
    <NineSlice
      id={maskId}
      tint="transparent"
      slice={slice}
      {...(style ? { style } : {})}
      className={`${styles.cardBorderFx} ${toneClass}${urgent ? ` ${styles.borderFxUrgent}` : ""}`}
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
  /** id、名字、角标数、可选激活圆点（如当前有可达存放点） */
  readonly tabs: readonly (readonly [T, string, number] | readonly [T, string, number, boolean])[];
  readonly value: T;
  readonly onChange: (id: T) => void;
}) {
  return (
    <nav className={neural.pinTabs}>
      {tabs.map(([id, name, badge, dot]) => (
        <button
          key={id}
          type="button"
          className={neural.tab}
          aria-pressed={id === value}
          data-sfx={id === value ? "none" : "tab"}
          onClick={() => onChange(id)}
        >
          <NineSlice id="tab.bg" tint="currentColor" slice={14} className={neural.tabBg} />
          <span className={neural.inner}>
            {dot && <i className={neural.tabDot} aria-hidden />}
            {name}
            {badge > 0 && <b className={neural.badge}>{badge}</b>}
          </span>
        </button>
      ))}
    </nav>
  );
}

/**
 * 一侧的角块排成一列：一块长高时把同侧别的块推开，不盖住；
 * quiet（沉浸模式）下非展开角块柔和退隐，悬停或钉住时立刻恢复清晰
 */
export function CornerSide({
  side,
  quiet = false,
  children,
}: {
  readonly side: "left" | "right";
  readonly quiet?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <div className={styles.side} data-side={side} data-quiet={quiet || undefined}>
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
      // 在场人物展开时顶栏与常态摘要格均收起为 0，固定边距仅为展开框自身上下内边距（避免过渡首帧把尚未收完的摘要算进 fixed 导致 185ms 后跳高）
      const isPersonCard = Boolean(el.closest(`.${styles.person}`));
      const fixed = isPersonCard
        ? 24
        : block.getBoundingClientRect().height - el.getBoundingClientRect().height;
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

export type BioTabId = "character" | "deck" | "cyberware" | "chronicle";

/** A 生物监测（3.1）：紧凑斜切 HUD 卡片（血条/神经稳态/硬件一行，点击整卡或按 P 展开） */
export function BioMonitor({
  view,
  peek,
  full,
  tabs,
  wide = false,
  diag = false,
  onOpenTab,
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
  /** 点击紧急告警时直接展开到指定页签 */
  readonly onOpenTab?: ((tab: BioTabId) => void) | undefined;
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
  const saveImages = useSaveImages();
  const portraitId = saveImages?.bindings.playerPortrait ?? character.portrait ?? null;
  const p = usePeek("bio", peek.expand, peek.setExpand);
  const tilt = useCardTilt<HTMLDivElement>({
    disabled: p.open,
    maxRotate: 5.8,
    shadowShift: 5,
    restRy: 7.5,
  });
  // 整块收起时等内容收完再变回原宽；还开着时切页签直接跟着变，宽度由 CSS 过渡
  const lingeredWide = useLinger(wide && p.open);
  const lingeredDiag = useLinger(diag && p.open);
  const wideOn = p.open ? wide : lingeredWide;
  const diagOn = p.open ? diag && !wide : !wideOn && lingeredDiag;
  const resizing = useResizing(wideOn || diagOn, p.open);

  const deckTone =
    hacking?.thermal.level === "critical" || hacking?.traceAlert
      ? "bad"
      : hacking?.thermal.level === "hot"
        ? "warn"
        : undefined;
  const deckStatusTitle = hacking
    ? [
        hacking.deckName,
        `热负荷：${hacking.thermal.label}（${hacking.thermal.heat}/${hacking.thermal.maxHeat}）`,
        `已插装 ${hacking.programs.length}/${hacking.slots} 枚程序`,
        hacking.traceAlert ? `反追踪警报：${hacking.traceAlert.target}` : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : undefined;

  const urgentAlert: {
    readonly label: string;
    readonly tone: "bad" | "warn";
    readonly title: string;
    readonly target?: BioTabId;
  } | null = hacking?.traceAlert
    ? {
        label: "反追踪",
        tone: "bad",
        title: `检测到反向追踪信号（${hacking.traceAlert.target} · ${hacking.traceAlert.at}）：点击查看接入仓`,
        target: "deck",
      }
    : hacking?.thermal.level === "critical"
      ? {
          label: `过载 ${hacking.thermal.heat}/${hacking.thermal.maxHeat}`,
          tone: "bad",
          title: "接入仓神经热负荷达到过载临界，继续硬发破解会反烧大脑",
          target: "deck",
        }
      : health.lostLimbs.length > 0
        ? {
            label: "肢体缺损",
            tone: "bad",
            title: `缺损部位：${health.lostLimbs.join("、")}`,
            target: "character",
          }
        : brokenCount > 0
          ? {
              label: `义体损毁 ×${brokenCount}`,
              tone: "bad",
              title: "有义体已损毁，需前往义体医生检修，点击打开义体页",
              target: "cyberware",
            }
          : time.blackLaceWithdrawal
            ? {
                label: "黑蕾丝戒断",
                tone: "bad",
                title: "黑蕾丝停药戒断中，神经反应受损",
                target: "character",
              }
            : trauma.active && !trauma.coverage.ok
              ? {
                  label: "TT受阻",
                  tone: "warn",
                  title: `创伤小组救援受阻：${trauma.coverage.why}`,
                  target: "character",
                }
              : time.fatigued
                ? {
                    label: "疲劳",
                    tone: "warn",
                    title: "连续熬夜导致疲劳，需休息恢复",
                    target: "character",
                  }
                : null;

  const neuroStageTag = psychosis.blackoutOpen
    ? `${humanity.stageLabel}·盲区`
    : psychosis.suppressant.until
      ? `${humanity.stageLabel}·阻断`
      : psychosis.suppressant.withdrawal
        ? `${humanity.stageLabel}·戒断`
        : humanity.stageLabel;

  const primaryWound = wound.items[0];
  const vitalLabel = primaryWound
    ? `${primaryWound.partLabel}${primaryWound.tierLabel}${wound.items.length > 1 ? ` +${wound.items.length - 1}` : ""}`
    : wound.tone === "ok"
      ? wound.scars.length > 0
        ? `无伤 · 疤${wound.scars.length}`
        : "完好"
      : `${wound.title}${health.painSuppressed && wound.level === 2 ? " · 镇痛" : ""}`;
  const vitalTitle = primaryWound
    ? wound.items
        .slice(0, 3)
        .map((item) => `${item.partLabel}${item.tierLabel}（${item.cause} · ${item.careTag}）`)
        .join(" / ")
    : wound.scars.length > 0
      ? `机能完好 · 旧疤：${wound.scars.map((s) => s.summary).join("；")}`
      : "体征平稳，无活动创伤";

  const installedCyberCount = cyberware.filter((c) => !c.broken).length;
  // 右侧硬件槽：按角色核心装备优先显示 接入仓 > 斯安威斯坦 > 创伤小组 > 义体数
  const hardwareStat: {
    readonly key: string;
    readonly value: string;
    readonly tone: "cyan" | "warn" | "bad" | "sandy" | "good" | undefined;
    readonly title: string;
  } = hacking
    ? {
        key: hacking.thermal.heat > 0 ? "热负荷" : "接入仓",
        value:
          hacking.thermal.heat > 0
            ? `${hacking.thermal.heat}/${hacking.thermal.maxHeat}`
            : `${hacking.programs.length}/${hacking.slots} 槽`,
        tone: deckTone ?? "cyan",
        title: deckStatusTitle ?? hacking.deckName,
      }
    : sandevistan
      ? {
          key: "操作系统",
          value: "斯安威斯坦",
          tone: "sandy",
          title: `斯安威斯坦已装机：${sandevistan.name}`,
        }
      : trauma.active
        ? {
            key: "创伤小组",
            value: trauma.coverage.ok ? trauma.tierLabel : "受阻",
            tone: trauma.coverage.ok ? "good" : "warn",
            title: trauma.coverage.ok
              ? `创伤小组 ${trauma.tierLabel} 保障待命`
              : `创伤小组救援受阻：${trauma.coverage.why}`,
          }
        : {
            key: "义体",
            value: `${installedCyberCount} 件`,
            tone: brokenCount > 0 ? "bad" : undefined,
            title:
              brokenCount > 0
                ? `已装 ${installedCyberCount} 件义体，另有 ${brokenCount} 件损毁待修`
                : `当前已装机 ${installedCyberCount} 件义体`,
          };

  const neuroTitle = `神经稳态 ${humanity.current}/100 · ${neuro.summary}${
    psychosis.suppressant.until
      ? ` · 免疫抑剂至 ${psychosis.suppressant.until}`
      : psychosis.suppressant.withdrawal
        ? " · 停药戒断中"
        : ""
  }`;
  const neuroCellCount = 12;
  const activeNeuroCells = Math.max(
    0,
    Math.min(neuroCellCount, Math.round((humanity.current / 100) * neuroCellCount)),
  );
  const vitalCellLine =
    wound.tone === "bad" || wound.tone === "dead"
      ? "rgb(255 0 60 / 62%)"
      : wound.tone === "hurt"
        ? "rgb(255 156 66 / 54%)"
        : wound.tone === "warn"
          ? "rgb(252 238 10 / 48%)"
          : "rgb(255 97 88 / 32%)";
  const hwCellLine =
    hardwareStat.tone === "bad"
      ? "rgb(255 0 60 / 62%)"
      : hardwareStat.tone === "warn" || hardwareStat.tone === "sandy"
        ? "rgb(252 238 10 / 46%)"
        : hardwareStat.tone === "good"
          ? "rgb(63 230 160 / 46%)"
          : "rgb(94 246 255 / 34%)";
  const neuroGaugeTone = neuro.tone === "bad" ? "bad" : neuro.tone === "warn" ? "warn" : "ok";

  const openOrToggle = (tab: BioTabId) => {
    if (onOpenTab) {
      onOpenTab(tab);
    } else {
      p.toggle();
    }
  };

  return (
    // biome-ignore lint/a11y/useSemanticElements: 块里套着面板和按钮，不能整个换成 button
    <div
      className={`${styles.block} ${styles.bio}`}
      data-layer="os"
      data-low={low || undefined}
      data-open={p.open || undefined}
      data-wide={wideOn || undefined}
      data-diag={diagOn || undefined}
      data-resizing={resizing || undefined}
      role="button"
      tabIndex={0}
      aria-expanded={p.open}
      aria-label={`生物监测，点击${p.open ? "收起" : "展开"}，按 P 或 Esc 收起`}
      onClick={(event) => {
        if (isNestedInteractive(event.target, event.currentTarget)) return;
        if (
          event.target instanceof Element &&
          event.target.closest(`.${styles.grow}`) &&
          !event.target.closest(`.${styles.bioDrawerHead}`)
        ) {
          return;
        }
        p.toggle();
      }}
      onKeyDown={(event) => {
        if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          p.toggle();
        }
      }}
      {...tilt}
    >
      <BlockShadow />
      <Panel
        as="section"
        line="var(--cp-red)"
        className={styles.bioPanel}
        surface={<CardGlare maskId="notify.itemCellBg" slice={ITEM_CELL_SLICE} tone="red" />}
        borderFx={
          <CardBorderFx
            maskId="notify.itemCellFg"
            slice={ITEM_CELL_SLICE}
            tone={low ? "danger" : "red"}
            phase={-0.6}
            urgent={low || neuro.tone === "bad" || urgentAlert?.tone === "bad"}
          />
        }
      >
        {/* 常态：2077 生物监测终端卡——顶部系统标尺、主体头像/代号+体征/硬件双切角读数格、底部 12 格神经稳态刻槽 */}
        <div className={styles.bioHud}>
          <div className={styles.bioHudInner}>
            <div className={styles.bioHudBar}>
              <span className={styles.bioCodeTag}>KIROSHI {"//"} BIOMON</span>
              <span
                className={styles.bioBarLine}
                style={{ maskImage: cssUrl("tab.line"), WebkitMaskImage: cssUrl("tab.line") }}
                aria-hidden
              />
              {urgentAlert &&
                (urgentAlert.target && onOpenTab ? (
                  <button
                    type="button"
                    className={styles.bioUrgent}
                    data-tone={urgentAlert.tone}
                    title={urgentAlert.title}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (urgentAlert.target) openOrToggle(urgentAlert.target);
                    }}
                  >
                    {urgentAlert.label}
                  </button>
                ) : (
                  <span
                    className={styles.bioUrgent}
                    data-tone={urgentAlert.tone}
                    title={urgentAlert.title}
                  >
                    {urgentAlert.label}
                  </span>
                ))}
              <kbd className={styles.bioKeyHint}>P</kbd>
            </div>

            <div className={styles.bioTopRow}>
              <span
                className={styles.bioEmblem}
                data-portrait={portraitId ? true : undefined}
                title={`${character.name ?? "宿主"} · 外界风声 ${character.reputationLabel}：${character.reputationSummary}`}
              >
                <NineSlice
                  id="map.filterCellBg"
                  tint="var(--cp-surface-strong)"
                  slice={CELL_SLICE}
                  className={styles.bioEmblemBg}
                />
                {portraitId ? (
                  <GeneratedImage
                    imageId={portraitId}
                    alt={character.name ?? "主角头像"}
                    className={styles.bioEmblemArt}
                    fallback={<Asset id="portrait.unknown" className={styles.bioEmblemArt} />}
                  />
                ) : (
                  <Asset id="portrait.unknown" className={styles.bioEmblemArt} />
                )}
                <NineSlice
                  id="map.filterCellFg"
                  tint={low ? "var(--cp-danger)" : "rgb(255 97 88 / 72%)"}
                  slice={CELL_SLICE}
                  className={styles.bioEmblemFg}
                />
              </span>

              <div className={styles.bioIdentCol}>
                <div className={styles.bioNameRow}>
                  <b className={styles.bioCallsign}>{character.name ?? "宿主"}</b>
                  <span className={styles.bioCred} title={character.reputationSummary}>
                    {character.reputationLabel}
                  </span>
                  {trauma.active && (
                    <span
                      className={styles.bioTtTag}
                      data-blocked={!trauma.coverage.ok || undefined}
                      title={
                        trauma.coverage.ok
                          ? `创伤小组 ${trauma.tierLabel} 保障待命`
                          : `创伤小组受阻：${trauma.coverage.why}`
                      }
                    >
                      TT·{trauma.tierLabel}
                    </span>
                  )}
                  <kbd className={styles.bioCompactKey}>P</kbd>
                </div>

                <div className={styles.bioCells}>
                  <div className={styles.bioCell} data-tone={wound.tone} title={vitalTitle}>
                    <NineSlice
                      id="qh.cellBg"
                      tint={low ? "rgb(36 9 16 / 86%)" : "rgb(14 14 23 / 78%)"}
                      slice={QH_CELL_SLICE}
                      className={styles.bioCellFrame}
                    />
                    <NineSlice
                      id="qh.cellFg"
                      tint={vitalCellLine}
                      slice={QH_CELL_SLICE}
                      className={styles.bioCellFrame}
                    />
                    <span className={styles.bioCellKey}>体征</span>
                    <strong className={styles.bioCellVal}>{vitalLabel}</strong>
                  </div>

                  <div
                    className={styles.bioCell}
                    data-tone={hardwareStat.tone}
                    title={hardwareStat.title}
                  >
                    <NineSlice
                      id="qh.cellBg"
                      tint={
                        hardwareStat.tone === "bad" ? "rgb(36 9 16 / 86%)" : "rgb(14 16 26 / 78%)"
                      }
                      slice={QH_CELL_SLICE}
                      className={styles.bioCellFrame}
                    />
                    <NineSlice
                      id="qh.cellFg"
                      tint={hwCellLine}
                      slice={QH_CELL_SLICE}
                      className={styles.bioCellFrame}
                    />
                    <span className={styles.bioCellKey}>{hardwareStat.key}</span>
                    <strong className={styles.bioCellVal}>{hardwareStat.value}</strong>
                  </div>
                </div>
              </div>
            </div>

            <div className={styles.bioNeuroStrip} data-tone={neuroGaugeTone} title={neuroTitle}>
              <div className={styles.bioNeuroHead}>
                <span className={styles.bioNeuroKey}>NEURO {"//"} 神经稳态</span>
                <span className={styles.bioNeuroVal}>
                  <em className={styles.bioNeuroStage}>{neuroStageTag}</em>
                  <b className={styles.bioNeuroScore}>{humanity.current}</b>
                </span>
              </div>
              <div className={styles.bioNeuroGauge} aria-hidden="true">
                {Array.from({ length: neuroCellCount }, (_, idx) => {
                  const active = idx < activeNeuroCells;
                  return (
                    <span
                      // biome-ignore lint/suspicious/noArrayIndexKey: 12 格固定神经稳态刻槽
                      key={idx}
                      className={styles.bioNeuroCell}
                      data-on={active || undefined}
                      data-tone={active ? neuroGaugeTone : undefined}
                    />
                  );
                })}
              </div>
            </div>
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
                <kbd title="点击顶栏、按 P 或 Esc 收起">ESC</kbd>
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
  readonly tone: "cyan" | "yellow" | "red" | "danger";
  readonly solid?: boolean;
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
  foe: CombatFoe | undefined,
  breached = false,
): PersonBadge[] {
  const badges: PersonBadge[] = [];
  if (foe) {
    badges.push({ label: foe.stateLabel, tone: "danger", solid: true });
  }
  if (person.nemesis && !person.nemesis.ended) {
    badges.push({ label: "宿敌", tone: "red", solid: true });
  }
  if (breached) {
    badges.push({ label: "已破冰", tone: "cyan" });
  }
  if (person.following) {
    badges.push({ label: "同行", tone: "yellow" });
  }
  if (fixer) {
    badges.push({ label: "中间人", tone: "yellow" });
  }
  const scanChrome = person.body?.scan?.chrome ?? [];
  if (scanChrome.some((c) => c.netTag === "deck")) {
    badges.push({ label: "接入仓", tone: "cyan" });
  }
  if (scanChrome.some((c) => c.netTag === "selfIce")) {
    badges.push({ label: "自我 ICE", tone: "yellow" });
  }
  // 具象创口在 .personWound 单独一行展示部位与原因；仅当只有模糊等级时兜底用小牌提示
  const hasDetailedWounds = (person.body?.injuries?.length ?? 0) > 0;
  const wound = !hasDetailedWounds && person.body ? npcWoundSummary(person.body) : null;
  if (wound?.badge) {
    const high = wound.threat === "high";
    badges.push({
      label: wound.badge,
      tone: high ? "danger" : "yellow",
      solid: high,
    });
  }
  return badges.slice(0, 3);
}

/** 展开某人时顶部快切条里的目标项 */
interface QuickSwitchTarget {
  readonly id: string;
  readonly name: string;
  readonly tone: "hostile" | "nemesis" | "ally" | undefined;
}

interface PersonHackStatus {
  readonly breached: boolean;
  readonly breachedVia?: string | null | undefined;
  readonly activeEffects: readonly string[];
}

/** S 里的一个人：鼠标停在名字格上展开人物档案，点击固定/取消固定 */
function PresentPerson({
  person,
  fixer,
  foe,
  hackStatus,
  index,
  scan,
  groupOpen,
  hasOptics,
  peek,
  switchTargets,
  onScan,
  onCompanion,
  onDraftAction,
}: {
  readonly person: Npc;
  readonly fixer?: Fixer | undefined;
  readonly foe?: CombatFoe | undefined;
  readonly hackStatus?: PersonHackStatus | undefined;
  readonly index: number;
  readonly scan: boolean;
  readonly groupOpen: boolean;
  readonly hasOptics: boolean;
  readonly peek: PeekState;
  readonly switchTargets: readonly QuickSwitchTarget[];
  readonly onScan?: ((id: string) => void) | undefined;
  readonly onCompanion?: ((id: string, following: boolean) => void) | undefined;
  readonly onDraftAction?: ((text: string) => void) | undefined;
}) {
  const s = person.body?.scan ?? null;
  const injuries = person.body?.injuries ?? [];
  const wound = npcWoundSummary(person.body);
  const p = usePeek(`person:${person.id}`, peek.expand, peek.setExpand);
  // 义眼扫描模式开启时让给扫描卡
  const open = p.open && !scan;
  // 名字格展开时加宽：收起时等档案收完再缩回原宽，不在收到一半时把档案挤成窄条；同组已展开时候选槽位直接就位
  const lingeredOpen = useLinger(open);
  const wideOn = open || (groupOpen && !scan) || lingeredOpen;
  const tone = profileTone(person, foe);
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
  const badges = personBadges(person, fixer, foe, hackStatus?.breached);
  const humanityThreat = s ? threatOfHumanity(s.humanityStage) : undefined;
  const scanAlert =
    Boolean(foe) || wound.threat === "high" || humanityThreat === "high" || s?.threat === "high";
  const scanStatusText = s
    ? s.threatLabel
    : foe
      ? injuries.length > 0
        ? `${foe.stateLabel} · ${wound.headline}`
        : wound.badge
          ? `${foe.stateLabel} · ${wound.badge}`
          : foe.stateLabel
      : injuries.length > 0
        ? wound.headline
        : (wound.badge ?? (person.alive ? "存活" : "死亡"));
  const scanStatusThreat = s ? s.threat : foe || wound.threat === "high" ? "high" : wound.threat;
  const netThreat =
    s?.netStatus === "open"
      ? "low"
      : s?.netStatus === "selfIce" || s?.netStatus === "netrunner"
        ? "high"
        : undefined;
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
  const primaryTip = s?.tips[0] ?? null;
  const tilt = useCardTilt<HTMLDivElement>({
    disabled: open || wideOn,
    maxRotate: 5.2,
    shadowShift: 4,
  });
  return (
    // biome-ignore lint/a11y/useSemanticElements: 名字格里套着九宫格和展开面板，不能换成 button
    <div
      className={styles.person}
      style={{ "--i": index } as CSSProperties}
      data-open={wideOn || undefined}
      data-active={open || (groupOpen && !scan) || undefined}
      data-tone={tone}
      role="button"
      tabIndex={0}
      aria-expanded={open}
      aria-label={`${person.name}，${subLabel}${wound.detail ? `，${wound.detail}` : ""}，点击${p.open ? "收起" : "展开"}，按 Esc 收起`}
      onClick={(event) => {
        if (isNestedInteractive(event.target, event.currentTarget)) return;
        if (event.target instanceof Element && event.target.closest(`.${styles.grow}`)) return;
        p.toggle();
      }}
      onKeyDown={(event) => {
        if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          p.toggle();
        }
      }}
      {...tilt}
    >
      <BlockShadow />
      <NineSlice
        id="map.filterCellBg"
        tint="var(--person-bg, var(--cp-surface))"
        slice={CELL_SLICE}
      />
      <CardGlare
        maskId="map.filterCellBg"
        slice={CELL_SLICE}
        tone={
          tone === "hostile" || tone === "nemesis" ? "red" : tone === "ally" ? "yellow" : "cyan"
        }
      />
      <NineSlice id="map.filterCellFg" tint="var(--person-line)" slice={CELL_SLICE} />
      <CardBorderFx
        maskId="map.filterCellFg"
        slice={CELL_SLICE}
        tone={
          tone === "hostile" || tone === "nemesis" ? "danger" : tone === "ally" ? "yellow" : "cyan"
        }
        phase={-1.4}
        urgent={tone === "hostile" || tone === "nemesis"}
      />
      <NineSlice
        id="panel.glowLeft"
        tint="var(--person-glow, rgb(94 246 255 / 12%))"
        slice={[16, 20, 16, 20]}
        className={styles.personGlow}
      />
      <NineSlice
        id="cyber.cellRarity"
        tint="var(--person-rail, var(--cp-cyan))"
        slice={0}
        className={styles.personRail}
      />
      {/* 常态的名字格：折叠时隐藏并滑入完整档案，避免头像和名字上下重复 */}
      <div className={styles.personSummary}>
        <div className={`${styles.inner} ${styles.personRow}`}>
          <span className={styles.personFaceWrap}>
            <NpcPortrait
              npc={person}
              className={styles.personFace}
              artClassName={styles.personFaceArt}
              line="var(--face-line, var(--person-line))"
            />
            {s && <i className={styles.personScanDot} title="已通过义眼扫描" aria-hidden />}
          </span>
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
                    data-tone={b.tone}
                    data-solid={b.solid || undefined}
                  >
                    <b>{b.label}</b>
                  </span>
                ))}
              </span>
            )}
          </span>
          <span className={styles.personSide}>
            {(() => {
              const relTag = npcRelationTag(person);
              if (!relTag) return null;
              return (
                <span className={styles.personAffinityWrap} title={relTag.title}>
                  <span className={styles.personAffinity} data-tone={relTag.tone}>
                    {relTag.label}
                  </span>
                </span>
              );
            })()}
            <span className={styles.personActions}>
              {hasOptics && onScan && !s && (
                <button
                  type="button"
                  className={styles.personIconBtn}
                  title={`义眼扫描 ${person.name}`}
                  aria-label={`义眼扫描 ${person.name}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onScan(person.id);
                  }}
                >
                  <Asset id="interaction.scan" tint="currentColor" height={12} />
                </button>
              )}
              {onDraftAction && (
                <button
                  type="button"
                  className={styles.personIconBtn}
                  title={
                    foe
                      ? `向 ${person.name} 发起战术行动`
                      : person.following
                        ? `向同行伙伴 ${person.name} 示意配合`
                        : `与 ${person.name} 互动`
                  }
                  aria-label={`与 ${person.name} 互动`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onDraftAction(
                      foe
                        ? `盯紧 ${person.name}，`
                        : person.following
                          ? `向同行的 ${person.name} 示意配合：`
                          : `转向 ${person.name}，`,
                    );
                  }}
                >
                  ▸
                </button>
              )}
            </span>
          </span>
        </div>
      </div>
      <span className={styles.scanCard} data-alert={scanAlert || undefined} aria-hidden={!scan}>
        <NineSlice id="map.tooltipBg" tint="var(--cp-panel-strong)" slice={TOOLTIP_SLICE} />
        <NineSlice
          id="map.tooltipFg"
          tint={scanAlert ? "var(--cp-danger)" : "var(--cp-cyan)"}
          slice={TOOLTIP_SLICE}
        />
        <span
          className={styles.scanLines}
          style={{ backgroundImage: cssUrl("fx.scanlines") }}
          aria-hidden
        />
        <span className={`${styles.inner} ${styles.scanInner}`}>
          <span className={styles.scanTop}>
            <em className={styles.scanBrand}>{s ? "KIROSHI // 已建档" : "KIROSHI // 未扫描"}</em>
            <em className={styles.scanThreatPill} data-threat={scanStatusThreat}>
              {scanStatusText}
            </em>
          </span>
          {scanWoundText && (
            <span className={styles.scanWound} data-threat={wound.threat}>
              创伤 · {scanWoundText}
            </span>
          )}
          {s ? (
            <>
              <span className={styles.scanGrid}>
                <span className={styles.scanCell}>
                  <small>骇入链路</small>
                  <em data-threat={netThreat}>{s.netLabel}</em>
                </span>
                <span className={styles.scanCell}>
                  <small>神经稳态</small>
                  <em data-threat={humanityThreat}>{s.humanityStage}</em>
                </span>
              </span>
              <span className={styles.scanMeta}>
                植入体 <em>{s.chrome.length}</em> 件{chromePreview && ` · ${chromePreview}`}
              </span>
              {primaryTip && <span className={styles.scanTip}>{primaryTip}</span>}
              {onDraftAction && (
                <span className={styles.scanActions}>
                  <button
                    type="button"
                    className={styles.scanQuickBtn}
                    onClick={(event) => {
                      event.stopPropagation();
                      const lead = primaryTip ?? `${s.threatLabel}，${s.netLabel}`;
                      onDraftAction(`利用义眼刚扫出的 ${person.name} 情报（${lead}），`);
                    }}
                  >
                    按情报行动
                  </button>
                </span>
              )}
            </>
          ) : (
            <span className={styles.scanUnscannedRow}>
              <span className={styles.scanMeta}>
                {hasOptics
                  ? `${person.met ? "已建档" : "底细不明"} · 立即透视义体与防线`
                  : "未装完好义眼 · 无法扫描"}
              </span>
              {hasOptics && onScan && (
                <button
                  type="button"
                  className={styles.scanQuickBtn}
                  onClick={(event) => {
                    event.stopPropagation();
                    onScan(person.id);
                  }}
                >
                  义眼扫描
                </button>
              )}
            </span>
          )}
        </span>
      </span>
      {/* 瞄着谁就只看谁：展开时隐藏其他列表项，页签+目标快切+关闭合为单行顶条 */}
      <Grow
        open={open}
        head={null}
        line={
          tone === "hostile"
            ? "var(--cp-danger)"
            : tone === "nemesis"
              ? "var(--cp-red)"
              : tone === "ally"
                ? "var(--cp-yellow)"
                : "var(--cp-cyan)"
        }
      >
        <Profile
          npc={person}
          fixer={fixer}
          foe={foe}
          hackStatus={hackStatus}
          embedded
          headerSlot={
            <>
              {switchTargets.length > 1 && (
                <nav className={styles.personQuickSwitch} aria-label="切换在场目标">
                  {switchTargets.map((target) => {
                    const active = target.id === person.id;
                    return (
                      <button
                        key={target.id}
                        type="button"
                        className={styles.personSwitchBtn}
                        data-tone={target.tone}
                        aria-current={active ? "true" : undefined}
                        onClick={(event) => {
                          event.stopPropagation();
                          if (!active) {
                            peek.setExpand(`person:${target.id}`);
                          }
                        }}
                      >
                        <i aria-hidden />
                        <span>{target.name}</span>
                      </button>
                    );
                  })}
                </nav>
              )}
              <button
                type="button"
                className={styles.personHeadBtn}
                title="收起在场人物档案（Esc）"
                onClick={(event) => {
                  event.stopPropagation();
                  p.close();
                }}
              >
                <span>收起</span>
                <kbd className={styles.personHeadKey}>ESC</kbd>
              </button>
            </>
          }
          onScan={hasOptics ? onScan : undefined}
          onCompanion={onCompanion}
          onDraftAction={onDraftAction}
        />
      </Grow>
    </div>
  );
}

/** 无独立人物卡但在交战中的场内敌手（杂兵或临时对手） */
function PresentFoe({
  foe,
  index,
  scan,
  onDraftAction,
}: {
  readonly foe: CombatFoe;
  readonly index: number;
  readonly scan: boolean;
  readonly onDraftAction?: ((text: string) => void) | undefined;
}) {
  const dead = foe.state === "dead" || foe.state === "fled";
  const sub = [
    foe.gang ?? "敌对目标",
    foe.carry.length > 0 ? `可拾取：${foe.carry.map((i) => i.name).join("、")}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const tierThreat =
    foe.tier === "legend" || foe.tier === "elite"
      ? "high"
      : foe.tier === "veteran"
        ? "even"
        : "low";
  const tilt = useCardTilt<HTMLDivElement>({
    maxRotate: 5.2,
    shadowShift: 4,
  });
  return (
    <div
      className={styles.person}
      style={{ "--i": index } as CSSProperties}
      data-tone="hostile"
      {...tilt}
    >
      <BlockShadow />
      <NineSlice
        id="map.filterCellBg"
        tint="var(--person-bg, var(--cp-surface))"
        slice={CELL_SLICE}
      />
      <CardGlare maskId="map.filterCellBg" slice={CELL_SLICE} tone="red" />
      <NineSlice id="map.filterCellFg" tint="var(--person-line)" slice={CELL_SLICE} />
      <CardBorderFx
        maskId="map.filterCellFg"
        slice={CELL_SLICE}
        tone="danger"
        phase={-0.9}
        urgent={!dead}
      />
      <NineSlice
        id="panel.glowLeft"
        tint="var(--person-glow, rgb(255 0 60 / 18%))"
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
          <span className={styles.personFaceWrap}>
            <span className={styles.personFace} data-dead={dead || undefined} aria-hidden>
              <NineSlice id="map.filterCellBg" tint="rgb(24 10 14 / 86%)" slice={CELL_SLICE} />
              <Asset id="portrait.unknown" className={styles.personFaceArt} />
              <NineSlice id="map.filterCellFg" tint="var(--cp-danger)" slice={CELL_SLICE} />
            </span>
          </span>
          <span className={styles.personText}>
            <span className={styles.personHead}>
              <b className={styles.personName}>{foe.name}</b>
            </span>
            <small className={styles.personSub} data-tone="hostile">
              {sub}
            </small>
            <span className={styles.personBadges}>
              <span className={styles.personBadge} data-tone="danger" data-solid>
                <b>{foe.stateLabel}</b>
              </span>
              <span
                className={styles.personBadge}
                data-tone={tierThreat === "high" ? "danger" : "yellow"}
              >
                <b>{foe.tierLabel}</b>
              </span>
            </span>
          </span>
          <span className={styles.personSide}>
            {!dead && onDraftAction ? (
              <span className={styles.personActions}>
                <button
                  type="button"
                  className={styles.personIconBtn}
                  title={`盯紧 ${foe.name} 并行动`}
                  aria-label={`盯紧 ${foe.name} 并行动`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onDraftAction(`瞄准 ${foe.name}，`);
                  }}
                >
                  ▸
                </button>
              </span>
            ) : (
              <span className={styles.personState}>{dead ? "脱离" : "交战"}</span>
            )}
          </span>
        </div>
      </div>
      <span className={styles.scanCard} data-alert={!dead || undefined} aria-hidden={!scan}>
        <NineSlice id="map.tooltipBg" tint="var(--cp-panel-strong)" slice={TOOLTIP_SLICE} />
        <NineSlice
          id="map.tooltipFg"
          tint={dead ? "var(--cp-cyan)" : "var(--cp-danger)"}
          slice={TOOLTIP_SLICE}
        />
        <span
          className={styles.scanLines}
          style={{ backgroundImage: cssUrl("fx.scanlines") }}
          aria-hidden
        />
        <span className={`${styles.inner} ${styles.scanInner}`}>
          <span className={styles.scanTop}>
            <em className={styles.scanBrand}>{"KIROSHI // 敌对目标"}</em>
            <em className={styles.scanThreatPill} data-threat={tierThreat}>
              {foe.tierLabel}
            </em>
          </span>
          <span className={styles.scanMeta}>
            状态 <em data-threat={dead ? "low" : "high"}>{foe.stateLabel}</em>
            {foe.gang ? ` · ${foe.gang}` : ""}
          </span>
          {foe.carry.length > 0 && (
            <span className={styles.scanTip}>
              可拾取：{foe.carry.map((i) => i.name).join("、")}
            </span>
          )}
        </span>
      </span>
    </div>
  );
}

type PresentGroupKey = "hostile" | "companion" | "present";

interface PresentEntry {
  readonly group: PresentGroupKey;
  readonly key: string;
  readonly npc?: Npc | undefined;
  readonly foe?: CombatFoe | undefined;
}

const PRESENT_GROUP_META: Readonly<
  Record<PresentGroupKey, { readonly code: string; readonly label: string }>
> = {
  hostile: { code: "HOSTILE", label: "敌对交战" },
  companion: { code: "ALLY", label: "同行伙伴" },
  present: { code: "SCENE", label: "现场人员" },
};

/** S 在场的人：义眼叠加层。按敌对/同行/在场分组，整合人物档案与 Kiroshi 扫描卡 */
export function Present({
  view,
  scan,
  peek,
  onScan,
  onScanAll,
  onScanEnv,
  onToggleScan,
  onCompanion,
  onDraftAction,
}: {
  readonly view: View;
  readonly scan: boolean;
  readonly peek: PeekState;
  /** 档案与扫描卡里的「扫描」按钮：点一下立刻用义眼扫，不调模型 */
  readonly onScan?: ((id: string) => void) | undefined;
  /** 一键扫描全部未扫在场目标 */
  readonly onScanAll?: (() => void) | undefined;
  /** 用当前安装的义眼模型起草一次环境/埋伏/监控扫描行动 */
  readonly onScanEnv?: (() => void) | undefined;
  /** 点击顶栏 TAB 按钮切换扫描视图 */
  readonly onToggleScan?: (() => void) | undefined;
  /** 切换人物随行同行/暂别留守 */
  readonly onCompanion?: ((id: string, following: boolean) => void) | undefined;
  /** 按扫描情报生成输入框草稿 */
  readonly onDraftAction?: ((text: string) => void) | undefined;
}) {
  const foes = view.combat.active?.foes ?? [];
  const foeOf = (n: Npc) => foes.find((f) => f.npc === n.id || f.id === n.id || f.name === n.name);
  const herePeople = view.npcs.filter((n) => n.here && n.alive);
  const extraFoes = foes.filter(
    (f) => !herePeople.some((n) => f.npc === n.id || f.id === n.id || f.name === n.name),
  );
  const hostileEntries: PresentEntry[] = [
    ...herePeople
      .filter((n) => Boolean(foeOf(n)))
      .map((n): PresentEntry => ({ group: "hostile", key: `npc:${n.id}`, npc: n, foe: foeOf(n) })),
    ...extraFoes.map((f): PresentEntry => ({ group: "hostile", key: `foe:${f.id}`, foe: f })),
  ];
  const companionEntries: PresentEntry[] = herePeople
    .filter((n) => !foeOf(n) && n.following)
    .map((n): PresentEntry => ({ group: "companion", key: `npc:${n.id}`, npc: n }));
  const regularEntries: PresentEntry[] = herePeople
    .filter((n) => !foeOf(n) && !n.following)
    .map((n): PresentEntry => ({ group: "present", key: `npc:${n.id}`, npc: n }));

  const allEntries = [...hostileEntries, ...companionEntries, ...regularEntries];
  const intactEye = view.cyberware.find((c) => c.slot === "eyes" && !c.broken) ?? null;
  const hackStatusOf = (npc: Npc): PersonHackStatus | undefined => {
    if (!view.hacking) return undefined;
    const hit = view.hacking.breachedTargets.find((b) => b.npc === npc.id || b.target === npc.name);
    const isBreached = Boolean(hit);
    const activeEffects = [
      ...new Set(
        view.hacking.activeEffects
          .filter((e) => {
            if (e.target !== npc.name) return false;
            if (isBreached && e.categoryLabel === null && /破冰|breach/i.test(e.label)) {
              return false;
            }
            return true;
          })
          .map((e) => e.label),
      ),
    ];
    if (!isBreached && activeEffects.length === 0) return undefined;
    return {
      breached: isBreached,
      breachedVia: hit?.via ?? null,
      activeEffects,
    };
  };
  const unscannedCount = herePeople.filter((n) => !n.body?.scan).length;
  const totalCount = allEntries.length;
  const shownEntries = allEntries.slice(0, PRESENT_MAX);
  const open = shownEntries.some((e) => e.npc && peek.expand === `person:${e.npc.id}`);
  const [ready, setReady] = useState(false);
  const wasOpenRef = useRef(false);
  const switching = wasOpenRef.current && open;
  useEffect(() => {
    const t = window.setTimeout(() => setReady(true), 550);
    return () => window.clearTimeout(t);
  }, []);
  useEffect(() => {
    wasOpenRef.current = open;
  }, [open]);
  if (totalCount === 0 && !scan) return null;

  const overflow = totalCount - shownEntries.length;
  const distinctGroups = new Set(shownEntries.map((e) => e.group));
  const showGroupHeaders = distinctGroups.size > 1 || hostileEntries.length > 0;
  const switchTargets: readonly QuickSwitchTarget[] = shownEntries
    .filter((e): e is PresentEntry & { readonly npc: Npc } => Boolean(e.npc))
    .map((e) => ({
      id: e.npc.id,
      name: e.npc.name,
      tone: profileTone(e.npc, e.foe),
    }));

  const injuredAllies = (view.combat.active?.allies ?? []).filter(
    (ally) => ally.condition !== "up",
  ).length;
  const summaryBits = [
    hostileEntries.length > 0 ? `交战 ${hostileEntries.length}` : null,
    companionEntries.length > 0
      ? `同行 ${companionEntries.length}${injuredAllies > 0 ? ` · ${injuredAllies} 负伤` : ""}`
      : null,
  ].filter(Boolean);

  return (
    <section
      className={`${styles.block} ${styles.present}`}
      data-layer="optics"
      data-scan={scan || undefined}
      data-open={open || undefined}
      data-switching={switching || undefined}
      data-ready={ready || open || undefined}
      data-combat={hostileEntries.length > 0 || undefined}
      aria-label="在场的人"
    >
      <header className={styles.label}>
        <Asset id="interaction.scan" tint="currentColor" height={17} />
        <span className={styles.labelTitle}>
          {scan ? (intactEye ? `KIROSHI · ${intactEye.name}` : "未装完好义眼") : "在场目标"}
        </span>
        {totalCount > 0 && (
          <em className={styles.presentCount}>
            {overflow > 0 ? `${shownEntries.length}/${totalCount}` : totalCount}
          </em>
        )}
        {summaryBits.length > 0 && !scan && (
          <span className={styles.presentMeta}>{summaryBits.join(" · ")}</span>
        )}
        <span
          className={styles.labelLine}
          style={{ maskImage: cssUrl("tab.line"), WebkitMaskImage: cssUrl("tab.line") }}
          aria-hidden
        />
        {onToggleScan && !open ? (
          <button
            type="button"
            className={styles.labelScanBtn}
            data-active={scan || undefined}
            aria-pressed={scan}
            title="按 Tab 或点击切换 Kiroshi 义眼扫描（开启时自动扫描在场目标）"
            onClick={onToggleScan}
          >
            {scan ? "SCAN ●" : "TAB"}
          </button>
        ) : (
          <kbd className={styles.labelHint}>{scan ? "SCAN" : open ? "ESC" : "TAB"}</kbd>
        )}
      </header>
      {scan && !open && (
        <div className={styles.scanToolbar}>
          {intactEye ? (
            <>
              {unscannedCount > 0 && onScanAll && (
                <button type="button" className={styles.scanToolbarBtn} onClick={onScanAll}>
                  全扫目标（{unscannedCount}）
                </button>
              )}
              {onScanEnv && (
                <button type="button" className={styles.scanToolbarBtn} onClick={onScanEnv}>
                  扫描环境 / 监控 / 伏兵
                </button>
              )}
            </>
          ) : (
            <span className={styles.scanToolbarNote}>
              未装完好义眼：前往义体医生安装或修复后解锁扫描
            </span>
          )}
        </div>
      )}
      {totalCount > 0 && (
        <ul className={styles.presentList}>
          {shownEntries.map((entry, idx) => {
            const prevGroup = idx > 0 ? shownEntries[idx - 1]?.group : null;
            const renderGroupHeader = showGroupHeaders && entry.group !== prevGroup && !open;
            const groupMeta = PRESENT_GROUP_META[entry.group];
            const isSlotOpen = Boolean(entry.npc && peek.expand === `person:${entry.npc.id}`);
            return (
              <li
                key={entry.key}
                className={styles.presentSlot}
                data-open={isSlotOpen || undefined}
              >
                {renderGroupHeader && (
                  <div className={styles.presentGroupHead} data-group={entry.group} aria-hidden>
                    <em>{groupMeta.code}</em>
                    <span>{groupMeta.label}</span>
                    <i />
                  </div>
                )}
                {entry.npc ? (
                  <PresentPerson
                    person={entry.npc}
                    fixer={view.jobs.fixers.find((f) => f.id === entry.npc?.id)}
                    foe={entry.foe}
                    hackStatus={hackStatusOf(entry.npc)}
                    index={idx}
                    scan={scan}
                    groupOpen={open}
                    hasOptics={Boolean(intactEye)}
                    peek={peek}
                    switchTargets={switchTargets}
                    onScan={onScan}
                    onCompanion={onCompanion}
                    onDraftAction={onDraftAction}
                  />
                ) : entry.foe ? (
                  <PresentFoe
                    foe={entry.foe}
                    index={idx}
                    scan={scan}
                    onDraftAction={onDraftAction}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {overflow > 0 && (
        <p className={styles.presentMore}>另有 {overflow} 人在场 · 全部人物见「人物」</p>
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
}: {
  readonly view: View;
  readonly peek: PeekState;
  /** 钉住（点块或按 T）时块里放的消息、新闻与芯片 */
  readonly full: ReactNode;
  /** 消息、新闻、芯片页签：块往上长，页签放在底下挨着常态那一行，不跟内容一起滚走（用户定的） */
  readonly tabs?: ReactNode;
}) {
  const p = usePeek("unread", peek.expand, peek.setExpand);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (p.open) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement && rootRef.current?.contains(active)) {
      active.blur();
    }
  }, [p.open]);
  // 未读面板展开时总是加宽；整块收起时等内容收完再变回原宽
  const lingered = useLinger(p.open);
  const wideOn = p.open || lingered;
  const resizing = useResizing(wideOn, p.open);
  const feed = view.phone.feedUnread;
  const unreadCalls = feed.messages.filter((id) => id.startsWith("phone:call:")).length;
  const newsCount = feed.news.length + feed.street.length;
  const items: readonly { readonly label: string; readonly icon: AssetId; readonly n: number }[] = [
    { label: "消息", icon: "notify.attention", n: view.phone.unread + unreadCalls },
    { label: "新闻", icon: "notify.journal", n: newsCount },
    { label: "资料", icon: "interaction.jackIn", n: view.shards.unread },
  ];
  const shown = items.filter((i) => i.n > 0);
  // 一直显示：这里就是消息与芯片的入口，读完了也要找得到
  const newest = view.phone.messages.find((m) => !m.read) ?? null;
  const totalUnread = view.phone.unread + unreadCalls + newsCount + view.shards.unread;
  const tilt = useCardTilt<HTMLDivElement>({
    disabled: p.open,
    maxRotate: 5.8,
    shadowShift: 5,
    restRy: 7.5,
  });
  return (
    // biome-ignore lint/a11y/useSemanticElements: 块里套着九宫格和展开面板，不能整个换成 button
    <div
      ref={rootRef}
      className={`${styles.block} ${styles.unread}`}
      data-layer="os"
      data-open={p.open || undefined}
      data-wide={wideOn || undefined}
      data-resizing={resizing || undefined}
      aria-label={`未读消息，点击${p.open ? "收起" : "展开"}，按 T 或 Esc 收起`}
      role="button"
      tabIndex={0}
      aria-expanded={p.open}
      onClick={(event) => {
        if (isNestedInteractive(event.target, event.currentTarget)) return;
        // 点击展开正文区（选联系人、复制消息、漏点按钮或输入框边缘）不顺手关闭；点外框或底栏再切换收起
        if (event.target instanceof Element && event.target.closest(`.${styles.grow}`)) {
          return;
        }
        p.toggle();
      }}
      onKeyDown={(event) => {
        if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          p.toggle();
        }
      }}
      {...tilt}
    >
      <BlockShadow />
      <NineSlice id="map.panelBg" tint="var(--cp-surface)" slice={PANEL_SLICE} />
      <CardGlare maskId="map.panelBg" slice={PANEL_SLICE} tone="red" />
      <NineSlice id="map.panelFg" tint="var(--cp-red)" slice={PANEL_SLICE} />
      <CardBorderFx maskId="map.panelFg" slice={PANEL_SLICE} tone="red" phase={-3.4} />
      <div className={`${styles.inner} ${styles.unreadInner}`}>
        <Grow
          open={p.open}
          head={null}
          title="消息 · 资料"
          hint={p.open ? "ESC" : "T"}
          line="var(--cp-red)"
        >
          {full}
        </Grow>
        {p.open && tabs ? (
          <div className={styles.unreadTabs}>
            {tabs}
            <span className={styles.unreadTabMeta}>
              <span className={styles.unreadTabStat} data-active={totalUnread > 0 || undefined}>
                {totalUnread > 0 ? `未读 ${totalUnread}` : "全部已读"}
              </span>
              <button
                type="button"
                className={styles.unreadCloseBtn}
                title="收起消息终端（Esc / T）"
                onClick={p.toggle}
              >
                ESC
              </button>
            </span>
          </div>
        ) : (
          <>
            <div className={styles.unreadCounts}>
              {shown.length === 0 ? (
                <span className={styles.unreadIdle}>
                  <Asset id="notify.attention" tint="var(--cp-red-dim)" height={15} />
                  <span>通讯终端 · 无未读</span>
                </span>
              ) : (
                shown.map((i) => (
                  <span key={i.label} className={styles.unreadChip}>
                    <Asset id={i.icon} tint="var(--cp-red)" height={16} />
                    <span>{i.label}</span>
                    <b>{i.n}</b>
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
  const tilt = useCardTilt<HTMLButtonElement>({
    maxRotate: 4.2,
    shadowShift: 3,
  });
  return (
    <button
      type="button"
      className={styles.zoneService}
      data-black-market={blackMarket || undefined}
      onClick={onClick}
      {...tilt}
    >
      <CellFrame
        surface={
          <CardGlare
            maskId="map.filterCellBg"
            slice={CELL_SLICE}
            tone={blackMarket ? "yellow" : "cyan"}
          />
        }
        borderFx={
          <CardBorderFx
            maskId="map.filterCellFg"
            slice={CELL_SLICE}
            tone={blackMarket ? "yellow" : "cyan"}
            phase={-3.1}
          />
        }
      />
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
  onAutofixer,
  onBuyHome,
  onPayRent,
}: {
  readonly view: View;
  readonly onMap: () => void;
  readonly onShop: (id: string) => void;
  readonly onRipperdoc: () => void;
  readonly onAutofixer?: (() => void) | undefined;
  readonly onBuyHome?: ((id: string) => void) | undefined;
  readonly onPayRent?: ((id: string) => void) | undefined;
}) {
  const { heat, stealth } = view;
  const bounty = heat.bounties.reduce((sum, b) => sum + b.reward, 0);
  // NCPD 警星与基础悬赏金额已在地点卡内部显示，外部威胁条不再重复列 NCPD 星级，避免右上角满屏星星
  const threats = [...view.threats]
    .filter((t) => t.id !== "heat:ncpd" && !(t.id.startsWith("heat:bounty:") && t.who === "悬赏"))
    .sort((a, b) => b.level - a.level);
  const shownThreats = threats.slice(0, ZONE_THREAT_MAX);
  const homesForSaleHere = view.safehouse.forSale.filter((h) => !h.locked);
  const homesNeedingRent = view.safehouse.homes.filter(
    (h) => h.tenure === "rented" && (h.locked || h.rentDue),
  );
  const hasServices =
    view.shops.length > 0 ||
    Boolean(view.ripperdoc) ||
    Boolean(view.travel.autofixer && onAutofixer) ||
    (homesForSaleHere.length > 0 && Boolean(onBuyHome)) ||
    (homesNeedingRent.length > 0 && Boolean(onPayRent));
  const tilt = useCardTilt<HTMLDivElement>({
    maxRotate: 5.8,
    shadowShift: 5,
  });
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
        {...tilt}
      >
        <div className={styles.zoneHead}>
          <BlockShadow />
          <Asset
            id="hud.zoneFrame"
            tint="var(--cp-yellow)"
            height={96}
            className={styles.zoneFrame}
          />
          <Asset
            id="hud.zoneFrame"
            tint="transparent"
            height={96}
            style={{ ["--border-delay" as string]: "-1.8s" } as CSSProperties}
            className={`${styles.zoneFrame} ${styles.cardBorderFx} ${styles.borderFxYellow}${heat.stars >= 3 || stealth.level >= 2 ? ` ${styles.borderFxUrgent}` : ""}`}
          />
          <div className={styles.zoneText}>
            <div className={styles.zoneTitleRow}>
              <b>{view.names.location ?? locationLabel(view.location)}</b>
              <kbd className={styles.zoneKeyHint}>M</kbd>
            </div>
            <span className={styles.zoneMeta}>
              <time>{view.time.text}</time>
              <span aria-hidden>·</span>
              <span>{view.time.periodLabel}</span>
              <span aria-hidden>·</span>
              <span title={view.weather.note}>{view.weather.label}</span>
            </span>
            <span className={styles.heat}>
              {"★".repeat(heat.stars)}
              <span className={styles.starsEmpty}>{"★".repeat(5 - heat.stars)}</span>
              {bounty > 0 && <small>{` 悬赏 ${bounty.toLocaleString("en-US")} €$`}</small>}
              {stealth.level > 0 && (
                <small
                  data-alert={stealth.level}
                  title={`当前地点警戒：${stealth.label}（${stealth.level}/3）｜入侵安保链路或记忆擦除可降档`}
                >
                  {` ◆ ${stealth.label}`}
                </small>
              )}
            </span>
          </div>
          {/* 原作地区徽章自带颜色，有的没有透明底，不能当蒙版染色 */}
          <Asset id={districtIcon(view.names.district ?? view.location)} height={44} />
        </div>
        {/* 非 NCPD 外部威胁（敌对势力/仇家/赏金猎人）收进紧贴地点卡下沿的轻量战术条，不再用星号与警星混淆 */}
        {shownThreats.length > 0 && (
          <div className={styles.zoneThreats}>
            <ul className={styles.zoneThreatList} aria-label="威胁">
              {shownThreats.map((t) => (
                <li key={t.id} data-level={t.level} title={t.reason}>
                  <span className={styles.zoneThreatStars}>
                    {t.level >= 5 ? "极危" : t.level >= 4 ? "高危" : t.level >= 3 ? "警戒" : "敌意"}
                  </span>
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
        {(view.hacking?.breaches.length ?? 0) > 0 && (
          <div className={styles.zoneThreats}>
            <ul className={styles.zoneThreatList} aria-label="已控内网">
              {view.hacking?.breaches.map((b) => (
                <li
                  key={`${b.name}-${b.at}`}
                  title={`已攻破内网（${b.at}）：${b.gains.join("、")}`}
                >
                  <b>{b.name}</b>
                  <small>{b.gains.join("/")}</small>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      {hasServices && (
        <section className={styles.zoneServices} aria-label="当前地点服务与商家">
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
              tag={
                view.ripperdoc.mood?.lock
                  ? "拒诊"
                  : view.ripperdoc.blackMarket
                    ? "黑市"
                    : "义体诊所"
              }
              blackMarket={Boolean(view.ripperdoc.blackMarket || view.ripperdoc.mood?.lock)}
              onClick={onRipperdoc}
            />
          )}
          {view.travel.autofixer && onAutofixer && (
            <ZoneServiceBar
              icon="map.poi.autofixer"
              name={view.travel.autofixer.name}
              tag="购车终端"
              onClick={onAutofixer}
            />
          )}
          {onBuyHome &&
            homesForSaleHere.map((home) => (
              <ZoneServiceBar
                key={home.id}
                icon="map.poi.apartment"
                name={home.name}
                tag={`${home.price.toLocaleString("en-US")} €`}
                onClick={() => onBuyHome(home.id)}
              />
            ))}
          {onPayRent &&
            homesNeedingRent.map((home) => (
              <ZoneServiceBar
                key={`rent-${home.id}`}
                icon="map.poi.apartment"
                name={`${home.name} · ${home.locked ? "缴租解锁" : "续缴房租"}`}
                tag={`${(home.rentAmount ?? 1200).toLocaleString("en-US")} €`}
                blackMarket={home.locked}
                onClick={() => onPayRent(home.id)}
              />
            ))}
        </section>
      )}
    </div>
  );
}

/** C 追踪：统一展示在办事项/约定、临期账务与待接风声；展开后可直达地图定位、接单、缴租或写入行动框，children 是 D 系统通知 */
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
  const totalShown = track.activeCount + track.offeredCount;
  const idle = totalShown === 0;
  const statusPill =
    track.overdueCount > 0
      ? ({ tone: "bad", label: `超期 ${track.overdueCount}` } as const)
      : track.activeCount > 0
        ? ({ tone: "warn", label: `在办 ${track.activeCount}` } as const)
        : track.offeredCount > 0
          ? ({ tone: "cyan", label: `待决 ${track.offeredCount}` } as const)
          : ({ tone: "muted", label: "无待办" } as const);
  const eddiesText = view.money.eddies.toLocaleString("en-US");
  const tilt = useCardTilt<HTMLDivElement>({
    disabled: p.open,
    maxRotate: 5.8,
    shadowShift: 5,
  });

  return (
    <div
      className={`${styles.block} ${styles.track}`}
      data-layer="optics"
      data-open={p.open || undefined}
      data-idle={idle || undefined}
    >
      {
        // biome-ignore lint/a11y/useSemanticElements: 追踪框里套着可展开详情，不能整个换成 button
        <div
          className={styles.trackHit}
          role="button"
          tabIndex={0}
          aria-expanded={p.open}
          aria-label={`追踪，点击${p.open ? "收起" : "展开"}，按 J 切换，按 Esc 收起`}
          onClick={(event) => {
            if (isNestedInteractive(event.target, event.currentTarget)) return;
            if (event.target instanceof Element && event.target.closest(`.${styles.grow}`)) {
              return;
            }
            p.toggle();
          }}
          onKeyDown={(event) => {
            if (
              event.target === event.currentTarget &&
              (event.key === "Enter" || event.key === " ")
            ) {
              event.preventDefault();
              p.toggle();
            }
          }}
          {...tilt}
        >
          <BlockShadow />
          <Panel
            as="section"
            line="var(--cp-yellow)"
            surface={<CardGlare maskId="notify.itemCellBg" slice={ITEM_CELL_SLICE} tone="yellow" />}
            borderFx={
              <CardBorderFx
                maskId="notify.itemCellFg"
                slice={ITEM_CELL_SLICE}
                tone="yellow"
                phase={-3.7}
              />
            }
          >
            <div className={styles.trackHead}>
              <span className={styles.trackHeadLeft}>
                {p.open && (
                  <Asset
                    id="notify.journal"
                    tint="var(--cp-yellow)"
                    height={16}
                    className={styles.trackHeadIcon}
                  />
                )}
                <h2 className={styles.trackTitle}>追踪</h2>
                {p.open && <span className={styles.trackKicker}>{"OBJECTIVE // LOG"}</span>}
                <span className={styles.trackStatus} data-tone={statusPill.tone}>
                  {statusPill.label}
                </span>
              </span>
              {p.open ? (
                <span className={styles.trackHeadRight}>
                  <span className={styles.trackCash} title={`当前随身欧元：${eddiesText} €`}>
                    <Asset id="notify.cash" tint="var(--cp-yellow)" height={13} />
                    <b>{eddiesText}</b>
                  </span>
                  <button
                    type="button"
                    className={styles.trackCloseBtn}
                    title="收起追踪面板（Esc / J）"
                    onClick={p.toggle}
                  >
                    ESC
                  </button>
                </span>
              ) : (
                <kbd className={styles.trackKeyHint}>J</kbd>
              )}
            </div>
            {/* 常态摘要在展开后收进 0fr，腾出纵向空间；空闲态保持极简，仅留标题栏 */}
            {!idle && (
              <div className={styles.trackSummary}>
                <div className={styles.trackSummaryInner}>
                  <ul className={styles.trackList}>
                    {rows.map((r) => {
                      const loc =
                        r.location && !r.progress?.includes(r.location) ? r.location : null;
                      const sub = [r.sourceLabel, r.progress, loc].filter(Boolean).join(" · ");
                      return (
                        <li
                          key={r.id}
                          data-overdue={r.status === "overdue" || undefined}
                          data-offered={r.status === "offered" || undefined}
                        >
                          <Asset
                            id={r.icon}
                            tint={
                              r.status === "overdue"
                                ? "var(--cp-danger)"
                                : r.status === "offered"
                                  ? "var(--cp-cyan)"
                                  : "var(--cp-yellow)"
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
                  {totalShown > rows.length && (
                    <p className={styles.trackMore}>
                      +{totalShown - rows.length} 项待办与风声 · 按 J 展开操作
                    </p>
                  )}
                </div>
              </div>
            )}
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
function ChargePips({
  label,
  charges,
  max,
  tone,
}: {
  readonly label: string;
  readonly charges: number;
  readonly max: number;
  readonly tone: "heal" | "nade";
}) {
  const cappedMax = Math.min(Math.max(max, 1), 6);
  return (
    <span className={styles.slotCharge} data-tone={tone} title={`${label} ${charges}/${max}`}>
      <em className={styles.slotChargeLabel}>{label}</em>
      <span className={styles.slotPips} aria-hidden>
        {Array.from({ length: cappedMax }, (_, i) => (
          <i
            // biome-ignore lint/suspicious/noArrayIndexKey: 充能格按序号排布
            key={i}
            className={styles.slotPip}
            data-filled={i < charges || undefined}
          />
        ))}
      </span>
      <b className={styles.slotChargeNum}>
        {charges}/{max}
      </b>
    </span>
  );
}

const MAX_HUD_WEAPONS = 3;

/** 装备面板顶栏携带负担刻度条（按 carryUnits / carryMax 分段显示，支持超重告警） */
function LoadMeter({
  units,
  max,
  level,
  label,
}: {
  readonly units: number;
  readonly max: number;
  readonly level: "light" | "burdened" | "overloaded";
  readonly label: string;
}) {
  const segCount = Math.max(1, Math.min(12, max));
  const filled =
    units <= 0
      ? 0
      : Math.min(segCount, Math.max(1, Math.round((units / Math.max(1, max)) * segCount)));
  return (
    <span
      className={styles.weaponLoad}
      data-level={level}
      title={`随身负担：${label}（${units}/${max} 分值；小武器 1、中短武器 2、大件武器 4）`}
    >
      <span className={styles.weaponLoadLabel}>{label}</span>
      <span className={styles.weaponLoadTrack} aria-hidden>
        {Array.from({ length: segCount }, (_, i) => (
          <i
            // biome-ignore lint/suspicious/noArrayIndexKey: 固定格数进度刻度
            key={i}
            className={styles.weaponLoadSeg}
            data-on={i < filled || undefined}
          />
        ))}
      </span>
      <b className={styles.weaponLoadNum}>
        {units}/{max}
      </b>
    </span>
  );
}

/** H 随身武器与物品栏：平权并排显示随身武器缩略格，底行展示治疗/手雷充能格与欧元；点击或按 O 展开 */
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
  /** 展开区顶栏位置切换（随身 / 住所 / 车辆 / 别处） */
  readonly tabs?: ReactNode;
}) {
  const { inventory, money } = view;
  const eddiesText = money.eddies.toLocaleString("en-US");
  const p = usePeek("weapon", peek.expand, peek.setExpand);
  const tilt = useCardTilt<HTMLDivElement>({
    disabled: p.open,
    maxRotate: 5.8,
    shadowShift: 5,
    restRy: -7.5,
  });
  const wideOn = useLinger(p.open);
  const weapons = inventory.carriedWeapons;
  const soleWeapon = weapons.length === 1 ? weapons[0] : undefined;
  const { shown: shownWeapons, extra: extraWeapons } = weaponPreview(inventory, MAX_HUD_WEAPONS);
  const load = inventory.loadout;
  const lootCount = view.combat.loot.reduce((sum, group) => sum + group.items.length, 0);
  const weaponMeta = (w: (typeof weapons)[number]) => {
    const detail = inventory.details?.[w.id];
    const baseId = w.baseId ?? detail?.baseId ?? w.id;
    const name = displayItemName(view.names.items, w.id, baseId);
    const modCount = Object.values(w.weaponState?.mods ?? {}).filter(Boolean).length;
    return {
      name,
      subLabel: detail?.subLabel,
      rarity: detail?.rarity ?? inventory.rarity[w.id],
      icon: weaponHudIconOf(baseId, detail?.subLabel),
      tip: [
        name,
        inventory.heldWeapons?.includes(w.id) ? "当前持用" : null,
        detail?.subLabel,
        detail?.rarityLabel,
        modCount > 0 ? `已装 ${modCount} 件改装` : null,
        w.noise === "silent" &&
        !detail?.subLabel?.includes("刀剑") &&
        !detail?.subLabel?.includes("钝器")
          ? "已消音"
          : null,
        w.bulky ? "大件" : null,
      ]
        .filter(Boolean)
        .join(" · "),
    };
  };
  return (
    // biome-ignore lint/a11y/useSemanticElements: 块里套着物品栏展开按钮，不能整个换成 button
    <div
      className={`${styles.block} ${styles.weapon}`}
      data-layer="os"
      data-open={p.open || undefined}
      data-wide={wideOn || undefined}
      aria-label={`武器、物品栏与车辆，点击${p.open ? "收起" : "展开"}，按 O 或 Esc 收起`}
      role="button"
      tabIndex={0}
      aria-expanded={p.open}
      onClick={(event) => {
        if (isNestedInteractive(event.target, event.currentTarget)) return;
        if (
          p.open &&
          event.target instanceof Element &&
          event.target.closest(`.${styles.grow}`) &&
          !event.target.closest(`.${styles.weaponDrawerHead}`)
        ) {
          return;
        }
        p.toggle();
      }}
      onKeyDown={(event) => {
        if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          p.toggle();
        }
      }}
      {...tilt}
    >
      <div className={styles.slot}>
        <BlockShadow />
        <NineSlice
          id="hud.slotBg"
          tint={p.open ? "var(--cp-panel-strong)" : "var(--cp-surface)"}
          slice={SLOT_SLICE}
        />
        <CardGlare maskId="hud.slotBg" slice={SLOT_SLICE} tone="cyan" />
        <NineSlice id="hud.slotFg" tint="rgb(94 246 255 / 80%)" slice={SLOT_SLICE} />
        <CardBorderFx
          maskId="hud.slotFg"
          slice={SLOT_SLICE}
          tone="cyan"
          phase={-2.8}
          urgent={Boolean(view.combat.active)}
        />
        <Grow
          open={p.open}
          line="var(--cp-cyan)"
          head={
            <header className={styles.weaponDrawerHead}>
              {tabs ?? <span className={styles.weaponDrawerTitle}>装备 · 物品栏与车辆</span>}
              <span className={styles.weaponDrawerMeta}>
                <LoadMeter
                  units={load.carryUnits}
                  max={load.carryMax}
                  level={load.carryLevel}
                  label={load.carryLabel}
                />
                <kbd title="快捷键 O 开关，Q/E 切换位置">O</kbd>
              </span>
            </header>
          }
        >
          {full}
        </Grow>
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
                      title={extraWeapons
                        .map((w) => displayItemName(view.names.items, w.id, w.baseId))
                        .join("、")}
                    >
                      +{extraWeapons.length}
                    </li>
                  )}
                </ul>
              ))}
            <span className={styles.slotFoot}>
              <span className={styles.slotCharges}>
                {p.open && (
                  <small className={styles.slotLine}>
                    {weapons.length > 0 ? `${weapons.length} 把武器` : "徒手"}
                  </small>
                )}
                {inventory.healing ? (
                  <ChargePips
                    label="治疗"
                    charges={inventory.healing.charges}
                    max={inventory.healing.max}
                    tone="heal"
                  />
                ) : (
                  <small className={styles.slotEmptyCharge}>无治疗</small>
                )}
                {inventory.grenade ? (
                  <ChargePips
                    label="手雷"
                    charges={inventory.grenade.charges}
                    max={inventory.grenade.max}
                    tone="nade"
                  />
                ) : (
                  <small className={styles.slotEmptyCharge}>无手雷</small>
                )}
                {inventory.loadout.carryLevel !== "light" && (
                  <span className={styles.slotOverload}>{inventory.loadout.carryLabel}</span>
                )}
                {lootCount > 0 && (
                  <span
                    className={styles.slotLoot}
                    title={`当前战场遗留 ${lootCount} 件战利品，按 O 展开拾取`}
                  >
                    战利品 {lootCount}
                  </span>
                )}
              </span>
              <span className={styles.slotFootMeta}>
                <span className={styles.slotCash} title={`随身欧元：${eddiesText} 欧元`}>
                  <Asset id="notify.cash" tint="var(--cp-yellow)" height={11} />
                  <strong>{eddiesText}</strong>
                </span>
                <kbd className={styles.slotHint}>{p.open ? "ESC" : "O"}</kbd>
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
  onAnswer,
  disabled = false,
}: {
  readonly view: View;
  readonly onOpenPhone: () => void;
  readonly onAnswer?: ((id: number, answer: boolean) => void) | undefined;
  readonly disabled?: boolean | undefined;
}) {
  const incoming = view.calls?.incoming;
  const tilt = useCardTilt<HTMLElement>({
    maxRotate: 5.8,
    shadowShift: 5,
    restRy: 7.5,
  });
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
    <section
      className={`${styles.block} ${styles.holocall}`}
      data-layer="optics"
      aria-label={`全息来电：${incoming.name}`}
      {...tilt}
    >
      <BlockShadow />
      <NineSlice id="dialog.lineSelect" tint="var(--cp-surface-strong)" slice={HOLO_SLICE} />
      <CardGlare maskId="dialog.lineSelect" slice={HOLO_SLICE} tone="cyan" />
      <CardBorderFx maskId="dialog.lineSelect" slice={HOLO_SLICE} tone="cyan" phase={-0.3} urgent />
      <NineSlice
        id="panel.glowLeft"
        tint="rgb(94 246 255 / 22%)"
        slice={[16, 20, 16, 20]}
        className={styles.holoGlow}
      />
      <div className={`${styles.inner} ${styles.holoStack}`}>
        <button
          type="button"
          className={styles.holoHead}
          onClick={onOpenPhone}
          aria-label={`全息来电：${incoming.name}，打开通讯终端`}
        >
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
            <span>{incoming.statusLabel}</span>
          </span>
          <span className={styles.holoWave} aria-hidden>
            <i />
            <i />
            <i />
            <i />
          </span>
        </button>
        {onAnswer && (
          <div className={styles.holoActions}>
            <button
              type="button"
              className={`${styles.holoBtn} ${styles.holoAccept}`}
              disabled={disabled}
              onClick={() => onAnswer(incoming.id, true)}
            >
              接通
            </button>
            <button
              type="button"
              className={`${styles.holoBtn} ${styles.holoDecline}`}
              disabled={disabled}
              onClick={() => onAnswer(incoming.id, false)}
            >
              挂断
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

/** 横幅：潜网、闪回、神经过载/戒断/义体排异，同时只出一个（交战目标已由左侧在场目标面板分组呈现） */
export function Banner({ view }: { readonly view: View }) {
  const { character, humanity, psychosis } = view;
  const dive = view.hacking?.dive ?? null;
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
