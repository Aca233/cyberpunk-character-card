# 两张 SillyTavern 世界卡的前端角色创建流程研究

> 研究对象：用户给出的两张 PNG 封面。它们并非普通图片，而是内嵌 Character Card V3 元数据的酒馆卡：
> - 红发人鱼图：`03a7598d8aad4c1396049cf3b681d4ee.png` → 《创世回廊6.0》（卡内版本 `5.3`，739 条世界书，15 条正则，7 个助手脚本），首条消息 `【封面】`。
> - 城堡/白鸟/鹿图：`de7ea18dc78748dbb61ecbaf0339eeb2.png` → 《命定之诗与黄昏之歌 v4.3》（卡内版本 `V4.3.4`，559 条世界书，10 条正则，7 个助手脚本），首条消息 `【首页】`。
>
> 这两张卡都把“创角前端”放在**卡外远程资源**里：PNG 只保存封面、首条消息占位符、世界书、正则和加载器。真正的 UI 是运行时从 CDN 拉取的 Vue 单页。下面结论来自本机解析 PNG `tEXt` 块 + 下载到的远程前端源码；研究副本在 `.run/card-research/`，未改动项目源码。

---

## 1. 先说共同架构：卡面 → 正则 → 远程 Vue → 酒馆变量/聊天

两张卡都采用同一种“消息占位符替换”模式：
1. 角色卡首条消息极短，只写一个标记，如 `【封面】`、`【首页】`、`【开局】`，或第二条 swipe 里的 `<customized>…</customized>`。
2. 卡内 `data.extensions.regex_scripts` 用 `markdownOnly` 正则把这个标记替换成一段 `<body><script>…</script>` HTML。
3. 该脚本用 jQuery `$('body').load(...)` 或 `document.write(fetch(...))` 拉取 CDN 上的 Vue 前端，注入当前聊天消息气泡。
4. Vue 前端在酒馆页面上下文里调用 TavernHelper / SillyTavern / Mvu API，写变量、改世界书条目、切换 swipe，或构造一条开局 user 消息触发模型。
5. 卡内世界书（`character_book.entries`）提供游戏规则、变量 schema、叙事约束；助手脚本提供 Mvu、Zod、状态栏、创意工坊、资源版本解析等底层能力。

因此“前端创角流程”实际有三层：

| 层         | 放在哪里                          | 职责                                                       |
| ---------- | --------------------------------- | ---------------------------------------------------------- |
| 卡内壳     | PNG `tEXt` 的 `ccv3`/`chara` JSON | 封面、swipe、世界书、正则替换、助手脚本、资源版本变量      |
| 远程前端   | jsDelivr / 自建 CDN 的 HTML       | 用户看到的分步表单、卡片墙、地图、点数校验、预设管理       |
| 酒馆运行时 | SillyTavern + TavernHelper + Mvu  | 变量落库、世界书开关、聊天消息、模型触发、草稿与角色卡变量 |

---

## 2. 《创世回廊6.0》：7 步重度 TRPG 捏人

### 2.1 用户实际点击路径

封面 `【封面】` 不是创角页，而是门禁页：
- 正则 `[03] 封面` 把 `【封面】` 替换成一张 18KB 的 HTML 封面（加载遮罩、封面图、特色 2×2、协议勾选、“环境依赖检测”）。
- 依赖检测包括 `Mvu.getMvuData/replaceMvuData`、`__辅助计算脚本_loaded__`、`__小手机脚本_loaded__`、`__状态栏_loaded__`、EJS Template 是否启用。
- 没勾选“我已阅读并同意以上协议”时，“踏入深渊”按钮保持 disabled。
- 点击后调用 `getChatMessages("0", { include_swipe: true })`，取 `messages[0].swipes[1]`，用 `setChatMessage(..., 0, {swipe_id: 1, refresh: 'display_and_render_current'})` 切到第二开场白 `【开局】`（`mermaid__regex_03_replace.txt:582-607`）。

`【开局】` 再经正则 `[04] 开局` 替换成一个 shell：fetch `https://cdn.jsdelivr.net/gh/tangquanghuy/dnf@latest/dist/V20261015/build.html?v=1`，`document.write` 注入，并额外插入 iframe 高度自适应脚本（`mermaid__regex_04_replace.txt:17-158`）。这个 1.2MB 的 `build.html` 标题就是 **RPG 角色创建**，Vue 3 单文件，约 2.2 万行。

进入创角后顶部是 7 步 stepper（`mermaid_remote_build.html:11412-11420`）：

