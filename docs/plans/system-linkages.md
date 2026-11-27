# 系统间机械联动补全计划

- **状态**：已完成（2026-11-26）
- **目标**：打通全仓库剩余 4 处孤立/断联的跨系统硬规则，使义体诊所、战斗伤亡、潜行警戒、电子战入侵与黑超梦体验与势力、人性系统形成闭环因果，不新增空转数值，不凭空刷事件。

## 一、四处跨系统联动设计

### 1. `cyberware`（义体诊所）↔ `factions`（势力态度、成员身份与火拼争夺区）

- **现状**：普通商店已通过 `inventory/mood.ts` 实现 `shopMood`（`kos` 拒售、`hostile` ×1.3、`friendly` ×0.9、`family` ×0.8、`member` ×0.75、火拼城区 `contested` ×1.15），但义体诊所 `quoteCyberware` 只读 `doc.priceFactor`，完全无视医生所属势力与城区火拼态势。
- **改动**：
  - 放宽 `packages/core/src/systems/inventory/mood.ts` 中 `shopMood` 的入参类型为 `{ location: string; keeperNpc?: string | undefined }`，供义体诊所复用同一套价格/立场规则，避免重复实现。
  - `packages/core/src/systems/cyberware/index.ts` 增加 `"factions"` 依赖（`factions -> npc -> world`，无循环依赖）；`service.ts` 的 `serviceWorld` 透传 `factions: ctx.read("factions")`。
  - `packages/core/src/systems/cyberware/quote.ts` 在 `quoteCyberware` 中计算诊所 `mood`：
    - `repay`（还清欠款）仍放行；
    - `install` / `buy` / `remove` / `repair` 在 `mood.factor === null`（`kos`）时直接拒诊并给出明确原因；
    - 将 `mood.factor` 乘入 `fullPrice`（含连带的 `servicePrice`）与 `repairCost`，使前端报价预览、预约与实际成交完全一致。
  - `packages/core/src/systems/cyberware/ripperdoc.ts` 暴露 `mood` 字段（含中文标签 `label`）并按系数同步货架展示价；`apps/web/src/features/story/Ripperdoc.tsx` 在诊所头部信息栏展示势力折扣/涨价/火拼涨价/拒诊提示。

### 2. `combat`（帮派伤亡）↔ `factions`（帮规污点与势力态度恶化）

- **现状**：`combat` 虽为敌方登记 `gang` 与 `npc`，但敌人死亡时只发 `npcDeath`，不会触发势力态度变动或本帮帮规追责。
- **改动**：
  - `packages/core/src/systems/combat/index.ts` 增加 `"factions"` 依赖。
  - `packages/core/src/systems/combat/apply.ts` 在 `setFoe(..., state: "dead")` 时，按 `cards[foe.npc]?.faction` 与 `foe.gang`（兼容势力 `id` 与中文 `name`）解析所属势力：
    - 若玩家正是该势力正式成员（`membership.faction === faction.id`），自动发出 `{ type: "faction", action: "strike", ... }` 记一笔帮规污点（满 3 笔按既有规则自动除名清理门户）；
    - 若非本帮成员：当前为 `family` / `friendly` / `neutral` 时自动降一档（`family -> friendly -> neutral -> hostile`）；若当前已为 `hostile` 且死者为 `boss` / `legend` 档头目，则进一步恶化为 `kos`。实时读取当前态度，确保同轮连杀不会发重导致事务失败。
  - 同步补充 `packages/core/src/systems/combat/prompt.ts` 说明，避免叙事模型重复发出同一笔势力变动。

### 3. `stealth`（地点警戒 0–3）↔ `combat` & `hacking`

- **现状**：开打（`combat start`）不会把现场警戒拉到 `3（交战）`，电子战入侵协议（`breach` 拿下 `alarms` / `cameras`）或「记忆擦除」也不会降低现场警戒度。
- **改动**：
  - `combat` 与 `hacking` 均增加 `"stealth"` 依赖（`stealth -> world`，无循环依赖）。
  - `packages/core/src/systems/combat/apply.ts` 在 `startCombat` 时读取当前地点警戒，若低于 `ALERT_MAX (3)`，自动发出 `alert` 指令拉满至交战档（`delta = ALERT_MAX - level`）。
  - `packages/core/src/systems/hacking/apply.ts`：
    - `applyBreach` 拿下 `alarms` 或 `cameras` 且当前未处于交火状态、现场警戒处于 `1–2` 档（起疑/搜索）时，自动发出 `alert` 指令降 1 档；
    - `applyHack` 使用 `memory-wipe`（记忆擦除）且未交火、现场警戒为 `1`（起疑）时，自动发出 `alert` 指令降 1 档。

### 4. `braindance`（地下黑超梦 XBD）↔ `humanity`（神经症状与免疫压制剂）

- **现状**：观看无滤波地下黑超梦（`tier === "xbd"`）只在 `notes` 中写了一句纯文本提醒，不会在 `humanity` 系统产生实际症状，也不检查免疫压制剂。
- **改动**：
  - `packages/core/src/systems/braindance/index.ts` 增加 `"humanity"` 依赖（`humanity` 零依赖，无循环）。
  - `packages/core/src/systems/braindance/apply.ts` 在 `play` 接入或切换至 `immerse`（沉浸）模式观看 `tier === "xbd"` 作品时：
    - 首次进入本次体验的沉浸模式（按 `event: "bd:xbd:" + experienceId` 去重，防暂停续播重复触发）：
      - 若玩家处于免疫压制剂有效期（`isImmunosuppressed`），药效缓冲住神经失控，记录压制缓冲提示；
      - 否则读取当前 `neuralStage`，自动向 `humanity` 发出 `affect` 指令使神经症状升一级（`stable -> detached -> unstable -> edge -> crisis`），落盘可感知、可治疗/恢复的真实症状；
    - 若采用 `edit`（编辑分析）模式观看 XBD，则明确记录已切断直接感官回灌、规避神经过载（赋予专业编辑头环真实机制价值）。

## 二、验证清单

- [x] `biome lint packages apps tools functions`（680 文件，0 error / 0 warning）
- [x] 全量 6 份 `tsc --noEmit`（`core`、`content`、`runtime`、`web`、`web/tsconfig.node.json`、`tools`）
- [x] `tsx tools/check-data.ts`
- [x] `tsx` 端到端冒烟验证：4 条跨系统联动全部实测通过（注册表无循环依赖）
