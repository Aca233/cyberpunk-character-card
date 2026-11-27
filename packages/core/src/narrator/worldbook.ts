import type { LlmMessage } from "../kernel/ports";
import { expandMacros, type MacroContext } from "./preset";
import { estimateTokens } from "./prompts/layers";

/**
 * 酒馆（SillyTavern）世界书（World Info / Lorebook）解析、关键词扫描与上下文注入：
 * - 兼容标准 SillyTavern World Info JSON（entries 为对象映射或数组）以及角色卡 V2/V3 的 character_book；
 * - 蓝灯常驻（constant 且非 @D）归入静态 system 前缀块，跨回合稳定命中 KV 缓存；
 * - 绿灯关键词动态命中（非 constant 且非 @D）放入本轮 user 消息【附加世界书】槽位，不击穿静态缓存；
 * - @D（position === "at_depth"）按设定 depth 与 role 插入对话历史，且先于酒馆预设叠加，零干扰预设破甲链路。
 */

export type WorldbookPosition = "before" | "after" | "at_depth";

/** 次级关键词匹配逻辑（对齐 SillyTavern selectiveLogic）：0=任一命中 1=并非全中 2=全不命中 3=全部命中 */
export type SelectiveLogic = 0 | 1 | 2 | 3;

export interface WorldbookEntry {
  readonly id: string;
  readonly name: string;
  readonly content: string;
  readonly enabled: boolean;
  /** 蓝灯常驻：无视关键词每轮固定注入 */
  readonly constant: boolean;
  /** 主关键词（支持 /pattern/flags 正则写法） */
  readonly keys: readonly string[];
  /** 次级关键词（selective=true 时生效） */
  readonly secondaryKeys: readonly string[];
  readonly selective: boolean;
  readonly selectiveLogic: SelectiveLogic;
  readonly caseSensitive: boolean;
  readonly matchWholeWords: boolean;
  /** 排序优先级（越大越靠后/越受重视） */
  readonly order: number;
  readonly position: WorldbookPosition;
  /** position === "at_depth" 时的倒数深度（0 为紧贴最后一条用户消息之前） */
  readonly depth: number;
  readonly role: LlmMessage["role"];
  /** 覆盖书级默认扫描深度；null 表示沿用书级设置 */
  readonly scanDepth: number | null;
}

export interface TavernWorldbook {
  readonly name: string;
  /** 默认扫描最近几轮原文（0 表示只扫本轮输入与当前在场人物/地点） */
  readonly scanDepth: number;
  /** 递归扫描：已触发条目的正文是否继续触发其他绿灯条目（最多 2 轮防死循环） */
  readonly recursiveScanning: boolean;
  readonly entries: readonly WorldbookEntry[];
}

export interface ActiveWorldbook extends TavernWorldbook {
  readonly id: string;
}

export interface WorldbookHit {
  readonly bookId: string;
  readonly bookName: string;
  readonly entryId: string;
  readonly entryName: string;
  readonly constant: boolean;
  readonly matchedKey: string | null;
  readonly position: WorldbookPosition;
  readonly depth: number;
  readonly role: LlmMessage["role"];
  readonly order: number;
  readonly content: string;
  readonly tokens: number;
}

export interface ResolvedWorldbook {
  /** 蓝灯常驻（非 @D）合并段：可安全放入静态 system 缓存层 */
  readonly constantBefore: string | undefined;
  readonly constantAfter: string | undefined;
  /** 绿灯动态命中（非 @D）条目：按 order 排好，放进 user 消息，超预算时可从低优先级裁起 */
  readonly dynamicEntries: readonly WorldbookHit[];
  /** @D 深度注入条目：按 depth / order 排好 */
  readonly atDepth: readonly WorldbookHit[];
  /** 全部命中条目明细（含估算 token），供预算与上下文查看器追踪 */
  readonly hits: readonly WorldbookHit[];
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

function toStringList(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.flatMap((v) => (typeof v === "string" ? [v.trim()] : [])).filter((s) => s !== "");
  }
  if (typeof raw === "string") {
    return raw
      .split(/[,，\n]/)
      .map((s) => s.trim())
      .filter((s) => s !== "");
  }
  return [];
}

