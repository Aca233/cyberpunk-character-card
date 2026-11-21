# 思维链采集与默认折叠展示计划

状态：执行中

## 目标

支持将模型原生推理流（OpenAI 兼容 `reasoning_content` / `reasoning`、Anthropic `thinking_delta`、Gemini `thought`）以及酒馆预设正文中的思考标签（`<think>`、`<thinking>`、`<thought>`、`<think_nya>`、`<report_nya>`、`<reasoning>`、`<cot>`）统一采集为本轮思维链，并在剧情流中**默认折叠**展示，点击后展开查看；同时保持正文、记账抽取、历史对话与场景记忆纯净不受思维链污染。

## 实施步骤

- [ ] **Step 1：核心事件协议与思维链拆分器（`packages/core`）**
  - `packages/core/src/kernel/ports.ts`：`LlmEvent` 新增 `{ type: "thought"; text: string }`。
  - `packages/core/src/schemas/turn.ts`：`TurnEvent` 新增 `{ type: "thought"; text: string }`，`isTerminalEvent` 排除 `"thought"`。
  - `packages/core/src/narrator/thought.ts`：新增流式拆分器 `ThoughtStreamSplitter` 与静态提取器 `extractThoughtFromText`，支持常见成对思考标签（含 `<think_nya~>` 与尾随 `<!-- </think> -->` 注释）。
  - `packages/core/src/kernel/turnlog.ts`、`packages/core/src/narrator/checkpoint.ts`、`packages/core/src/game.ts`：在 `TurnRecord`、`NarratedCheckpointData`、`TurnCheckpointSummary`、`PlayerView.turns` 持久化与投影 `thought`。
  - `packages/core/src/narrator/turn.ts` 与所有 `LlmEvent` 消费者（`rewrite.ts`、`profiles.ts`、`grader.ts`）：安全处理 `thought` 事件；第 ③ 步合并原生思考与内联思考标签，实时触发 `onThought` 并随回合/草稿/断点保存。
- [ ] **Step 2：服务端 Provider 推理流透传与回合落盘（`apps/server`）**
  - `apps/server/src/providers/openai.ts`：解析 `delta.reasoning_content` / `delta.reasoning` / `delta.thinking` 并 yield `thought`。
  - `apps/server/src/providers/anthropic.ts`：解析 `thinking_delta` 并 yield `thought`。
  - `apps/server/src/providers/gemini.ts`：纯文本叙事请求开启 `includeThoughts: true` 并将 `part.thought === true` 的文本 yield 为 `thought`。
  - `apps/server/src/game.ts`：连接 `onThought` 推送至 `TurnHub`，并在 `commit` 时将 `turn.thought` 写入回合日志。
- [ ] **Step 3：前端实时接收与默认折叠组件（`apps/web`）**
  - `apps/web/src/features/story/store.ts`：维护实时流式 `thought` 状态并响应 `thought` 事件。
  - `apps/web/src/features/story/StoryLog.tsx` & `story.module.css`：新增默认折叠的 `<details>` `ThoughtBlock` 组件，覆盖已保存回合（含旧存档内联标签兜底折叠）、断点预览与流式生成中状态。
- [ ] **Step 4：静态类型与规范检查、更新计划状态并提交**
  - 运行 `biome check` 与全仓 `tsc --noEmit`；按步骤提交 `git`。
