# 全游戏维度问题反馈与诊断包（v2）实施计划

## 痛点

当前 `cp-diagnostic-v1` 诊断包覆盖范围过窄：
- 仅导出 8 个基础快照字段与 `commerce` 一个切片，其余 30+ 个游戏子系统（战斗、潜行、黑客、伤势、赛博精神病、义体、背包、手机、NPC、帮派、委托、记忆、超梦、芯片、安全屋、通缉等）全部不可见；
- 缺少文生图元数据（不含图片本体）、角色卡、创意工坊扩展包、写作预设详情（启用条目与正则规则）、最近 API 请求轨迹、前端偏好设置与浏览器存储配额；
- 回合记录缺少 `recalled` / `expanded` / `lore` / `considered` / `guard`，且勾选完整提示词时仅重建了叙事阶段，缺少判断/抽取/场外阶段；
- 反馈分类仅有 6 项，未覆盖战斗黑客、文生图立绘、NPC/手机/委托、捏人/存档、创意工坊等高频问题域。

## 实施方案

- [x] **阶段一：运行时全系统诊断采集（`packages/runtime`）**
  - `packages/runtime/src/images.ts`：新增 `listRecentMetadata(limit)`，导出最近生图/上传记录的元数据（剥离 `dataUrl` 图片本体）。
  - `packages/runtime/src/game.ts`：`game.diagnostics()` 升级：
    - 默认附带 `worldState`（完整 `world.slices` 全部子系统状态）+ `edgeLedger` 聚合摘要 + `characterMeta` / `boardStart`（当前存档角色与主板快照）+ 各系统计数统计；
    - 补齐 `recentTurns` 中的 `dice`、`resolves`、`recalled`、`expanded`、`retrieval`、`lore`、`considered`、`flags`、`offscreen`、`summary`、`closeup`、`clutch`、`choices`；
    - 勾选 `includePrompt` 时重建最后一轮全阶段提示词（`judge` / `narrate` / `extract` / `offscreen` / `summary`）。
  - `packages/runtime/src/app.ts`：升级 `/api/diagnostics` 为 `cp-diagnostic-v2`，扩大运行日志环缓冲至 250 条，并新增 `presets`、`workshop`、`characters`、`images`（元数据 + 存档绑定）、`savesSummary`。
- [x] **阶段二：前端运行态与 API 轨迹采集（`apps/web/src/api`）**
  - `apps/web/src/api/diagnostics.ts`：补全 `nk-` / `pst-` 等密钥脱敏规则；新增 API 调用轨迹环缓冲（最近 60 条，含方法、路径、状态码、耗时、报错）；新增浏览器存储配额（`navigator.storage.estimate`）与当前页面环境采集。
  - `apps/web/src/api/client.ts`：在 `request()` 与 `streamEvents()` 自动记录 API 轨迹，扩展 `RuntimeDiagnosticsReport` 与 `api.diagnostics()` 参数类型。
- [x] **阶段三：反馈面板全分类与可视化预览升级（`apps/web/src/features/settings/FeedbackPanel.tsx`）**
  - 扩展反馈分类至 10 个全游戏维度（剧情卡死、战斗检定黑客、交易义体物品、NPC手机委托记忆、文生图立绘、模型连接预设、捏人角色卡存档、创意工坊、界面地图字体音频、优化建议）；
  - 新增可控导出开关（完整世界状态快照、思维链、文生图元数据、最后一轮全阶段提示词，全部默认勾选）与最高 30 轮窗口；
  - 右侧快照预览补齐 5 角色模型状态、工坊包、生图记录、API 轨迹异常与浏览器存储空间占用；Markdown 摘要同步覆盖关键异常。
- [x] **阶段四：静态检查与验收**
  - 已全部通过：`biome lint .`（699 文件 0 报错）、5 包 `tsc --noEmit`、`tsx tools/check-data.ts` 与 CSS Module 覆盖检查（25/25 类）。
