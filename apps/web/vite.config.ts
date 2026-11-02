import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/** 开发服务器和后端一样只监听本机；/api 转给后端 */
const API = `http://127.0.0.1:${process.env.CP_PORT ?? 8077}`;

/**
 * 站点根路径：本机和 Cloudflare Pages 是 /；GitHub Pages 的项目站点在 /仓库名/ 下，
 * 构建时用 CP_BASE=/仓库名/ 指定（前后都要有斜杠）
 */
const BASE = process.env.CP_BASE ?? "/";

export default defineConfig({
  base: BASE,
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5177,
    strictPort: true,
    proxy: { "/api": { target: API, changeOrigin: false } },
  },
  preview: { host: "127.0.0.1", port: 5178, proxy: { "/api": { target: API } } },
});
