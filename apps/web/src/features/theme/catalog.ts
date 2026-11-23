export type ShellThemeId = "night-city" | "lunar-porthole" | "rain-window" | "moon-helmet";

export const DEFAULT_SHELL_THEME_ID: ShellThemeId = "rain-window";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export interface ShellThemeBgmSpec {
  readonly id: string;
  readonly url: string;
  readonly title: string;
  readonly artist: string;
  readonly label: string;
}

export const EDGERUNNERS_THEME_BGM: ShellThemeBgmSpec = {
  id: "theme.edgerunners",
  url: `${BASE}/media/themes/stay-at-your-house.mp3`,
  title: "I Really Want to Stay at Your House",
  artist: "Rosa Walton & Hallie Coggins",
  label: "I Really Want to Stay at Your House — Edgerunners OST",
};

export interface ShellThemeSpec {
  readonly id: ShellThemeId;
  readonly name: string;
  readonly code: string;
  readonly badge: string;
  readonly summary: string;
  readonly details: string;
  readonly palette: readonly [string, string, string, string];
  readonly downloadable: boolean;
  readonly bgm?: ShellThemeBgmSpec;
  readonly media?: {
    readonly version: string;
    readonly videoUrl: string;
    readonly posterUrl: string;
    readonly estimatedBytes: number;
    readonly specLabel: string;
    readonly mimeType: string;
  };
}

const NIGHT_CITY_THEME: ShellThemeSpec = {
  id: "night-city",
  name: "夜之城 2091",
  code: "THEME // 01 · CLASSIC",
  badge: "内置经典",
  summary: "经典赛博红、霓虹黄与全息青，搭配夜之城高空远景与扫描线外框。",
  details: "静态实景 · 随应用内置加载",
  palette: ["#ff6158", "#5ef6ff", "#fcee0a", "#0c080e"],
  downloadable: false,
};

const LUNAR_PORTHOLE_THEME: ShellThemeSpec = {
  id: "lunar-porthole",
  name: "月球舷窗",
  code: "THEME // 02 · 2K LIVE",
  badge: "2K 动态 · 可下载",
  summary: "深空飞船舷窗外的地球星海与流金光片，搭配星云紫、月光青与流金点缀。",
  details: "专属配乐《I Really Want to Stay at Your House》· 按需缓存至本机浏览器",
  palette: ["#b794ff", "#7cf2ff", "#ffe270", "#070812"],
  downloadable: true,
  bgm: EDGERUNNERS_THEME_BGM,
  media: {
    version: "v2",
    videoUrl: `${BASE}/media/themes/lunar-porthole-2k.mp4`,
    posterUrl: `${BASE}/media/themes/lunar-porthole-poster.jpg`,
    estimatedBytes: 3_272_456,
    specLabel: "2K QHD · 30FPS · 含专属配乐与歌词",
    mimeType: "video/mp4",
  },
};

const RAIN_WINDOW_THEME: ShellThemeSpec = {
  id: "rain-window",
  name: "雨夜窗畔",
  code: "THEME // 03 · DEFAULT",
  badge: "默认 · 2K 60FPS",
  summary: "夜之城雨幕玻璃窗畔的霓虹倒影与露西侧影，搭配冷雨冰蓝、霓虹天青与暖金点缀。",
  details: "默认启用 · 2K 60帧循环壁纸 + 专属配乐《I Really Want to Stay at Your House》",
  palette: ["#78b8ff", "#6ef7ff", "#f7dc6f", "#050a14"],
  downloadable: false,
  bgm: EDGERUNNERS_THEME_BGM,
  media: {
    version: "v1",
    videoUrl: `${BASE}/media/themes/rain-window-2k.mp4`,
    posterUrl: `${BASE}/media/themes/rain-window-poster.jpg`,
    estimatedBytes: 3_194_308,
    specLabel: "2K QHD · 60FPS · 含专属配乐与歌词",
    mimeType: "video/mp4",
  },
};

const MOON_HELMET_THEME: ShellThemeSpec = {
  id: "moon-helmet",
  name: "月面余光",
  code: "THEME // 04 · HD LIVE",
  badge: "高清动态 · 可下载",
  summary: "月面宇航盔面罩中的大卫残影与星尘微光，搭配冷银蓝、泪光青与经典赛博黄。",
  details: "专属配乐《I Really Want to Stay at Your House》· 1920×1200 30帧动态壁纸",
  palette: ["#8ec5ff", "#72f6ff", "#fcee0a", "#050912"],
  downloadable: true,
  bgm: EDGERUNNERS_THEME_BGM,
  media: {
    version: "v1",
    videoUrl: `${BASE}/media/themes/moon-helmet.mp4`,
    posterUrl: `${BASE}/media/themes/moon-helmet-poster.jpg`,
    estimatedBytes: 6_134_370,
    specLabel: "1920×1200 · 30FPS · 含专属配乐与歌词",
    mimeType: "video/mp4",
  },
};

export const SHELL_THEMES: readonly ShellThemeSpec[] = [
  NIGHT_CITY_THEME,
  LUNAR_PORTHOLE_THEME,
  RAIN_WINDOW_THEME,
  MOON_HELMET_THEME,
];

export function isShellThemeId(value: unknown): value is ShellThemeId {
  return typeof value === "string" && SHELL_THEMES.some((theme) => theme.id === value);
}

export function themeById(id: ShellThemeId): ShellThemeSpec {
  return SHELL_THEMES.find((theme) => theme.id === id) ?? NIGHT_CITY_THEME;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}
