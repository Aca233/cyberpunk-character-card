# 游戏音乐与音效系统设计及实施计划（优先原版素材）

- **状态**：进行中
- **日期**：2026-11-22
- **范围**：原版音频素材清单与打包链路、前端音频引擎（BGM 双轨平滑淡入淡出 + 低延迟 Web Audio SFX）、自适应场景配乐导演、全界面交互与剧情事件音效接入、设置页音频配置与快捷静音控制。

## 1. 目标与原则

1. **优先使用《赛博朋克 2077》原版解包素材**：
   - 从本机解包目录 `C:\Cyberpunk 2077\_unpack\export\` 精选经逐轨人工试听确认的原版配乐与音效（`audio_sfx_ogg_music/` 与 `audio_sfx_ogg/`），绝不使用无关素材或带歌词人声的电台曲干扰阅读体验。
   - 严格沿用项目现有 `apps/web/public/assets/local/` 约定：原版音频输出至 `apps/web/public/assets/local/audio/`（已被 `.gitignore` 忽略，不随仓库分发），元数据与强类型 ID 由 `tools/assets/` 清单与脚本统一管理与校验。
   - 使用 `ffmpeg` 将精选原版素材做响度均衡、精确裁剪（去掉长尾静音与前导空拍）并转为跨浏览器通用格式（`.mp3`，确保 Chromium / Firefox / Safari 均无解码兼容性问题）。
2. **微交互补充与无素材兜底**：
   - 《赛博朋克 2077》极短的 `<100ms` UI 微交互音（如悬停微滴、开关切换、欧元跳动、全息来电铃声）在原版归档中封于 `.bnk` / `.opuspak`，不在已解包的流式 `.wem` 中；对该类极短微交互音以及未执行 `pnpm pick-assets` 时的兜底，采用风格贴合赛博朋克 2077 的低延迟 Web Audio 合成层补齐。
   - 音频加载或解码失败时绝不阻塞页面、不抛致命报错，静默降级以保证核心游玩流程稳定。
3. **克制、耐听、不扰民**：
   - 严格遵守浏览器自动播放策略：首次用户交互（点击/按键/触摸）自动解锁 `AudioContext` 并柔和淡入 BGM。
   - 页面切至后台时自动柔隐暂停，切回时平滑恢复；打开设置、Esc 菜单、弹窗或正文中播放内嵌 `<audio>` 媒体时，BGM 自动闪避（Ducking）。
   - 不改动剧情主界面既有的四角 HUD 布局与样式；完整音频控制台放在「设置 → 音频」分页，并在 Esc 菜单与全局快捷键 `Alt+M` 提供一键静音切换。

## 2. 原版素材清单（经逐轨试听核验）

### 2.1 背景音乐（BGM，全部来自原版 `audio_sfx_ogg_music/`）

| 语义 ID | 源文件名 | 场景用途 | 风格说明 |
| --- | --- | --- | --- |
| `bgm.menu` | `749435057.ogg` | 主菜单 / 启动后 | 原版标志性主菜单主题曲（V 主题） |
| `bgm.creator` | `117878362.ogg` | 角色档案 / 捏人工作台 | 原版主菜单/捏人界面深邃氛围合成器 |
| `bgm.explore` | `197902573.ogg` | 夜之城日常探索（深色/夜间） | 低沉黑色电影感夜之城氛围铺底 |
| `bgm.explorePulse` | `1040680541.ogg` | 夜之城探索（高热/活跃街区交替） | 暗色赛博脉冲节拍氛围，避免长局单调 |
| `bgm.stealth` | `69302628.ogg` | 潜入警戒（`stealth.level >= 1`） | 紧张工业低频潜行配乐 |
| `bgm.netrun` | `541807988.ogg` | 潜网 / 追踪告警 / 超梦 / 赛博精神病发作 | 深沉脉冲数字张力配乐 |
| `bgm.combat` | `656812047.ogg` | 交火战斗（`combat.active` / `stealth.level >= 3`） | 纯器乐高能工业电子战斗配乐 |
| `bgm.safehouse` | `405592512.ogg` | 安全屋休息 | 温暖银翼杀手质感宽广合成器铺垫 |
| `bgm.ending` | `17832273.ogg` | 角色死亡 / 故事落幕 | 沉静克制的弦乐/合成器终章配乐 |

### 2.2 音效（SFX，原版 `audio_sfx_ogg/` 优先）

| 语义 ID | 源文件名 | 裁剪/处理 | 用途 |
| --- | --- | --- | --- |
| `sfx.boot` | `572908611.ogg` | 0–2.6s + 淡出 | 启动画面故障唤醒音 |
| `sfx.click` | `1029072525.ogg` | 原长 0.17s | 通用机械/触感点击 |
| `sfx.data` | `21503561.ogg` | 0–0.7s + 淡出 | 神经终端发送 / 数据传输确认 |
| `sfx.panel` | `133473450.ogg` | 0–0.65s + 淡出 | 重型面板/终端开启闭锁 |
| `sfx.notify` | `486881345.ogg` | 0–2.0s + 淡出 | 新消息 / 回合完成 / 一般通知 |
| `sfx.scan` | `333447428.ogg` | 0–1.6s + 淡出 | 岐路司扫描开启 / 潜网终端 |
| `sfx.quest` | `306847309.ogg` | 原长 2.05s | 委托结算 / 宿敌了结标志性电吉他 stinger |
| `sfx.warning` | `243532491.ogg` | 原长 1.41s | 交战触发 / 危险告警 / 重伤与负面弹窗 |
| `sfx.heartbeat` | `107694433.ogg` | 原长 0.74s | 低频脉动 / 临界压迫感 |
| `sfx.sandevistan` | `513553115.ogg` | 原长 3.54s | 斯安威斯坦启动时缓重低音冲击 |
| `sfx.cyberware` | `128060733.ogg` | 0–2.8s + 淡出 | 义体医生安装/修复义体 |
| `sfx.glitch` | `59558242.ogg` | 0–1.8s + 淡出 | Relic 故障 / 赛博精神病发作失真 |
| `sfx.farewell` | `675155804.ogg` | 0–3.2s + 淡出 | 故事落幕 / 死亡柔和钢琴和弦 |

### 2.3 Web Audio 微交互补齐（非侵入、低音量、可关闭悬停音）

- `hover`：25ms 轻触高频数字微滴（带 45ms 节流与轻微音高起伏，可在设置中关闭）
- `tab`：55ms 利落页签切换棘轮音
- `toggleOn` / `toggleOff`：双音阶赛博开关启闭提示
- `cancel` / `panelClose`：柔和下行闭合音
- `error`：低沉双脉冲拒绝提示
- `eddies`：清脆欧元入账/扣款电子计数音
- `holocall`：标志性双脉冲全息来电提示音

## 3. 实施步骤

1. **步骤 1（规划文档）**：创建并提交本计划文档 `docs/plans/game-audio-system.md`。
2. **步骤 2（原版音频素材清单与构建链路）**：
   - 新增 `tools/assets/audio-manifest.json` 与 `tools/assets/audio.ts`。
   - 扩展 `tools/assets/pick.ts`（同时兼容 Windows 与 WSL 默认解包路径）与 `tools/assets/check.ts`，生成 `apps/web/public/assets/local/audio/index.json`、转码裁剪后的原版音频文件以及 `apps/web/src/assets/audio-ids.gen.ts`。
   - 运行 `pnpm pick-assets` 与 `pnpm check-assets` 验证原版素材全部提取通过。
3. **步骤 3（前端音频引擎与偏好存储）**：
   - 在 `apps/web/src/assets/index.ts` 中加载 `audio/index.json`（缺失时安全降级，不阻塞启动），统一出口管理 `audioAssetUrl()`。
   - 创建 `apps/web/src/audio/`：
     - `prefs.ts`：本地音频偏好（主静音、总音量、BGM 开关/音量、SFX 开关/音量、悬停音效开关）。
     - `synth.ts`：赛博风格 Web Audio 微交互与兜底合成器。
     - `engine.ts`：双轨 BGM 等功率交叉淡入淡出引擎（含自动解锁、后台暂停、闪避 Ducking、当前曲目订阅）+ Web Audio `AudioBuffer` 低延迟 SFX 播放与缓冲缓存。
     - `director.ts`：路由与剧情 `View` 状态驱动的自适应 BGM 决策器。
     - `index.ts`：对外统一 API、React Hooks 与全局 `Alt+M` 静音监听。
4. **步骤 4（全界面交互与剧情事件音效接入）**：
   - 接入 `Shell`（全局路由 BGM 导演、首次交互解锁、全局 `Alt+M`、内嵌 `<audio>` 播放闪避）。
   - 接入通用 UI 组件：`Button`、`MenuItem`、`ActionButton`、`ToggleCheck`、`Dialog`、`PinTabs`。
   - 接入 `Splash`（启动音）、`StoryScreen` & `store.ts`（自适应场景 BGM、交火/来电/通知/委托结算/斯安威斯坦/扫描/商店交易/义体安装/赛博精神病故障/落幕/面板开合音效）。
5. **步骤 5（音频设置面板与快捷控制）**：
   - 新增 `apps/web/src/features/settings/AudioSettings.tsx`，在 `SettingsScreen` 中增加「音频」分页，支持音量滑条、分项开关、当前播放状态显示与原版配乐/音效一键试听。
   - 在 `EscMenu` 中增加快捷静音项；在 `MainMenu` 底部状态栏增加轻量音频静音开关。
6. **步骤 6（静态检查与收口）**：
   - 执行 `pnpm typecheck`、`pnpm lint`、`pnpm check-assets`、`pnpm build` 验证零类型与规范错误。
   - 更新本计划文档状态为「已完成」并提交。
