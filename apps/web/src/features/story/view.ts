import {
  inventoryRules,
  type PlayerView,
  type TurnCheckpointSummary,
  type TurnInput,
} from "@cp/core";
import type { AssetId } from "../../assets";
import { baseWeaponIdOf } from "./art";

/** 剧情界面用到的纯函数：不碰 React，也不发请求 */

export type View = PlayerView & { readonly checkpoint?: TurnCheckpointSummary };
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

export type BodyPart = View["combat"]["wounds"][number]["part"];
export type TraumaZone = BodyPart | "chrome" | "system";
export type WoundSeverity = "graze" | "heavy" | "lethal";
export type WoundTone = "ok" | "warn" | "hurt" | "bad" | "dead";

export interface ConcreteTraumaItem {
  readonly id: string;
  readonly source: "combat" | "injury" | "limb" | "chrome" | "system";
  readonly zone: TraumaZone;
  readonly partLabel: string;
  readonly severity: WoundSeverity;
  readonly tierLabel: string;
  readonly headline: string;
  readonly cause: string;
  readonly careTag: string;
  readonly careNote: string;
  readonly treated: boolean;
  readonly scarRisk: boolean;
  readonly tone: WoundTone;
}

export interface ConcreteScarItem {
  readonly id: string;
  readonly part: BodyPart;
  readonly partLabel: string;
  readonly summary: string;
}

export interface WoundTelemetry {
  readonly title: string;
  readonly code: string;
  readonly level: number;
  readonly tone: WoundTone;
  readonly impact: string;
  readonly items: readonly ConcreteTraumaItem[];
  readonly scars: readonly ConcreteScarItem[];
  readonly zones: readonly TraumaZone[];
}

const SEVERITY_ORDER: Readonly<Record<WoundSeverity, number>> = {
  lethal: 3,
  heavy: 2,
  graze: 1,
};

const TIER_TONE: Readonly<Record<WoundSeverity, WoundTone>> = {
  graze: "warn",
  heavy: "hurt",
  lethal: "bad",
};

const TIER_NAME: Readonly<Record<WoundSeverity, string>> = {
  graze: "擦伤",
  heavy: "重创",
  lethal: "致命伤",
};

const TONE_RANK: Readonly<Record<WoundTone, number>> = {
  ok: 0,
  warn: 1,
  hurt: 2,
  bad: 3,
  dead: 4,
};

const IMPACT_BY_LEVEL: readonly string[] = [
  "各部位皮肉与器官正常，发力与反应不受牵制",
  "浅表擦挫与轻微渗血，暂不影响行动发力与反应",
  "剧痛持续拖累发力与反应，亟需打医疗针或找义体医生缝合",
  "濒危重残 · 任何激烈动作都会加剧伤势、随时失能（医疗针难压，需尽快手术）",
  "濒死失血休克 · 生命体征跌破安全线，急需创伤小组或紧急抢救",
];

function fromLabel(by: string, gang: string | null): string {
  return gang ? `${gang}的${by}` : by;
}

