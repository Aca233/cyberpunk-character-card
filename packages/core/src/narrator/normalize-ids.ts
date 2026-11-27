import type { Command } from "../kernel/system";
import type { WorldState } from "../kernel/world";
import { cyberwareCatalog } from "../systems/cyberware";
import { FactionCatalogSchema } from "../systems/factions/schema";
import { itemCatalog } from "../systems/inventory";
import { NO_FACTION, NpcStateSchema, onStage } from "../systems/npc";
import { withSavedPlaces } from "../systems/world/places";
import { locationCatalog, WorldClockStateSchema } from "../systems/world/schema";

interface NameIndex {
  readonly ids: ReadonlySet<string>;
  readonly exactToId: ReadonlyMap<string, string>;
}

export interface IdLookup {
  readonly npcs: NameIndex;
  readonly locations: NameIndex;
  readonly factions: NameIndex;
  readonly items: NameIndex;
  readonly cyberware: NameIndex;
}

/** 建立严格唯一精确映射：大小写不同的 id、或全表唯一精确名称/外号 -> 规范 id；重名不映射，绝不猜模糊匹配。 */
function buildNameIndex(
  entries: readonly { id: string; aliases?: readonly string[] }[],
): NameIndex {
  const ids = new Set<string>();
  const counts = new Map<string, number>();
  const candidate = new Map<string, string>();
  const register = (key: string, id: string) => {
    const trimmed = key.trim();
    if (!trimmed) return;
    const lowered = trimmed.toLowerCase();
    const prev = candidate.get(lowered);
    if (prev !== undefined && prev !== id) {
      counts.set(lowered, (counts.get(lowered) ?? 1) + 1);
      return;
    }
    candidate.set(lowered, id);
    counts.set(lowered, 1);
  };

  for (const entry of entries) {
    ids.add(entry.id);
    register(entry.id, entry.id);
    for (const alias of entry.aliases ?? []) register(alias, entry.id);
  }

  const exactToId = new Map<string, string>();
  for (const [lowered, id] of candidate) {
    if (counts.get(lowered) === 1) exactToId.set(lowered, id);
  }
  return { ids, exactToId };
}

function resolveUnique(value: unknown, index: NameIndex): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed || index.ids.has(trimmed)) return undefined;
  return index.exactToId.get(trimmed.toLowerCase());
}

/** 收集当前世界 + 静态目录 + 本轮新创建实体的规范 id 索引，用于确定性归一与落盘前规则预检。 */
export function buildIdLookup(
  world: WorldState,
  data: Readonly<Record<string, unknown>> = {},
  plannedChanges: readonly unknown[] = [],
): IdLookup {
  const npcEntries: { id: string; aliases?: string[] }[] = [];
  for (const npc of Object.values(NpcStateSchema.parse(world.slices.npc).npcs)) {
    npcEntries.push({
      id: npc.id,
      aliases: [npc.name, ...(npc.alias ? [npc.alias] : [])],
    });
  }
  const newItemIds = new Set<string>();
  const newLocationIds = new Set<string>();
  for (const item of plannedChanges) {
    if (typeof item !== "object" || item === null) continue;
    const rec = item as Record<string, unknown>;
    if (rec.type === "npc" && typeof rec.id === "string" && rec.id.trim()) {
      const aliases: string[] = [];
      if (typeof rec.name === "string" && rec.name.trim()) aliases.push(rec.name.trim());
      if (typeof rec.alias === "string" && rec.alias.trim()) aliases.push(rec.alias.trim());
      npcEntries.push({ id: rec.id.trim(), aliases });
    } else if (
      rec.type === "item" &&
      typeof rec.id === "string" &&
      rec.id.trim() &&
      rec.definition
    ) {
      newItemIds.add(rec.id.trim());
    } else if (rec.type === "world.place" && typeof rec.id === "string" && rec.id.trim()) {
      newLocationIds.add(rec.id.trim());
    }
  }

  const locCatalog = locationCatalog(withSavedPlaces(data, world));
  const locationEntries = [
    ...[...locCatalog.values()].map((loc) => ({ id: loc.id, aliases: [loc.name] })),
    ...[...newLocationIds].map((id) => ({ id })),
  ];

  const parsedFactions = FactionCatalogSchema.safeParse(data.factions);
  const factionEntries = [
    ...(parsedFactions.success
      ? parsedFactions.data.map((f) => ({ id: f.id, aliases: [f.name] }))
      : []),
    { id: NO_FACTION, aliases: ["无", "无势力"] },
  ];

  const items = itemCatalog(data);
  const itemEntries = [
    ...[...items.values()].map((it) => ({ id: it.id, aliases: [it.name] })),
    ...[...newItemIds].map((id) => ({ id })),
  ];

  const chrome = cyberwareCatalog(data);
  const chromeEntries = [...chrome.values()].map((part) => ({
    id: part.id,
    aliases: [part.name],
  }));

  return {
    npcs: buildNameIndex(npcEntries),
    locations: buildNameIndex(locationEntries),
    factions: buildNameIndex(factionEntries),
    items: buildNameIndex(itemEntries),
    cyberware: buildNameIndex(chromeEntries),
  };
}

