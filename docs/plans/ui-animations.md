# 游戏 UI 动效增强计划

状态：进行中（2026-11-19）

## 目标

在不改动现有界面排版、NineSlice 九宫格边框体系、交互热区与信息密度前提下，为游戏全界面补齐统一、克制、富有赛博朋克 2077 电子 HUD 质感的入场/退场、切换与微交互动画，并严格遵守 `prefers-reduced-motion: reduce`。

## 设计准则

- **GPU 合成优先**：仅使用 `opacity`、`transform`、`clip-path`、`filter` 等不触发回流的属性。
- **利落节奏**：全局常规反馈 `150ms`、面板/弹窗 `180ms–220ms`，不拖沓、不干扰阅读。
- **可访问性兜底**：所有新增动画与过渡均在 `@media (prefers-reduced-motion: reduce)` 下关闭或归零。

---

## 实施步骤

### 步骤 1：基础动效令牌与通用 UI 控件触感
- `apps/web/src/styles/tokens.css`：新增 `--dur-modal`、`--ease-cyber`、`--ease-snap` 令牌，并在 `prefers-reduced-motion: reduce` 中将 `--dur-modal: 0ms`。
- `apps/web/src/ui/dialog.module.css`：为 `.backdrop` 与 `.dialog` 补充遮罩淡入与赛博弹出动效，覆盖全部确认框、结算卡、警报/错误弹窗。
- `apps/web/src/ui/button.module.css`、`apps/web/src/ui/actionbutton.module.css`：补充 `:active:not(:disabled)` 按压微缩放反馈，并补全 `prefers-reduced-motion` 规则。
- `apps/web/src/ui/HoldButton.tsx`：在长按确认掷骰过程中增加圆环脉动与轻微放大反馈。

### 步骤 2：剧情主界面、终端浮层与系统通知退场动画
- `apps/web/src/features/story/Toasts.tsx` & `story.module.css`：为系统通知增加 `data-leaving` 退场滑出与淡出动画，避免到点瞬间消失。
- `apps/web/src/features/story/StoryLog.tsx` & `story.module.css`：
  - `ChoiceList` 选项增加按 `--i` 错峰滑入动画（`choiceIn`）。
  - 为 `.liveStage`、`.liveStageDone`、`.notice`、`.replyChip`、`.turnIllustration` 与 `.divePanel` 补充入场/脉冲动画。
  - 为 `.journalBackdrop`、`.escMenu`、`.journal`、`.dossierDialog` 补充遮罩淡入与弹窗弹出动画。
- `apps/web/src/features/story/neural.module.css`：为地图浮层 `.mapLayer` 补充滑入/淡入动画。
- `apps/web/src/features/story/shop.module.css` / `Shop.tsx`、`ripperdoc.module.css` / `Ripperdoc.tsx`：补充终端弹窗入场动效与检视台/模式切换轻量化过渡。
- `apps/web/src/features/story/braindance.module.css` / `BraindanceEditor.tsx`：补充超梦全屏启动闪入与编码层切换扫描过渡。
- `apps/web/src/features/images/images.module.css`：为文生图弹窗与灯箱补充淡入和弹出动效。

### 步骤 3：四角 HUD、生物监测与角色创建工作台动效
- `apps/web/src/features/story/biomonitor.module.css`：补充危急系统节点的警戒呼吸灯动效（`data-alert="bad"`）与细节切换过渡。
- `apps/web/src/features/story/story.module.css`（手机消息流）：为消息气泡与空状态卡补充轻盈淡入动画。
- `apps/web/src/features/characters/CharacterCreator.tsx`、`workbench.module.css`、`characters.module.css`：
  - 为五步创角工作台 `.stageBody` 绑定步骤与子页签 `key` 并添加切换过渡（`stepPaneIn`）。
  - 为角色卡片/列表面板交互补充流畅过渡与 `prefers-reduced-motion` 规则。

### 步骤 4：静态检查与收口
- 运行 `pnpm typecheck` 与 `pnpm lint` 确保类型与代码规范零错误。
- 更新本计划文档状态为已完成，并提交 Git。
