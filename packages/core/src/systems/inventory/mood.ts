import { z } from "zod";
import type { WorldState } from "../../kernel/world";
import { locationCatalog } from "../world";

/**
 * 势力的入口经 phone → jobs → npc 又引回 inventory，这里不引用势力系统；
 * 和 shops.ts 读店主一样，只读算店价要用的几项：势力表的 id、名字、初始态度，和记下的态度、成员与火拼区
 */
const ATTITUDE_IDS = ["kos", "hostile", "neutral", "friendly", "family"] as const;
type AttitudeId = (typeof ATTITUDE_IDS)[number];
const FactionRowsSchema = z
  .array(
    z.object({
      id: z.string(),
      name: z.string(),
      initial: z.enum(ATTITUDE_IDS).default("neutral"),
    }),
  )
  .catch([]);
const StancesSchema = z
  .object({
    stances: z.record(z.string(), z.object({ attitude: z.enum(ATTITUDE_IDS) })).default({}),
    membership: z.object({ faction: z.string() }).nullable().default(null),
    contested: z.record(z.string(), z.object({ district: z.string() })).default({}),
  })
  .catch({ stances: {}, membership: null, contested: {} });

/**
 * 势力态度对店价的影响（用户 2026-10-31 选的「势力进机制」："态度影响店价"；本作改编，暂定，试玩时调）：
 * 乘在货架价上；null 是不卖给你
 */
export const ATTITUDE_PRICE: Readonly<Record<AttitudeId, number | null>> = {
  kos: null,
  hostile: 1.3,
  neutral: 1,
  friendly: 0.9,
  family: 0.8,
};

/** 正式成员在所属势力门店的内部价系数 */
export const MEMBER_PRICE_FACTOR = 0.75;

/** 城区处于地盘火拼争夺中时货路受阻的微涨系数 */
export const CONTESTED_PRICE_FACTOR = 1.15;

/** 这家店已知的经营者势力立场或争夺区波动。 */
export interface ShopMood {
  readonly faction: string;
  readonly name: string;
  /** 乘在货架价上的系数；null 是不卖 */
  readonly factor: number | null;
  /** 玩家是否是该势力的正式成员（享内部价） */
  readonly member?: boolean;
  /** 所在城区是否处于火拼争夺中 */
  readonly contested?: boolean;
}

/** 只读人物卡上的所属势力，不引用 npc 的入口（npc 引用了 inventory） */
function keeperFaction(world: WorldState, id: string | undefined): string | undefined {
  if (id === undefined) return undefined;
  const npcs = (world.slices.npc as { npcs?: Record<string, { faction?: unknown }> } | undefined)
    ?.npcs;
  const faction = npcs?.[id]?.faction;
  return typeof faction === "string" && faction.length > 0 && faction !== "none"
    ? faction
    : undefined;
}

/**
 * 这家店/诊所受哪个势力的态度影响；中立、或者谁也不看的店是 undefined。
 * 优先认店主人物卡登记的所属势力，其次认门店/诊所显式声明的势力归属；不把城区地盘一刀切当作每家店的立场。
 */
export function shopMood(
  world: WorldState,
  data: Readonly<Record<string, unknown>>,
  shop: {
    readonly location: string;
    readonly keeperNpc?: string | undefined;
    readonly faction?: string | undefined;
  },
): ShopMood | undefined {
  const state = StancesSchema.parse(world.slices.factions ?? {});
  const district = locationCatalog(data).get(shop.location)?.district;
  const contested = district !== undefined && state.contested[district] !== undefined;

  const rows = FactionRowsSchema.parse(data.factions);
  const ownId =
    rows.length > 0
      ? (keeperFaction(world, shop.keeperNpc) ??
        (shop.faction && shop.faction !== "none" ? shop.faction : undefined))
      : undefined;
  const def = ownId === undefined ? undefined : rows.find((f) => f.id === ownId);

  let base: ShopMood | undefined;
  if (def) {
    const attitude = state.stances[def.id]?.attitude ?? def.initial;
    const member =
      state.membership?.faction === def.id && attitude !== "kos" && attitude !== "hostile";
    if (member) {
      base = { faction: def.id, name: def.name, factor: MEMBER_PRICE_FACTOR, member: true };
    } else if (attitude !== "neutral") {
      base = { faction: def.id, name: def.name, factor: ATTITUDE_PRICE[attitude] };
    }
  }

  if (!contested) return base;
  if (!base) {
    return {
      faction: "contested",
      name: `${district}地盘火拼`,
      factor: CONTESTED_PRICE_FACTOR,
      contested: true,
    };
  }
  if (base.factor === null) return base;
  return {
    ...base,
    factor: Number((base.factor * CONTESTED_PRICE_FACTOR).toFixed(2)),
    contested: true,
  };
}

/** 按势力态度折算一件货的价钱，舍到十位，最少 10 */
export function moodPrice(price: number, mood: ShopMood | undefined): number {
  if (mood?.factor == null) return price;
  return Math.max(10, Math.round((price * mood.factor) / 10) * 10);
}

/** 见面就打的势力的店不卖：给货架上的锁写原因 */
export function moodLock(mood: ShopMood | undefined): string | null {
  if (!mood || mood.factor !== null) return null;
  return `店主是${mood.name}的人，${mood.name}要你的命，拒绝交易`;
}
