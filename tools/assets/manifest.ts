import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

/** 素材清单的读取和展开；pick.ts 和 check-assets.ts 共用 */

export const ROOT = join(import.meta.dirname, "..", "..");
export const MANIFEST = join(import.meta.dirname, "manifest.json");
/** 网页的静态目录；素材在 public/assets/local/ui 下，不进 git */
export const PUBLIC = join(ROOT, "apps", "web", "public");
export const UI_DIR = join(PUBLIC, "assets", "local", "ui");
export const INDEX = join(UI_DIR, "index.json");
/** 生成的素材 id 类型，跟着清单一起提交 */
export const IDS_MODULE = join(ROOT, "apps", "web", "src", "assets", "ids.gen.ts");

const ID = /^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9]+)+$/;

const EntrySchema = z
  .strictObject({
    id: z.string().regex(ID, "id 用点分隔的小驼峰，例如 hud.healthbar"),
    atlas: z.string().regex(/^[a-z0-9_]+\/[A-Za-z0-9_-]+$/, "atlas 写成 分组/图集名"),
    slot: z.string().min(1),
    frames: z
      .strictObject({
        from: z.number().int().min(0),
        to: z.number().int().min(0),
        /** 原作图集里本来就缺的帧 */
        missing: z.array(z.number().int()).default([]),
      })
      .refine((f) => f.from <= f.to, "from 不能大于 to")
      .optional(),
  })
  .refine((e) => (e.frames === undefined) === !e.slot.includes("{n}"), {
    message: "逐帧素材的 slot 要带 {n}，其他素材不能带",
  });

export const ManifestSchema = z.strictObject({
  $comment: z.string().optional(),
  groups: z.record(z.string().regex(/^[a-z]+$/, "分组名用小写英文"), z.array(EntrySchema).min(1)),
});

/** 展开后的一张图 */
export interface AssetSpec {
  readonly id: string;
  readonly group: string;
  readonly atlas: string;
  readonly slot: string;
}

/** index.json 里的一条：path 相对网页根目录；显示尺寸是 width / scale */
export interface IndexEntry {
  readonly path: string;
  readonly width: number;
  readonly height: number;
  /** 2160p 是 2，1080p 是 1，720p 是 2/3 */
  readonly scale: number;
  readonly source: "demo" | "release";
}

export interface AssetIndex {
  readonly tier: "demo" | "release";
  readonly generatedAt: string;
  readonly assets: Readonly<Record<string, IndexEntry>>;
}

export async function loadManifest(): Promise<AssetSpec[]> {
  const parsed = ManifestSchema.safeParse(JSON.parse(await readFile(MANIFEST, "utf8")));
  if (!parsed.success) throw new Error(`manifest.json 格式不对：${z.prettifyError(parsed.error)}`);
  const out: AssetSpec[] = [];
  const seen = new Set<string>();
  const add = (spec: AssetSpec) => {
    if (seen.has(spec.id)) throw new Error(`素材 id 重复：${spec.id}`);
    seen.add(spec.id);
    out.push(spec);
  };
  for (const [group, entries] of Object.entries(parsed.data.groups)) {
    for (const { id, atlas, slot, frames } of entries) {
      if (!frames) {
        add({ id, group, atlas, slot });
        continue;
      }
      for (let n = frames.from; n <= frames.to; n += 1) {
        if (frames.missing.includes(n)) continue;
        add({ id: `${id}.${n}`, group, atlas, slot: slot.replace("{n}", String(n)) });
      }
    }
  }
  return out;
}

/** 生成 ids.gen.ts：清单里没有的 id 在网页里是类型错误 */
export function renderIdsModule(specs: readonly AssetSpec[]): string {
  const ids = specs.map((s) => s.id).sort();
  return [
    "// 由 tools/assets/pick.ts 按 tools/assets/manifest.json 生成，不要手改",
    "export const ASSET_IDS = [",
    ...ids.map((id) => `  "${id}",`),
    "] as const;",
    "export type AssetId = (typeof ASSET_IDS)[number];",
    "",
  ].join("\n");
}

/** 输出文件名：分组目录下按 id 命名 */
export function outputName(spec: AssetSpec, ext: "png" | "webp"): string {
  return `${spec.group}/${spec.id}.${ext}`;
}