function parseRole(raw: unknown): LlmMessage["role"] {
  if (raw === 1 || raw === "user") return "user";
  if (raw === 2 || raw === "assistant") return "assistant";
  return "system";
}

function parsePosition(raw: unknown, extPos?: unknown): WorldbookPosition {
  const pos = raw !== undefined ? raw : extPos;
  if (pos === 4 || pos === "at_depth" || pos === "in_chat") return "at_depth";
  if (pos === 0 || pos === 2 || pos === 5 || pos === "before" || pos === "before_char") {
    return "before";
  }
  return "after";
}

function parseSelectiveLogic(raw: unknown): SelectiveLogic {
  if (raw === 1 || raw === 2 || raw === 3) return raw;
  return 0;
}

function extractBookContainer(raw: unknown): { container: Obj; fallbackName?: string } | null {
  if (!isObj(raw)) return null;
  if (raw.entries !== undefined) {
    return {
      container: raw,
      ...(typeof raw.name === "string" && raw.name.trim() ? { fallbackName: raw.name.trim() } : {}),
    };
  }
  // 兼容酒馆 V2 / V3 角色卡内嵌 character_book
  if (isObj(raw.character_book) && raw.character_book.entries !== undefined) {
    return {
      container: raw.character_book,
      ...(typeof raw.character_book.name === "string" && raw.character_book.name.trim()
        ? { fallbackName: raw.character_book.name.trim() }
        : typeof raw.name === "string" && raw.name.trim()
          ? { fallbackName: raw.name.trim() }
          : {}),
    };
  }
  if (
    isObj(raw.data) &&
    isObj(raw.data.character_book) &&
    raw.data.character_book.entries !== undefined
  ) {
    const book = raw.data.character_book;
    return {
      container: book,
      ...(typeof book.name === "string" && book.name.trim()
        ? { fallbackName: book.name.trim() }
        : typeof raw.data.name === "string" && raw.data.name.trim()
          ? { fallbackName: raw.data.name.trim() }
          : {}),
    };
  }
  return null;
}