/** 需要引用已有 NPC 卡 id 的指令集合 */
export const EXISTING_NPC_ID_COMMANDS = new Set([
  "meet",
  "memory",
  "npcDeath",
  "doing",
  "relation",
  "npcOutfit",
  "ledger",
  "ledgerSettle",
  "learn",
  "npcHurt",
  "npcHeal",
  "npcGear",
  "npcChrome",
  "npcHumanity",
  "npcScan",
  "npcCompanion",
  "npcBehavior",
  "npcUpdate",
  "npcHack",
]);

/** 确定性归一单条指令里的唯一精确名称/外号/大小写偏差，零模糊猜测。 */
export function normalizeChangeIds(
  raw: unknown,
  lookup: IdLookup,
): { readonly value: unknown; readonly notes: readonly string[] } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { value: raw, notes: [] };
  }
  const src = raw as Record<string, unknown>;
  const type = typeof src.type === "string" ? src.type : undefined;
  if (!type) return { value: raw, notes: [] };

  let next: Record<string, unknown> | undefined;
  const notes: string[] = [];
  const replaceField = (field: string, index: NameIndex, label: string) => {
    const target = next ?? src;
    const mapped = resolveUnique(target[field], index);
    if (!mapped) return;
    const before = String(target[field]);
    if (!next) next = { ...src };
    next[field] = mapped;
    notes.push(`已将 ${type}.${field}「${before}」归一为${label} id ${mapped}`);
  };

  if (EXISTING_NPC_ID_COMMANDS.has(type)) {
    replaceField("id", lookup.npcs, "人物");
  }
  if (type === "tie") {
    replaceField("a", lookup.npcs, "人物");
    replaceField("b", lookup.npcs, "人物");
  }
  if (type === "faction") {
    replaceField("id", lookup.factions, "势力");
    replaceField("rival", lookup.factions, "势力");
    replaceField("sponsor", lookup.npcs, "人物");
    replaceField("byNpc", lookup.npcs, "人物");
    replaceField("leaderNpc", lookup.npcs, "人物");
    replaceField("leadNpc", lookup.npcs, "人物");
  }
  if (type === "npc" || type === "npcUpdate") {
    replaceField("faction", lookup.factions, "势力");
    replaceField("home", lookup.locations, "地点");
  }
  if (type === "world" || type === "meet" || type === "doing" || type === "tension") {
    replaceField("location", lookup.locations, "地点");
  }
  if (type === "item" || type === "npcGear" || type === "trade") {
    const field = type === "item" ? "id" : "item";
    replaceField(field, lookup.items, "物品");
  }
  if (type === "weaponHold" && Array.isArray(src.weapons)) {
    let changed = false;
    const mappedWeapons = src.weapons.map((w) => {
      const mapped = resolveUnique(w, lookup.items);
      if (mapped) {
        changed = true;
        notes.push(`已将 weaponHold.weapons「${String(w)}」归一为物品 id ${mapped}`);
        return mapped;
      }
      return w;
    });
    if (changed) {
      if (!next) next = { ...src };
      next.weapons = mappedWeapons;
    }
  }
  if (type === "npcChrome") {
    replaceField("cyberware", lookup.cyberware, "义体");
  }
  if (type === "cyberware" || type === "cyberware.service") {
    replaceField("id", lookup.cyberware, "义体");
  }

  return { value: next ?? raw, notes };
}

export interface IdRuleIssue {
  readonly key: string;
  readonly raw: Record<string, unknown>;
  readonly error: string;
  readonly kind: "npc" | "faction" | "cyberware" | "item";
}

