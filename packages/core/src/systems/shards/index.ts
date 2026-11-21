import { defineSystem } from "../../kernel/system";
import type { InventoryState } from "../inventory";
import type { WorldClockState } from "../world";
import { shardsActions } from "./actions";
import { applyChip, applyShard, chipContentCatalog, pruneSlots, readShards } from "./apply";
import { shardsRules, shardsSection } from "./prompt";
import {
  type ChipCommand,
  ChipCommandSchema,
  type ShardCommand,
  ShardCommandSchema,
  ShardReadSchema,
  ShardRegisterSchema,
  type ShardsInternal,
  type ShardsState,
  ShardsStateSchema,
} from "./schema";
import { shardsStatus } from "./status";
import { shardsView } from "./view";

/** 神经芯片与资料库：个人 2 槽即时协议、隔离查毒、离线破译与阅读档案 */
export const shards = defineSystem<ShardsState, ShardCommand | ChipCommand, ShardsInternal>({
  id: "shards",
  dependsOn: ["inventory", "world", "cyberware", "health", "hacking", "economy"],
  state: ShardsStateSchema,
  initial: () => ({
    shards: [],
    nextShard: 1,
    contents: {},
    unlocked: {},
    inspected: [],
    cleansed: [],
    drained: [],
    slots: [],
  }),
  commands: { shard: ShardCommandSchema, chip: ChipCommandSchema },
  internal: {
    "shards.read": ShardReadSchema,
    "shards.register": ShardRegisterSchema,
  },
  apply(draft, command, ctx) {
    if (command.type === "shards.read") return readShards(draft, command.ids);
    if (command.type === "shards.register") {
      if (!chipContentCatalog(ctx.data, draft).has(command.content.id)) {
        draft.contents[command.content.id] = command.content;
      }
      return { ok: true };
    }
    if (command.type === "chip") return applyChip(draft, command, ctx);
    if (chipContentCatalog(ctx.data, draft).has(command.contentId))
      return {
        ok: false,
        reason: "已固定的芯片内容须使用 chip read，不能绕过载体或加密条件抄入档案",
      };
    if (command.carrier) {
      const inventory = ctx.read<InventoryState>("inventory");
      const object = inventory.objects[command.carrier];
      if (object?.holder !== "player" || !inventory.backpack[command.carrier])
        return { ok: false, reason: "没有实际持有这块资料载体" };
      if (object.definition.chipContentId !== command.contentId)
        return { ok: false, reason: "载体与资料身份不一致，先登记固定内容再读取" };
    }
    return applyShard(draft, command, ctx.now, ctx.read<WorldClockState>("world").location);
  },
  on: {
    "inventory.changed": (draft, ctx) => pruneSlots(draft, ctx),
    "cyberware.changed": (draft, ctx) => pruneSlots(draft, ctx),
  },
  rules: [shardsRules],
  status: shardsStatus,
  sections: [
    {
      order: 160,
      title: "神经芯片与档案",
      render: (context) =>
        shardsSection(ShardsStateSchema.parse(context.world.slices.shards ?? {}), context),
    },
  ],
  view: { key: "shards", project: shardsView },
  actions: shardsActions,
});

export * from "./actions";
export * from "./apply";
export * from "./prompt";
export * from "./schema";
export * from "./status";
export * from "./view";