| 步  | 标题          | 主要收集                                                                               | 关键机制                                                                                                                                  |
| --- | ------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 0   | 角色选择首页  | “从零开始创建” / “预设角色”                                                            | 预设角色直接跳过繁琐创建；创意工坊入口                                                                                                    |
| 1   | 世界观        | 6 个世界观之一                                                                         | 创世回廊、刀剑神域、琥珀之剑、大明志异、屠龙与都市日常、诡秘地海；同时决定后续出生点地图、种族池、职业池、开局文本                        |
| 2   | 基本信息      | 姓名、性别、年龄、头像、种族/出身、等级、六维属性、出生点、难度/战斗数值模式、开局方式 | 世界观专属出身；27 点购点法（六维 8–15）；RP 预算；iframe 地图点选出生点；Lv.1 有 +20 RP 奖励；难度倍率与经典/新版数值模式写进 `系统配置` |
| 3   | 职业技能      | 基础职业、转职分支、自定义职业问卷、AI 技能树                                          | `TavernHelper.generate`（带世界书）或 `generateRaw`（不带世界书）生成整套技能树；支持锁定技能后重生成、修订；非法技能类型会标红并阻止写入 |
| 4   | 背景特质/专长 | 出身背景、开局剧情、初始商店装备、正负特质、生活专长、自定义项                         | RP 统一计价：正面特质 −30 RP、负面特质返 RP、专长 −20 RP、初始商店装备按 `售价RP` 扣；不同世界观有专属出身/资产/状态                      |
| 5   | 初始羁绊      | 预设队友或自定义队友                                                                   | 队友带完整属性/装备/技能/好感度；自定义队友可填外观、着装、背景、六维购点；预设角色会锁定部分队友                                         |
| 6   | 构筑评议      | 让模型评价当前构筑                                                                     | ≥60 分一次性奖励 +10 RP、+2 属性点；可不带预设/世界书或带上下文；指纹防重复评议                                                           |
| 7   | 信息确认      | 汇总卡、校验、开始旅程                                                                 | 检查技能树已生成、RP ≥ 0、属性点剩余 0、世界观专属出生点合法；通过后写 MVU、按世界观切世界书、发送开局 user 消息                          |

步骤栏 `goToStep` 只允许回退，不允许向前跳；底部固定“上一步 / 下一步”，第 7 步按钮变成“开始旅程”（`mermaid_remote_build.html:7951-7954, 11130-11134, 20737-20740`）。

### 2.2 数据源与点数

- 世界观：`WORLDVIEW_CORRIDOR_ID='corridor'`、`sao`、`amber`、`jiuzhou`、`dragon`、`earthsea`，见 `mermaid_remote_build.html:14920-14925, 17526-17575`。
- 开局：`openingOptions` 里每个世界观有若干开局，如“穿越开局 / 醉酒赌约 / 亡者商队 / 天降巨龙 / 风暴囚车 / 自定义开局”、SAO“初始城镇”、琥珀“血与火的序章 / 明焰与梦魇 / 边境领主”等（`17599-17643`）。
- 种族/出身：顶部内嵌了 DNF×NGNL 的十六种族、大明志异根骨、都市异能异质、诡秘地海出身等大段数据；例如“半身人的幸运”“血脉狂化”“次元公寓”“零点便利店”“调查员理智”等，每项带 `desc`、`lore`、正负 `traits`、`checks`（`20-1726`）。
- 属性：`TOTAL_POINTS = 27`，博德之门 3 式 8–15 购点（`13165, 16162-16280`）；六维是力量/敏捷/体质/智力/感知/魅力。
- RP：基础 RP + Lv.1 奖励 + 构筑评议奖励，扣除种族/出身、队友、初始商店、正面特质/专长，负面特质返还（`16213-16253, 16774-16776`）。第 7 步 `remainingRP < 0` 或属性点剩余 >0 都直接 `alert` 阻止开局（`20000-20063`）。
- 随机与 AI：技能树生成用 `Math.random` 请求 ID、`generate/generateRaw`；构筑评议同样可调用模型；部分特质本身是 d20/战利品检定规则。没有“掷生命路径”式的开局抽卡，随机性主要在 AI 技能树与规则检定。
- 预设：完整配置可保存到角色卡变量 `PRESET_STORAGE_KEY`，从旧 `localStorage` 迁移，支持单个/全部 JSON 导出、导入、覆盖确认、删除（`13400-13998`）。预设角色（癌骑士、夜斗等）会锁定职业、出身、特质、技能树、头像，并把头像 URL 存 `rpg_player_avatar`（`12403-12518, 17075`）。

### 2.3 完成后的产物与落库

`saveCharacterToMvu()`（`18497-19996`）是核心提交函数：

