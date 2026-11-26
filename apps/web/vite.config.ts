import react from "@vitejs/plugin-react";
import { type Connect, defineConfig, type Plugin } from "vite";
import { handleRelay } from "../../functions/api/proxy";

/**
 * 站点根路径：本机和 Cloudflare Pages 是 /；GitHub Pages 的项目站点在 /仓库名/ 下，
 * 构建时用 CP_BASE=/仓库名/ 指定（前后都要有斜杠）
 */
const BASE = process.env.CP_BASE ?? "/";

/** 开发和预览时提供与线上一致的 /api/proxy 转发（线上是 functions/api/proxy.ts） */
function relayDevPlugin(): Plugin {
  const middleware: Connect.NextHandleFunction = (req, res, next) => {
    if (!req.url?.startsWith("/api/proxy")) return next();
    const origin = `http://${req.headers.host ?? "127.0.0.1"}`;
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
      if (Array.isArray(value)) for (const v of value) headers.append(name, v);
      else if (value !== undefined) headers.set(name, value);
    }
    const hasBody = req.method !== "GET" && req.method !== "HEAD";
    const request = new Request(`${origin}/api/proxy`, {
      method: req.method ?? "GET",
      headers,
      body: hasBody ? (req as unknown as RequestInit["body"]) : null,
      ...(hasBody ? { duplex: "half" } : {}),
    } as RequestInit);
    handleRelay(request)
      .then(async (out) => {
        res.statusCode = out.status;
        out.headers.forEach((value, name) => {
          res.setHeader(name, value);
        });
        if (!out.body) return res.end();
        const reader = out.body.getReader();
        res.on("close", () => void reader.cancel().catch(() => {}));
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(value);
        }
        res.end();
      })
      .catch((error: unknown) => {
        if (!res.headersSent) res.statusCode = 502;
        res.end(String(error));
      });
  };
  return {
    name: "cp-relay-dev",
    configureServer: (server) => void server.middlewares.use(middleware),
    configurePreviewServer: (server) => void server.middlewares.use(middleware),
  };
}

export default defineConfig({
  base: BASE,
  plugins: [react(), relayDevPlugin()],
  server: {
    host: "127.0.0.1",
    port: 5177,
    strictPort: true,
  },
  preview: { host: "127.0.0.1", port: 5178 },
});
