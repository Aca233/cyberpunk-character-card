# 地点背景图接入计划

## 目标
在剧情主界面（[StoryScreen.tsx](file:///c:/cyberpunk-character-card/apps/web/src/features/story/StoryScreen.tsx)）的 [CityBackdrop](file:///c:/cyberpunk-character-card/apps/web/src/features/story/CityBackdrop.tsx) 中，根据玩家当前所在地点与时段动态切换对应的原作实景 / 地点概念背景图，保留原有的暗化遮罩、缓慢推近、故障与斯安威斯坦滤镜，不改动任何布局或面板样式。

## 方案

### 步骤 1：补充地点与城区素材清单
- 在 [tools/assets/manifest.json](file:///c:/cyberpunk-character-card/tools/assets/manifest.json) 新增 `backdrop` 分组，纳入本地解包目录中的原作地点图与 4K 街景图（涵盖 15 个固定地点、夜之城 8 大城区及主要街区/地标，并在沃森主要片区区分昼夜 `dc`/`nc`）。
- 运行 `pnpm pick-assets --source "C:\Cyberpunk 2077\_unpack"` 重新生成 `public/assets/local/ui/` 与 [ids.gen.ts](file:///c:/cyberpunk-character-card/apps/web/src/assets/ids.gen.ts)，并用 `pnpm check-assets` 校验素材完整性。

### 步骤 2：实现地点 → 背景图解析与平滑切换
- 在 [apps/web/src/features/story/art.ts](file:///c:/cyberpunk-character-card/apps/web/src/features/story/art.ts) 新增 `backdropOf({ location, locationName, district, period })` 纯函数：
  1. 优先精确匹配固定地点 ID（`lizzies-bar`、`afterlife`、`kabuki-market`、`megabuilding-h10`、`vik-clinic`、`tom-diner`、`japantown`、`coyote-cojo`、`corpo-plaza`、`grand-imperial-mall`、`dogtown`、`regina-office`、`wakako-pachinko`、`kerry-estate`、`badlands`）。
  2. 其次按地点 ID / 地点名称关键词匹配细分街区或知名地标（如歌舞伎区、小唐人街、北区、荒坂海滨、扭扭街、宪章山、北橡区、市中心、谷地区、美泉区、丽景区、河谷区、科罗纳多农场、海景区、西风庄园、荒坂塔、绀碧大厦、全食品、太平洲教堂、地铁站、油田、流浪者营地等），支持动态新地点与服务点/地标匹配。
  3. 其次按所在城区（`district`）兜底。
  4. 未匹配时回退至默认夜之城全景 `menu.nightCity`。
- 更新 [CityBackdrop.tsx](file:///c:/cyberpunk-character-card/apps/web/src/features/story/CityBackdrop.tsx)、[StoryScreen.tsx](file:///c:/cyberpunk-character-card/apps/web/src/features/story/StoryScreen.tsx) 与 [story.module.css](file:///c:/cyberpunk-character-card/apps/web/src/features/story/story.module.css)：
  - 传入当前地点、名称、城区与时段；
  - 当背景图切换时，通过双层淡入（cross-fade）过渡，避免生硬闪烁，并尊重 `prefers-reduced-motion`。

### 步骤 3：静态检查与收尾
- 执行 `pnpm typecheck` 与 `pnpm lint`（按项目约定，测试交由用户自行执行）。
- 同步更新本计划状态并按步骤执行 `git` 提交。

## 状态
- [x] 步骤 0：制定并保存计划文档
- [ ] 步骤 1：更新素材清单并执行 `pick-assets` / `check-assets`
- [ ] 步骤 2：实现 `backdropOf` 与 `CityBackdrop` 地点切换
- [ ] 步骤 3：静态类型与代码规范检查
