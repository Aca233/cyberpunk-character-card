# 场景摘要打散进设置上下文单轮视图

## 目标
- 移除游戏内 Esc 菜单的「记忆管理」入口及弹窗（已于上一提交完成）。
- 移除独立的「记忆管理」UI 及设置页内的「共同记忆」「修改记录」UI（游戏底层与人物档案里的「共同记忆」保留不动）。
- 将「场景摘要」（查看、改写与删除）直接打散放进「设置 -> 上下文（调试）」的「一轮存档」详情（`ContextDetail`）内。

## 修改范围
1. 删除 `apps/web/src/features/story/MemoryPanel.tsx`：不再保留独立记忆管理面板。
2. `apps/web/src/features/settings/SettingsScreen.tsx` & `apps/web/src/features/settings/settings.module.css`：
   - `ContextViewer` 恢复「剧透调试视图」门禁与 `存档 / 轮次` 选择结构，移除顶层「记忆管理」区块与共同记忆 UI。
   - 在 `ContextDetail` 中新增「场景摘要」`Section`（紧邻「扩展层（旧记忆）」），展示当前存档的场景摘要并支持改写标题/分量/正文与删除。

## 验证
- 运行 TypeScript 类型检查与 Biome 规范检查。

## 状态
- [x] 方案记录
- [x] 代码修改
- [x] 类型与规范检查
- [x] Git 提交
