# 物品栏卡片欧元显示计划

## 背景与问题

- 此前在全屏神经界面（`NeuralInterface`）顶部右上角展示过随身欧元余额（`.eddies` + `notify.cash` 图标）。
- 界面改版为四角就地展开后，物品栏合并到右下角 `Weapon` 卡片（`装备 · 物品栏`），顶部全屏栏被移除，导致玩家在主剧情界面与物品栏卡片中都看不到自己当前有多少欧元（`view.money.eddies`），只能等进入商店、义体医生或触发消费确认/变动提示时才看到。

## 目标

- 在右下角物品栏卡片（`Corners.tsx` 的 `Weapon`）中挤入随身欧元余额展示，使玩家在常态收起与悬停/按 `O` 展开状态下都能直接看到当前欧元。
- 不新增独立卡片、不破坏原有布局结构、不在同卡片内重复显示两份余额。

## 实现方案

1. **组件改动（`apps/web/src/features/story/Corners.tsx`）**
   - 在 `Weapon` 组件的底栏 `.slotFoot` 中加入 `.slotFootMeta`（或直接在 `.slotFoot` 右侧分组），在快捷键提示 `<kbd>` 左侧显示：
     - 原作货币图标 `<Asset id="notify.cash" tint="var(--cp-yellow)" height={11} />`
     - 格式化金额 `{eddies.toLocaleString("en-US")} 欧元`（使用 `strong` + 专属样式，避免命中 `.slot > :where(.inner) b` 的青色大字规则）
     - `title={`随身欧元：${eddiesText} 欧元`}` 与清晰的可访问标签
   - 无论常态收起还是展开 `装备 · 物品栏`，`.slotFoot` 均稳在卡片底栏，位置固定不跳动，也不重复渲染。

2. **样式适配（`apps/web/src/features/story/corners.module.css`）**
   - 新增 `.slotFootMeta` 与 `.slotCash` 样式：`--cp-yellow` 配色、`font-variant-numeric: tabular-nums`、`flex: none` 保证金额不被截断。
   - 在 `@media (width < 1600px)`（`280px` 窄角卡）下微调 `.slot` 左右内边距与 `.slotLine` 换行策略，保证常态 1 行展示，极端超重（`沉重 X/Y`）时也不截断金额或提示文字。
   - 当同侧其他卡片（如 `Track`）展开隐藏 `.slotLine` 时，`.slotFootMeta` 借助 `margin-left: auto` 继续右对齐贴合 `<kbd>O</kbd>`，不增加额外高度。

## 验证情况

- `tsc -p apps/web/tsconfig.json --noEmit`、`tsc -p apps/web/tsconfig.node.json --noEmit` 与 `biome check` 均已通过。
- 根据用户 2026-11-18 的明确要求，后续视觉与交互测试交由用户自行验收。

## 状态

- 已完成：`Corners.tsx`、`corners.module.css` 与 `AGENTS.md` 已更新并提交。
