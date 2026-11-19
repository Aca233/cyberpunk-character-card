import type { CSSProperties } from "react";
import { type AssetId, asset } from "../assets";
import styles from "./asset.module.css";

/** 缺图时的报错框：不画替代样式，只写清缺哪张、怎么补 */
export function MissingAsset({ id, style }: { id: string; style?: CSSProperties | undefined }) {
  return (
    <span className={styles.missing} style={style} title="运行 pnpm pick-assets 重新生成素材">
      缺少素材 {id}
    </span>
  );
}

interface AssetProps {
  readonly id: AssetId;
  /** 原作图集大多是白色蒙版，给颜色时按蒙版染色（例如 var(--cp-red)） */
  readonly tint?: string;
  /** 指定高度（CSS 像素），宽度按比例；不写时按 1080p 的原始尺寸 */
  readonly height?: number;
  readonly width?: number;
  /** 有意义的图给文字说明；装饰图不写 */
  readonly alt?: string;
  readonly className?: string | undefined;
  readonly style?: CSSProperties;
  readonly "data-active"?: boolean | undefined;
}

export function Asset({
  id,
  tint,
  height,
  width,
  alt,
  className,
  style,
  "data-active": active,
}: AssetProps) {
  const info = asset(id);
  if (!info) return <MissingAsset id={id} />;
  const ratio = info.width / info.height;
  const h = height ?? (width !== undefined ? width / ratio : info.displayHeight);
  const w = width ?? h * ratio;
  const label = alt ? { role: "img", "aria-label": alt } : { "aria-hidden": true };
  if (tint === undefined) {
    return (
      <img
        src={info.url}
        width={w}
        height={h}
        alt={alt ?? ""}
        className={className}
        style={style}
        data-active={active || undefined}
        draggable={false}
      />
    );
  }
  return (
    <span
      {...label}
      data-active={active || undefined}
      className={[styles.masked, className].filter(Boolean).join(" ")}
      style={{
        ...style,
        width: w,
        height: h,
        backgroundColor: tint,
        maskImage: `url("${info.url}")`,
      }}
    />
  );
}

interface NineSliceProps {
  readonly id: AssetId;
  readonly tint: string;
  /**
   * 切线离边缘多少原图像素：一个数四边相同；四个数按 CSS 顺序 上、右、下、左
   * （原作 inkatlas 的 nineSliceScaleRect 是 Left、Top、Right、Bottom，抄过来时注意换顺序）
   */
  readonly slice: number | readonly [number, number, number, number];
  readonly className?: string | undefined;
  readonly style?: CSSProperties;
}

/**
 * 九宫格：铺满最近的 position: relative 父元素，按切线拉伸、染色。
 * 用 -webkit-mask-box-image（Chromium 内核浏览器）
 */
export function NineSlice({ id, tint, slice, className, style }: NineSliceProps) {
  const info = asset(id);
  if (!info) return <MissingAsset id={id} style={{ position: "absolute", inset: 0 }} />;
  const sides = typeof slice === "number" ? [slice] : slice;
  const cut = sides.join(" ");
  const widths = sides.map((s) => `${s / info.scale}px`).join(" ");
  return (
    <span
      aria-hidden
      className={[styles.nineSlice, className].filter(Boolean).join(" ")}
      style={{
        ...style,
        backgroundColor: tint,
        WebkitMaskBoxImage: `url("${info.url}") ${cut} fill / ${widths} stretch`,
      }}
    />
  );
}

/** 作为 CSS 背景或蒙版用：返回 url(...)；缺图时返回 undefined 并记进缺图列表 */
export function cssUrl(id: AssetId): string | undefined {
  const info = asset(id);
  return info ? `url("${info.url}")` : undefined;
}
