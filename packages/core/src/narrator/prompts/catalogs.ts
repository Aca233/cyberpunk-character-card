import type { PlayerView } from "../../game";
import type { WorldState } from "../../kernel/world";
import { cyberwareCatalog } from "../../systems/cyberware";
import { CATEGORY_LABELS, mentionsHacking, quickhackCatalog } from "../../systems/hacking";
import { HackingStateSchema } from "../../systems/hacking/schema";
import { InventoryStateSchema, itemCatalog, withWorldObjects } from "../../systems/inventory";
import { NpcStateSchema, onStage } from "../../systems/npc";
import { WorldClockStateSchema } from "../../systems/world";

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
): string | undefined {
  const query = normalize(text);
  const itemIds = new Set(Object.keys(view.inventory.details));
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
    for (const item of shop.shelf) itemIds.add(item.id);
  }
  for (const part of view.ripperdoc?.shelf ?? []) chromeIds.add(part.id);

  const details: string[] = [];
  for (const item of itemCatalog(data).values()) {
    if (item.ability && (itemIds.has(item.id) || mentioned(query, item.id, item.name))) {
      details.push(`- ${item.id} ${item.name}：${item.ability}`);
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
  const hackRelevant = (hacking.success && hacking.data.dive !== null) || mentionsHacking(text);
  if (hackRelevant) {
    const qLines = [...quickhackCatalog(data).values()].map(
      (q) => `- ${q.id} ${q.name}（${CATEGORY_LABELS[q.category]}）：${q.effect}`,
    );
    if (qLines.length > 0) {
      sections.push(`【常见快速破解手段参考（供 hack / npcHack 归类）】\n${qLines.join("\n")}`);
    }
  }
  return sections.length > 0 ? sections.join("\n\n") : undefined;
}