```text
Mvu.getMvuData({type:'message', message_id:'latest'})
  → stat_data.人物 = {
      名称, 种族, 出身?, 职业, 背景设定, 出生点,
      等级, 本级经验, 当前总经验, 升级阈值, RP,
      生命值上限/当前生命值, SP, AC,
      属性 { 力量/敏捷/体质/智力/感知/魅力, 属性点 },
      战斗属性 { 暴击率/暴击伤害/…每回合动作资源 },
      资源技能, 技能树, 特质, 状态效果, 背包/装备列表, …
    }
  → stat_data.世界信息 = { 年历, 时间, 位置, 世界观, 世界剧情, … }
  → stat_data.系统配置 = { 技能系统模式, 战斗数值模式, 敌人倍率, 难度, 世界观, 对白美化, … }
  → stat_data.任务列表 / 战斗 / 羁绊列表 / 附近的人 …
  → Mvu.replaceMvuData(...)
```

代表性证据：`18618-18657` 写 `人物` 主体；`18660-18707` 写特质与技能树；`18750-18790` 写世界信息、系统配置、背包；`18887-18914` 按世界观注入出身加成、初始任务、战斗对象；`18917+` 写完整羁绊列表（含队友装备/技能/外貌/好感度）；`18055-18178` 另有 `saveDifficultyToMvu` / `saveWorldviewToMvu` 在切选项时提前写系统配置。

提交动作顺序是：
1. `await saveCharacterToMvu()`；
2. `await applyOpeningWorldbookRules()` 按世界观开关对应世界书条目（含地图世界书）；
3. `sendStartMessage()` 构造一个中文 JSON 配置 + 开局指令，明确告诉模型“人物基本属性已经有值，禁止修改，只初始化 JSON 里涉及的初始道具、更新地点变量、全量刷新传闻”（`20317-20474`）；
4. 按世界观/开局选择拼不同开场提示（如 SAO 茅场晶彦死亡游戏、琥珀布契之夜、自定义开局等，`20477-20692`）；
5. 通过父窗口 DOM：`#send_textarea.value = message` → dispatch `input` → `#send_but.click()` 发出一条普通 user 消息，失败则复制到剪贴板（`20694-20736`）。

也就是说它**不创建新角色卡对象**，而是“把结构化角色写进当前聊天楼层的 MVU 变量，再让模型按剩余上下文写第一段剧情”。

### 2.4 值得借鉴 / 风险

值得借鉴：
- 封面协议 + 环境自检 + swipe 切开场白，把“开卡前准备”做成可见仪式。
- 世界观作为第一分叉，驱动后续所有数据表、地图、职业、出生点、开局文本，避免一个流程硬套所有设定。
- 单一 RP 预算贯穿出身、特质、专长、队友、初始商店；属性另有 27 点购点，两套预算语义清楚。
- 技能树 AI 生成、锁定后重生成、非法类型标红；预设角色/构筑预设导入导出；构筑评议给一次性奖励。
- 结构化数据直接写 `Mvu`，提示词只携带“模型需要创作/补充”的非量化信息，减少模型篡改数值。
- 地图 iframe 选出生点，并把完整 `出生点` 地理设定写进第一条消息。

风险：
- 创角 UI 完全依赖 `jsdelivr @latest` 的 1.2MB 单页；CDN 版本漂移、断网、脚本接口变化都会让整张卡无法开新档。
- 用 DOM `#send_textarea/#send_but` 点击发送，属于对酒馆内部 DOM 的强耦合。
- 技能树与构筑评议会额外调用模型，费用、超时、JSON 合法性都影响能否开局；界面也明说带世界书可能干扰 JSON。
- 规则数据、世界书、前端代码三处分散，版本不一致时容易出现“提示词说一套、变量写一套”。
- 卡内有加密/混淆的 `odysseia_trace`，外部无法审计；还包含大量成人/猎奇向特质与特殊开局，移植时需内容分级。

---

## 3. 《命定之诗与黄昏之歌 v4.3》：首页配置向导 + 4 步自定义开局

这张卡把“创角”拆成两段：**首页配置世界/系统 → swipe 选择开局模式 → 自定义开局表单**。

### 3.1 首页 `frontend/home/index.html`：不是并列按钮，而是 3 步向导

`【首页】` 经正则 `[06]` 替换为资源加载器：`resolveResourceRoot(... "frontend/home/index.html")` → `$('body').load(...)`（`ver43__regex_06_replace.txt:123-129`）。资源根有自建 CDN `https://cdn.poem-of-destiny.com/assets/{version}`，默认 `1.2.2`，可读取角色变量 `资源版本.命定之诗` 覆盖，并用 HEAD 探测、localStorage 记住上次可用源、sessionStorage 记录已加载版本、6 秒超时、失败降级默认版（`ver43__regex_06_replace.txt:5-122`）。

