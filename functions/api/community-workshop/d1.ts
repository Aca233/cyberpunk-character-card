import type {
  CommunityCategoryFilter,
  CommunityListQuery,
  CommunityListResult,
  CommunityPackSummary,
  CommunityPackSummaryCounts,
  CommunityWorkshopStore,
  NewCommunityPackRecord,
  StoredCommunityCover,
  StoredCommunityPack,
  UpdateCommunityPackRecord,
} from "./core";

/** Cloudflare D1 最小结构化类型声明（避免在根仓引入额外类型包依赖） */
export interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ readonly results: readonly T[] }>;
  run(): Promise<{ readonly success: boolean; readonly meta?: { readonly changes?: number } }>;
}

export interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatementLike;
}

interface PackMetaRow {
  readonly id: string;
  readonly title: string;
  readonly author: string;
  readonly description: string;
  readonly summary_json: string;
  readonly entry_count: number;
  readonly byte_size: number;
  readonly downloads: number;
  readonly revision: number;
  readonly cover_hash: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

interface CoverRow {
  readonly pack_id: string;
  readonly mime_type: string;
  readonly data_base64: string;
  readonly byte_size: number;
  readonly cover_hash: string;
  readonly updated_at: string;
}

interface PackFullRow extends PackMetaRow {
  readonly pack_json: string;
  readonly edit_token_hash: string;
}

function parseSummary(raw: string): CommunityPackSummaryCounts {
  try {
    const obj = JSON.parse(raw) as Partial<CommunityPackSummaryCounts>;
    return {
      characters: Number(obj.characters ?? 0),
      modules: Number(obj.modules ?? 0),
      acquaintances: Number(obj.acquaintances ?? 0),
      npcs: Number(obj.npcs ?? 0),
      items: Number(obj.items ?? 0),
      weapons: Number(obj.weapons ?? 0),
      cyberware: Number(obj.cyberware ?? 0),
      braindances: Number(obj.braindances ?? 0),
      chipContents: Number(obj.chipContents ?? 0),
      listings: Number(obj.listings ?? 0),
    };
  } catch {
    return {
      characters: 0,
      modules: 0,
      acquaintances: 0,
      npcs: 0,
      items: 0,
      weapons: 0,
      cyberware: 0,
      braindances: 0,
      chipContents: 0,
      listings: 0,
    };
  }
}

function toSummary(row: PackMetaRow): CommunityPackSummary {
  return {
    id: row.id,
    title: row.title,
    author: row.author,
    description: row.description,
    summary: parseSummary(row.summary_json),
    entryCount: Number(row.entry_count),
    byteSize: Number(row.byte_size),
    downloads: Number(row.downloads),
    revision: Number(row.revision),
    coverHash: row.cover_hash ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function categoryWhereClause(category: CommunityCategoryFilter): string | null {
  switch (category) {
    case "characters":
      return "COALESCE(json_extract(summary_json, '$.characters'), 0) > 0";
    case "cyberware":
      return "COALESCE(json_extract(summary_json, '$.cyberware'), 0) > 0";
    case "items":
      return "COALESCE(json_extract(summary_json, '$.items'), 0) > 0";
    case "npcs":
      return "(COALESCE(json_extract(summary_json, '$.npcs'), 0) > 0 OR COALESCE(json_extract(summary_json, '$.acquaintances'), 0) > 0)";
    case "modules":
      return "COALESCE(json_extract(summary_json, '$.modules'), 0) > 0";
    case "media":
      return "(COALESCE(json_extract(summary_json, '$.braindances'), 0) > 0 OR COALESCE(json_extract(summary_json, '$.chipContents'), 0) > 0)";
    case "listings":
      return "COALESCE(json_extract(summary_json, '$.listings'), 0) > 0";
    default:
      return null;
  }
}

function orderByClause(sort: CommunityListQuery["sort"]): string {
  switch (sort) {
    case "newest":
      return "created_at DESC, id ASC";
    case "updated":
      return "updated_at DESC, id ASC";
    default:
      return "downloads DESC, updated_at DESC, id ASC";
  }
}

export function createD1WorkshopStore(db: D1DatabaseLike): CommunityWorkshopStore {
  return {
    async list(query: CommunityListQuery): Promise<CommunityListResult> {
      const clauses: string[] = [];
      const params: unknown[] = [];

      if (query.q) {
        const pattern = `%${query.q.toLowerCase()}%`;
        clauses.push(
          "(LOWER(title) LIKE ? OR LOWER(author) LIKE ? OR LOWER(id) LIKE ? OR LOWER(description) LIKE ?)",
        );
        params.push(pattern, pattern, pattern, pattern);
      }

      const catClause = categoryWhereClause(query.category);
      if (catClause) clauses.push(catClause);

      const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
      const countRow = await db
        .prepare(`SELECT COUNT(*) AS total FROM workshop_packs ${whereSql}`)
        .bind(...params)
        .first<{ readonly total: number }>();
      const total = Number(countRow?.total ?? 0);
      if (total === 0) return { items: [], total: 0 };

      const offset = (query.page - 1) * query.pageSize;
      const rows = await db
        .prepare(
          `SELECT id, title, author, description, summary_json, entry_count, byte_size, downloads, revision, cover_hash, created_at, updated_at
           FROM workshop_packs ${whereSql}
           ORDER BY ${orderByClause(query.sort)}
           LIMIT ? OFFSET ?`,
        )
        .bind(...params, query.pageSize, offset)
        .all<PackMetaRow>();

      return { items: rows.results.map(toSummary), total };
    },

    async get(
      id: string,
      options?: { readonly incrementDownload?: boolean },
    ): Promise<StoredCommunityPack | null> {
      if (options?.incrementDownload) {
        await db
          .prepare("UPDATE workshop_packs SET downloads = downloads + 1 WHERE id = ?")
          .bind(id)
          .run();
      }
      const row = await db
        .prepare(
          `SELECT id, title, author, description, summary_json, entry_count, byte_size, downloads, revision, cover_hash, pack_json, edit_token_hash, created_at, updated_at
           FROM workshop_packs WHERE id = ?`,
        )
        .bind(id)
        .first<PackFullRow>();
      if (!row) return null;
      return {
        item: toSummary(row),
        packJson: row.pack_json,
        editTokenHash: row.edit_token_hash,
      };
    },

    async create(record: NewCommunityPackRecord) {
      const existing = await db
        .prepare("SELECT id FROM workshop_packs WHERE id = ?")
        .bind(record.id)
        .first<{ readonly id: string }>();
      if (existing) return { ok: false as const, reason: "exists" as const };

      try {
        await db
          .prepare(
            `INSERT INTO workshop_packs
              (id, title, author, description, summary_json, entry_count, byte_size, downloads, revision, cover_hash, pack_json, edit_token_hash, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1, NULL, ?, ?, ?, ?)`,
          )
          .bind(
            record.id,
            record.title,
            record.author,
            record.description,
            JSON.stringify(record.summary),
            record.entryCount,
            record.byteSize,
            record.packJson,
            record.editTokenHash,
            record.nowIso,
            record.nowIso,
          )
          .run();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("UNIQUE") || message.includes("PRIMARY KEY")) {
          return { ok: false as const, reason: "exists" as const };
        }
        throw error;
      }

      return {
        ok: true as const,
        item: {
          id: record.id,
          title: record.title,
          author: record.author,
          description: record.description,
          summary: record.summary,
          entryCount: record.entryCount,
          byteSize: record.byteSize,
          downloads: 0,
          revision: 1,
          coverHash: null,
          createdAt: record.nowIso,
          updatedAt: record.nowIso,
        },
      };
    },

    async update(id: string, patch: UpdateCommunityPackRecord) {
      await db
        .prepare(
          `UPDATE workshop_packs
           SET title = ?, author = ?, description = ?, summary_json = ?, entry_count = ?, byte_size = ?, pack_json = ?, revision = revision + 1, updated_at = ?
           WHERE id = ?`,
        )
        .bind(
          patch.title,
          patch.author,
          patch.description,
          JSON.stringify(patch.summary),
          patch.entryCount,
          patch.byteSize,
          patch.packJson,
          patch.nowIso,
          id,
        )
        .run();

      const row = await db
        .prepare(
          `SELECT id, title, author, description, summary_json, entry_count, byte_size, downloads, revision, cover_hash, created_at, updated_at
           FROM workshop_packs WHERE id = ?`,
        )
        .bind(id)
        .first<PackMetaRow>();
      return row ? toSummary(row) : null;
    },

    async remove(id: string) {
      await db.prepare("DELETE FROM workshop_covers WHERE pack_id = ?").bind(id).run();
      const res = await db.prepare("DELETE FROM workshop_packs WHERE id = ?").bind(id).run();
      return (res.meta?.changes ?? 1) > 0;
    },

    async getCover(packId: string): Promise<StoredCommunityCover | null> {
      const row = await db
        .prepare(
          `SELECT pack_id, mime_type, data_base64, byte_size, cover_hash, updated_at
           FROM workshop_covers WHERE pack_id = ?`,
        )
        .bind(packId)
        .first<CoverRow>();
      if (!row) return null;
      const mime =
        row.mime_type === "image/png" || row.mime_type === "image/jpeg"
          ? row.mime_type
          : "image/webp";
      return {
        packId: row.pack_id,
        mimeType: mime,
        dataBase64: row.data_base64,
        byteSize: Number(row.byte_size),
        coverHash: row.cover_hash,
        updatedAt: row.updated_at,
      };
    },

    async putCover(cover: StoredCommunityCover): Promise<void> {
      await db
        .prepare(
          `INSERT INTO workshop_covers (pack_id, mime_type, data_base64, byte_size, cover_hash, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(pack_id) DO UPDATE SET
             mime_type = excluded.mime_type,
             data_base64 = excluded.data_base64,
             byte_size = excluded.byte_size,
             cover_hash = excluded.cover_hash,
             updated_at = excluded.updated_at`,
        )
        .bind(
          cover.packId,
          cover.mimeType,
          cover.dataBase64,
          cover.byteSize,
          cover.coverHash,
          cover.updatedAt,
        )
        .run();
      await db
        .prepare("UPDATE workshop_packs SET cover_hash = ? WHERE id = ?")
        .bind(cover.coverHash, cover.packId)
        .run();
    },

    async deleteCover(packId: string): Promise<boolean> {
      const res = await db
        .prepare("DELETE FROM workshop_covers WHERE pack_id = ?")
        .bind(packId)
        .run();
      await db
        .prepare("UPDATE workshop_packs SET cover_hash = NULL WHERE id = ?")
        .bind(packId)
        .run();
      return (res.meta?.changes ?? 0) > 0;
    },

    async hitRateLimit(bucketKey: string, windowMs: number, maxHits: number, nowMs: number) {
      const windowBucket = Math.floor(nowMs / windowMs);
      const key = `${bucketKey}:${windowBucket}`;
      const existing = await db
        .prepare("SELECT count FROM workshop_rate_limits WHERE bucket_key = ?")
        .bind(key)
        .first<{ readonly count: number }>();
      const current = Number(existing?.count ?? 0);
      if (current >= maxHits) return false;
      await db
        .prepare(
          `INSERT INTO workshop_rate_limits (bucket_key, count, updated_at)
           VALUES (?, 1, ?)
           ON CONFLICT(bucket_key) DO UPDATE SET count = count + 1, updated_at = excluded.updated_at`,
        )
        .bind(key, nowMs)
        .run();
      return true;
    },
  };
}