/** 把战斗伤口、非战斗伤势、断肢、损毁义体与疤痕统一成具体的生物监测伤情档案 */
export function woundTelemetry(
  health: Pick<
    View["health"],
    "wounds" | "condition" | "conditionLabel" | "painSuppressed" | "lostLimbs"
  > & { readonly injuries?: View["health"]["injuries"] },
  combat?: Pick<View["combat"], "wounds" | "scars">,
  cyberware?: readonly Pick<View["cyberware"][number], "id" | "name" | "slotLabel" | "broken">[],
): WoundTelemetry {
  const level = Math.max(0, Math.min(4, health.wounds));
  const items: ConcreteTraumaItem[] = [];

  for (const limb of health.lostLimbs) {
    items.push({
      id: `limb:${limb.id}`,
      source: "limb",
      zone: limb.id,
      partLabel: limb.label,
      severity: "lethal",
      tierLabel: "断肢",
      headline: `${limb.label}缺失`,
      cause: limb.id.endsWith("arm") ? "持械与单双手抓握受限" : "无法疾跑与步行逃脱",
      careTag: "需装义肢",
      careNote: "找义体医生加装对应义肢即可补上",
      treated: false,
      scarRisk: false,
      tone: "bad",
    });
  }

  for (const w of combat?.wounds ?? []) {
    const tierLabel = TIER_NAME[w.tier];
    const daysText = w.daysLeft > 0 ? `约 ${w.daysLeft} 天长好` : "即将长好";
    const scarRisk = !w.treated && w.tier !== "graze";
    items.push({
      id: `combat:${w.id}`,
      source: "combat",
      zone: w.part,
      partLabel: w.partLabel,
      severity: w.tier,
      tierLabel,
      headline: `${w.partLabel}${tierLabel}`,
      cause: `${fromLabel(w.by, w.gang)} · ${w.weapon}`,
      careTag: w.treated ? "已清创" : scarRisk ? "未清创·会留疤" : "未清创",
      careNote: w.treated
        ? `已清创处理 · ${daysText}（不会留疤）`
        : scarRisk
          ? `未清创 · ${daysText}，放任愈合会留疤`
          : `${daysText} · 自然愈合不留疤`,
      treated: w.treated,
      scarRisk,
      tone: TIER_TONE[w.tier],
    });
  }

  for (const inj of health.injuries ?? []) {
    const partLabel = inj.partLabel ?? "躯干";
    const daysText = inj.daysLeft > 0 ? `约 ${inj.daysLeft} 天恢复` : "即将恢复";
    const careTag = inj.treated
      ? "已处理"
      : inj.tier === "graze"
        ? "休整可消"
        : health.painSuppressed
          ? "镇痛压制"
          : "待缝合";
    const careNote = inj.treated
      ? `${daysText} · 已完成处理，创口仍在恢复中`
      : inj.tier === "graze"
        ? `${daysText} · 休整或静养即可消退`
        : health.painSuppressed
          ? `痛觉暂被压制 · ${daysText}，仍须找义体医生缝合`
          : `${daysText} · 深层创伤需打医疗针或找义体医生缝合`;
    items.push({
      id: `injury:${inj.id}`,
      source: "injury",
      zone: inj.part ?? "system",
      partLabel,
      severity: inj.tier,
      tierLabel: inj.tierLabel,
      headline: `${partLabel}${inj.tierLabel}`,
      cause: inj.cause,
      careTag,
      careNote,
      treated: inj.treated,
      scarRisk: false,
      tone: TIER_TONE[inj.tier],
    });
  }

  for (const chrome of cyberware ?? []) {
    if (!chrome.broken) continue;
    items.push({
      id: `chrome:${chrome.id}`,
      source: "chrome",
      zone: "chrome",
      partLabel: chrome.slotLabel,
      severity: "heavy",
      tierLabel: "损毁",
      headline: `${chrome.name}停机`,
      cause: `${chrome.slotLabel}义体受损失效`,
      careTag: "待检修",
      careNote: "找义体医生检修后恢复功能",
      treated: false,
      scarRisk: false,
      tone: "warn",
    });
  }

  if (items.length === 0 && (health.condition !== "up" || level > 0)) {
    const fallback =
      health.condition === "dead"
        ? {
            zone: "system" as const,
            partLabel: "全身",
            severity: "lethal" as const,
            tierLabel: "停搏",
            headline: "生命信号中断",
            cause: "心跳与脑电归零",
            careTag: "已死亡",
            careNote: "无法自主恢复",
            tone: "dead" as const,
          }
        : health.condition === "dying"
          ? {
              zone: "system" as const,
              partLabel: "循环",
              severity: "lethal" as const,
              tierLabel: "休克",
              headline: "失血休克跌入生死线",
              cause: "多处深层失血与低血压衰竭",
              careTag: "急需抢救",
              careNote: "急需创伤小组接入或同伴紧急抢救",
              tone: "dead" as const,
            }
          : health.condition === "down"
            ? {
                zone: "system" as const,
                partLabel: "中枢",
                severity: "heavy" as const,
                tierLabel: "倒地",
                headline: "创伤失能昏迷",
                cause: "剧痛与创伤冲击导致昏迷倒地",
                careTag: "需协助",
                careNote: "需要同伴协助或就地稳住伤势",
                tone: (level >= 3 ? "bad" : "hurt") as WoundTone,
              }
            : level >= 3
              ? {
                  zone: "system" as const,
                  partLabel: "全身",
                  severity: "lethal" as const,
                  tierLabel: "重残",
                  headline: "多处深层创伤",
                  cause: "失血与脏器受压拖垮全身机能",
                  careTag: "亟需手术",
                  careNote: "随时可能恶化失能，需找义体医生手术",
                  tone: "bad" as const,
                }
              : level === 2
                ? {
                    zone: "chest" as const,
                    partLabel: "躯干",
                    severity: "heavy" as const,
                    tierLabel: "重创",
                    headline: "深层重创未愈",
                    cause: health.painSuppressed
                      ? "医疗针暂抑痛觉，内伤未缝合"
                      : "钝挫/贯通创伤剧痛未消",
                    careTag: health.painSuppressed ? "镇痛压制" : "待缝合",
                    careNote: "需找义体医生清创缝合",
                    tone: "hurt" as const,
                  }
                : {
                    zone: "system" as const,
                    partLabel: "表皮",
                    severity: "graze" as const,
                    tierLabel: "擦伤",
                    headline: "浅表擦挫渗血",
                    cause: "局部皮肉擦伤与淤肿",
                    careTag: "休整可消",
                    careNote: "休整即可消退",
                    tone: "warn" as const,
                  };
    items.push({
      id: "system:legacy",
      source: "system",
      treated: false,
      scarRisk: false,
      ...fallback,
    });
  }

  items.sort((a, b) => {
    const limbDiff = Number(b.source === "limb") - Number(a.source === "limb");
    if (limbDiff !== 0) return limbDiff;
    return SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity];
  });

  const scars: ConcreteScarItem[] = (combat?.scars ?? []).map((s, idx) => ({
    id: `scar:${idx}:${s.part}:${s.at}`,
    part: s.part,
    partLabel: s.partLabel,
    summary: `${s.partLabel} · ${fromLabel(s.by, s.gang)}的${s.weapon}${s.district ? `（${s.district}）` : ""}`,
  }));

  let tone: WoundTone =
    level >= 4 ? "dead" : level === 3 ? "bad" : level === 2 ? "hurt" : level === 1 ? "warn" : "ok";
  for (const item of items) {
    if (TONE_RANK[item.tone] > TONE_RANK[tone]) tone = item.tone;
  }

  let impact = IMPACT_BY_LEVEL[level] ?? IMPACT_BY_LEVEL[0] ?? "";
  if (health.painSuppressed && level === 2) {
    impact = "医疗针临时压制痛觉，发力与反应暂未受拖累（深层创伤仍需缝合）";
  }

  const primary = items[0];
  let title =
    items.length === 0
      ? "无外伤 · 完好"
      : items.length === 1
        ? (primary?.headline ?? "体征平稳")
        : `${primary?.headline ?? "多处创伤"} 等 ${items.length} 处`;
  let code =
    level >= 4
      ? "FLATLINE"
      : level === 3
        ? "CRITICAL"
        : level === 2
          ? "TRAUMA"
          : items.length > 0 || level === 1
            ? "INJURED"
            : "NOMINAL";

  if (health.condition === "dead") {
    title = "体征归零";
    code = "FLATLINE";
    tone = "dead";
    impact = "生命信号已中断";
  } else if (health.condition === "dying") {
    title = primary ? `${primary.headline} · 濒死` : "失血休克 · 濒死";
    code = "FLATLINE";
    tone = "dead";
    impact = "濒死失血休克，随时可能彻底停跳 · 需要紧急抢救或创伤小组接入";
  } else if (health.condition === "down") {
    title = primary ? `${primary.headline} · 倒地` : "创伤昏迷 · 倒地";
    code = "DOWN";
    tone = tone === "dead" ? "dead" : level >= 3 || tone === "bad" ? "bad" : "hurt";
    impact = "已失去自主行动能力 · 需要同伴协助或就地稳住伤势";
  }

  const zones = [...new Set(items.map((item) => item.zone))];
  return { title, code, level, tone, impact, items, scars, zones };
}

