import type { ViewContext } from "../../kernel/system";
import { CyberwareStateSchema } from "../cyberware";
import { HealthStateSchema } from "../health";
import { InventoryStateSchema, itemCatalog } from "../inventory";
import { formatGameTime } from "../world";
import {
  activeChipHazard,
  chipContentCatalog,
  heldChipDefinition,
  intactBehaviorDevice,
  readableChipPart,
} from "./apply";
import {
  CHIP_CATEGORY_LABELS,
  CHIP_ENCRYPTION_LABELS,
  CHIP_HAZARD_LABELS,
  NEURAL_CHIP_SLOTS,
  SHARD_KIND_LABELS,
  ShardsStateSchema,
} from "./schema";

/** 数据库页的芯片与个人神经插槽视图 */
export function shardsView({ world, data }: ViewContext) {
  const state = ShardsStateSchema.parse(world.slices.shards ?? {});
  const inventory = InventoryStateSchema.parse(world.slices.inventory ?? {});
  const cyberware = CyberwareStateSchema.parse(world.slices.cyberware ?? {});
  const health = HealthStateSchema.parse(world.slices.health ?? {});
  const hasBehaviorChrome = Boolean(
    intactBehaviorDevice(cyberware.installed, health.brokenChrome, data),
  );
  const catalog = data.items ? itemCatalog(data) : new Map();
  const contents = chipContentCatalog(data, state);

  const list = [...state.shards].reverse().map((s) => ({
    id: s.id,
    contentId: s.contentId,
    partId: s.partId,
    carrier: s.carrier,
    category: s.category,
    categoryLabel: CHIP_CATEGORY_LABELS[s.category],
    kind: s.kind,
    kindLabel: SHARD_KIND_LABELS[s.kind],
    title: s.title,
    from: s.from,
    text: s.text,
    media: s.media ?? [],
    at: formatGameTime(s.at),
    read: s.read,
  }));

  const activeSlots = state.slots
    .filter((slot) => {
      if (!heldChipDefinition(inventory, data, slot.carrier)) return false;
      const content = contents.get(slot.contentId);
      if (content?.category === "behavior" && !hasBehaviorChrome) return false;
      return true;
    })
    .map((slot) => {
      const content = contents.get(slot.contentId);
      return {
        carrier: slot.carrier,
        contentId: slot.contentId,
        title: content?.title ?? slot.contentId,
        category: content?.category ?? "skill",
        categoryLabel: CHIP_CATEGORY_LABELS[content?.category ?? "skill"],
        ability: content?.ability ?? null,
        protocol: content?.protocol ?? null,
        at: formatGameTime(slot.at),
      };
    });

  let hasReader = false;
  const carried = Object.keys(inventory.backpack).flatMap((id) => {
    const def = heldChipDefinition(inventory, data, id);
    if (!def) return [];
    if (def.chipDevice === "reader-writer") hasReader = true;
    const content = def.chipContentId ? contents.get(def.chipContentId) : undefined;
    if (!content) return [];
    const inspected = state.inspected.includes(id);
    const hazard = activeChipHazard(state, id, content);
    const lockedParts = content.parts.filter(
      (p) => !readableChipPart(state, id, content, p.id),
    ).length;
    const readParts = content.parts.filter((p) =>
      state.shards.some((s) => s.contentId === content.id && s.partId === p.id),
    ).length;
    const canSeeEddies = inspected || lockedParts === 0;
    return [
      {
        carrier: id,
        name: def.name ?? catalog.get(id)?.name ?? id,
        contentId: content.id,
        title: content.title,
        category: content.category,
        categoryLabel: CHIP_CATEGORY_LABELS[content.category],
        summary: content.summary,
        slotted: activeSlots.some((s) => s.carrier === id),
        encrypted: lockedParts > 0,
        encryption: content.encryption,
        encryptionLabel: CHIP_ENCRYPTION_LABELS[content.encryption],
        inspected,
        /** 未查毒时前端不剧透具体病毒类型，只显「未查毒」；查毒后显示安全或检出风险 */
        hazard: inspected ? hazard : null,
        hazardLabel: inspected ? CHIP_HAZARD_LABELS[hazard] : null,
        eddiesRemaining:
          canSeeEddies && content.eddies > 0 && !state.drained.includes(id) ? content.eddies : 0,
        ability: content.ability ?? null,
        protocol: content.protocol ?? null,
        braindance: content.braindance ?? null,
        totalParts: content.parts.length,
        readParts,
        lockedParts,
      },
    ];
  });

  return {
    list,
    unread: list.filter((s) => !s.read).length,
    slots: {
      max: NEURAL_CHIP_SLOTS,
      used: activeSlots.length,
      items: activeSlots,
    },
    carried,
    hasReader,
    hasBehaviorChrome,
  };
}
