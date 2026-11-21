import { type AssetId, assetUrlIfExists, loadedAssetIds, loadMapTiles } from "./index";

/**
 * 前端图片与地图瓦片分层预载调度器：
 * - critical (P0)：启动画面、主菜单与通用 UI 骨架（NineSlice 边框、遮罩图标、按钮底），立即高并发加载并解码保活。
 * - high     (P1)：当前页面/当前存档局面强相关资源（当前地点实景、在场头像、随身装备/义体/货架），可抢占低优队列并提权。
 * - normal   (P2)：剧情 HUD 骨架、地图低倍瓦片（z=0..2）、塔罗牌、义体解剖图与社交图鉴，空闲分批加载。
 * - low      (P3)：其余实际引用的长尾背景、物品/义体/武器图鉴，仅在页面可见、非忙碌且非省流模式下静默预热，不做全量 decode 防爆显存。
 */

export type PreloadPriority = "critical" | "high" | "normal" | "low";

export interface PreloadOptions {
  /** 是否在加载后调用 img.decode() 并收入核心保活池（适合 NineSlice / maskImage / 即将切换的大背景） */
  readonly decode?: boolean;
}

const PRIORITY_RANK: Readonly<Record<PreloadPriority, number>> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
};

interface QueueTask {
  readonly url: string;
  priority: PreloadPriority;
  decode: boolean;
  readonly promise: Promise<void>;
  readonly finish: () => void;
}

interface NetworkInfoLike {
  readonly saveData?: boolean;
  readonly effectiveType?: string;
}

const PIN_LIMIT = 96;

const states = new Map<string, "queued" | "loading" | "loaded" | "failed">();
const inflight = new Map<string, Promise<void>>();
const queuedByUrl = new Map<string, QueueTask>();
const buckets: Record<PreloadPriority, QueueTask[]> = {
  critical: [],
  high: [],
  normal: [],
  low: [],
};
/** 保留近期高优/核心 UI 图的 HTMLImageElement 引用，避免 NineSlice 与 CSS mask 挂载前被提前回收解码缓存 */
const pinnedImages = new Map<string, HTMLImageElement>();

let activeCount = 0;
let busyMode = false;
let idleScheduled = false;
let visibilityBound = false;
let mapTilesStarted: PreloadPriority | null = null;
let backgroundCatalogStarted = false;

function isConstrainedNetwork(): boolean {
  if (typeof navigator === "undefined") return false;
  const conn = (navigator as Navigator & { readonly connection?: NetworkInfoLike }).connection;
  if (!conn) return false;
  if (conn.saveData === true) return true;
  return conn.effectiveType === "slow-2g" || conn.effectiveType === "2g";
}

function isPageHidden(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}

function pinImage(url: string, img: HTMLImageElement): void {
  if (pinnedImages.has(url)) {
    pinnedImages.delete(url);
  } else if (pinnedImages.size >= PIN_LIMIT) {
    const oldest = pinnedImages.keys().next().value;
    if (oldest !== undefined) pinnedImages.delete(oldest);
  }
  pinnedImages.set(url, img);
}

function bindVisibilityListener(): void {
  if (visibilityBound || typeof document === "undefined") return;
  visibilityBound = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") schedulePump();
  });
}

function maxConcurrency(): number {
  if (buckets.critical.length > 0) return 6;
  if (buckets.high.length > 0) return 4;
  if (buckets.normal.length > 0) return 3;
  return 2;
}

function takeNextImmediate(): QueueTask | undefined {
  return buckets.critical.shift() ?? buckets.high.shift();
}

function takeNextIdle(): QueueTask | undefined {
  if (isPageHidden() || busyMode) return undefined;
  const normal = buckets.normal.shift();
  if (normal) return normal;
  if (isConstrainedNetwork()) return undefined;
  return buckets.low.shift();
}

function runTask(task: QueueTask): void {
  queuedByUrl.delete(task.url);
  if (states.get(task.url) === "loaded") {
    task.finish();
    return;
  }
  states.set(task.url, "loading");
  activeCount += 1;

  const img = new Image();
  img.decoding = task.decode ? "sync" : "async";

  let settled = false;
  const done = (ok: boolean) => {
    if (settled) return;
    settled = true;
    img.onload = null;
    img.onerror = null;
    states.set(task.url, ok ? "loaded" : "failed");
    inflight.delete(task.url);
    if (ok && task.decode) pinImage(task.url, img);
    activeCount = Math.max(0, activeCount - 1);
    task.finish();
    schedulePump();
  };

  const handleLoad = () => {
    if (task.decode && typeof img.decode === "function") {
      void img
        .decode()
        .catch(() => {})
        .finally(() => done(true));
    } else {
      done(true);
    }
  };

  img.onload = handleLoad;
  img.onerror = () => done(false);
  img.src = task.url;

  if (img.complete && img.naturalWidth > 0) {
    handleLoad();
  }
}

function pumpImmediate(): void {
  while (activeCount < maxConcurrency()) {
    const next = takeNextImmediate();
    if (!next) break;
    runTask(next);
  }
}