/** 落盘前轻量规则预检：提前抓出引用不存在的人物/势力/义体/物品 id，供单次精准语义修复挽回。 */
export function findIdRuleIssues(
  validated: ReadonlyMap<string, unknown>,
  lookup: IdLookup,
  world: WorldState,
  data: Readonly<Record<string, unknown>> = {},
): { readonly issues: readonly IdRuleIssue[]; readonly candidates: string } {
  const issues: IdRuleIssue[] = [];
  const needKinds = new Set<IdRuleIssue["kind"]>();

  for (const [key, value] of validated) {
    if (!key.startsWith("changes[")) continue;
    if (typeof value !== "object" || value === null) continue;
    const cmd = value as Command & Record<string, unknown>;
    const type = cmd.type;

    if (
      EXISTING_NPC_ID_COMMANDS.has(type) &&
      typeof cmd.id === "string" &&
      !lookup.npcs.ids.has(cmd.id)
    ) {
      issues.push({
        key,
        raw: cmd,
        error: `没有 id 为 ${cmd.id} 的人物卡；id 必须填已有的人物卡 id（不能填事件 slug）`,
        kind: "npc",
      });
      needKinds.add("npc");
      continue;
    }

    if (type === "tie") {
      const missing: string[] = [];
      if (typeof cmd.a === "string" && !lookup.npcs.ids.has(cmd.a)) missing.push(`a=${cmd.a}`);
      if (typeof cmd.b === "string" && !lookup.npcs.ids.has(cmd.b)) missing.push(`b=${cmd.b}`);
      if (missing.length > 0) {
        issues.push({
          key,
          raw: cmd,
          error: `tie 引用了不存在的人物卡：${missing.join("、")}`,
          kind: "npc",
        });
        needKinds.add("npc");
        continue;
      }
    }

    if (type === "faction" && typeof cmd.id === "string" && !lookup.factions.ids.has(cmd.id)) {
      issues.push({
        key,
        raw: cmd,
        error: `没有 id 为 ${cmd.id} 的势力`,
        kind: "faction",
      });
      needKinds.add("faction");
      continue;
    }

    if (
      type === "npcChrome" &&
      typeof cmd.cyberware === "string" &&
      !lookup.cyberware.ids.has(cmd.cyberware)
    ) {
      issues.push({
        key,
        raw: cmd,
        error: `义体表中没有 id 为 ${cmd.cyberware} 的义体`,
        kind: "cyberware",
      });
      needKinds.add("cyberware");
      continue;
    }

    if (type === "npcGear" && typeof cmd.item === "string" && !lookup.items.ids.has(cmd.item)) {
      issues.push({
        key,
        raw: cmd,
        error: `物品表中没有 id 为 ${cmd.item} 的物品`,
        kind: "item",
      });
      needKinds.add("item");
    }
  }

  if (issues.length === 0) return { issues, candidates: "" };

  const sections: string[] = [];
  if (needKinds.has("npc")) {
    const clock = WorldClockStateSchema.parse(world.slices.world);
    const stage = { location: clock.location, sceneStartedAt: clock.sceneStartedAt };
    const npcs = Object.values(NpcStateSchema.parse(world.slices.npc).npcs).sort(
      (a, b) =>
        Number(onStage(b, stage)) - Number(onStage(a, stage)) ||
        Number(b.met) - Number(a.met) ||
        (b.lastSeenAt ?? -1) - (a.lastSeenAt ?? -1),
    );
    const list = npcs
      .slice(0, 80)
      .map((n) => `${n.id}（${n.name}${n.alias ? `/${n.alias}` : ""}，${n.role}）`)
      .join("；");
    sections.push(`【可用人物卡 id】${list || "（无）"}`);
  }
  if (needKinds.has("faction")) {
    const parsed = FactionCatalogSchema.safeParse(data.factions);
    if (parsed.success) {
      sections.push(`【可用势力 id】${parsed.data.map((f) => `${f.id}（${f.name}）`).join("；")}`);
    }
  }
  if (needKinds.has("cyberware")) {
    const list = [...cyberwareCatalog(data).values()].map((c) => `${c.id}（${c.name}）`).join("、");
    sections.push(`【可用义体 id】${list}`);
  }
  if (needKinds.has("item")) {
    const list = [...itemCatalog(data).values()].map((it) => `${it.id}（${it.name}）`).join("、");
    sections.push(`【可用物品 id】${list}`);
  }

  return { issues, candidates: sections.join("\n") };
}
