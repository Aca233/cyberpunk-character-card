# 问题反馈通道与诊断日志导出计划

## 目标

为玩家与开发者提供开箱即用的「问题反馈通道 + 一键导出脱敏诊断日志包」，做到遇到剧情鬼打墙、交易结算异常、模型报错或界面卡顿后 10 秒内即可导出完整现场并提交反馈，无需手动翻控制台或手动开剧透查看器逐轮截图。

## 实施方案

- [x] **阶段一：运行时诊断日志环缓冲与 `/api/diagnostics` 接口（`packages/runtime`）**
  - 在 `packages/runtime/src/app.ts` 为 `deps.log` 包装一层内存环缓冲（保留最近 120 条带时间戳的已脱敏运行时日志）。
  - 在 `packages/runtime/src/game.ts` 新增 `diagnostics(saveId, options)`：无需打开剧透开关即可按指定轮数（默认 8 轮，上限 30 轮）导出当前存档的诊断快照：
    - 存档元信息与当前关键状态快照（地点、时间、欧元、死亡/收尾、活跃 `commerce.quotes` 报价单、挂起中的 `checkpoint` 断点）；
    - 最近 N 轮结构化记录（玩家输入、`read`、`ruling`、`decided`、`commands`、`dropped`、`notes`、`unsettled`、`offscreenSkip`、`usage`、`modules`、`budget`、正文、可选思维链与可选最后一轮重建的完整 prompt）；
    - 穿插在最近轮次中的界面操作记录（`action` 日志）。
  - 在 `packages/runtime/src/app.ts` 暴露 `GET /api/diagnostics?saveId=...&turns=8&includeThought=1&includePrompt=0`，汇总模型健康状态、脱敏配置摘要（绝不包含 API 密钥或鉴权头）、活跃预设摘要、运行时日志与存档诊断快照。
- [x] **阶段二：浏览器端异常自动捕获与 API 封装（`apps/web/src/api`）**
  - 新增 `apps/web/src/api/diagnostics.ts`：自动监听 `window.error` 与 `unhandledrejection` 并记录最近 50 条前端异常（自带常见密钥正则兜底脱敏），同时在 `apiFetch` 出错时写入错误缓冲，方便诊断接口/网络故障。
  - 在 `apps/web/src/api/client.ts` 封装 `api.diagnostics(...)` 及完整 TypeScript 类型定义，并在 `apps/web/src/main.tsx` 启动时安装前端错误捕获器。
- [x] **阶段三：设置页「06 问题反馈」面板与快捷入口（`apps/web/src/features/settings` & `story`）**
  - 新增 `apps/web/src/features/settings/FeedbackPanel.tsx`，接入 `SettingsScreen.tsx` 新分页 `06 问题反馈`（`/settings?tab=feedback`）：
    - 问题分类标签（剧情卡死/鬼打墙、交易/结算异常、模型报错、界面显示、人物设定、功能建议）、标题、详细描述与复现步骤；
    - 存档选择器（默认自动关联当前游玩存档或最近存档）、轮数范围（5 / 10 / 20 轮）、思维链/完整提示词开关、强制密钥脱敏说明；
    - 实时诊断状态预览（当前模型健康、已捕获报错/日志条数、活跃报价单与挂起断点提示）；
    - 三大一键动作：**导出完整诊断日志 (.json)**、**复制 Markdown 诊断摘要**、**打开 GitHub Issues 预填提交**（指向 `https://github.com/Aca233/cyberpunk-character-card/issues/new`）。
  - 在局内 Esc 暂停菜单（`EscMenu.tsx` + `StoryScreen.tsx`）新增「问题反馈 / 诊断日志」直达入口，并自动带上当前 `saveId`。
- [x] **阶段四：静态检查、构建与验证**
  - 通过 `biome lint .`（697 文件 0 错 0 警）、5 包 `tsc --noEmit` 与 `tsx tools/check-data.ts`。
