# 势力商铺诊所实装、欠款逾期与前端状态补全计划

- **状态**：已完成（2026-11-27）
- **目标**：补齐「代码联动已通但数据 0 触发」的商铺/诊所势力绑定、实装义体欠款逾期冻结赊账规则、扩充地下黑超梦（XBD）内容，并补齐前端未呈现的欠款/未装义体实物与警戒度提示。

## 一、实施项

### 1. 商店与义体诊所的真实势力归属（打破「0 触发」）

- **Schema 与结算层**：
  - `packages/core/src/systems/inventory/schema.ts`：`ShopSchema` 新增可选 `faction?: string`（门店明确归属的势力 id）。
  - `packages/core/src/systems/cyberware/schema.ts`：`RipperdocSchema` 新增可选 `faction?: string`。
  - `packages/core/src/systems/inventory/mood.ts`：`shopMood` 支持 `shop.faction` 作为兜底——优先读取活体 `keeperNpc` 的非 `"none"` 所属势力，否则采用 `shop.faction`，继续保持维克多、威尔逊、洋子、芬格斯等独立商贩中立，不按城区一刀切。
- **内容绑定（`packages/content`）**：
  - 义体诊所（`packages/content/src/merchant-sites.ts` + `npcs.ts`）：
    - `wat_nid_ripperdoc_01`（卡西乌斯·赖德）：绑定 `keeperNpc: "cassius-ryder"` + `faction: "tyger-claws"`；
    - `wbr_jpn_netrunner_02`（费恩·格斯塔特 / 芬格斯）：绑定 `keeperNpc: "fingers"`（保持独立中立）；
    - `wbr_jpn_ripperdoc_01`（尾本智代）：`faction: "tyger-claws"`；
    - `hey_spr_ripperdoc_01`（圣地亚哥·莫利纳）：`faction: "valentinos"`；
    - `std_arr_rippdoc_01`（拉斐尔·佩雷兹）、`std_rcr_ripperdoc_01`（奥克塔维奥·德尔加多）：`faction: "sixth-street"`；
    - `pac_wwd_medic_01`（洛尼·拉弗勒）：`faction: "voodoo-boys"`；
    - `bls_ina_se1_ripperdoc_01` / `bls_ina_se1_ripperdoc_01b`（哈奇·斯宾德勒）：`faction: "aldecaldos"`；
    - 狗镇 4 家黑市诊所（科斯廷、艾仑、法丽达、安东尼）：`faction: "barghest"`。
  - 商店（`packages/content/src/shops.ts` + `merchant-sites.ts`）：
    - `lizzies-bar-bd`（丽姿酒吧超梦柜台）与 `wat_kab_foodshop_02`（丽姿酒吧）：`faction: "mox"`；
    - `wat_kab_gunsmith_02`（漩涡帮弹药库）：`faction: "maelstrom"`；
    - 阿德卡多营地商铺（`bls_ina_se1_gunsmith_01`、`bls_ina_se1_gunsmith_01b`、`bls_ina_se1_medicstore_01`、`bls_ina_se1_clothingshop_01`、`ne3_aldecaldos_camp_chang`）：`faction: "aldecaldos"`；
    - 狗镇黑市/体育场商铺（`point.district === "dogtown"`）：`faction: "barghest"`。

### 2. 义体欠款逾期冻结新赊账

- `packages/core/src/systems/cyberware/quote.ts`：统计当前诊所是否存在已逾期欠款（`d.due !== null && d.due <= world.time`）；若存在逾期欠款，在 `request.credit` 走赊账结算时直接拦截并提示「在 XX 有逾期未还欠款，须先还清才能继续赊账」（现付和 `repay` 仍放行）。
- `packages/core/src/systems/cyberware/ripperdoc.ts`：`ripperdocView.debt` 新增 `overdue: boolean` 字段。
- `apps/web/src/features/story/Ripperdoc.tsx`：当 `doc.debt?.overdue` 为真时，欠款横幅标注「已逾期 · 暂停赊账」，并且禁用赊账选项（`availableCredit` 记为 `0`、清晰提示需先还清逾期欠款）。

### 3. 扩充地下黑超梦（XBD）内容与黑市货架

- `packages/content/src/braindance.ts` 新增 2 部风格迥异的地下 XBD（总数从 1 部增至 3 部）：
  - `bd-maelstrom-chrome-fever`（漩涡帮极端神经超频实录《红眼过载·全食品厂 XBD》，藏漩涡帮军用神经稳压件与走私通道线索）
  - `bd-dogtown-blackwall-leak`（狗镇流出的实验性黑墙脉冲事故原片《裂隙回声·黑市 XBD》，藏狗镇地下走私与网监封锁线索）
- `packages/content/src/chips.ts` 补齐对应的 `chipContents` 与 `shard-bd-*` 物品定义；
- `packages/content/src/shops.ts`（兰尼的黑超梦摊 `jigjig-xbd-stall`）与 `merchant-sites.ts`（狗镇黑客商店）上架新 XBD 芯片。

### 4. 补齐前端状态盲区（欠款账本、未装义体实物、警戒度强化提示）

- **义体页（`apps/web/src/features/story/NeuralPages.tsx` + `neural.module.css`）**：
  - 在神经承载栏下方/面板显眼位置增加轻量状态带：
    - 当 `view.ripperdocDebts.length > 0` 时展示「义体欠款」条（列出医生名、金额、到期时间、逾期警示）；
    - 当 `view.looseCyberware`（未安装义体实物）非空时，在扩展区底部或独立折叠区展示「未安装义体实物」清单（名称、成色、来源、存放位置、去诊所安装提示）。
- **地点 HUD（`apps/web/src/features/story/Corners.tsx`）**：
  - 为 `stealth.level > 0` 警戒标识补充清晰的悬浮说明与 `stealth.level >= 2` 警示框效；
  - 商店/诊所服务按钮若带有势力调价或拒诊状态，展示清晰标签。

## 二、验证清单

- [x] `biome lint packages apps tools functions`（680 文件，0 error / 0 warning）
- [x] 全量 6 份 `tsc --noEmit`（`core`、`content`、`runtime`、`web`、`web/tsconfig.node.json`、`tools`）
- [x] `tsx tools/check-data.ts`（物品 197、超梦录像 10 等全量校验通过）
- [x] `tsx` 冒烟验证：11/19 家势力诊所、26/122 家势力商铺开箱即生效（独立商贩保持中立）、逾期欠款冻结新赊账、3 部 XBD 与芯片/货架闭环全部通过
