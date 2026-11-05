import type { PlayerView, TurnInput } from "@cp/core";
import type { AssetId } from "../../assets";

/** 剧情界面用到的纯函数：不碰 React，也不发请求 */

export type View = PlayerView;
export type Turn = View["turns"][number];
export type CheckOffer = View["offers"]["checks"][number];
export type Choice = View["offers"]["choices"][number];
export type DamageTier = NonNullable<CheckOffer["damage"]>;
export type Outcome = "critical" | "success" | "costly" | "failure" | "fumble";

/** 地点 id 里出现这些词就用对应地区的图标；都不匹配时用夜之城 */
const DISTRICTS: readonly (readonly [AssetId, readonly string[]])[] = [
  ["district.dogtown", ["dogtown", "狗镇"]],
  [
    "district.watson",
    ["watson", "kabuki", "northside", "little-china", "littlechina", "沃森", "歌舞伎"],
  ],
  [
    "district.westbrook",
    [
      "westbrook",
      "japantown",
      "charter",
      "north-oak",
      "northoak",
      "威斯特布鲁克",
      "威斯布鲁克",
      "日本街",
    ],
  ],
  ["district.center", ["center", "centre", "corpo", "downtown", "市政中心", "市中心"]],
  ["district.heywood", ["heywood", "wellsprings", "glen", "vista", "海伍德"]],
  ["district.domingo", ["domingo", "arroyo", "rancho", "圣多明戈"]],
  ["district.pacifica", ["pacifica", "coastview", "westwind", "west-wind", "太平洲"]],
  ["district.badlands", ["badlands", "rocky", "peaks", "biotechnica", "恶土"]],
];

export function districtIcon(location: string | null): AssetId {
  if (location === null) return "district.nightcity";
  const id = location.toLowerCase();
  for (const [icon, words] of DISTRICTS) {
    if (words.some((w) => id.includes(w))) return icon;
  }
  return "district.nightcity";
}

/** 地图数据还没有（第 6 片），先把地点 id 整理成能读的样子 */
export function locationLabel(location: string | null): string {
  if (location === null) return "未知地点";
  return location.replace(/[._/]+/g, " · ").replace(/-/g, " ");
}

export interface Speaker {
  readonly name: string;
  readonly self: boolean;
  /** 人物的 id：点了打开人物档案；玩家自己和地点没有 */
  readonly npc?: string | undefined;
  /** 地点的 id：点了打开地图并选中它，照常出行，不传送；人物没有 */
  readonly place?: string | undefined;
}

export interface Segment {
  readonly text: string;
  readonly speaker?: Speaker | undefined;
}

/**
 * 正文里要标出来的名字：玩家自己、见过和听说过的人（连同外号）、地图上的地点（第 3 条，用户定的"本地匹配"，2026-11-02）。
 * 只在网页上按名字匹配，正文原样不改。同名时人物优先，去过的地点优先于没去过的原作地点；
 * 长的先匹配，免得「丽贝」吃掉「丽贝卡」
 */
