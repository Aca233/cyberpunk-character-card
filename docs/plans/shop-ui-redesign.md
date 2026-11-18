# 商店页面 UI 重做计划

> 状态：已完成（2026-11-18）
> 目标：将现有简陋文本列表式 `Shop` 弹窗重做为与《赛博朋克 2077》夜之城终端风格一致、与 `Ripperdoc` / `InventoryPage` 视觉体系对齐的商店终端界面。

## 1. 现状与痛点

1. **视觉简陋**：当前 `apps/web/src/features/story/Shop.tsx` 复用 `story.module.css` 中的 `.journal`、`.docItem` 等纯文本列表样式，缺少 `itemArtOf(id)` 原作缩略图、稀有度色条（`--rar-*`）、`CellFrame` / `NineSlice` 框体与 `fx.grid` 展台。
2. **浏览与筛选缺失**：货架只按单一长列表分组展示（如威尔逊军火店多达 40 件商品），无分类标签、稀有度筛选、仅看可买切换或搜索框，窄屏下 `.shopBody` 缺乏响应式断点。
3. **缺少检视与对比信息**：没有右侧粘性 Inspector 面板展示商品大图、标签（品类、`subLabel`、是否占手/充能/回血）、当前背包已拥有数量，以及完整库存/限购/锁定原因。
4. **顶部信息拥挤**：店主、好感度、备注、黑市提示与补货状态挤在一段 `<p>` 中，未使用 `notify.cash` 欧元徽章、商店 POI 图标或店主头像。
5. **出售与后端投影信息不足**：`packages/core/src/systems/inventory/shops.ts` 的 `shopsView` 缺少 `kind`、`keeperNpc`、货架与出售列表的 `rarity` / `iconic` / `subLabel` / `bulky` 等字段，且 `sell[]` 在不可出售时（如武器装有配件、商店不收此类物品）只返回 `value: 0` 而未透出 `quote.reason`。

## 2. 设计方案

### 2.1 核心视图投影补全（`packages/core/src/systems/inventory/shops.ts`）
保留现有 `shopsView` 字段结构并补充直接来自目录与报价的元数据（不做历史兼容层，直接按当前需求补全投影）：
- 商店级：`kind`（用于映射 `map.poi.*` 图标）、`keeperNpc`（用于 `portraitOf` 店主头像）。
- `shelf[]`：补充 `kind`、`subLabel`、`rarity`、`iconic`、`bulky`、`charges`、`healPercent`。
- `sell[]`：补充 `group`、`kind`、`subLabel`、`rarity`、`rarityLabel`、`iconic`、`ability`、`bulky`、`locked`（当 `quote.ok === false` 时返回 `quote.reason`，明确提示「武器装有配件」或「该店不收购此类物品」）。

### 2.2 商店专用样式模块（`apps/web/src/features/story/shop.module.css`）
参照 `ripperdoc.module.css` 与 `tokens.css` 建立商店独立 CSS Module：
- 以 `--cp-yellow` 为主强调色（呼应夜之城自动售货/商贩终端），沿用 `Panel frame`（`panel.frame` 九宫格）、`CellFrame`、稀有度左侧色条与微弱光晕。
- **顶部商贩横幅**：左侧展示商店 POI 图标或店主头像、店名、店主名与好感徽章、黑市警告与补货/运输状态胶囊；右侧展示 `notify.cash` 欧元余额与离开按钮。
- **工具栏**：`买进货架` / `出手回收` 主模式切换、动态分类筛选标签、稀有度筛选胶囊、`仅看可买/可收` 开关与 `CellFrame` 搜索框。
- **双栏主体（`< 920px` 自动降为单栏）**：
  - 左栏：货架或回收列表，采用 `CellFrame` 卡片，含稀有度色条、原作物品图、名称、标签、背包已有数、余量/折扣与快捷买/卖按钮。
  - 右栏：粘性检视台（Inspector），包含 `fx.grid` 网格背景大图展示、属性标签（品类、稀有度、占手、充能/恢复等）、效果说明、价格/余量/锁定或拒收说明以及主操作按钮。

### 2.3 组件重构与交互（`apps/web/src/features/story/Shop.tsx`）
- 保持对外 Props 签名 `{ view, shop, onBuy, onSell, onClose }` 不变，确保 `StoryScreen.tsx`、`Corners.tsx`、`NeuralPages.tsx`、`Phone.tsx` 零改动接入。
- 复⽤ `cyberwareMeta.ts` 中的 `RARITY_ORDER`、`rarityTintOf`、`rarityLabelOf`（以及 `art.ts` 的 `itemArtOf`、`portraitOf`），避免重复稀有度映射逻辑。
- 确认弹窗（`Dialog` + `useLayer`）清晰展示交易类型、价格与扣款后余额预览（或回收折价说明），Esc 层级行为正确。
- 检查并清理 `story.module.css` 中不再使用的旧 `.shopBody` / `.shopBag` 样式。

## 3. 实施拆解（Swarm 分工）

1. **Step 1（协调者）**：建立本计划文件 `docs/plans/shop-ui-redesign.md` 并提交 git（已完成）。
2. **Step 2（并行：`core-shop` + `shop-styles`）**：
   - `core-shop`：修改 `packages/core/src/systems/inventory/shops.ts`，补全 `shopsView` 投影字段（已完成）。
   - `shop-styles`：新建 `apps/web/src/features/story/shop.module.css`（已完成）。
3. **Step 3（`shop-ui`）**：基于最新 `shopsView` 类型与 `shop.module.css` 重写 `apps/web/src/features/story/Shop.tsx`，并清理 `story.module.css` 中不再使用的 `.shopBody` / `.shopBag`（已完成）。
4. **Step 4（`verifier` + 协调者收口）**：代码审查与静态检查（`tsc`、`biome`）通过，已同步更新 `.tagWarn` 对比度与出售锁定文案，按项目约定不运行测试，交由用户最终验收（已完成）。
