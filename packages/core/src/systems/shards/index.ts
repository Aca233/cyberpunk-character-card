import { defineSystem } from "../../kernel/system";
import { shardsActions } from "./actions";
import { applyShard, readShards } from "./apply";
import { shardsRules, shardsSection } from "./prompt";
import {
  type ShardCommand,
  ShardCommandSchema,
  ShardReadSchema,
  type ShardsInternal,
  type ShardsState,
  ShardsStateSchema,
} from "./schema";
import { shardsView } from "./view";

/** 芯片：录音、邮件、日记统一收进数据库页；原文是玩家读到的，玩家和叙事模型看的是同一份 */
export const shards = defineSystem<ShardsState, ShardCommand, ShardsInternal>({
  id: "shards",
  state: ShardsStateSchema,
  initial: () => ({ shards: [], nextShard: 1 }),
  commands: { shard: ShardCommandSchema },
  internal: { "shards.read": ShardReadSchema },
  apply(draft, command, ctx) {
    if (command.type === "shards.read") return readShards(draft, command.ids);
    return applyShard(draft, command, ctx.now);
  },
  rules: [shardsRules],
  sections: [
    {
      order: 160,
      title: "读过的芯片",
      render: ({ world }) => shardsSection(ShardsStateSchema.parse(world.slices.shards ?? {})),
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
