import type { LlmMessage } from "../kernel/ports";

/**
 * 酒馆（SillyTavern）聊天补全预设的导入（用户定的）：
 * 提示词条目按 prompt_order 的顺序和开关叠在本作叙事提示词前面当写作风格，本作的规则、状态格式放在后面说了算；
 * 采样参数和正则脚本也带过来。只作用于叙事模型，辅助模型的抽取、核对、修复不套预设。
 * 酒馆的 marker 槽位（角色描述、世界书、聊天记录等）由本作自己的提示词填，不照搬；酒馆助手脚本不执行
 */

export interface PresetEntry {
  readonly id: string;
  readonly name: string;
  readonly role: LlmMessage["role"];
  readonly content: string;
  readonly enabled: boolean;
  /** null：放在最前面一段；数字：插进聊天记录，0 是紧挨着最新一条 */
  readonly depth: number | null;
}

export interface PresetRegex {
  readonly id: string;
  readonly name: string;
  readonly find: string;
  readonly flags: string;
  readonly replace: string;
  readonly enabled: boolean;
  /** 只改发给模型的历史，不改存下来的正文 */
  readonly promptOnly: boolean;
}

/** 带 undefined：后端用 zod 读存好的预设，可选字段读出来是 number | undefined */
export interface PresetSampling {
  readonly temperature?: number | undefined;
  readonly topP?: number | undefined;
  readonly topK?: number | undefined;
  readonly maxOutputTokens?: number | undefined;
}

