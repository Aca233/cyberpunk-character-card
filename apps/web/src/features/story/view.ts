import type { PlayerView, TurnInput } from "@cp/core";
import type { AssetId } from "../../assets";

/** 剧情界面用到的纯函数：不碰 React，也不发请求 */

export type View = PlayerView;
export type Turn = View["turns"][number];
export type CheckOffer = View["offers"]["checks"][number];
export type Choice = View["offers"]["choices"][number];
export type DamageTier = NonNullable<CheckOffer["damage"]>;
export type Outcome = "critical" | "success" | "failure" | "fumble";

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
}

export interface Segment {
  readonly text: string;
  readonly speaker?: Speaker | undefined;
}

/** 正文里要上色的名字：玩家自己，和见过的人（连同外号）；长的先匹配，免得「丽贝」吃掉「丽贝卡」 */
export function speakersOf(view: View): Speaker[] {
  const out: Speaker[] = [];
  if (view.character.name) out.push({ name: view.character.name, self: true });
  for (const npc of view.npcs) {
    out.push({ name: npc.name, self: false });
    if (npc.alias) out.push({ name: npc.alias, self: false });
  }
  return out.filter((s) => s.name.trim().length > 0).sort((a, b) => b.name.length - a.name.length);
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** 把一段正文切成普通文字和名字 */
export function splitSpeakers(text: string, speakers: readonly Speaker[]): Segment[] {
  if (speakers.length === 0) return [{ text }];
  const byName = new Map(speakers.map((s) => [s.name, s]));
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
  success: "成功",
  failure: "失败",
  fumble: "大失败",
};

export function isSuccess(outcome: Outcome): boolean {
  return outcome === "critical" || outcome === "success";
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

const ATTRIBUTE_NAMES: Readonly<Record<string, string>> = {
  body: "肉体",
  reflexes: "反应",
  tech: "技术",
  intelligence: "智力",
  cool: "镇定",
};

export interface Toast {
  readonly key: string;
  readonly icon: AssetId;
  readonly text: string;
  readonly tone: "good" | "bad" | "info";
}

/** 新一轮写进存档后，和上一次看到的状态比，生成右上角的提示 */
export function diffViews(prev: View, next: View): Toast[] {
  if (prev.version === next.version) return [];
  const out: Omit<Toast, "key">[] = [];

  const hp = next.health.hp - prev.health.hp;
  if (hp !== 0) {
    out.push({
      icon: "notify.warning",
      text: `生命 ${signed(hp)}（${next.health.hp}/${next.health.max}）`,
      tone: hp > 0 ? "good" : "bad",
    });
  }
  if (next.health.condition !== prev.health.condition) {
    out.push({
      icon: "status.skull",
      text: `状态：${next.health.conditionLabel}`,
      tone: next.health.condition === "up" ? "good" : "bad",
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

  const points = next.character.attributePoints - prev.character.attributePoints;
  if (points > 0) {
    out.push({
      icon: "notify.streetCred",
      text: `得到 ${points} 个属性点，可以在角色栏分配`,
      tone: "good",
    });
  }
  for (const [key, value] of Object.entries(next.character.attributes)) {
    const before = prev.character.attributes[key as keyof typeof prev.character.attributes];
    if (before !== undefined && value !== undefined && value > before) {
      out.push({
        icon: "notify.attention",
        text: `${ATTRIBUTE_NAMES[key] ?? key} ${signed(value - before)}（${value}）`,
        tone: "good",
      });
    }
  }

  // 创伤小组会籍：办了、升了、过期了
  if (next.trauma.tier !== prev.trauma.tier) {
    out.push({
      icon: "notify.attention",
      text:
        next.trauma.tier === "none"
          ? next.trauma.lapsed
            ? "创伤小组会籍过期了"
            : "退掉了创伤小组会籍"
          : `创伤小组${next.trauma.tierLabel}：到 ${next.trauma.until}`,
      tone: next.trauma.tier === "none" ? "bad" : "good",
    });
  }

  // 扫描器上新挂的警情
  for (const a of next.ncpd.alerts) {
    if (!prev.ncpd.alerts.some((p) => p.id === a.id))
      out.push({
        icon: "notify.attention",
        text: `NCPD 警情：${a.label}（${a.locationName}）`,
        tone: "info",
      });
  }

  // 悬赏：新挂、涨价、了结都弹一条
  for (const b of next.heat.bounties) {
    const before = prev.heat.bounties.find((p) => p.id === b.id);
    if (!before || before.reward !== b.reward) {
      out.push({
        icon: "notify.warning",
        text: before
          ? `悬赏涨到 ${b.reward.toLocaleString("en-US")} 欧元`
          : `你被挂了悬赏：${b.reward.toLocaleString("en-US")} 欧元`,
        tone: "bad",
      });
    }
  }
  for (const b of prev.heat.bounties) {
    if (!next.heat.bounties.some((n) => n.id === b.id))
      out.push({ icon: "notify.attention", text: "悬赏了结了", tone: "good" });
  }

  // 势力态度变了：弹出新标签，变好是绿色、变坏是红色
  const order = ["kos", "hostile", "neutral", "friendly", "family"];
  for (const f of next.factions.list) {
    const before = prev.factions.list.find((p) => p.id === f.id);
    if (before && before.attitude !== f.attitude) {
      out.push({
        icon: "notify.attention",
        text: `${f.name}：${f.attitudeLabel}`,
        tone: order.indexOf(f.attitude) > order.indexOf(before.attitude) ? "good" : "bad",
      });
    }
  }

  const hum = next.humanity.current - prev.humanity.current;
  if (hum !== 0) {
    out.push({
      icon: "notify.attention",
      text: `人性 ${signed(hum)}（${next.humanity.current}/${next.humanity.cap}）`,
      tone: hum > 0 ? "good" : "bad",
    });
  }
  if (next.humanity.stage !== prev.humanity.stage) {
    out.push({
      icon: "notify.attention",
      text: `人性阶段：${next.humanity.stageLabel}`,
      tone: "info",
    });
  }

  const ids = new Set([
    ...Object.keys(prev.inventory.backpack),
    ...Object.keys(next.inventory.backpack),
  ]);
  for (const id of ids) {
    const delta = (next.inventory.backpack[id] ?? 0) - (prev.inventory.backpack[id] ?? 0);
    const name = next.names.items[id] ?? prev.names.items[id] ?? id;
    if (delta > 0)
      out.push({ icon: "notify.inventory", text: `获得 ${name} ×${delta}`, tone: "good" });
    if (delta < 0)
      out.push({ icon: "notify.inventory", text: `失去 ${name} ×${-delta}`, tone: "bad" });
  }

  const hadParts = new Set(prev.cyberware.map((c) => c.id));
  const hasParts = new Set(next.cyberware.map((c) => c.id));
  for (const c of next.cyberware) {
    if (!hadParts.has(c.id))
      out.push({ icon: "notify.attention", text: `新义体已上线：${c.name}`, tone: "good" });
  }
  for (const c of prev.cyberware) {
    if (!hasParts.has(c.id))
      out.push({ icon: "notify.attention", text: `义体已卸下：${c.name}`, tone: "info" });
  }

  const money = next.money.eddies - prev.money.eddies;
  if (money !== 0) {
    out.push({
      icon: "notify.inventory",
      text: `欧元 ${signed(money)}（现有 ${next.money.eddies}）`,
      tone: money > 0 ? "good" : "bad",
    });
  }
  const jobsBefore = new Map(prev.jobs.list.map((j) => [j.id, j]));
  for (const job of next.jobs.list) {
    const old = jobsBefore.get(job.id);
    if (!old) out.push({ icon: "notify.journal", text: `新委托：${job.title}`, tone: "info" });
    else if (old.status !== job.status) {
      const good = job.status === "active" || job.status === "clean" || job.status === "flawed";
      out.push({
        icon: "notify.questUpdate",
        text: `委托${job.statusLabel}：${job.title}`,
        tone: good ? "good" : "bad",
      });
    }
  }

  const before = new Map(prev.deadlines.map((d) => [d.id, d]));
  const after = new Set(next.deadlines.map((d) => d.id));
  for (const d of next.deadlines) {
    const old = before.get(d.id);
    if (!old)
      out.push({ icon: "notify.journal", text: `新期限：${d.label}（${d.due}）`, tone: "info" });
    else if (d.overdue && !old.overdue) {
      out.push({ icon: "status.timeCircle", text: `已到期：${d.label}`, tone: "bad" });
    }
  }
  for (const d of prev.deadlines) {
    if (!after.has(d.id))
      out.push({ icon: "notify.questUpdate", text: `已处理：${d.label}`, tone: "info" });
  }

  // 宿敌：升级和看穿准备弹提示条，了结弹结算卡
  const rivalsBefore = new Map(prev.npcs.map((n) => [n.id, n.nemesis]));
  for (const n of next.npcs) {
    const was = rivalsBefore.get(n.id) ?? null;
    if (!n.nemesis || n.nemesis.ended) continue;
    if (!was) out.push({ icon: "notify.attention", text: `${n.name}成了你的宿敌`, tone: "bad" });
    else if (n.nemesis.prep && n.nemesis.prep !== was.prep)
      out.push({
        icon: "notify.attention",
        text: `看穿了${n.name}的准备：${n.nemesis.prep}`,
        tone: "info",
      });
  }

  // 心事：新说起的、听说有了结果的弹提示条
  const arcsBefore = new Map(prev.npcs.map((n) => [n.id, n.arc?.concerns ?? []]));
  for (const n of next.npcs) {
    const was = new Map((arcsBefore.get(n.id) ?? []).map((c) => [c.id, c]));
    for (const c of n.arc?.concerns ?? []) {
      const old = was.get(c.id);
      if (c.status === "resolved" && old?.status !== "resolved")
        out.push({
          icon: "notify.questUpdate",
          text: `${n.name}的事有了结果：${c.title}`,
          tone: "info",
        });
      else if (!old)
        out.push({ icon: "notify.journal", text: `${n.name}跟你说起：${c.title}`, tone: "info" });
    }
  }

  // 超梦：接上新的一段、下了结论各弹一条；不说推得对不对
  const bdNow = next.braindance.active;
  const bdWas = prev.braindance.active;
  if (bdNow && (!bdWas || bdWas.title !== bdNow.title || bdWas.startedAt !== bdNow.startedAt))
    out.push({ icon: "braindance.recording", text: `接上超梦：${bdNow.title}`, tone: "info" });
  if (next.braindance.history.length > prev.braindance.history.length || (bdWas && !bdNow))
    out.push({
      icon: "braindance.recording",
      text: bdWas ? `超梦调查告一段落：${bdWas.title}` : "超梦调查告一段落",
      tone: "info",
    });

  return out.map((t, i) => ({ ...t, key: `${next.version}-${i}` }));
}
