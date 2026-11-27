import { z } from "zod";
import type { ViewContext } from "../../kernel/system";
import {
  CHROME_CARE_EXTREME_COST,
  CHROME_CARE_HEAVY_COST,
  CHROME_CARE_LOAD_MIN,
  CHROME_CARE_PERIOD_DAYS,
  CHROME_CARE_REMIND_BEFORE_DAYS,
  EconomyStateSchema,
  WEALTH_TIER_META,
  type WealthTier,
} from "./schema";

const MINUTES_PER_DAY = 1440;

const HomesProbeSchema = z
  .object({
    homes: z
      .array(
        z.object({
          id: z.string(),
          tenure: z.string().optional(),
        }),
      )
      .default([]),
  })
  .catch({ homes: [] });

const VehiclesProbeSchema = z
  .object({
    vehicles: z
      .array(z.object({ model: z.string(), abandoned: z.boolean().optional() }))
      .default([]),
  })
  .catch({ vehicles: [] });

const TraumaProbeSchema = z
  .object({
    tier: z.enum(["none", "silver", "platinum"]).default("none"),
    expiresAt: z.number().nullable().default(null),
  })
  .catch({ tier: "none", expiresAt: null });

const ChromeProbeSchema = z
  .object({
    installed: z.array(z.object({ id: z.string(), armSide: z.string().optional() })).default([]),
  })
  .catch({ installed: [] });

const BrokenProbeSchema = z
  .object({ brokenChrome: z.array(z.string()).default([]) })
  .catch({ brokenChrome: [] });

export interface WealthStandingView {
  readonly tier: WealthTier;
  readonly label: string;
  readonly summary: string;
  readonly assets: readonly string[];
}

export interface ChromeCareBillView {
  readonly cost: number;
  readonly loadScore: number;
  readonly fbc: boolean;
  readonly dueAt: number;
  readonly daysLeft: number;
  readonly overdue: boolean;
  readonly dueSoon: boolean;
  readonly label: string;
}

function vehiclePriceMap(data: Readonly<Record<string, unknown>>): ReadonlyMap<string, number> {
  const map = new Map<string, number>();
  if (!Array.isArray(data.vehicles)) return map;
  for (const row of data.vehicles) {
    if (
      typeof row === "object" &&
      row !== null &&
      typeof (row as { id?: unknown }).id === "string" &&
      typeof (row as { price?: unknown }).price === "number"
    ) {
      map.set((row as { id: string }).id, (row as { price: number }).price);
    }
  }
  return map;
}

function computeChromeLoad(
  world: ViewContext["world"],
  data: Readonly<Record<string, unknown>>,
): { readonly loadScore: number; readonly fbc: boolean } {
  const installed = ChromeProbeSchema.parse(world.slices.cyberware ?? {}).installed;
  const broken = new Set(BrokenProbeSchema.parse(world.slices.health ?? {}).brokenChrome);
  const catalog = new Map<
    string,
    { readonly humanityCost: number; readonly category?: string; readonly exclusiveGroup?: string }
  >();
  if (Array.isArray(data.cyberware)) {
    for (const row of data.cyberware) {
      if (
        typeof row === "object" &&
        row !== null &&
        typeof (row as { id?: unknown }).id === "string"
      ) {
        const r = row as {
          id: string;
          humanityCost?: unknown;
          category?: unknown;
          exclusiveGroup?: unknown;
        };
        catalog.set(r.id, {
          humanityCost: typeof r.humanityCost === "number" ? r.humanityCost : 0,
          ...(typeof r.category === "string" ? { category: r.category } : {}),
          ...(typeof r.exclusiveGroup === "string" ? { exclusiveGroup: r.exclusiveGroup } : {}),
        });
      }
    }
  }
  let loadScore = 0;
  let fbc = false;
  for (const c of installed) {
    if (broken.has(c.id)) continue;
    const def = catalog.get(c.id);
    if (!def) continue;
    if (def.category === "chassis" || def.exclusiveGroup === "fullBorg") fbc = true;
    const factor = c.armSide === "left" || c.armSide === "right" ? 0.6 : 1;
    loadScore += Math.round(def.humanityCost * factor);
  }
  return { loadScore, fbc };
}

