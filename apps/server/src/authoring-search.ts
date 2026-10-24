import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  type OfficialTextHit,
  type OfficialTextResult,
  type TextSearchRequest,
  TextSearchRequestSchema,
  TextSourceRequestSchema,
} from "@cp/core";

const PREVIEW_CHARS = 600;
const SOURCE_LIMIT = 20;

export class OfficialTextError extends Error {
  constructor() {
    super("官方文本库暂时无法读取，请检查本机数据库及全文索引");
    this.name = "OfficialTextError";
  }
}

interface TextRow {
  readonly rowId: number;
  readonly key: string | null;
  readonly category: string | null;
  readonly zh: string | null;
  readonly en: string | null;
  readonly zhLength: number | null;
  readonly enLength: number | null;
}

/** 搜索词当作字面短语，不能通过它注入 FTS 运算符。 */
function phrase(query: string): string {
  return `"${query.replaceAll('"', '""')}"`;
}

/** LIKE 通配符也是普通文字；只有代码添加的首尾 % 是通配符。 */
function contains(query: string): string {
  return `%${query.replace(/[\\%_]/g, "\\$&")}%`;
}

function hitsOf(
  rows: readonly TextRow[],
  scope: TextSearchRequest["scope"],
  limit: number,
): OfficialTextHit[] {
  return rows.slice(0, limit).map((row) => {
    const key = row.key && row.key.trim() !== "" ? row.key : null;
    return {
      rowId: row.rowId,
      scope,
      key,
      // 字幕没有 secondary_key，不能伪造 text: 引用。
      source: scope === "onscreen" && key !== null ? `text:${key}` : null,
      category: row.category,
      zh: row.zh ?? "",
      en: row.en ?? "",
      truncated: (row.zhLength ?? 0) > PREVIEW_CHARS || (row.enLength ?? 0) > PREVIEW_CHARS,
    };
  });
}

/** 路径仅由服务端配置；每次只读打开并关闭，不执行用户提供的 SQL 或路径。 */
export class AuthoringTextSearch {
  constructor(private readonly path: string | undefined) {}

  private run(
    mode: OfficialTextResult["mode"],
    operation: (db: DatabaseSync) => OfficialTextResult,
  ): OfficialTextResult {
    if (!this.path || !existsSync(this.path)) {
      return {
        available: false,
        mode,
        hits: [],
        hasMore: false,
        note: "本机没有官方文本库；可以继续手工填写来源，或配置 CP_TEXT_DB",
      };
    }
    try {
      const db = new DatabaseSync(this.path, { readOnly: true });
      try {
        return operation(db);
      } finally {
        db.close();
      }
    } catch {
      // 不把数据库路径、SQL 和底层异常直接送到浏览器。
      throw new OfficialTextError();
    }
  }

  search(raw: TextSearchRequest): OfficialTextResult {
    const input = TextSearchRequestSchema.parse(raw);
    return this.run(input.mode, (db) => {
      // 两个表名只能来自这个固定分支，不能由客户端自由填写。
      const table = input.scope === "onscreen" ? "onscreen" : "subtitle";
      const fts = input.scope === "onscreen" ? "onscreen_fts" : "subtitle_fts";
      const key = input.scope === "onscreen" ? "o.secondary_key" : "CAST(o.string_id AS TEXT)";
      const category = input.scope === "onscreen" ? "o.category" : "NULL";
      const columns = `o.rowid AS rowId, ${key} AS key, ${category} AS category,
        substr(o.zh, 1, ${PREVIEW_CHARS}) AS zh,
        substr(o.en, 1, ${PREVIEW_CHARS}) AS en,
        length(o.zh) AS zhLength, length(o.en) AS enLength`;

      let rows: TextRow[];
      if (input.mode === "phrase") {
        rows = db
          .prepare(
            `SELECT ${columns} FROM ${fts}
           JOIN ${table} AS o ON o.rowid = ${fts}.rowid
           WHERE ${fts} MATCH ?
           ORDER BY ${fts}.rank, o.rowid LIMIT ?`,
          )
          .all(phrase(input.q), input.limit + 1) as unknown as TextRow[];
      } else {
        rows = db
          .prepare(
            `SELECT ${columns} FROM ${table} AS o
           WHERE o.zh LIKE ? ESCAPE '\\' OR o.en LIKE ? ESCAPE '\\'
           ORDER BY o.rowid LIMIT ?`,
          )
          .all(contains(input.q), contains(input.q), input.limit + 1) as unknown as TextRow[];
      }

      return {
        available: true,
        mode: input.mode,
        hits: hitsOf(rows, input.scope, input.limit),
        hasMore: rows.length > input.limit,
        note:
          input.mode === "phrase"
            ? "全文索引按词匹配，中文片段可能漏检；需要时手动切换包含匹配"
            : "包含匹配扫描原文，可能较慢；这里仅显示有限条结果",
      };
    });
  }

  /** 按 text: 后面的 secondary_key 回查；同一个键有多条时如实返回。 */
  source(rawKey: string): OfficialTextResult {
    const { key } = TextSourceRequestSchema.parse({ key: rawKey });
    return this.run("source", (db) => {
      const rows = db
        .prepare(
          `SELECT rowid AS rowId, secondary_key AS key, category,
          substr(zh, 1, ${PREVIEW_CHARS}) AS zh,
          substr(en, 1, ${PREVIEW_CHARS}) AS en,
          length(zh) AS zhLength, length(en) AS enLength
         FROM onscreen WHERE secondary_key = ? ORDER BY rowid LIMIT ?`,
        )
        .all(key, SOURCE_LIMIT + 1) as unknown as TextRow[];
      return {
        available: true,
        mode: "source",
        hits: hitsOf(rows, "onscreen", SOURCE_LIMIT),
        hasMore: rows.length > SOURCE_LIMIT,
        note:
          rows.length === 0
            ? "文本库中没有这个来源键；此结果不能证明来源有效"
            : "按来源键回查的短预览；引用只保存键，正文仍留在本机文本库",
      };
    });
  }
}
