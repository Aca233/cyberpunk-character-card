// 由 tools/assets/pick.ts 按 tools/assets/audio-manifest.json 生成，不要手改
export const BGM_IDS = [
  "bgm.menu",
  "bgm.creator",
  "bgm.explore",
  "bgm.explorePulse",
  "bgm.stealth",
  "bgm.netrun",
  "bgm.combat",
  "bgm.safehouse",
  "bgm.ending",
] as const;
export type BgmId = (typeof BGM_IDS)[number];

export const SFX_ASSET_IDS = [
  "sfx.boot",
  "sfx.click",
  "sfx.data",
  "sfx.panel",
  "sfx.notify",
  "sfx.scan",
  "sfx.quest",
  "sfx.warning",
  "sfx.heartbeat",
  "sfx.sandevistan",
  "sfx.cyberware",
  "sfx.glitch",
  "sfx.farewell",
] as const;
export type SfxAssetId = (typeof SFX_ASSET_IDS)[number];

export const AUDIO_ASSET_IDS = [...BGM_IDS, ...SFX_ASSET_IDS] as const;
export type AudioAssetId = (typeof AUDIO_ASSET_IDS)[number];

export const AUDIO_LABELS: Readonly<Record<AudioAssetId, string>> = {
  "bgm.combat": "交火 · 街头混战",
  "bgm.creator": "角色档案 · 神经静默",
  "bgm.ending": "终章 · 渐远余晖",
  "bgm.explore": "夜之城 · 暗夜漫游",
  "bgm.explorePulse": "夜之城 · 霓虹脉动",
  "bgm.menu": "主菜单 · V（原版主题）",
  "bgm.netrun": "潜网 · 神经边界",
  "bgm.safehouse": "安全屋 · 霓虹余温",
  "bgm.stealth": "潜入 · 暗影警戒",
  "sfx.boot": "系统启动唤醒",
  "sfx.click": "界面触感点击",
  "sfx.cyberware": "义体植入校准",
  "sfx.data": "神经终端发送",
  "sfx.farewell": "终章落幕和弦",
  "sfx.glitch": "神经故障失真",
  "sfx.heartbeat": "低频神经脉动",
  "sfx.notify": "系统与消息提示",
  "sfx.panel": "终端面板开启",
  "sfx.quest": "委托与宿敌结算",
  "sfx.sandevistan": "斯安威斯坦启动",
  "sfx.scan": "岐路司扫描启动",
  "sfx.warning": "危险与交战告警",
};