export function chromeCareStatus(
  world: ViewContext["world"],
  data: Readonly<Record<string, unknown>>,
): ChromeCareBillView | null {
  const { loadScore, fbc } = computeChromeLoad(world, data);
  if (!fbc && loadScore < CHROME_CARE_LOAD_MIN) return null;
  const economy = EconomyStateSchema.parse(world.slices.economy);
  const periodMinutes = CHROME_CARE_PERIOD_DAYS * MINUTES_PER_DAY;
  const dueAt =
    typeof economy.chromeCarePaidUntil === "number"
      ? economy.chromeCarePaidUntil
      : Math.ceil((world.time + 1) / periodMinutes) * periodMinutes;
  const remainingMinutes = dueAt - world.time;
  const daysLeft = Math.max(0, Math.ceil(remainingMinutes / MINUTES_PER_DAY));
  const overdue = remainingMinutes <= 0;
  const dueSoon = !overdue && daysLeft <= CHROME_CARE_REMIND_BEFORE_DAYS;
  const cost = fbc || loadScore >= 35 ? CHROME_CARE_EXTREME_COST : CHROME_CARE_HEAVY_COST;
  return {
    cost,
    loadScore,
    fbc,
    dueAt,
    daysLeft,
    overdue,
    dueSoon,
    label: fbc || loadScore >= 35 ? "高压义体深度神经校准" : "重度义体神经校准维护",
  };
}

export function computeWealthStanding(
  world: ViewContext["world"],
  data: Readonly<Record<string, unknown>>,
): WealthStandingView {
  const eddies = EconomyStateSchema.parse(world.slices.economy).eddies;
  const homes = HomesProbeSchema.parse(world.slices.safehouse ?? {}).homes;
  const vehicles = VehiclesProbeSchema.parse(world.slices.travel ?? {}).vehicles.filter(
    (v) => !v.abandoned,
  );
  const trauma = TraumaProbeSchema.parse(world.slices.trauma ?? {});
  const traumaActive =
    trauma.tier !== "none" && (trauma.expiresAt === null || trauma.expiresAt > world.time);

  const carPrices = vehiclePriceMap(data);
  const topCarPrice = vehicles.reduce((max, v) => Math.max(max, carPrices.get(v.model) ?? 0), 0);
  const ownsCorpoApt = homes.some((h) => h.id === "apartment-corpo-plaza");
  const ownsUpscaleApt = homes.some(
    (h) => h.id === "apartment-glen" || h.id === "apartment-japantown",
  );
  const ownedHomeCount = homes.filter((h) => h.tenure !== "rented").length;

  const assets: string[] = [];
  if (ownsCorpoApt) assets.push("公司广场豪宅");
  else if (ownsUpscaleApt) assets.push("自有高档公寓");
  else if (ownedHomeCount > 0) assets.push("自有落脚点");
  if (topCarPrice >= 90_000) assets.push("顶级超跑");
  else if (topCarPrice >= 50_000) assets.push("高档座驾");
  else if (vehicles.length > 0) assets.push("自有载具");
  if (traumaActive && trauma.tier === "platinum") assets.push("创伤白金卡");
  else if (traumaActive && trauma.tier === "silver") assets.push("创伤银卡");

  let tier: WealthTier;
  if (eddies >= 100_000 || ownsCorpoApt || (eddies >= 60_000 && topCarPrice >= 90_000)) {
    tier = "mogul";
  } else if (
    eddies >= 35_000 ||
    ownsUpscaleApt ||
    topCarPrice >= 55_000 ||
    (traumaActive && trauma.tier === "platinum")
  ) {
    tier = "affluent";
  } else if (eddies >= 8_000 || topCarPrice >= 25_000 || ownedHomeCount >= 2) {
    tier = "comfortable";
  } else if (eddies >= 1_000 || vehicles.length > 0) {
    tier = "scraping";
  } else {
    tier = "broke";
  }

  return {
    tier,
    ...WEALTH_TIER_META[tier],
    assets,
  };
}

/** 玩家可见的欧元、夜之城身家阶层与重度义体神经校准账单 */
export function moneyView({ world, data }: ViewContext) {
  const economy = EconomyStateSchema.parse(world.slices.economy);
  return {
    eddies: economy.eddies,
    wealth: computeWealthStanding(world, data),
    chromeCare: chromeCareStatus(world, data),
  };
}