function pumpIdle(): void {
  idleScheduled = false;
  pumpImmediate();
  while (activeCount < maxConcurrency()) {
    const next = takeNextIdle();
    if (!next) break;
    runTask(next);
  }
}

function schedulePump(): void {
  pumpImmediate();
  if (idleScheduled) return;
  if (buckets.normal.length === 0 && buckets.low.length === 0) return;
  if (isPageHidden() || busyMode) return;
  if (buckets.normal.length === 0 && isConstrainedNetwork()) return;

  idleScheduled = true;
  if (typeof window !== "undefined" && "requestIdleCallback" in window) {
    window.requestIdleCallback(() => pumpIdle(), { timeout: 220 });
  } else {
    globalThis.setTimeout(() => pumpIdle(), 32);
  }
}

function removeFromBucket(task: QueueTask): void {
  const list = buckets[task.priority];
  const idx = list.indexOf(task);
  if (idx >= 0) list.splice(idx, 1);
}

/** 预载任意同源图片 URL；自动去重，后来的更高优先级请求可对排队中任务提权插队 */
export function preloadUrl(
  url: string,
  priority: PreloadPriority = "normal",
  options: PreloadOptions = {},
): Promise<void> {
  if (!url || typeof Image === "undefined") return Promise.resolve();
  bindVisibilityListener();

  const shouldDecode = options.decode ?? (priority === "critical" || priority === "high");
  const currentState = states.get(url);
  if (currentState === "loaded") return Promise.resolve();

  const queued = queuedByUrl.get(url);
  if (queued) {
    if (shouldDecode) queued.decode = true;
    if (PRIORITY_RANK[priority] < PRIORITY_RANK[queued.priority]) {
      removeFromBucket(queued);
      queued.priority = priority;
      buckets[priority].push(queued);
      schedulePump();
    }
    return queued.promise;
  }

  const running = inflight.get(url);
  if (running) return running;

  // 省流/极慢网络下跳过 low 级别全量图鉴入队，避免静默消耗流量
  if (priority === "low" && isConstrainedNetwork()) {
    return Promise.resolve();
  }

  let finish = () => {};
  const promise = new Promise<void>((resolve) => {
    finish = resolve;
  });

  const task: QueueTask = {
    url,
    priority,
    decode: shouldDecode,
    promise,
    finish,
  };

  states.set(url, "queued");
  inflight.set(url, promise);
  queuedByUrl.set(url, task);
  buckets[priority].push(task);
  schedulePump();
  return promise;
}

/** 判断 URL 是否已进入预载完成态 */
export function isUrlPreloaded(url: string): boolean {
  return states.get(url) === "loaded";
}

/** 标记前台是否处于高网络负载（如回合流式生成中），期间暂停 normal/low 后台预热，放行 critical/high */
export function setPreloadBusy(busy: boolean): void {
  if (busyMode === busy) return;
  busyMode = busy;
  if (!busy) schedulePump();
}

/** 按 AssetId 预载单张素材；索引中不存在时静默跳过，不污染缺图告警列表 */
export function preloadAsset(
  id: AssetId,
  priority: PreloadPriority = "normal",
  options?: PreloadOptions,
): Promise<void> {
  const url = assetUrlIfExists(id);
  if (!url) return Promise.resolve();
  return preloadUrl(url, priority, options);
}

/** 批量预载素材并等待全部结束（失败不抛异常） */
export function preloadAssets(
  ids: readonly AssetId[],
  priority: PreloadPriority = "normal",
  options?: PreloadOptions,
): Promise<void> {
  const seen = new Set<string>();
  const tasks: Promise<void>[] = [];
  for (const id of ids) {
    const url = assetUrlIfExists(id);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    tasks.push(preloadUrl(url, priority, options));
  }
  return Promise.all(tasks).then(() => undefined);
}

/** 按前缀批量加入预载队列（只包含当前 index.json 实际载入的素材） */
export function preloadByPrefixes(
  prefixes: readonly string[],
  priority: PreloadPriority = "low",
  options?: PreloadOptions,
): void {
  const ids = loadedAssetIds().filter((id) => prefixes.some((prefix) => id.startsWith(prefix)));
  void preloadAssets(ids, priority, options);
}

/** P0：启动画面 + 主菜单 + 通用控件（Panel / FrameBox / Button / MenuItem / Dialog）骨架素材 */
export const BOOT_MENU_ASSETS: readonly AssetId[] = [
  "splash.logo",
  "loading.circle",
  "fx.scanlines",
  "menu.nightCity",
  "menu.background",
  "menu.header",
  "menu.saveSlot",
  "menu.cellBorder",
  "menu.cellFill",
  "menu.arrowFill",
  "menu.arrowBorder",
  "panel.frame",
  "panel.glowLeft",
  "notify.itemCellBg",
  "notify.itemCellFg",
  "map.filterCellBg",
  "map.filterCellFg",
  "tab.bg",
  "tab.line",
  "fluff.attentionFill",
  "fluff.code",
  "key.enter",
  "key.tab",
  "key.esc",
];

