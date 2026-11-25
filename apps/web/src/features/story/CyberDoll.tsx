import { cyberwareRules } from "@cp/core";
import { type CSSProperties, type ReactNode, useState } from "react";
import type { AssetId } from "../../assets";
import { Asset, cssUrl, NineSlice } from "../../ui/Asset";
import { Panel } from "../../ui/Panel";
import { ITEM_ELEMENT_META, itemArtOf, itemElementOf } from "./art";
import { CYBER_BODY_ART, CYBER_BODY_FRAME, CYBER_SLOT_ICON } from "./cyberwareMeta";
import neural from "./neural.module.css";
import type { View } from "./view";

/**
 * 2077 自由装配义体拓扑图（创角与局内共用）：
 * - 移除过时的左侧假 100/100 人性数值条，人体严格居中、10 组解剖节点左右对称展开；
 * - 不再绘制暗示固定上限的多余空格子：未装部位只显 1 个带解剖图标的空挂载格；
 * - 已装件按装机顺序呈现（最多单排 3 格，超过 3 件时第 4 格以「+N」收纳），绝不撑爆或遮挡相邻部位。
 */

export type CyberSlot = View["cyberware"][number]["slot"];

export const CYBER_LABELS: Readonly<Record<CyberSlot, string>> = {
  frontalCortex: "额皮质",
  eyes: "面部与感官",
  nervous: "神经系统",
  os: "操作系统",
  circulatory: "循环系统",
  integumentary: "表皮系统",
  skeleton: "骨骼",
  hands: "手掌",
  arms: "胳臂",
  legs: "腿部",
};

/** 左右两侧 10 个解剖部位排布：[部位 id, 顺着肩臂指尖轮廓向外错开系数] */
const CYBER_SIDES: readonly (readonly (readonly [CyberSlot, number])[])[] = [
  [
    ["frontalCortex", 0],
    ["arms", 0.45],
    ["skeleton", 0.85],
    ["nervous", 0.3],
    ["integumentary", 0],
  ],
  [
    ["os", 0],
    ["eyes", 0.45],
    ["hands", 0.85],
    ["circulatory", 0.3],
    ["legs", 0],
  ],
];

/** 单部位最多同排展示 3 格（超过 3 件时显示 2 件 +「+N」收纳格，永不撑爆宽度） */
const MAX_INLINE_CELLS = 3;

/** 全图与局部图都预先挂载；切换时只显示当前视图，避免重新取图或多张完整人体混叠。 */
const BODY_BASE_ASSETS = [...new Set(Object.values(CYBER_BODY_ART).map(({ base }) => base))];
const BODY_DETAILS = Object.entries(CYBER_BODY_ART).flatMap(([slot, { detail }]) =>
  detail ? [{ slot, ...detail }] : [],
);

