import { type cyberwareRules, economyRules, humanityRules } from "@cp/core";
import type { AssetId } from "../../assets";

export type CyberSlot = cyberwareRules.CyberwareSlot;
export type BodyLayerId = "skin" | "skeleton" | "nervous" | "circulatory" | "immune";

/** 原作义体页 10 部位对应的官方图标 */
export const CYBER_SLOT_ICON: Readonly<Record<CyberSlot, AssetId>> = {
  frontalCortex: "cyber.frontalCortex",
  eyes: "cyber.eyes",
  nervous: "cyber.nervous",
  os: "cyber.os",
  circulatory: "cyber.circulatory",
  integumentary: "cyber.integumentary",
  skeleton: "cyber.skeleton",
  hands: "cyber.hands",
  arms: "cyber.arms",
  legs: "cyber.legs",
};

/** 悬停或选中某个部位时，中央解剖图亮起的对应系统图层 */
export const SLOT_BODY_LAYERS: Readonly<Record<CyberSlot, readonly BodyLayerId[]>> = {
  frontalCortex: ["nervous"],
  eyes: ["nervous"],
  nervous: ["nervous"],
  os: ["skin", "nervous"],
  circulatory: ["circulatory", "immune"],
  integumentary: ["skin"],
  skeleton: ["skeleton"],
  hands: ["skin"],
  arms: ["skeleton"],
  legs: ["skeleton"],
};

const RARITY_COLOR: Readonly<Record<string, string>> = {
  common: "var(--rar-common)",
  uncommon: "var(--rar-uncommon)",
  rare: "var(--rar-rare)",
  epic: "var(--rar-epic)",
  legendary: "var(--rar-legendary)",
};

export const RARITY_ORDER: readonly economyRules.Rarity[] = [
  "common",
  "uncommon",
  "rare",
  "epic",
  "legendary",
];

export function rarityTintOf(rarity?: string | null, iconic?: boolean): string {
  if (iconic) return "var(--rar-iconic)";
  if (rarity && rarity in RARITY_COLOR) return RARITY_COLOR[rarity] ?? "var(--cp-cyan)";
  return "var(--cp-cyan)";
}

export function rarityLabelOf(rarity?: string | null, iconic?: boolean): string | null {
  const base =
    rarity && rarity in economyRules.RARITY_LABELS
      ? economyRules.RARITY_LABELS[rarity as economyRules.Rarity]
      : null;
  if (iconic && base) return `${base} · 不朽`;
  if (iconic) return "不朽";
  return base;
}

/** 汇总已装义体名义人性消耗（义体诊所手术预览与捏人算上限用） */
export function sumHumanityCost(parts: readonly { readonly humanityCost: number }[]): number {
  let total = 0;
  for (const part of parts) total += part.humanityCost;
  return total;
}

export function humanityToneOf(current: number): "ok" | "mid" | "warn" | "bad" {
  const stage = humanityRules.humanityStage(current);
  if (stage === "stable") return "ok";
  if (stage === "detached") return "mid";
  if (stage === "unstable") return "warn";
  return "bad";
}

export function humanityStageLabelOf(current: number): string {
  return humanityRules.STAGE_LABELS[humanityRules.humanityStage(current)];
}
