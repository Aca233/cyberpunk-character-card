import type { ViewContext } from "../../kernel/system";
import { keeperOf, RARITY_LABELS } from "../economy";
import { HealthStateSchema } from "../health";
import { formatGameTime, WorldClockStateSchema } from "../world";
import { cyberwareCatalog, repairCost, ripperdocList, ripperdocShelf, tradeInValue } from "./apply";
import { clinicProvider, DoctorRosterSchema, quoteCyberware } from "./quote";
import { CyberwareStateSchema, SLOT_LABELS } from "./schema";
import { bonusText } from "./view";

/** 当前地点开着的义体医生；不在诊所时是 null */
export function ripperdocView({ world, data }: ViewContext) {
  const location = WorldClockStateSchema.parse(world.slices.world).location;
  const doc =
    location === null ? undefined : ripperdocList(data).find((d) => d.location === location);
  if (!doc) return null;
  const { installed, debts } = CyberwareStateSchema.parse(world.slices.cyberware ?? {});
  const broken = HealthStateSchema.parse(world.slices.health).brokenChrome;
  const npcs = DoctorRosterSchema.parse(world.slices.npc ?? {}).npcs;
  const parts = cyberwareCatalog(data);
  const debt = debts.find((d) => d.doc === doc.id);
  const keeper = keeperOf(doc.keeperNpc, npcs);
  const provider = clinicProvider(doc, npcs);
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
        const quote = quoteCyberware(world, data, {
          action: "remove",
          doc: doc.id,
          id: c.id,
          tradeIn: true,
        });
        return [c.id, quote.ok ? quote.quote.receive : def ? tradeInValue(def) : 0];
      }),
    ) as Readonly<Record<string, number>>,
    /** 打坏的义体修好要多少，按义体 id；没坏的不列 */
    repair: Object.fromEntries(
      installed.flatMap((c) => {
        const def = parts.get(c.id);
        if (!def || !broken.includes(c.id)) return [];
        const quote = quoteCyberware(world, data, { action: "repair", doc: doc.id, id: c.id });
        return [[c.id, quote.ok ? quote.quote.total : repairCost(def)]];
      }),
    ) as Readonly<Record<string, number>>,
    shelf: ripperdocShelf(doc, parts, installed).map((item) => {
      const result = item.installed
        ? undefined
        : quoteCyberware(world, data, {
            action: "install",
            doc: doc.id,
            id: item.def.id,
            replace: item.replaces?.id,
            tradeIn: item.replaces ? true : undefined,
          });
      const quote = result?.ok ? result.quote : undefined;
      return {
        id: item.def.id,
        name: item.def.name,
        slot: item.def.slot,
        slotLabel: SLOT_LABELS[item.def.slot],
        rarity: item.def.rarity,
        rarityLabel: RARITY_LABELS[item.def.rarity],
        iconic: item.def.iconic,
        price: quote?.price ?? item.price,
        tradeIn: quote?.tradeIn ?? item.tradeIn,
        net: quote?.total ?? item.net,
        humanityCost: 0,
        ability: item.def.ability,
        bonusText: bonusText(item.def),
        attributes: item.def.attributes,
        checks: item.def.checks,
        armor: item.def.armor,
        accelerator: item.def.accelerator,
        programSlots: item.def.programSlots,
        ram: item.def.ram,
        locked: !provider.ok ? provider.reason : result && !result.ok ? result.reason : item.locked,
        installed: item.installed,
        replaces: item.replaces?.name ?? null,
        replacesId: item.replaces?.id ?? null,
        replacesRarity: item.replaces?.rarity ?? null,
        replacesHumanityCost: 0,
      };
    }),
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
