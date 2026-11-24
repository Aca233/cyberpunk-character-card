# 预制 NPC 原作还原与非原作自创角色清理计划

## 问题背景

全库 77 名预制 NPC 中混入了 7 名 `canon: false` 的本作自创角色（阿岚、千绘、莉娜、雷欧、灰舌、阿涛、针眼），不仅进入局内世界人物池，还直接出现在捏人「人际旧识」预制人物选择器里；同时部分原作 NPC 存在智能武器缺 `smart-link`、维克多描述有义眼但未装眼部义体、全息 AI 德拉曼带实体西装/手机等还原度瑕疵。

## 实施方案

- [x] **阶段一：将 7 名非原作自创 NPC 彻底还原为《赛博朋克 2077》原作人物或移除**
  - `sleeve-shop-keeper`（阿岚）→ **`yoko-tsuru`（洋子·鹤 / Yoko Tsuru）**：歌舞伎市场环状商业街著名黑客与芯片小铺店主（T-Bug 同行，支线「礼物」店主），`canon: true`。
  - `needle`（针眼）→ **`charles-bucks`（查尔斯·巴克斯 / Charles Bucks）**：歌舞伎市场地下诊所黑心义体医生（暗中与清道夫勾结拆活人义体、8 折黑市价完全契合原作），`canon: true`，并从解包库 `common/avatars_tooltips` 补齐原作官方头像 `ripper_kabuki3`。
  - `jigjig-xbd-dealer`（灰舌）→ **`lenny-nero`（兰尼·尼罗 / Lenny Nero）**：扭扭街暗巷黑超梦（XBD）贩子（主线「祸不单行」原配角色），`canon: true`。
  - `clouds-receptionist`（千绘）→ **`cheri-nowlin`（切丽·诺林 / Cheri Nowlin）**：超级摩天楼 H8 云顶俱乐部前台接待员（紫红短发、存枪与算法匹配），`canon: true`。
  - `atao`（阿涛）→ **彻底移除自创 NPC**；`kabuki-arms` 保留为普通无名「歌舞伎黑市武器摊」（`keeper: "歌舞伎黑市摊主"`，不挂自创 `keeperNpc`）。
  - `jigjig-joytoy-f`（莉娜）与 `jigjig-joytoy-m`（雷欧）→ **彻底移除两位自创具名 NPC**；`everydayLife.ts` 中 `jig-jig-street-night` 仅挂原作人物 `["lenny-nero", "fingers"]`，保留扭扭街清醒街头性偶（无名）的原作服务参考说明。
- [x] **阶段二：同步更新商店、义体医生、芯片、关系网、头像与提示文案**
  - 更新 `packages/content/src/everydayLife.ts`、`npcsExtra.ts`、`npcs.ts`、`npcTies.ts`、`shops.ts`、`ripperdocs.ts`、`merchant-sites.ts`、`chips.ts`；在 `merchant-sites.ts` 的 `KNOWN_POIS` 将 `wat_kab_netrunner_01`（边缘网络）合并到 `sleeve-corner`、`wat_kab_ripperdoc_02`（查尔斯·巴克斯）合并到 `charles-bucks`，消除地图图钉与歌舞伎市场主地点重复店铺。
  - 更新 `packages/core/src/systems/inventory/gunsmith.ts`、`index.ts`、`trade.ts` 与 `apps/web/src/features/story/NeuralPages.tsx` 中残留的自创人名文案。
  - 排查 `C:\Cyberpunk 2077\_unpack` 全部头像图集：新增查尔斯·巴克斯原作官方头像 `portrait.charlesBucks`（`ripper_kabuki3`），并顺手修复 `portrait.coachFred`（弗雷德教练）此前错绑成盆景图 `coach` 的 bug，改绑为原作拳击教练头像 `fred`（官方头像增至 57 位）。
- [x] **阶段三：修正原作 NPC 配装还原瑕疵**
  - 为带智能武器的原作角色补齐 `smart-link`：`takemura`、`judy`、`reed`、`oda`（替换 `grounding-plating` 保持 8/8）、`smasher`（替换 `pain-editor` 保持 8/8）。
  - 为 `viktor`（维克多）补齐 `kiroshi-mk2` 义眼；清空 `delamain`（德拉曼）的实体 `gear: []`；为 `wakako`、`hanako`、`saburo` 补齐下装 `tailored-slacks`。
- [x] **阶段四：全量静态与数据校验**
  - `tsx tools/assets/pick.ts --tier demo --only ui` 与 `tsx tools/assets/check.ts` 通过（UI 752 张）。
  - `biome lint .`（693 文件 0 报错）、`tsc --noEmit`（5 包全过）、`tsx tools/check-data.ts` 通过：全库 **74 名预制 NPC 100% 为 `canon: true` 原作角色**，0 自创残留，0 智能武器缺联锁告警。