首页 Vue 应用先加载远程 `agreement.json`，展示：
- 环境检查：`getTavernHelperVersion() >= 4.8.19`、`SillyTavern.getContext().extensionSettings.EjsTemplate.enabled`、`waitGlobalInitialized('Mvu')` 3 秒超时；
- 协议版本同意后写 `localStorage['destined-journey-agreement-version']`；
- 可以“跳过检查”，但需要勾选协议才能继续。

之后 `App.setup` 的 `s=[Wt, Re, Sa]` 是 3 个组件（`ver43_home_index.html` 约 `@48756`）：
1. `DLCManagementPage`：按「角色 / 事件 / 扩展」Tab 管理世界书 DLC，支持搜索、详情、互斥 `[!X]`、替换 `[>X]`、前置 `[<X]`、`[WS]` 创意工坊标记，保存时通过 `TavernHelper.getCharWorldbookNames/getWorldbook/updateWorldbookWith` 批量改条目 `enabled`。
2. `CorePage`：“核心选择”，按 Tab / 特别推荐卡片列出 `[命定系统]` 世界书核心，要求**恰好选中 1 个**才能下一步；同样写回世界书 enabled。
3. `StartPage`：“你的故事将从何开始”，两个开局 swipe：
   - index 1：`我的故事将由我亲手书写` → 对应 `<customized>自定义开局开始</customized>`，由正则 `[07]` 拉起 `frontend/custom_start/index.html`；
   - index 2：`《线与天堂与彼岸花》` → 对应 8K+ 字弗洛洛预设开局（`<gametxt>…`，自带 `<UpdateVariable><JSONPatch>` 与 `<StatusPlaceHolderImpl/>`）。

   还要选择变量输出方式：`主API` 或 `额外API`，页面据此开关 `[本体][变量]output_format_*` 等世界书条目。

   点“开始旅程”后直接改：

   ```js
   SillyTavern.chat[0].swipe_id = t;
   SillyTavern.chat[0].mes = SillyTavern.chat[0].swipes[t];
   await SillyTavern.saveChat();
   await SillyTavern.reloadCurrentChat();
   ```

   （`ver43_home_index.html` 约 `@46122-46390`）。

首页不做角色数据落库，不写 `InitVar/stat_data`；它只负责协议、环境、DLC/核心/变量模式配置和“切到哪个开场白”。

### 3.2 `frontend/custom_start/index.html`：4 步点数购物流

`<customized>…</customized>` 经正则 `[07]` 拉起 402KB 的 Vue 3 + Vue Router 单页（`ver43__regex_07_replace.txt:124-126`）。启动时会并行 fetch 7 个 JSON5 数据文件：`baseInfo.json`、`equipments.json`、`items.json`、`assets.json`、`skills.json`、`backgrounds.json`、`partners.json`，从 `__destinyAssetBase` 拼 `assets/data/...`，失败重试 3 次；全部成功才 `app.use(pinia).use(router).mount('#app')`（`ver43_custom_start_index.pretty.html:3-30, 约 @249150`）。

四步路由（`ver43_custom_start_index.pretty.html:208-212`）：

| 步  | 路由名       | 标题           | 内容                                                                                                                                                                                                                |
| --- | ------------ | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `BasicInfo`  | 基础信息与属性 | 姓名（只读，取酒馆当前人设名 `SillyTavern.name1`）、性别/自定义性别、年龄、种族/自定义种族、身份/自定义身份、起始地点/自定义地点、等级、天赋水平、五维基础点/等级属性点、转生点 Roll、命运点/金钱兑换、世界地图查看 |
| 2   | `Selections` | 装备与技能     | 装备/道具/资产/技能四大类，按品质、类型、子分类筛选；卡片选择、已选面板、自定义物品表单、编辑回填                                                                                                                   |
| 3   | `Background` | 伙伴与初始背景 | 伙伴按生命层级 1–7 选、可自定义伙伴（姓名/层级/属性/外貌/着装/背景等）、命运点兑换、初始开局剧情卡片；开局剧情可带种族/地点/身份前置条件                                                                            |
| 4   | `Confirm`    | 确认提交       | 转生点/已消耗/剩余/命运点统计，基本信息、已选条目、注入设置、提示词预览；按钮“踏上旅程”                                                                                                                             |

状态存于 Pinia store `Te('character', ...)`（约 `L112-119`）：`character` 默认值含 `name, gender, customGender, age, race, customRace, identity, customIdentity, startLocation, customStartLocation, level, talentLevel, basePoints, attributePoints, reincarnationPoints=1000, destinyPoints, money`；另有 `selectedEquipments / selectedItems / selectedAssets / selectedSkills / selectedPartners / selectedBackground`。

