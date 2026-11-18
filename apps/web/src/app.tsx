import { createHashRouter, Outlet } from "react-router";
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

/** 纯静态网站使用 hash 路由（#/menu）：静态托管刷新任意子路径都不会 404 */
export const router = createHashRouter(routes);
