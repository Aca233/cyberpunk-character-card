import { z } from "zod";
import type { ViewContext } from "../../kernel/system";
import { CharacterStateSchema } from "../character";
import { keeperOf, RARITY_LABELS } from "../economy";
import { HealthStateSchema } from "../health";
import { formatGameTime, WorldClockStateSchema } from "../world";
import { cyberwareCatalog, repairCost, ripperdocList, ripperdocShelf, tradeInValue } from "./apply";
import { CyberwareStateSchema, SLOT_LABELS } from "./schema";
import { bonusText } from "./view";

/**
 * npc 的入口引用了 cyberware（npc/body.ts），这里不能反过来引用 npc 的入口，否则成环；
 * 只读找医生要用的四项，和 npc 卡上的同名字段同形
 */
const KeeperCardsSchema = z.object({
  npcs: z
    .record(
      z.string(),
      z.object({ name: z.string(), affinity: z.number(), met: z.boolean(), alive: z.boolean() }),
    )
    .default({}),
});

/** 当前地点开着的义体医生；不在诊所时是 null */
export function ripperdocView({ world, data }: ViewContext) {
  const location = WorldClockStateSchema.parse(world.slices.world).location;
  const doc =
    location === null ? undefined : ripperdocList(data).find((d) => d.location === location);
  if (!doc) return null;
  const { installed, debts } = CyberwareStateSchema.parse(world.slices.cyberware ?? {});
  const broken = HealthStateSchema.parse(world.slices.health).brokenChrome;
  const streetCred = CharacterStateSchema.parse(world.slices.character).streetCred;
  const npcs = KeeperCardsSchema.parse(world.slices.npc ?? {}).npcs;
  const parts = cyberwareCatalog(data);
  const debt = debts.find((d) => d.doc === doc.id);
  const keeper = keeperOf(doc.keeperNpc, npcs);
  return {
    id: doc.id,
    name: doc.name,
    /** 医生对你的好感；没有人物卡或还没见过是 null */
    affinity: keeper?.affinity ?? null,
    note: doc.note,
    blackMarket: doc.blackMarket,
    /** 最多肯赊多少；0 是不赊账 */
    credit: doc.credit,
    /** 欠这位医生的钱 */
    debt: debt ? { amount: debt.amount, due: formatGameTime(debt.due) } : null,
    /** 卸下装着的义体时回收多少，按义体 id */
    buyback: Object.fromEntries(
      installed.map((c) => {
        const def = parts.get(c.id);
        return [c.id, def ? tradeInValue(def) : 0];
      }),
    ) as Readonly<Record<string, number>>,
    /** 打坏的义体修好要多少，按义体 id；没坏的不列 */
    repair: Object.fromEntries(
      installed.flatMap((c) => {
        const def = parts.get(c.id);
        return def && broken.includes(c.id) ? [[c.id, repairCost(def)]] : [];
      }),
    ) as Readonly<Record<string, number>>,
    shelf: ripperdocShelf(doc, parts, streetCred, installed, keeper).map((item) => ({
      id: item.def.id,
      name: item.def.name,
      slot: item.def.slot,
      slotLabel: SLOT_LABELS[item.def.slot],
      rarity: item.def.rarity,
      rarityLabel: RARITY_LABELS[item.def.rarity],
      price: item.price,
      tradeIn: item.tradeIn,
      net: item.net,
      humanityCost: item.def.humanityCost,
      ability: item.def.ability,
      bonusText: bonusText(item.def),
      locked: item.locked,
      installed: item.installed,
      replaces: item.replaces?.name ?? null,
    })),
  };
}

/** 欠义体医生的钱 */
export function ripperdocDebtsView({ world }: ViewContext) {
  const { debts } = CyberwareStateSchema.parse(world.slices.cyberware ?? {});
  return debts.map((d) => ({
    docName: d.docName,
    amount: d.amount,
    due: formatGameTime(d.due),
  }));
}
