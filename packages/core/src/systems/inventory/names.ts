import type { ViewContext } from "../../kernel/system";
import { locationCatalog, WorldClockStateSchema } from "../world";
import { itemCatalog, withWorldObjects } from "./apply";
import {
  carriedItemCounts,
  type InventoryState,
  InventoryStateSchema,
  type ItemDef,
  ModSlotSchema,
  type WeaponInstanceState,
} from "./schema";

const MOD_SLOTS = ModSlotSchema.options;

/** 提炼一段适合状态与提示词展示的简明能力摘要 */
export function summarizeAbility(ability: string | undefined, maxChars = 56): string {
  const clean = (ability ?? "").trim().replace(/。$/, "");
  if (!clean) return "";
  if (clean.length <= maxChars) return clean;
  const sentences = clean
    .split("。")
    .map((s) => s.trim())
    .filter(Boolean);
  if (sentences.length > 1) {
    let acc = sentences[0] ?? "";
    for (const next of sentences.slice(1)) {
      if (acc.length + 1 + next.length <= maxChars) acc = `${acc}。${next}`;
      else break;
    }
    if (acc.length <= maxChars) return acc;
  }
  return `${clean.slice(0, maxChars - 1)}…`;
}

/** 将基础武器名称与改装件/智能联锁状态拼成可读展示名 */
export function formatWeaponWithMods(
  baseName: string,
  weaponState: Pick<WeaponInstanceState, "mods" | "smartLink"> | undefined,
  catalog: ReadonlyMap<string, Pick<ItemDef, "name">>,
): string {
  if (!weaponState) return baseName;
  const tags: string[] = [];
  for (const slot of MOD_SLOTS) {
    const modId = weaponState.mods[slot];
    if (modId) tags.push(catalog.get(modId)?.name ?? modId);
  }
  if (weaponState.smartLink) tags.push("智能联锁");
  if (tags.length === 0) return baseName;
  return `${baseName}（${tags.join("·")}）`;
}

const CJK = /[㐀-鿿]/;

function weaponSeqOf(id: string): number {
  const idx = id.lastIndexOf(":");
  if (idx < 0) return Number.MAX_SAFE_INTEGER;
  const n = Number(id.slice(idx + 1));
  return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
}

/** 为一组物品 id 生成带实例区分的展示名，绝不向界面泄漏 wpn:<baseId>:<seq> */
export function weaponDisplayNames(
  ids: Iterable<string>,
  objects: InventoryState["objects"],
  catalog: ReadonlyMap<string, ItemDef>,
): Map<string, string> {
  const idList = [...new Set(ids)];
  const idSet = new Set(idList);
  const customizedByBase = new Map<string, string[]>();
  for (const id of idList) {
    const obj = objects[id];
    if (obj?.kind === "customized" && obj.weaponState) {
      const baseId = obj.weaponState.baseId;
      const list = customizedByBase.get(baseId) ?? [];
      list.push(id);
      customizedByBase.set(baseId, list);
    }
  }
  for (const list of customizedByBase.values()) {
    list.sort((a, b) => weaponSeqOf(a) - weaponSeqOf(b) || a.localeCompare(b));
  }

  const out = new Map<string, string>();
  for (const id of idList) {
    const obj = objects[id];
    const def = catalog.get(id) ?? obj?.definition;
    const ws = obj?.weaponState;
    const baseId = ws?.baseId ?? id;
    const baseName = catalog.get(baseId)?.name ?? def?.name ?? id;
    if (obj?.kind === "customized" && ws) {
      const siblings = customizedByBase.get(baseId) ?? [id];
      const multiple = siblings.length > 1 || idSet.has(baseId);
      if (multiple) {
        const idx = siblings.indexOf(id) + 1;
        out.set(id, `${baseName} #${idx}`);
      } else {
        out.set(id, baseName);
      }
    } else if (customizedByBase.has(id)) {
      out.set(id, `${baseName}（未改装）`);
    } else {
      out.set(id, def?.name ?? id);
    }
  }
  return out;
}

/** 物品和地点的中文名；表外的物品用 id，定制武器实例用带编号的区分名；表外的地点只有本身是中文时才当名字 */
export function namesView({ world, data }: ViewContext) {
  const inventory = InventoryStateSchema.parse(world.slices.inventory);
  const { location } = WorldClockStateSchema.parse(world.slices.world);
  const items =
    data.items === undefined
      ? new Map<string, ItemDef>()
      : itemCatalog(withWorldObjects(data, inventory.objects));
  const carriedIds = [...carriedItemCounts(inventory).keys()];
  const attachedModIds = carriedIds.flatMap((id) =>
    Object.values(inventory.objects[id]?.weaponState?.mods ?? {}).filter(
      (modId): modId is string => modId !== undefined,
    ),
  );
  const ids = new Set([
    ...carriedIds,
    ...attachedModIds,
    ...(inventory.healing ? [inventory.healing.id] : []),
    ...(inventory.grenade ? [inventory.grenade.id] : []),
    ...Object.values(inventory.clothing),
  ]);
  const displayNames = weaponDisplayNames(ids, inventory.objects, items);
  const place = location === null ? undefined : locationCatalog(data).get(location);
  return {
    items: Object.fromEntries([...ids].map((id) => [id, displayNames.get(id) ?? id])),
    location: place?.name ?? (location !== null && CJK.test(location) ? location : null),
    district: place?.district ?? null,
  };
}
