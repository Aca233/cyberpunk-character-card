import { type AssetId, asset } from "./index";

/**
 * 鼠标指针：照原作 base\gameplay\gui\widgets\cursors\default_cursor.inkwidget 的 mouse 一项拼出来。
 * 平常是 mouse_shadow（深色底）上叠 mouse_frame（红色箭头框），悬停可点的东西换成 hand_shadow + hand，
 * 不能点时箭头框换成更深的红色，下面加一条 mouse_invalid_fluff。
 * 图集里的单图都是白色遮罩，在画布上按 tokens.css 的颜色上色，生成图片后写进 CSS 变量
 * --cp-cursor、--cp-cursor-hand、--cp-cursor-invalid；没拼成时这几个变量保持 tokens.css 里的系统指针
 */

interface Layer {
  readonly id: AssetId;
  /** 在拼图里的位置，原图像素 */
  readonly x: number;
  readonly y: number;
  /** tokens.css 里的颜色变量名 */
  readonly color: string;
}

interface CursorSpec {
  readonly variable: string;
  readonly fallback: string;
  /** 拼图大小，原图像素（素材是 2160p，即 CSS 像素的 2 倍） */
  readonly width: number;
  readonly height: number;
  /** 指针尖在拼图里的位置，CSS 像素 */
  readonly hotX: number;
  readonly hotY: number;
  readonly layers: readonly Layer[];
}

// 箭头框放在影子里 (3, 2) 的位置：框完全落在影子里，四周留出一圈深色边
const ARROW: readonly Layer[] = [
  { id: "cursor.arrowShadow", x: 0, y: 0, color: "--cp-cursor-shadow" },
  { id: "cursor.arrowFrame", x: 3, y: 2, color: "--cp-red" },
];

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
      { id: "cursor.hand", x: 3, y: 2, color: "--cp-red" },
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
      { ...(ARROW[1] as Layer), color: "--cp-red-line" },
      { id: "cursor.invalidFluff", x: 0, y: 66, color: "--cp-red-line" },
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
  target.drawImage(layer, x, y);
}

/** 按 scale 倍（相对 CSS 像素）画一张，返回 data URL */
function render(
  spec: CursorSpec,
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
    drawTinted(ctx, image, layer.x, layer.y, colors(layer.color));
  }
  return canvas.toDataURL("image/png");
}

/** 启动时调用一次；素材缺了就保持系统指针（缺图本身由 asset() 记进缺图列表） */
export async function installGameCursor(): Promise<void> {
  const root = document.documentElement;
  const style = getComputedStyle(root);
  const colors = (name: string) => style.getPropertyValue(name).trim();

  const ids = new Set(CURSORS.flatMap((c) => c.layers.map((l) => l.id)));
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
}
