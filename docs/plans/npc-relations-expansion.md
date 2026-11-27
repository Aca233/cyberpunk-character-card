# 角色关系类型扩展与局内档案关系编辑方案

- **状态**：已完成（2026-11-28）
- **背景**：当前创角旧识仅内置 6 种关系（点头之交、老朋友、他欠你人情、你欠他人情、前任、旧仇），缺少血亲/家人、恋人、搭档、师徒、上下级、竞争对手及自定义称谓；导致玩家自建母亲等亲属或特殊关系 NPC 时只能留空，进局后人物档案显示「还说不上什么关系。」，且已有存档内也无法手动修正。

---

## 一、核心数据结构与指令（`@cp/core`）

1. **扩展创角关系类型（`packages/core/src/schemas/board.ts`）**：
   - 将 `RELATIONS` 从 6 种扩展至 14 种：`family`（血亲 / 家人）、`lover`（恋人 / 伴侣）、`partner`（搭档 / 战友）、`mentor`（恩师 / 前辈）、`boss`（上司 / 雇主）、`subordinate`（下属 / 后辈）、`friend`（老朋友）、`nod`（点头之交）、`owesYou`（他欠你人情）、`youOwe`（你欠他人情）、`ex`（前任）、`rival`（对手 / 竞争者）、`grudge`（旧仇）、`custom`（自定义关系）。
   - `AcquaintanceSchema` 新增可选字段 `customLabel`（最多 16 字），支持为任意关系（尤其是血亲/家人与自定义关系）填写具体称谓（如「母亲」「生父」「监护人」「金主」等）。
   - 导出统一读取工具 `acquaintanceRelationLabel(a)`，在 `acquaintanceSeed`、`boardSummary`、`prose.ts` 与前端展示全链路使用。
2. **局内修改关系操作（`packages/core/src/systems/npc/actions.ts`、`packages/core/src/actions.ts`）**：
   - 新增确定性玩家操作 `setNpcRelation`（`{ type: "setNpcRelation", id, text }`，0 模型调用、复用现有 `relation` 指令写入回合日志并实时同步给叙事 AI）。

---

## 二、前端界面（`apps/web`）

1. **创角人脉选择器（`CreatorLife.tsx`、`CharacterCreator.tsx`）**：
   - 展示全部 14 种关系卡片与专属快捷交集模板；
   - 新增「具体关系称谓」输入框与快捷称谓词条（血亲提供母亲/父亲/姐姐/哥哥/妹妹/弟弟/养母/养父等，自定义提供监护人/金主/线人/主治医生等）。
2. **局内人物档案（`Profile.tsx`、`PeoplePanel.tsx`、`Corners.tsx`、`StoryScreen.tsx`）**：
   - 在 `RELATION // 关系与背景档案` 卡片内为已结识 NPC 提供「补充关系 / 修改关系」内联编辑器，支持一键点选常用关系前缀并保存，直接修复已有存档中的「还说不上什么关系。」问题并立即进入下一轮 AI 上下文。
