/**
 * 主菜单右侧更新日志数据源（最新在前）。
 * 每次版本迭代在此追加记录即可自动展示在主菜单右侧「更新日志」面板。
 */

export type ChangelogTag = "新增" | "优化" | "重构" | "修复";

export interface ChangelogItem {
  readonly tag: ChangelogTag;
  readonly text: string;
}

export interface ChangelogEntry {
  readonly version: string;
  readonly date: string;
  readonly title: string;
  readonly latest?: boolean;
  readonly items: readonly ChangelogItem[];
}

export const CHANGELOG_ENTRIES: readonly ChangelogEntry[] = [
  {
    version: "v0.9.6",
    date: "2026-11-22",
    title: "终端视觉、音频系统与地图交互升级",
    latest: true,
    items: [
      {
        tag: "新增",
        text: "上线双轨交叉淡入淡出 BGM 引擎、全界面阻尼微动音效与设置页原版曲目试听。",
      },
      {
        tag: "新增",
        text: "正文与开场序幕的地名/街区支持点击跳转大地图并自动放大聚焦，强化玩家当前位置荧光定位标记。",
      },
      {
        tag: "新增",
        text: "重构展开态追踪面板为独立 TrackerPanel，HUD 卡片改为点击展开；主菜单新增右侧更新日志面板。",
      },
      {
        tag: "新增",
        text: "全新赛博终端式剧情输入栏，接入 2077 原作 itemCell 壳体、轻透光学玻璃质感与按存档保存草稿。",
      },
      {
        tag: "优化",
        text: "升级全息电话消息终端、N54 新闻流与商店双视图展柜，重做 3D 卡片压感与按压下沉反馈。",
      },
      {
        tag: "修复",
        text: "修复交易打点示好事件与思维链折叠展示，完善损坏或不兼容存档的提示信息。",
      },
    ],
  },
  {
    version: "v0.9.5",
    date: "2026-11-22",
    title: "分层预载、设置工作台与叙事稳定性修复",
    items: [
      {
        tag: "优化",
        text: "上线四级优先级素材预载调度器与地图瓦片预热，显著减少切页和开档等待。",
      },
      {
        tag: "优化",
        text: "全面重做设置界面：模型状态槽位、酒馆预设工作台、双栏叙事偏好与上下文预算调试。",
      },
      {
        tag: "修复",
        text: "放宽叙事正文输出上限预留并规范行动选项生成，修复长回合截断与选项缺失问题。",
      },
    ],
  },
  {
    version: "v0.9.4",
    date: "2026-11-21",
    title: "2077 世界线校准与夜之城演化引擎",
    items: [
      {
        tag: "新增",
        text: "落地双路并行场外世界演化引擎、四维触发器与城中局势账本，让夜之城随时间持续流动。",
      },
      {
        tag: "新增",
        text: "校准 2077-04-12 十阶段世界时间线，扩充 48 名预设 NPC 与 56 组双向人物关系网。",
      },
      {
        tag: "修复",
        text: "严格校验网络接入仓与芯片硬件条件，完善常规 NPC 基础义体配置与别名容错。",
      },
    ],
  },
  {
    version: "v0.9.3",
    date: "2026-11-20",
    title: "夜之城大地图、背包统一与纯前端静态化",
    items: [
      {
        tag: "新增",
        text: "大地图支持检索、镜头聚焦、路线标线与旅途风险提示，并联动世界局势事件。",
      },
      {
        tag: "重构",
        text: "合并随身物品与容器储物为统一面板，新增 NPC 结构化穿搭与日常物品。",
      },
      {
        tag: "重构",
        text: "迁移至纯前端静态架构，存档、角色卡与模型密钥全部本地 IndexedDB 持久化管理。",
      },
    ],
  },
];
