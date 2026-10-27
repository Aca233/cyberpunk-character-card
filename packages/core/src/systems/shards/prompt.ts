import type { RuleModule } from "../../kernel/system";
import { formatGameTime } from "../world";
import { SHARD_KIND_LABELS, type ShardsState } from "./schema";

/** 【读过的芯片】里列最近几块，叙事模型照原文接着写、不重复收 */
const SECTION_SHARDS = 8;

export const shardsRules: RuleModule<ShardsState> = {
  id: "shards",
  title: "芯片",
  commands: ["shard"],
  when: () => true,
  text: `- 玩家角色真的读了一块芯片、一封邮件、一页日记，或者听了一段录音，写一条 shard：kind 选 recording、email、diary 或 data，text 写玩家角色读到、听到的原文，收进数据库页，玩家以后随时能翻。
- 只收玩家角色亲眼读到、亲耳听到的；加密没解开、没读到的部分不写进 text，也不替玩家角色读。别人口头转述的不算芯片。
- 【读过的芯片】里已经有的不要再写；正文提到它时和原文对得上。`,
};

/** 给叙事模型看的【读过的芯片】：最近几块的标题、来源和原文；没有就是 undefined */
export function shardsSection(state: ShardsState): string | undefined {
  if (state.shards.length === 0) return undefined;
  return state.shards
    .slice(-SECTION_SHARDS)
    .map(
      (s) =>
        `- #${s.id}［${SHARD_KIND_LABELS[s.kind]}］${s.title}${s.from ? `（${s.from}）` : ""}｜${formatGameTime(s.at)}：${s.text}`,
    )
    .join("\n");
}
