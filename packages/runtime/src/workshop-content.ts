import {
  braindances,
  chipContents,
  cyberware,
  gameContent,
  gameData,
  items,
  npcs,
  ripperdocs,
  shops,
} from "@cp/content";
import {
  customCyberwareDefs,
  customItemDefs,
  type inventoryRules,
  namespaceWorkshopPack,
  type npcRules,
  type StartCyberware,
  type WorkshopCatalogIndex,
  type WorkshopPack,
  workshopEntityPackId,
} from "@cp/core";

export const workshopCatalog: WorkshopCatalogIndex = {
  items,
  cyberware,
  npcs,
  braindances,
  chipContents,
  shops,
  ripperdocs,
};

function withListings<
  T extends {
    readonly id: string;
    readonly shelf: readonly string[];
    readonly initialStock?: Readonly<Record<string, number>> | undefined;
  },
>(
  rows: readonly T[],
  listings: readonly { readonly shop: string; readonly item: string; readonly stock: number }[],
): T[] {
  return rows.map((row) => {
    const own = listings.filter((entry) => entry.shop === row.id);
    if (own.length === 0) return row;
    const shelf = [...row.shelf];
    const stock = { ...row.initialStock };
    for (const listing of own) {
      if (!shelf.includes(listing.item)) shelf.push(listing.item);
      stock[listing.item] = listing.stock;
    }
    return { ...row, shelf, initialStock: stock };
  });
}

function withRipperdocListings(
  rows: typeof ripperdocs,
  listings: readonly {
    readonly ripperdoc: string;
    readonly cyberware: string;
    readonly stock: number;
  }[],
) {
  return rows.map((row) => {
    const own = listings.filter((entry) => entry.ripperdoc === row.id);
    if (own.length === 0) return row;
    const shelf = [...row.shelf];
    const stock = { ...row.initialStock };
    for (const listing of own) {
      if (!shelf.includes(listing.cyberware)) shelf.push(listing.cyberware);
      stock[listing.cyberware] = listing.stock;
    }
    return { ...row, shelf, initialStock: stock };
  });
}

