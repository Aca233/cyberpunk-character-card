# 在场人物卡片展开态优化与视觉美化计划

> 状态：已完成（2026-11-23）
> 目标：全面升级在场人物卡片展开态（`PresentPerson` 展开壳层与 `Profile.tsx` / `profile.module.css`）的赛博朋克 2077 Kiroshi 光学档案质感、信息层次、电子战联动与滚动交互体验，使其与已升级的生物监测、接入仓及追踪面板保持统一的原生视觉高水准。

## 1. 现状诊断

1. **顶栏随内容滚走 & 关闭按钮色块喧宾夺主**：
   - `.person .growBody` 将顶栏（分栏页签 + 在场目标快切条 + 关闭按钮）、身份横幅与下方详情一起放入同一滚动容器，长内容向下滚动时顶栏滚出视野，无法随时切人或收起。
   - `.personHeadBtn[data-active]` 在展开时恒为亮黄色实心块，视觉权重压过人物姓名与关键交互按钮。
2. **`ProfileBanner` 嵌入态过于单薄**：
   - `embedded` 模式下移除了所有底板、网格肌理与状态氛围光，仅剩一条底边线，导致敌对（`hostile`）、宿敌（`nemesis`）、同行（`ally`）与普通在场人物在展开后缺乏直观的视觉基调区分。
   - 头像尺寸偏小（`60×74px`），缺少 Kiroshi 取景角标与档案编号眉标（如 `KIROSHI // LIVE TARGET`）；「AI 像 / 重绘」工具按钮过于暗淡。
3. **缺少电子战破冰与生效破解联动**：
   - 当在场目标已被捅穿个人黑冰（`breachedTargets`）或正承受快速破解（`activeEffects`）时，展开的「现场透视」与身份标签中未体现该电子战状态。
4. **Kiroshi 遥测带与双栏条目质感平淡**：
   - `.telemetryRibbon` 仅为纯文字加竖线，缺少仪器读数舱与扫描状态徽章的科技层次感。
   - 分段标题（`.subHead`）仅有单薄小字，缺少菱形导引节点与切角计数胶囊；条目卡片悬停反馈偏弱。
   - 「档案与关系」页中的关系定性、共同记忆、已知情报与人际关系仍为朴素的无序列表，缺少档案卡片与时间轴左轨结构。

## 2. 核心优化方案

### 2.1 吸顶顶栏 + 内部滚动壳层（`Corners.tsx` + `corners.module.css` + `profile.module.css`）

- **吸顶固定顶栏**：将 `.person .growBody` 与 `.profile` 升级为弹性纵向容器，`.topBar`（分栏页签 + 目标快切芯片 + `ESC` 关闭键）固定吸顶，下方主体（身份横幅 + 分栏内容）在 `.profileScroll` 内独立平滑滚动。
- **克制精致的顶栏控件**：去掉 `.personHeadBtn[data-active]` 的常驻刺眼实心黄底，改为带切角细框与 `ESC` 键帽层次的赛博收起按钮（悬停高亮）；目标快切芯片增加当前激活底光与清晰边框。

### 2.2 紧凑三行身份横幅（`ProfileBanner` in `Profile.tsx` + `profile.module.css`）

- **去内套娃框与左侧粗色条**：`.bannerEmbedded` 不再叠加内层九宫格框或左竖条；肖像收紧为 `54×66px`，右侧三行内完成全部核心身份信息：
  1. 第 1 行：姓名 + 代词/外号 + 状态标签（敌对、宿敌、已破冰、生效破解、同行、中间人、伤势）+ 右侧内联好感度（不再单独占行）；
  2. 第 2 行：身份与势力简介；
  3. 第 3 行：左侧内联核心读数（`体征 · 威胁 · 神经`，未扫描时不复读三个“未扫描”）+ 右侧操作按钮（`义眼扫描/复扫`、`互动/针对行动`、`同行`）。

### 2.3 「现场透视」原生 2077 诊断卡 + 双列 `qh.cell` 切角插槽（`ScanTacticalView`）

- **完全对齐 `BiomonitorPanel` 与 `CyberdeckPage` 的原生 2077 视觉语言**：
  - 外层分区采用 `<CellFrame />` 红框诊断卡（`.card` + `.cardHead`），彻底移除带左侧竖色条（`cyber.cellRarity`）与 `38×30` 假图标框的子项小卡片。
  - **卡 1 `OPTICS // 链路 · 创口 · 表观`**：用 `.subRows` 水平细线键值表紧凑汇总骇入防线、电子战态势、具体创口、可见掉落与穿戴衣着（穿戴衣着一行排完，不再拆成 4~5 张小卡片）。
  - **卡 2 `WEAKNESS // 战术突破口` & 卡 3 `CYBERWARE // 已检出植入体` & 卡 4 `ARSENAL // 随身武装与物品`**：内部均采用双列 `qh.cellBg` / `qh.cellFg` 原生切角插槽网格（`.progGrid` + `.progCell`）+ `01/02` 等宽槽位号 + `tab.bg` 九宫格切角微按钮，随身武装与随身物品合入同一双列网格，条目再多也不会把面板拉长。

### 2.4 「档案与关系」原生 2077 诊断卡（`DossierSection`）

- **卡 1 `RELATION // 关系与背景档案`** + **卡 2 `CHRONICLE // 记忆 · 情报 · 人脉`**：同样采用 `<CellFrame />` 红框诊断卡与 `.subRows` / `.dossierRow` 水平细分隔行，无左侧粗竖色条与方框堆叠。

## 3. 实施与校验结果

1. **Step 1**：已保存计划文档 `docs/plans/present-person-card-redesign.md`。
2. **Step 2**：已在 `Corners.tsx` 中将目标电子战状态（`breached` / `breachedVia` / `activeEffects`）透传至 `PresentPerson` 与 `Profile`，并升级 `corners.module.css` 展开壳层与快切/收起按钮样式。
3. **Step 3**：已升级 `Profile.tsx` 与 `profile.module.css`（吸顶顶栏、Kiroshi 光学身份横幅、4 舱遥测矩阵、电子战状态条、菱形分段抬头与结构化档案列表）。
4. **Step 4**：已通过 `tsc --noEmit`、`biome check` 与 `check-data` 校验，待用户实际运行验收。
