# 记忆管理移入设置上下文页

## 目标
- 移除游戏内 Esc 菜单的「记忆管理」入口及弹窗（保留游戏系统与人物档案中的「共同记忆」展示）。
- 将「记忆管理」（含「场景摘要」「共同记忆」「修改记录」的查看、改写与删除）迁入「设置 -> 上下文（调试）」页面。

## 修改范围
1. `apps/web/src/features/story/EscMenu.tsx`：移除 `onMemory` prop 及「记忆管理」菜单项。
2. `apps/web/src/features/story/StoryScreen.tsx`：移除 `atMemory` 状态、`onMemory` 回调及 `MemoryModal` 渲染。
3. `apps/web/src/features/story/MemoryPanel.tsx`：移除不再使用的 `MemoryModal`，保留 `MemoryBody` 与 `MemoryEdit` 供设置页复用。
4. `apps/web/src/features/settings/SettingsScreen.tsx` & `apps/web/src/features/settings/settings.module.css`：
   - 在 `ContextViewer` 中按当前选中的存档渲染「记忆管理」区块（复用 `MemoryBody`），并通过 `api.action(..., { type: "editMemory", ... })` 提交改写/删除，成功后刷新 `state` 与 `context` 查询，失败时展示错误信息。
   - 无论是否开启「剧透调试视图」，选好存档后即可在「上下文（调试）」里查看和编辑该存档的记忆；轮次提示词/判定详情仍受剧透开关保护。
   - 将 `.section ul` 收窄为 `.section > ul`，避免影响 `MemoryBody` 内部卡片列表与共同记忆列表的缩进。

## 验证
- 运行 TypeScript 类型检查与 Biome 规范检查。

## 状态
- [x] 方案记录
- [x] 代码修改
- [x] 类型与规范检查
- [x] Git 提交
