import { useEffect } from "react";
import { createHashRouter, Navigate, Outlet } from "react-router";
import { useRoutePreload } from "./assets/usePreload";
import { CharactersScreen } from "./features/characters/CharactersScreen";
import { Calibrate } from "./features/dev/Calibrate";
import { NeuralMock } from "./features/dev/NeuralMock";
import { MainMenu } from "./features/menu/MainMenu";
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

function Shell() {
  const busy = useStory((s) => s.phase !== "idle");
  useRoutePreload(busy);
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