export interface NpcWoundSummary {
  readonly badge: string | null;
  readonly detail: string | null;
  readonly headline: string;
  readonly threat: "high" | "even" | "low";
}

/** 提炼 NPC 具体创伤摘要，供在场名片、Kiroshi 扫描浮层与档案头部共用 */
export function npcWoundSummary(body: View["npcs"][number]["body"]): NpcWoundSummary {
  if (!body) return { badge: null, detail: null, headline: "未知", threat: "low" };
  const injuries = body.injuries ?? [];
  const top = injuries[0];
  const threat: "high" | "even" | "low" =
    body.wound === "重伤" ||
    body.wound === "倒下" ||
    top?.tier === "lethal" ||
    top?.tier === "heavy"
      ? "high"
      : body.wound === "轻伤" || injuries.length > 0
        ? "even"
        : "low";
  if (top) {
    const count = injuries.length;
    const badge =
      count > 1
        ? `${top.partLabel}${top.tierLabel} 等${count}处`
        : `${top.partLabel}${top.tierLabel}`;
    const detail = `${top.partLabel}${top.tierLabel} · ${top.cause}${count > 1 ? `（共 ${count} 处）` : ""}`;
    const headline = body.wound !== "没受伤" ? `${body.wound} · ${count} 处` : `${count} 处创伤`;
    return { badge, detail, headline, threat };
  }
  const wounded = body.wound !== "没受伤";
  return {
    badge: wounded ? body.wound : null,
    detail: wounded ? body.wound : null,
    headline: body.wound,
    threat,
  };
}

export interface NeuroTelemetry {
  readonly summary: string;
  readonly alertCode: string;
  readonly tone: "ok" | "warn" | "bad";
  readonly loadNote: string;
}

/** 神经稳态与赛博精神病阈值读数（纯感知/体征语言，不含桌面数值或倍率） */
export function neuroTelemetry(
  humanity: View["humanity"],
  psychosis: View["psychosis"],
): NeuroTelemetry {
  const loadNote =
    humanity.cap === 0
      ? "义体负荷已逼近承载尽头"
      : humanity.cap < 40
        ? "重度义体改装大幅压榨了神经余量"
        : humanity.tolerance === "low"
          ? "体质对义体排异较为敏感"
          : humanity.tolerance === "high"
            ? "义体神经兼容性较高"
            : "常规神经承载余量";

  if (psychosis.blackoutOpen) {
    return {
      summary: "意识处于断片区 · 记忆写入中断",
      alertCode: "BLACKOUT",
      tone: "bad",
      loadNote,
    };
  }
  if (psychosis.suppressant.withdrawal) {
    return {
      summary: "抑剂停药戒断 · 冷汗手颤、焦躁易激",
      alertCode: "WITHDRAWAL",
      tone: "bad",
      loadNote,
    };
  }
  if (humanity.suppressed) {
    return {
      summary: "神经阻断生效 · 暂压表层噪点与颤抖",
      alertCode: "SUPPRESSED",
      tone: "ok",
      loadNote,
    };
  }
  if (humanity.current === 0) {
    return {
      summary: "视神经底噪尖啸 · 强刺激下随时失控断片",
      alertCode: "CRITICAL",
      tone: "bad",
      loadNote,
    };
  }
  if (humanity.current < 20) {
    return {
      summary: "视野重影与金属回响频发 · 逼近失控边缘",
      alertCode: "GLITCH",
      tone: "bad",
      loadNote,
    };
  }
  if (humanity.glitchZone) {
    return {
      summary: "义眼偶闪红帧雪花 · 高压下容易轻度失真",
      alertCode: "DRIFT",
      tone: "warn",
      loadNote,
    };
  }
  return {
    summary: "神经同步正常 · 情绪与感官反馈稳定",
    alertCode: "SYNC OK",
    tone: "ok",
    loadNote,
  };
}

export interface TrackItem {
  readonly id: string;
  readonly kind: "objective" | "deadline" | "braindance";
  readonly source: string;
  readonly sourceLabel: string;
  readonly title: string;
  readonly location: string | null;
  readonly dueLabel: string | null;
  readonly dueIn: number | null;
  readonly progress: string | null;
  readonly status: "overdue" | "active";
  readonly icon: AssetId;
}

export interface TrackTelemetry {
  /** 正在推进中的事项：超期 / 期限约定 / 超梦 / 在办待办 */
  readonly active: readonly TrackItem[];
  readonly overdueCount: number;
  readonly activeCount: number;
  /** 折叠态卡片展示的最多 3 条在办事项 */
  readonly preview: readonly TrackItem[];
}

function trackPriority(item: TrackItem): [number, number, number] {
  const overdueRank = item.status === "overdue" ? 0 : 1;
  if (item.dueIn !== null) return [overdueRank, 0, item.dueIn];
  if (item.kind === "deadline") return [overdueRank, 1, 0];
  return [overdueRank, 2, 0];
}

