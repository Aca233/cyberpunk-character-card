import "@fontsource/rajdhani/400.css";
import "@fontsource/rajdhani/500.css";
import "@fontsource/rajdhani/600.css";
import "@fontsource/rajdhani/700.css";
import "@fontsource-variable/noto-sans-sc";
import "./styles/tokens.css";
import "./styles/global.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";
import { warmLocalBackend } from "./api/transport";
import { router } from "./app";
import { loadAssetIndex } from "./assets";
import { installGameCursor } from "./assets/cursor";
import { preloadBootAssets } from "./assets/preload";
import { warmInitialQueries } from "./assets/usePreload";
import { FatalScreen } from "./features/status/FatalScreen";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

const root = createRoot(document.getElementById("root") as HTMLElement);
const loaded = await loadAssetIndex();
// 启动期并行预热：自绘指针、主菜单与通用 UI 骨架素材、本地后端 chunk 及首屏查询缓存
if (loaded.ok) {
  void installGameCursor();
  void preloadBootAssets();
  warmLocalBackend();
  warmInitialQueries(queryClient);
}
root.render(
  <StrictMode>
    {loaded.ok ? (
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    ) : (
      <FatalScreen title="素材没有就绪" message={loaded.error} />
    )}
  </StrictMode>,
);