export interface TavernPreset {
  readonly name: string;
  readonly entries: readonly PresetEntry[];
  readonly regex: readonly PresetRegex[];
  readonly sampling: PresetSampling;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const text = (v: unknown) => (typeof v === "string" ? v : "");
const ROLES = new Set(["system", "user", "assistant"]);

/** 酒馆的正则写成 /源码/标志；没有斜杠的当源码、不带标志 */
function splitRegex(raw: string): { find: string; flags: string } {
  const m = /^\/([\s\S]*)\/([dgimsuvy]*)$/.exec(raw);
  return m ? { find: m[1] ?? "", flags: m[2] ?? "" } : { find: raw, flags: "" };
}

/** 采样参数：只收有限的数；top_k、最大输出写 0 在酒馆里是不限，这里当没写 */
function readSampling(raw: Obj): PresetSampling {
  const temperature = num(raw.temperature);
  const topP = num(raw.top_p);
  const topK = num(raw.top_k);
  const maxOutputTokens = num(raw.openai_max_tokens);
  return {
    ...(temperature !== undefined ? { temperature } : {}),
    ...(topP !== undefined ? { topP } : {}),
    ...(topK !== undefined && topK > 0 ? { topK } : {}),
    ...(maxOutputTokens !== undefined && maxOutputTokens > 0
      ? { maxOutputTokens: Math.round(maxOutputTokens) }
      : {}),
  };
}

/** 酒馆界面美化/交互脚本类正则特征：本作只渲染纯文本正文，不执行 HTML/CSS/JS 模板 */
const HTML_UI_REGEX_RE =
  /<!doctype\s+html|<html\b|<head\b|<body\b|<script\b|<style\b|<iframe\b|<div\s+(?:class|id|style)=/i;

/** 判断一条预设正则的替换串是否属于酒馆前端 HTML/JS 界面美化脚本 */
export function isHtmlUiRegex(regex: Pick<PresetRegex, "replace">): boolean {
  return HTML_UI_REGEX_RE.test(regex.replace);
}

/** 预设常见的辅助元信息块（选项、摘要、注释、导演评论、IDE 追踪等），不应混入纯文本正文和记账抽取 */
const PRESET_META_BLOCKS: readonly RegExp[] = [
  /<!doctype\s+html[\s\S]*?<\/html>/gi,
  /<script(?:\s[^>]*)?>[\s\S]*?<\/script>/gi,
  /<style(?:\s[^>]*)?>[\s\S]*?<\/style>/gi,
  /<!--\s*\[IDE_AST_TRACE\][\s\S]*?-->/gi,
  /<<<\|catgodml\|[\s\S]*?>>>/gi,
  /<(options|choices|summary|sumUp|pose|comment|talk|background|run_tool_replacement)(?:\s[^>]*)?>[\s\S]*?<\/\1\s*>/gi,
  /<\|(?:sep|merge)\|>/gi,
];

/** 预设常见的正文外层容器标签：保留内部正文，剥去壳标签 */
const PRESET_WRAPPER_TAG_RE = /<\/?(?:game|content|hidden|story|body)(?:\s[^>]*)?>/gi;

/**
 * 清理酒馆预设输出里残留的界面 HTML、脚本、AST 追踪、选项/总结元标签与外层壳标签，
 * 避免污染存档正文，也避免把几十 KB 冗余标签或脚本送入第 ④ 步抽取导致超时/断连。
 * 若清理后整段变空，保底返回原文（不丢剧情）。
 */
export function sanitizePresetNarrative(input: string): string {
  let out = input;
  for (const re of PRESET_META_BLOCKS) {
    out = out.replace(re, "");
  }
  out = out.replace(PRESET_WRAPPER_TAG_RE, "");
  // 去掉因剥离块级标签产生的连续空行
  out = out.replace(/\n{3,}/g, "\n\n").trim();
  return out !== "" ? out : input.trim();
}

/** 读预设：条目取 prompt_order 里条目最多的那一份（酒馆里 100001 是默认那份），
 * marker（角色描述、聊天记录等槽位）和空条目跳过；正则只收 AI 输出（placement 含 2）那一类
 */
export function readTavernPreset(
  raw: unknown,
  name: string,
):
  | { readonly ok: true; readonly preset: TavernPreset; readonly warnings: readonly string[] }
  | { readonly ok: false; readonly error: string } {
  if (!isObj(raw)) return { ok: false, error: "不是酒馆预设：内容不是 JSON 对象" };
  if (!Array.isArray(raw.prompts))
    return { ok: false, error: "不是酒馆聊天补全预设：没有 prompts 字段" };
  const warnings: string[] = [];
  const byId = new Map<string, Obj>();
  for (const p of raw.prompts)
    if (isObj(p) && typeof p.identifier === "string") byId.set(p.identifier, p);

  const orders = (Array.isArray(raw.prompt_order) ? raw.prompt_order : [])
    .filter(isObj)
    .map((o) => (Array.isArray(o.order) ? o.order.filter(isObj) : []));
  const order = orders.reduce<Obj[]>((a, b) => (b.length > a.length ? b : a), []);
  // 没有排序表的老预设：按 prompts 原顺序，开关看条目自己的 enabled
  const listed =
    order.length > 0
      ? order.map((o) => ({ p: byId.get(text(o.identifier)), on: o.enabled !== false }))
      : [...byId.values()].map((p) => ({ p, on: p.enabled !== false }));

  const entries: PresetEntry[] = [];
  let macros = false;
  for (const { p, on } of listed) {
    if (!p || p.marker === true) continue;
    const content = text(p.content);
    if (content.trim() === "") continue;
    if (/\{\{(?:setvar|getvar|roll|random)\b/.test(content)) macros = true;
    const role = ROLES.has(text(p.role)) ? (text(p.role) as LlmMessage["role"]) : "system";
    const atDepth = p.injection_position === 1;
    entries.push({
      id: text(p.identifier),
      name: text(p.name) || text(p.identifier),
      role,
      content,
      enabled: on,
      depth: atDepth ? Math.max(0, Math.round(num(p.injection_depth) ?? 0)) : null,
    });
  }
  if (entries.length === 0) return { ok: false, error: "预设里没有能用的提示词条目" };
  if (macros)
    warnings.push(
      "条目里有 setvar/getvar/roll/random 宏：random、roll 照酒馆的规则掷，变量只在这一轮里有效",
    );

  const ext = isObj(raw.extensions) ? raw.extensions : {};
  const regex: PresetRegex[] = [];
  let htmlUiRegexCount = 0;
  for (const r of Array.isArray(ext.regex_scripts) ? ext.regex_scripts : []) {
    if (!isObj(r)) continue;
    const placement = Array.isArray(r.placement) ? r.placement : [];
    if (!placement.includes(2)) continue;
    const { find, flags } = splitRegex(text(r.findRegex));
    if (find === "") continue;
    try {
      new RegExp(find, flags);
    } catch {
      warnings.push(`正则「${text(r.scriptName)}」本机认不出，跳过了`);
      continue;
    }
    const replace = text(r.replaceString);
    const htmlUi = isHtmlUiRegex({ replace });
    if (htmlUi) htmlUiRegexCount += 1;
    regex.push({
      id: text(r.id) || text(r.scriptName),
      name: text(r.scriptName) || "未命名正则",
      find,
      flags,
      replace,
      // 只改显示（markdownOnly 且不改提示词）或替换串是 HTML/JS 界面美化脚本的，本作不渲染它的 HTML，默认关掉；
      // minDepth 大于 0 的只改较早的楼层、碰不到最新一条回复，本作只改最新回复，也默认关掉
      enabled:
        r.disabled !== true &&
        !htmlUi &&
        !(r.markdownOnly === true && r.promptOnly !== true) &&
        (num(r.minDepth) ?? 0) <= 0,
      promptOnly: r.promptOnly === true,
    });
  }
  if (htmlUiRegexCount > 0) {
    warnings.push(
      `已自动停用 ${htmlUiRegexCount} 条酒馆 HTML/脚本界面美化正则（本作使用独立纯文本界面，不执行这类模板）`,
    );
  }
  if (isObj(ext.tavern_helper)) warnings.push("预设带的酒馆助手脚本不会执行");

  return {
    ok: true,
    preset: {
      name: name.replace(/\.json$/i, "").slice(0, 60) || "未命名预设",
      entries,
      regex,
      sampling: readSampling(raw),
    },
    warnings,
  };
}

export interface MacroContext {
  readonly user: string;
  readonly char: string;
  readonly lastUserMessage: string;
  /** 1 到 sides 的整数；用回合的骰子来源，测试能固定 */
  readonly roll: (sides: number) => number;
}

/** {{trim}} 先换成这个私用区字符占位，展开完再连同前后空白一起去掉；正文里不会出现 */
const TRIM_MARK = "";
const TRIM_EAT = new RegExp(`\\s*${TRIM_MARK}\\s*`, "gu");

/**
 * 展开酒馆常用的宏：{{user}} {{char}} {{lastUserMessage}} {{random::a::b}} {{random:a,b}}
 * {{roll:XdY}} {{setvar::名::值}} {{getvar::名}} {{trim}} {{// 注释}}。变量只在这一轮的这几条条目里有效；
 * 不认识的宏原样留着
 */
export function expandMacros(input: string, ctx: MacroContext, vars: Map<string, string>): string {
  const pick = (list: readonly string[]) => list[ctx.roll(list.length) - 1] ?? "";
  let out = input.replace(/\{\{\/\/[\s\S]*?\}\}/g, "");
  // 内层先展开，最多套 5 层
  for (let pass = 0; pass < 5; pass++) {
    const next = out.replace(/\{\{([^{}]*)\}\}/g, (whole, body: string) => {
      const [head = "", ...rest] = body.split("::");
      const key = head.trim();
      const lower = key.toLowerCase();
      if (lower === "user") return ctx.user;
      if (lower === "char") return ctx.char;
      if (lower === "lastusermessage") return ctx.lastUserMessage;
      if (lower === "trim") return TRIM_MARK;
      if (lower === "setvar") {
        vars.set((rest[0] ?? "").trim(), rest.slice(1).join("::"));
        return "";
      }
      if (lower === "getvar") return vars.get((rest[0] ?? "").trim()) ?? "";
      if (lower === "random") return pick(rest);
      if (lower.startsWith("random:")) return pick(key.slice(7).split(","));
      // {{roll:2d6+1}}、{{roll:d20}}，也认酒馆的 {{roll 20}} / {{roll:20}}（一颗 20 面）
      const dice = /^roll[: ]\s*(?:(\d*)d)?(\d+)\s*([+-]\s*\d+)?$/i.exec(key);
      if (dice) {
        const count = Math.min(100, Number(dice[1] || 1));
        const sides = Math.max(1, Number(dice[2]));
        let sum = Number((dice[3] ?? "0").replace(/\s/g, ""));
        for (let i = 0; i < count; i++) sum += ctx.roll(sides);
        return String(sum);
      }
      return whole;
    });
    if (next === out) break;
    out = next;
  }
  // {{trim}} 吃掉自己前后的空白
  return out.replace(TRIM_EAT, "");
}

export interface ExpandedPreset {
  readonly head: readonly LlmMessage[];
  readonly inChat: readonly { readonly depth: number; readonly message: LlmMessage }[];
}

/** 一轮里展开好的条目：前置段的放在本作提示词前面，带深度的插进聊天记录 */
export function presetMessages(preset: TavernPreset, ctx: MacroContext): ExpandedPreset {
  const vars = new Map<string, string>();
  const head: LlmMessage[] = [];
  const inChat: { depth: number; message: LlmMessage }[] = [];
  for (const e of preset.entries) {
    if (!e.enabled) continue;
    const content = expandMacros(e.content, ctx, vars).trim();
    if (content === "") continue;
    const message = { role: e.role, content };
    if (e.depth === null) head.push(message);
    else inChat.push({ depth: e.depth, message });
  }
  return { head, inChat };
}

/**
 * 叠加（用户定的）：预设条目在最前面当写作风格，后面接一句交代，再接本作原有的整份消息，本作规则说了算；
 * 带深度的条目从后往前数插进聊天记录（0 插在最后一条之前，不压过本作最后一条指令）
 */
export function applyPreset(
  messages: readonly LlmMessage[],
  preset: TavernPreset,
  ctx: MacroContext,
): LlmMessage[] {
  return applyExpandedPreset(messages, presetMessages(preset, ctx));
}

/** 预算裁剪会重建消息；复用同一次宏展开，不能重复抽取 random / roll。 */
export function applyExpandedPreset(
  messages: readonly LlmMessage[],
  { head, inChat }: ExpandedPreset,
): LlmMessage[] {
  if (head.length === 0 && inChat.length === 0) return [...messages];
  const bridge: LlmMessage = {
    role: "system",
    content:
      "以上是玩家导入的写作预设，负责文风、修辞、节奏与篇幅。下面是本游戏的世界事实、人物知情边界、本轮已定裁决与纯文本输出协议；文风归预设，世界事实、玩家边界、已定结果与纯文本输出以下面为准。",
  };
  const out: LlmMessage[] = [...head, ...(head.length > 0 ? [bridge] : []), ...messages];
  for (const { depth, message } of [...inChat].sort((a, b) => b.depth - a.depth)) {
    const at = Math.max(head.length > 0 ? head.length + 1 : 0, out.length - 1 - depth);
    out.splice(at, 0, message);
  }
  return out;
}

/** 预设正则用在模型输出上：本作存下的正文照这个改；跳过 HTML/JS 界面美化脚本和坏掉的正则 */
export function applyPresetRegex(input: string, preset: TavernPreset): string {
  let out = input;
  for (const r of preset.regex) {
    if (!r.enabled || isHtmlUiRegex(r)) continue;
    try {
      out = out.replace(new RegExp(r.find, r.flags), r.replace.replace(/\{\{match\}\}/gi, "$&"));
    } catch {
      // 读预设时已经试过一遍，这里兜底
    }
  }
  return out;
}

/** 预设的采样参数填进叙事请求；连接里另设了的，以预设为准 */
export function presetSampling(preset: TavernPreset | undefined): PresetSampling {
  return preset?.sampling ?? {};
}
