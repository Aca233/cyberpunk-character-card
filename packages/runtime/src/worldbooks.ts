import {
  type ActiveWorldbook,
  exportTavernWorldbook,
  readTavernWorldbook,
  type TavernWorldbook,
} from "@cp/core";
import { z } from "zod";
import { KeyedMutex } from "./mutex";
import type { DocStore } from "./ports";
import { randomHex } from "./random";

/**
 * worldbooks/<id>.json：玩家导入或自建的酒馆世界书（World Info / Lorebook）。
 * 支持多本并行启用；每本独立开关、扫描轮数、递归开关，每条条目可独立编辑与启停。
 */

const WORLDBOOK_ID = /^wb-[a-z0-9-]{1,40}$/;
const FOLDER = "worldbooks";
const ROLE = z.enum(["system", "user", "assistant"]);
const POSITION = z.enum(["before", "after", "at_depth"]);
const SELECTIVE_LOGIC = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);

export const WorldbookEntrySchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().min(1).max(80),
  content: z.string().max(200_000),
  enabled: z.boolean(),
  constant: z.boolean(),
  keys: z.array(z.string().trim().min(1).max(120)).max(200),
  secondaryKeys: z.array(z.string().trim().min(1).max(120)).max(200),
  selective: z.boolean(),
  selectiveLogic: SELECTIVE_LOGIC,
  caseSensitive: z.boolean(),
  matchWholeWords: z.boolean(),
  order: z.number().int().min(-10_000).max(100_000),
  position: POSITION,
  depth: z.number().int().min(0).max(100),
  role: ROLE,
  scanDepth: z.number().int().min(0).max(20).nullable(),
});

const TavernWorldbookSchema = z.object({
  name: z.string().min(1).max(60),
  scanDepth: z.number().int().min(0).max(20),
  recursiveScanning: z.boolean(),
  entries: z.array(WorldbookEntrySchema),
});

const StoredWorldbookSchema = z.object({
  id: z.string().regex(WORLDBOOK_ID),
  importedAt: z.string(),
  enabled: z.boolean(),
  warnings: z.array(z.string()),
  worldbook: TavernWorldbookSchema,
});
export type StoredWorldbook = z.infer<typeof StoredWorldbookSchema>;

export const WorldbookEntryPatchSchema = z.strictObject({
  name: z.string().trim().min(1).max(80).optional(),
  content: z.string().max(200_000).optional(),
  enabled: z.boolean().optional(),
  constant: z.boolean().optional(),
  keys: z.array(z.string().trim().min(1).max(120)).max(200).optional(),
  secondaryKeys: z.array(z.string().trim().min(1).max(120)).max(200).optional(),
  selective: z.boolean().optional(),
  selectiveLogic: SELECTIVE_LOGIC.optional(),
  caseSensitive: z.boolean().optional(),
  matchWholeWords: z.boolean().optional(),
  order: z.number().int().min(-10_000).max(100_000).optional(),
  position: POSITION.optional(),
  depth: z.number().int().min(0).max(100).optional(),
  role: ROLE.optional(),
  scanDepth: z.number().int().min(0).max(20).nullable().optional(),
});

export const WorldbookNewEntrySchema = z.strictObject({
  name: z.string().trim().min(1).max(80),
  content: z.string().max(200_000).default(""),
  enabled: z.boolean().default(true),
  constant: z.boolean().default(false),
  keys: z.array(z.string().trim().min(1).max(120)).max(200).default([]),
  secondaryKeys: z.array(z.string().trim().min(1).max(120)).max(200).default([]),
  selective: z.boolean().default(false),
  selectiveLogic: SELECTIVE_LOGIC.default(0),
  caseSensitive: z.boolean().default(false),
  matchWholeWords: z.boolean().default(false),
  order: z.number().int().min(-10_000).max(100_000).default(100),
  position: POSITION.default("after"),
  depth: z.number().int().min(0).max(100).default(4),
  role: ROLE.default("system"),
  scanDepth: z.number().int().min(0).max(20).nullable().default(null),
});

export const WorldbookPatchSchema = z.strictObject({
  name: z.string().trim().min(1).max(60).optional(),
  enabled: z.boolean().optional(),
  scanDepth: z.number().int().min(0).max(20).optional(),
  recursiveScanning: z.boolean().optional(),
  /** 批量快速改条目启用状态（id → enabled） */
  entryToggles: z.record(z.string(), z.boolean()).optional(),
  /** 编辑指定条目完整或部分字段（id → patch） */
  entryUpdates: z.record(z.string(), WorldbookEntryPatchSchema).optional(),
  /** 新增一条条目 */
  addEntry: WorldbookNewEntrySchema.optional(),
  /** 删除指定条目 id */
  removeEntryId: z.string().min(1).optional(),
});

export const WORLDBOOK_MAX_BYTES = 8 * 1024 * 1024;

