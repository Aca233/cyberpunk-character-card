import exampleConfig from "../../../config.example.json";
import { createApp } from "./app";
import { CharacterStore } from "./characters";
import { ConfigService } from "./config";
import { IdbDocStore, IdbSaveStore, openGameDb } from "./idb-store";
import { PresetStore } from "./presets";
import { TurnHub } from "./turns";

/**
 * 纯前端（静态网站）用的本地服务层：和服务器同一套路由和游戏逻辑，存储换成浏览器里的 IndexedDB。
 * 网页不发网络请求到后端，而是把 Request 直接交给 app.fetch；回合事件直接订阅内存里的 TurnHub。
 * 不依赖 Node；没有设定库（官方文本库只在本机服务器上有）、没有内容工坊和评测草稿
 */

export interface LocalBackend {
  /** 和 fetch 一样用；路径要带 /api 前缀 */
  readonly fetch: (request: Request) => Promise<Response>;
  readonly hub: TurnHub;
}

/** 本地请求用的地址：只认本机来源的校验会放行，不会真的发到网络上 */
export const LOCAL_ORIGIN = "http://localhost";

const EXAMPLE_FILE = "config.example.json";

export async function createLocalBackend(
  options: { readonly dbName?: string; readonly factory?: IDBFactory } = {},
): Promise<LocalBackend> {
  const db = await openGameDb(options.dbName, options.factory);
  const docs = new IdbDocStore(db);
  // 示例配置跟着网页版本走：每次启动都写一份最新的，「用示例创建」照它建 config.json
  await docs.write(EXAMPLE_FILE, `${JSON.stringify(exampleConfig, null, 2)}\n`);
  // 浏览器里没有「文件」这回事：第一次打开就照示例建好 config.json，省掉「创建本机配置」那一步。
  // 已经有了就什么都不做（init 会拒绝覆盖）；示例本身不带连接，所以新存档是一份空配置
  const config = new ConfigService(docs, "config.json");
  await config.init();
  const hub = new TurnHub();
  const app = createApp({
    config,
    saves: new IdbSaveStore(db),
    characters: new CharacterStore(docs),
    presets: new PresetStore(docs),
    hub,
    log: (message) => console.warn(message),
  });
  return { fetch: async (request) => app.fetch(request), hub };
}