核心预算：
- 统一货币是 **转生点**，默认 1000，可点“Roll 点数”在尚未消费时重掷；开发者模式可给 666666。
- `consumedPoints` = 种族 cost + 身份 cost + 天赋 cost + 装备/道具/资产/技能/伙伴 cost + 金钱兑换 + 命运点兑换。
- 天赋水平决定基础属性点预算：`平庸 20 / 普通 22 / 出众 25 / 卓越 28 / 天纵奇才 30`，分别消耗 `1 / 100 / 200 / 300 / 114514` 转生点（`L41`）。
- 五维为力量/敏捷/体质/智力/精神；基础点每项最多 +6；等级额外属性点按 `level` 分档（`X/Z` 函数，L41）；最终属性 = 基础点 + 层级固定 + 等级属性点。
- 生命层级按等级 1–4 / 5–8 / … / 25+ 分七层；HP/MP/SP 由五维与等级系数计算（`L170-171`）。
- 品质七档：普通/优良/稀有/史诗/传说/神话/唯一；物品/技能可自定义名称、类型、标签、品质、效果、描述、数量、资产内部资产等（`L30, L176-177, L347-348`）。
- 下一步总闸只有两个硬条件：必须选天赋水平、可用转生点不能为负（`L232-234`）。姓名来自酒馆人设，页面提示“要换名字请先切人设”，并在 `SETTINGS_UPDATED` 时同步。

草稿与预设：
- 聊天级草稿 `custom_start_draft`：`updateVariablesWith(..., {type:'chat'})`，800ms 防抖，保存 `savedAt / step / preset(姓名清空) / 自定义背景 / 自定义表单 / 编辑器草稿`；仅首条消息时有效，恢复后跳回原 step，失败会清空草稿与整个表单（`L184-192, L213-218`）。
- 角色卡级预设 `start_presets`：`getVariables/insertOrAssignVariables({[start_presets]:…}, {type:'character'})`，支持保存、覆盖二次确认、加载、删除、单条/全部导出 JSON、导入 JSON 及同名冲突处理（`L122-167`）。
- 还有“自定义注入设置” `customInjectionSettings`：允许某类已选内容**不直接写进 MVU**，而是作为“待生成条目”写进第一轮提示词，让模型按 schema 补写。

### 3.3 完成后的产物与落库

`Na().executeJourney`（`L193-195`）是提交函数，顺序非常清楚：
1. `e.syncPlayerName()` 确保姓名来自当前酒馆人设；
2. 根据 `customInjectionSettings` 把“直接注入”和“交给 AI 生成”的装备/道具/资产/技能/伙伴分组；
3. `await ia(...)`：`waitGlobalInitialized('Mvu')` → `Mvu.getMvuData({type:'message', message_id:'latest'})` → `_.set`：
   - `stat_data.命运点数`
   - `stat_data.主角`：`种族, 职业, 生命层级, 等级, 累计经验值, 升级所需经验, 属性点, 属性{五维}, 生命值/法力值/体力值{当前,上限}, 状态效果, 金钱, 背包, 资产, 装备, 技能, 登神长阶`
   - `stat_data.关系列表.<伙伴名>`：在场、生命层级、等级、种族、身份、职业、性格、喜爱、外貌、着装、五维、装备/技能、登神长阶、命定契约、好感度、心里话、背景故事
     然后 `Mvu.replaceMvuData(r, {type:'message', message_id:'latest'})`（`L178-180`）。
4. `da(...)` 生成中文 user 提示词：【剧情生成上下文】→【第一轮变量更新要求】（`世界.时间 / 世界.地点 / 主角.装备.*.位置 / 资源上限.额外`）→【需要本轮写入变量的其他已选内容】（按 `写入路径: 主角.背包/装备/资产/技能.<名称>`、`关系列表.<名称>` 列出品质、标签、数量、效果、描述或完整伙伴 JSON）→【初始开局剧情】→“根据 `<status_current_variables>` 和以上内容，生成一个符合描述和情景的初始剧情！”（`L181-183`）。
5. `await createChatMessages([{role:'user', message:r}])` 新建一条 user 消息；清掉 `custom_start_draft`；可选 `await triggerSlash('/trigger')` 触发 AI，或“仅生成文本”不触发（`L190-195`）。

它同样**不写 `InitVar`、不改 swipe、不替换首条消息**；结构化数据写 `Mvu`，叙事上下文作为新 user 消息发给模型。首页的 swipe 切换只决定玩家进入“自定义开局”还是“预设弗洛洛开局”。

### 3.4 值得借鉴 / 风险

