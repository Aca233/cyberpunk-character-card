# 装备深度与穿搭体验全面升级计划

- **状态**：已完成（2026-11-27）
- **覆盖需求（共 6 项）**：
  1. 物品栏「服装」视图顶部 6 格可视化穿搭栏（头 / 面 / 外套 / 内衣 / 腿部 / 鞋子）；
  2. 一键套装 / 穿搭方案（`Outfit Presets`，持久化在存档内，脱战原子整套换装）；
  3. 生物检测躯体图（`P` 面板 `BiomonitorPanel`）叠加当前护甲防护摘要（头 / 躯干 / 四肢）；
  4. 武器改装件大幅扩充（13 → ~30 件，补齐步枪/狙击消音器与紫/橙军规配件）+ 全城正规武器店开放枪匠工坊；
  5. 补齐普通量产武器高阶（史诗紫装）与精准步枪 / 轻机枪断层；
  6. 非战斗工具/医疗消耗品快捷操作 + 同行同伴护甲防护进入战斗摘要与裁决。

---

## 一、核心层改造（`packages/core`）

### 1. 一键穿搭方案（`inventory`）

- **`inventory/schema.ts`**：
  - 新增 `OutfitPresetSchema`（`id`, `name`, `slots: Partial<Record<ClothingSlot, string>>`），在 `InventoryStateSchema` 新增 `outfits: z.array(OutfitPresetSchema).max(4).default([])`；
  - 新增内部/公开命令或操作：通过 `outfit` 指令（`save` / `apply` / `delete`）管理穿搭方案，写入存档日志确保读档与 JSON 导入/导出一致。
- **`inventory/actions.ts` + `actions.ts` + `ui-actions.ts`**：
  - 新增零模型操作 `outfitPreset`（`save` 保存当前 6 格穿着为方案、`apply` 脱战原子切换整套穿着：把背包中对应衣物逐格穿上，目标槽位为空则脱下当前衣物，若某件衣物不在随身则保留提示不中断其余部位、`delete` 删除方案）。
- **`inventory/view.ts`**：将 `inventory.outfits` 投影给前端（附每套方案各槽位衣物名及当前随身可用状态）。

### 2. 非战斗医疗/稳伤快捷操作（`inventory`）

- **`inventory/actions.ts`**：扩展或新增 `useMedicalSupply`（复用现有 `useHealing` 或支持 `med-kit` / `hemostatic-gel` 非战斗直接止血稳伤：`hemostatic-gel` 消耗 1 份、`med-kit` 保留工具不消耗，脱战且有未处理伤势时直接压制出血/缓解疼痛并写进状态记录）；
- 其他情境性消耗品与渗透工具（`adrenaline-shot`、`health-booster`、`signal-jammer`、`thermal-monocular`、`optical-cloak`、`glass-cutter`、`mag-grapple-kit`、`ice-breaker-spike`、`cloned-keycard`、`relay-beacon`）在物品栏详情底栏提供语义化的「准备使用」快捷填词按钮，一键带入行动输入框。

### 3. 同行同伴护甲与防护联动（`npc` + `combat`）

- **`combat/view.ts` & `combat/status.ts`**：
  - 对每个 `following && alive` 同伴，用 `summarizeGearEffects`（按其 `body.gear` 中实际穿着的衣物）汇总其 `armorSummary`（如 `躯干防弹护甲`、`头部重型装甲`、`滤毒防尘`）；
  - 投影进 `combatView.active.allies[].armorSummary`，并在 `combat/status.ts` 的「我方同行参战」行中与 `gearSummary` 并列输出，让玩家转交给同伴的防弹背心/头盔在战斗裁决里真正起作用。

---

## 二、内容与商店扩充（`packages/content` + 官方专图）

### 1. 武器改装件扩充（13 → ~30 件，一物一图）

- **枪口（+5，共 7）**：
  - 突击步枪/精准步枪消音器（`cetus-silencer` 鲸鱼消音器，稀有）；
  - 狙击步枪重型消音器（`xc10-sniper-silencer` 军规长消音器，史诗）；
  - 通用防跳枪口补偿器（`rc7-compensator` 精良、`rc7-strigoi-brake` 军规制退器 稀有、`militech-heavy-brake` 重型防暴制退器 史诗，提升连发稳定与破甲控制）。
- **瞄具（+4，共 7）**：
  - `add-vantage-scope` 广角全息近战镜（精良）；
  - `handyman-thermal-scope` 热成像战术瞄具（史诗，穿烟/夜战锁热源）；
  - `smart-assist-optic` 智能联锁战术镜（稀有，缩短智能锁定延迟）；
  - `arasaka-weakpoint-scope` 荒坂弱点高亮狙击镜（传说，标注护甲接缝与义体弱点）。
- **插件（+8，共 16）**：
  - `ap-core-mod` 钨芯穿甲弹匣（稀有，远程全系破重甲）；
  - `pyro-rounds-mod` 铝热燃烧弹头插件（稀有，命中引燃）；
  - `emp-rounds-mod` 电磁干扰弹头插件（史诗，压制义体与无人机）；
  - `quick-reload-grip` 快拔战术握把（精良，缩短换弹与切枪空当）；
  - `thermal-edge-mod` 热能高频刃模块（史诗，近战刀剑破甲灼烧）；
  - `toxin-coat-mod` 神经毒素涂刃槽（稀有，刀剑持续毒伤）；
  - `swiss-cheese-mod` 军规全穿透枪管插件（传说，技术武器穿厚掩体）；
  - `zero-recoil-stabilizer` 陀螺稳枪阻尼插件（传说，大幅压制重枪后坐）。

