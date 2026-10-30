import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { readTavernPreset, type TavernPreset } from "@cp/core";
import { z } from "zod";
import { atomicWrite, isNotFound, KeyedMutex } from "./fsutil";

/**
 * data/presets/<id>.json：玩家导入的酒馆预设（用户定的）；active.json 记当前给叙事模型用哪一份。
 * 存的是读好的条目、正则和采样参数，不存原文件；导入时的提醒一起存，设置页照样显示
 */

const PRESET_ID = /^p-[a-z0-9-]{1,40}$/;
const ROLE = z.enum(["system", "user", "assistant"]);

const PresetSchema = z.object({
  name: z.string().min(1).max(60),
  entries: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      role: ROLE,
      content: z.string(),
      enabled: z.boolean(),
      depth: z.number().int().min(0).nullable(),
    }),
  ),
  regex: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      find: z.string(),
      flags: z.string(),
      replace: z.string(),
      enabled: z.boolean(),
      promptOnly: z.boolean(),
    }),
  ),
  sampling: z.object({
    temperature: z.number().optional(),
    topP: z.number().optional(),
    topK: z.number().optional(),
    maxOutputTokens: z.number().int().optional(),
  }),
});

const StoredPresetSchema = z.object({
  id: z.string().regex(PRESET_ID),
  importedAt: z.string(),
  warnings: z.array(z.string()),
  preset: PresetSchema,
});
export type StoredPreset = z.infer<typeof StoredPresetSchema>;

const ActiveSchema = z.object({ id: z.string().regex(PRESET_ID).nullable() });

/** 设置页改开关和条目正文（用户定的：提示词条目要能展开查看、编辑）；名字、角色、深度不在网页里改 */
export const PresetPatchSchema = z.strictObject({
  entries: z.record(z.string(), z.boolean()).optional(),
  /** 条目 id → 新正文；单条上限 200k 字，防止误贴大文件 */
  contents: z.record(z.string(), z.string().max(200_000)).optional(),
  regex: z.record(z.string(), z.boolean()).optional(),
  /** 采样参数要不要带：false 时照连接里的设置 */
  useSampling: z.boolean().optional(),
});

/** 一份预设最多这么大（原文件约 1MB，读好以后小得多），防止误传别的大文件 */
export const PRESET_MAX_BYTES = 8 * 1024 * 1024;

export class PresetStore {
  private readonly lock = new KeyedMutex();

  constructor(private readonly root: string) {}

  private dir(): string {
    return join(this.root, "presets");
  }

  private path(id: string): string {
    if (!PRESET_ID.test(id)) throw new Error(`预设 id 不合法：${id}`);
    return join(this.dir(), `${id}.json`);
  }

  async list(): Promise<StoredPreset[]> {
    let names: string[] = [];
    try {
      names = await readdir(this.dir());
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
    const out: StoredPreset[] = [];
    for (const name of names.filter((n) => n.startsWith("p-") && n.endsWith(".json"))) {
      const entry = await this.get(name.slice(0, -5));
      if (entry) out.push(entry);
    }
    return out.sort((a, b) => b.importedAt.localeCompare(a.importedAt));
  }

  /** 找不到或文件坏了返回 undefined */
  async get(id: string): Promise<StoredPreset | undefined> {
    if (!PRESET_ID.test(id)) return undefined;
    try {
      const parsed = StoredPresetSchema.safeParse(
        JSON.parse(await readFile(this.path(id), "utf8")),
      );
      return parsed.success ? parsed.data : undefined;
    } catch (error) {
      if (isNotFound(error) || error instanceof SyntaxError) return undefined;
      throw error;
    }
  }

  /** 读酒馆预设的 JSON，存成一份新的；不自动启用 */
  async import(
    raw: unknown,
    fileName: string,
    now: Date,
  ): Promise<{ ok: true; entry: StoredPreset } | { ok: false; error: string }> {
    const read = readTavernPreset(raw, fileName);
    if (!read.ok) return read;
    const entry: StoredPreset = {
      id: `p-${now.getTime().toString(36)}-${randomBytes(3).toString("hex")}`,
      importedAt: now.toISOString(),
      warnings: [...read.warnings],
      preset: PresetSchema.parse(read.preset),
    };
    await mkdir(this.dir(), { recursive: true });
    await atomicWrite(this.path(entry.id), `${JSON.stringify(entry, null, 2)}\n`);
    return { ok: true, entry };
  }

  /** 按条目、正则的 id 改开关；采样参数关掉就是清空 */
  update(id: string, patch: z.output<typeof PresetPatchSchema>): Promise<StoredPreset | undefined> {
    return this.lock.run(id, async () => {
      const entry = await this.get(id);
      if (!entry) return undefined;
      const { preset } = entry;
      const next: StoredPreset = {
        ...entry,
        preset: {
          ...preset,
          entries: preset.entries.map((e) => ({
            ...e,
            enabled: patch.entries?.[e.id] ?? e.enabled,
            content: patch.contents?.[e.id] ?? e.content,
          })),
          regex: preset.regex.map((r) => ({ ...r, enabled: patch.regex?.[r.id] ?? r.enabled })),
          sampling: patch.useSampling === false ? {} : preset.sampling,
        },
      };
      await atomicWrite(this.path(id), `${JSON.stringify(next, null, 2)}\n`);
      return next;
    });
  }

  async remove(id: string): Promise<boolean> {
    if (!PRESET_ID.test(id)) return false;
    if ((await this.activeId()) === id) await this.setActive(null);
    try {
      await rm(this.path(id));
      return true;
    } catch (error) {
      if (isNotFound(error)) return false;
      throw error;
    }
  }

  async activeId(): Promise<string | null> {
    try {
      const parsed = ActiveSchema.safeParse(
        JSON.parse(await readFile(join(this.dir(), "active.json"), "utf8")),
      );
      return parsed.success ? parsed.data.id : null;
    } catch (error) {
      if (isNotFound(error) || error instanceof SyntaxError) return null;
      throw error;
    }
  }

  /** null：不用预设，照本作原样写 */
  async setActive(id: string | null): Promise<boolean> {
    if (id !== null && !(await this.get(id))) return false;
    await mkdir(this.dir(), { recursive: true });
    await atomicWrite(join(this.dir(), "active.json"), `${JSON.stringify({ id })}\n`);
    return true;
  }

  /** 写正文时用的那一份；没启用或文件坏了返回 undefined */
  async active(): Promise<TavernPreset | undefined> {
    const id = await this.activeId();
    return id === null ? undefined : (await this.get(id))?.preset;
  }
}