值得借鉴：
- 首页把“协议/环境检查 → DLC → 核心 → 变量输出方式 → 开局模式”做成配置向导，创角表单本身不关心世界书开关。
- 两套 swipe 开局：自由创角与作者预设剧情共存，且首页可一键切换。
- 统一“转生点”购买一切（种族、身份、天赋、装备、资产、技能、伙伴、金钱、命运点），预算条固定可见；Roll 点数、开发者模式、预设导入导出、聊天级草稿都很完整。
- 直接注入 MVU 与“交给模型第一轮补写”可逐类切换，兼顾 token 成本与结构化可靠性。
- 明确区分：结构化数据写 `<status_current_variables>`，AI 只接收少量剧情上下文；确认页标题直接写“可结构化的数据会写入 MVU 变量；AI 只接收少量剧情上下文”。
- 资源版本可从角色变量覆盖，CDN HEAD 探测 + 默认版本回退 + localStorage/sessionStorage 缓存，比 `@latest` 直接加载稳健。

风险：
- 首页、创角页、7 个 JSON5 数据表、助手脚本都来自远程资源；离线或 CDN 部分 404 会导致 `开局数据加载失败`。研究时按默认版本手工拼 `frontend/custom_start/assets/data/*.json` 返回 404，说明真实数据路径可能由部署重写/版本目录决定，卡与资源必须同版本使用。
- 依赖 `TavernHelper >= 4.8.19`、EJS Template 启用、`Mvu` 就绪；环境不满足时只能跳过检查，后续变量写入风险高。
- `start_presets` 存在角色卡变量、`custom_start_draft` 存在聊天变量，预设里还清空姓名以适配人设切换；迁移/导出卡时容易丢配置。
- 世界书条目名就是配置协议（`[本体]…`、`[DLC][角色|事件|扩展]…`、`[命定系统]…`），改名会破坏首页正则与 DLC/核心解析。
- 大量内容藏在 CDN、世界书和 `xiaobaix-template` 里，卡文件本身无法离线审计；`odysseia_trace` 同样是不可读密文。

---

## 4. 与本仓库 `cyberpunk-character-card` 的对照

本仓库是 React + Hono + IndexedDB 的独立 Web App，不是 SillyTavern 正则卡。当前 8 步在 `apps/web/src/features/characters/creator.ts:29-38`：

`出身与身份 → 过往经历 → 旧识(可选) → 核心特长 → 义体(可选) → 属性分配 → 角色特写 → 档案确认`

要点：
- `aad7c87` 之后 `CharacterCreator.tsx:149-167` 的页签只 `disabled={busy}`，已完全自由跳步；`docs/creator-plan.md` 里“只能点回走过的步”过期。
- 出身卡可直接调用 `applyOriginPreset` 一键装配完整主板、过往、本事、属性，出现“基础构筑就绪/直接前往确认档案”的快捷路径（`CreatorSteps.tsx:85-98, 231-260`）。这与外部卡的“预设角色”思路接近，但仍是本项目自己的 `Board` 数据。
- 点数仍是两套：背景点 12 / 负面经历最多返还 6；属性点常量在 HEAD 已被 `3ec6df9` 改为 `ATTRIBUTE_BASE=2 / ATTRIBUTE_POINTS=5 / ATTRIBUTE_CREATE_MAX=5`，而 `CharactersScreen.tsx:61` 的 `blankCard()` 仍硬编码全 3、`docs/gameplay-mechanics.md:139-143` 仍写 3/7/6，`packages/core/src/narrator/tavern.ts` 导入卡也用全 3。该提交自述 `wip…（未完成）`。按 `CharacterCardSchema:82-96` 的 `pointsSpent > ATTRIBUTE_POINTS` 校验，全 3 恰好花掉 5 点、每项也没超过 5，因此**不会被 schema 拒绝**；但它一进创角就把 5 点预算用光，界面显示 0 点可分配，等于空白卡默认先替玩家点满，`ORIGIN_PRESETS` 的三组属性也都是 2..5 且合计恰好 5 点。对照时以代码常量为准，把“空白卡默认值 vs 新预算”列为 UX/文档漂移，而不是保存失败。
- 草稿存 `localStorage['cp.creatorDraft']`（`creator.ts:56-170`），保存走 `api.createCharacter/createSave`，纯前端模式落 IndexedDB；导入支持 JSON 或 PNG `tEXt(chara/ccv3)`，导出是 Character Card V2 JSON（`tavernFile.ts:3-71`）。
- 正文一键成稿/逐块重写走本项目模型 API，`scene/greeting/examples` 归“酒馆卡面”不交给叙事模型；开档后不做开场正文，等玩家写第一句。