/** 一格的底子：原作切角底、金色电路纹、外框和稀有度竖条，颜色由 CSS 变量给 */
function CyberCellFace() {
  return (
    <>
      <NineSlice
        id="cyber.cellShape"
        tint="var(--cp-surface-raised)"
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

/** 列表/诊所里单件义体的缩略方格 */
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
  readonly rarity?: string | undefined;
  readonly iconic?: boolean | undefined;
  readonly broken?: boolean | undefined;
  readonly size?: number | undefined;
}) {
  const art = itemArtOf(id);
  const element = itemElementOf(id);
  const style = size !== undefined ? ({ "--cell": `${size}px` } as CSSProperties) : undefined;
  return (
    <span
      className={neural.cyberCell}
      data-item
      data-on={on || undefined}
      data-broken={broken || undefined}
      data-rarity={rarity}
      data-iconic={iconic || undefined}
      data-element={element}
      style={style}
      aria-hidden
    >
      <CyberCellFace />
      {art ? (
        <Asset id={art as AssetId} alt={name} className={neural.cyberArt} />
      ) : slot ? (
        <span
          aria-hidden
          className={neural.cellFallbackIcon}
          style={{
            maskImage: cssUrl(CYBER_SLOT_ICON[slot]),
            WebkitMaskImage: cssUrl(CYBER_SLOT_ICON[slot]),
          }}
        />
      ) : (
        <span className={neural.cyberCellName}>{name}</span>
      )}
      {element && (
        <span className={neural.cyberElementBadge}>{ITEM_ELEMENT_META[element].badge}</span>
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

/** 单件已装义体的投影数据 */
export interface DollPart {
  readonly id: string;
  readonly name: string;
  readonly broken?: boolean;
  readonly rarity?: string | null | undefined;
  readonly iconic?: boolean | undefined;
}

/**
 * 居中对称人体解剖拓扑图：
 * - 点击任意部位标题、已装义体格或空挂载格均可切换 selected 部位；
 * - 若调用方传了 tip 则支持悬停预览浮窗（默认新版局内页与创角页都使用右侧常驻检视栏，不挡人体）。
 */
export function CyberDoll({
  parts,
  tip,
  tipLine,
  corner,
  selected = null,
  selectedPartId = null,
  showAddSlots = false,
  onCell,
}: {
  readonly parts: ReadonlyMap<CyberSlot, readonly DollPart[]>;
  readonly tip?: (slot: CyberSlot, parts: readonly DollPart[], index: number) => ReactNode;
  readonly tipLine?: (slot: CyberSlot, parts: readonly DollPart[], index: number) => string;
  readonly corner?: ReactNode;
  readonly selected?: CyberSlot | null;
  /** 精确聚焦的已装义体 id，用于高亮具体某一格 */
  readonly selectedPartId?: string | null;
  /** 创角等可编辑场景开启：未装满的部位旁额外显示「+」开放挂载格，直觉传达可继续叠装 / 双臂混搭 */
  readonly showAddSlots?: boolean;
  readonly onCell?: (slot: CyberSlot, part: DollPart | undefined) => void;
}) {
  const [hovered, setHovered] = useState<{ slot: CyberSlot; index: number } | null>(null);
  const [focused, setFocused] = useState<{ slot: CyberSlot; index: number } | null>(null);
  const [pinned, setPinned] = useState<{ slot: CyberSlot; index: number } | null>(null);
  const [bodyView, setBodyView] = useState({ selected, slot: selected });
  if (bodyView.selected !== selected) setBodyView({ selected, slot: selected });
  const bodySlot = bodyView.selected === selected ? bodyView.slot : selected;
  const shown = hovered ?? focused ?? pinned;
  const bodyBase = bodySlot ? CYBER_BODY_ART[bodySlot].base : "cyber.bodySkin";

  const previewBody = (slot: CyberSlot) => setBodyView({ selected, slot });
  const resetBody = () => setBodyView({ selected, slot: selected });
  const previewCell = (slot: CyberSlot, index: number) => {
    setHovered({ slot, index });
    previewBody(slot);
  };

  const renderGroup = ([slot, shift]: readonly [CyberSlot, number]) => {
    const list = parts.get(slot) ?? [];
    const label = CYBER_LABELS[slot];
    const isSelectedSlot = slot === selected;
    const hasBroken = list.some((p) => p.broken);
    const hasOverflow = list.length > MAX_INLINE_CELLS;
    const visible = hasOverflow ? list.slice(0, MAX_INLINE_CELLS - 1) : list;
    const overflow = hasOverflow ? list.length - visible.length : 0;
    const isArms = slot === "arms";
    const pairTag =
      isArms && list.length >= 2
        ? "混搭"
        : isArms && list.length === 1 && list[0]
          ? cyberwareRules.isSingleArmCyberware(list[0].id)
            ? "单臂"
            : "双臂"
          : slot === "eyes" &&
              list.some(
                (p) =>
                  cyberwareRules.cyberwareExclusiveGroup({
                    id: p.id,
                    name: p.name,
                    slot: "eyes",
                  }) === "optics",
              )
            ? "双目"
            : slot === "legs" &&
                list.some(
                  (p) =>
                    cyberwareRules.cyberwareExclusiveGroup({
                      id: p.id,
                      name: p.name,
                      slot: "legs",
                    }) === "legDrive",
                )
              ? "双腿"
              : null;
    const emptyMounts = isArms ? (["primary", "secondary"] as const) : (["primary"] as const);
    const canShowTrailingAdd =
      showAddSlots &&
      list.length > 0 &&
      list.length < MAX_INLINE_CELLS &&
      (!isArms || list.length < 2);
    const shownCell = shown?.slot === slot ? shown.index : null;
    const cellPart = shownCell !== null ? list[shownCell] : undefined;
    const isPinnedTip = pinned?.slot === slot && pinned.index === shownCell;
    const line =
      shownCell !== null
        ? (tipLine?.(slot, list, shownCell) ??
          (cellPart?.broken ? "var(--cp-red)" : "var(--cp-yellow)"))
        : hasBroken
          ? "var(--cp-red)"
          : "var(--cp-yellow)";

    return (
      <li
        key={slot}
        className={neural.cyberGroup}
        data-focus={bodySlot === slot || undefined}
        data-selected={isSelectedSlot || undefined}
        data-equipped={list.length > 0 || undefined}
        data-broken={hasBroken || undefined}
        style={{ "--shift": shift } as CSSProperties}
      >
        <button
          type="button"
          className={neural.cyberLabelBtn}
          aria-pressed={isSelectedSlot}
          title={
            list.length > 0
              ? `${label}（${list.length} 件）：${list.map((p) => p.name).join("、")}`
              : `${label}：尚未装配`
          }
          onMouseEnter={() => previewBody(slot)}
          onMouseLeave={resetBody}
          onFocus={() => previewBody(slot)}
          onClick={() => {
            previewBody(slot);
            onCell?.(slot, list[0]);
          }}
        >
          <span className={neural.cyberLabel}>{label}</span>
          {pairTag && <span className={neural.cyberPairTag}>{pairTag}</span>}
          {list.length > 0 && <span className={neural.cyberSlotCount}>{list.length}</span>}
        </button>

        <span className={neural.cyberCells}>
          {visible.length === 0 ? (
            emptyMounts.map((mountKey, idx) => (
              <button
                key={`empty-${slot}-${mountKey}`}
                type="button"
                className={neural.cyberCell}
                aria-pressed={
                  onCell ? isSelectedSlot : pinned?.slot === slot && pinned.index === idx
                }
                aria-label={
                  isArms
                    ? `${label}（${idx === 0 ? "主臂/成对" : "副臂混搭"}）：尚未装配，点击查看可选义体`
                    : `${label}：尚未装配，点击查看可选义体`
                }
                title={
                  isArms
                    ? "单装成对件默认双臂生效；也可装 2 件左右臂混搭"
                    : `${label}：点击装配（可自由叠加）`
                }
                data-empty=""
                data-slot-active={isSelectedSlot || undefined}
                onMouseEnter={() => previewCell(slot, idx)}
                onMouseLeave={() => {
                  setHovered(null);
                  resetBody();
                }}
                onFocus={(event) => {
                  previewBody(slot);
                  if (event.currentTarget.matches(":focus-visible")) {
                    setFocused({ slot, index: idx });
                  }
                }}
                onBlur={() => setFocused(null)}
                onClick={() => {
                  previewBody(slot);
                  if (onCell) onCell(slot, undefined);
                  else {
                    setPinned((p) =>
                      p?.slot === slot && p.index === idx ? null : { slot, index: idx },
                    );
                  }
                }}
              >
                <CyberCellFace />
                <span
                  aria-hidden
                  className={neural.cellEmptyIcon}
                  style={{
                    maskImage: cssUrl(CYBER_SLOT_ICON[slot]),
                    WebkitMaskImage: cssUrl(CYBER_SLOT_ICON[slot]),
                  }}
                />
                {showAddSlots && <span className={neural.cellPlusMark}>+</span>}
              </button>
            ))
          ) : (
            <>
              {visible.map((part, i) => {
                const art = itemArtOf(part.id);
                const element = itemElementOf(part.id);
                const isSelectedPart =
                  selectedPartId !== null ? part.id === selectedPartId : isSelectedSlot;
                return (
                  <button
                    key={part.id}
                    type="button"
                    className={neural.cyberCell}
                    aria-pressed={
                      onCell ? isSelectedPart : pinned?.slot === slot && pinned.index === i
                    }
                    aria-label={`${label}：${part.name}${part.broken ? "（已损毁）" : ""}`}
                    title={`${part.name}${part.broken ? "（已损毁 · 需检修）" : ""} — 点击查看详情`}
                    data-slot-active={isSelectedSlot || undefined}
                    data-part-active={
                      (selectedPartId !== null && part.id === selectedPartId) || undefined
                    }
                    data-broken={part.broken || undefined}
                    data-rarity={part.rarity}
                    data-iconic={part.iconic || undefined}
                    data-element={element}
                    onMouseEnter={() => previewCell(slot, i)}
                    onMouseLeave={() => {
                      setHovered(null);
                      resetBody();
                    }}
                    onFocus={(event) => {
                      previewBody(slot);
                      if (event.currentTarget.matches(":focus-visible")) {
                        setFocused({ slot, index: i });
                      }
                    }}
                    onBlur={() => setFocused(null)}
                    onClick={() => {
                      previewBody(slot);
                      if (onCell) onCell(slot, part);
                      else {
                        setPinned((p) =>
                          p?.slot === slot && p.index === i ? null : { slot, index: i },
                        );
                      }
                    }}
                  >
                    <CyberCellFace />
                    {art ? (
                      <Asset id={art as AssetId} alt={part.name} className={neural.cyberArt} />
                    ) : (
                      <span
                        aria-hidden
                        className={neural.cellFallbackIcon}
                        style={{
                          maskImage: cssUrl(CYBER_SLOT_ICON[slot]),
                          WebkitMaskImage: cssUrl(CYBER_SLOT_ICON[slot]),
                        }}
                      />
                    )}
                    {element && (
                      <span className={neural.cyberElementBadge}>
                        {ITEM_ELEMENT_META[element].badge}
                      </span>
                    )}
                    {part.broken && (
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
              {canShowTrailingAdd && (
                <button
                  type="button"
                  className={`${neural.cyberCell} ${neural.cyberAddCell}`}
                  aria-pressed={isSelectedSlot}
                  aria-label={
                    isArms ? `${label}：点击为另一臂混搭第 2 件义体` : `${label}：点击继续叠装义体`
                  }
                  title={
                    isArms
                      ? "当前单装成对件默认双臂生效；点击可再选第 2 件改左右臂混搭"
                      : `${label}不限格数，点击继续叠装`
                  }
                  data-empty=""
                  data-slot-active={isSelectedSlot || undefined}
                  onMouseEnter={() => previewBody(slot)}
                  onMouseLeave={resetBody}
                  onFocus={() => previewBody(slot)}
                  onClick={() => {
                    previewBody(slot);
                    onCell?.(slot, undefined);
                  }}
                >
                  <CyberCellFace />
                  <span className={neural.cyberAddText}>＋</span>
                </button>
              )}
              {overflow > 0 && (
                <button
                  type="button"
                  className={`${neural.cyberCell} ${neural.cyberMoreCell}`}
                  aria-pressed={
                    selectedPartId !== null
                      ? list.slice(MAX_INLINE_CELLS - 1).some((p) => p.id === selectedPartId)
                      : isSelectedSlot
                  }
                  aria-label={`${label}另有 ${overflow} 件已装义体`}
                  title={`展开查看其余 ${overflow} 件：${list
                    .slice(MAX_INLINE_CELLS - 1)
                    .map((p) => p.name)
                    .join("、")}`}
                  data-slot-active={isSelectedSlot || undefined}
                  onMouseEnter={() => previewBody(slot)}
                  onMouseLeave={resetBody}
                  onFocus={() => previewBody(slot)}
                  onClick={() => {
                    previewBody(slot);
                    onCell?.(slot, list[MAX_INLINE_CELLS - 1]);
                  }}
                >
                  <CyberCellFace />
                  <span className={neural.cyberMoreText}>+{overflow}</span>
                </button>
              )}
            </>
          )}
        </span>

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
      <div className={neural.cyberBackdrop} aria-hidden>
        <span className={neural.cyberScanGrid} />
        <span className={neural.cyberAxis} />
        <span className={neural.cyberCrosshair} />
        <span className={neural.cyberRing} />
        <span className={neural.cyberRingInner} />
      </div>
      <ul className={neural.cyberSide} data-side="left" aria-label="头部和躯干">
        {CYBER_SIDES[0]?.map(renderGroup)}
      </ul>
      <div className={neural.cyberBody} aria-hidden>
        {BODY_BASE_ASSETS.map((id) => (
          <Asset
            key={id}
            id={id}
            className={neural.cyberBodyLayer}
            data-active={bodyBase === id || undefined}
          />
        ))}
        {BODY_DETAILS.map(({ slot, id, left, top, width, height }) => (
          <span
            key={id}
            className={neural.cyberBodyDetail}
            data-active={bodySlot === slot || undefined}
            style={{
              left: `${(left / CYBER_BODY_FRAME.width) * 100}%`,
              top: `${(top / CYBER_BODY_FRAME.height) * 100}%`,
              width: `${(width / CYBER_BODY_FRAME.width) * 100}%`,
              height: `${(height / CYBER_BODY_FRAME.height) * 100}%`,
            }}
          >
            <Asset id={id} className={neural.cyberBodyDetailArt} />
          </span>
        ))}
      </div>
      <ul className={neural.cyberSide} data-side="right" aria-label="操作系统和四肢">
        {CYBER_SIDES[1]?.map(renderGroup)}
      </ul>
      {corner && <div className={neural.cyberCorner}>{corner}</div>}
    </div>
  );
}
