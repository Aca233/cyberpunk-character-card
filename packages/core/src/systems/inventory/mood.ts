import { z } from "zod";
import type { WorldState } from "../../kernel/world";
import { locationCatalog } from "../world";
import type { Shop } from "./schema";

/**
 * 势力的入口经 phone → jobs → npc 又引回 inventory，这里不引用势力系统；
 * 和 shops.ts 读店主一样，只读算店价要用的几项：势力表的 id、名字、种类、地盘，和记下的态度
 */
const ATTITUDE_IDS = ["kos", "hostile", "neutral", "friendly", "family"] as const;
type AttitudeId = (typeof ATTITUDE_IDS)[number];
const FactionRowsSchema = z
  .array(
    z.object({
      id: z.string(),
      name: z.string(),
      kind: z.string(),
      turf: z.array(z.string()).default([]),
      initial: z.enum(ATTITUDE_IDS).default("neutral"),
    }),
  )
  .catch([]);
const StancesSchema = z
  .object({
    stances: z.record(z.string(), z.object({ attitude: z.enum(ATTITUDE_IDS) })).default({}),
  })
  .catch({ stances: {} });

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

/** 这家店看谁的脸色：店主自己的势力，或者店开在哪个帮派的地盘上 */
export interface ShopMood {
  readonly faction: string;
  readonly name: string;
  /** 乘在货架价上的系数；null 是不卖 */
  readonly factor: number | null;
  readonly why: "keeper" | "turf";
}

/** 只读人物卡上的所属势力，不引用 npc 的入口（npc 引用了 inventory） */
function keeperFaction(world: WorldState, id: string | undefined): string | undefined {
  if (id === undefined) return undefined;
  const npcs = (world.slices.npc as { npcs?: Record<string, { faction?: unknown }> } | undefined)
    ?.npcs;
  const faction = npcs?.[id]?.faction;
  return typeof faction === "string" ? faction : undefined;
}

/**
 * 这家店受哪个势力的态度影响；中立、或者谁也不看的店是 undefined。
 * 地盘按势力表上的原始地盘算，势力动向打下、丢掉的城区这里不算（暂定）
 */
export function shopMood(
  world: WorldState,
  data: Readonly<Record<string, unknown>>,
  shop: Shop,
): ShopMood | undefined {
  const rows = FactionRowsSchema.parse(data.factions);
  if (rows.length === 0) return undefined;
  const ownId = keeperFaction(world, shop.keeperNpc);
  let def = ownId === undefined ? undefined : rows.find((f) => f.id === ownId);
  let why: ShopMood["why"] = "keeper";
  if (!def) {
    const district = locationCatalog(data).get(shop.location)?.district;
    if (district === undefined) return undefined;
    def = rows.find((f) => f.kind === "gang" && f.turf.includes(district));
    why = "turf";
  }
  if (!def) return undefined;
  const attitude =
    StancesSchema.parse(world.slices.factions ?? {}).stances[def.id]?.attitude ?? def.initial;
  if (attitude === "neutral") return undefined;
  return { faction: def.id, name: def.name, factor: ATTITUDE_PRICE[attitude], why };
}

/** 按势力态度折算一件货的价钱，舍到十位，最少 10 */
export function moodPrice(price: number, mood: ShopMood | undefined): number {
  if (mood?.factor == null) return price;
  return Math.max(10, Math.round((price * mood.factor) / 10) * 10);
}

/** 见面就打的势力的店不卖：给货架上的锁写原因 */
export function moodLock(mood: ShopMood | undefined): string | null {
  if (!mood || mood.factor !== null) return null;
  return mood.why === "keeper"
    ? `店主是${mood.name}的人，${mood.name}要你的命，不卖`
    : `这里是${mood.name}的地盘，${mood.name}要你的命，店家不敢卖`;
}