| 维度     | 本仓库                                                       | 创世回廊6.0                                                   | 命定之诗 v4.3                                             |
| -------- | ------------------------------------------------------------ | ------------------------------------------------------------- | --------------------------------------------------------- |
| 前端形态 | 仓库内 React 组件，静态部署                                  | CDN Vue 单页，由正则注入消息                                  | CDN Vue 首页 + CDN Vue 创角页，由 swipe/正则注入          |
| 流程粒度 | 8 步、自由跳步、流派预设                                     | 7 步、只能回退、世界观强分叉                                  | 首页 3 步 + 创角 4 步                                     |
| 预算     | 背景点 + 属性点                                              | RP + 27 点属性购点 + 构筑评议奖励                             | 单一转生点 + 天赋基础属性点                               |
| 地图     | `StartMapPicker` 原作地图点图钉                              | 世界观专属 iframe 地图选出生点                                | OpenSeadragon 世界地图辅助确认起始地点                    |
| AI 参与  | 写外貌/背景/性格/说话方式，可逐块重写                        | 生成技能树、构筑评议、写第一段剧情                            | 可让 AI 补写未注入的变量、写初始剧情                      |
| 预设     | 3 个出身流派构筑 + 草稿                                      | 角色预设 JSON 导入导出、预设角色锁定                          | 角色卡变量预设 JSON 导入导出 + 聊天级草稿                 |
| 落库     | CharacterCard / Board / IndexedDB / 存档                     | `Mvu.stat_data` + 世界书开关 + user 消息                      | `Mvu.stat_data` + 聊天变量草稿 + user 消息 + swipe        |
| 开档     | 保存角色卡 → `createSave` → 进入 `/play/:id`                 | 写 MVU → 切换世界书 → 发开局指令让模型生成正文                | 首页切 swipe → 写 MVU → `createChatMessages` → `/trigger` |
| 主要优势 | 类型安全、可测试、存档/角色库分离、离线静态                  | 世界观/规则规模大、技能树与同伴数据极细                       | 配置向导、点数经济、直接注入/AI补写分层、资源版本回退     |
| 主要短板 | 内容锁定赛博朋克；文档与代码漂移；无依赖自检/协议/预设角色库 | 全靠 `@latest` CDN、DOM 点击发送、AI 技能树是硬门槛、超大单页 | 全靠 CDN + 7 个数据文件、世界书条目名即协议、环境依赖多   |

### 可落地的借鉴建议（按优先级）

1. **先修本仓库漂移**：统一 `ATTRIBUTE_*` 常量、`blankCard()`、导入卡默认值、文档；补一条新建空白卡 → 保存 → 开档的回归测试。
2. **给 8 步加“推荐路径 + 检查项总览”**：现在自由跳步容易漏项，可在档案确认页复用 `creatorChecks`，用红/黄项链接回对应步骤；这与《创世回廊》第 7 步汇总类似。
3. **把流派预设升级为可导出/导入的构筑预设**：当前 `ORIGIN_PRESETS` 写死在 `creator.ts`，可支持 JSON 导出、命名保存、覆盖确认、上次使用记录，参考两张卡的预设管理。
4. **开档前环境自检**：本项目纯前端依赖模型连接、IndexedDB、素材可用性。可在“保存并开启新战局”前做一次连接/存储/素材检查，明确哪些是阻断项、哪些可跳过。
5. **“结构化数据由代码写，模型只写叙事”**：本仓库已经是这个方向；可进一步在开档请求里显式列出已写入的 Board/属性/旧识，要求模型不得重复创建，类似《命定之诗》的 `<status_current_variables>` 提示词。
6. **可选开局模式**：用一条“快捷开局 / 自由创角”分流代替只靠 swipe；快捷开局可加载预设角色卡并直接开档，自由创角保留 8 步。
7. **谨慎对待远程化**：两张卡证明 CDN 前端能承载极复杂创角，但本项目已有类型安全和静态部署优势；若引入远程资源，必须版本锁定、哈希/签名、离线兜底，不要照抄 `@latest` + `document.write`。

---

## 5. 关键证据清单

