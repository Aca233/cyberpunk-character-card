import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { CharacterStore } from "./characters";
import { ConfigService } from "./config";
import { SaveStore } from "./storage";

/** 只监听本机 */
const HOST = "127.0.0.1";
const root = process.env.CP_ROOT ?? fileURLToPath(new URL("../../../", import.meta.url));
const port = Number(process.env.CP_PORT ?? 8077);
const dev = process.argv.includes("--dev");

const config = new ConfigService(join(root, "config.json"));
const app = createApp({
  config,
  saves: new SaveStore(join(root, "data")),
  characters: new CharacterStore(join(root, "data")),
  dev,
  evalDrafts: join(root, "tools", "evals", "drafts"),
  log: (message) => console.error(message),
});

const state = await config.load();
if (state.status !== "ok") {
  console.error(`[配置] 还不能开始剧情：\n${state.errors.join("\n")}`);
}

serve({ fetch: app.fetch, hostname: HOST, port }, (info) => {
  console.log(`已启动：http://${HOST}:${info.port}${dev ? "（开发模式）" : ""}`);
});
