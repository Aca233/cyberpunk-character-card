import { z } from "zod";
import type { ViewContext } from "../../kernel/system";
import type { WorldState } from "../../kernel/world";
import { keeperOf, RARITY_LABELS } from "../economy";
import { formatGameTime, merchantAt, merchantSites, WorldClockStateSchema } from "../world";
import {
  defaultInstanceStateFromDef,
  itemCatalog,
  rarityOf,
  shopList,
  withWorldObjects,
} from "./apply";
import {
  GUNSMITH_SERVICE_RATE,
  gunsmithAvailability,
  isGunsmithShop,
  quoteGunsmith,
} from "./gunsmith";
import { merchantState, withMerchants } from "./merchants";
import { weaponDisplayNames } from "./names";
import {
  CLOTHING_SLOT_LABELS,
  canAttachMod,
  carriedItemCounts,
  carriedWeaponIds,
  defaultWeaponSlots,
  effectiveConcealment,
  effectiveWeaponNoise,
  InventoryStateSchema,
  ITEM_KIND_LABELS,
  type ItemDef,
  isBulkyItem,
  MOD_SLOT_LABELS,
  projectWeaponState,
  type Shop,
  WEAPON_CATEGORY_LABELS,
  WEAPON_TYPE_LABELS,
  type WeaponInstanceState,
  weaponGrantsSmartLink,
} from "./schema";
import { nextRarity, quoteTrade } from "./trade";

function itemGroup(def: ItemDef): string {
  return def.kind === "weapon" && def.category
    ? WEAPON_CATEGORY_LABELS[def.category]
    : ITEM_KIND_LABELS[def.kind];
}

function itemSubLabel(def: ItemDef): string {
  if (def.kind === "weapon") {
    return [
      def.weaponType ? WEAPON_TYPE_LABELS[def.weaponType] : null,
      def.category ? WEAPON_CATEGORY_LABELS[def.category] : null,
    ]
      .filter(Boolean)
      .join("");
  }
  if (def.kind === "clothing" && def.clothingSlot) {
    return CLOTHING_SLOT_LABELS[def.clothingSlot];
  }
  if (def.kind === "mod" && def.modSlot) {
    return `改装 · ${MOD_SLOT_LABELS[def.modSlot]}`;
  }
  return ITEM_KIND_LABELS[def.kind];
}

function itemMeta(def: ItemDef, ws: WeaponInstanceState | undefined) {
  const baseId = ws?.baseId ?? def.id;
  const rar = def.rarity || def.kind === "weapon" ? rarityOf(def, ws) : null;
  return {
    baseId,
    group: itemGroup(def),
    kind: def.kind,
    subLabel: itemSubLabel(def),
    rarity: rar,
    rarityLabel: def.iconic ? "不朽" : rar ? RARITY_LABELS[rar] : null,
    iconic: def.iconic ?? false,
    ability: def.ability ?? null,
    bulky: isBulkyItem(def, baseId),
    weaponState: projectWeaponState(ws),
  };
}

/**
 * npc 的入口引用了 inventory（npc/body.ts），这里不反向引用 npc 的入口；
 * 只读取找店主要用的四项，不把人物卡的其他内容带进商店投影
 */
const KeeperCardsSchema = z.object({
  npcs: z
    .record(
      z.string(),
      z.object({ name: z.string(), affinity: z.number(), met: z.boolean(), alive: z.boolean() }),
    )
    .default({}),
});

