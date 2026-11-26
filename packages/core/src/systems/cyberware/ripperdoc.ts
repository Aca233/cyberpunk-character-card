import type { ViewContext } from "../../kernel/system";
import { RARITY_LABELS } from "../economy";
import { HealthStateSchema } from "../health";
import { formatGameTime, merchantAt, WorldClockStateSchema } from "../world";
import { cyberwareCatalog, repairCost, ripperdocList, ripperdocShelf, tradeInValue } from "./apply";
import { clinicProvider, DoctorRosterSchema, quoteCyberware } from "./quote";
import {
  CYBERWARE_CATEGORY_LABELS,
  CyberwareStateSchema,
  cyberwareCategoryOf,
  cyberwareExclusiveGroup,
  cyberwareExtensionZone,
  cyberwareSectionOf,
  DECK_TRAIT_LABELS,
  EXCLUSIVE_GROUP_LABELS,
  SECTION_LABELS,
  SLOT_LABELS,
} from "./schema";
import { clinicState } from "./stock";
import { bonusText } from "./view";

/** 当前地点开着的义体医生；不在诊所时是 null */
export function ripperdocView({ world, data }: ViewContext) {
  const state = CyberwareStateSchema.parse(world.slices.cyberware ?? {});
  const location = WorldClockStateSchema.parse(world.slices.world).location;
  const doc =
    location === null
      ? undefined
      : ripperdocList(data, state).find((d) => merchantAt(data, d.id, d.location, location));
  if (!doc) return null;
  const { installed, debts } = state;
  const clinic = clinicState(state, doc, world.time);
  const broken = HealthStateSchema.parse(world.slices.health).brokenChrome;
  const npcs = DoctorRosterSchema.parse(world.slices.npc ?? {}).npcs;
  const parts = cyberwareCatalog(data);
  const owed = debts.filter((d) => d.doc === doc.id);
  const due = owed.flatMap((d) => (d.due === null ? [] : [d.due])).sort((a, b) => a - b)[0];
  const provider = clinicProvider(doc, npcs, clinic.staff, data);
  return {
    id: doc.id,
    name: doc.name,
    keeperNpc: doc.keeperNpc ?? null,
    note: doc.note,
    blackMarket: doc.blackMarket,
    /** 最多肯赊多少；0 是不赊账 */
    credit: doc.credit,
    creditDays: doc.creditDays,
    /** 欠这位医生的钱 */
    debt: owed.length
      ? {
          amount: owed.reduce((sum, d) => sum + d.amount, 0),
          due: due === undefined ? "未约定期限" : formatGameTime(due),
        }
      : null,
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
    shelf: ripperdocShelf(
      {
        ...doc,
        shelf: [
          ...new Set([
            ...doc.shelf,
            ...Object.keys(clinic.stock),
            ...Object.values(state.parts)
              .filter((part) => part.holder === doc.id)
              .map((part) => part.model),
          ]),
        ],
      },
      parts,
      installed,
    ).map((item) => {
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
      const section = cyberwareSectionOf(item.def);
      const category = cyberwareCategoryOf(item.def);
      const extensionZone = cyberwareExtensionZone(item.def);
      return {
        id: item.def.id,
        name: item.def.name,
        slot: item.def.slot,
        slotLabel: SLOT_LABELS[item.def.slot],
        section,
        sectionLabel: SECTION_LABELS[section],
        category,
        categoryLabel: CYBERWARE_CATEGORY_LABELS[category],
        extensionZone,
        rarity: item.def.rarity,
        rarityLabel: RARITY_LABELS[item.def.rarity],
        iconic: item.def.iconic,
        humanityCost: item.def.humanityCost,
        defaultArmSide: item.def.defaultArmSide,
        capacityBonus: item.def.capacityBonus,
        safeLineBonus: item.def.safeLineBonus,
        chassisProfile: item.def.chassisProfile,
        variantGroup: item.def.variantGroup,
        variantKey: item.def.variantKey,
        exclusiveGroup: cyberwareExclusiveGroup(item.def),
        exclusiveGroupLabel: (() => {
          const g = cyberwareExclusiveGroup(item.def);
          return g ? EXCLUSIVE_GROUP_LABELS[g] : null;
        })(),
        price: quote?.price ?? item.price,
        tradeIn: quote?.tradeIn ?? item.tradeIn,
        net: quote?.total ?? item.net,
        inStock:
          (clinic.stock[item.def.id] ?? 0) +
          Object.values(state.parts).filter(
            (part) =>
              part.holder === doc.id && part.model === item.def.id && part.condition === "intact",
          ).length,
        ability: item.def.ability,
        bonusText: bonusText(item.def),
        armor: item.def.armor,
        accelerator: item.def.accelerator,
        deckProfile: item.def.deckProfile,
        deckTraits: item.def.deckTraits?.map((t) => DECK_TRAIT_LABELS[t]),
        locked: !clinic.open
          ? clinic.reason
          : !provider.ok
            ? provider.reason
            : result && !result.ok
              ? result.reason
              : item.locked,
        installed: item.installed,
        replaces: item.replaces?.name ?? null,
        replacesId: item.replaces?.id ?? null,
        replacesRarity: item.replaces?.rarity ?? null,
      };
    }),
  };
}

/** 欠义体医生的钱 */
export function ripperdocDebtsView({ world, data }: ViewContext) {
  const state = CyberwareStateSchema.parse(world.slices.cyberware ?? {});
  const docs = new Map(ripperdocList(data, state).map((doc) => [doc.id, doc]));
  return state.debts.map((d) => ({
    docId: d.doc,
    docName: d.docName,
    location: docs.get(d.doc)?.location ?? null,
    amount: d.amount,
    due: d.due === null ? "未约定期限" : formatGameTime(d.due),
    dueIn: d.due === null ? null : d.due - world.time,
    overdue: d.due !== null && d.due <= world.time,
  }));
}
