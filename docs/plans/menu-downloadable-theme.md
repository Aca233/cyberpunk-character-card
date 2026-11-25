# 游戏主界面可选可下载主题方案

> 状态：已完成
> 创建日期：2026-11-23

## 目标

为非剧情外壳界面提供「可选主题 + 按需下载本地缓存」能力，新增以用户提供的 4K 太空飞船舷窗动态壁纸为核心的 **「月球舷窗」** 动态主题，与默认 **「夜之城 2091」** 主题自由切换。

## 需求确认

1. **生效范围与局内开关**：主菜单（`/menu`）、设置页（`/settings`）与角色工作台（`/characters`）共用主题；剧情内（`/play/:saveId`）支持在 **「设置 → 叙事偏好 → 01 / 呈现 → 局内应用界面主题」** 或 **「界面主题面板顶部开关」** 自由开启/关闭局内主题同步（默认开启：局内同步使用当前所选主题的动态壁纸与配色；关闭时恢复按地点与时段切换的夜之城实景 `CityBackdrop` 与经典配色）。
2. **视觉定制与亮度通透感**：动态视频背景（自带 `brightness(1.14~1.18) saturate(1.1)` 提亮与极轻遮罩）+ 专属半透明主题配色（月球舷窗、雨夜窗畔、月面余光），在保证文字可读性的同时通透呈现动态壁纸细节；局内启用动态主题时仅对中央正文列保留柔和暗角，不叠双重重度黑遮罩。
3. **可下载机制**：仅按需下载并缓存至浏览器本地（IndexedDB Blob 存储），不提供另存原片按钮。默认主题「雨夜窗畔」内置直出；其余高码率主题在点击后显示实时进度并支持取消、失败重试与清理本地缓存。

## 架构与模块规划

### 1. 静态媒体资产（`apps/web/public/media/themes/`）

- `lunar-porthole-2k.mp4`：月球舷窗动态壁纸（由 14.3 MB 4K 原片压制为 2560×1440 30fps H.264 CRF 19，约 3.12 MB，去音轨并启用 `faststart`）。
- `lunar-porthole-poster.jpg`：从原片提取的 1920×1080 轻量封面预览图（供主题选择卡片预览、视频首帧防黑屏、以及 `prefers-reduced-motion` 静态降级）。
- `rain-window-2k.mp4`：雨夜窗畔动态壁纸（由 86.9 MB 原片压缩为 2560×1440 60fps H.264，约 3.05 MB，去音轨并启用 `faststart`）。
- `rain-window-poster.jpg`：雨夜窗畔 1920×1080 轻量预览封面（~136 KB）。
- `moon-helmet.mp4`：月面余光动态壁纸（由 149 MB 原片压制为 1920×1200 30fps H.264，约 5.85 MB，去音轨并启用 `faststart`）。
- `moon-helmet-poster.jpg`：月面余光 1920×1200 轻量预览封面（~175 KB）。
- 所有路径统一通过 `import.meta.env.BASE_URL` 拼接，兼容 `/` 与子路径部署；不触碰 `apps/web/public/assets/local/`，保持 `pnpm check-assets` 通过。

### 2. 主题注册表与按需缓存层（`apps/web/src/features/theme/`）

- `catalog.ts`：定义 `ShellThemeId`（`"night-city" | "lunar-porthole" | "rain-window" | "moon-helmet"`），默认主题为 `rain-window`（「雨夜窗畔」内置直接播放，无需手动点击下载）；`night-city` 为内置经典静态主题；`lunar-porthole` 与 `moon-helmet` 为按需下载缓存主题。
- `cache.ts`：封装浏览器端 IndexedDB Blob 缓存（库名 `cp-shell-theme-assets`，store `blobs`），提供 `getCachedThemeBlob`、`putCachedThemeBlob`、`deleteCachedThemeBlob`、`listCachedThemeMeta`。相较 Cache API 直接生成 `URL.createObjectURL(blob)`，在全浏览器下对 `<video loop>` 播放与无缝循环兼容性最佳，且不依赖安全上下文限制。
- `store.ts`：基于 `useSyncExternalStore` 的响应式主题状态管理：
  - `localStorage["cp.shellTheme"]` 持久化选中主题；
  - 启动时异步校验已缓存主题，若选中主题缓存丢失则安全回退到 `night-city`，绝不静默触发大文件拉取；
  - `downloadAndSelectTheme(id)` 流式拉取（`ReadableStream` + `AbortController`），实时更新已下载字节、百分比，校验非空写入 IndexedDB 后自动激活；
  - `selectTheme(id)` 切换内置或已缓存主题；
  - `cancelDownload(id)` 中止进行中的下载；
  - `clearThemeCache(id)` 删除本地缓存并释放 ObjectURL（若正在使用则自动切回 `night-city`）。

### 3. 配色令牌与共享背景组件

