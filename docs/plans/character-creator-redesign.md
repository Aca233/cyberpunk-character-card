# 人物创建流程与界面重做设计方案

- **状态**: 进行中（2026-11-18）
- **目标**: 将原本割裂的「三栏工作台 + 全屏弹窗 + 孤立按钮样式」重做为统一风格的**单页五步引导工作台（Step-Guided Workbench）**，修复义体/地图/样本保存等交互问题，并按项目约定彻底清理历史遗留死代码与冗余兼容字段。

---

## 1. 现状痛点总结

1. **交互心智割裂**: 出身、特质/过往、缺陷、行装、人脉、开局地点全部依赖全屏 `CreatorModal` 弹窗编辑，而义体与人设小传却放在右侧标签页，导致切换编辑路径跳跃。
2. **遗留死代码与无效样式堆积**:
   - `BoardEditor.tsx`（仅导出 `emptyBoard`）、`creator-shell.module.css`（271 行完全未引用）。
   - `characters.module.css` 与 `workbench.module.css` 混杂大量旧步进器时代未使用的 CSS。
   - `CharacterCreator.tsx` 使用了未定义样式的 `cp-tabs` / `cp-tab-line`。
   - `DraftAll` / `ProseField` / `CustomModuleForm` 使用普通硬边框 `toolButton`，与全站 `NineSlice`（`Button` / `ActionButton` / `Panel`）视觉割裂。
3. **局部交互缺陷**:
   - `CyberDoll` 在已选中某槽位时再次点击会直接卸载义体，容易误触；`.dollFrame` 使用非标准 `zoom: 0.8` 影响容器断点与缩放表现。
   - `StartMapPicker` 地名检索区分大小写。
   - `CharactersScreen` 中 `isSample = editor.sample && !modified` 导致编辑样本角色任意一字后底部按钮文案误切为「保存角色」。
   - `< 1180px` 视口下三栏直接塌陷成超长纵向堆叠，缺少步骤跳转能力。
   - `originLean` / `originNever` 未在 UI 中呈现；`onSave` 失败被静默吞掉。
4. **核心与后端历史兼容包袱**:
   - `packages/core/src/schemas/board.ts` 保留了不再使用的 `BACKGROUND_POINTS`、`REFUND_MAX`、`MODULE_POINTS`、`boardBudget`、`points` 计分字段以及被强制清空的 `combos` 整条链路。
   - `packages/core/src/schemas/character.ts` 保留了未使用的 `ATTRIBUTE_POINTS`、`pointsSpent()` 等属性点分配遗留代码。

---

## 2. 新流程与界面架构（单页五步引导工作台）

保留 `/characters` 单页编辑入口与右侧/抽屉角色库管理，主工作区重做为 **顶部步骤导航 + 主编辑舞台 + 常驻实时档案侧栏 + 底部操作条**：

### 2.1 五步核心流程（可按顺序「上一步/下一步」，也可点击步骤条任意跳转）

1. **Step 1 · 身份与出身 (`identity`)**
   - 身份铭牌：姓名、代号、人称代词（`他 / 她 / TA` 快捷选择）。
   - 内嵌出身选择器（取消弹窗）：生态分类筛选（公司 / 街头 / 网络 / 恶土 / 自创）、关键字检索、卡片网格、内置 `+ 自创出身` 工坊面板。
   - 实时展示所选出身的默认开局资助（起始资金、基础装备、自带义体、默认落脚点）。

2. **Step 2 · 过往、特质与缺陷 (`traits`)**
   - 分区/子页签整合：**过往经历 (0–5)**、**核心特质 (0–10)**、**负面缺陷 (0–6)**。
   - 整合**「掷一段生命路径」**（随机填充过往并提示关联缺陷）与**「随机补齐特质」**。
   - 利用 `originLean` / `originNever` 在特质卡上显示出身倾向角标（如「契合当前出身」「与出身冲突」）。
   - 将 `+ 自创过往 / 特质 / 缺陷` 统一为 `NineSlice` 风格的展开工坊表单。

3. **Step 3 · 义体与开局态势 (`chrome_kit`)**
   - **义体装配区**：左侧/上方为无 `zoom` hack 的自适应 `<CyberDoll />`，右侧为 10 槽位切换条与 `<CyberwareShelf />`，下方为**义体耐受度 (`低 / 标准 / 高`) + 术后人性仪表盘**，清晰列出出身/黑客自带免费义体及被替换状态。
     - **交互修复**：点击 `CyberDoll` 仅负责聚焦切换对应槽位，**禁止二次点击直接卸载**；所有装上、替换、卸下统一在货架详情栏或明确的「卸下」按钮完成。
   - **开局行装与落脚点区**（同页分栏或子标签）：
     - 资金档位（身无分文 / 街头标配 / 私房积蓄 / 意外横财）、至多 2 把额外武器（标明出身已含）、至多 1 台额外载具。
     - 内嵌 `<StartMapPicker />`（修复大小写不敏感检索，支持「跟随出身」重置）。

