import { z } from "zod";
import { BdWorkSchema } from "../systems/braindance/schema";
import { CyberwareDefSchema } from "../systems/cyberware/schema";
import { ItemDefSchema } from "../systems/inventory/schema";
import { NpcCardSchema } from "../systems/npc/schema";
import { ChipContentSchema } from "../systems/shards/schema";
import { AcquaintanceSchema, BoardModuleSchema } from "./board";
import { CharacterCardSchema } from "./character";

const PackIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(22)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "内容包 id 只用小写英文、数字和单个连字符");
const EntryIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(33)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "条目 id 只用小写英文、数字和单个连字符");

export const WorkshopShopListingSchema = z.object({
  shop: z.string().trim().min(1).max(80),
  item: EntryIdSchema,
  stock: z.number().int().min(0).max(1000).default(1),
});

export const WorkshopRipperdocListingSchema = z.object({
  ripperdoc: z.string().trim().min(1).max(80),
  cyberware: EntryIdSchema,
  stock: z.number().int().min(0).max(1000).default(1),
});

/** 可分享的玩家内容。实体 id 在安装到游戏时会按包名加命名空间。 */
export const WorkshopPackSchema = z
  .strictObject({
    format: z.literal("cp2077-workshop-pack").default("cp2077-workshop-pack"),
    version: z.literal(2).default(2),
    id: PackIdSchema,
    title: z.string().trim().min(1).max(40),
    author: z.string().trim().max(40).default(""),
    description: z.string().trim().max(300).default(""),
    modules: z.array(BoardModuleSchema).max(200).default([]),
    acquaintances: z.array(AcquaintanceSchema).max(100).default([]),
    npcs: z.array(NpcCardSchema).max(200).default([]),
    seedNpcs: z.array(EntryIdSchema).max(200).default([]),
    items: z.array(ItemDefSchema).max(500).default([]),
    cyberware: z.array(CyberwareDefSchema).max(300).default([]),
    braindances: z.array(BdWorkSchema).max(100).default([]),
    chipContents: z.array(ChipContentSchema).max(500).default([]),
    shopListings: z.array(WorkshopShopListingSchema).max(500).default([]),
    ripperdocListings: z.array(WorkshopRipperdocListingSchema).max(300).default([]),
  })
  .superRefine((pack, ctx) => {
    const groups = [
      ["modules", pack.modules],
      ["npcs", pack.npcs],
      ["items", pack.items],
      ["cyberware", pack.cyberware],
      ["braindances", pack.braindances],
      ["chipContents", pack.chipContents],
    ] as const;
    const allIds = new Map<string, string>();
    for (const [field, entries] of groups) {
      const seen = new Set<string>();
      entries.forEach((entry, index) => {
        const id = EntryIdSchema.safeParse(entry.id);
        if (!id.success || id.data !== entry.id) {
          ctx.addIssue({
            code: "custom",
            path: [field, index, "id"],
            message: "条目 id 最多 33 位，只用小写英文、数字和连字符，不能有首尾空格",
          });
        }
        if (seen.has(entry.id)) {
          ctx.addIssue({ code: "custom", path: [field, index, "id"], message: "同类条目 id 重复" });
        }
        seen.add(entry.id);
        const previous = allIds.get(entry.id);
        if (previous) {
          ctx.addIssue({
            code: "custom",
            path: [field, index, "id"],
            message: `id 与 ${previous} 条目重复`,
          });
        } else {
          allIds.set(entry.id, field);
        }
      });
    }
    const listings = new Set<string>();
    for (const [index, listing] of pack.shopListings.entries()) {
      const key = `${listing.shop}\u0000${listing.item}`;
      if (listings.has(key)) {
        ctx.addIssue({
          code: "custom",
          path: ["shopListings", index],
          message: "同一商店货架条目重复",
        });
      }
      listings.add(key);
    }
    const clinicListings = new Set<string>();
    for (const [index, listing] of pack.ripperdocListings.entries()) {
      const key = `${listing.ripperdoc}\u0000${listing.cyberware}`;
      if (clinicListings.has(key)) {
        ctx.addIssue({
          code: "custom",
          path: ["ripperdocListings", index],
          message: "同一诊所货架条目重复",
        });
      }
      clinicListings.add(key);
    }
    const localNpcIds = new Set(pack.npcs.map((entry) => entry.id));
    const acquaintanceIds = new Set<string>();
    for (const [index, entry] of pack.acquaintances.entries()) {
      const id = EntryIdSchema.safeParse(entry.id);
      if (!id.success || id.data !== entry.id) {
        ctx.addIssue({
          code: "custom",
          path: ["acquaintances", index, "id"],
          message: "人脉 id 最多 33 位，只用小写英文、数字和连字符，不能有首尾空格",
        });
      }
      if (acquaintanceIds.has(entry.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["acquaintances", index, "id"],
          message: "人脉 id 重复",
        });
      }
      acquaintanceIds.add(entry.id);
    }
    for (const [index, id] of pack.seedNpcs.entries()) {
      if (!localNpcIds.has(id)) {
        ctx.addIssue({
          code: "custom",
          path: ["seedNpcs", index],
          message: `没有这个包内人物：${id}`,
        });
      }
    }
  });
