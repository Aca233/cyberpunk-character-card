# 正文地名跳转地图与玩家位置高亮优化计划

## 目标与需求

1. **正文地名点击跳转地图并放大**：
   - 正文内提及的夜之城地点（固定地点、存档地点、原作命名服务点/地标/地铁站、玩家安全屋、常见别名及无空格写法）以及城区/街区名均可点击跳转到地图对应位置。
   - 跳转后地图自动放大到足够看清街道与周边图钉的倍率（具体地点 `4.0×`，街区 `3.0×`，城区 `2.2×`），而非原先偏小的 `1.6×`。
   - 过滤未到访服务点的泛称（如“酒保”“商贩”“义体医生”等），避免普通旁白误标。
   - 增强正文地名（含台词内）的可点击视觉提示（微弱虚线下划线，悬停实线）。
2. **提升玩家当前位置标记的辨识度**：
   - 提高当前位置标记层级（置于其他图钉与徽章之上、浮层面板之下），避免被周边地点、委托、NPC 与警情图标遮挡。
   - 增强视觉结构：高对比度暗底荧光绿准星圆环底座 + 放大发光玩家箭头 + 更大范围呼吸雷达波 + 醒目的「当前位置」霓虹徽章与常驻金色地名牌。
3. **点击跳转玩家位置时放大地图**：
   - 地图顶栏「当前位置」按钮及当前位置文字点击后，统一居中并放大至 `FOCUS_ZOOM`（`4.0×`，若已高于该倍率则保持），自动取消图例对“当前位置”的隐藏，并触发一次定位扩散波反馈。

## 涉及文件

- `apps/web/src/features/story/mapCamera.ts`：新增 `FOCUS_ZOOM`、`SUB_AREA_ZOOM`、`DISTRICT_AREA_ZOOM` 常量。
- `apps/web/src/features/story/view.ts`：扩展 `Speaker` 支持 `area`（城区/街区），完善 `speakersOf` 地名识别、别名派生、安全屋映射与泛称过滤。
- `apps/web/src/features/story/StoryLog.tsx`：支持 `area` 类地名点击渲染，并为开场序幕、局势感知（`view.offers.read`）与断点预览透传 `onMark`。
- `apps/web/src/features/story/OpeningGuide.tsx`：开场序幕中的当前地点名与在场人物改为可点击行内标记，点击地点直接跳转地图并放大聚焦当前位置。
- `apps/web/src/features/story/StoryScreen.tsx`：将 `mapFocus` 升级为带 `nonce` 的联合类型 `MapFocus`，统一正文地点/区域点击与通讯/追踪定位。
- `apps/web/src/features/story/MapPanel.tsx`：适配 `MapFocus`（含地点与区域聚焦高亮）、放大跳转倍率、强化「当前位置」定位按钮与点击响应、增强玩家标记 DOM 结构。
- `apps/web/src/features/story/story.module.css`：优化地名行内可点样式、玩家位置高对比度灯塔样式与定位波动画、区域聚焦高亮与浮层 z-index 层级。

## 实施状态

- [x] 更新 `mapCamera.ts` 缩放常量（`FOCUS_ZOOM = 4.0`、`SUB_AREA_ZOOM = 3.0`、`DISTRICT_AREA_ZOOM = 2.2`）
- [x] 更新 `view.ts` 地名与城区/街区匹配
- [x] 更新 `StoryLog.tsx` 与 `StoryScreen.tsx` 跳转链路
- [x] 更新 `MapPanel.tsx` 与 `story.module.css` 聚焦、放大与玩家位置高亮
- [x] 运行静态类型检查、Biome 校验、数据校验与构建确认