### 2. 补齐高阶军规量产武器（+12 把，重点补齐史诗紫装、精准步枪与轻机枪）

- 新增 12 把非不朽可购买的高阶量产武器（覆盖史诗 9 把 + 稀有 3 把，补足全武器类别中后期过渡）：
  - **精准步枪（+2）**：`sor-22`（SOR-22 军规精准步枪，稀有）、`kyubi-mod-x`（海啸九尾特勤定制型，史诗）；
  - **轻机枪（+2）**：`mk31-hmg`（军用科技 Mk.31 便携重机枪，史诗）、`defender-mil-spec`（M2067 防御者军规重管型，史诗）；
  - **手枪/左轮（+2）**：`kenshin-spec-ops`（谦信荒坂特勤穿甲型，史诗）、`overture-heavy`（马洛里安重管竞赛左轮，史诗）；
  - **冲锋枪（+2）**：`shingen-tac`（荒坂信玄特勤压制型，史诗）、`senkoh-spec`（海啸线香军规高能型，史诗）；
  - **突击步枪（+1）**：`ajax-mil-spec`（军用科技阿贾克斯重装突击型，史诗）；
  - **霰弹枪（+1）**：`crusher`（碾碎者半自动弹匣霰弹枪，史诗）；
  - **近战刀剑/钝器（+2）**：`thermal-katana-mil`（荒坂军规热能武士刀，史诗）、`gorilla-maul`（重型液压破城锤，史诗）。

### 3. 全城枪匠工坊开放 & 商店分流（`packages/content/src/shops.ts` + `merchant-sites.ts`）

- 在 `merchant-sites.ts` 中为所有 `point.kind === "gun"` 的正规武器店开启 `gunsmith: true`（让全城各区武器店都支持工坊拆装锁槽与智能改造，不再只有威尔逊和歌舞伎摊能改枪）；
- 将新增的 17 个改装件与 12 把高阶军规武器按城区阶层分流到各区武器店、黑市与狗镇军火铺；
- 从本机 `C:\Cyberpunk 2077\_unpack` 为所有新增改装件与武器挑选独立官方图标加入 `tools/assets/manifest.json`，重跑 `pick.ts` 与 `check.ts`。

---

## 三、前端交互升级（`apps/web/src/features/story/`）

### 1. 物品栏「服装」6 格可视化穿搭栏 + 一键穿搭方案（`InventoryPage.tsx` + `inventory.module.css`）

- 当处于「随身」视图（尤其切到「服装」筛选或随时可见的紧凑收起/展开条，切到「服装」时自动展开）：
  - 顶部渲染 **6 格切角穿搭槽位（头部 / 面部 / 外套 / 内衣 / 腿部 / 鞋子）**：
    - 已穿槽位展示衣物官图、名称、稀有度色边与悬停一键「脱下」按钮；
    - 空槽位显示部位占位提示，点击槽位直接筛选该部位背包可穿衣物，再次点击取消部位筛选；
  - 紧邻 6 格栏下方提供 **穿搭方案条（最多 4 套）**：一键「存为方案」、点方案名一键整套换装、支持删除；战斗中自动置灰提示。

### 2. 生物检测躯体图叠加护甲防护摘要（`BiomonitorPanel.tsx` + `biomonitor.module.css`）

- 在 `VITAL-MAP // 躯体扫描与创伤档案` 卡片内读取 `inventory.gearEffects.protection` 与 `inventory.clothing`：
  - 在躯体剪影下方或右侧生理指标区展示 **3 部位护甲防护条（头部 / 躯干 / 四肢）**：清晰标明 `无护甲` / `轻型防护` / `防弹护甲` / `重型装甲` 及对应衣物名称，并在全息躯体图对应区域以青/金色细框高亮已覆盖护甲的部位。

### 3. 消耗品与工具快捷操作按钮（`InventoryPage.tsx`）

- 对 `hemostatic-gel` / `med-kit` 在非战斗受伤时提供直接「使用止血/包扎」按钮；
- 对所有功能工具与战术消耗品（`signal-jammer`、`thermal-monocular`、`optical-cloak`、`glass-cutter`、`mag-grapple-kit`、`ice-breaker-spike`、`cloned-keycard`、`adrenaline-shot`、`health-booster` 等）在详情底栏提供场景化的「准备使用」按钮，一键填入行动栏。

---

## 验收计划

- `tsx tools/assets/pick.ts --only ui` & `tsx tools/assets/check.ts` 资产全部通过；
- `biome lint packages apps tools functions` 0 错误 0 警告；
- 6 个 `tsc --noEmit` 全部通过；
- `tsx tools/check-data.ts` 全部通过；
- `tsx` 端到端冒烟验证：穿搭方案保存/一键整套切换/删除、新改装件装卸（含步枪消音与穿甲插件）、全城武器店枪匠报价、同伴防弹甲投影进 `combatView` 与 `combatStatus`、止血凝露/急救包非战斗使用全部通过。