export type WorkshopPack = z.infer<typeof WorkshopPackSchema>;

export const InstalledWorkshopPackSchema = z.object({
  pack: WorkshopPackSchema,
  enabled: z.boolean().default(true),
  installedAt: z.string().datetime(),
});
export type InstalledWorkshopPack = z.infer<typeof InstalledWorkshopPackSchema>;

export interface WorkshopCatalogIndex {
  readonly items: readonly { readonly id: string; readonly kind: string }[];
  readonly cyberware: readonly { readonly id: string }[];
  readonly npcs: readonly { readonly id: string }[];
  readonly braindances: readonly { readonly id: string }[];
  readonly chipContents: readonly { readonly id: string }[];
  readonly shops: readonly { readonly id: string }[];
  readonly ripperdocs: readonly { readonly id: string }[];
}

/** 校验包内引用只指向本包条目或官方目录，避免运行时出现悬空内容。 */
export function workshopPackIssues(pack: WorkshopPack, catalog: WorkshopCatalogIndex): string[] {
  const issues: string[] = [];
  const itemKinds = new Map(catalog.items.map((item) => [item.id, item.kind]));
  for (const item of pack.items) itemKinds.set(item.id, item.kind);
  const itemIds = new Set(itemKinds.keys());
  const modIds = new Set([
    ...catalog.items.filter((item) => item.kind === "mod").map((item) => item.id),
    ...pack.items.filter((item) => item.kind === "mod").map((item) => item.id),
  ]);
  const cyberwareIds = new Set([
    ...catalog.cyberware.map((item) => item.id),
    ...pack.cyberware.map((item) => item.id),
  ]);
  const npcIds = new Set([
    ...catalog.npcs.map((item) => item.id),
    ...pack.npcs.map((item) => item.id),
  ]);
  const workIds = new Set([
    ...catalog.braindances.map((item) => item.id),
    ...pack.braindances.map((item) => item.id),
  ]);
  const contentIds = new Set([
    ...catalog.chipContents.map((item) => item.id),
    ...pack.chipContents.map((item) => item.id),
  ]);
  const shopIds = new Set(catalog.shops.map((item) => item.id));
  const ripperdocIds = new Set(catalog.ripperdocs.map((item) => item.id));

  const checkRefs = (
    ids: readonly string[],
    known: ReadonlySet<string>,
    label: string,
    source: string,
  ) => {
    for (const id of ids)
      if (!known.has(id)) issues.push(`${source} 引用了不存在的${label}：${id}`);
  };
  for (const item of pack.items) {
    if (item.preInstalledMods)
      checkRefs(Object.values(item.preInstalledMods), modIds, "改装件", item.name);
    if (item.chipContentId && !contentIds.has(item.chipContentId)) {
      issues.push(`${item.name} 引用了不存在的芯片资料：${item.chipContentId}`);
    }
  }
  for (const chrome of pack.cyberware) {
    if (chrome.price === 0) issues.push(`${chrome.name} 的义体价格必须大于 0`);
  }
  for (const npc of pack.npcs) {
    if (npc.body) {
      checkRefs(npc.body.gear, itemIds, "物品", npc.name);
      checkRefs(npc.body.cyberware, cyberwareIds, "义体", npc.name);
    }
  }
  for (const content of pack.chipContents) {
    if (content.braindance && !workIds.has(content.braindance)) {
      issues.push(`${content.title} 引用了不存在的超梦作品：${content.braindance}`);
    }
  }
  for (const listing of pack.shopListings) {
    if (!shopIds.has(listing.shop)) issues.push(`商店货架引用了不存在的商店：${listing.shop}`);
    if (!itemIds.has(listing.item)) issues.push(`商店货架引用了不存在的物品：${listing.item}`);
  }
  for (const listing of pack.ripperdocListings) {
    if (!ripperdocIds.has(listing.ripperdoc)) {
      issues.push(`义体诊所货架引用了不存在的诊所：${listing.ripperdoc}`);
    }
    if (!cyberwareIds.has(listing.cyberware)) {
      issues.push(`义体诊所货架引用了不存在的义体：${listing.cyberware}`);
    }
  }
  for (const acquaintance of pack.acquaintances) {
    if (acquaintance.id.startsWith("wk-")) continue;
    if (npcIds.has(acquaintance.id)) continue;
    if (!acquaintance.custom)
      issues.push(`旧识 ${acquaintance.name} 必须标记为自定义，或引用已登记人物`);
  }
  return issues;
}

export function workshopEntityId(packId: string, localId: string): string {
  return `wk-${packId}--${localId}`;
}

