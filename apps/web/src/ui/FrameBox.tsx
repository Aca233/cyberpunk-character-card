import type { ReactNode } from "react";
import { Asset, NineSlice } from "./Asset";
import styles from "./framebox.module.css";

/** 原作 MapPanel 筛选格 map.filterCell* 的切法（同四角在场的人，计划第九节） */
const CELL_SLICE = [20, 30, 30, 20] as const;

/**
 * 原作格子的底和框两层（用户定的：只用原作素材，不手画边框）。
 * 颜色走父元素上的 --box-fill / --box-line，悬停、选中、聚焦时父元素改变量即可；
 * 父元素要 position: relative 和 isolation: isolate，两层垫在内容下面
 */
export function CellFrame() {
  return (
    <>
      <NineSlice
        id="map.filterCellBg"
        tint="var(--box-fill, rgb(14 14 23 / 72%))"
        slice={CELL_SLICE}
        className={styles.slice}
      />
      <NineSlice
        id="map.filterCellFg"
        tint="var(--box-line, var(--cp-red-dim))"
        slice={CELL_SLICE}
        className={styles.slice}
      />
    </>
  );
}

/** 输入框、下拉框外面套的原作格框：平时暗红，聚焦变青 */
export function FrameBox({
  children,
  className,
}: {
  readonly children: ReactNode;
  readonly className?: string | undefined;
}) {
  return (
    <span className={[styles.box, className].filter(Boolean).join(" ")}>
      <CellFrame />
      {children}
      <span className={styles.selectArrow} aria-hidden>
        <Asset id="menu.arrowFill" width={11} tint="currentColor" />
      </span>
    </span>
  );
}
