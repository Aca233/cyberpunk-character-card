import { z } from "zod";
import { defineAction } from "../../kernel/system";
import { CyberwareStateSchema, cyberwareCatalog } from "../cyberware";
import { HealthStateSchema } from "../health";
import { InventoryStateSchema } from "../inventory";
import { WorldClockStateSchema } from "../world";
import { deathKnown } from "./apply";
import { onStage } from "./prompt";
import { NPC_GEAR_MAX, NpcStateSchema, RELATION_CHARS } from "./schema";

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

/** 非战斗时与身边的同行同伴原子交接随身武器或物品（保留定制武器配件与归属） */
export const NpcExchangeGearActionSchema = z.strictObject({
  type: z.literal("npcExchangeGear"),
  id: z.string().min(1).max(64),
  action: z.enum(["give", "take"]),
  item: z.string().min(1).max(120),
});

/** 在人物档案里直接补充或改写与已结识 NPC 的关系定性（不调用模型，写入日志并即时同步给叙事 AI） */
export const SetNpcRelationActionSchema = z.strictObject({
  type: z.literal("setNpcRelation"),
  id: z.string().min(1).max(64),
  text: z
    .string()
    .trim()
    .min(1, "关系描述不能为空")
    .max(RELATION_CHARS, `关系描述最多 ${RELATION_CHARS} 字`),
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
  npcExchangeGear: defineAction({
    schema: NpcExchangeGearActionSchema,
    commands: (action, { world }) => {
      const combat = (world.slices.combat as { active?: unknown } | undefined)?.active;
      if (combat) return "交战中交接装备需要在行动里描述";
      const health = HealthStateSchema.parse(world.slices.health);
      if (health.condition !== "up") return "当前无法自行交接装备";
      const npc = NpcStateSchema.parse(world.slices.npc).npcs[action.id];
      if (!npc?.met) return "没有这个已结识的人物";
      if (deathKnown(npc) || !npc.alive) return `${npc.name} 已经死了`;
      if (!npc.following) return `${npc.name} 当前没有与你同行，先结伴同行再分配装备`;
      const clock = WorldClockStateSchema.parse(world.slices.world);
      const stage = { location: clock.location, sceneStartedAt: clock.sceneStartedAt };
      if (!onStage(npc, stage)) return `${npc.name} 不在现场，无法当面交接装备`;

      const gear = npc.body?.gear ?? [];
      const inventory = InventoryStateSchema.parse(world.slices.inventory);
      if (action.action === "give") {
        if ((inventory.backpack[action.item] ?? 0) < 1) {
          return "背包里没有这件物品（若正穿戴或挂在快捷栏，请先卸下放回背包）";
        }
        const slotted = (world.slices.shards as { slotted?: readonly string[] } | undefined)
          ?.slotted;
        if (slotted?.includes(action.item)) {
          return "请先从个人神经芯片槽拔下后再交给同伴";
        }
        if (gear.includes(action.item)) {
          return `${npc.name} 身上已经带着这件装备了`;
        }
        if (gear.length >= NPC_GEAR_MAX) {
          return `${npc.name} 的随身装备栏已满（最多 ${NPC_GEAR_MAX} 件），请先取回一件`;
        }
        // inventory.apply 的 item(lose, recipient: npc.id) 会自动转移独立物件归属并 emit npcGear(add)
        return [
          {
            type: "item",
            action: "lose",
            id: action.item,
            recipient: npc.id,
            reason: `交给同行同伴${npc.name}`,
          },
        ];
      }

      if (!gear.includes(action.item)) {
        return `${npc.name} 身上没有这件装备`;
      }
      const tracked = inventory.objects[action.item];
      if (tracked && tracked.holder === npc.id) {
        // 独立物件（定制武器/剧情物件/芯片）由 item(gain) 核验原持有人并自动 emit npcGear(remove)
        return [
          {
            type: "item",
            action: "gain",
            id: action.item,
            reason: `从同行同伴${npc.name}处取回`,
          },
        ];
      }
      return [
        { type: "npcGear", id: npc.id, action: "remove", item: action.item },
        {
          type: "item",
          action: "gain",
          id: action.item,
          reason: `从同行同伴${npc.name}处取回`,
        },
      ];
    },
  }),
  setNpcRelation: defineAction({
    schema: SetNpcRelationActionSchema,
    commands: (action, { world }) => {
      const npc = NpcStateSchema.parse(world.slices.npc).npcs[action.id];
      if (!npc) return "没有这个人";
      if (!npc.met) return `还没正式结识 ${npc.name}，暂不能设定关系`;
      return [{ type: "relation", id: npc.id, text: action.text }];
    },
  }),
};