export function workshopEntityPackId(entityId: string): string | undefined {
  return /^wk-([a-z0-9]+(?:-[a-z0-9]+)*)--[a-z0-9]/.exec(entityId)?.[1];
}

/** 复制并为运行时条目加包级命名空间，同时改写包内引用。 */
export function namespaceWorkshopPack(pack: WorkshopPack) {
  const itemIds = new Set(pack.items.map((item) => item.id));
  const modIds = new Set(pack.items.filter((item) => item.kind === "mod").map((item) => item.id));
  const cyberwareIds = new Set(pack.cyberware.map((item) => item.id));
  const npcIds = new Set(pack.npcs.map((item) => item.id));
  const workIds = new Set(pack.braindances.map((item) => item.id));
  const contentIds = new Set(pack.chipContents.map((item) => item.id));
  const itemId = (id: string) => (itemIds.has(id) ? workshopEntityId(pack.id, id) : id);
  const modId = (id: string) => (modIds.has(id) ? workshopEntityId(pack.id, id) : id);
  const chromeId = (id: string) => (cyberwareIds.has(id) ? workshopEntityId(pack.id, id) : id);
  const npcId = (id: string) => (npcIds.has(id) ? workshopEntityId(pack.id, id) : id);
  const workId = (id: string) => (workIds.has(id) ? workshopEntityId(pack.id, id) : id);
  const chipId = (id: string) => (contentIds.has(id) ? workshopEntityId(pack.id, id) : id);
  const acquaintanceIsCatalogNpc = (entry: WorkshopPack["acquaintances"][number]) =>
    npcIds.has(entry.id) ||
    (!entry.custom && !entry.id.startsWith("custom-") && !entry.id.startsWith("wk-"));
  const acquaintanceId = (entry: WorkshopPack["acquaintances"][number]) =>
    acquaintanceIsCatalogNpc(entry) ? npcId(entry.id) : workshopEntityId(pack.id, entry.id);
  const allLocalIds = new Set([
    ...pack.modules.map((item) => item.id),
    ...pack.acquaintances
      .filter((entry) => !acquaintanceIsCatalogNpc(entry))
      .map((entry) => entry.id),
    ...pack.npcs.map((item) => item.id),
    ...pack.items.map((item) => item.id),
    ...pack.cyberware.map((item) => item.id),
    ...pack.braindances.map((item) => item.id),
    ...pack.chipContents.map((item) => item.id),
  ]);
  const relatedId = (id: string) => (allLocalIds.has(id) ? workshopEntityId(pack.id, id) : id);

  return {
    modules: pack.modules.map((entry) => ({
      ...entry,
      id: workshopEntityId(pack.id, entry.id),
      custom: true,
      packId: pack.id,
      author: pack.author,
    })),
    acquaintances: pack.acquaintances.map((entry) => ({
      ...entry,
      id: acquaintanceId(entry),
      custom: !acquaintanceIsCatalogNpc(entry),
      packId: pack.id,
      catalogNpc: acquaintanceIsCatalogNpc(entry),
    })),
    npcs: pack.npcs.map((entry) => ({
      ...entry,
      id: workshopEntityId(pack.id, entry.id),
      canon: false,
      ...(entry.body
        ? {
            body: {
              ...entry.body,
              gear: entry.body.gear.map(itemId),
              cyberware: entry.body.cyberware.map(chromeId),
            },
          }
        : {}),
    })),
    seedNpcs: pack.seedNpcs.map(npcId),
    items: pack.items.map((entry) => ({
      ...entry,
      id: workshopEntityId(pack.id, entry.id),
      ...(entry.chipContentId ? { chipContentId: chipId(entry.chipContentId) } : {}),
      ...(entry.preInstalledMods
        ? {
            preInstalledMods: Object.fromEntries(
              Object.entries(entry.preInstalledMods).map(([slot, id]) => [slot, modId(id)]),
            ),
          }
        : {}),
    })),
    cyberware: pack.cyberware.map((entry) => ({
      ...entry,
      id: workshopEntityId(pack.id, entry.id),
    })),
    braindances: pack.braindances.map((entry) => ({
      ...entry,
      id: workshopEntityId(pack.id, entry.id),
    })),
    chipContents: pack.chipContents.map((entry) => ({
      ...entry,
      id: workshopEntityId(pack.id, entry.id),
      ...(entry.braindance ? { braindance: workId(entry.braindance) } : {}),
      related: entry.related.map(relatedId),
    })),
    shopListings: pack.shopListings.map((entry) => ({
      ...entry,
      item: itemId(entry.item),
    })),
    ripperdocListings: pack.ripperdocListings.map((entry) => ({
      ...entry,
      cyberware: chromeId(entry.cyberware),
    })),
  };
}

export const WorkshopCharacterExportSchema = z.object({
  format: z.literal("cp2077-character"),
  version: z.literal(1),
  character: CharacterCardSchema,
});
export type WorkshopCharacterExport = z.infer<typeof WorkshopCharacterExportSchema>;
