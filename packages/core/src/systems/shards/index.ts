import { defineSystem } from "../../kernel/system";
import type { InventoryState } from "../inventory";
import type { WorldClockState } from "../world";
import { shardsActions } from "./actions";
import { applyChip, applyShard, chipContentCatalog, readShards } from "./apply";
import { shardsRules, shardsSection } from "./prompt";
import {
  type ChipCommand,
  ChipCommandSchema,
  type ShardCommand,
  ShardCommandSchema,
  ShardReadSchema,
  type ShardsInternal,
  type ShardsState,
  ShardsStateSchema,
} from "./schema";
import { shardsView } from "./view";

/** 芯片：录音、邮件、日记统一收进数据库页；原文是玩家读到的，玩家和叙事模型看的是同一份 */
export const shards = defineSystem<ShardsState, ShardCommand | ChipCommand, ShardsInternal>({
  id: "shards",
  dependsOn: ["inventory", "world", "cyberware", "health", "hacking"],
  state: ShardsStateSchema,
  initial: () => ({ shards: [], nextShard: 1, contents: {}, unlocked: {} }),
  commands: { shard: ShardCommandSchema, chip: ChipCommandSchema },
  internal: { "shards.read": ShardReadSchema },
  apply(draft, command, ctx) {
    if (command.type === "shards.read") return readShards(draft, command.ids);
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
  rules: [shardsRules],
  sections: [
    {
      order: 160,
      title: "读过的芯片",
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
export * from "./view";
