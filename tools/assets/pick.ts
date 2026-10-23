import { access, copyFile, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import sharp from "sharp";
import {
  type AssetIndex,
  type AssetSpec,
  IDS_MODULE,
  INDEX,
  type IndexEntry,
  loadManifest,
  outputName,
  renderIdsModule,
  UI_DIR,
} from "./manifest";

/**
 * 按清单从解包目录挑素材：pnpm pick-assets [--tier demo|release] [--source 解包目录] [--install 游戏目录]
 *   demo：默认以 /mnt/c/Cyberpunk 2077/_unpack 为源，只在本机用，index.json 每条标 source: demo
 *   release：只认核验通过的正版安装重新解包的目录，必须给 --install 和 --source，不接受 demo 的源
 * 每次重新生成 public/assets/local/ui/ 整个目录和 apps/web/src/assets/ids.gen.ts
 */

const DEMO_SOURCE = "/mnt/c/Cyberpunk 2077/_unpack";
/** 从高到低找；值是相对 1080p 的倍数 */
const RESOLUTIONS = [
  ["2160p", 2],
  ["1080p", 1],
  ["720p", 2 / 3],
] as const;
/** 超过这个大小的 PNG 转 WebP */
const WEBP_OVER = 256 * 1024;
const JOBS = 8;

const { values: args } = parseArgs({
  options: {
    tier: { type: "string", default: "demo" },
    source: { type: "string" },
    install: { type: "string" },
  },
});

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

/** 正版安装的标记：Steam、GOG、Epic 任一 */
async function verifiedInstall(dir: string): Promise<string | undefined> {
  const marks: [string, string][] = [
    ["bin/x64/steam_api64.dll", "Steam"],
    ["bin/x64/Galaxy64.dll", "GOG"],
    [".egstore", "Epic"],
  ];
  for (const [path, store] of marks) if (await exists(join(dir, path))) return store;
  return undefined;
}

async function sourceFor(tier: "demo" | "release"): Promise<string> {
  if (tier === "demo") return resolve(args.source ?? DEMO_SOURCE);
  if (!args.install || !args.source) {
    throw new Error(
      "release 档要给 --install（核验过的游戏安装目录）和 --source（从它重新解包的目录）",
    );
  }
  const source = resolve(args.source);
  if (source === resolve(DEMO_SOURCE)) {
    throw new Error(`release 档不能用 demo 的源 ${DEMO_SOURCE}：它没有通过来源核验`);
  }
  const store = await verifiedInstall(resolve(args.install));
  if (!store) {
    throw new Error(`${args.install} 里找不到 Steam、GOG 或 Epic 的安装标记，没法确认是正版安装`);
  }
  console.log(`安装来源：${store}`);
  return source;
}

async function locate(
  root: string,
  spec: AssetSpec,
): Promise<{ file: string; scale: number } | undefined> {
  const name = spec.atlas.split("/").at(-1) as string;
  const base = join(root, "export", "ui_sprites", spec.atlas, `${name}.inkatlas`);
  for (const [res, scale] of RESOLUTIONS) {
    const file = join(base, res, `${spec.slot}.png`);
    if (await exists(file)) return { file, scale };
  }
  const flat = join(base, `${spec.slot}.png`);
  return (await exists(flat)) ? { file: flat, scale: 1 } : undefined;
}

async function main(): Promise<number> {
  const tier = args.tier;
  if (tier !== "demo" && tier !== "release")
    throw new Error(`--tier 只能是 demo 或 release：${tier}`);
  const root = await sourceFor(tier);
  if (!(await exists(join(root, "export", "ui_sprites")))) {
    throw new Error(`${root} 下没有 export/ui_sprites，检查解包目录`);
  }
  const specs = await loadManifest();
  console.log(`${tier} 档，源 ${root}，清单 ${specs.length} 张`);

  await rm(UI_DIR, { recursive: true, force: true });
  await mkdir(UI_DIR, { recursive: true });

  const assets: Record<string, IndexEntry> = {};
  const missing: string[] = [];
  let next = 0;
  let webp = 0;
  let bytes = 0;
  const worker = async () => {
    while (next < specs.length) {
      const spec = specs[next] as AssetSpec;
      next += 1;
      const found = await locate(root, spec);
      if (!found) {
        missing.push(`${spec.id}（${spec.atlas} 的 ${spec.slot}）`);
        continue;
      }
      const size = (await stat(found.file)).size;
      const ext = size > WEBP_OVER ? "webp" : "png";
      const rel = outputName(spec, ext);
      const out = join(UI_DIR, rel);
      await mkdir(dirname(out), { recursive: true });
      if (ext === "webp") {
        await sharp(found.file).webp({ quality: 90, alphaQuality: 100, effort: 5 }).toFile(out);
        webp += 1;
      } else {
        await copyFile(found.file, out);
      }
      bytes += (await stat(out)).size;
      const meta = await sharp(found.file).metadata();
      assets[spec.id] = {
        path: `/assets/local/ui/${rel}`,
        width: meta.width,
        height: meta.height,
        scale: found.scale,
        source: tier,
      };
    }
  };
  await Promise.all(Array.from({ length: JOBS }, worker));

  const sorted = Object.fromEntries(Object.entries(assets).sort(([a], [b]) => a.localeCompare(b)));
  const index: AssetIndex = { tier, generatedAt: new Date().toISOString(), assets: sorted };
  await writeFile(INDEX, `${JSON.stringify(index, null, 2)}\n`);
  await mkdir(dirname(IDS_MODULE), { recursive: true });
  await writeFile(IDS_MODULE, renderIdsModule(specs));

  console.log(
    `复制 ${Object.keys(assets).length} 张（其中 ${webp} 张转 WebP），共 ${(bytes / 1024 / 1024).toFixed(1)} MB`,
  );
  if (missing.length > 0) {
    console.error(`\n解包目录里找不到 ${missing.length} 张：\n  ${missing.sort().join("\n  ")}`);
    return 1;
  }
  return 0;
}

try {
  process.exitCode = await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
