# 自建义体 / 武器 / 物品图片支持方案

- **状态**：已完成（2026-11-27）
- **现状问题**：
  - `ItemDefSchema`、`CyberwareDefSchema` 与 `StartCyberwareSchema` 尚无图标/图片字段；
  - `apps/web/src/features/story/art.ts` 中的 `itemArtOf(id)` 仅查内置静态 `ITEM_ART` 表，自建 ID（`custom-wp-*` / `custom-item-*` / `custom-cw-*`）始终返回 `undefined`；
  - `CustomItemForm.tsx` 与 `CustomCyberwareForm.tsx` 未提供选图或上传图片入口。

## 实施方案

1. **数据结构扩展**（`inventory/schema.ts` / `cyberware/schema.ts` / `schemas/board.ts` / `game.ts` / `inventory/view.ts` / `cyberware/view.ts`）：
   - 在 `ItemDefSchema`、`CyberwareDefSchema`、`StartCyberwareSchema` 上新增两个可选字段：
     - `art?: string`：选用内置 2077 官方图标 ID（如 `weaponArt.*` / `itemArt.*` / `cyberArt.*`），零体积且可 100% 随存档与社区创意工坊分享；
     - `customImage?: string`：本地上传的紧凑缩略图（前端自动缩放到长边 ≤ 256px 的 WebP/PNG data URL，单张限额控制体积，支持透明底）。
   - `inventory` 与 `cyberware` 视图投影透传自定义图标字段（或通过全局运行时表按 `id` 查表），让局内所有页面统一读取。
2. **统一渲染与智能兜底**（`apps/web/src/features/story/art.ts` + 通用 `<GearArt>` 组件）：
   - 优先级：`customImage`（本地上传） → `art`（指定官方图标） → 内置 `ITEM_ART[id]` → **按武器/物品/义体分类自动匹配默认同类官方图标**（永不留空）。
   - 统一接入创角（`CreatorSteps` / `CustomItemForm` / `CustomCyberwareForm`）与局内全部装备/义体视图（`InventoryPage`、`CyberDoll`、`Ripperdoc`、`Shop`、`Profile`、`WeaponSlotInspector`、`CyberdeckPage`）。
3. **表单选图与上传交互**（`CustomItemForm.tsx` / `CustomCyberwareForm.tsx`）：
   - 新增「图标与图片」区块：
     - **挑官方图**：按当前所选武器类别 / 物品类型 / 义体分区自动筛出最贴合的 2077 官方图标网格，一键点选，也支持展开全部图标；
     - **上传本地图**：支持点击选择、拖拽或 Ctrl+V 粘贴 PNG/JPG/WebP（保留透明背景），自动压缩预览，支持一键清除回退；
     - 实时预览卡片角标效果。
4. **导出 / 导入 / 创意工坊兼容**：
   - 本地角色卡、本地自建库与存档导出/导入完整保留 `art` 与 `customImage`；
   - 创意工坊发布纯数据 JSON 包时，保留 `art`（官方图标跨人可见），避免大体积 base64 撑爆 D1。

## 验收标准
- `biome lint packages apps tools functions` 0 错误 / 0 警告；
- 6 份 `tsc --noEmit` 与 `tsx tools/check-data.ts` 全绿；
- 自建武器、物品、义体分别测试「挑官方图」「上传本地透明 PNG/JPG」「不选图自动兜底」三种情况，在创角、背包、衣橱、义体人形、档案、商店/义体医生中均正常显示且重启页面/读档后不丢失。
