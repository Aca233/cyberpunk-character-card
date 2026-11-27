# 建档与工坊自建 NPC / 修改 NPC 实施计划

- **状态**：已完成（2026-11-27）
- **已确认范围**：
  - 入口范围：**先只做建档工作台（`CreatorLife`）与创意工坊（`WorkshopPublishModal` / 本地创作库）里的自建与编辑 NPC**（暂不改局内面板）。
  - 权限与防剧透：**原作 NPC 与自建 NPC 均可编辑**；编辑原作 NPC 时，**「生平背景」与「隐藏秘密」默认折叠隐藏（防剧透）**，需玩家主动点击展开后才显示和修改。

---

## 一、数据结构与持久化设计

1. **角色卡主板结构（`packages/core/src/schemas/board.ts`）**
   - `BoardSchema` 新增两个可选字段：
     - `customNpcs: NpcCard[]`（默认 `[]`）：本角色用到的**自建原创 NPC 完整人物卡**（自包含快照，导出角色卡或换设备开新档不丢失，告别 `"还没定：..."` 占位文本）。
     - `npcOverrides: NpcCard[]`（默认 `[]`）：本角色对**原作 / 工坊已有 NPC 的覆写卡面**（按 `id` 匹配，支持一键「恢复默认」）。
   - `SaveMeta.board`（`packages/core/src/schemas/save.ts`）与 `boardToMeta`（`board.ts`）同步透传 `customNpcs` 与 `npcOverrides`（同时把已绑定完整卡面的自建旧识不再生成 `"还没定：..."` 占位）。
   - `pruneAcquaintances`（`board.ts`）保留匹配 `customNpcs` / `npcOverrides` 的旧识条目。

2. **开新档结算（`packages/core/src/game.ts` `newGameWorld`）**
   - 原作/工坊 `cast` 中若有 `id` 命中 `meta.board.npcOverrides`，先用覆写卡面替换基础字段（保留 `acquaintances` 设定的开局关系与人情账本）。
   - `meta.board.customNpcs` 中凡是被选为旧识或勾选开局登场的自建 NPC，直接以完整 `NpcCard` 走 `npc.seed` 写入世界，跳过低配版占位 `board.people` 同 id 条目。

3. **本地工坊与接口（`packages/runtime` + `apps/web`）**
   - `packages/runtime/src/routes/characters.ts`：
     - `/api/characters/board` 保持轻量公开名片（不下发原作秘密/生平），并补充 `factions` 与 `locations` 列表供 NPC 编辑器下拉选择；
     - 新增按需接口 `GET /api/characters/board/npcs/:id`：仅在玩家点击「编辑人物卡」时拉取该 NPC 完整 `NpcCard`（含 `voice` / `samples` / `want` / `limit` / `bio` / `secret` / `body`）。
   - `apps/web/src/features/characters/creator.ts`：
     - 新增本地持久化库 `cp.workshop.localNpcs`（`loadLocalCustomNpcs` / `saveLocalCustomNpc` / `deleteLocalCustomNpc`），与 `localCyberware` / `localItems` / `localModules` 完全一致。

---

## 二、前端界面与交互设计

1. **统一 NPC 人物卡编辑弹窗（`apps/web/src/features/characters/CustomNpcForm.tsx`）**
   - 复用于 **新建自建 NPC**、**编辑自建 NPC** 与 **修改原作/工坊 NPC** 三种模式：
     - **基础身份**：姓名（必填）、外号、代词（他/她/TA）、身份/行当、所属势力（势力表下拉或「无」）、夜之城圈层（7 大圈层）、常驻地点（地点表下拉）、年龄/物种（可选）。
     - **外貌与口吻**：长相体貌（`look`）、开局穿着（`outfit`）、说话方式（`voice`）、示范台词（`samples`，可增删 0–5 句）。
     - **行为驱动**：诉求（`want`）、底线（`limit`）、开局近况（`initialDoing`，可选）。
     - **幕后设定（防剧透折叠区）**：生平背景（`bio`）与隐藏秘密（`secret`）——**自建 NPC 默认展开；原作/工坊 NPC 默认折叠收起并标注「含剧透 · 点击展开查看/编辑」**。
     - **随身装备与义体**：搜索勾选 `body.gear`（物品/武器/衣物）与 `body.cyberware`（义体）。
   - 填写门槛友好：除「姓名」和「身份」外，其余未手填字段在保存自建 NPC 时自动补齐自然合理的默认值，不强制填满 15 个框。

2. **捏人「人脉与旧识」页（`apps/web/src/features/characters/CreatorLife.tsx`）**
   - 顶部工具栏提供 **「＋ 自建 NPC」** 按钮（替换/升级原先只能写姓名+身份的简陋自建条，已有旧版极简自建旧识也可一键点「补全人物卡」升级）。
   - 本地自建 NPC 列表直接展示在「自建人物」分组中，跨角色可复用、可随时编辑或删除。
   - 选中**任意原作 / 工坊 / 自建 NPC** 时，右侧档案卡顶栏显示 **「编辑人物卡」** 按钮：
     - 修改原作/工坊 NPC 后，卡片与列表挂上 `已修改` 标记，并提供一键 **「恢复默认」** 按钮；
     - 修改后的姓名/外号/身份/势力/外貌立刻在列表与档案卡上实时生效。

3. **创意工坊联动（`apps/web/src/features/workshop/WorkshopPublishModal.tsx`）**
   - 「本地创作」页签新增 **「自建人物（NPC）」** 勾选区块，读取 `cp.workshop.localNpcs`，支持随义体/武器/特质一起打包成标准 `WorkshopPack`（同时支持勾选是否写入 `seedNpcs` 开局出场），一键安装、导出 JSON 或发布社区创意工坊。

---

## 三、已修改文件清单

- `packages/core/src/schemas/board.ts`
- `packages/core/src/schemas/save.ts`
- `packages/core/src/schemas/character.ts`
- `packages/core/src/game.ts`
- `packages/runtime/src/routes/characters.ts`
- `apps/web/src/api/client.ts`
- `apps/web/src/features/characters/creator.ts`
- `apps/web/src/features/characters/CustomNpcForm.tsx`（新增）
- `apps/web/src/features/characters/CreatorLife.tsx`
- `apps/web/src/features/characters/characters.module.css`
- `apps/web/src/features/workshop/WorkshopPublishModal.tsx`

## 四、验证结果（2026-11-27 全部通过）

- [x] `biome lint packages apps tools functions`（681 files，0 error / 0 warning）
- [x] 全量 6 份 `tsc --noEmit`（`core` / `content` / `runtime` / `web` / `web.node` / `tools`）
- [x] `tsx tools/check-data.ts`
- [x] `tsx` 冒烟验证：`boardStart` + `newGameWorld` 正确写入自建完整 NPC 卡面（含已设旧识 `met: true` 与未设旧识 `met: false`）与原作覆写卡面（保留人情账本），`WorkshopPackSchema` 校验通过。
