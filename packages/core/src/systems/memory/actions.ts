import { z } from "zod";
import { defineAction } from "../../kernel/system";
import { NpcStateSchema } from "../npc";
import {
  IMPORTANCE_LABELS,
  ImportanceSchema,
  MemoryStateSchema,
  type SceneSummary,
  SUMMARY_CHARS,
  SUMMARY_TITLE_CHARS,
} from "./schema";

/**
 * 记忆面板：改写或删掉一条场景摘要（what scene，写 scene）或共同记忆（what bond，写 npc 和 index）；
 * before 是玩家看到的原文，对不上就不改；每次修改都记进修改记录
 */
export const EditMemoryActionSchema = z.strictObject({
  type: z.literal("editMemory"),
  what: z.enum(["scene", "bond"]),
  action: z.enum(["edit", "remove"]),
  scene: z.number().int().min(0).optional(),
  npc: z.string().min(1).max(64).optional(),
  index: z.number().int().min(0).optional(),
  before: z.string().min(1).max(400),
  title: z.string().trim().min(1).max(SUMMARY_TITLE_CHARS).optional(),
  text: z.string().trim().min(1).max(SUMMARY_CHARS).optional(),
  importance: ImportanceSchema.optional(),
});

/** 修改记录里一条场景摘要的写法 */
function sceneLine(s: Pick<SceneSummary, "title" | "text" | "importance">): string {
  return `「${s.title}」［${IMPORTANCE_LABELS[s.importance]}］${s.text}`;
}

/** 记忆面板的操作：改的那一条加一条修改记录；改不成（原文对不上、内容没变）整个操作不生效 */
export const memoryActions = {
  editMemory: defineAction({
    schema: EditMemoryActionSchema,
    commands: (action, { world }) => {
      const removing = action.action === "remove";
      if (action.what === "scene") {
        if (action.scene === undefined) return "没说改哪一场的摘要";
        const scene = MemoryStateSchema.parse(world.slices.memory ?? {}).scenes.find(
          (s) => s.scene === action.scene,
        );
        if (!scene) return `没有第 ${action.scene} 场的摘要`;
        const after = {
          title: action.title ?? scene.title,
          text: action.text ?? scene.text,
          importance: action.importance ?? scene.importance,
        };
        return [
          {
            type: "memory.edit",
            scene: action.scene,
            before: action.before,
            action: action.action,
            ...(removing ? {} : after),
          },
          {
            type: "memory.log",
            what: "scene",
            ref: `第 ${action.scene} 场`,
            action: action.action,
            before: sceneLine(scene),
            after: removing ? null : sceneLine(after),
          },
        ];
      }
      if (action.npc === undefined || action.index === undefined) {
        return "没说改谁的哪一条共同记忆";
      }
      const npc = NpcStateSchema.parse(world.slices.npc ?? { npcs: {} }).npcs[action.npc];
      if (!npc) return `没有 id 为 ${action.npc} 的人物卡`;
      if (!removing && action.text === undefined) return "改写的内容不能为空";
      // 和 npc 的 memory 指令一样，一条共同记忆最多 120 字
      if (!removing && (action.text ?? "").length > 120) return "一条共同记忆最多 120 字";
      return [
        {
          type: "npc.memoryEdit",
          id: action.npc,
          index: action.index,
          before: action.before,
          action: action.action,
          ...(removing ? {} : { text: action.text }),
        },
        {
          type: "memory.log",
          what: "bond",
          ref: npc.name,
          action: action.action,
          before: action.before,
          after: removing ? null : (action.text ?? null),
        },
      ];
    },
  }),
};
