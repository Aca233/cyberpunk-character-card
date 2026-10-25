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
import { router } from "./app";
import { loadAssetIndex } from "./assets";
import { installGameCursor } from "./assets/cursor";
import { FatalScreen } from "./features/status/FatalScreen";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

const root = createRoot(document.getElementById("root") as HTMLElement);
const loaded = await loadAssetIndex();
// 不等指针拼完：拼好之前先用系统指针
if (loaded.ok) void installGameCursor();
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
