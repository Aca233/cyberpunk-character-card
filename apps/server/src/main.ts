import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { AuthoringStore } from "./authoring";
import { AuthoringTextSearch } from "./authoring-search";
import { CharacterStore } from "./characters";
import { ConfigService } from "./config";
import { LoreLibrary } from "./lore-library";
import { PresetStore } from "./presets";
import { SaveStore } from "./storage";

/** 只监听本机 */
const HOST = "127.0.0.1";
const root = process.env.CP_ROOT ?? fileURLToPath(new URL("../../../", import.meta.url));
const port = Number(process.env.CP_PORT ?? 8077);
const dev = process.argv.includes("--dev");

const config = new ConfigService(join(root, "config.json"));
const textDb =
  process.env.CP_TEXT_DB ?? "/mnt/c/Cyberpunk 2077/_unpack/export/text/cyberpunk2077_text.db";

/** 设定库：本机有官方文本库才开；CP_LORE=off 可以关掉 */
function openLore(): LoreLibrary | undefined {
  if (process.env.CP_LORE === "off") return undefined;
  try {
    const lore = LoreLibrary.open(textDb, join(root, "data", "lore", "terms.json"));
    console.error(
      lore
        ? `[设定库] 读入原作资料 ${lore.size} 段、专有名词 ${lore.terms} 个`
        : "[设定库] 本机没有官方文本库，写正文不带原作资料",
    );
    return lore;
  } catch {
    console.error("[设定库] 官方文本库读不了，写正文不带原作资料");
    return undefined;
  }
}

const app = createApp({
  config,
  saves: new SaveStore(join(root, "data")),
  characters: new CharacterStore(join(root, "data")),
  presets: new PresetStore(join(root, "data")),
  dev,
  evalDrafts: join(root, "tools", "evals", "drafts"),
  authoring: dev ? new AuthoringStore(join(root, "data", "drafts")) : undefined,
  authoringText: dev ? new AuthoringTextSearch(textDb) : undefined,
  lore: openLore(),
  log: (message) => console.error(message),
});

const state = await config.load();
if (state.status !== "ok") {
  console.error(`[配置] 还不能开始剧情：\n${state.errors.join("\n")}`);
}

serve({ fetch: app.fetch, hostname: HOST, port }, (info) => {
  console.log(`已启动：http://${HOST}:${info.port}${dev ? "（开发模式）" : ""}`);
});
