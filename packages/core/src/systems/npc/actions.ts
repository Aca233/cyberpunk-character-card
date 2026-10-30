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

/** 人物的界面操作：校验在场和义眼，翻成 npcScan，统一由操作入口结算 */
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
};
