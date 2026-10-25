import { type AssetId, asset } from "./index";

/**
 * 鼠标指针：照原作 base\gameplay\gui\widgets\cursors\default_cursor.inkwidget 的 mouse 一项拼出来。
 * 平常是 mouse_shadow（深色底）上叠 mouse_frame（蓝色箭头框，MainColors.Blue），悬停可点的东西换成
 * hand_shadow + hand（MainColors.ActiveBlue），不能点时箭头框换成 MainColors.ActiveRed，下面加一条 mouse_invalid_fluff。
 * 颜色取自这个 inkwidget 里写着的 tintColor 值，见 tokens.css 的 --cp-cursor-tint 一组。
 * 按下鼠标时在指针尖闪一下 hov_dot（原作 clickFeedback 的 center_click：ActiveBlue，下面垫一层黑色影子）；
 * 原作的点击动画在 default_cursor_animations.inkanim 里，没解出来，动画的长短和放大幅度是本作改编。
 * 图集里的单图都是白色遮罩，在画布上按 tokens.css 的颜色上色，生成图片后写进 CSS 变量
 * --cp-cursor、--cp-cursor-hand、--cp-cursor-invalid；没拼成时这几个变量保持 tokens.css 里的系统指针，也不闪点击点
 */

interface Layer {
  readonly id: AssetId;
  /** 在拼图里的位置，原图像素 */
  readonly x: number;
  readonly y: number;
  /** 画成多大，原图像素；不写就按原图大小 */
  readonly w?: number;
  readonly h?: number;
  /** tokens.css 里的颜色变量名 */
  readonly color: string;
}

interface Sprite {
  /** 拼图大小，原图像素（素材是 2160p，即 CSS 像素的 2 倍） */
  readonly width: number;
  readonly height: number;
  readonly layers: readonly Layer[];
}

interface CursorSpec extends Sprite {
  readonly variable: string;
  readonly fallback: string;
  /** 指针尖在拼图里的位置，CSS 像素 */
  readonly hotX: number;
  readonly hotY: number;
}

// 箭头框放在影子里 (3, 2) 的位置：框完全落在影子里，四周留出一圈深色边
const ARROW: readonly Layer[] = [
  { id: "cursor.arrowShadow", x: 0, y: 0, color: "--cp-cursor-shadow" },
  { id: "cursor.arrowFrame", x: 3, y: 2, color: "--cp-cursor-tint" },
];

// 点击点：14×14 的 hov_dot 居中，下面垫一层放大到 22×22 的黑色影子（原作 center_click_shadow）
const CLICK_DOT: Sprite = {
  width: 24,
  height: 24,
  layers: [
    {
      id: "cursor.clickDot",
      x: 1,
      y: 1,
      w: 22,
      h: 22,
      color: "--cp-cursor-click-shadow",
    },
    { id: "cursor.clickDot", x: 5, y: 5, color: "--cp-cursor-click" },
  ],
};

const CURSORS: readonly CursorSpec[] = [
  {
    variable: "--cp-cursor",
    fallback: "auto",
    width: 66,
    height: 62,
    hotX: 2,
    hotY: 1,
    layers: ARROW,
  },
  {
    variable: "--cp-cursor-hand",
    fallback: "pointer",
    width: 70,
    height: 68,
    hotX: 3,
    hotY: 1,
    layers: [
      { id: "cursor.handShadow", x: 0, y: 0, color: "--cp-cursor-shadow" },
      { id: "cursor.hand", x: 3, y: 2, color: "--cp-cursor-tint-hover" },
    ],
  },
  {
    variable: "--cp-cursor-invalid",
    fallback: "not-allowed",
    width: 70,
    height: 76,
    hotX: 2,
    hotY: 1,
    layers: [
      ARROW[0] as Layer,
      { ...(ARROW[1] as Layer), color: "--cp-cursor-tint-invalid" },
      { id: "cursor.invalidFluff", x: 0, y: 66, color: "--cp-cursor-tint-invalid" },
    ],
  },
];

async function loadImage(url: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.src = url;
  await image.decode();
  return image;
}

