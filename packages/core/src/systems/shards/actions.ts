import { z } from "zod";
import { defineAction } from "../../kernel/system";
import { SHARDS_READ_BATCH } from "./schema";

/** 数据库页打开芯片：只提交本次实际展示的芯片 id；不调用模型，不花游戏时间 */
export const ReadShardsActionSchema = z.strictObject({
  type: z.literal("readShards"),
  ids: z.array(z.number().int().min(1)).min(1).max(SHARDS_READ_BATCH),
});

/** 数据库页的操作：只翻成指令，统一由操作入口结算 */
export const shardsActions = {
  readShards: defineAction({
    schema: ReadShardsActionSchema,
    commands: (action) => [{ type: "shards.read", ids: action.ids }],
  }),
};
