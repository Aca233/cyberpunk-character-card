import { createBrowserRouter, createHashRouter, Outlet } from "react-router";
import { LOCAL_MODE } from "./api/transport";
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

function Shell() {
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

/**
 * 纯前端版用 hash 路由（#/menu）：静态托管刷新子页面时只认根目录的 index.html，用 hash 就不会 404；
 * 服务器版照旧用普通路由，basename 跟着构建的 base 走
 */
export const router = LOCAL_MODE
  ? createHashRouter(routes)
  : createBrowserRouter(routes, {
      basename: import.meta.env.BASE_URL.replace(/\/$/, "") || "/",
    });
