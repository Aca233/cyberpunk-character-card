import { type CSSProperties, type ReactNode, useState } from "react";
import type { AssetId } from "../../assets";
import { Asset, NineSlice } from "../../ui/Asset";
import { Panel } from "../../ui/Panel";
import { itemArtOf } from "./art";
import {
  type BodyLayerId,
  CYBER_SLOT_ICON,
  humanityToneOf,
  SLOT_BODY_LAYERS,
} from "./cyberwareMeta";
import neural from "./neural.module.css";
import type { View } from "./view";

/**
 * 义体页的人体、部位格和人性条（原作 2.0 义体医生那一页的排法），从 NeuralPages 抽出来共用：
 * 剧情里的义体页和捏人时选开局义体都用它（用户定的，2026-10-30："选择义体的界面要改成新的那个"）。
 * 只管排法和交互；每格装着什么、详情里写什么由调用方给
 */

export type CyberSlot = View["cyberware"][number]["slot"];

/** 部位名照原作 2.0 义体医生那一页上写的字（额皮质、胳臂、面部、手掌、表皮系统），和 core 的 SLOT_LABELS 叫法不全一样 */
export const CYBER_LABELS: Readonly<Record<CyberSlot, string>> = {
  frontalCortex: "额皮质",
  eyes: "面部",
  nervous: "神经系统",
  os: "操作系统",
  circulatory: "循环系统",
  integumentary: "表皮系统",
  skeleton: "骨骼",
  hands: "手掌",
  arms: "胳臂",
  legs: "腿部",
};

/**
 * 义体页的部位组，位置和每组格数照原作 2.0 义体医生那一页（第五节第 4 条）：
 * 左边额皮质 3、胳臂 1、骨骼 3、神经系统 3、表皮系统 3，右边操作系统 1、面部 2、手掌 2、循环系统 3、腿部 1。
 * 第三个数是这组离人体往外错开几格：原作第二、三行顺着张开的胳膊往外排，其余贴着人体。
 * 格数就是这个部位能装几件（core 的 SLOT_CAPACITY 和这里一致；原来一个部位只装一件、多出来的格子只是画上，
 * 用户 2026-10-31 说"现在 ui 和能装的义体数量对不上"，改成每格都能装）
 */
const CYBER_SIDES: readonly (readonly (readonly [CyberSlot, number, number])[])[] = [
  [
    ["frontalCortex", 3, 0],
    ["arms", 1, 0.7],
    ["skeleton", 3, 1.4],
    ["nervous", 3, 0],
    ["integumentary", 3, 0],
  ],
  [
    ["os", 1, 0],
    ["eyes", 2, 0.6],
    ["hands", 2, 1.3],
    ["circulatory", 3, 0],
    ["legs", 1, 0],
  ],
];

/** 中间人体是原作 man_body 图集里同尺寸的几张分层图：皮肤打底、免疫脉络微亮，悬停/选中哪个部位就点亮对应生理图层 */
const BODY_LAYER_ASSETS: readonly { readonly key: BodyLayerId; readonly id: AssetId }[] = [
  { key: "skin", id: "cyber.bodySkin" },
  { key: "immune", id: "cyber.bodyImmune" },
  { key: "skeleton", id: "cyber.bodySkeleton" },
  { key: "nervous", id: "cyber.bodyNervous" },
  { key: "circulatory", id: "cyber.bodyCirculatory" },
];

/** 一格的底子：原作切角底、金色电路纹、外框和稀有度竖条，颜色由 CSS 变量给 */
function CyberCellFace() {
  return (
    <>
      <NineSlice
        id="cyber.cellShape"
        tint="rgb(12 14 24 / 90%)"
        slice={0}
        className={neural.cellSquare}
      />
      <NineSlice
        id="cyber.cellTexture"
        tint="var(--cell-texture)"
        slice={0}
        className={neural.cellSquare}
      />
      <NineSlice
        id="cyber.cellFrame"
        tint="var(--cell-line)"
        slice={0}
        className={neural.cellSquare}
      />
      <NineSlice
        id="cyber.cellRarity"
        tint="var(--cell-strip)"
        slice={0}
        className={neural.cellStrip}
      />
    </>
  );
}