function projectGunsmithShop(
  world: WorldState,
  data: Readonly<Record<string, unknown>>,
  inventory: ReturnType<typeof InventoryStateSchema.parse>,
  shop: Shop,
  catalog: ReadonlyMap<string, ItemDef>,
  shelfIds: readonly string[],
  stock: Readonly<Record<string, number>>,
  sellCounts: ReadonlyMap<string, number>,
  sellNames: ReadonlyMap<string, string>,
) {
  if (!isGunsmithShop(shop, data)) return null;
  const available = gunsmithAvailability(world, shop, data);
  const weaponIds = carriedWeaponIds(inventory, catalog);
  const shelfMods = shelfIds.flatMap((id) => {
    const def = catalog.get(id);
    return def?.kind === "mod" ? [def] : [];
  });
  const backpackMods = [...sellCounts.keys()].flatMap((id) => {
    const def = catalog.get(id);
    return def?.kind === "mod" ? [def] : [];
  });

  return {
    serviceRate: GUNSMITH_SERVICE_RATE,
    available,
    weapons: weaponIds.flatMap((weaponId) => {
      const obj = inventory.objects[weaponId];
      const def = catalog.get(weaponId) ?? obj?.definition;
      if (def?.kind !== "weapon" || def.category === undefined) return [];
      const ws = obj?.weaponState ?? defaultInstanceStateFromDef(def);
      const baseId = ws?.baseId ?? def.id;
      const rar = rarityOf(def, ws);
      const nextRar = nextRarity(rar);
      const tuneRes = quoteGunsmith(
        world,
        data,
        { shop: shop.id, action: "tune", weapon: weaponId },
        { checkFunds: false },
      );
      const smartEligible = def.weaponType === "smart";
      const smartInstalled = weaponGrantsSmartLink(def, ws, catalog);
      const smartRes =
        smartEligible && !smartInstalled
          ? quoteGunsmith(
              world,
              data,
              { shop: shop.id, action: "convert", conversion: "smart-link", weapon: weaponId },
              { checkFunds: false },
            )
          : null;
      const isMelee = def.category === "blade" || def.category === "blunt";

      return [
        {
          id: weaponId,
          baseId,
          name: sellNames.get(weaponId) ?? def.name,
          subLabel: itemSubLabel(def),
          rarity: rar,
          rarityLabel: def.iconic ? "不朽" : RARITY_LABELS[rar],
          iconic: def.iconic ?? false,
          concealment: effectiveConcealment(def, ws, catalog),
          noise: effectiveWeaponNoise(def, ws, catalog),
          grantsSmartLink: smartInstalled,
          weaponState: projectWeaponState(ws),
          tune: {
            nextRarity: nextRar,
            nextRarityLabel: nextRar ? RARITY_LABELS[nextRar] : null,
            price: tuneRes.ok ? tuneRes.quote.total : null,
            locked: tuneRes.ok ? tuneRes.quote.blocked : tuneRes.reason,
          },
          smartLinkConvert: {
            eligible: smartEligible,
            installed: smartInstalled,
            partsFee: smartRes?.ok ? smartRes.quote.partsFee : null,
            serviceFee: smartRes?.ok ? smartRes.quote.serviceFee : null,
            total: smartRes?.ok ? smartRes.quote.total : null,
            locked: smartRes ? (smartRes.ok ? smartRes.quote.blocked : smartRes.reason) : null,
          },
          slots: defaultWeaponSlots(def).map((slot) => {
            const installedId = ws?.mods[slot];
            const installedDef = installedId ? catalog.get(installedId) : undefined;
            const lockedSlot = ws?.lockedSlots.includes(slot) ?? false;
            const detachRes =
              installedId && lockedSlot
                ? quoteGunsmith(
                    world,
                    data,
                    { shop: shop.id, action: "detach", weapon: weaponId, mod: installedId },
                    { checkFunds: false },
                  )
                : null;
            const lockRes =
              installedId && !lockedSlot && !isMelee
                ? quoteGunsmith(
                    world,
                    data,
                    {
                      shop: shop.id,
                      action: "convert",
                      conversion: "precision-lock",
                      weapon: weaponId,
                      slot,
                    },
                    { checkFunds: false },
                  )
                : null;

            const options = [
              ...shelfMods
                .filter(
                  (modDef) =>
                    modDef.modSlot === slot &&
                    modDef.id !== installedId &&
                    canAttachMod(def, modDef, ws, { ignoreLock: true }).ok,
                )
                .map((modDef) => {
                  const res = quoteGunsmith(
                    world,
                    data,
                    {
                      shop: shop.id,
                      action: "install",
                      weapon: weaponId,
                      mod: modDef.id,
                      source: "shelf",
                    },
                    { checkFunds: false },
                  );
                  return {
                    id: modDef.id,
                    name: modDef.name,
                    source: "shelf" as const,
                    rarity: modDef.rarity ?? null,
                    rarityLabel: modDef.rarity ? RARITY_LABELS[modDef.rarity] : null,
                    ability: modDef.ability ?? null,
                    partsFee: res.ok ? res.quote.partsFee : null,
                    serviceFee: res.ok ? res.quote.serviceFee : null,
                    total: res.ok ? res.quote.total : null,
                    left: stock[modDef.id] ?? 0,
                    locked: res.ok ? res.quote.blocked : res.reason,
                  };
                }),
              ...(lockedSlot
                ? backpackMods
                    .filter(
                      (modDef) =>
                        modDef.modSlot === slot &&
                        modDef.id !== installedId &&
                        canAttachMod(def, modDef, ws, { ignoreLock: true }).ok,
                    )
                    .map((modDef) => {
                      const res = quoteGunsmith(
                        world,
                        data,
                        {
                          shop: shop.id,
                          action: "install",
                          weapon: weaponId,
                          mod: modDef.id,
                          source: "backpack",
                        },
                        { checkFunds: false },
                      );
                      return {
                        id: modDef.id,
                        name: modDef.name,
                        source: "backpack" as const,
                        rarity: modDef.rarity ?? null,
                        rarityLabel: modDef.rarity ? RARITY_LABELS[modDef.rarity] : null,
                        ability: modDef.ability ?? null,
                        partsFee: res.ok ? res.quote.partsFee : null,
                        serviceFee: res.ok ? res.quote.serviceFee : null,
                        total: res.ok ? res.quote.total : null,
                        left: sellCounts.get(modDef.id) ?? 0,
                        locked: res.ok ? res.quote.blocked : res.reason,
                      };
                    })
                : []),
            ];

            return {
              slot,
              label: MOD_SLOT_LABELS[slot],
              lockedSlot,
              installed: installedId
                ? {
                    id: installedId,
                    name: installedDef?.name ?? installedId,
                    rarity: installedDef?.rarity ?? null,
                    rarityLabel: installedDef?.rarity ? RARITY_LABELS[installedDef.rarity] : null,
                    ability: installedDef?.ability ?? null,
                    detachFee: detachRes?.ok ? detachRes.quote.total : null,
                    detachLocked: detachRes
                      ? detachRes.ok
                        ? detachRes.quote.blocked
                        : detachRes.reason
                      : null,
                    lockFee: lockRes?.ok ? lockRes.quote.total : null,
                    lockLocked: lockRes
                      ? lockRes.ok
                        ? lockRes.quote.blocked
                        : lockRes.reason
                      : null,
                  }
                : null,
              options,
            };
          }),
        },
      ];
    }),
  };
}

