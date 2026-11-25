# 自创内容可修改改造计划

> 状态：已完成

## 目标

让玩家在游戏内创建的全部自创内容都能直接修改、即时生效，不再只能“删除重来”或“导出手工改完再卸载重装”：
1. **创角工作台本地自创模块**（自定义出身 / 自创履历 / 自创特质 / 自创缺陷）支持直接编辑名称、能力/负面影响说明、标签，也支持重新走 AI 解析并保留原 ID 原地更新；同时修复自定义旧识姓名输入框无法清空重写的问题。
2. **创意工坊内容包**支持直接在线新建与编辑（基础信息表单 + 条目删减 + 完整 JSON 源码编辑 + 实时引用校验 + 原地保存），同时修复同 ID 覆盖导入被服务端拦截的问题。

## 分阶段任务

- [x] **阶段一：创角工作台自创模块与旧识可编辑**
  - `apps/web/src/features/characters/creator.ts`：`saveLocalCustomModule` 改为同 ID 原地更新以保持顺序。
  - `apps/web/src/features/characters/CustomModuleForm.tsx`：支持 `initial?: BoardModule` 编辑模式，可修改模块名、能力/负面影响说明、标签，或重新 AI 解析时保留原 `id`。
  - `apps/web/src/features/characters/CreatorSteps.tsx` & `characters.module.css`：在 `OriginPicker`、`PastPicker`、`TraitPicker`、`FlawPicker` 中，将本地自创模块卡片改造为自带集成底栏（`编辑` · `删除`），即使槽位已满也可随时编辑；保存后若已装配则同步刷新当前角色 `board`。
  - `apps/web/src/features/characters/CreatorLife.tsx`：修复自定义旧识姓名输入框不能清空重写的问题。
- [x] **阶段二：运行时与 API 支持内容包原地更新与覆盖校验**
  - `packages/runtime/src/workshop.ts`：新增 `WorkshopStore.replace(id, pack, now)`，原地更新内容包并保留启用状态。
  - `packages/runtime/src/routes/workshop.ts`：`POST /validate` 支持 `?replaceId=<id>` 跳过自身 ID 冲突；新增 `PUT /:id` 原地更新；`POST /` 支持 `?overwrite=1` 覆盖更新。
  - `apps/web/src/api/client.ts`：补全 `updateWorkshopPack` 与带 `replaceId`/`overwrite` 的 `validateWorkshopPack`/`installWorkshopPack`。
- [x] **阶段三：创意工坊界面新增在线编辑器**
  - `apps/web/src/features/workshop/WorkshopScreen.tsx` & `workshop.module.css`：新增「新建内容包」与已安装包「编辑」入口，提供基础信息表单、条目快捷移除、JSON 源码编辑器、一键格式化/校验/保存修改，以及将本地自创模块直接载入编辑。
- [x] **阶段四：全仓静态校验与数据检查**
  - 通过 `biome lint .`（0 error / 0 warning）、5 包 `tsc --noEmit` 与 `tsx tools/check-data.ts`。
