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
  namespaceWorkshopPack,
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

/** 每份新存档基于自己冻结的内容包快照建立运行时目录（并注入角色自包含自定义义体）。 */
export function workshopRuntime(
  packs: readonly WorkshopPack[],
  extraCyberware?: readonly StartCyberware[],
) {
  const expanded = packs.map(namespaceWorkshopPack);
  const modules = expanded.flatMap((pack) => pack.modules);
  const acquaintances = expanded.flatMap((pack) => pack.acquaintances);
  const customNpcs = expanded.flatMap((pack) => pack.npcs);
  const customItems = expanded.flatMap((pack) => pack.items);
  const packCyberware = expanded.flatMap((pack) => pack.cyberware);
  const existingCwIds = new Set([...cyberware, ...packCyberware].map((c) => c.id));
  const snapshotCyberware = customCyberwareDefs(extraCyberware, existingCwIds);
  const customCyberware = [...packCyberware, ...snapshotCyberware];
  const customBraindances = expanded.flatMap((pack) => pack.braindances);
  const customChipContents = expanded.flatMap((pack) => pack.chipContents);
  const shopListings = expanded.flatMap((pack) => pack.shopListings);
  const ripperdocListings = expanded.flatMap((pack) => pack.ripperdocListings);
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
        readonly kit?: { readonly weapons?: readonly string[] };
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
  ];
  for (const id of namespacedIds) {
    const packId = workshopEntityPackId(id);
    if (packId) ids.add(packId);
  }
  return ids;
}
