import type { LogRecord } from "./kernel/turnlog";
import type { WorldState } from "./kernel/world";
import { type ImageCharacterReference, ImageSceneContextSchema } from "./schemas/image";
import { characterView } from "./systems/character/view";
import { cyberwareView } from "./systems/cyberware/view";
import { healthView } from "./systems/health/view";
import { namesView } from "./systems/inventory/names";
import { inventoryView } from "./systems/inventory/view";
import { NPC_UNDECIDED_PREFIX } from "./systems/npc/schema";
import { npcsView } from "./systems/npc/view";
import { withSavedPlaces } from "./systems/world/places";
import { worldView } from "./systems/world/view";

function boundedReference(reference: ImageCharacterReference): ImageCharacterReference {
  return {
    id: reference.id.slice(0, 160),
    name: reference.name.slice(0, 120),
    alias: reference.alias.slice(0, 120),
    pronoun: reference.pronoun.slice(0, 20),
    role: reference.role.slice(0, 300),
    look: reference.look.slice(0, 2000),
    outfit: reference.outfit.slice(0, 2000),
    wounds: reference.wounds.slice(0, 2000),
    cyberware: reference.cyberware.slice(0, 32).map((name) => name.slice(0, 240)),
    gear: reference.gear.slice(0, 32).map((name) => name.slice(0, 240)),
  };
}

/** 只复制结算时玩家已知的视觉事实；不解析混合人物简介，也不读取人物秘密。 */
export function buildImageSceneContext(
  world: WorldState,
  records: readonly LogRecord[],
  data: Readonly<Record<string, unknown>>,
  narrative: string,
) {
  const context = { world, records, data: withSavedPlaces(data, world) };
  const character = characterView(context);
  const clock = worldView(context);
  const names = namesView(context);
  const inventory = inventoryView(context);
  const health = healthView(context);
  const player: ImageCharacterReference[] = character.name
    ? [
        {
          id: "player",
          name: character.name,
          alias: character.visual?.alias ?? "",
          pronoun: character.visual?.pronoun ?? "",
          role: "protagonist",
          look: character.visual?.look ?? "",
          outfit: inventory.clothing.map((item) => names.items[item.id] ?? item.id).join("、"),
          wounds: [
            health.wound,
            ...health.injuries.map((injury) =>
              [injury.partLabel, injury.tierLabel, injury.cause].filter(Boolean).join(" · "),
            ),
            ...health.lostLimbs.map((limb) => `缺失部位：${limb.label}`),
          ]
            .filter(Boolean)
            .join("；"),
          cyberware: cyberwareView(context).map((item) => item.name),
          gear: inventory.carriedWeapons.map((item) => names.items[item.id] ?? item.id),
        },
      ]
    : [];
  const npcs: ImageCharacterReference[] = npcsView(context)
    .filter(
      (npc) =>
        npc.met &&
        (npc.here ||
          narrative.includes(npc.name) ||
          Boolean(npc.alias && narrative.includes(npc.alias))),
    )
    .sort((a, b) => Number(narrative.includes(b.name)) - Number(narrative.includes(a.name)))
    .slice(0, 31)
    .map((npc) => {
      const wornClothes =
        npc.body?.gear.filter((item) => item.kind === "clothing").map((item) => item.name) ?? [];
      const carriedGear =
        npc.body?.gear.filter((item) => item.kind !== "clothing").map((item) => item.name) ?? [];
      const outfit = [npc.outfit, wornClothes.length > 0 ? wornClothes.join("、") : ""]
        .filter(Boolean)
        .join("；");
      return {
        id: npc.id,
        name: npc.name,
        alias: npc.alias ?? "",
        pronoun: npc.pronoun,
        role: npc.role,
        look:
          npc.look.startsWith(NPC_UNDECIDED_PREFIX) ||
          npc.look === "初见时未细看长相，待正式照面后写入档案"
            ? ""
            : npc.look,
        outfit,
        wounds: npc.body
          ? [
              npc.body.wound,
              ...npc.body.injuries.map(
                (injury) => `${injury.partLabel} · ${injury.tierLabel} · ${injury.cause}`,
              ),
            ].join("；")
          : "",
        cyberware: npc.body?.scan?.chrome.map((item) => item.name) ?? [],
        gear: carriedGear,
      };
    });
  return ImageSceneContextSchema.parse({
    location: (names.location ?? clock.location ?? "").slice(0, 300),
    district: (names.district ?? "").slice(0, 160),
    timeText: `${clock.time.text} (${clock.time.periodLabel})`,
    weather: clock.weather.label,
    characters: [...player, ...npcs].map(boundedReference),
  });
}
