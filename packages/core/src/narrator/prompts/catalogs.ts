import type { PlayerView } from "../../game";
import type { WorldState } from "../../kernel/world";
import { CombatStateSchema } from "../../systems/combat";
import { cyberwareCatalog } from "../../systems/cyberware";
import {
  CATEGORY_LABELS,
  HACK_LOAD_LABELS,
  mentionsHacking,
  quickhackCatalog,
} from "../../systems/hacking";
import { HackingStateSchema } from "../../systems/hacking/schema";
import {
  formatWeaponWithMods,
  InventoryStateSchema,
  itemCatalog,
  withWorldObjects,
} from "../../systems/inventory";
import { NpcStateSchema, onStage } from "../../systems/npc";
import { WorldClockStateSchema } from "../../systems/world";

/**
 * 已登记到世界的独立物件/自定义改装物件简要索引（放在用户消息侧，避免污染系统层的静态物品基表缓存）。
 */
export function worldObjectsIndexSection(world: WorldState): string | undefined {
  const objects = InventoryStateSchema.parse(world.slices.inventory).objects;
  const entries = Object.entries(objects).filter(([id]) => !id.startsWith("wpn:"));
  if (entries.length === 0) return undefined;
  const lines = entries
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, obj]) => {
      const def = obj.definition;
      const holder =
        obj.holder === "player"
          ? "玩家持有"
          : obj.holder.startsWith("npc:")
            ? `人物 ${obj.holder.slice(4)} 持有`
            : `存放于 ${obj.location ?? obj.holder}`;
      return `- ${id} ${def.name}（${holder}；来源：${obj.origin}）`;
    });
  return `【本存档已登记的独立物件索引】（复用同一 id，禁止重复新建）\n${lines.join("\n")}`;
}

/** 索引与详情都合入世界里实际登记的独立物件，交给 NPC 后也保留同一身份。 */
export function extractCatalogData(
  world: WorldState,
  data: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return withWorldObjects(data, InventoryStateSchema.parse(world.slices.inventory).objects);
}

function normalize(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\p{P}]/gu, "");
}

/** 匹配只负责展开长说明；即使昵称没匹配，完整名称/ID 索引仍可供抽取核对。 */
function mentioned(text: string, ...names: readonly (string | undefined)[]): boolean {
  return names.some((name) => {
    const key = name ? normalize(name) : "";
    return key.length >= 2 && text.includes(key);
  });
}

