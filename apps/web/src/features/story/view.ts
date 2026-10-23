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
    ["westbrook", "japantown", "charter", "north-oak", "northoak", "威斯布鲁克", "日本街"],
  ],
  ["district.center", ["center", "centre", "corpo", "downtown", "市中心"]],
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

/** 正文里玩家那一行的写法；旧存档按当时选的输入方式加标记，新输入原样显示 */
export function formatInput(input: TurnInput): string {
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
    if (delta > 0)
      out.push({ icon: "notify.inventory", text: `获得 ${id} ×${delta}`, tone: "good" });
    if (delta < 0)
      out.push({ icon: "notify.inventory", text: `失去 ${id} ×${-delta}`, tone: "bad" });
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

  return out.map((t, i) => ({ ...t, key: `${next.version}-${i}` }));
}
