import { createBrowserRouter, Outlet } from "react-router";
import { MainMenu } from "./features/menu/MainMenu";
import { SettingsScreen } from "./features/settings/SettingsScreen";
import { Splash } from "./features/splash/Splash";
import { FanNotice, MissingAssetsAlert, RouteError } from "./features/status/StatusParts";
import { StoryScreen } from "./features/story/StoryScreen";

function Shell() {
  return (
    <>
      <Outlet />
      <MissingAssetsAlert />
      <FanNotice />
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
      { path: "/play/:saveId", element: <StoryScreen /> },
      { path: "/settings", element: <SettingsScreen /> },
    ],
  },
]);