- `apps/web/src/styles/tokens.css`：新增 `[data-shell-theme="lunar-porthole"]` 变量覆盖块，定义星云紫、月光青、流金黄与深空暗蓝表面色阶，同时补充主菜单卡片/日志底色语义变量，使默认主题像素级不变、新主题视觉浑然一体。
- `apps/web/src/app.tsx`：在 `Shell()` 中监听路由、当前生效主题与 `useNarrativePrefs().storyTheme`，在 `/menu`、`/settings`、`/characters` 以及开启 `storyTheme` 时的 `/play/*` 同步 `document.documentElement.dataset.shellTheme`。
- `apps/web/src/features/story/CityBackdrop.tsx` + `story.module.css`：当 `storyTheme` 开启且当前主题带动态壁纸时，在局内背景层无缝续播当前主题视频/封面并减薄全域压暗遮罩；关闭或选用「夜之城 2091」时回退按地点与时段变化的夜之城实景。
- `apps/web/src/features/theme/ShellBackdrop.tsx` + `shell-backdrop.module.css` + `BackdropFxCanvas.tsx`：统一渲染外壳界面的背景层（静态夜之城或动态视频 + 鼠标阻尼视差景深 + 镜头缓呼吸漂移 + 主题专属轻量 Canvas 粒子层 + 极细全息扫线 + 适配遮罩 + 可选条幅 + 网格肌理 + 扫描线 + `panel.frame`），接入 `MainMenu`、`SettingsScreen`、`CharactersScreen`，且完整尊重 `prefers-reduced-motion` 与后台页签暂停。

### 5. 主题专属配乐与 Folia 风格主菜单动态歌词舞台

- **压缩音频资产**：`apps/web/public/media/themes/stay-at-your-house.mp3`（由用户上传的 3.95 MB 原音频通过 FFmpeg `libmp3lame 80kbps 44.1kHz stereo` 压缩至约 2.35 MB，体积缩减约 40%，全浏览器原生兼容）。
- **主题配乐联动（`apps/web/src/audio/engine.ts` + `apps/web/src/app.tsx`）**：
  - 当选用三个新主题（`rain-window` 雨夜窗畔、`lunar-porthole` 月球舷窗、`moon-helmet` 月面余光）时，**仅在主菜单等局外界面**无缝播放《I Really Want to Stay at Your House》，绝不在局内剧情（`/play/:saveId`）播放（局内始终保持原版自适应场景配乐）；
  - 切回「夜之城 2091」或进入局内存档时通过等功率交叉淡入淡出平滑切回原版配乐。
  - 暴露高精度播放时钟 `getActiveBgmTime()` 与歌词点击跳转 `seekActiveBgm(sec)`。
- **Folia 风格主菜单炫酷歌词组件（`apps/web/src/features/theme/ThemeLyricsStage.tsx` + `theme-lyrics.module.css` + `edgerunnersLyrics.ts`）**：
  - 修正原始 LRC 中译文时间戳位于句尾的偏移，构建精确对齐的英汉双语 + 副歌标记（`isChorus`）+ 逐词时间轴数据；
  - 提炼 `ymzhen/folia` 最契合赛博朋克边缘行者氛围的三种核心歌词动效模式，支持在主菜单顶部歌词舞台一键切换：
    1. **「流光 Lumiere」（默认）**：参考 Folia `PendoloActiveLyricSweep` 与 `Lumiere`，采用渐进柔边遮罩（`mask-image`）逐词扫掠点亮霓虹高光 + 逐词正弦脉冲抬升（`scale` + `translateY`）+ 上下文景深虚化 + 副歌赛博黄/冰青爆闪；
    2. **「倾诉 Tilt」**：参考 Folia `VisualizerTilt`，主副词交错斜体排印，奇偶字符上下错落进场（`yStagger`）并随节拍波浪跳动；
    3. **「云阶 Partita」**：参考 Folia `VisualizerPartita`，3D 透视斜向阶梯排布（`perspective` + `rotateY/rotateX`）与导引线，支持点击任意歌词行直接跳转播放进度。
  - 与主菜单 `[H] 赏景` 模式深度联动：常规状态下位于主菜单上方开放视野区（不遮挡左侧导航、右侧面板与壁纸中心人物）；开启 `[H] 赏景` 时平滑扩展为沉浸式大舞台歌词视图。
- `apps/web/src/features/theme/ThemeModal.tsx` + `theme-modal.module.css`：原生赛博切角弹窗（`NineSlice` + `Button` + `useLayer`），展示各主题 16:9 缩略图、配色条、体积/缓存状态、下载进度条、取消/启用/清除缓存按钮及错误提示。
- 入口接入：
  - `MainMenu.tsx` 左侧主菜单导航栏直接提供一级菜单项 **`界面主题`**（带当前主题名青色提示，悬停或点击直接在右侧舞台内嵌展示 4 套主题卡片一键切换/下载，不弹出遮挡背景的弹窗），同时保留左下「终端状态」卡片中的「主题」快捷跳转；
  - `SettingsScreen.tsx` 顶部遥测栏新增可点击的主题芯片，点击打开 `ThemeModal` 方便在设置页直接切换与管理缓存。

## 验收清单

- [x] 静态资源就位（4K MP4 + 轻量 JPG 封面），`pnpm check-assets` 通过
- [x] 默认首次打开不请求 14.3 MB 视频文件，保持默认「夜之城 2091」视觉无退化
- [x] 点击下载「月球舷窗」展示进度条、支持取消、完成后自动切换并写入 IndexedDB
- [x] 刷新页面后秒开已缓存动态主题，不重复走网络下载
- [x] 主菜单、设置页、角色工作台均同步应用动态视频背景与星云紫/冰青/流金配色；进入剧情页自动恢复夜之城主题
- [x] 清理本地缓存后自动回退至默认主题并释放内存
- [x] 通过 `typecheck`、`biome`、`check-data`、`check-assets` 与 `vite build`
