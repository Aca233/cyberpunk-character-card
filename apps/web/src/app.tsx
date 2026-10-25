import { createBrowserRouter, Outlet } from "react-router";
import { CharactersScreen } from "./features/characters/CharactersScreen";
import { Calibrate } from "./features/dev/Calibrate";
import { MainMenu } from "./features/menu/MainMenu";
import { SettingsScreen } from "./features/settings/SettingsScreen";
import { SpoilerBadge } from "./features/settings/SpoilerBadge";
import { Splash } from "./features/splash/Splash";
import { FanNotice, MissingAssetsAlert, RouteError } from "./features/status/StatusParts";
import { StoryScreen } from "./features/story/StoryScreen";

function Shell() {
  return (
    <>
      <Outlet />
      <MissingAssetsAlert />
      <FanNotice />
      <SpoilerBadge />
    </>
  );
}

export const router = createBrowserRouter([
  {
    element: <Shell />,
    errorElement: <RouteError />,
    children: [
      { path: "/", element: <Splash /> },
      { path: "/menu", element: <MainMenu /> },
      { path: "/characters", element: <CharactersScreen /> },
      { path: "/play/:saveId", element: <StoryScreen /> },
      { path: "/settings", element: <SettingsScreen /> },
      // 开发用的地图校准页：只在 pnpm dev 下有
      ...(import.meta.env.DEV ? [{ path: "/dev/calibrate", element: <Calibrate /> }] : []),
    ],
  },
]);
