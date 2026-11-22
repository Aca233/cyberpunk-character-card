# 展开追踪面板优化与视觉美化计划

> 状态：进行中（2026-11-22）
> 目标：全面升级展开态追踪面板（`Track` 抽屉壳层与全新独立的 `TrackerPanel.tsx` / `tracker.module.css`）的赛博朋克 2077 任务日志（Journal）视觉质感、信息层级与交互效率；补齐风险星级、余额对照、临期预警与结案结算等已有核心数据展示，并保持折叠态 HUD 的简洁克制与全站暖暗紫黑视觉体系高度统一。

## 1. 现状诊断

1. **展开尺寸偏窄且顶栏操作感弱**：
   - `.track[data-open]` 当前仅宽 `390px`，在展示委托详情、报酬、倒计时与多枚操作按钮时容易折行拥挤。
   - 展开后顶栏沿用折叠态简版样式，`ESC` 仅为静态 `<kbd>` 而非可点击收起按钮；缺少当前随身欧元对照（处理房租/赊账或评估报酬时需反复关闭查看装备栏）。
2. **条目视觉平淡、缺乏 2077 任务档案质感**：
   - 当前条目仅靠左侧 `2px` 纯色竖线区分，无卡片材质、切角轮廓、状态图标或折叠指示符，视觉上与已升级的生物监测、装备栏、全息消息终端及输入栏存在明显代差。
   - 委托元信息（类型、地点、委托方、牵线人、报酬）全部以纯灰字用 `·` 拼接在一行，缺乏主次重点；进展笔记为原生 `<ol>` 列表，缺少步骤推进感与最新进展高亮。
3. **已有高价值数据未被利用**：
   - `view.jobs.list` 已包含 `risk`（1–5 风险星级）与 `settlement`（声望、好感、人性结算变化），当前界面完全未呈现。
   - 账务与欠款未对照 `view.money.eddies` 显示余额是否足够；临期事项（如 4 小时内到期）与普通期限未作色阶区分。
4. **缺少分类筛选与固定顶栏滚动**：
   - 账务、在办委托、约定、待决风声、NCPD 警情与结案记录混排长滚，中后期查找不便，且整个 `.growBody` 一同滚动，顶部信息随滚动滚走。
5. **模块耦合**：
   - 旧 `JournalPage` 嵌在 `NeuralPages.tsx` 中，样式分散在 `story.module.css` 中（含已废弃的 `.trackBdCard` / `.trackQuietLine`）。

## 2. 核心设计方案

### 2.1 抽屉壳层与弹性滚动容器（`Corners.tsx` + `corners.module.css`）
- **展开宽度升级**：`.track[data-open]` 加宽至 `min(540px, calc(100vw - var(--corner-edge) - var(--corner-edge) - var(--corner-w) - var(--corner-gap)))`，既让卡片元信息矩阵与按钮从容排布，又保留对正文与左栏的安全边距；折叠态保持原宽与原摘要不变。
- **弹性吸顶滚动**：`.track[data-open] .growBody` 设为 `display: flex; flex-direction: column; overflow: hidden;`（仍受 `useRoomLeft` 的行内 `maxHeight` 约束），由内部 `.trackerScroll` 独立滚动，确保顶栏筛选条始终固定可见，同时短内容不留大块空黑。
- **展开顶栏升级**：展开态在 `.trackHead` 左侧呈现原作 `notify.journal` 图标、`追踪` 标题、`OBJECTIVE // LOG` 等宽副标与状态胶囊；右侧增加随身欧元余额胶囊（带 `notify.cash` 图标）与可点击的 `ESC` 赛博切角收起键。

### 2.2 独立追踪模块（`TrackerPanel.tsx` + `tracker.module.css`）
- **动态分类筛选栏（吸顶）**：
  - 提供 `全部` / `在办` / `待决` / `账务` / `结案` 赛博切角筛选芯片与数量角标；仅展示存在条目的次级维度，避免满屏 `0`；存在超期时显示紧凑的红色超期预警细带。
- **账务与欠款卡片（`BillCard`）**：
  - 3px 状态左轨（锁门/超期危红、待缴暖黄）+ 右下 8px 斜切角卡片底板 + 金额高亮徽章 + 期限胶囊。
  - 自动对照 `view.money.eddies` 展示「余额充足」或「差 X €」实时核对提示；房租不足时在按钮上清晰提示。
- **委托档案卡片（`JobCard`，在办 & 待决）**：
  - 区分在办（主线黄轨 / 超期危红轨 / 临期暖橙预警）与待决（全息青轨），头部含旋转展开指示符、任务图标、标题、类型标签、金色报酬数字与倒计时胶囊。
  - 展开区内采用结构化元信息网格：委托方/牵线中间人、目标地点、**5 格切角风险评级刻度条**（低危→极危色阶）与具体截止时间。
  - 进展笔记升级为带垂直导轨与菱形节点的**进展时间轴**，最新一条高亮展示、历史条目柔和退后。
  - 底部操作区提供带原作图标的紧凑切角按钮（`地图定位`、`写入行动` / `接下这单`、`先谈条件`）。
- **约定 / 赛事 / 熟人心事 / NCPD 警情卡片（`TrackEntryCard`）**：
  - 按来源精准匹配原作图标（`status.timeCircle` / `notify.streetCred` / `notify.journal` / `map.poi.police`）与色轨，清晰呈现来源标签、地点、进展详情、倒计时与快捷行动。
- **结案档案卡片（`ClosedJobCard`）**：
  - 按结案状态着色（完美绿 / 瑕疵黄 / 失败背叛红 / 放弃过期灰），呈现雇主、实收欧元、结案摘要，并补齐 **`settlement` 结算胶囊**（街头声望、中间人好感变化、人性变化）。
  - 在「全部」视图中作为底部精致折叠区展示；切换到「结案」筛选时直接完整展开。
- **待命空态（Standby View）**：
  - 无任何在办/账务/待决风声时呈现 `TRACKER // STANDBY` 终端待命卡，附简洁引导与「打开地图」直达入口（传入 `onOpenMap` 时）。

### 2.3 旧代码清理（不做历史兼容）
- 从 `NeuralPages.tsx` 移除旧 `JournalPage`，在 `StoryScreen.tsx` 直接接入 `TrackerPanel`（补充传入 `onOpenMap`）。
- 清理 `story.module.css` 中不再使用的旧 `.trackPane` / `.trackSection` / `.trackGig*` / `.trackBd*` 等样式。

## 3. 实施步骤

1. **Step 1**：创建并提交计划文档 `docs/plans/tracker-panel-redesign.md`。
2. **Step 2**：优化 `Corners.tsx` 与 `corners.module.css` 中的 `Track` 展开壳层、顶栏与弹性滚动容器，提交 git。
3. **Step 3**：新增 `tracker.module.css` 与 `TrackerPanel.tsx`，接入 `StoryScreen.tsx`，清理 `NeuralPages.tsx` 与 `story.module.css` 旧代码，提交 git。
4. **Step 4**：运行静态类型检查（`tsc`）与规范检查（`biome check`），修正问题并更新本计划状态后提交 git（按约定测试交由用户自行验收）。
