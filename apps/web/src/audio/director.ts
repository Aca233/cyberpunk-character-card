import type { BgmId } from "../assets";
import type { View } from "../features/story/view";

/**
 * 自适应场景配乐导演：
 * 按路由与实时剧情状态（死亡/落幕 > 交火战斗 > 潜网/超梦/赛博精神病 > 潜入警戒 > 安全屋 > 夜之城探索）
 * 选择最贴合当前氛围的原版《赛博朋克 2077》配乐。
 */

let lastStoryBgm: BgmId | null = null;

export function rememberStoryBgm(bgm: BgmId | null): void {
  lastStoryBgm = bgm;
}

export function getLastStoryBgm(): BgmId | null {
  return lastStoryBgm;
}

function isNightOrLate(time: View["time"]): boolean {
  if (time.phase === 3) return true;
  const m = time.text.match(/(\d{1,2}):\d{2}/);
  if (!m) return false;
  const hour = Number(m[1]);
  return hour >= 20 || hour < 5;
}

export function resolveStoryBgm(view: View | undefined): BgmId {
  if (!view) return "bgm.explore";

  // 1. 死亡或故事终章
  if (view.death !== null || view.ended !== null) {
    return "bgm.ending";
  }

  // 2. 交火战斗 / 最高警戒
  if (view.combat.active !== null || view.stealth.level >= 3) {
    return "bgm.combat";
  }

  // 3. 潜网深入 / 反向追踪告警 / 超梦调查 / 赛博精神病发作或断片
  const inNetrun =
    (view.hacking?.dive !== null && view.hacking?.dive !== undefined) ||
    (view.hacking?.traceAlert !== null && view.hacking?.traceAlert !== undefined);
  const inBraindance = view.braindance.active !== null;
  const inPsychosis = view.psychosis.episodeHere || view.psychosis.blackoutOpen;
  if (inNetrun || inBraindance || inPsychosis) {
    return "bgm.netrun";
  }

  // 4. 潜入警戒（起疑 / 搜索）
  if (view.stealth.level >= 1) {
    return "bgm.stealth";
  }

  // 5. 处于自己可用安全屋内
  const atSafehouse = view.safehouse.homes.some((h) => h.here && !h.locked);
  if (atSafehouse) {
    return "bgm.safehouse";
  }

  // 6. 夜之城探索：依据警方热度、深夜时段与场次交替选用两支原版氛围曲，兼顾层次感与耐听度
  const highTensionCity = view.heat.stars >= 2 || (isNightOrLate(view.time) && view.scene % 2 === 1);
  return highTensionCity ? "bgm.explorePulse" : "bgm.explore";
}

export function resolveRouteBgm(pathname: string): {
  readonly bgm: BgmId | null;
  readonly duckSettings: boolean;
} {
  if (pathname === "/") {
    return { bgm: null, duckSettings: false };
  }
  if (pathname.startsWith("/characters")) {
    return { bgm: "bgm.creator", duckSettings: false };
  }
  if (pathname.startsWith("/settings")) {
    return { bgm: lastStoryBgm ?? "bgm.menu", duckSettings: true };
  }
  if (pathname.startsWith("/play/")) {
    return { bgm: lastStoryBgm ?? "bgm.explore", duckSettings: false };
  }
  return { bgm: "bgm.menu", duckSettings: false };
}
