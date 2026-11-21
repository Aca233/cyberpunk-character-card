import { execFile } from "node:child_process";
import { access, copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { PUBLIC, ROOT } from "./manifest";

const execFileAsync = promisify(execFile);

/** 音频清单与索引路径；输出在 public/assets/local/audio 下，不进 git */
export const AUDIO_MANIFEST = join(import.meta.dirname, "audio-manifest.json");
export const AUDIO_DIR = join(PUBLIC, "assets", "local", "audio");
export const AUDIO_INDEX = join(AUDIO_DIR, "index.json");
/** 生成的音频素材 id 与中文名称模块，跟着清单一起提交 */
export const AUDIO_IDS_MODULE = join(ROOT, "apps", "web", "src", "assets", "audio-ids.gen.ts");

const BGM_ID = /^bgm\.[a-z][A-Za-z0-9]*$/;
const SFX_ID = /^sfx\.[a-z][A-Za-z0-9]*$/;

const AudioEntrySchema = z.strictObject({
  id: z.string().min(1),
  file: z.string().regex(/^[A-Za-z0-9_./-]+\.ogg$/, "音频源路径写成 export/ 下的相对 .ogg 路径"),
  label: z.string().min(1),
  trimStart: z.number().min(0).optional(),
  trimDuration: z.number().positive().optional(),
  fadeOut: z.number().positive().optional(),
  gainDb: z.number().min(-24).max(12).optional(),
});

const AudioManifestSchema = z.strictObject({
  $comment: z.string().optional(),
  bgm: z.array(AudioEntrySchema.refine((e) => BGM_ID.test(e.id), "bgm id 必须以 bgm. 开头")).min(1),
  sfx: z.array(AudioEntrySchema.refine((e) => SFX_ID.test(e.id), "sfx id 必须以 sfx. 开头")).min(1),
});

export interface AudioSpec {
  readonly id: string;
  readonly kind: "bgm" | "sfx";
  readonly file: string;
  readonly label: string;
  readonly trimStart?: number;
  readonly trimDuration?: number;
  readonly fadeOut?: number;
  readonly gainDb?: number;
}

export interface AudioIndexEntry {
  readonly path: string;
  readonly kind: "bgm" | "sfx";
  readonly label: string;
  readonly duration: number;
  readonly source: "demo" | "release";
}

export interface AudioAssetIndex {
  readonly tier: "demo" | "release";
  readonly generatedAt: string;
  readonly assets: Readonly<Record<string, AudioIndexEntry>>;
}

export async function loadAudioManifest(): Promise<AudioSpec[]> {
  const parsed = AudioManifestSchema.safeParse(JSON.parse(await readFile(AUDIO_MANIFEST, "utf8")));
  if (!parsed.success) {
    throw new Error(`audio-manifest.json 格式不对：${z.prettifyError(parsed.error)}`);
  }
  const out: AudioSpec[] = [];
  const seen = new Set<string>();
  const push = (kind: "bgm" | "sfx", entry: z.infer<typeof AudioEntrySchema>) => {
    if (seen.has(entry.id)) throw new Error(`音频素材 id 重复：${entry.id}`);
    seen.add(entry.id);
    out.push({
      id: entry.id,
      kind,
      file: entry.file,
      label: entry.label,
      ...(entry.trimStart !== undefined ? { trimStart: entry.trimStart } : {}),
      ...(entry.trimDuration !== undefined ? { trimDuration: entry.trimDuration } : {}),
      ...(entry.fadeOut !== undefined ? { fadeOut: entry.fadeOut } : {}),
      ...(entry.gainDb !== undefined ? { gainDb: entry.gainDb } : {}),
    });
  };
  for (const e of parsed.data.bgm) push("bgm", e);
  for (const e of parsed.data.sfx) push("sfx", e);
  return out;
}

export function renderAudioIdsModule(specs: readonly AudioSpec[]): string {
  const bgms = specs.filter((s) => s.kind === "bgm").map((s) => s.id);
  const sfxs = specs.filter((s) => s.kind === "sfx").map((s) => s.id);
  const labels = [...specs].sort((a, b) => a.id.localeCompare(b.id));
  return [
    "// 由 tools/assets/pick.ts 按 tools/assets/audio-manifest.json 生成，不要手改",
    "export const BGM_IDS = [",
    ...bgms.map((id) => `  "${id}",`),
    "] as const;",
    "export type BgmId = (typeof BGM_IDS)[number];",
    "",
    "export const SFX_ASSET_IDS = [",
    ...sfxs.map((id) => `  "${id}",`),
    "] as const;",
    "export type SfxAssetId = (typeof SFX_ASSET_IDS)[number];",
    "",
    "export const AUDIO_ASSET_IDS = [...BGM_IDS, ...SFX_ASSET_IDS] as const;",
    "export type AudioAssetId = (typeof AUDIO_ASSET_IDS)[number];",
    "",
    "export const AUDIO_LABELS: Readonly<Record<AudioAssetId, string>> = {",
    ...labels.map((s) => `  "${s.id}": ${JSON.stringify(s.label)},`),
    "};",
    "",
  ].join("\n");
}

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

async function hasFfmpeg(): Promise<boolean> {
  try {
    await execFileAsync("ffmpeg", ["-version"], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

async function probeDuration(file: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync(
      "ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file],
      { timeout: 10000 },
    );
    const val = Number.parseFloat(stdout.trim());
    return Number.isFinite(val) ? Math.round(val * 100) / 100 : 0;
  } catch {
    return 0;
  }
}

function buildFilters(spec: AudioSpec, sourceDuration: number): string[] {
  const filters: string[] = [];
  if (spec.kind === "bgm") {
    // 统一响度至 -16 LUFS，避免战斗与探索曲目切换时音量骤变
    filters.push("loudnorm=I=-16:TP=-1.5:LRA=11");
  }
  if (spec.gainDb !== undefined && spec.gainDb !== 0) {
    filters.push(`volume=${spec.gainDb}dB`);
  }
  const effectiveDur =
    spec.trimDuration ??
    (sourceDuration > 0 ? Math.max(0.1, sourceDuration - (spec.trimStart ?? 0)) : 0);
  if (spec.fadeOut !== undefined && effectiveDur > spec.fadeOut) {
    const fadeStart = Math.max(0, effectiveDur - spec.fadeOut);
    filters.push(`afade=t=out:st=${fadeStart.toFixed(3)}:d=${spec.fadeOut.toFixed(3)}`);
  }
  return filters;
}

export async function pickAudioAssets(
  root: string,
  tier: "demo" | "release",
  jobs = 6,
): Promise<{ ok: boolean; count: number; bytes: number; missing: string[] }> {
  const specs = await loadAudioManifest();
  const ffmpegOk = await hasFfmpeg();
  const ext = ffmpegOk ? "mp3" : "ogg";
  if (!ffmpegOk) {
    console.warn("未检测到 ffmpeg，原版音频将以 .ogg 直接复制（不做裁剪与响度均衡）");
  }

  await mkdir(AUDIO_DIR, { recursive: true });
  const written = new Set<string>([resolve(AUDIO_INDEX)]);
  const assets: Record<string, AudioIndexEntry> = {};
  const missing: string[] = [];
  let next = 0;
  let bytes = 0;

  const worker = async () => {
    while (next < specs.length) {
      const spec = specs[next] as AudioSpec;
      next += 1;
      const src = join(root, "export", spec.file);
      if (!(await exists(src))) {
        missing.push(`${spec.id}（${spec.file}）`);
        continue;
      }
      const rel = `${spec.kind}/${spec.id}.${ext}`;
      const out = join(AUDIO_DIR, rel);
      written.add(resolve(out));
      await mkdir(dirname(out), { recursive: true });

      if (ffmpegOk) {
        const srcDur = await probeDuration(src);
        const args: string[] = ["-y", "-hide_banner", "-loglevel", "error"];
        if (spec.trimStart !== undefined && spec.trimStart > 0) {
          args.push("-ss", String(spec.trimStart));
        }
        args.push("-i", src);
        if (spec.trimDuration !== undefined) {
          args.push("-t", String(spec.trimDuration));
        }
        const filters = buildFilters(spec, srcDur);
        if (filters.length > 0) {
          args.push("-af", filters.join(","));
        }
        args.push(
          "-map_metadata",
          "-1",
          "-ar",
          "44100",
          "-ac",
          "2",
          "-c:a",
          "libmp3lame",
          "-b:a",
          spec.kind === "bgm" ? "112k" : "128k",
          out,
        );
        await execFileAsync("ffmpeg", args, { timeout: 60000 });
      } else {
        await copyFile(src, out);
      }

      const [outStat, outDur] = await Promise.all([stat(out), probeDuration(out)]);
      bytes += outStat.size;
      assets[spec.id] = {
        path: `/assets/local/audio/${rel}`,
        kind: spec.kind,
        label: spec.label,
        duration: outDur,
        source: tier,
      };
    }
  };

  await Promise.all(Array.from({ length: jobs }, worker));

  const sorted = Object.fromEntries(Object.entries(assets).sort(([a], [b]) => a.localeCompare(b)));
  const index: AudioAssetIndex = {
    tier,
    generatedAt: new Date().toISOString(),
    assets: sorted,
  };
  await writeFile(AUDIO_INDEX, `${JSON.stringify(index, null, 2)}\n`);

  for (const entry of await readdir(AUDIO_DIR, { recursive: true, withFileTypes: true })) {
    const filePath = resolve(entry.parentPath, entry.name);
    if (entry.isFile() && !written.has(filePath)) {
      await rm(filePath);
    }
  }

  await mkdir(dirname(AUDIO_IDS_MODULE), { recursive: true });
  await writeFile(AUDIO_IDS_MODULE, renderAudioIdsModule(specs));

  return {
    ok: missing.length === 0,
    count: Object.keys(assets).length,
    bytes,
    missing,
  };
}
