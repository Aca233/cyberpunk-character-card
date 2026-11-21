import { useEffect, useRef } from "react";
import {
  playSfx,
  rememberStoryBgm,
  resolveStoryBgm,
  setAudioDuck,
  setBgmTarget,
} from "../../audio";
import type { Toast, View } from "./view";

interface StoryAudioParams {
  readonly saveId: string;
  readonly view: View | undefined;
  readonly atEsc: boolean;
  readonly overlayOpen: boolean;
  readonly scan: boolean;
  readonly settledCount: number;
  readonly rivalsCount: number;
  readonly latestToasts: readonly Toast[];
}

/**
 * 剧情界面自适应音频控制器：
 * - 根据实时局势切换原版《赛博朋克 2077》配乐（探索 / 潜入 / 潜网 / 交火 / 安全屋 / 终章）。
 * - 监听状态跃迁与面板操作，在恰当时机触发原版音效（不干扰首屏加载与读档）。
 */
export function useStoryAudio({
  saveId,
  view,
  atEsc,
  overlayOpen,
  scan,
  settledCount,
  rivalsCount,
  latestToasts,
}: StoryAudioParams): void {
  const prevViewRef = useRef<{ saveId: string; view: View } | null>(null);
  const prevOverlayRef = useRef(overlayOpen);
  const prevScanRef = useRef(scan);
  const prevSettledRef = useRef(settledCount + rivalsCount);
  const prevToastKeyRef = useRef<string | null>(null);

  // 1. 自适应场景 BGM
  useEffect(() => {
    const bgm = resolveStoryBgm(view);
    rememberStoryBgm(bgm);
    setBgmTarget(bgm);
  }, [view]);

  // 2. Esc 菜单与全息来电闪避压低 BGM
  const incomingCall = Boolean(view?.calls.incoming);
  useEffect(() => {
    setAudioDuck("esc", atEsc);
    return () => setAudioDuck("esc", false);
  }, [atEsc]);

  useEffect(() => {
    setAudioDuck("holocall", incomingCall);
    return () => setAudioDuck("holocall", false);
  }, [incomingCall]);

  // 3. 剧情状态跃迁触发原版音效
  useEffect(() => {
    if (!view) return;
    const prevEntry = prevViewRef.current;
    prevViewRef.current = { saveId, view };
    if (!prevEntry || prevEntry.saveId !== saveId) return;
    const prev = prevEntry.view;

    // 优先级最高的重大事件（避免一轮内多个低频音效重叠糊成一团）
    if ((!prev.death && view.death) || (!prev.ended && view.ended)) {
      playSfx("farewell");
      return;
    }
    if (!prev.combat.active && view.combat.active) {
      playSfx("warning");
    } else if (
      (!prev.psychosis.episodeHere && view.psychosis.episodeHere) ||
      (!prev.psychosis.blackoutOpen && view.psychosis.blackoutOpen)
    ) {
      playSfx("glitch");
    } else if (view.stealth.level > prev.stealth.level) {
      playSfx(view.stealth.level >= 3 ? "warning" : "heartbeat");
    }

    if (view.calls.incoming && view.calls.incoming.id !== prev.calls.incoming?.id) {
      playSfx("holocall");
    } else if (view.phone.unread > prev.phone.unread) {
      playSfx("notify");
    }

    if (view.cyberware.length !== prev.cyberware.length) {
      playSfx("cyberware");
    } else if (view.money.eddies !== prev.money.eddies) {
      playSfx("eddies");
    }
  }, [saveId, view]);

  // 4. 委托结算与宿敌了结卡出现时播放原版电吉他结算音
  useEffect(() => {
    const total = settledCount + rivalsCount;
    if (total > prevSettledRef.current) {
      playSfx("quest");
    }
    prevSettledRef.current = total;
  }, [settledCount, rivalsCount]);

  // 5. 负面告警通知（负伤、热度攀升、系统错误）补强提示音
  useEffect(() => {
    const newest = latestToasts.at(-1);
    if (!newest) {
      prevToastKeyRef.current = null;
      return;
    }
    if (newest.key !== prevToastKeyRef.current) {
      prevToastKeyRef.current = newest.key;
      if (newest.tone === "bad") {
        playSfx("warning");
      } else {
        playSfx("notify");
      }
    }
  }, [latestToasts]);

  // 6. 岐路司扫描开启音
  useEffect(() => {
    if (scan && !prevScanRef.current) {
      playSfx("scan");
    }
    prevScanRef.current = scan;
  }, [scan]);

  // 7. 重型浮层/终端开关音（地图、商店、义体医生、好车中间人、人物档案、Esc 菜单）
  useEffect(() => {
    if (overlayOpen !== prevOverlayRef.current) {
      playSfx(overlayOpen ? "panelOpen" : "panelClose");
      prevOverlayRef.current = overlayOpen;
    }
  }, [overlayOpen]);
}
