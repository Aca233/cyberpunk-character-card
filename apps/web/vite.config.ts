import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/** 开发服务器和后端一样只监听本机；/api 转给后端 */
const API = `http://127.0.0.1:${process.env.CP_PORT ?? 8077}`;

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5177,
    strictPort: true,
    proxy: { "/api": { target: API, changeOrigin: false } },
  },
  preview: { host: "127.0.0.1", port: 5178, proxy: { "/api": { target: API } } },
});
