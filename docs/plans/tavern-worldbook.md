# 酒馆世界书（SillyTavern World Info / Lorebook）导入与管理方案

- **状态**：已完成（2026-11-27）
- **目标**：支持导入、新建、编辑、导出与多本并行启用 SillyTavern 世界书（World Info / Lorebook），按蓝灯常驻与绿灯关键词/递归触发规则动态注入叙事模型正文生成，同时**零干扰酒馆预设破甲链路**、**保护 KV 提示缓存命中率**，并纳入上下文预算与调试查看器追踪。

---

## 一、兼容格式

1. **标准 SillyTavern World Info JSON**（`{ entries: { "0": {...} } }` 或 `{ entries: [...] }`）：
   - 自动解析 `uid`、`comment` / `name`、`key` / `keys`、`keysecondary` / `secondary_keys`、`content`、`constant`、`selective`、`selectiveLogic`（`0=AND_ANY` / `1=NOT_ALL` / `2=NOT_ANY` / `3=AND_ALL`）、`order` / `insertion_order`、`position`（映射为 `before` / `after` / `at_depth`）、`depth`、`role`（`0=system` / `1=user` / `2=assistant`）、`disable` / `enabled`、`caseSensitive`、`matchWholeWords`、`scanDepth`。
2. **酒馆角色卡 V2 / V3 内嵌 `character_book`**（`{ data: { character_book } }` 或 `{ character_book }`）：自动提取内嵌世界书条目。
3. **导出**：一键导出为标准 SillyTavern World Info JSON，可无缝导回酒馆。

---

## 二、触发与注入机制（`@cp/core`：`packages/core/src/narrator/worldbook.ts`）

- **作用范围**：仅作用于第 ③ 步 `narrate`（叙事模型写正文，场外提问 OOC 跳过），不污染 `judge` 与 `extract` 的结构化记账。
- **支持多本并行启用**：可同时启用多本世界书，每本独立开关，每条条目独立开关与编辑。
- **关键词扫描源**：
  - 本轮玩家输入 + 最近 `scanDepth` 轮对话（默认 4 轮）+ 当前地点名称 + 在场 NPC 名称与外号；
  - 支持普通子串、全词匹配（`matchWholeWords`）、大小写敏感（`caseSensitive`）及 `/正则/flags` 语法；
  - 支持次级关键词（`selective` + `selectiveLogic`）与递归扫描（`recursiveScanning`，上限 2 轮防循环）；
  - 正文展开酒馆常用宏（复用 `expandMacros`：`{{user}}` / `{{char}}` / `{{lastUserMessage}}` / `{{// 注释}}` / `{{trim}}` 等）。
- **缓存友好 & 零干扰破甲的注入分层**：
  - **蓝灯常驻（`constant` 且非 `@D`）**：归入静态 `system` 前缀块（接在本作静态规则后、`【前情】` 前），跨回合稳定命中 KV 缓存；
  - **绿灯关键词动态命中（非 `constant` 且非 `@D`）**：放入最后一条 `user` 消息的独立 `【附加世界书】` 槽位，不击穿静态 `system` 与 `history` 缓存；
  - **指定深度（`position === "at_depth"`）**：按条目 `depth` 与 `role` 插入聊天记录；**先应用世界书 `@D` 注入，再叠加酒馆预设**，确保预设 `head` 始终位于最前、预设 `depth: 0` 预填/破甲条目始终位于原位不受干扰。
- **上下文预算与追踪**：
  - 纳入 `BudgetTrace`（新增 `worldbook` 分项），整份超出窗口时优先从低优先级（`order` 最小）动态关键词条目裁起，不挤占核心历史与已定事实；
  - 记录命中摘要（书名、条目名、命中方式：常驻 / 匹配关键词），在「上下文（调试）」查看器里可直接核对。

---

## 三、存储与接口（`@cp/runtime`）

- `packages/runtime/src/worldbooks.ts`：`WorldbookStore`（存 `worldbooks/wb-<id>.json` 到 `DocStore`/IndexedDB，结构对齐 `PresetStore`）。
- `packages/runtime/src/routes/worldbooks.ts`：挂载 `/api/worldbooks`：
  - `GET /`：世界书列表与条目摘要（不含正文全文）；
  - `POST /`：导入酒馆 `.json` 世界书或新建空白世界书；
  - `GET /:id/export`：导出标准酒馆世界书 JSON；
  - `GET /:id/entries/:entryId`：读取单条完整配置与正文；
  - `PATCH /:id`：改书名/启用开关/扫描参数、批量或单条改开关、新增/编辑/删除条目；
  - `DELETE /:id`：删除世界书。

---

## 四、界面设计（`apps/web`）

- 复用设置页第 02 标签（更名为 **「预设与世界书」**），顶部提供清晰双子页切换（**「酒馆预设」** / **「酒馆世界书」**），整体沿用赛博朋克 2077 视觉体系与左列表 + 右编辑器工作台布局：
  - 顶部状态总览条：展示已启用世界书数量、常驻与关键词条目数、快捷导入/新建入口；
  - 左侧边栏：世界书列表（支持一键开关、查看常驻/关键词条目数、导入 `.json`、新建空白书）；
  - 右侧工作台：书级设置（启用、扫描轮数、递归扫描、导出 `.json`、删除）+ 条目筛选（按名称/关键词、全部/已开/已关/蓝灯常驻/绿灯关键词）+ 条目展开编辑器（标题、蓝/绿灯模式、主/次关键词、位置/深度/角色、排序优先级、正文编辑、新增/删除条目）。