1. 两张 PNG 的 `tEXt` 块分别是 14,061,072 / 3,531,648 字符 base64，解析后为 `chara_card_v3`；卡名《创世回廊6.0》《命定之诗与黄昏之歌v4.3》，见 `.run/card-research/*__ccv3.pretty.json` 与 `*_shape.txt`。
2. 世界书条目数 739 / 559；正则 15 / 10；助手脚本 7 / 7，见 `mermaid__overview.md:1-30`、`ver43__overview.md:1-32`。
3. 《创世回廊》首条消息 `【封面】`、alternate greeting `【开局】`；《命定之诗》首条 `【首页】`、alternate greetings 为 `<customized>…</customized>` 与弗洛洛 `<gametxt>…`，见 `*_shape.txt`。
4. `mermaid__regex_03_replace.txt:411-452` 封面依赖检测与协议；`:582-607` 勾选协议后 `setChatMessage(... swipe_id:1 …)` 切到 `【开局】`。
5. `mermaid__regex_04_replace.txt:17-158` fetch `build.html`、`document.write`、iframe 高度修复。
6. `mermaid_remote_build.html:11412-11420` 7 步配置；`:7951-7954` stepper；`:11130-11134` 上一步/开始旅程。
7. `mermaid_remote_build.html:14920-14925, 17526-17575` 六个世界观与 MVU 标签；`:17599-17643` 世界观开局选项。
8. `mermaid_remote_build.html:13165, 16162-16280` 27 点购点法；`:16213-16253` RP 预算；`:16774-16776` 初始商店 RP。
9. `mermaid_remote_build.html:9386-9496, 21594-21640, 22191-22195` AI 技能树生成、锁定、非法类型提示、`generate/generateRaw`。
10. `mermaid_remote_build.html:10698-10741` 构筑评议 ≥60 分奖励 +10 RP / +2 属性点。
11. `mermaid_remote_build.html:20000-20070` 最终校验与 `saveCharacterToMvu → applyOpeningWorldbookRules → sendStartMessage`。
12. `mermaid_remote_build.html:18497, 18618-18657, 18660-18790, 18887-18914` `stat_data.人物/特质/技能树/世界信息/系统配置/背包/任务/战斗` 写入。
13. `mermaid_remote_build.html:20317-20474, 20694-20736` 开局 JSON 配置、不同世界观提示词、`#send_textarea/#send_but` 发送。
14. `mermaid_remote_build.html:13400-13998` 预设角色配置的角色卡变量存储、迁移、导入导出。
15. `ver43__regex_05/06/07_replace.txt` 状态栏、`【首页】`、`<customized>` 三处共用资源根解析与 `$('body').load`；`ver43__regex_07_replace.txt:124-126` 指向 `frontend/custom_start/index.html`。
16. `ver43_home_index.html` 约 `@599-1621` 检查 TavernHelper 4.8.19、EjsTemplate、Mvu；`@43987-44220` 远程 `agreement.json` 与 localStorage 协议版本。
17. `ver43_home_index.html` 约 `@48756` `s=[Wt,Re,Sa]` 三步向导；`@44955` 两个开局与两个变量输出方式；`@46122-46390` `swipe_id/mes/saveChat/reloadCurrentChat`。
18. `ver43_custom_start_index.pretty.html:3-30` 远程 JSON5 数据与重试；`:208-212` 四步路由；`:231-234` 下一步校验。
19. `ver43_custom_start_index.pretty.html:41, 112-119, 170-171` 天赋/属性/层级/资源公式与 Pinia 状态。
20. `ver43_custom_start_index.pretty.html:184-192, 213-218` 聊天级 `custom_start_draft` 草稿；`:122-167` 角色卡级 `start_presets` 预设导入导出。
21. `ver43_custom_start_index.pretty.html:178-180` `Mvu.getMvuData/replaceMvuData` 写 `stat_data.命运点数/主角/关系列表`。
22. `ver43_custom_start_index.pretty.html:181-183` 【剧情生成上下文】【第一轮变量更新要求】与“待生成条目写入路径”提示词。
23. `ver43_custom_start_index.pretty.html:193-195` `createChatMessages` + `triggerSlash('/trigger')`，清草稿。
24. 本仓库 `apps/web/src/features/characters/creator.ts:29-38` 8 步；`CharacterCreator.tsx:149-167` 自由跳步；`CreatorSteps.tsx:85-98, 231-260` 流派预设；`CharactersScreen.tsx:61` blankCard 全 3；`tavernFile.ts:3-71` PNG/JSON 导入导出。
25. 本仓库 `packages/core/src/schemas/character.ts:18-22`（HEAD 2/5/5）与 `docs/gameplay-mechanics.md:139-143`（旧 3/7/6）漂移；`git show 3ec6df9` 自述为未完成 WIP。`CharacterCardSchema:82-96` 与 `creator.ts:400-424` 说明全 3 空白卡/三组流派预设恰好花满 5 点、合法但不再留可分配点。

---

## 6. 一句话结论

两张图对应的卡都不是“图片 + 提示词”，而是**把完整前端应用藏在 PNG 元数据所指向的 CDN 里**：《创世回廊6.0》是 7 步、世界观强分叉、RP/购点/AI 技能树的重度 TRPG 创角；《命定之诗 v4.3》是“首页配置向导 + swipe 分流 + 4 步转生点购物车”，两者最终都把结构化角色写进 `Mvu.stat_data`、把叙事上下文作为 user 消息交给模型。它们最值得本项目借鉴的是**预设角色/构筑库、开档前环境自检、点数经济可视化、结构化数据与模型提示词分层**；最不该照抄的是**把创角前端完全托管在可变 CDN 上、用 DOM 或世界书条目名当隐式 API**。
