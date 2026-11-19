import type { Command } from "./kernel/system";
import type { WorldState } from "./kernel/world";
import type { PresentedContentMedia } from "./schemas/presented-content-media";
import { BraindanceCommandSchema, BraindanceStateSchema } from "./systems/braindance/schema";
import { itemCatalog } from "./systems/inventory/apply";
import { InventoryStateSchema } from "./systems/inventory/schema";
import { ChipCommandSchema, ShardCommandSchema, ShardsStateSchema } from "./systems/shards/schema";

/** 只按已生效的读取和呈现操作收集；取得、定义、解密、接入及略写看完均不展开媒体。 */
export function collectPresentedContentMedia(
  before: WorldState,
  after: WorldState,
  commands: readonly Command[],
  data: Readonly<Record<string, unknown>>,
): PresentedContentMedia[] {
  if (
    !commands.some(
      (command) =>
        command.type === "shard" ||
        (command.type === "chip" && command.action === "read") ||
        (command.type === "braindance" &&
          (command.action === "progress" || command.action === "replay")),
    )
  )
    return [];
  const shards = ShardsStateSchema.parse(after.slices.shards ?? {});
  const braindance = BraindanceStateSchema.parse(after.slices.braindance ?? {});
  const inventory = InventoryStateSchema.parse(after.slices.inventory ?? {});
  const catalog = itemCatalog(data);
  const result = new Map<string, PresentedContentMedia>();
  const previous = BraindanceStateSchema.parse(before.slices.braindance ?? {});
  const settled = new Set(previous.settled);
  let activeWork = previous.active?.work;
  const add = (group: PresentedContentMedia) => {
    if (group.media.length) result.set(group.id, group);
  };
  const addShard = (contentId: string, partId: string) => {
    const shard = shards.shards.find(
      (entry) => entry.contentId === contentId && entry.partId === partId,
    );
    if (shard?.media?.length)
      add({
        id: `chip:${contentId}:${partId}`,
        title: shard.title,
        source: "chip",
        media: shard.media.map((entry) => ({ ...entry })),
      });
  };
  for (const command of commands) {
    if (command.type === "chip") {
      const parsed = ChipCommandSchema.safeParse(command);
      if (!parsed.success || parsed.data.action !== "read") continue;
      const { carrier, parts } = parsed.data;
      const contentId = (inventory.objects[carrier]?.definition ?? catalog.get(carrier))
        ?.chipContentId;
      if (contentId) for (const part of parts) addShard(contentId, part);
    } else if (command.type === "shard") {
      const parsed = ShardCommandSchema.safeParse(command);
      if (parsed.success) addShard(parsed.data.contentId, parsed.data.partId);
    } else if (command.type === "braindance") {
      const parsed = BraindanceCommandSchema.safeParse(command);
      if (!parsed.success) continue;
      const event = parsed.data;
      // 已结算事件是幂等空操作，不能用旧 start/exit 改变本轮实际播放源。
      if (settled.has(event.event)) continue;
      settled.add(event.event);
      if (event.action === "start") activeWork = event.work;
      else if (event.action === "exit" || event.action === "finish") activeWork = undefined;
      else if (event.action === "progress" || event.action === "replay") {
        const work = activeWork ? braindance.works[activeWork] : undefined;
        const passage = work?.passages.find((entry) => entry.id === event.passage);
        if (work && passage?.media?.length && braindance.passages[work.id]?.[passage.id])
          add({
            id: `braindance:${work.id}:${passage.id}`,
            title: `${work.title} · ${passage.label}`,
            source: "braindance",
            media: passage.media.map((entry) => ({ ...entry })),
          });
      }
    }
  }
  return [...result.values()];
}