/** 抽取不负责创作：只展开随身、现场人物、现场货架和本轮提及物件的能力。 */
export function extractCatalogDetails(
  world: WorldState,
  view: PlayerView,
  data: Readonly<Record<string, unknown>>,
  text: string,
  hackingActive = false,
): string | undefined {
  const query = normalize(text);
  const inventory = InventoryStateSchema.parse(world.slices.inventory);
  const itemIds = new Set(Object.keys(view.inventory.details));
  for (const detail of Object.values(view.inventory.details)) {
    if (detail.baseId) itemIds.add(detail.baseId);
  }
  for (const mods of Object.values(view.inventory.mods)) {
    for (const mod of mods) itemIds.add(mod.id);
  }
  const chromeIds = new Set(view.cyberware.map((c) => c.id));
  const clock = WorldClockStateSchema.parse(world.slices.world);
  const stage = { location: clock.location, sceneStartedAt: clock.sceneStartedAt };
  for (const npc of Object.values(NpcStateSchema.parse(world.slices.npc).npcs)) {
    if (!onStage(npc, stage) && !mentioned(query, npc.id, npc.name, npc.alias)) continue;
    for (const id of npc.body?.gear ?? []) itemIds.add(id);
    for (const id of npc.body?.cyberware ?? []) chromeIds.add(id);
  }
  for (const shop of view.shops) {
    for (const item of shop.shelf) {
      itemIds.add(item.id);
      if (item.baseId) itemIds.add(item.baseId);
      for (const modId of Object.values(item.weaponState?.mods ?? {})) {
        if (modId) itemIds.add(modId);
      }
    }
  }
  for (const part of view.ripperdoc?.shelf ?? []) chromeIds.add(part.id);

  const combat = CombatStateSchema.safeParse(world.slices.combat);
  if (combat.success) {
    const collectLoot = (
      ids: readonly string[],
      specs: Readonly<
        Record<
          string,
          {
            readonly weaponState?:
              | {
                  readonly baseId: string;
                  readonly mods: Readonly<Record<string, string | undefined>>;
                }
              | undefined;
          }
        >
      >,
    ) => {
      for (const id of ids) {
        itemIds.add(id);
        const ws = specs[id]?.weaponState;
        if (ws) {
          itemIds.add(ws.baseId);
          for (const modId of Object.values(ws.mods)) {
            if (modId) itemIds.add(modId);
          }
        }
      }
    };
    for (const foe of combat.data.active?.foes ?? []) {
      collectLoot(foe.carry, foe.carrySpecs);
    }
    for (const left of combat.data.groundLoot) {
      if (left.location === clock.location) collectLoot(left.items, left.itemSpecs);
    }
  }

  const catalog = itemCatalog(data);
  for (const id of [...itemIds]) {
    const ws = inventory.objects[id]?.weaponState;
    if (ws) {
      itemIds.add(ws.baseId);
      for (const modId of Object.values(ws.mods)) {
        if (modId) itemIds.add(modId);
      }
    }
    const def = catalog.get(id);
    if (def?.preInstalledMods) {
      for (const modId of Object.values(def.preInstalledMods)) {
        if (modId) itemIds.add(modId);
      }
    }
  }

  const details: string[] = [];
  for (const item of catalog.values()) {
    const obj = inventory.objects[item.id];
    const ws = obj?.weaponState;
    const displayName = ws ? formatWeaponWithMods(item.name, ws, catalog) : item.name;
    const isRelevant = itemIds.has(item.id) || mentioned(query, item.id, item.name);
    if (!isRelevant) continue;
    if (obj?.kind === "customized" && ws) {
      const baseDef = catalog.get(ws.baseId);
      if (baseDef && item.ability === baseDef.ability && itemIds.has(ws.baseId)) {
        details.push(`- ${item.id} ${displayName}（基于 ${ws.baseId}）`);
        continue;
      }
    }
    if (item.ability) {
      details.push(`- ${item.id} ${displayName}：${item.ability}`);
    }
  }
  for (const part of cyberwareCatalog(data).values()) {
    if (chromeIds.has(part.id) || mentioned(query, part.id, part.name)) {
      details.push(`- ${part.id} ${part.name}：${part.ability}`);
    }
  }
  const sections: string[] = [];
  if (details.length > 0) sections.push(`【本轮相关物件能力】\n${details.join("\n")}`);
  const hacking = HackingStateSchema.safeParse(world.slices.hacking ?? {});
  const hackRelevant =
    hackingActive ||
    (hacking.success && (hacking.data.dive !== null || hacking.data.thermal.heat > 0)) ||
    mentionsHacking(text);
  if (hackRelevant) {
    const qLines = [...quickhackCatalog(data).values()].map((q) => {
      const tags = [
        CATEGORY_LABELS[q.category],
        HACK_LOAD_LABELS[q.load],
        ...(q.requiresFoothold ? ["需先破冰建立足点"] : []),
      ].join("/");
      const req = q.targetRequirement ? `［接口前提：${q.targetRequirement}］` : "";
      return `- ${q.id} ${q.name}（${tags}）${req}：${q.effect}`;
    });
    if (qLines.length > 0) {
      sections.push(
        `【快速破解程序芯片目录（供 hack / deckLoad / npcHack 对照）】\n${qLines.join("\n")}`,
      );
    }
  }
  return sections.length > 0 ? sections.join("\n\n") : undefined;
}
