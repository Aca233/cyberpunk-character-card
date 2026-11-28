# 全城 NPC 装备与着装体系更新计划

- **状态**：已完成（2026-11-27，含方案 1 + 2 + 3）
- **背景诊断**（对现有 75 位预制 NPC 审计结果）：
  - **服装严重撞衫且未覆盖新库**：全库 68 件服装中，75 位 NPC 仅用到了旧版 24 件（`combat-boots` 37 人、`cargo-pants` 32 人、`dress-shoes` 25 人、`tailored-slacks` 24 人、`street-jacket` 21 人），新增的 **44 件势力护甲/专属服饰/潜网装备/头面配件使用率为 0**；
  - **新战术工具与战地急救品使用率为 0 / 13**：特工、佣兵、黑客、医生等角色均未配备 `tactical-chest-rig`、`optical-cloak`、`thermal-monocular`、`signal-jammer`、`faraday-pouch`、`ice-breaker-spike`、`cloned-keycard`、`hemostatic-gel`、`adrenaline-shot` 等新道具；
  - **新军规高阶量产武器使用率为 0 / 12**：荒坂、军用科技、巴尔盖斯特、重装佣兵等未配发 `sor-22`、`kyubi-mod-x`、`mk31-hmg`、`defender-mil-spec`、`kenshin-spec-ops`、`shingen-tac`、`ajax-mil-spec`、`thermal-katana-mil`、`gorilla-maul` 等高阶军规武器；
  - **NPC 档案与扫描未展示着装防护词条**：`npc/body.ts` 的 `bodyView` 尚未投影 `gearEffects` / `effectTags`，义眼扫描战术提示也仅检查义体护甲，未把 NPC 所穿防弹背心/重装头盔纳入提示。

---

## 更新方案

### 1. 全城 75 位原作 NPC 装备重配（`packages/content`）

涉及文件：`packages/content/src/npcs.ts`、`packages/content/src/npcsExtra.ts`、`packages/content/src/everydayLife.ts`。

按 7 大圈层与所属势力、财力、职业与原作形象逐一更新 `body.gear`（严守每人 `≤ 12` 件上限、无重复 ID、且与 `outfit` 描写保持一致）：
- **巨企 / 政要 / 情报 / 执法（荒坂、军用科技、网监、巴尔盖斯特、NCPD、FIA）**：
  - 荒坂系（竹村、小田、三郎、华子、赖宣、重锤、安德斯等）：换装 `arasaka-stealth-suit` / `arasaka-kabuto-helm` / `arasaka-tactical-pants` / `corpo-blazer-armored` / `silk-formal-shirt` / `shingen-tac` / `senkoh-spec` / `thermal-katana-mil` / `faraday-pouch` / `optical-cloak` 等；
  - 军用科技 & 巴尔盖斯特（梅瑞狄斯、汉森、安东尼等）：换装 `militech-heavy-rig` / `tactical-chest-rig` / `militech-combat-boots` / `ajax-mil-spec` / `mk31-hmg` / `defender-mil-spec` / `hemostatic-gel`；
  - 执法 / 网监 / 政要（瑞弗、布莱斯、佩拉莱斯夫妇、迈尔斯、李德、百灵鸟等）：换装 `ncpd-tactical-vest` / `ncpd-riot-helmet` / `netrunner-cooling-crown` / `netrunner-thermal-suit` / `signal-jammer` / `cloned-keycard` / `ice-breaker-spike` / `kenshin-spec-ops` / `overture-heavy`。
- **来生佣兵 & 城区中间人（V、杰克、罗格、克莱尔、韦兰、埃默里克、T-Bug、瑞吉娜、和歌子、神父、迪诺、达科塔、老船长、汉兹、德克斯、蓝眼先生等）**：
  - 战斗佣兵按专长换装高辨识度外套/防弹内衬/靴子与战术道具（`hemostatic-gel`、`adrenaline-shot`、`tactical-chest-rig`、`thermal-monocular`、`kyubi-mod-x`、`sor-22`、`crusher`）；
  - 黑客/技术角色（T-Bug、朱迪、妮克斯、8ug8ear、百灵鸟等）配齐 `netrunner-cooling-crown` / `netrunner-visorglass` / `netrunner-thermal-suit` / `relay-beacon` / `ice-breaker-spike` / `faraday-pouch`；
  - 中间人与高定名流（罗格、汉兹、蓝眼先生、和歌子、迪诺、克里、丽姿、佩拉莱斯等）换装 `fixer-fedora` / `gold-rimmed-shades` / `embroidered-kimono-jacket` / `luxury-trench` / `designer-loafers` 等高定单品，不再与街头混混撞衫。
- **恶土流浪者（帕南、索尔、米契、蝎子、卡西迪、达科塔等）**：
  - 全面启用 `aldecaldo-riding-jacket` / `nomad-headwrap` / `nomad-welding-cap` / `dust-goggles` / `reinforced-moto-pants` / `steel-toe-boots` / `thermal-monocular` / `mag-grapple-kit` / `hemostatic-gel` / `sor-22`。
- **夜之城帮派与地下场子（莫克斯、虎爪、瓦伦蒂诺、漩涡、巫毒、动物、六街、云顶）**：
  - 按帮派精确配装：`mox-bomber`、`tyger-claw-jacket`、`valentino-vest`、`maelstrom-spiked-jacket`、`voodoo-trench`、`sixth-street-field-jacket`、`gorilla-maul`、`crusher`、`cyber-visor`、`gas-respirator` 等，消除跨帮派穿同一件基础夹克的违和感。
- **义体医生、店主与日常市民（老维、米丝蒂、威尔逊、佩佩、杰姬/威尔斯太太、指头哥、查尔斯、赖德、洋子、切丽等）**：
  - 按行当匹配 `med-kit`、`hemostatic-gel`、`tool-kit`、`trauma-paramedic-vest`、`work-apron` / `techie-goggles` / `cyber-shades` / `club-heels` 等贴合身份的单品。

### 2. NPC 装备效果与护甲展示联动（`packages/core` + `apps/web`，可选一并做）

- **`packages/core/src/systems/npc/body.ts`**：
  - 为 `bodyView.gear[]` 补齐 `effectTags`（复用 `itemEffectTags`），并在 `NpcBodyView` 上新增 `armorSummary` / `gearBadges`（复用 `summarizeGearEffects`）；
  - 让 `scanTacticalProfile` 同时识别 NPC 所穿的防弹/重型护甲（如穿着 `militech-heavy-rig` / `arasaka-kabuto-helm` 时给出对应破甲战术提示）。
- **`apps/web/src/features/story/PeopleBody` & `InventoryPage.tsx`（同伴视图）**：
  - 在人物档案与物品栏同伴页展示该 NPC 当前着装生效的护甲/效果胶囊，并与交接装备实时同步。

### 3. （可选）同步刷新 20 套开局出身行装（`packages/content/src/loadouts.ts`）

- 视需要决定是否顺带把玩家捏人 20 套开局出身行装同步用上新服装与战术道具（默认先聚焦 NPC，避免无意改动玩家开局平衡）。

---

## 验收标准

- `biome lint packages apps tools functions` 0 错误 / 0 警告；
- 6 份 `tsc --noEmit` 全绿；
- `tsx tools/check-data.ts` 通过（所有 75 位 NPC 的 `body.gear` 全部为有效物品 ID、无重复、不超 12 件上限）；
- 抽查统计确认 68 件服装、13 件新战术道具与 12 把新军规武器在 NPC 群体中均有合理分布。