function compareTrackItems(a: TrackItem, b: TrackItem): number {
  const pa = trackPriority(a);
  const pb = trackPriority(b);
  if (pa[0] !== pb[0]) return pa[0] - pb[0];
  if (pa[1] !== pb[1]) return pa[1] - pb[1];
  return pa[2] - pb[2];
}

/** 统一折叠追踪卡与展开追踪页的数据投影，只列手头在办与期限约定 */
export function trackTelemetry(view: View): TrackTelemetry {
  const active: TrackItem[] = [];
  const placeNames = new Map((view.travel?.destinations ?? []).map((d) => [d.id, d.name]));
  const placeOf = (loc: string | null): string | null =>
    loc === null ? null : (placeNames.get(loc) ?? loc);

  for (const d of view.deadlines ?? []) {
    active.push({
      id: `deadline:${d.id}`,
      kind: "deadline",
      source: "deadline",
      sourceLabel: "约定",
      title: d.label,
      location: null,
      dueLabel: d.overdue ? "已超期" : `${d.due} 前`,
      dueIn: null,
      progress: null,
      status: d.overdue ? "overdue" : "active",
      icon: d.overdue ? "notify.warning" : "status.timeCircle",
    });
  }

  const hasBdObjective = view.objectives.some((o) => o.source === "braindance");
  if (view.braindance?.active && !hasBdObjective) {
    const bd = view.braindance.active;
    active.push({
      id: "bd:active",
      kind: "braindance",
      source: "braindance",
      sourceLabel: "超梦",
      title: `${bd.title}（${bd.recorder}的录像）`,
      location: null,
      dueLabel: null,
      dueIn: null,
      progress: bd.ready
        ? "关键线索找全了，可以下结论"
        : `关键线索找到 ${bd.keys.found}/${bd.keys.total} 条`,
      status: "active",
      icon: "braindance.clue",
    });
  }

  for (const o of view.objectives) {
    if (o.status === "offered") continue;
    const place = placeOf(o.location);
    const overdue = o.status === "overdue";
    const isBd = o.source === "braindance";
    active.push({
      id: o.id,
      kind: isBd ? "braindance" : "objective",
      source: o.source,
      sourceLabel: o.sourceLabel,
      title: o.title,
      location: place,
      dueLabel: o.due === null ? null : overdue ? "已超期" : `${o.due} 前`,
      dueIn: o.dueIn,
      progress: o.progress,
      status: overdue ? "overdue" : "active",
      icon: isBd ? "braindance.clue" : overdue ? "notify.warning" : "notify.questUpdate",
    });
  }

  active.sort(compareTrackItems);

  const overdueCount = active.filter((i) => i.status === "overdue").length;
  const activeCount = active.length;
  const preview = active.slice(0, 3);

  return {
    active,
    overdueCount,
    activeCount,
    preview,
  };
}

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
      icon: "notify.journal",
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

  const prevCombatWounds = prev.combat?.wounds ?? [];
  const nextCombatWounds = next.combat?.wounds ?? [];
  const prevInjuries = prev.health.injuries ?? [];
  const nextInjuries = next.health.injuries ?? [];
  const prevScars = prev.combat?.scars ?? [];
  const nextScars = next.combat?.scars ?? [];
  const prevCombatIds = new Set(prevCombatWounds.map((w) => w.id));
  const nextCombatIds = new Set(nextCombatWounds.map((w) => w.id));
  const prevInjuryIds = new Set(prevInjuries.map((i) => i.id));
  const nextInjuryIds = new Set(nextInjuries.map((i) => i.id));

  let concreteChanged = false;
  for (const w of nextCombatWounds) {
    if (prevCombatIds.has(w.id)) continue;
    concreteChanged = true;
    out.push({
      icon: "notify.warning",
      text: `新伤：${w.partLabel}${TIER_NAME[w.tier]} · ${fromLabel(w.by, w.gang)}的${w.weapon}`,
      tone: "bad",
    });
  }
  for (const inj of nextInjuries) {
    if (prevInjuryIds.has(inj.id)) continue;
    concreteChanged = true;
    out.push({
      icon: "notify.warning",
      text: `新伤：${inj.partLabel ?? "躯干"}${inj.tierLabel} · ${inj.cause}`,
      tone: "bad",
    });
  }
  const gainedScar = nextScars.length > prevScars.length ? nextScars.slice(prevScars.length) : [];
  for (const w of prevCombatWounds) {
    if (nextCombatIds.has(w.id)) continue;
    concreteChanged = true;
    const scarred = gainedScar.some((s) => s.part === w.part);
    out.push({
      icon: "notify.attention",
      text: scarred ? `${w.partLabel}伤处愈合，留下永久伤疤` : `${w.partLabel}的伤已经长好`,
      tone: scarred ? "info" : "good",
    });
  }
  for (const inj of prevInjuries) {
    if (nextInjuryIds.has(inj.id)) continue;
    concreteChanged = true;
    out.push({
      icon: "notify.attention",
      text: `${inj.partLabel ?? "躯干"}的伤已经恢复`,
      tone: "good",
    });
  }

  const woundDiff = next.health.wounds - prev.health.wounds;
  if (!concreteChanged && woundDiff !== 0) {
    out.push({
      icon: "notify.warning",
      text: `${woundDiff > 0 ? "伤势加重" : "伤势缓解"} · ${woundTelemetry(next.health, next.combat, next.cyberware).title}`,
      tone: woundDiff > 0 ? "bad" : "good",
    });
  } else if (next.health.condition !== prev.health.condition && next.health.condition !== "up") {
    out.push({
      icon: "notify.warning",
      text: `身体状态 · ${next.health.conditionLabel}`,
      tone: "bad",
    });
  }

  const cred = next.character.streetCred - prev.character.streetCred;
  if (cred !== 0) {
    out.push({
      icon: "notify.streetCred",
      text:
        next.character.credTier !== prev.character.credTier
          ? `街头名声升至 · ${next.character.credTier}`
          : `街上风声渐起（${next.character.credTier}）`,
      tone: cred > 0 ? "good" : "bad",
    });
  }

  const hum = next.humanity.current - prev.humanity.current;
  if (hum !== 0) {
    out.push({
      icon: "notify.attention",
      text:
        next.humanity.stage !== prev.humanity.stage
          ? `神经稳定 · ${next.humanity.stageLabel}`
          : `神经负荷${hum > 0 ? "缓和" : "加重"}（${next.humanity.stageLabel}）`,
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

export type ContactBadgeTone = "accent" | "cyan" | "danger" | "warn" | "dim";
export type ContactFilter = "all" | "active" | "utility" | "present";

export interface ContactBadge {
  readonly label: string;
  readonly shortLabel?: string | undefined;
  readonly tone: ContactBadgeTone;
  readonly detail?: string | undefined;
}

export interface ContactSummary {
  readonly key: string;
  readonly name: string;
  readonly npc: View["npcs"][number] | undefined;
  readonly last: string | null;
  readonly unread: number;
  readonly messageCount: number;
  readonly preview: string | null;
  readonly fixer: View["jobs"]["fixers"][number] | undefined;
  readonly squad: View["squad"]["members"][number] | undefined;
  readonly squadOffer: View["squad"]["offers"][number] | undefined;
  readonly foe: NonNullable<View["combat"]["active"]>["foes"][number] | undefined;
  readonly badges: readonly ContactBadge[];
  readonly utilityLine: string;
  readonly highlight: string | null;
  readonly locatePlaceId: string | null;
  readonly locatePlaceName: string | null;
  readonly isActive: boolean;
  readonly isUtility: boolean;
  readonly isPresent: boolean;
}

type ViewNpc = View["npcs"][number];
type ViewFixer = View["jobs"]["fixers"][number];
type ViewSquadMember = View["squad"]["members"][number];
type ViewSquadOffer = View["squad"]["offers"][number];
type ViewFoe = NonNullable<View["combat"]["active"]>["foes"][number];
type ViewMessage = View["phone"]["messages"][number];

interface RawContact {
  readonly key: string;
  readonly name: string;
  readonly npc: ViewNpc | undefined;
  readonly last: string | null;
  readonly unread: number;
}

const ROLE_TRAITS: readonly {
  readonly pattern: RegExp;
  readonly label: string;
  readonly shortLabel?: string;
  readonly detail: string;
  readonly tone: ContactBadgeTone;
}[] = [
  { pattern: /超梦/, label: "超梦", detail: "超梦剪辑 / 线索解析", tone: "cyan" },
  { pattern: /黑客|潜网|网络/, label: "黑客", detail: "网络黑客 / 技术支持", tone: "cyan" },
  { pattern: /技师|修车|工程师/, label: "技师", detail: "机械 / 改装技师", tone: "cyan" },
  { pattern: /警探|NCPD/i, label: "NCPD", detail: "NCPD 警务渠道", tone: "cyan" },
  { pattern: /情报局|特工|卧底/, label: "特工", detail: "情报与潜伏线人", tone: "dim" },
  { pattern: /军用科技|荒坂|公司/, label: "公司", detail: "公司内部门路", tone: "dim" },
  {
    pattern: /酒吧|调酒/,
    label: "情报站",
    shortLabel: "门路",
    detail: "地方酒吧 / 街头消息源",
    tone: "dim",
  },
  { pattern: /佣兵|枪手|独狼|保镖/, label: "战力", detail: "实战武装人员 / 潜在搭档", tone: "dim" },
];

function roleHeadline(role: string): string {
  return (role.split(/[，。；]/)[0] ?? role).trim();
}

function appendRoleTraitBadges(
  npc: ViewNpc,
  badges: ContactBadge[],
  hasPrimaryChannel: boolean,
): void {
  if (!npc.met) return;
  for (const trait of ROLE_TRAITS) {
    if (!trait.pattern.test(npc.role)) continue;
    // 已有明确系统身份（如帮派头目/中间人/小队/敌人）时，不叠泛泛的「战力」「情报站」
    if (
      hasPrimaryChannel &&
      trait.tone === "dim" &&
      (trait.label === "战力" || trait.label === "情报站")
    ) {
      continue;
    }
    if (!badges.some((b) => b.label === trait.label || b.shortLabel === trait.label)) {
      badges.push({
        label: trait.label,
        ...(trait.shortLabel ? { shortLabel: trait.shortLabel } : {}),
        tone: trait.tone,
        detail: trait.detail,
      });
    }
  }
}

function summarizeNpcContact(
  raw: RawContact,
  view: View,
  thread: readonly ViewMessage[],
  fixer: ViewFixer | undefined,
  squad: ViewSquadMember | undefined,
  squadOffer: ViewSquadOffer | undefined,
  foe: ViewFoe | undefined,
): ContactSummary {
  const { npc } = raw;
  const msgs = thread;
  const jobsList = view.jobs?.list ?? [];
  const destinations = view.travel?.destinations ?? [];
  const offeredMsg = msgs.find((m) => m.sender !== "player" && m.job?.status === "offered");
  const activeMsg = msgs.find((m) => m.sender !== "player" && m.job?.status === "active");
  const openJobs = npc
    ? jobsList.filter(
        (j) =>
          j.open &&
          (j.fixer === npc.name ||
            j.fixer === npc.id ||
            j.client === npc.name ||
            j.client === npc.id),
      )
    : [];
  const openConcerns =
    npc?.arc?.concerns.filter((c) => c.status === "told" || c.status === "involved") ?? [];
  const unsettled = npc?.ledger.filter((e) => e.settled === null) ?? [];
  const owesYou = unsettled.filter((e) => e.kind === "owesYou");
  const youOwe = unsettled.filter((e) => e.kind === "youOwe");
  const grudges = unsettled.filter((e) => e.kind === "grudge");
  const services = npc?.met ? (npc.services ?? null) : null;
  const doc = services?.ripperdoc ?? null;
  const shops = services?.shops ?? [];
  const isRoleFixer = Boolean(npc?.met && npc.role.includes("中间人"));
  const isFixer = Boolean(fixer || isRoleFixer);

  const badges: ContactBadge[] = [];
  if (foe) {
    badges.push({ label: foe.stateLabel || "交战", tone: "danger", detail: "当前交战目标" });
  }
  if (npc?.nemesis && !npc.nemesis.ended) {
    badges.push({ label: "宿敌", tone: "danger", detail: "宿敌正在暗处盯着你" });
  }
  if (offeredMsg?.job) {
    badges.push({
      label: "来活待接",
      shortLabel: "来活",
      tone: "accent",
      detail: `${offeredMsg.job.title}${offeredMsg.job.reward > 0 ? `（${offeredMsg.job.reward.toLocaleString("en-US")}€）` : ""}`,
    });
  } else if (activeMsg?.job || openJobs.some((j) => j.status === "active")) {
    const activeJob = activeMsg?.job ?? openJobs.find((j) => j.status === "active");
    badges.push({
      label: "进行中",
      tone: "cyan",
      detail: activeJob ? `正在推进：${activeJob.title}` : undefined,
    });
  }
  if (doc) {
    badges.push({
      label: doc.debt ? "义体医·欠款" : "义体医生",
      shortLabel: doc.debt ? "欠款" : "义体医",
      tone: doc.debt ? "danger" : "accent",
      detail: doc.debt
        ? `${doc.name} · 欠款 ${doc.debt.amount.toLocaleString("en-US")}€（${doc.debt.due} 到期）`
        : `${doc.name}（${doc.credit > 0 ? `可赊账至 ${doc.credit.toLocaleString("en-US")}€` : "现钱交易"}）`,
    });
  }
  if (shops.length > 0) {
    const onlyPharmacy = shops.length === 1 && shops[0]?.name.includes("药");
    badges.push({
      label: onlyPharmacy ? "药柜" : "商店",
      tone: "accent",
      detail: shops.map((s) => `${s.name}（${s.locationName}）`).join("、"),
    });
  }
  if (fixer?.blocked) {
    badges.push({
      label: "派单暂停",
      shortLabel: "停单",
      tone: "danger",
      detail: fixer.blockReason ?? "势力结仇，暂停派单",
    });
  } else if (isFixer) {
    badges.push({ label: "中间人", tone: "accent", detail: "可接单派活" });
  }
  if (squad) {
    badges.push({
      label: squad.specialty ? `小队·${squad.specialty}` : "小队",
      shortLabel: "小队",
      tone: "accent",
      detail: `${squad.kindLabel} · ${squad.terms}`,
    });
    if (squad.owed > 0) {
      badges.push({
        label: `欠薪${squad.owed}周`,
        tone: "danger",
        detail: squad.leavesAt ? `最迟 ${squad.leavesAt} 结算` : undefined,
      });
    }
  } else if (squadOffer) {
    badges.push({ label: "邀入队", tone: "cyan", detail: squadOffer.terms });
  }
  if (owesYou.length > 0) {
    badges.push({
      label: owesYou.length > 1 ? `欠你人情×${owesYou.length}` : "欠你人情",
      shortLabel: "欠你情",
      tone: "cyan",
      detail: owesYou[0]?.text,
    });
  }
  if (youOwe.length > 0) {
    badges.push({
      label: youOwe.length > 1 ? `你欠人情×${youOwe.length}` : "你欠人情",
      shortLabel: "欠他情",
      tone: "warn",
      detail: youOwe[0]?.text,
    });
  }
  if (grudges.length > 0) {
    badges.push({
      label: grudges.length > 1 ? `记你仇×${grudges.length}` : "记你仇",
      shortLabel: "有仇",
      tone: "danger",
      detail: grudges[0]?.text,
    });
  }
  if (openConcerns.length > 0) {
    badges.push({
      label: openConcerns.length > 1 ? `心事×${openConcerns.length}` : "心事",
      tone: "cyan",
      detail: openConcerns.map((c) => c.title).join("；"),
    });
  }
  const hasPrimaryChannel = Boolean(
    foe || doc || shops.length > 0 || isFixer || squad || squadOffer,
  );
  if (npc) appendRoleTraitBadges(npc, badges, hasPrimaryChannel);

  const primaryPlaceId = npc?.placeId ?? doc?.location ?? shops[0]?.location ?? null;
  const locateDest =
    primaryPlaceId && npc?.alive && !npc.here
      ? destinations.find((d) => d.id === primaryPlaceId && !d.here)
      : undefined;

  const affinityStr = npc?.met ? `好感 ${npc.affinity > 0 ? "+" : ""}${npc.affinity}` : null;
  const placeText = npc?.met
    ? npc.here
      ? "当前在场"
      : (npc.lastPlace ?? npc.homePlace ?? doc?.locationName ?? shops[0]?.locationName ?? null)
    : null;

  let utilityParts: string[] = [];
  if (!npc) {
    utilityParts = ["未建档加密频道", ...(raw.last ? [raw.last] : [])];
  } else if (!npc.alive) {
    utilityParts = ["已故", ...(npc.met ? [roleHeadline(npc.role)] : [])];
  } else if (!npc.met) {
    utilityParts = [
      npc.nemesis ? "交过手 · 底细不明" : "只听说过 · 尚未照面",
      ...(raw.last ? [raw.last] : []),
    ];
  } else {
    const descParts: string[] = [];
    if (doc) {
      descParts.push(
        doc.debt
          ? `义体欠款 ${doc.debt.amount.toLocaleString("en-US")}€`
          : doc.credit > 0
            ? `义体改装(可赊${doc.credit.toLocaleString("en-US")}€)`
            : "义体改装",
      );
    }
    if (shops.length > 0) {
      descParts.push(shops.map((s) => s.name).join(" / "));
    }
    if (fixer?.blocked) {
      descParts.push("派单暂停");
    } else if (isFixer) {
      descParts.push("接单派活");
    }
    if (squad) {
      descParts.push(squad.owed > 0 ? `小队欠薪${squad.owed}周` : `小队(${squad.terms})`);
    } else if (squadOffer) {
      descParts.push(`可入队(${squadOffer.terms})`);
    }
    if (descParts.length === 0) {
      const headline = roleHeadline(npc.role);
      descParts.push(headline);
      if (npc.faction && npc.faction !== "无" && !headline.includes(npc.faction)) {
        descParts.push(npc.faction);
      }
    }
    if (placeText) descParts.push(placeText);
    if (affinityStr) descParts.push(affinityStr);
    utilityParts = descParts;
  }

  let highlight: string | null = null;
  if (offeredMsg?.job) {
    const j = offeredMsg.job;
    const extra = [
      j.reward > 0 ? `${j.reward.toLocaleString("en-US")}€` : null,
      j.due ? `${j.due} 前` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    highlight = `待接来活：${j.title}${extra ? `（${extra}）` : ""}`;
  } else if (doc?.debt) {
    highlight = `${doc.name} 欠款 ${doc.debt.amount.toLocaleString("en-US")}€ · ${doc.debt.due} 到期`;
  } else if (fixer?.blocked && fixer.blockReason) {
    highlight = fixer.blockReason;
  } else if (squad && squad.owed > 0) {
    highlight = `已欠薪 ${squad.owed} 周${squad.leavesAt ? `（${squad.leavesAt} 前不发会离队）` : ""}`;
  } else if (squadOffer) {
    highlight = `邀你搭档：${squadOffer.specialty ? `${squadOffer.specialty} · ` : ""}${squadOffer.terms}`;
  } else if (owesYou[0]) {
    highlight = `欠你人情：${owesYou[0].text}`;
  } else if (grudges[0]) {
    highlight = `未了旧仇：${grudges[0].text}`;
  } else if (youOwe[0]) {
    highlight = `你欠人情：${youOwe[0].text}`;
  } else if (openJobs[0]) {
    highlight = `进行中委托：${openJobs[0].title}`;
  } else if (openConcerns[0]) {
    highlight = `心事（${openConcerns[0].statusLabel}）：${openConcerns[0].title}`;
  }

  const hasUnread = raw.unread > 0;
  const isActive =
    hasUnread ||
    Boolean(offeredMsg?.job) ||
    openJobs.length > 0 ||
    unsettled.length > 0 ||
    Boolean(doc?.debt) ||
    Boolean(squad && squad.owed > 0) ||
    Boolean(squadOffer) ||
    openConcerns.length > 0;
  const isUtility =
    Boolean(npc?.alive !== false) &&
    Boolean(doc || shops.length > 0 || isFixer || squad || squadOffer || npc?.services);
  const isPresent = Boolean(npc?.here && npc.alive);

  const latestMsg = msgs[0];
  return {
    key: raw.key,
    name: raw.name,
    npc,
    last: raw.last,
    unread: raw.unread,
    messageCount: msgs.length,
    preview: latestMsg
      ? latestMsg.sender === "player"
        ? `你：${latestMsg.text}`
        : latestMsg.text
      : null,
    fixer,
    squad,
    squadOffer,
    foe,
    badges,
    utilityLine: utilityParts.join(" · "),
    highlight,
    locatePlaceId: locateDest ? locateDest.id : null,
    locatePlaceName: locateDest ? locateDest.name : null,
    isActive,
    isUtility,
    isPresent,
  };
}

/** 整理消息页面的联系人名录，补充每人核心职能、可用服务、人情账与快捷跳转信息 */
export function contactDirectory(view: View): ContactSummary[] {
  const npcs = view.npcs ?? [];
  const messages = view.phone?.messages ?? [];
  const contacts = view.phone?.contacts ?? [];
  const fixers = view.jobs?.fixers ?? [];
  const squadMembers = view.squad?.members ?? [];
  const squadOffers = view.squad?.offers ?? [];
  const foes = view.combat?.active?.foes ?? [];

  const npcById = new Map(npcs.map((n) => [n.id, n]));
  const threads = new Map<string, ViewMessage[]>();
  for (const m of messages) {
    const list = threads.get(m.from);
    if (list) list.push(m);
    else threads.set(m.from, [m]);
  }

  const listed: RawContact[] = contacts.map((c) => ({
    key: c.from,
    name: c.name,
    npc: c.npc === null ? undefined : npcById.get(c.npc),
    last: c.last,
    unread: c.unread,
  }));
  const seen = new Set(listed.map((c) => c.key));
  const rest: RawContact[] = npcs
    .filter((n) => !seen.has(n.id))
    .map((n) => ({
      key: n.id,
      name: n.name,
      npc: n,
      last: n.lastSeen,
      unread: 0,
    }));

  return [...listed, ...rest].map((raw) => {
    const { npc } = raw;
    const fixer = npc ? fixers.find((f) => f.id === npc.id) : undefined;
    const squad = npc ? squadMembers.find((m) => m.npc === npc.id) : undefined;
    const squadOffer = npc ? squadOffers.find((o) => o.npc === npc.id) : undefined;
    const foe = foes.find(
      (f) => (npc && (f.npc === npc.id || f.id === npc.id)) || f.name === raw.name,
    );
    return summarizeNpcContact(
      raw,
      view,
      threads.get(raw.key) ?? [],
      fixer,
      squad,
      squadOffer,
      foe,
    );
  });
}

export interface ChatBubble {
  readonly key: string;
  readonly sender: "npc" | "player";
  readonly grouped: boolean;
  readonly text: string;
  readonly at: string | null;
  readonly unread: boolean;
  readonly job: ViewMessage["job"];
  readonly ack: boolean;
  readonly fallbackId: number | null;
  readonly pending: boolean;
}

/** 展平正向时间流消息（含旧档 reply 与本地发送中消息），相邻同方自动聚合 */
export function buildChatBubbles(
  thread: readonly ViewMessage[],
  pendingText: string | null,
): ChatBubble[] {
  const items: ChatBubble[] = [];
  for (const m of thread) {
    const sender: "npc" | "player" = m.sender === "player" ? "player" : "npc";
    items.push({
      key: `msg-${m.id}`,
      sender,
      grouped: items.at(-1)?.sender === sender,
      text: m.text,
      at: m.at,
      unread: sender === "npc" && !m.read,
      job: sender === "npc" ? m.job : null,
      ack: sender === "npc" && m.replied && !m.reply,
      fallbackId: sender === "npc" ? m.id : null,
      pending: false,
    });
    if (sender === "npc" && m.reply) {
      items.push({
        key: `reply-${m.id}`,
        sender: "player",
        grouped: items.at(-1)?.sender === "player",
        text: m.reply,
        at: m.repliedAt ?? null,
        unread: false,
        job: null,
        ack: false,
        fallbackId: null,
        pending: false,
      });
    }
  }
  if (pendingText !== null) {
    items.push({
      key: "pending-player",
      sender: "player",
      grouped: items.at(-1)?.sender === "player",
      text: pendingText,
      at: "发送中…",
      unread: false,
      job: null,
      ack: false,
      fallbackId: null,
      pending: true,
    });
  }
  return items;
}

/** 距离现在 15 分钟内即将到期的进行中委托或待办约定 */
export function urgentChatDeadline(
  view: View,
): { readonly title: string; readonly left: number } | null {
  let tightest: { readonly title: string; readonly left: number } | null = null;
  for (const job of view.jobs?.list ?? []) {
    if (!job.open || job.dueIn === null || job.dueIn <= 0 || job.dueIn > 15) continue;
    if (!tightest || job.dueIn < tightest.left) {
      tightest = { title: job.title, left: job.dueIn };
    }
  }
  for (const obj of view.objectives ?? []) {
    if (obj.dueIn === null || obj.dueIn <= 0 || obj.dueIn > 15) continue;
    if (!tightest || obj.dueIn < tightest.left) {
      tightest = { title: obj.title, left: obj.dueIn };
    }
  }
  return tightest;
}

export type WeaponConcealment = View["inventory"]["carriedWeapons"][number]["concealment"];
export type WeaponNoise = View["inventory"]["carriedWeapons"][number]["noise"];
export type WeaponStateProjection = NonNullable<
  View["inventory"]["carriedWeapons"][number]["weaponState"]
>;

export const CONCEALMENT_LABELS: Readonly<Record<WeaponConcealment, string>> = {
  pocket: "贴身可藏",
  coat: "风衣可遮",
  open: "显眼长械",
  heavy: "重型军火",
};

export const NOISE_LABELS: Readonly<Record<WeaponNoise, string>> = {
  silent: "已消音",
  loud: "有枪声",
  explosive: "爆破巨响",
};

/** 解析展示用物品名，绝不向界面泄漏 wpn:<baseId>:<seq> 原始实例 ID */
export function displayItemName(
  names: Readonly<Record<string, string>>,
  id: string,
  baseId?: string | null,
): string {
  const direct = names[id];
  if (direct && !direct.startsWith("wpn:")) return direct;
  const resolvedBase = baseId ?? baseWeaponIdOf(id);
  const baseName = names[resolvedBase];
  if (baseName && !baseName.startsWith("wpn:")) return baseName;
  return resolvedBase;
}

export interface WeaponStateModSummary {
  readonly slot: inventoryRules.ModSlot;
  readonly slotLabel: string;
  readonly modId: string;
  readonly modName: string;
  readonly locked: boolean;
}

export interface WeaponStateSummary {
  readonly mods: readonly WeaponStateModSummary[];
  readonly smartLink: boolean;
  readonly inlineText: string | null;
}

/** 汇总定制武器实例状态（已装配件与智能靶向联锁），供商店与物品栏共用 */
export function summarizeWeaponState(
  ws: WeaponStateProjection | null | undefined,
  resolveName: (id: string) => string,
): WeaponStateSummary | null {
  if (!ws) return null;
  const mods: WeaponStateModSummary[] = [];
  for (const slot of inventoryRules.ModSlotSchema.options) {
    const modId = ws.mods[slot];
    if (!modId) continue;
    mods.push({
      slot,
      slotLabel: inventoryRules.MOD_SLOT_LABELS[slot],
      modId,
      modName: resolveName(modId),
      locked: ws.lockedSlots.includes(slot),
    });
  }
  const smartLink = ws.smartLink;
  if (mods.length === 0 && !smartLink) return null;

  const parts: string[] = [];
  if (smartLink) parts.push("智能联锁");
  if (mods.length > 0) {
    parts.push(
      mods.map((m) => `[${m.slotLabel}] ${m.modName}${m.locked ? "（固锁）" : ""}`).join(" · "),
    );
  }
  return {
    mods,
    smartLink,
    inlineText: parts.join(" · "),
  };
}
