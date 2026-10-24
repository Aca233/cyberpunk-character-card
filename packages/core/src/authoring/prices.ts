/** 内容参考价：工坊与 check-data 共用；不决定交易时的折扣或实际成交价。 */
export type PriceBand = readonly [number, number];

export const WEAPON_PRICES: Readonly<Record<string, PriceBand>> = {
  // 保留现有检查规则：普通街头武器不设下限。
  common: [0, 1_500],
  uncommon: [1_500, 5_000],
  rare: [5_000, 15_000],
  epic: [15_000, 40_000],
  legendary: [40_000, Number.POSITIVE_INFINITY],
};

export const CHROME_PRICES: Readonly<Record<string, PriceBand>> = {
  common: [1_000, 5_000],
  uncommon: [5_000, 15_000],
  rare: [15_000, 35_000],
  epic: [35_000, 70_000],
  legendary: [70_000, Number.POSITIVE_INFINITY],
};

export interface PricedContent {
  readonly name: string;
  readonly kind?: string | undefined;
  readonly rarity?: string | undefined;
  readonly price?: number | undefined;
  readonly iconic?: boolean | undefined;
}

/** 先由条目 schema 校验字段，再调用此函数核对参考价。 */
export function contentPriceIssues(kind: "item" | "cyberware", entry: PricedContent): string[] {
  if (entry.iconic || entry.rarity === undefined || entry.price === undefined) return [];
  if (kind === "item" && entry.kind !== "weapon" && entry.kind !== "mod") return [];
  const table = kind === "cyberware" ? CHROME_PRICES : WEAPON_PRICES;
  const band = table[entry.rarity];
  if (!band || (entry.price >= band[0] && entry.price <= band[1])) return [];
  const label = kind === "cyberware" ? "义体" : entry.kind === "mod" ? "改装件" : "武器";
  const upper = band[1] === Number.POSITIVE_INFINITY ? "∞" : String(band[1]);
  return [
    `${label}「${entry.name}」：${entry.rarity} 的价格 ${entry.price} 不在 ${band[0]}–${upper}`,
  ];
}