/** 每份新存档基于自己冻结的内容包快照建立运行时目录（并注入角色自包含自定义义体、自建武器/物品与 NPC 卡面内嵌的自建装备定义）。 */
export function workshopRuntime(
  packs: readonly WorkshopPack[],
  extraCyberware?: readonly StartCyberware[],
  extraItems?: readonly inventoryRules.ItemDef[],
  /** 建档时写进世界的 NPC 卡面（覆写卡、自建人物、模块带出的人）：身体里内嵌的自建装备/义体定义随卡面进目录 */
  extraNpcCards: readonly { body?: npcRules.NpcBodyCard | undefined }[] = [],
) {
  const expanded = packs.map(namespaceWorkshopPack);
  const modules = expanded.flatMap((pack) => pack.modules);
  const acquaintances = expanded.flatMap((pack) => pack.acquaintances);
  const customNpcs = expanded.flatMap((pack) => pack.npcs);
  const packItems = expanded.flatMap((pack) => pack.items);
  const existingItemIds = new Set([...items, ...packItems].map((i) => i.id));
  const snapshotItems = customItemDefs(extraItems, existingItemIds);
  const customItems = [...packItems, ...snapshotItems];
  const packCyberware = expanded.flatMap((pack) => pack.cyberware);
  const existingCwIds = new Set([...cyberware, ...packCyberware].map((c) => c.id));
  const snapshotCyberware = customCyberwareDefs(extraCyberware, existingCwIds);
  const customCyberware = [...packCyberware, ...snapshotCyberware];
  // NPC 卡面内嵌的自建武器/物品与义体定义（改写过装备的原作/自建人物）：已存在于目录的按目录为准
  const npcCards = [...customNpcs, ...extraNpcCards];
  const seenItemIds = new Set(customItems.map((i) => i.id));
  for (const id of existingItemIds) seenItemIds.add(id);
  for (const def of npcCards.flatMap((c) => c.body?.itemDefs ?? [])) {
    if (seenItemIds.has(def.id) || !/^[a-z0-9-]+$/.test(def.id)) continue;
    seenItemIds.add(def.id);
    customItems.push(def);
  }
  const seenCwIds = new Set(customCyberware.map((c) => c.id));
  for (const id of existingCwIds) seenCwIds.add(id);
  for (const def of npcCards.flatMap((c) => c.body?.cyberwareDefs ?? [])) {
    if (seenCwIds.has(def.id)) continue;
    seenCwIds.add(def.id);
    customCyberware.push(def);
  }
  const customBraindances = expanded.flatMap((pack) => pack.braindances);
  const customChipContents = expanded.flatMap((pack) => pack.chipContents);
  const shopListings = expanded.flatMap((pack) => pack.shopListings);
  const ripperdocListings = expanded.flatMap((pack) => pack.ripperdocListings);
  // 「登场」的自建/工坊条目：黑市渠道流通——武器与军规件上歌舞伎黑市武器摊，
  // 杂货/衣物/补给上日本町商店街，自建义体上查尔斯·巴克斯的地下诊所（不问来路、价低不保修）。
  // 包作者显式排过上架位置的条目不再重复塞。
  const packListedItems = new Set(shopListings.map((entry) => entry.item));
  for (const item of customItems) {
    if (!item.worldSpawn || item.iconic || item.untradable || packListedItems.has(item.id)) {
      continue;
    }
    const shop =
      item.kind === "weapon" || item.kind === "grenade" || item.kind === "mod"
        ? "kabuki-arms"
        : "japantown-arcade";
    shopListings.push({ shop, item: item.id, stock: 2 });
  }
  const packListedChrome = new Set(ripperdocListings.map((entry) => entry.cyberware));
  for (const def of customCyberware) {
    if (!def.worldSpawn || def.iconic || packListedChrome.has(def.id)) continue;
    ripperdocListings.push({ ripperdoc: "charles-bucks", cyberware: def.id, stock: 2 });
  }
  const seededNpcIds = expanded.flatMap((pack) => pack.seedNpcs);
  const mergedShops = withListings(
    shops,
    shopListings.map((listing) => ({
      shop: listing.shop,
      item: listing.item,
      stock: listing.stock,
    })),
  );
  const mergedRipperdocs = withRipperdocListings(ripperdocs, ripperdocListings);
  const mergedNpcs = [...npcs, ...customNpcs];
  const mergedItems = [...items, ...customItems];
  const mergedCyberware = [...cyberware, ...customCyberware];
  const mergedOpenings = (gameContent.openings ?? []).map((opening) => ({
    ...opening,
    cast: [...new Set([...(opening.cast ?? []), ...seededNpcIds])],
  }));
  const content = {
    ...gameContent,
    npcs: mergedNpcs,
    items: mergedItems,
    cyberware: mergedCyberware,
    shops: mergedShops,
    ripperdocs: mergedRipperdocs,
    openings: mergedOpenings,
  };
  const data = {
    ...gameData,
    npcs: mergedNpcs,
    items: mergedItems,
    cyberware: mergedCyberware,
    shops: mergedShops,
    ripperdocs: mergedRipperdocs,
    braindances: [...braindances, ...customBraindances],
    chipContents: [...chipContents, ...customChipContents],
    modules,
  };
  const names = Object.fromEntries([
    ...customItems.map((item) => [item.id, item.name] as const),
    ...customCyberware.map((item) => [item.id, item.name] as const),
    ...customNpcs.map((item) => [item.id, item.name] as const),
    ...customBraindances.map((item) => [item.id, item.title] as const),
    ...customChipContents.map((item) => [item.id, item.title] as const),
  ]);
  return { content, data, modules, acquaintances, names, seededNpcIds };
}

export function requiredPackIds(
  board:
    | {
        readonly origin?: {
          readonly packId?: string | undefined;
          readonly id?: string | undefined;
        } | null;
        readonly pasts?: readonly {
          readonly packId?: string | undefined;
          readonly id?: string | undefined;
        }[];
        readonly skills?: readonly {
          readonly packId?: string | undefined;
          readonly id?: string | undefined;
        }[];
        readonly flaws?: readonly {
          readonly packId?: string | undefined;
          readonly id?: string | undefined;
        }[];
        readonly cyberware?: readonly {
          readonly packId?: string | undefined;
          readonly id: string;
        }[];
        readonly acquaintances?: readonly {
          readonly packId?: string | undefined;
          readonly id: string;
        }[];
        readonly kit?: {
          readonly weapons?: readonly string[];
          readonly items?: readonly { readonly id: string }[];
        };
      }
    | undefined,
): Set<string> {
  const ids = new Set<string>();
  if (!board) return ids;
  const modules = [
    ...(board.origin ? [board.origin] : []),
    ...(board.pasts ?? []),
    ...(board.skills ?? []),
    ...(board.flaws ?? []),
  ];
  for (const entry of modules) if (entry.packId && entry.packId !== "local") ids.add(entry.packId);
  for (const entry of [...(board.cyberware ?? []), ...(board.acquaintances ?? [])]) {
    if (entry.packId && entry.packId !== "local") ids.add(entry.packId);
  }
  const namespacedIds = [
    ...modules.map((entry) => entry.id).filter((id): id is string => !!id),
    ...(board.cyberware ?? []).map((entry) => entry.id),
    ...(board.acquaintances ?? []).map((entry) => entry.id),
    ...(board.kit?.weapons ?? []),
    ...(board.kit?.items ?? []).map((entry) => entry.id),
  ];
  for (const id of namespacedIds) {
    const packId = workshopEntityPackId(id);
    if (packId) ids.add(packId);
  }
  return ids;
}
