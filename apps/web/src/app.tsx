import { useEffect } from "react";
import { createHashRouter, Navigate, Outlet, useLocation } from "react-router";
import { useRoutePreload } from "./assets/usePreload";
import {
  clearBgmPreview,
  playSfx,
  rememberStoryBgm,
  resolveRouteBgm,
  setAudioDuck,
  setBgmTarget,
  setThemeBgmOverride,
  toggleMute,
} from "./audio";
import { CharactersScreen } from "./features/characters/CharactersScreen";
import { Calibrate } from "./features/dev/Calibrate";
import { NeuralMock } from "./features/dev/NeuralMock";
import { MainMenu } from "./features/menu/MainMenu";
import { useNarrativePrefs } from "./features/settings/prefs";
import { SettingsScreen } from "./features/settings/SettingsScreen";
import { SpoilerBadge } from "./features/settings/SpoilerBadge";
import { Splash } from "./features/splash/Splash";
import {
  FanNotice,
  MissingAssetsAlert,
  RouteError,
  TabNotice,
} from "./features/status/StatusParts";
import { StoryScreen } from "./features/story/StoryScreen";
import { useStory } from "./features/story/store";
import { themeById, useShellTheme } from "./features/theme";

function isShellThemedPath(path: string): boolean {
  return path === "/menu" || path.startsWith("/settings") || path.startsWith("/characters");
}

function Shell() {
  const location = useLocation();
  const busy = useStory((s) => s.phase !== "idle");
  const { effectiveId: shellThemeId } = useShellTheme();
  const { storyTheme } = useNarrativePrefs();
  useRoutePreload(busy);

  // 外壳主题配色与专属配乐：主题配乐仅在主菜单等非局内外壳界面播放，进入局内剧情一律使用原版自适应场景配乐
  useEffect(() => {
    const root = document.documentElement;
    const isShell = isShellThemedPath(location.pathname);
    const applyTheme = isShell || (storyTheme && location.pathname.startsWith("/play/"));
    const spec = themeById(shellThemeId);
    if (applyTheme && shellThemeId !== "night-city") {
      root.dataset.shellTheme = shellThemeId;
    } else {
      delete root.dataset.shellTheme;
    }
    setThemeBgmOverride(isShell && spec.bgm ? spec.bgm : null);
    return () => {
      delete root.dataset.shellTheme;
    };
  }, [location.pathname, shellThemeId, storyTheme]);

  // 路由级 BGM 调度与设置页闪避；剧情内场景音乐由 StoryScreen 实时细化接管
  useEffect(() => {
    const path = location.pathname;
    if (!path.startsWith("/settings")) {
      clearBgmPreview();
    }
    if (path === "/menu" || path === "/") {
      rememberStoryBgm(null);
    }
    const { bgm, duckSettings } = resolveRouteBgm(path);
    setAudioDuck("settings", duckSettings);
    if (!path.startsWith("/play/")) {
      setBgmTarget(bgm);
    }
  }, [location.pathname]);

  // 全局快捷静音：Alt+M（不与单键地图 M 或输入法冲突）
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey && !event.ctrlKey && !event.metaKey && event.key.toLowerCase() === "m") {
        event.preventDefault();
        const muted = toggleMute();
        if (!muted) playSfx("toggleOn");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // 回合在内存中继续运行，切到设置后刷新或关闭页面也需要提醒。
  useEffect(() => {
    if (!busy) return;
    const warnLeave = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnLeave);
    return () => window.removeEventListener("beforeunload", warnLeave);
  }, [busy]);

  return (
    <>
      <Outlet />
      <MissingAssetsAlert />
      <FanNotice />
      <SpoilerBadge />
      <TabNotice />
    </>
  );
}

const routes = [
  {
    element: <Shell />,
    errorElement: <RouteError />,
    children: [
      { path: "/", element: <Splash /> },
      { path: "/menu", element: <MainMenu /> },
      { path: "/characters", element: <CharactersScreen /> },
      { path: "/play/:saveId", element: <StoryScreen /> },
      { path: "/settings", element: <SettingsScreen /> },
      // 创意工坊尚未完成，暂不启用
      { path: "/workshop", element: <Navigate to="/menu" replace /> },
      // 开发用的页：地图校准、U0 神经界面视觉稿，只在 pnpm dev 下有
      ...(import.meta.env.DEV
        ? [
            { path: "/dev/calibrate", element: <Calibrate /> },
            { path: "/dev/neural", element: <NeuralMock /> },
          ]
        : []),
    ],
  },
];

/** 纯静态网站使用 hash 路由（#/menu）：静态托管刷新任意子路径都不会 404 */
export const router = createHashRouter(routes);
