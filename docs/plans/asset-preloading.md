# 前端资源分层预载计划

状态：已完成（2026-11-22）

## 背景与痛点

当前前端素材与运行资源主要在组件首次挂载时按需拉取，存在以下体验问题：

1. **首屏与菜单切换闪烁**：UI 大量使用原作九宫格蒙版（`-webkit-mask-box-image`）与 `mask-image`（如 `panel.frame`、`notify.itemCellBg/Fg`、`map.filterCellBg/Fg`、`menu.nightCity`、`tab.bg` 等），首次渲染若未进缓存，面板框线、底板与背景会先空白一瞬再跳出。
2. **启动画面 2.4 秒空转**：`Splash` 播放期间未预热 `@cp/server/browser` 懒加载模块与 IndexedDB 本地后端，也未预取主菜单首屏所需的 `health` / `saves` / `characters` / `profiles` / `characterBoard` 查询数据。
3. **重度子界面初次打开延迟**：
   - 地图（`MapPanel` / `StartMapPicker`）初次打开才加载 `maptiles/index.json` 与低倍率瓦片（`z=0..2`，仅 21 张约 540 KB）及 `map.poi.*` 图标。
   - 角色工作台（`CharactersScreen`）初次打开才加载 23 张塔罗牌与 30 张义体解剖/格框素材。
   - 剧情界面（`StoryScreen`）切换地点、打开背包/义体医生/商店/联系人档案或查看已生成的立绘与回合插图时才开始读图。
4. **避免盲目全量抢带宽**：素材清单共 673 张（26.3 MB），其中约 150 张（如 `check.hold.0..99`、`breach.*` 等）当前页面并未引用，不应浪费带宽预载；同时长尾大图库（50 张地点实景、99 张武器图、91 张义体图）需要受控并发与空闲让路，避免在模型生成回合期间或省流模式下抢占网络与内存。

## 设计方案

### 四级优先级预载引擎（`apps/web/src/assets/preload.ts`）

- **P0 `critical`**（并发 6，立即执行 + `img.decode()` + 有限容量 LRU 保活池）：启动画面、主菜单及通用 UI 骨架（`Panel` / `FrameBox` / `Button` / `MenuItem` / `Dialog` / 常用按键提示）。
- **P1 `high`**（并发 4，可抢占低优先级队列，支持提权）：当前路由与当前存档局面强相关资源（当前地点与可前往目的地背景、在场 NPC 头像、已装备物品/义体/载具、当前诊所/商店货架、当前页高频组件）。
- **P2 `normal`**（并发 3，空闲调度）：剧情 HUD 骨架、地图低倍瓦片（`z=0..2`）与 POI 图标、塔罗牌、义体解剖图、原作头像、帮派/品牌/载具图鉴。
- **P3 `low`**（并发 2，空闲调度，不做全量 `decode()` 防爆显存）：其余已引用的长尾背景与物品/义体/武器图鉴；仅在页面可见、非回合生成忙碌期且未命中 `Save-Data` / `2g` 慢网时静默预热，严格排除未使用的素材前缀。

### 代码与数据预热

- **本地后端与 JS Chunk 预热**（`apps/web/src/api/transport.ts`）：新增 `warmLocalBackend()`，启动后立刻并行拉取 `@cp/server/browser` 动态模块，并在持有标签页 Web Lock 时提前完成 IndexedDB 后端初始化，不破坏多标签页锁协议。
- **React Query 数据预热**（`apps/web/src/assets/usePreload.ts`）：启动期预取 `health`、`saves`、`characters`、`profiles`、`characterBoard`、`glossary`；主菜单及最新存档就绪后静默预取最新存档的 `state`、`saveImages` 与当前地点背景图；剧情与角色页按需预取已绑定的 AI 生成图片缓存 `["image", id]`。

## 实施步骤

### 步骤 1：素材索引无副作用查询与本地后端预热
- `apps/web/src/assets/index.ts`：新增 `assetUrlIfExists`、`loadedAssetIds`、`loadedMapTiles`，避免预载查询误报缺图。
- `apps/web/src/features/story/mapCamera.ts`：`useMapTiles` 首帧同步读取 `loadedMapTiles()`，预载完成后打开地图不再闪切整图。
- `apps/web/src/api/transport.ts`：新增 `warmLocalBackend()`，缓存动态导入模块并安全预热本地后端。

### 步骤 2：分层优先级预载引擎与场景 Hooks
- `apps/web/src/assets/preload.ts`：实现去重、提权、并发控制、空闲调度、页面隐藏/忙碌暂停、省流感知、LRU 核心图保活池、精准素材分组与地图低倍瓦片预载。
- `apps/web/src/assets/usePreload.ts`：实现启动数据预热 `warmInitialQueries`、路由级预载 `useRoutePreload`、剧情局面精准预载 `useStoryPreload` 与角色工作台预载 `useCharactersPreload`。

### 步骤 3：接入启动入口、路由壳层、剧情与角色页面
- `apps/web/src/main.tsx`：素材索引就绪后立即启动 P0 预载、`warmLocalBackend()` 与首屏查询预热。
- `apps/web/src/app.tsx`：在 `Shell` 中接入 `useRoutePreload(busy)`，联动回合生成状态控制后台低优预载。
- `apps/web/src/features/story/CityBackdrop.tsx`：复用 `preloadAsset(target, "high", { decode: true })` 实现地点实景解码就绪后淡入。
- `apps/web/src/features/story/StoryScreen.tsx`：接入 `useStoryPreload(view, bindings, client)`。
- `apps/web/src/features/characters/CharactersScreen.tsx`：接入 `useCharactersPreload(editor.card, characters.data, client)`。

### 步骤 4：静态检查与收口
- 已通过 `tools/assets/check.ts`（673 张素材与路径规范检查）、`tsc -p apps/web/tsconfig.json`、`tsc -p apps/web/tsconfig.node.json` 与 `biome check`（全部 0 错误）。
- 已更新本计划状态并分步提交 Git，交由用户实际运行验收。