function parseJson(text: string | undefined): unknown {
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export class WorldbookStore {
  private readonly lock = new KeyedMutex();

  constructor(private readonly docs: DocStore) {}

  private path(id: string): string {
    if (!WORLDBOOK_ID.test(id)) throw new Error(`世界书 id 不合法：${id}`);
    return `${FOLDER}/${id}.json`;
  }

  async list(): Promise<StoredWorldbook[]> {
    const names = await this.docs.list(FOLDER);
    const out: StoredWorldbook[] = [];
    for (const name of names.filter((n) => n.startsWith("wb-") && n.endsWith(".json"))) {
      const entry = await this.get(name.slice(0, -5));
      if (entry) out.push(entry);
    }
    return out.sort((a, b) => b.importedAt.localeCompare(a.importedAt));
  }

  async get(id: string): Promise<StoredWorldbook | undefined> {
    if (!WORLDBOOK_ID.test(id)) return undefined;
    const parsed = StoredWorldbookSchema.safeParse(parseJson(await this.docs.read(this.path(id))));
    return parsed.success ? parsed.data : undefined;
  }

  /** 导入 SillyTavern 世界书 JSON（默认启用，也可在列表随时关闭） */
  async import(
    raw: unknown,
    fileName: string,
    now: Date,
  ): Promise<{ ok: true; entry: StoredWorldbook } | { ok: false; error: string }> {
    const read = readTavernWorldbook(raw, fileName);
    if (!read.ok) return read;
    const entry: StoredWorldbook = {
      id: `wb-${now.getTime().toString(36)}-${randomHex(3)}`,
      importedAt: now.toISOString(),
      enabled: true,
      warnings: [...read.warnings],
      worldbook: TavernWorldbookSchema.parse(read.worldbook),
    };
    await this.docs.write(this.path(entry.id), `${JSON.stringify(entry, null, 2)}\n`);
    return { ok: true, entry };
  }

  /** 新建一本空白世界书（带一条可编辑示例条目占位，立即可用） */
  async createBlank(name: string, now: Date): Promise<StoredWorldbook> {
    const clean = name.trim().slice(0, 60) || "自定义世界书";
    const entry: StoredWorldbook = {
      id: `wb-${now.getTime().toString(36)}-${randomHex(3)}`,
      importedAt: now.toISOString(),
      enabled: true,
      warnings: [],
      worldbook: {
        name: clean,
        scanDepth: 4,
        recursiveScanning: true,
        entries: [],
      },
    };
    await this.docs.write(this.path(entry.id), `${JSON.stringify(entry, null, 2)}\n`);
    return entry;
  }

  update(
    id: string,
    patch: z.output<typeof WorldbookPatchSchema>,
  ): Promise<StoredWorldbook | undefined> {
    return this.lock.run(id, async () => {
      const stored = await this.get(id);
      if (!stored) return undefined;
      const book = stored.worldbook;
      let entries = book.entries.map((entry) => {
        const toggled = patch.entryToggles?.[entry.id];
        const u = patch.entryUpdates?.[entry.id];
        if (toggled === undefined && u === undefined) return entry;
        return {
          id: entry.id,
          name: u?.name ?? entry.name,
          content: u?.content ?? entry.content,
          enabled: toggled ?? u?.enabled ?? entry.enabled,
          constant: u?.constant ?? entry.constant,
          keys: u?.keys ?? entry.keys,
          secondaryKeys: u?.secondaryKeys ?? entry.secondaryKeys,
          selective: u?.selective ?? entry.selective,
          selectiveLogic: u?.selectiveLogic ?? entry.selectiveLogic,
          caseSensitive: u?.caseSensitive ?? entry.caseSensitive,
          matchWholeWords: u?.matchWholeWords ?? entry.matchWholeWords,
          order: u?.order ?? entry.order,
          position: u?.position ?? entry.position,
          depth: u?.depth ?? entry.depth,
          role: u?.role ?? entry.role,
          scanDepth: u?.scanDepth !== undefined ? u.scanDepth : entry.scanDepth,
        };
      });
      if (patch.removeEntryId) {
        entries = entries.filter((e) => e.id !== patch.removeEntryId);
      }
      if (patch.addEntry) {
        const newId = `e-${Date.now().toString(36)}-${randomHex(2)}`;
        entries = [...entries, { id: newId, ...patch.addEntry }];
      }
      const next: StoredWorldbook = {
        ...stored,
        enabled: patch.enabled ?? stored.enabled,
        worldbook: {
          name: patch.name ?? book.name,
          scanDepth: patch.scanDepth ?? book.scanDepth,
          recursiveScanning: patch.recursiveScanning ?? book.recursiveScanning,
          entries,
        },
      };
      await this.docs.write(this.path(id), `${JSON.stringify(next, null, 2)}\n`);
      return next;
    });
  }

  remove(id: string): Promise<boolean> {
    if (!WORLDBOOK_ID.test(id)) return Promise.resolve(false);
    return this.lock.run(id, () => this.docs.remove(this.path(id)));
  }

  async exportJson(
    id: string,
  ): Promise<{ name: string; data: Record<string, unknown> } | undefined> {
    const stored = await this.get(id);
    if (!stored) return undefined;
    return {
      name: stored.worldbook.name,
      data: exportTavernWorldbook(stored.worldbook),
    };
  }

  /** 读取当前所有已启用的世界书（供叙事模型写正文时扫描与注入） */
  async active(): Promise<ActiveWorldbook[]> {
    const all = await this.list();
    return all
      .filter((item) => item.enabled)
      .map(
        (item): ActiveWorldbook => ({
          id: item.id,
          ...(item.worldbook as TavernWorldbook),
        }),
      );
  }
}