/** P2：剧情主界面四角 HUD、面板、对话、快速破解与状态骨架 */
export const STORY_SHELL_ASSETS: readonly AssetId[] = [
  "hud.healthbar",
  "hud.ramBar",
  "hud.slotBg",
  "hud.slotFg",
  "hud.levelFrame",
  "hud.zoneFrame",
  "hud.zoneIcon",
  "hud.damageGlow",
  "fx.grid",
  "fx.vignette",
  "panel.cellBg",
  "panel.cellFg",
  "panel.glowBottom",
  "panel.techFrame",
  "map.panelBg",
  "map.panelFg",
  "map.tooltipBg",
  "map.tooltipFg",
  "map.shadowSmall",
  "map.shadowText",
  "map.pinDest",
  "map.pinPlayer",
  "map.pinPing",
  "map.pinShadow",
  "dialog.iconSlot",
  "dialog.lineSelect",
  "dialog.numberSlot",
  "dialog.skillSelect",
  "qh.cellBg",
  "qh.cellFg",
  "status.skull",
  "status.timeCircle",
  "loading.frame",
  "fluff.attention",
  "fluff.protocol",
  "braindance.clue",
  "braindance.recording",
];

const STORY_ICON_PREFIXES: readonly string[] = [
  "notify.",
  "key.",
  "district.",
  "weapon.",
  "interaction.",
];

const MAP_STATIC_ASSETS: readonly AssetId[] = [
  "map.filterBoxBg",
  "map.filterBoxFg",
  "map.panelBg",
  "map.panelFg",
  "map.tooltipBg",
  "map.tooltipFg",
  "map.pinDest",
  "map.pinPlayer",
  "map.pinPing",
  "map.pinShadow",
  "map.shadowSmall",
  "fx.grid",
];

/** P2/P3 后台实际引用的全量图鉴分组（刻意排除未使用的 check.hold.* / breach.* / skillcheck.* / attr.*） */
const SOCIAL_CATALOG_PREFIXES: readonly string[] = [
  "portrait.",
  "gang.",
  "brand.",
  "vehicleArt.",
  "cyber.",
  "tarot.",
];

const LONG_TAIL_CATALOG_PREFIXES: readonly string[] = [
  "itemArt.",
  "backdrop.",
  "cyberArt.",
  "weaponArt.",
];

/** 启动期核心包：在 Splash 画面期间把主菜单与全局 UI 骨架拉入解码缓存 */
export function preloadBootAssets(): Promise<void> {
  return preloadAssets(BOOT_MENU_ASSETS, "critical", { decode: true });
}

/** 剧情主界面壳层与常用图标预载 */
export function preloadStoryShellAssets(priority: PreloadPriority = "normal"): void {
  const decode = priority === "critical" || priority === "high";
  void preloadAssets(STORY_SHELL_ASSETS, priority, { decode });
  preloadByPrefixes(STORY_ICON_PREFIXES, priority, { decode: false });
}

/** 角色工作台核心包：塔罗牌（23 张）与义体人体解剖/格框（30 张） */
export function preloadCharacterWorkbenchAssets(priority: PreloadPriority = "normal"): void {
  preloadByPrefixes(["cyber."], priority, { decode: priority === "high" });
  preloadByPrefixes(["tarot."], priority, { decode: false });
}

/** 地图静态框体、POI 图标与低倍率瓦片（z=0..2，共 21 张约 540 KB）；无瓦片时退回预载 map.roads 整图 */
export function preloadMapAssets(priority: PreloadPriority = "normal"): void {
  void preloadAssets(MAP_STATIC_ASSETS, priority, { decode: priority === "high" });
  preloadByPrefixes(["map.poi."], priority, { decode: false });

  if (mapTilesStarted !== null && PRIORITY_RANK[mapTilesStarted] <= PRIORITY_RANK[priority]) {
    return;
  }
  mapTilesStarted = priority;

  void loadMapTiles().then((tiles) => {
    if (!tiles) {
      void preloadAsset("map.roads", priority, { decode: priority === "high" });
      return;
    }
    const baseMax = Math.min(tiles.maxZoom, 1);
    for (let z = 0; z <= baseMax; z++) {
      const n = 2 ** z;
      for (let x = 0; x < n; x++) {
        for (let y = 0; y < n; y++) {
          void preloadUrl(tiles.url(z, x, y), priority, { decode: false });
        }
      }
    }
    if (tiles.maxZoom >= 2) {
      const z2Priority: PreloadPriority = priority === "high" ? "normal" : "low";
      for (let x = 0; x < 4; x++) {
        for (let y = 0; y < 4; y++) {
          void preloadUrl(tiles.url(2, x, y), z2Priority, { decode: false });
        }
      }
    }
  });
}

/** 后台空闲全量实用图鉴预热（受省流、页面可见性与回合忙碌状态自动节流） */
export function preloadBackgroundCatalog(): void {
  if (backgroundCatalogStarted) return;
  backgroundCatalogStarted = true;
  preloadByPrefixes(SOCIAL_CATALOG_PREFIXES, "normal", { decode: false });
  preloadByPrefixes(LONG_TAIL_CATALOG_PREFIXES, "low", { decode: false });
}
