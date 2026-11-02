import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import {
  type AssetIndex,
  IDS_MODULE,
  INDEX,
  loadManifest,
  PUBLIC,
  ROOT,
  renderIdsModule,
} from "./manifest";

/**
 * pnpm check-assets：清单里的每张图都要在 index.json 里、文件存在且尺寸对得上；
 * ids.gen.ts 要和清单一致；网页代码只能通过 <Asset> 引用素材，不能直接写素材路径。
 * 有任何问题就失败，网页构建前也会跑这一步
 */

const WEB_SRC = join(ROOT, "apps", "web", "src");
/** 只有这个文件可以拼素材路径 */
const ASSET_MODULE = join(WEB_SRC, "assets", "index.ts");

async function sourceFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await sourceFiles(path)));
    else if (/\.(tsx?|css)$/.test(entry.name)) out.push(path);
  }
  return out;
}

async function main(): Promise<number> {
  const problems: string[] = [];
  const specs = await loadManifest();

  let ids = "";
  try {
    ids = await readFile(IDS_MODULE, "utf8");
  } catch {}
  if (ids !== renderIdsModule(specs)) {
    problems.push("apps/web/src/assets/ids.gen.ts 和清单不一致：运行 pnpm pick-assets 重新生成");
  }

  let index: AssetIndex | undefined;
  try {
    index = JSON.parse(await readFile(INDEX, "utf8")) as AssetIndex;
  } catch {
    problems.push("没有 public/assets/local/ui/index.json：运行 pnpm pick-assets 生成素材");
  }
  if (index) {
    const missing: string[] = [];
    for (const spec of specs) {
      const entry = index.assets[spec.id];
      if (!entry) {
        missing.push(`${spec.id}：index.json 里没有`);
        continue;
      }
      const file = join(PUBLIC, entry.path);
      try {
        if ((await stat(file)).size === 0) missing.push(`${spec.id}：${entry.path} 是空文件`);
      } catch {
        missing.push(`${spec.id}：缺少 ${entry.path}`);
      }
    }
    if (missing.length > 0) {
      problems.push(
        `缺 ${missing.length} 张素材，运行 pnpm pick-assets：\n    ${missing.join("\n    ")}`,
      );
    }
    const known = new Set(specs.map((s) => s.id));
    const stale = Object.keys(index.assets).filter((id) => !known.has(id));
    if (stale.length > 0) {
      problems.push(
        `index.json 里有清单外的素材（${stale.join("、")}）：运行 pnpm pick-assets 重新生成`,
      );
    }
  }

  const direct: string[] = [];
  for (const file of await sourceFiles(WEB_SRC)) {
    if (file === ASSET_MODULE) continue;
    const text = await readFile(file, "utf8");
    if (text.includes("assets/local")) direct.push(relative(ROOT, file));
  }
  if (direct.length > 0) {
    problems.push(`这些文件直接写了素材路径，改用 <Asset> 或 assetUrl()：${direct.join("、")}`);
  }

  if (problems.length > 0) {
    console.error(`素材检查没通过：\n  ${problems.join("\n  ")}`);
    return 1;
  }
  console.log(
    `素材检查通过：${specs.length} 张（${index?.tier} 档，生成于 ${index?.generatedAt}）`,
  );
  // 纯前端版要公开部署（build:static 会设 VITE_CP_BACKEND=local）：demo 档照样放行，只提醒（用户定的）
  if (process.env.VITE_CP_BACKEND === "local" && index?.tier === "demo") {
    console.warn(
      "注意：这是 demo 档素材，按 pick.ts 的约定只在本机用；公开部署前应换成 release 档（pnpm pick-assets --tier release --install <游戏目录> --source <解包目录>）。页面底部会照旧显示「demo 素材，仅限本机使用」",
    );
  }
  return 0;
}

try {
  process.exitCode = await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