/**
 * 选择框里一件义体的格子：和部位格同样的原作底子、电路纹和义体图；装着的框亮成原作选中的黄
 * （用户 2026-10-31："保留弹窗，样式改成原作义体医生那样"）
 */
export function CyberItemCell({
  id,
  name,
  slot,
  on = false,
  rarity,
  iconic = false,
  broken = false,
  size,
}: {
  readonly id: string;
  readonly name: string;
  readonly slot?: CyberSlot | undefined;
  readonly on?: boolean;
  /** 稀有度，给左边竖条染色（用户 2026-10-31："怎么没有稀有度颜色区分"） */
  readonly rarity?: string | undefined;
  readonly iconic?: boolean | undefined;
  readonly broken?: boolean | undefined;
  readonly size?: number | undefined;
}) {
  const art = itemArtOf(id);
  const style = size !== undefined ? ({ "--cell": `${size}px` } as CSSProperties) : undefined;
  return (
    <span
      className={neural.cyberCell}
      data-item
      data-on={on || undefined}
      data-broken={broken || undefined}
      data-rarity={rarity}
      data-iconic={iconic || undefined}
      style={style}
      aria-hidden
    >
      <CyberCellFace />
      {art ? (
        <Asset id={art as AssetId} alt={name} className={neural.cyberArt} />
      ) : slot ? (
        <Asset
          id={CYBER_SLOT_ICON[slot]}
          tint="rgb(245 240 232 / 78%)"
          className={neural.cellFallbackIcon}
        />
      ) : (
        <span className={neural.cyberCellName}>{name}</span>
      )}
      {broken && (
        <Asset
          id="cyber.disabled"
          tint="var(--cp-danger)"
          height={14}
          alt="已损坏"
          className={neural.cyberBroken}
        />
      )}
    </span>
  );
}

export interface GaugeValue {
  readonly current: number;
  readonly cap: number;
  readonly stageLabel: string;
  readonly suppressed?: boolean | undefined;
}

/**
 * 人性条：放在原作义体容量条的位置（用户选的「只要左边人性」）。
 * 刻度是原作 cw_barbg，填满的部分是同一张图染亮色、按当前人性占上限的比例从下往上露出来；
 * 在 40 点处标出感知失真警戒线
 */
function HumanityGauge({ humanity }: { readonly humanity: GaugeValue }) {
  const fill = humanity.cap > 0 ? Math.min(1, Math.max(0, humanity.current / humanity.cap)) : 0;
  const tone = humanityToneOf(humanity.current);
  return (
    <div
      className={neural.gauge}
      data-tone={tone}
      style={{ "--fill": fill } as CSSProperties}
      title={`人性 ${humanity.current}/${humanity.cap} · ${humanity.stageLabel}${humanity.suppressed ? "（阻断中）" : ""}`}
    >
      <span className={neural.gaugeHead}>人性</span>
      <span className={neural.gaugeTrack}>
        <NineSlice id="cyber.gaugeBg" tint="rgb(255 190 40 / 16%)" slice={0} />
        <span className={neural.gaugeFill}>
          <NineSlice id="cyber.gaugeBg" tint="rgb(255 190 40)" slice={0} />
        </span>
        {/* 原作顶上是上限：右边一块实心黄牌，左边三道越来越短的线收进刻度 */}
        <span className={neural.gaugeTop}>
          <span className={neural.gaugeFan}>
            {[100, 72, 48].map((w) => (
              <span key={w} style={{ width: `${w}%` }}>
                <NineSlice id="cyber.gaugeBar" tint="rgb(255 190 40)" slice={0} />
              </span>
            ))}
          </span>
          <span className={neural.gaugeTag}>
            <NineSlice id="cyber.gaugeLabel" tint="rgb(255 190 40)" slice={4} />
            <b>{humanity.cap}</b>
          </span>
        </span>
        {/* 原作中间是当前值：一道红线压在刻度上，左边一块空心红牌 */}
        <span className={neural.gaugeLevel}>
          <NineSlice id="cyber.gaugeBar" tint="var(--cp-red)" slice={0} />
          <span className={neural.gaugeNow}>
            <NineSlice id="cyber.gaugeLabelStroke" tint="var(--cp-red)" slice={4} />
            <b>{humanity.current}</b>
          </span>
        </span>
      </span>
    </div>
  );
}

