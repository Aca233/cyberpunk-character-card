import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { cyberware, fixers, glossary, items, locations, npcs } from "@cp/content";
import { ROOT } from "../assets/manifest";
import { CATALOG_KEYS, SEED_TERMS } from "./seeds";

/**
 * pnpm terms：从本机的官方文本库抽出译名，写进 data/lore/terms.json，再拿它核对内容包里的名字。
 * 文本库来自未核验的 _unpack，只在本机用，抽出的文件也不进仓库（data/ 在 .gitignore 里）。
 * 找不到文本库时跳过并提示，不算失败；核对只报告，不让命令失败
 *
 * 文本库位置：环境变量 CP_TEXT_DB，或命令行第一个参数，默认是游戏目录下的导出
 */

const DEFAULT_DB = "/mnt/c/Cyberpunk 2077/_unpack/export/text/cyberpunk2077_text.db";
const OUT = join(ROOT, "data", "lore", "terms.json");

interface Row {
  readonly key: string;
  readonly en: string;
  readonly zh: string;
}

interface Term {
  readonly en: string;
  /** 出现最多的写法 */
  readonly zh: string;
  /** 其他写法和各自出现的次数，多的在前 */
  readonly variants: readonly (readonly [string, number])[];
}

/** 去掉格式标记和首尾空白；空的、太长的（整句、整段）不算术语 */
function clean(text: string): string | null {
  const t = text.replace(/<[^>]*>/g, "").trim();
  return t === "" || t.length > 40 ? null : t;
}

function loadRows(path: string): Row[] {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    // 一次读进内存再在这里查：文本库在 Windows 盘上时逐条查询很慢
    const all = db
      .prepare("select coalesce(secondary_key, '') as key, en, zh from onscreen")
      .all() as unknown as { key: string; en: string | null; zh: string | null }[];
    const rows: Row[] = [];
    for (const r of all) {
      const en = r.en && clean(r.en);
      const zh = r.zh && clean(r.zh);
      if (en && zh) rows.push({ key: r.key, en, zh });
    }
    return rows;
  } finally {
    db.close();
  }
}

function tally(zhs: readonly string[]): Term["variants"] {
  const counts = new Map<string, number>();
  for (const zh of zhs) counts.set(zh, (counts.get(zh) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]);
}

function extract(rows: readonly Row[]) {
  const byEn = new Map<string, string[]>();
  for (const r of rows) {
    const k = r.en.toLowerCase();
    byEn.set(k, [...(byEn.get(k) ?? []), r.zh]);
  }
  const seeds: Record<string, Term[]> = {};
  const missing: string[] = [];
  for (const [group, words] of Object.entries(SEED_TERMS)) {
    seeds[group] = [];
    for (const en of words) {
      const zhs = byEn.get(en.toLowerCase());
      if (!zhs) {
        missing.push(en);
        continue;
      }
      const [first, ...rest] = tally(zhs);
      if (first) seeds[group].push({ en, zh: first[0], variants: rest });
    }
  }
  const catalogs: Record<string, { key: string; en: string; zh: string }[]> = {};
  for (const [group, pattern] of Object.entries(CATALOG_KEYS)) {
    const seen = new Set<string>();
    catalogs[group] = rows
      .filter((r) => pattern.test(r.key))
      .filter((r) => !seen.has(r.en) && seen.add(r.en) !== undefined)
      .map((r) => ({ key: r.key, en: r.en, zh: r.zh }));
  }
  return { seeds, catalogs, missing };
}

function bigrams(text: string): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < text.length - 1; i++) out.add(text.slice(i, i + 2));
  return out;
}

/** 内容包里要核对的中文名：义体、物品、地点和城区、人物、中间人 */
function contentNames(): [string, string][] {
  const out: [string, string][] = [];
  for (const c of cyberware) out.push(["义体", c.name]);
  for (const i of items) out.push(["物品", i.name]);
  for (const l of locations) {
    out.push(["地点", l.name]);
    if (l.district) out.push(["城区", l.district]);
  }
  for (const n of npcs as readonly { name?: string; card?: { name?: string } }[]) {
    const name = n.name ?? n.card?.name;
    if (name) out.push(["人物", name]);
  }
  for (const f of fixers) out.push(["中间人", f.name]);
  return out.filter(([, name], i) => out.findIndex(([, n]) => n === name) === i);
}

/** 官方只有一个词的武器名（统一、杀戮）在内容包里加了类别，核对时去掉 */
const WEAPON_SUFFIX = /(手枪|左轮|冲锋枪|突击步枪|霰弹枪|精准步枪|狙击步枪|轻机枪)$/;

function check(rows: readonly Row[], seeds: Record<string, Term[]>): string[] {
  const official = new Set(rows.map((r) => r.zh));
  const terms = Object.values(seeds).flat();
  const lines: string[] = [];
  for (const [kind, name] of contentNames()) {
    if (official.has(name) || official.has(name.replace(WEAPON_SUFFIX, ""))) continue;
    const mine = bigrams(name);
    const near = terms
      .filter((t) => t.zh !== name && [...bigrams(t.zh)].some((b) => mine.has(b)))
      .map((t) => `${t.zh}（${t.en}）`)
      .slice(0, 3);
    lines.push(
      `  ${kind}「${name}」不是官方文本里的写法${near.length > 0 ? `，相近的官方名：${near.join("、")}` : "，可能是自创的名字"}`,
    );
  }
  // 术语表：查得到官方译名的词，释义里要写到官方译名
  const byEn = new Map(terms.map((t) => [t.en.toLowerCase(), t]));
  for (const slang of glossary) {
    const t = byEn.get(slang.term.toLowerCase());
    // 官方文本照抄英文的（例如 ICE）不用核对
    if (t && t.zh.toLowerCase() !== slang.term.toLowerCase() && !slang.meaning.includes(t.zh)) {
      lines.push(`  术语表「${slang.term}」的释义没写官方译名“${t.zh}”`);
    }
  }
  return lines;
}

async function main(): Promise<void> {
  const path = process.argv[2] ?? process.env.CP_TEXT_DB ?? DEFAULT_DB;
  if (!existsSync(path)) {
    console.log(`找不到官方文本库：${path}`);
    console.log("跳过译名抽取和核对。可以用 CP_TEXT_DB 或命令行参数指定文本库的位置");
    return;
  }
  const started = Date.now();
  const rows = loadRows(path);
  const { seeds, catalogs, missing } = extract(rows);
  await mkdir(join(ROOT, "data", "lore"), { recursive: true });
  await writeFile(
    OUT,
    `${JSON.stringify({ source: path, generatedAt: new Date().toISOString(), seeds, catalogs }, null, 2)}\n`,
  );
  const found = Object.values(seeds).reduce((n, list) => n + list.length, 0);
  const listed = Object.entries(catalogs)
    .map(([g, list]) => `${g} ${list.length}`)
    .join("、");
  console.log(`读了 ${rows.length} 条屏幕文本，用时 ${Date.now() - started} ms`);
  console.log(`查到 ${found} 个术语的官方译名，目录：${listed}`);
  console.log(`写进 ${OUT}`);
  if (missing.length > 0) console.log(`文本库里没有直接对应的词：${missing.join("、")}`);

  const report = check(rows, seeds);
  if (report.length === 0) {
    console.log("内容包里的名字都和官方文本一致");
  } else {
    console.log(`内容包里有 ${report.length} 处和官方文本对不上（只是提醒，自创的名字可以不改）：`);
    for (const line of report) console.log(line);
  }
}

await main();