/** 当前地点开着的商店：货架按武器类别或物品种类分组；背包里的东西标出回收价 */
export function shopsView({ world, data }: ViewContext) {
  const location = WorldClockStateSchema.parse(world.slices.world).location;
  if (location === null || data.items === undefined) return [];
  const inventory = InventoryStateSchema.parse(world.slices.inventory);
  data = withMerchants(data, inventory.merchants);
  const here = shopList(data).filter((s) => merchantAt(data, s.id, s.location, location));
  if (here.length === 0) return [];
  const catalog = itemCatalog(withWorldObjects(data, inventory.objects));
  const sites = merchantSites(data);
  const npcs = KeeperCardsSchema.parse(world.slices.npc ?? {}).npcs;
  const sellCounts = carriedItemCounts(inventory);
  const sellNames = weaponDisplayNames(sellCounts.keys(), inventory.objects, catalog);
  const now = world.time;
  return here.map((shop) => {
    const keeper = keeperOf(shop.keeperNpc, npcs);
    const sell = [...sellCounts].flatMap(([id, count]) => {
      const obj = inventory.objects[id];
      const def = catalog.get(id) ?? obj?.definition;
      if (!def) return [];
      const quote = quoteTrade(
        world,
        data,
        { action: "sell", item: id, with: shop.id },
        { checkFunds: false },
      );
      return [
        {
          id,
          name: sellNames.get(id) ?? def.name,
          count,
          value: quote.ok ? quote.price : 0,
          ...itemMeta(def, obj?.weaponState),
          locked: quote.ok ? null : quote.reason,
        },
      ];
    });
    const merchant = merchantState(inventory, shop, catalog, now);
    const shelfIds = Object.keys(merchant.stock);
    const shelfNames = weaponDisplayNames(shelfIds, inventory.objects, catalog);
    const delivery = Object.values(inventory.supplyOrders)
      .filter((o) => o.shop === shop.id && (o.status === "pending" || o.status === "delayed"))
      .sort((a, b) => a.dueAt - b.dueAt)[0];
    return {
      id: shop.id,
      name: shop.name,
      kind: sites.get(shop.id)?.kind ?? null,
      keeper: shop.keeper,
      keeperNpc: shop.keeperNpc ?? null,
      /** 店主对你的好感；店主没有人物卡或还没见过是 null */
      keeperAffinity: keeper?.affinity ?? null,
      note: shop.note,
      blackMarket: shop.blackMarket,
      restockAt: delivery
        ? delivery.status === "delayed"
          ? `运输受阻：${delivery.delayReason}`
          : formatGameTime(delivery.dueAt)
        : null,
      shelf: shelfIds.flatMap((id) => {
        const obj = inventory.objects[id];
        const def = catalog.get(id) ?? obj?.definition;
        if (!def) return [];
        const quote = quoteTrade(
          world,
          data,
          { action: "buy", item: id, with: shop.id },
          { checkFunds: false },
        );
        const left = merchant.stock[id] ?? 0;
        return [
          {
            id: def.id,
            name: shelfNames.get(id) ?? def.name,
            ...itemMeta(def, obj?.weaponState),
            charges: def.charges ?? null,
            healPercent: def.healPercent ?? null,
            price: quote.price ?? 0,
            locked: quote.ok ? null : quote.reason,
            left,
          },
        ];
      }),
      /** 背包里的东西卖给这家店给多少；0 是不收 */
      sell,
      /** 枪匠工坊资格、工时费率与逐把武器单源报价 */
      gunsmith: projectGunsmithShop(
        world,
        data,
        inventory,
        shop,
        catalog,
        shelfIds,
        merchant.stock,
        sellCounts,
        sellNames,
      ),
    };
  });
}
