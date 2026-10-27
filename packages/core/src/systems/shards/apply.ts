import type { Draft } from "immer";
import type { ApplyOutcome } from "../../kernel/system";
import { SHARDS_KEPT, type ShardCommand, type ShardsState } from "./schema";

/** 玩家角色读了一块芯片：标题和原文都一样的算同一块，不重复收 */
export function applyShard(
  draft: Draft<ShardsState>,
  command: ShardCommand,
  now: number,
): ApplyOutcome {
  if (draft.shards.some((s) => s.title === command.title && s.text === command.text)) {
    return { ok: true };
  }
  draft.shards.push({
    id: draft.nextShard,
    kind: command.kind,
    title: command.title,
    from: command.from ?? null,
    text: command.text,
    at: now,
    read: false,
  });
  draft.nextShard += 1;
  if (draft.shards.length > SHARDS_KEPT) {
    draft.shards = draft.shards.slice(-SHARDS_KEPT);
  }
  return { ok: true };
}

/** 数据库页打开了这些芯片；不认识的 id 不管 */
export function readShards(draft: Draft<ShardsState>, ids: readonly number[]): ApplyOutcome {
  const wanted = new Set(ids);
  for (const shard of draft.shards) {
    if (wanted.has(shard.id)) shard.read = true;
  }
  return { ok: true };
}