/** 把一张白色遮罩按颜色上色，画到 target 上 */
function drawTinted(
  target: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  color: string,
  w?: number,
  h?: number,
): void {
  const layer = document.createElement("canvas");
  layer.width = image.naturalWidth;
  layer.height = image.naturalHeight;
  const ctx = layer.getContext("2d");
  if (!ctx) return;
  ctx.drawImage(image, 0, 0);
  ctx.globalCompositeOperation = "source-in";
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, layer.width, layer.height);
  target.drawImage(layer, x, y, w ?? layer.width, h ?? layer.height);
}

/** 按 scale 倍（相对 CSS 像素）画一张，返回 data URL */
function render(
  spec: Sprite,
  images: ReadonlyMap<AssetId, HTMLImageElement>,
  colors: (name: string) => string,
  sourceScale: number,
  scale: number,
): string | null {
  const ratio = scale / sourceScale;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(spec.width * ratio);
  canvas.height = Math.round(spec.height * ratio);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.imageSmoothingQuality = "high";
  ctx.scale(ratio, ratio);
  for (const layer of spec.layers) {
    const image = images.get(layer.id);
    if (!image) return null;
    drawTinted(ctx, image, layer.x, layer.y, colors(layer.color), layer.w, layer.h);
  }
  return canvas.toDataURL("image/png");
}

/**
 * 按下鼠标左键时在指针尖闪一下点击点。点不挡鼠标、读屏不念；
 * 系统设了减少动态时只淡出、不放大
 */
function installClickFeedback(url: string, width: number, height: number) {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  window.addEventListener(
    "pointerdown",
    (event) => {
      if (event.pointerType !== "mouse" || event.button !== 0) return;
      const dot = document.createElement("img");
      dot.src = url;
      dot.alt = "";
      dot.setAttribute("aria-hidden", "true");
      Object.assign(dot.style, {
        position: "fixed",
        left: `${event.clientX - width / 2}px`,
        top: `${event.clientY - height / 2}px`,
        width: `${width}px`,
        height: `${height}px`,
        pointerEvents: "none",
        zIndex: "2147483647",
      });
      document.body.append(dot);
      const animation = reduced.matches
        ? dot.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 150 })
        : dot.animate(
            [
              { transform: "scale(0.4)", opacity: 1 },
              { transform: "scale(1)", opacity: 1, offset: 0.35 },
              { transform: "scale(1.25)", opacity: 0 },
            ],
            { duration: 320, easing: "ease-out" },
          );
      const remove = () => dot.remove();
      animation.onfinish = remove;
      animation.oncancel = remove;
    },
    { capture: true, passive: true },
  );
}

/** 启动时调用一次；素材缺了就保持系统指针（缺图本身由 asset() 记进缺图列表） */
export async function installGameCursor(): Promise<void> {
  const root = document.documentElement;
  const style = getComputedStyle(root);
  const colors = (name: string) => style.getPropertyValue(name).trim();

  const ids = new Set([...CURSORS, CLICK_DOT].flatMap((c) => c.layers.map((l) => l.id)));
  const images = new Map<AssetId, HTMLImageElement>();
  let sourceScale = 2;
  try {
    for (const id of ids) {
      const info = asset(id);
      if (!info) return;
      sourceScale = info.scale;
      images.set(id, await loadImage(info.url));
    }
  } catch {
    return;
  }

  for (const spec of CURSORS) {
    const x1 = render(spec, images, colors, sourceScale, 1);
    const x2 = render(spec, images, colors, sourceScale, 2);
    if (!x1 || !x2) continue;
    const hot = `${spec.hotX} ${spec.hotY}`;
    const candidates = [
      `image-set(url("${x1}") 1x, url("${x2}") 2x) ${hot}, ${spec.fallback}`,
      `-webkit-image-set(url("${x1}") 1x, url("${x2}") 2x) ${hot}, ${spec.fallback}`,
      `url("${x1}") ${hot}, ${spec.fallback}`,
    ];
    const value = candidates.find((v) => CSS.supports("cursor", v));
    if (value) root.style.setProperty(spec.variable, value);
  }

  // 点击点只画 2 倍的一张，按 CSS 像素大小显示，1 倍屏由浏览器缩小
  const dot = render(CLICK_DOT, images, colors, sourceScale, 2);
  if (dot) installClickFeedback(dot, CLICK_DOT.width / sourceScale, CLICK_DOT.height / sourceScale);
}
