import { existsSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { LoreHit, LoreQuery, LoreSource, LoreTerm } from "@cp/core";

/**
 * 运行时设定库（规格“官方文本库”第 7 条）：启动时只读打开本机文本库一次，
 * 把几类能分清剧透的原作资料读进内存，每轮按检索词做包含匹配。
 * 文本库来自未核验的 _unpack，只在本机用；正文不进仓库，存档里也只记来源键和当时发出的引用块。
 *
 * 收哪些（都是基础版 part=base）：资料库的地点、术语和人物词条，加载短文，
 * 不挂任务的通用数据芯片，支线和街头委托的数据芯片。
 * 不收：往日之影（ep1）、主线和 DLC 任务的芯片、主线人物的词条、字幕（没有路径，分不清剧透）、
 * 没有键的文本（同上）、教程。
 */

interface Row {
  readonly key: string;
  readonly zh: string;
}

interface Entry {
  readonly source: string;
  readonly title: string;
  readonly kind: string;
  readonly text: string;
}

const KINDS: readonly (readonly [RegExp, string])[] = [
  [/journal-codex-locations-/, "地点资料"],
  [/journal-codex-glossary-/, "术语"],
  [/journal-codex-characters-/, "人物资料"],
  [/^Story-LoreText-/, "加载短文"],
  [/journal-onscreens-emails-generic-shards-/, "数据芯片"],
  [/journal-onscreens-emails-quests-/, "委托芯片"],
];

/** 主线、DLC 的任务路径 */
const SPOILER_PATH = /main_quest|-dlc-|-dlc\d|_dlc\d/i;
/** 资料库里主线人物的词条（按键名）；剩下的大多是中间人和支线人物。名单是看词条首句挑的，没逐条核对剧情 */
const SPOILER_PEOPLE = /codex-characters-(Dexter|Hanako|Adam_smasher|Mr_hands)/i;
/** 资料库词条的正文后缀；去掉后缀加 _title 就是标题 */
const BODY_SUFFIX = /(_desc_textContent|_textContent|_desc_content|_description\d*|_desc)$/i;
const TITLE_SUFFIX = /_title\d*$/i;
const TITLE_MAX = 24;
const MIN_CHARS = 40;
/** 每轮最多返回多少条候选；core 再打分挑前 3 */
const CANDIDATES = 60;

function chars(s: string): number {
  return [...s].length;
}

/** 文本库里的换行是字面的 \n；去掉 <Input …> 这类标记 */
export function cleanLore(raw: string): string {
  return raw
    .replaceAll("\\n", "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function kindOf(key: string): string | undefined {
  return KINDS.find(([re]) => re.test(key))?.[1];
}

function fallbackTitle(text: string): string {
  const first = text.split(/[。！？\n]/)[0] ?? text;
  return chars(first) <= 14 ? first : `${[...first].slice(0, 12).join("")}…`;
}

const TERM_GROUPS = ["factions", "districts", "places", "people", "roles", "terms"] as const;

interface TermsFile {
  readonly seeds?: Partial<
    Record<string, readonly { readonly zh?: string; readonly variants?: readonly string[] }[]>
  >;
}

export class LoreLibrary implements LoreSource {
  private constructor(
    private readonly entries: readonly Entry[],
    /** 输入里认得出的专有名词：本机术语表的势力、城区、地点、人物、身份、术语，加上资料库词条的标题 */
    private readonly dictionary: readonly string[],
  ) {}

  get size(): number {
    return this.entries.length;
  }

  get terms(): number {
    return this.dictionary.length;
  }

  /** 没有文本库时返回 undefined，设定库就不接；术语表没有也能用，只是认不出输入里的专有名词 */
  static open(dbPath: string | undefined, termsPath: string | undefined): LoreLibrary | undefined {
    if (!dbPath || !existsSync(dbPath)) return undefined;
    const db = new DatabaseSync(dbPath, { readOnly: true });
    let rows: Row[];
    try {
      rows = db
        .prepare(
          `SELECT secondary_key AS key, zh FROM onscreen
           WHERE part = 'base' AND zh IS NOT NULL AND (
             secondary_key LIKE '%journal-codex-%' OR secondary_key LIKE 'Story-LoreText-%'
             OR secondary_key LIKE '%journal-onscreens-emails-generic-shards-%'
             OR secondary_key LIKE '%journal-onscreens-emails-quests-%')`,
        )
        .all() as unknown as Row[];
    } finally {
      db.close();
    }

    const dictionary = new Set<string>();
    /** 城区和地点名：没标题的地点词条正文开头是它时拿来当标题（势力名不算，“荒坂的西海岸总部…”讲的是荒坂塔） */
    const placeNames = new Set<string>();
    if (termsPath && existsSync(termsPath)) {
      try {
        const file = JSON.parse(readFileSync(termsPath, "utf8")) as TermsFile;
        for (const group of TERM_GROUPS) {
          for (const t of file.seeds?.[group] ?? []) {
            for (const s of [t.zh ?? "", ...(t.variants ?? [])]) {
              dictionary.add(s.trim());
              if (group === "districts" || group === "places") placeNames.add(s.trim());
            }
          }
        }
      } catch {
        // 术语表坏了就只用词条标题
      }
    }
    const seeds = [...placeNames].filter((s) => chars(s) >= 2).sort((a, b) => chars(b) - chars(a));

    const titles = new Map<string, string>();
    for (const r of rows) {
      const zh = cleanLore(r.zh);
      if (TITLE_SUFFIX.test(r.key) && chars(zh) <= TITLE_MAX && !zh.startsWith("!")) {
        titles.set(r.key.replace(TITLE_SUFFIX, "").toLowerCase(), zh);
      }
    }

    const entries: Entry[] = [];
    const seen = new Set<string>();
    for (const r of rows) {
      const kind = kindOf(r.key);
      if (kind === undefined || SPOILER_PATH.test(r.key) || SPOILER_PEOPLE.test(r.key)) continue;
      if (/codex-tutorials|_found_text$/i.test(r.key)) continue;
      const text = cleanLore(r.zh);
      if (chars(text) < MIN_CHARS || text.startsWith("!") || seen.has(text)) continue;
      // 标题键里有时放的是整段正文（例如人物词条），按正文收
      if (TITLE_SUFFIX.test(r.key) && chars(text) <= TITLE_MAX) continue;
      seen.add(text);
      const base = r.key.replace(BODY_SUFFIX, "").replace(TITLE_SUFFIX, "").toLowerCase();
      entries.push({
        source: `text:${r.key}`,
        title:
          titles.get(base) ??
          (kind === "加载短文"
            ? "夜之城"
            : (seeds.find((w) => text.startsWith(w)) ?? fallbackTitle(text))),
        kind,
        text,
      });
    }

    for (const e of entries) {
      if (e.kind === "地点资料" || e.kind === "术语" || e.kind === "人物资料") {
        if (!e.title.endsWith("…")) dictionary.add(e.title);
      }
    }
    const words = [...dictionary].filter((s) => chars(s) >= 2 && !/^[A-Za-z0-9 ]+$/.test(s));
    // 长词在前：输入里有“荒坂塔”就不再单独算“荒坂”
    words.sort((a, b) => chars(b) - chars(a));
    return new LoreLibrary(entries, words);
  }

  /** 输入里点到的专有名词；被更长的词盖住的短词不算 */
  inputTerms(input: string): string[] {
    const found: string[] = [];
    for (const w of this.dictionary) {
      if (input.includes(w) && !found.some((f) => f.includes(w))) found.push(w);
    }
    return found;
  }

  search(query: LoreQuery): LoreHit[] {
    const terms: LoreTerm[] = [...query.terms];
    for (const w of this.inputTerms(query.input)) {
      if (!terms.some((t) => t.term === w)) terms.push({ term: w, why: "input" });
    }
    if (terms.length === 0) return [];
    const hits: LoreHit[] = [];
    for (const e of this.entries) {
      const matched = terms.filter((t) => e.title.includes(t.term) || e.text.includes(t.term));
      if (matched.length === 0) continue;
      hits.push({
        ...e,
        hits: matched,
        inTitle: matched.filter((t) => e.title.includes(t.term)).map((t) => t.term),
      });
    }
    return hits
      .sort((a, b) => b.hits.length - a.hits.length || chars(a.text) - chars(b.text))
      .slice(0, CANDIDATES);
  }
}
