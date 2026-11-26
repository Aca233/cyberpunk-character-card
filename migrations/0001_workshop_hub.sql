-- 社区创意工坊（Cloudflare D1）建表迁移
-- 本地或线上初始化命令示例：
--   npx wrangler d1 create cyberpunk-workshop
--   npx wrangler d1 execute cyberpunk-workshop --remote --file=migrations/0001_workshop_hub.sql

CREATE TABLE IF NOT EXISTS workshop_packs (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  author TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  summary_json TEXT NOT NULL,
  entry_count INTEGER NOT NULL DEFAULT 0,
  byte_size INTEGER NOT NULL DEFAULT 0,
  downloads INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 1,
  cover_hash TEXT,
  pack_json TEXT NOT NULL,
  edit_token_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workshop_covers (
  pack_id TEXT PRIMARY KEY,
  mime_type TEXT NOT NULL,
  data_base64 TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  cover_hash TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_workshop_packs_downloads
  ON workshop_packs (downloads DESC, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_workshop_packs_created
  ON workshop_packs (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_workshop_packs_updated
  ON workshop_packs (updated_at DESC);

CREATE TABLE IF NOT EXISTS workshop_rate_limits (
  bucket_key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
