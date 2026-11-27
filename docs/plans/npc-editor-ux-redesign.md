# 自建与修改 NPC 交互体验重构计划

- **状态**：已完成（2026-11-27）
- **背景**：首版 `CustomNpcForm` 采用居中 `<Dialog>` 弹窗一次性平铺 5 个分区 / 16 个输入框，导致：
  1. 字段过多过长、滚屏压迫感重；
  2. 缺少类似「自建模块」的 AI 一句话生成 / 补全能力；
  3. 弹窗黑幕套内滚动条，与工作台其余内联自建表单（`CustomItemForm` / `CustomModuleForm` / `CustomCyberwareForm`）割裂；
  4. 多行 `textarea` 误用了单行 `.compactBox` 样式，且原生小下拉框与双列装备区排版局促。

---

## 一、核心重构方案

### 1. 取消黑幕弹窗 → 改为右侧档案卡内联编辑
- 点击顶部 **「＋ 自建 NPC」** 或右侧详情卡的 **「编辑 / 修改人物卡」** 时，**直接在右侧详情卡原地切换为内联编辑面板**（不再弹出 `<Dialog>` 蒙层遮挡左侧人物列表）。
- 顶部显示清晰模式栏（新建自建 NPC / 编辑自建 NPC / 修改原作人物卡）与返回按钮；保存后立即切回该人物的详情与关系选择视图，可顺手直接勾选初始关系。
- 处于编辑态时，`.people` 双栏网格自动给右侧编辑卡分配更充裕宽度（如 `minmax(0, 1fr) minmax(24rem, 1.25fr)`），单屏舒展不局促。

### 2. 新增「AI 一句话生成 / 补全 NPC」
- **核心提示词与解析器（`packages/core`）**：
  - 新增 `interpretNpc(llm, input, id, signal)`（沿用 `interpretModule` 的辅助模型 `aux` 调用链路与容错机制）；
  - 输入一句自然语言描述（可附带当前已填字段用于局部润色/修改），返回经 `NpcCardSchema` 校验的完整人物卡（自动匹配合法势力 id、地点 id 与 7 大圈层）；
  - 修改原作 NPC 且未展开剧透区时，AI 润色请求不下发/不覆写原作 `bio` 与 `secret`。
- **运行时路由与前端接口（`packages/runtime` & `apps/web`）**：
  - 新增 `POST /api/characters/interpret-npc` 与 `api.interpretNpc(...)`。
- **内联 AI 快捷区**：
  - 位于编辑面板顶部（新建默认展开、编辑可按需点击展开），提供一句话输入框 + 3 个赛博快捷灵感例句；点击 **「AI 生成人物卡」** 自动填好全部字段，也可完全跳过直接手填。

### 3. 极简必填 + 4 个轻分页签（告别超长滚动）
- **顶部常驻必填区**（只需填这 2 项即可直接保存）：
  - `人物姓名` + `外号（选填）`
  - `身份 / 行当`
- **下方 4 个轻分页签**（按需点击切换，每页控制在半屏内无需长滚）：
  1. **基础归属**：代词（他/她/TA）与类型（人类/合成人/机器人）改用赛博胶囊点选按钮组 + 年龄 + 所属势力 / 夜之城圈层 / 常驻地点。
  2. **外貌与口吻**：长相与外露义体、开局穿着、说话方式、示范台词（多行框统一改用 `.inputBox` 舒展排版）。
  3. **性格与幕后**：当下诉求、不可跨越的底线、开局近况 + **生平背景与隐藏秘密（原作/工坊 NPC 依然默认折叠防剧透，不展开原样保留）**。
  4. **装备与义体**：内部改为「随身装备 / 义体」二级切换（不再左右强行挤成两列），已选件置顶可一键叉掉，下方搜索点选清晰可读。

### 4. 视觉与排版打磨
- `textarea` 统一使用 `.inputBox`（带舒适内边距、清晰行高与自动缩放），修正 `.compactBox` 仅用于单行输入的问题。
- 统一深色控件风格与聚焦态高亮，底部固定「保存人物卡 / 取消 / 恢复默认或删除」操作条。

---

## 二、拟改动文件清单（待用户确认后动工）

- `packages/core/src/narrator/interpretNpc.ts`（新增：AI 一句话生成/补全 NPC）
- `packages/core/src/narrator/index.ts` & `packages/core/src/index.ts`（导出 `interpretNpc`）
- `packages/runtime/src/routes/characters.ts`（新增 `POST /api/characters/interpret-npc`）
- `apps/web/src/api/client.ts`（新增 `api.interpretNpc`）
- `apps/web/src/features/characters/CustomNpcForm.tsx`（重构为内联分页签 + AI 生成面板）
- `apps/web/src/features/characters/CreatorLife.tsx`（接入右侧原地内联编辑态，移除弹窗模式）
- `apps/web/src/features/characters/characters.module.css`（优化内联编辑宽栏比例、分页签、胶囊点选、输入框与装备选择器样式）

## 三、验证计划

- `biome lint packages apps tools functions`（0 error / 0 warning）
- 全量 6 份 `tsc --noEmit`
- `tsx tools/check-data.ts`