4. **Step 4 · 人脉与人设小传 (`people_prose`)**
   - **夜之城人脉**：内嵌双栏编辑器（预设 NPC / 自创熟人 / 一键新增旧识 + 关系类型与 60 字备注）。
   - **AI 撰稿与小传工作台**：直接呈现 `DraftAll`（文风预设、附加要求、仅补空白/全部解锁、一键生成、流式预览、停止/撤销）与 4 个核心 `ProseField`（外貌、背景故事、性格、说话方式）；另外 3 项角色卡导出字段（开场场景、开场白、对话示例）以统一卡片分区呈现并明确标注「仅随角色卡/酒馆导出，不占用正剧叙事上下文」。

5. **Step 5 · 档案总览与开局 (`review`)**
   - 汇总展示完整人物档案（身份、出身、义体拓扑只读快照、过往/特质/缺陷、行装与落脚点、人脉关系、人设小传），每个区块提供「前往修改 ▸」直接跳转对应步骤。
   - 展示实时核验状态（缺失项可点击跳转对应步骤），配合底部操作栏一键「保存并开启战局」。

### 2.2 外围交互优化（角色库、导入导出与响应式）

- **角色库面板（`CharactersScreen`）**：保留轻量可收起抽屉/侧栏切换角色、新建空白角色、导入酒馆卡（JSON/PNG + AI 映射开关），移除抽屉与顶栏重复的「新建」按钮。
- **底部常驻操作栏**：左侧提供保存/另存为自定义角色（修复样本角色编辑后 `isSample` 误变导致按钮文案错乱的问题）、导出角色卡、导出自创扩展包、删除与错误提示；右侧提供 `上一步` / `下一步` 与开局存档名 + `开启战局`。
- **视觉统一与响应式**：全部交互按钮统一迁移至 `Button` / `ActionButton`（`NineSlice tab.bg`）与 `Panel` / `FrameBox`，在 `< 1180px` 视口下将预览摘要与步骤条收拢为紧凑顶栏 + 抽屉/Tab，避免超长纵向堆叠。

---

## 3. 核心与后端历史兼容清理范围

遵循 `AGENTS.md`「制作阶段不做历史兼容」：

1. **`packages/core/src/schemas/board.ts` & `packages/content` & `apps/server` & `tools/check-data.ts`**:
   - 移除 `BACKGROUND_POINTS`、`REFUND_MAX`、`MODULE_POINTS`、`BoardBudget`、`boardBudget()`。
   - 移除 `ComboSchema`、`BoardComboSchema`、`BoardSchema.combos`、`boardCombos()`、`BoardTables.combos` 及 `packages/content/src/combos.ts`。
   - 清理纯点数兼容字段：`BoardModule.points`、`StartCyberware.points`、`RelationInfo.points`、`TOLERANCE_LEVELS[].points`、`CASH_TIER_INFO[].points`、`START_CYBERWARE_POINTS`（`apps/server/src/routes/characters.ts` 改为基于允许稀有度集合校验）。
   - 清理 `packages/core/src/systems/character/schema.ts` 的 `TRAIT_SLOTS` 中的 `"combo"` 及 `narrator/turn.ts` 中 `"联动"` 映射（若无其他引用）。
2. **`packages/core/src/schemas/character.ts`**:
   - 移除未使用的 `ATTRIBUTE_POINTS`、`pointsSpent()`。
   - 保留 `attributes` 默认结构（因 `legends.ts` 的 `tarotOf` 与运行时 `cyberware` 属性加成仍依赖 `SaveCharacter.attributes`）。
3. **同步清理相关静态引用与测试用例代码**（确保 `pnpm typecheck` 与 `pnpm lint` 全绿；按项目约定不主动跑测试流程，交由用户验收）。

---

## 4. Swarm 执行拆分

1. `core-cleaner`（workspace: `inherit`）：负责 `packages/core`、`packages/content`、`apps/server`、`tools/` 中历史点数与 `combos` 死代码清理，以及对应测试文件类型对齐。
2. `web-logic`（workspace: `inherit`）：负责 `apps/web/src/api/client.ts`、`apps/web/src/features/characters/creator.ts`、`creator.test.ts`、`tavernFile.ts` 的重构（移除 `combos`/`comboHints`、导出 `emptyBoard`、补齐步骤状态/核验辅助函数、修复 `StartMapPicker` 大小写检索等），并删除 `BoardEditor.tsx` 与 `creator-shell.module.css`。
3. `web-ui`（workspace: `inherit`）：在 `web-logic` 与 `core-cleaner` 确定接口后，重写 `CharactersScreen.tsx`、`CharacterCreator.tsx`、`CreatorSteps.tsx`、`CreatorLife.tsx`、`StartMapPicker.tsx`、`CustomModuleForm.tsx`、`DraftAll.tsx`、`ProseField.tsx` 及其 CSS 模块（删除 `CreatorModal.tsx`）。
4. `verifier`（workspace: `inherit`）：全面审查 diff、验证无死代码/无样式错位/无 `zoom:0.8`/无误触卸载、运行 `pnpm typecheck` 与 `pnpm lint`（不运行测试流程）。

---

## 5. 执行进度

- [x] 现状调研（`web-scout`、`core-scout`）
- [x] 设计方案定稿与计划留存（`docs/plans/character-creator-redesign.md`）
- [ ] 核心/后端历史兼容清理（`core-cleaner`）
- [ ] 前端状态逻辑与目录清理（`web-logic`）
- [ ] 五步引导工作台与 NineSlice 界面重写（`web-ui`）
- [ ] 静态类型与规范检查（`verifier`：`pnpm typecheck`、`pnpm lint`）
