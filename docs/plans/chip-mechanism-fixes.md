# 芯片机制检查与修复实施计划

> 状态：进行中（2026-11-21）
> 关联设计：[neural-systems-redesign.md](./neural-systems-redesign.md)

## 问题与修复清单

### 步骤 1：核心芯片结算、硬件门槛与跨系统联动（`packages/core`）
- [ ] **隔离查毒与破译硬件门槛修正**（`systems/shards/apply.ts`, `view.ts`, `prompt.ts`）：
  - 隔离查毒（`chip inspect`）与 `shardsView.hasReader` 仅认可隔离读写器（`chipDevice === "reader-writer"`），不再把便携超梦花环误判为沙盒查毒设备。
  - 离线破译（`chip decrypt`）统一要求完好网络接入仓（可省略 `device` 自动检测，或指定接入仓/读写器配合完好接入仓），杜绝无接入仓仅凭 350 欧元读写器单刷军用级黑冰。
- [ ] **载体级状态作用域隔离**（`systems/shards/schema.ts`, `apply.ts`, `view.ts`, `prompt.ts`）：
  - `unlocked`、`cleansed`、`inspected` 全部严格按实体载体 `carrier` 隔离，修复查毒/解密/清毒一张导致同内容所有载体串联变安全的问题。
- [ ] **神经槽一致性与行为芯片四态联动**（`systems/shards/*`, `systems/inventory/*`, `systems/cyberware/*`）：
  - `chip equip` 禁止同 `contentId` 芯片重复占用 2 个槽位；插拔 `behavior` 协议芯片自动 `emit` `cyberware.behavior` 在 `protocol` 与 `off` 间同步切换。
  - `inventory` 发生物品离身（`item lose` / `trade sell` / `inventory.place leave`）时广播 `inventory.changed` 信号，`shards` 立即清理已离身槽位，`cyberware` 同步退出由已离身外置载体驱动的 `protocol` 模式；`cyberware` 拆卸/替换或 `health` 损坏义体时广播 `cyberware.changed` 清理失效行为协议槽位；`shardsView` 投影也校验 `doll-behavior-chip` 完好性。
- [ ] **裁决拦截、单轮破译读取与提示词召回优化**（`systems/shards/apply.ts`, `prompt.ts`）：
  - `chip` 的 `read` / `inspect` / `decrypt` / `equip` / `copy` 均检查 `rulingFact === "blocked"`。
  - 优化 `carrierLines` 触发动词与芯片关键词片段匹配，解决多芯片时口语引用展开不到固定原文的问题；单轮同时请求破译并读取且具备完好接入仓时，在 `narrate` 阶段提供条件可见的密文材料，避免强制分两轮；`judge` 阶段不再展开冗长全文。
- [ ] **刻录副本命名、同款多载体区分、安全屋分类与信用芯片防刷**（`systems/inventory/*`, `systems/safehouse/view.ts`）：
  - `inventory.chipWrite` 同步更新刻录后载体名称，不再永久显示为「空白数据芯片」。
  - `names.ts` 为多张同名 `chip:` 载体追加 `#1 / #2` 区分编号。
  - `safehouse/view.ts` 正确输出芯片/超梦/设备的 `subLabel` 与 `neuralGroup`，存入住处/后备箱不再退化为「杂物」。
  - `trade.ts` 对已提空的信用芯片按空壳残值计回收价，并防止信用芯片无限刷钱。

### 步骤 2：内容目录清理、防剧透文案与图标补全（`packages/content`, `apps/web/src/features/story/art.ts`）
- [ ] 删除 0 字节残留文件 `packages/content/src/chip-library.ts`、`packages/content/src/chip-retail.ts`。
- [ ] 清理孤立旧物品 `shard`（统一改用 `blank-shard`），移除超梦头环上的错误 `chipDevice: "reader"`。
- [ ] 调整 `chip-daemon-militech-cred` / `chip-daemon-arasaka-backdoor` 的外观摘要（不剧透病毒/黑冰），调整信用芯片定价与供货清单（不自动补货无限刷钱）。
- [ ] 在 `apps/web/src/features/story/art.ts` 补全全部芯片、超梦卷轴与硬件的原作图标映射，并支持剥离 `chip:<baseId>:<seq>` 前缀与兜底图标。

### 步骤 3：前端交互与防剧透修复（`apps/web`）
- [ ] `InventoryPage.tsx`：未查毒时不剧透「未提取欧元」；仅对加密或 `daemon` 类未查毒芯片显示橙色「尚未查毒」警告；对所有未查毒芯片开放「隔离查毒/检查风险」按钮；行为协议芯片缺少完好 `doll-behavior-chip` 时给出明确提示；容器视图开放「芯片/超梦」筛选。
- [ ] `BiomonitorPanel.tsx`：基于修正后的 `hasReader` 准确展示读写器状态。

### 步骤 4：工坊清理、文档同步与静态验收（`packages/core`, `docs`）
- [ ] 清理 `packages/core/src/schemas/workshop.ts` 未使用残留变量。
- [ ] 更新 `docs/workshop-authoring.md` 中的 `chipContents` 与 `braindanceDevice` 文档和示例。
- [ ] 同步更新 `packages/core/src/neural-systems.test.ts` 以匹配载体级作用域与联动行为（遵循约定不主动运行测试）。
- [ ] 运行 `pnpm typecheck` 与 `pnpm lint` 验证类型与代码规范，收口计划状态并提交。