export function speakersOf(view: View): Speaker[] {
  const out: Speaker[] = [];
  if (view.character.name) out.push({ name: view.character.name, self: true });
  for (const npc of view.npcs) {
    out.push({ name: npc.name, self: false, npc: npc.id });
    if (npc.alias) out.push({ name: npc.alias, self: false, npc: npc.id });
  }
  const places = [...view.travel.destinations].sort(
    (a, b) => Number(a.firstVisit) - Number(b.firstVisit),
  );
  for (const d of places) out.push({ name: d.name, self: false, place: d.id });
  const seen = new Set<string>();
  return out
    .filter((s) => {
      const name = s.name.trim();
      // 单个字太容易误标（比如地点叫「港」），至少两个字才标
      if ([...name].length < 2 || seen.has(name)) return false;
      seen.add(name);
      return true;
    })
    .sort((a, b) => b.name.length - a.name.length);
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** 把一段正文切成普通文字和名字 */
export function splitSpeakers(text: string, speakers: readonly Speaker[]): Segment[] {
  if (speakers.length === 0) return [{ text }];
  // 同名的只认第一个（speakersOf 已经去重，这里再保一次）
  const byName = new Map<string, Speaker>();
  for (const s of speakers) if (!byName.has(s.name)) byName.set(s.name, s);
  const pattern = new RegExp(`(${speakers.map((s) => escapeRegExp(s.name)).join("|")})`, "g");
  return text
    .split(pattern)
    .filter((part) => part !== "")
    .map((part) => ({ text: part, speaker: byName.get(part) }));
}

/** 黑话术语表里的一条；来自 GET /api/glossary */
export interface Gloss {
  readonly term: string;
  readonly aliases?: readonly string[] | undefined;
  readonly meaning: string;
}

export interface GlossMatcher {
  readonly pattern: RegExp;
  /** 小写的写法 → 释义 */
  readonly meanings: ReadonlyMap<string, string>;
}

/** 把术语表编成一个正则；只匹配拉丁字母写的词，前后不能紧挨别的字母，不分大小写 */
export function glossMatcher(glossary: readonly Gloss[]): GlossMatcher | null {
  const meanings = new Map<string, string>();
  for (const g of glossary) {
    for (const word of [g.term, ...(g.aliases ?? [])]) {
      const key = word.trim().toLowerCase();
      if (key !== "" && !meanings.has(key)) meanings.set(key, g.meaning);
    }
  }
  if (meanings.size === 0) return null;
  const words = [...meanings.keys()].sort((a, b) => b.length - a.length).map(escapeRegExp);
  return { pattern: new RegExp(`(?<![A-Za-z])(${words.join("|")})(?![A-Za-z])`, "gi"), meanings };
}

/** 把一段普通文字切成普通文字和带释义的黑话 */
export function splitSlang(
  text: string,
  matcher: GlossMatcher | null | undefined,
): { readonly text: string; readonly meaning?: string | undefined }[] {
  if (!matcher) return [{ text }];
  return text
    .split(matcher.pattern)
    .filter((part) => part !== "")
    .map((part, i) =>
      // split 带捕获组时，奇数位是匹配到的词
      i % 2 === 1 || matcher.meanings.has(part.toLowerCase())
        ? { text: part, meaning: matcher.meanings.get(part.toLowerCase()) }
        : { text: part },
    );
}

/** 正文里玩家那一行的写法；旧存档按当时选的输入方式加标记，新输入原样显示 */
export function formatInput(input: TurnInput): string {
  const text = plainInput(input);
  const reply = input.replyTo !== undefined ? `【回复 #${input.replyTo}】` : "";
  return `${input.sandevistan ? "【斯安威斯坦】" : ""}${reply}${text}`;
}

function plainInput(input: TurnInput): string {
  switch (input.mode) {
    case undefined:
    case "do":
      return input.text;
    case "say":
      return `「${input.text}」`;
    case "think":
      return `（${input.text}）`;
    case "ooc":
      return `[出戏] ${input.text}`;
  }
}

export const OUTCOME_LABELS: Readonly<Record<Outcome, string>> = {
  critical: "大成功",
  success: "干净利落",
  costly: "惨胜",
  failure: "失败",
  fumble: "大失败",
};

export function isSuccess(outcome: Outcome): boolean {
  return outcome === "critical" || outcome === "success" || outcome === "costly";
}

export const DAMAGE: Readonly<
  Record<DamageTier, { readonly label: string; readonly icon: AssetId }>
> = {
  graze: { label: "擦伤", icon: "check.damageGraze" },
  heavy: { label: "重击", icon: "check.damageHeavy" },
  lethal: { label: "致命", icon: "check.damageLethal" },
};

interface DiceLike {
  readonly faces: readonly number[];
  readonly total: number;
  readonly dv: number;
  readonly outcome: Outcome;
}

/** 例如：骰面 7 + 检定值 → 18 对 DV 15 · 成功 */
export function formatDice(d: DiceLike): string {
  return `骰面 ${d.faces.join(" / ")} → 合计 ${d.total}，难度值 ${d.dv} · ${OUTCOME_LABELS[d.outcome]}`;
}

export function signed(n: number): string {
  return n > 0 ? `+${n}` : n < 0 ? `−${-n}` : "±0";
}

export interface Toast {
  readonly key: string;
  readonly icon: AssetId;
  readonly text: string;
  readonly tone: "good" | "bad" | "info";
}

/** 系统只交语义图标名，网页统一映射到素材 */
const EVENT_ICONS: Readonly<Record<string, AssetId>> = {
  condition: "status.skull",
  limb: "notify.warning",
  cyberware: "notify.attention",
  inventory: "notify.inventory",
  journal: "notify.journal",
  questUpdate: "notify.questUpdate",
  timeCircle: "status.timeCircle",
  attention: "notify.attention",
  warning: "notify.warning",
  braindance: "braindance.recording",
  streetCred: "notify.streetCred",
};

/** 系统通知由各系统提供，HUD 数值变化在这里补齐 */
export function diffViews(prev: View, next: View): Toast[] {
  if (prev.version === next.version) return [];
  const out: Omit<Toast, "key">[] = next.events.map((event) => ({
    icon: EVENT_ICONS[event.icon] ?? "notify.attention",
    text: event.text,
    tone: event.tone,
  }));
  // 消息提醒：额度在 core 按世界算好，这里只照着弹，多的合成一句
  for (const item of next.notifications.items) {
    out.push({
      icon: item.channel === "police" ? "notify.warning" : "notify.journal",
      text: `${item.from}：${item.text}`,
      tone: "info",
    });
  }
  if (next.notifications.more > 0) {
    out.push({
      icon: "notify.journal",
      text: `还有 ${next.notifications.more} 条`,
      tone: "info",
    });
  }

  const hp = next.health.hp - prev.health.hp;
  if (hp !== 0) {
    out.push({
      icon: "notify.warning",
      text: `生命 ${signed(hp)}（${next.health.hp}/${next.health.max}）`,
      tone: hp > 0 ? "good" : "bad",
    });
  }

  const cred = next.character.streetCred - prev.character.streetCred;
  if (cred !== 0) {
    out.push({
      icon: "notify.streetCred",
      text: `街头声望 ${signed(cred)}（${next.character.streetCred} 级）`,
      tone: cred > 0 ? "good" : "bad",
    });
  }

  const hum = next.humanity.current - prev.humanity.current;
  if (hum !== 0) {
    out.push({
      icon: "notify.attention",
      text: `人性 ${signed(hum)}（${next.humanity.current}/${next.humanity.cap}）`,
      tone: hum > 0 ? "good" : "bad",
    });
  }

  const money = next.money.eddies - prev.money.eddies;
  if (money !== 0) {
    out.push({
      icon: "notify.inventory",
      text: `欧元 ${signed(money)}（现有 ${next.money.eddies}）`,
      tone: money > 0 ? "good" : "bad",
    });
  }

  return out.map((t, i) => ({ ...t, key: `${next.version}-${i}` }));
}
