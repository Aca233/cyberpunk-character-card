import { type CSSProperties, type ReactNode, useState } from "react";
import type { AssetId } from "../../assets";
import { Asset, NineSlice } from "../../ui/Asset";
import { Panel } from "../../ui/Panel";
import { itemArtOf } from "./art";
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

/** 中间人体是原作 man_body 图集里同尺寸的几张分层图：选中哪个部位就显示哪层，其余部位用皮肤那层 */
const BODY_LAYERS: readonly AssetId[] = [
  "cyber.bodySkin",
  "cyber.bodySkeleton",
  "cyber.bodyNervous",
  "cyber.bodyCirculatory",
];
const BODY_OF: Readonly<Record<CyberSlot, AssetId>> = {
  frontalCortex: "cyber.bodyNervous",
  eyes: "cyber.bodyNervous",
  nervous: "cyber.bodyNervous",
  os: "cyber.bodyNervous",
  circulatory: "cyber.bodyCirculatory",
  integumentary: "cyber.bodySkin",
  skeleton: "cyber.bodySkeleton",
  hands: "cyber.bodySkeleton",
  arms: "cyber.bodySkeleton",
  legs: "cyber.bodySkeleton",
};

/** 一格的底子：原作切角底、金色电路纹、外框和左边的竖条，颜色由 CSS 变量给 */
function CyberCellFace() {
  return (
    <>
      <NineSlice
        id="cyber.cellShape"
        tint="rgb(14 14 23 / 88%)"
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
 * 选择框里一件义体的格子：和部位格同样的原作底子、电路纹和义体图，只看不点；装着的框亮成原作选中的黄
 * （用户 2026-10-31："保留弹窗，样式改成原作义体医生那样"）
 */
export function CyberItemCell({
  id,
  name,
  on = false,
  rarity,
  iconic = false,
}: {
  readonly id: string;
  readonly name: string;
  readonly on?: boolean;
  /** 稀有度，给左边竖条染色（用户 2026-10-31："怎么没有稀有度颜色区分"） */
  readonly rarity?: string | undefined;
  readonly iconic?: boolean | undefined;
}) {
  const art = itemArtOf(id);
  return (
    <span
      className={neural.cyberCell}
      data-item
      data-on={on || undefined}
      data-rarity={rarity}
      data-iconic={iconic || undefined}
      aria-hidden
    >
      <CyberCellFace />
      {art ? (
        <Asset id={art as AssetId} alt={name} className={neural.cyberArt} />
      ) : (
        <span className={neural.cyberCellName}>{name}</span>
      )}
    </span>
  );
}

export interface GaugeValue {
  readonly current: number;
  readonly cap: number;
  readonly stageLabel: string;
}

/**
 * 人性条：放在原作义体容量条的位置（用户选的「只要左边人性」）。
 * 刻度是原作 cw_barbg，填满的部分是同一张图染亮色、按当前人性占上限的比例从下往上露出来
 */
function HumanityGauge({ humanity }: { readonly humanity: GaugeValue }) {
  const fill = humanity.cap > 0 ? Math.min(1, Math.max(0, humanity.current / humanity.cap)) : 0;
  return (
    <div
      className={neural.gauge}
      style={{ "--fill": fill } as CSSProperties}
      title={`人性 ${humanity.current}/${humanity.cap} · ${humanity.stageLabel}`}
    >
      <span className={neural.gaugeHead}>人性</span>
      <span className={neural.gaugeTrack}>
        <NineSlice id="cyber.gaugeBg" tint="rgb(255 190 40 / 14%)" slice={0} />
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
      <small className={neural.gaugeStage}>{humanity.stageLabel}</small>
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
  /** 悬停或钉住时弹出的详情；不传就不弹（捏人时详情放右边整栏，用户 2026-10-31："框关不掉还挡格子"） */
  readonly tip?: (slot: CyberSlot, parts: readonly DollPart[]) => ReactNode;
  /** 详情框线的颜色；不传按有没有打坏给 */
  readonly tipLine?: (slot: CyberSlot, parts: readonly DollPart[]) => string;
  /** 右下角的东西：已装几件、断肢、义体医生入口、点数 */
  readonly corner?: ReactNode;
  /** 调用方正在看的部位，那组格子亮着 */
  readonly selected?: CyberSlot | null;
  /** 点格子交给调用方（捏人时空格选部位、装着的格直接卸下，用户 2026-10-31："格子不能直接装卸"）；不传就是钉住详情 */
  readonly onCell?: (slot: CyberSlot, part: DollPart | undefined) => void;
}) {
  const [hovered, setHovered] = useState<CyberSlot | null>(null);
  const [pinned, setPinned] = useState<CyberSlot | null>(null);
  const shown = hovered ?? pinned;
  const focus = hovered ?? selected ?? pinned;
  const layer = focus ? BODY_OF[focus] : "cyber.bodySkin";

  /** 一个部位组：红字部位名，下面一排格子；装着的义体依次放在前面几格，后面是空格 */
  const group = ([slot, count, shift]: readonly [CyberSlot, number, number]) => {
    const list = parts.get(slot) ?? [];
    const label = CYBER_LABELS[slot];
    const line =
      tipLine?.(slot, list) ?? (list.some((p) => p.broken) ? "var(--cp-red)" : "var(--cp-yellow)");
    return (
      <li key={slot} className={neural.cyberGroup} style={{ "--shift": shift } as CSSProperties}>
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
                aria-pressed={slot === (onCell ? selected : pinned)}
                aria-label={`${label}第 ${i + 1} 格：${part ? part.name : "空"}`}
                data-empty={!part || undefined}
                data-broken={part?.broken || undefined}
                data-rarity={part?.rarity}
                data-iconic={part?.iconic || undefined}
                onMouseEnter={() => setHovered(slot)}
                onMouseLeave={() => setHovered(null)}
                onFocus={() => setHovered(slot)}
                onBlur={() => setHovered(null)}
                onClick={() =>
                  onCell ? onCell(slot, part) : setPinned((p) => (p === slot ? null : slot))
                }
              >
                <CyberCellFace />
                {part && art ? (
                  <Asset id={art as AssetId} alt={part.name} className={neural.cyberArt} />
                ) : (
                  part && <span className={neural.cyberCellName}>{part.name}</span>
                )}
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
        {/* 只读详情；捏人时不弹，操作放右栏（用户 2026-10-31："悬停框按钮点不了"） */}
        {tip && shown === slot && (
          <div className={neural.cyberTip} role="tooltip">
            <Panel as="section" title={label} line={line}>
              {tip(slot, list)}
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
        {BODY_LAYERS.map((id) => (
          <Asset
            key={id}
            id={id}
            className={neural.cyberBodyLayer}
            style={{ opacity: id === layer ? 1 : 0 }}
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
