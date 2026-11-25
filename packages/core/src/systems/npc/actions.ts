import { z } from "zod";
import { defineAction } from "../../kernel/system";
import { CyberwareStateSchema, cyberwareCatalog } from "../cyberware";
import { HealthStateSchema } from "../health";
import { WorldClockStateSchema } from "../world";
import { deathKnown } from "./apply";
import { onStage } from "./prompt";
import { NpcStateSchema } from "./schema";

/**
 * 点一下立刻扫描（用户定的，计划第十二节第 14 条）：在场的人名字格和档案里的「扫描」按钮。
 * 不调用模型、不花游戏时间；装着没坏的义眼才扫得了，结果和叙事里写 npcScan 一样记进档案
 */
export const ScanNpcActionSchema = z.strictObject({
  type: z.literal("scanNpc"),
  // 人物 id；在不在表里由 commands 查，npcScan 结算时再按 schema 校验一遍
  id: z.string().min(1).max(64),
});

/** 在人物档案或左栏一键让已随行同伴留守/暂别；同行本身由剧情或交涉促成，不凭空强拉陌生人 */
export const CompanionActionSchema = z.strictObject({
  type: z.literal("npcCompanion"),
  id: z.string().min(1).max(64),
  following: z.boolean(),
});

/** 人物的界面操作：扫描与同行管理，统一由操作入口结算 */
export const npcActions = {
  scanNpc: defineAction({
    schema: ScanNpcActionSchema,
    commands: (action, { world, data }) => {
      const npc = NpcStateSchema.parse(world.slices.npc).npcs[action.id];
      if (!npc) return "没有这个人";
      if (deathKnown(npc) || !npc.alive) return `${npc.name} 已经死了`;
      const clock = WorldClockStateSchema.parse(world.slices.world);
      const stage = { location: clock.location, sceneStartedAt: clock.sceneStartedAt };
      if (!onStage(npc, stage)) return `${npc.name} 不在这里，扫描不到`;
      // 眼部装着义眼才扫得了；打坏的义眼不算（旧存档没有义体或伤势时按没装算）
      const installed = CyberwareStateSchema.parse(world.slices.cyberware ?? {}).installed;
      const broken = HealthStateSchema.parse(world.slices.health ?? {}).brokenChrome;
      const catalog = cyberwareCatalog(data);
      const eyes = installed.filter((c) => c.slot === "eyes" && catalog.has(c.id));
      if (eyes.length === 0) return "没装义眼，扫描不了；去义体医生那里装一副";
      if (eyes.every((c) => broken.includes(c.id))) return "义眼打坏了，扫描不了；先去修好";
      return [{ type: "npcScan", id: npc.id }];
    },
  }),
  npcCompanion: defineAction({
    schema: CompanionActionSchema,
    commands: (action, { world }) => {
      const combat = (world.slices.combat as { active?: unknown } | undefined)?.active;
      if (combat) return "打斗中顾不上调整同行，先解决眼前局面";
      const npc = NpcStateSchema.parse(world.slices.npc).npcs[action.id];
      if (!npc?.met) return "没有这个已结识的人物";
      if (deathKnown(npc) || !npc.alive) return `${npc.name} 已经死了`;
      if (action.following) {
        const clock = WorldClockStateSchema.parse(world.slices.world);
        const stage = { location: clock.location, sceneStartedAt: clock.sceneStartedAt };
        if (!onStage(npc, stage)) return `${npc.name} 不在现场，先碰面再结伴同行`;
        if (npc.ledger.some((e) => e.settledAt === null && e.kind === "grudge")) {
          return `${npc.name} 对你还记着未解的仇，不会直接随行`;
        }
        if (!npc.relation && npc.memories.length === 0) {
          return `${npc.name} 和你还没建立交情，先在剧情里谈妥一起走`;
        }
      }
      return [{ type: "npcCompanion", id: npc.id, following: action.following }];
    },
  }),
};
