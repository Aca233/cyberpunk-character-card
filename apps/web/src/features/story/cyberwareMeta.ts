import { type cyberwareRules, economyRules, humanityRules } from "@cp/core";
import type { AssetId } from "../../assets";

export type CyberSlot = cyberwareRules.CyberwareSlot;

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

interface CyberBodyArt {
  readonly base: AssetId;
  readonly detail?: {
    readonly id: AssetId;
    /** 在 1089×1861 完整人体图内的原图像素坐标，不随容器尺寸变化。 */
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
  };
}

export const CYBER_BODY_FRAME = { width: 1089, height: 1861 } as const;

/**
 * ma_* 的系统图是完整视图，只选一张；局部图才叠在皮肤底图上。
 * 局部位置取自原作 ripperdoc.inkwidget：共用居中锚点、0.9 缩放，
 * 相对皮肤图的坐标 = (完整尺寸 - 局部尺寸) / 2 + margin 差 / 0.9。
 */
export const CYBER_BODY_ART: Readonly<Record<CyberSlot, CyberBodyArt>> = {
  frontalCortex: {
    base: "cyber.bodySkin",
    detail: {
      id: "cyber.bodyFrontalCortex",
      left: 448.667,
      top: 0.444,
      width: 205,
      height: 349,
    },
  },
  eyes: {
    base: "cyber.bodySkin",
    detail: { id: "cyber.bodyEyes", left: 450, top: -0.111, width: 189, height: 219 },
  },
  nervous: { base: "cyber.bodyNervous" },
  os: {
    base: "cyber.bodySkin",
    detail: { id: "cyber.bodyOs", left: 303.833, top: 0.5, width: 508, height: 760 },
  },
  circulatory: { base: "cyber.bodyCirculatory" },
  integumentary: { base: "cyber.bodySkin" },
  skeleton: { base: "cyber.bodySkeleton" },
  hands: {
    base: "cyber.bodySkin",
    detail: { id: "cyber.bodyHands", left: 0, top: 745.056, width: 1089, height: 222 },
  },
  arms: {
    base: "cyber.bodySkin",
    detail: { id: "cyber.bodyArms", left: 87.611, top: 511.444, width: 916, height: 327 },
  },
  legs: {
    base: "cyber.bodySkin",
    detail: { id: "cyber.bodyLegs", left: 265.778, top: 768.444, width: 533, height: 1093 },
  },
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