/** 解析 SillyTavern World Info JSON 或角色卡 character_book */
export function readTavernWorldbook(
  raw: unknown,
  fileName: string,
):
  | { readonly ok: true; readonly worldbook: TavernWorldbook; readonly warnings: readonly string[] }
  | { readonly ok: false; readonly error: string } {
  const found = extractBookContainer(raw);
  if (!found) {
    return {
      ok: false,
      error:
        "不是酒馆世界书：缺少 entries 字段（支持标准 World Info JSON 或角色卡 character_book）",
    };
  }
  const { container, fallbackName } = found;
  const rawEntries: Obj[] = Array.isArray(container.entries)
    ? container.entries.filter(isObj)
    : isObj(container.entries)
      ? Object.entries(container.entries)
          .sort(([a], [b]) => {
            const na = Number(a);
            const nb = Number(b);
            if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
            return a.localeCompare(b);
          })
          .flatMap(([key, value]): Obj[] => (isObj(value) ? [{ _mapKey: key, ...value }] : []))
      : [];

  const warnings: string[] = [];
  const seenIds = new Set<string>();
  const entries: WorldbookEntry[] = [];
  let hasMacros = false;
  let skippedEmpty = 0;

  for (let i = 0; i < rawEntries.length; i += 1) {
    const e = rawEntries[i] as Obj;
    const ext = isObj(e.extensions) ? e.extensions : {};
    const content = str(e.content);
    if (content.trim() === "") {
      skippedEmpty += 1;
      continue;
    }
    if (/\{\{(?:setvar|getvar|roll|random)\b/i.test(content)) hasMacros = true;

    const rawId =
      e.uid !== undefined
        ? String(e.uid)
        : e.id !== undefined
          ? String(e.id)
          : typeof e._mapKey === "string"
            ? e._mapKey
            : String(i);
    let id = rawId.replace(/[^a-zA-Z0-9._-]/g, "_") || `e${i}`;
    while (seenIds.has(id)) id = `${id}_${i}`;
    seenIds.add(id);

    const keys = toStringList(e.key ?? e.keys);
    const secondaryKeys = toStringList(e.keysecondary ?? e.secondary_keys);
    const constant = e.constant === true;
    const enabled = e.disable !== true && e.disabled !== true && e.enabled !== false;
    const rawName = str(e.comment).trim() || str(e.name).trim();
    const name = rawName || keys[0] || `条目 #${i + 1}`;
    const position = parsePosition(e.position, ext.position);
    const depth = Math.max(0, Math.round(num(e.depth) ?? num(ext.depth) ?? 4));
    const role = parseRole(e.role ?? ext.role);
    const order = Math.round(num(e.order) ?? num(e.insertion_order) ?? 100);
    const selective = e.selective === true || secondaryKeys.length > 0;
    const selectiveLogic = parseSelectiveLogic(e.selectiveLogic ?? ext.selectiveLogic);
    const caseSensitive =
      e.caseSensitive === true || e.case_sensitive === true || ext.case_sensitive === true;
    const matchWholeWords =
      e.matchWholeWords === true || e.match_whole_words === true || ext.match_whole_words === true;
    const rawScanDepth = num(e.scanDepth) ?? num(ext.scan_depth);
    const scanDepth =
      rawScanDepth !== undefined && rawScanDepth >= 0 ? Math.round(rawScanDepth) : null;

    entries.push({
      id,
      name: name.slice(0, 80),
      content,
      enabled,
      constant,
      keys,
      secondaryKeys,
      selective,
      selectiveLogic,
      caseSensitive,
      matchWholeWords,
      order,
      position,
      depth,
      role,
      scanDepth,
    });
  }

  if (entries.length === 0) {
    return { ok: false, error: "世界书里没有包含正文内容的可用条目" };
  }
  if (skippedEmpty > 0) {
    warnings.push(`已跳过 ${skippedEmpty} 条正文为空的条目`);
  }
  if (hasMacros) {
    warnings.push(
      "部分条目包含酒馆宏（random/roll/setvar/getvar），将在注入正文时按本轮上下文展开",
    );
  }

  const rawBookScanDepth = num(container.scan_depth) ?? num(container.scanDepth);
  const scanDepth =
    rawBookScanDepth !== undefined && rawBookScanDepth >= 0
      ? Math.min(20, Math.round(rawBookScanDepth))
      : 4;
  const recursiveScanning =
    container.recursive_scanning !== false && container.recursiveScanning !== false;
  const cleanFileName = fileName.replace(/\.json$/i, "").trim();
  const name = (fallbackName || cleanFileName || "未命名世界书").slice(0, 60);

  return {
    ok: true,
    worldbook: {
      name,
      scanDepth,
      recursiveScanning,
      entries,
    },
    warnings,
  };
}

/** 导出为标准 SillyTavern World Info JSON 格式（可直接导回酒馆） */
export function exportTavernWorldbook(book: TavernWorldbook): Record<string, unknown> {
  const entries: Record<string, unknown> = {};
  book.entries.forEach((entry, index) => {
    const posCode = entry.position === "before" ? 0 : entry.position === "at_depth" ? 4 : 1;
    const roleCode = entry.role === "user" ? 1 : entry.role === "assistant" ? 2 : 0;
    entries[String(index)] = {
      uid: index,
      key: [...entry.keys],
      keysecondary: [...entry.secondaryKeys],
      comment: entry.name,
      content: entry.content,
      constant: entry.constant,
      selective: entry.selective,
      selectiveLogic: entry.selectiveLogic,
      order: entry.order,
      position: posCode,
      disable: !entry.enabled,
      depth: entry.depth,
      role: roleCode,
      caseSensitive: entry.caseSensitive,
      matchWholeWords: entry.matchWholeWords,
      scanDepth: entry.scanDepth,
    };
  });
  return {
    name: book.name,
    scan_depth: book.scanDepth,
    recursive_scanning: book.recursiveScanning,
    entries,
  };
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchSingleKey(
  haystack: string,
  key: string,
  caseSensitive: boolean,
  matchWholeWords: boolean,
): boolean {
  const trimmed = key.trim();
  if (trimmed === "") return false;
  // 支持酒馆 /pattern/flags 正则关键词
  const reLiteral = /^\/([\s\S]+)\/([dgimsuvy]*)$/.exec(trimmed);
  if (reLiteral?.[1]) {
    try {
      const flags = reLiteral[2] ?? "";
      return new RegExp(reLiteral[1], flags).test(haystack);
    } catch {
      return false;
    }
  }
  if (matchWholeWords && /^[A-Za-z0-9_\s-]+$/.test(trimmed)) {
    const flags = caseSensitive ? "" : "i";
    return new RegExp(`\\b${escapeRegex(trimmed)}\\b`, flags).test(haystack);
  }
  if (caseSensitive) return haystack.includes(trimmed);
  return haystack.toLowerCase().includes(trimmed.toLowerCase());
}

function matchEntryKeys(entry: WorldbookEntry, haystack: string): string | null {
  if (entry.keys.length === 0) return null;
  let primaryHit: string | null = null;
  for (const key of entry.keys) {
    if (matchSingleKey(haystack, key, entry.caseSensitive, entry.matchWholeWords)) {
      primaryHit = key;
      break;
    }
  }
  if (primaryHit === null) return null;

  if (!entry.selective || entry.secondaryKeys.length === 0) {
    return primaryHit;
  }
  const hits = entry.secondaryKeys.map((k) =>
    matchSingleKey(haystack, k, entry.caseSensitive, entry.matchWholeWords),
  );
  const anyHit = hits.some(Boolean);
  const allHit = hits.every(Boolean);
  switch (entry.selectiveLogic) {
    case 0: // AND_ANY
      return anyHit ? primaryHit : null;
    case 1: // NOT_ALL
      return !allHit ? primaryHit : null;
    case 2: // NOT_ANY
      return !anyHit ? primaryHit : null;
    case 3: // AND_ALL
      return allHit ? primaryHit : null;
  }
}

export interface WorldbookEvalContext {
  /** 本轮玩家输入文本 */
  readonly inputText: string;
  /** 最近已完成轮次的文本列表（从旧到新） */
  readonly recentTurnTexts: readonly string[];
  /** 当前所在地点名与在场人物名/外号，用于自然触发对应设定条目 */
  readonly sceneTerms: readonly string[];
  /** 宏展开上下文（复用本轮随机数流） */
  readonly macro: MacroContext;
}

const MAX_RECURSION_ROUNDS = 2;

/**
 * 评估全部已启用世界书：匹配蓝灯常驻 + 绿灯关键词（含递归扫描），展开酒馆宏并按缓存分层归类。
 */
export function resolveWorldbooks(
  books: readonly ActiveWorldbook[],
  ctx: WorldbookEvalContext,
): ResolvedWorldbook {
  if (books.length === 0) {
    return {
      constantBefore: undefined,
      constantAfter: undefined,
      dynamicEntries: [],
      atDepth: [],
      hits: [],
    };
  }

  const vars = new Map<string, string>();
  const sceneText = ctx.sceneTerms.filter((t) => t.trim() !== "").join(" ");
  const haystackCache = new Map<number, string>();
  const baseHaystack = (depth: number): string => {
    const clamped = Math.max(0, Math.min(20, depth));
    const cached = haystackCache.get(clamped);
    if (cached !== undefined) return cached;
    const recent = clamped > 0 ? ctx.recentTurnTexts.slice(-clamped).join("\n") : "";
    const combined = [recent, sceneText, ctx.inputText].filter(Boolean).join("\n");
    haystackCache.set(clamped, combined);
    return combined;
  };

  interface PendingHit {
    readonly book: ActiveWorldbook;
    readonly entry: WorldbookEntry;
    readonly matchedKey: string | null;
    readonly expanded: string;
  }

  const triggered = new Map<string, PendingHit>();
  const keyOf = (bookId: string, entryId: string) => `${bookId}::${entryId}`;

  const tryActivate = (book: ActiveWorldbook, entry: WorldbookEntry, matchedKey: string | null) => {
    const k = keyOf(book.id, entry.id);
    if (triggered.has(k)) return false;
    const expanded = expandMacros(entry.content, ctx.macro, vars).trim();
    if (expanded === "") return false;
    triggered.set(k, { book, entry, matchedKey, expanded });
    return true;
  };

  // 第 1 轮：蓝灯常驻 + 直接关键词命中
  for (const book of books) {
    for (const entry of book.entries) {
      if (!entry.enabled) continue;
      if (entry.constant) {
        tryActivate(book, entry, null);
        continue;
      }
      const depth = entry.scanDepth ?? book.scanDepth;
      const hit = matchEntryKeys(entry, baseHaystack(depth));
      if (hit !== null) {
        tryActivate(book, entry, hit);
      }
    }
  }

  // 递归扫描：已触发条目的展开正文继续触发启用了 recursiveScanning 的世界书条目
  let frontier = [...triggered.values()].map((h) => h.expanded).join("\n");
  for (let round = 0; round < MAX_RECURSION_ROUNDS && frontier !== ""; round += 1) {
    const newlyAdded: string[] = [];
    for (const book of books) {
      if (!book.recursiveScanning) continue;
      for (const entry of book.entries) {
        if (!entry.enabled || entry.constant) continue;
        if (triggered.has(keyOf(book.id, entry.id))) continue;
        const hit = matchEntryKeys(entry, frontier);
        if (hit !== null && tryActivate(book, entry, `递归:${hit}`)) {
          const added = triggered.get(keyOf(book.id, entry.id));
          if (added) newlyAdded.push(added.expanded);
        }
      }
    }
    frontier = newlyAdded.join("\n");
  }

  const allHits: WorldbookHit[] = [...triggered.values()]
    .map(({ book, entry, matchedKey, expanded }) => ({
      bookId: book.id,
      bookName: book.name,
      entryId: entry.id,
      entryName: entry.name,
      constant: entry.constant,
      matchedKey,
      position: entry.position,
      depth: entry.depth,
      role: entry.role,
      order: entry.order,
      content: expanded,
      tokens: estimateTokens(expanded) + 6,
    }))
    .sort((a, b) => a.order - b.order || a.entryName.localeCompare(b.entryName));

  const constBefore = allHits
    .filter((h) => h.constant && h.position === "before")
    .map((h) => h.content);
  const constAfter = allHits
    .filter((h) => h.constant && h.position === "after")
    .map((h) => h.content);
  const dynamicEntries = allHits.filter((h) => !h.constant && h.position !== "at_depth");
  const atDepth = allHits.filter((h) => h.position === "at_depth");

  return {
    constantBefore:
      constBefore.length > 0 ? `【附加世界书（常驻）】\n${constBefore.join("\n\n")}` : undefined,
    constantAfter:
      constAfter.length > 0 ? `【附加世界书（常驻补充）】\n${constAfter.join("\n\n")}` : undefined,
    dynamicEntries,
    atDepth,
    hits: allHits,
  };
}

/** 渲染动态关键词命中的世界书条目块（放入 user 消息，不打断静态 system / history KV 缓存） */
export function worldbookDynamicSection(entries: readonly WorldbookHit[]): string | undefined {
  if (entries.length === 0) return undefined;
  return ["【附加世界书】", ...entries.map((e) => e.content)].join("\n\n");
}

/**
 * 将 @D 深度世界书条目插入消息序列（必须在 applyExpandedPreset 之前调用，确保酒馆预设的 head 与 depth:0 破甲位置完全不受影响）。
 */
export function applyWorldbookDepth(
  messages: readonly LlmMessage[],
  atDepth: readonly WorldbookHit[],
): LlmMessage[] {
  if (atDepth.length === 0) return [...messages];
  const out = [...messages];
  const sorted = [...atDepth].sort((a, b) => b.depth - a.depth || a.order - b.order);
  const firstNonSystem = out.findIndex((m) => m.role !== "system");
  const minIndex = firstNonSystem >= 0 ? firstNonSystem : out.length - 1;
  for (const item of sorted) {
    const at = Math.max(minIndex, out.length - 1 - item.depth);
    out.splice(at, 0, { role: item.role, content: item.content });
  }
  return out;
}