/** 一格里放的东西：有原作图就画图，没有就写名字 */
export interface DollPart {
  readonly id: string;
  readonly name: string;
  readonly broken?: boolean;
  /** 稀有度，给左边竖条染色（用户 2026-10-31："怎么没有稀有度颜色区分"） */
  readonly rarity?: string | null | undefined;
  /** 标志性义体，竖条用标志性的金色 */
  readonly iconic?: boolean | undefined;
}

/**
 * 人体、两侧部位组和人性条。悬停或聚焦的那组才弹详情（原作没有常驻的详情栏）；点一下钉住，移开也不收，再点收起。
 * 每个部位按原作格数装，装着的义体依次排在前面几格（用户 2026-10-31："为什么每个地方的义体只能选一个"）。
 * tip 给出某个部位的只读详情（剧情页）；捏人时不传 tip，传 onCell 和 selected，候选列在右栏（用户 2026-10-31："改成右侧整栏列表"）
 */
export function CyberDoll({
  parts,
  humanity,
  tip,
  tipLine,
  corner,
  selected = null,
  onCell,
}: {
  /** 每个部位装着的义体，按装上的先后排 */
  readonly parts: ReadonlyMap<CyberSlot, readonly DollPart[]>;
  readonly humanity: GaugeValue;
  /** 悬停或钉住单个格子时弹出的详情；不传就不弹（捏人时详情放右边整栏，用户 2026-10-31："框关不掉还挡格子"） */
  readonly tip?: (slot: CyberSlot, parts: readonly DollPart[], index: number) => ReactNode;
  /** 详情框线的颜色；不传按当前这格有没有打坏给 */
  readonly tipLine?: (slot: CyberSlot, parts: readonly DollPart[], index: number) => string;
  /** 右下角的东西：已装几件、断肢、义体医生入口、点数 */
  readonly corner?: ReactNode;
  /** 调用方明确选择的部位；值改变时同步切换人体 */
  readonly selected?: CyberSlot | null;
  /** 点格子交给调用方切换部位；不传就是钉住单个格子的详情 */
  readonly onCell?: (slot: CyberSlot, part: DollPart | undefined) => void;
}) {
  const [hovered, setHovered] = useState<{ slot: CyberSlot; index: number } | null>(null);
  const [focused, setFocused] = useState<{ slot: CyberSlot; index: number } | null>(null);
  const [pinned, setPinned] = useState<{ slot: CyberSlot; index: number } | null>(null);
  const [bodyView, setBodyView] = useState({ selected, slot: selected });
  // 人体只跟随查看动作或调用方的新选择，详情收起、失焦和固定状态不能把它切回去。
  if (bodyView.selected !== selected) setBodyView({ selected, slot: selected });
  const bodySlot = bodyView.selected === selected ? bodyView.slot : selected;
  const shown = hovered ?? focused ?? pinned;
  const activeLayers = bodySlot ? SLOT_BODY_LAYERS[bodySlot] : null;

  const previewBody = (slot: CyberSlot) => setBodyView({ selected, slot });
  const previewCell = (slot: CyberSlot, index: number) => {
    setHovered({ slot, index });
    previewBody(slot);
  };

  /** 计算每层解剖图透明度：未选中部位时皮肤常亮、免疫脉络幽微发光；聚焦时对应系统亮起 */
  const layerOpacity = (key: BodyLayerId): number => {
    if (!activeLayers) {
      if (key === "skin") return 0.92;
      if (key === "immune") return 0.22;
      return 0;
    }
    if (activeLayers.includes(key)) return 1;
    if (key === "skin") return 0.44;
    if (key === "immune") return 0.14;
    return 0;
  };

  /** 一个部位组：部位名下面一排格子；装着的义体依次放在前面几格，后面留空 */
  const group = ([slot, count, shift]: readonly [CyberSlot, number, number]) => {
    const list = parts.get(slot) ?? [];
    const label = CYBER_LABELS[slot];
    const shownCell = shown?.slot === slot ? shown.index : null;
    const cellPart = shownCell !== null ? list[shownCell] : undefined;
    const isPinnedTip = pinned?.slot === slot && pinned.index === shownCell;
    const line =
      shownCell !== null
        ? (tipLine?.(slot, list, shownCell) ??
          (cellPart?.broken ? "var(--cp-red)" : "var(--cp-yellow)"))
        : list.some((p) => p.broken)
          ? "var(--cp-red)"
          : "var(--cp-yellow)";
    return (
      <li
        key={slot}
        className={neural.cyberGroup}
        data-focus={bodySlot === slot || undefined}
        style={{ "--shift": shift } as CSSProperties}
      >
        <span className={neural.cyberLabel}>{label}</span>
        <span className={neural.cyberCells}>
          {Array.from({ length: count }, (_, i) => {
            const part = list[i];
            const art = part ? itemArtOf(part.id) : null;
            return (
              <button
                // biome-ignore lint/suspicious/noArrayIndexKey: 格子照原作格数排，空格子没有别的身份
                key={i}
                type="button"
                className={neural.cyberCell}
                aria-pressed={
                  onCell ? slot === selected : pinned?.slot === slot && pinned.index === i
                }
                aria-label={`${label}第 ${i + 1} 格：${part ? part.name : "空"}`}
                data-empty={!part || undefined}
                data-broken={part?.broken || undefined}
                data-rarity={part?.rarity}
                data-iconic={part?.iconic || undefined}
                onMouseEnter={() => previewCell(slot, i)}
                onMouseLeave={() => setHovered(null)}
                onFocus={(event) => {
                  previewBody(slot);
                  if (event.currentTarget.matches(":focus-visible")) setFocused({ slot, index: i });
                }}
                onBlur={() => setFocused(null)}
                onClick={() => {
                  previewBody(slot);
                  if (onCell) onCell(slot, part);
                  else
                    setPinned((p) =>
                      p?.slot === slot && p.index === i ? null : { slot, index: i },
                    );
                }}
              >
                <CyberCellFace />
                {part &&
                  (art ? (
                    <Asset id={art as AssetId} alt={part.name} className={neural.cyberArt} />
                  ) : (
                    <span className={neural.cyberCellName}>{part.name}</span>
                  ))}
                {part?.broken && (
                  <Asset
                    id="cyber.disabled"
                    tint="var(--cp-danger)"
                    height={16}
                    alt="打坏了"
                    className={neural.cyberBroken}
                  />
                )}
              </button>
            );
          })}
        </span>
        {/* 悬停或钉住那一格才弹详情；简洁呈现不堆杂框 */}
        {tip && shownCell !== null && (
          <div className={neural.cyberTip} role="tooltip">
            <Panel as="section" title={isPinnedTip ? `${label} · 已固定` : label} line={line}>
              {tip(slot, list, shownCell)}
            </Panel>
          </div>
        )}
      </li>
    );
  };

  return (
    <div className={neural.cyberScreen}>
      <HumanityGauge humanity={humanity} />
      <ul className={neural.cyberSide} data-side="left" aria-label="头部和躯干">
        {CYBER_SIDES[0]?.map(group)}
      </ul>
      <div className={neural.cyberBody} aria-hidden>
        {BODY_LAYER_ASSETS.map(({ key, id }) => (
          <Asset
            key={id}
            id={id}
            className={neural.cyberBodyLayer}
            style={{ opacity: layerOpacity(key) }}
          />
        ))}
      </div>
      <ul className={neural.cyberSide} data-side="right" aria-label="操作系统和四肢">
        {CYBER_SIDES[1]?.map(group)}
      </ul>
      {/* 原作右下角是空的：额外的东西收在这里，不挡人体和部位格 */}
      {corner && <div className={neural.cyberCorner}>{corner}</div>}
    </div>
  );
}
