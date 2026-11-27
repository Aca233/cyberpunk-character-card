import { z } from "zod";
import { SetCharacterSchema } from "../systems/character/schema";
import { ArmSideSchema } from "../systems/cyberware/schema";
import { NpcCardSchema, SeedNpcSchema } from "../systems/npc/schema";
import {
  NPC_OVERRIDES_MAX,
  START_CYBERWARE_MAX,
  StartCyberwareSchema,
  StartKitSchema,
} from "./board";
import { WorkshopPackSchema } from "./workshop";

/** 开档时角色卡的快照：之后改角色卡不影响已有存档 */
export const SaveCharacterSchema = SetCharacterSchema.omit({ type: true });
export type SaveCharacter = z.infer<typeof SaveCharacterSchema>;

/** 建档时从角色主板带进来的：开局义体 id、开局行装定制和模块/自定义带出的人物卡 */
export const BoardStartSchema = z.object({
  cyberware: z.array(z.string().min(1)).default([]),
  /** 手臂义体的左右侧别记录（key 为义体 id，value 为 left/right/both） */
  cyberwareSides: z.record(z.string(), ArmSideSchema).optional(),
  /** 自定义/本地义体的自包含快照：不依赖官方义体目录也能正常装入新档与投影显示 */
  customCyberware: z.array(StartCyberwareSchema).max(START_CYBERWARE_MAX).default([]),
  /** 出身模块 id：按它给开局住所；旧存档没有 */
  origin: z.string().min(1).optional(),
  /** 开局行装定制（资金档位、额外随身武器与专属载具） */
  kit: StartKitSchema.optional(),
  people: z
    .array(SeedNpcSchema.omit({ type: true }))
    .max(60)
    .default([]),
  /**
   * 捏人给原作人物选的旧识：建档时盖过原作人物卡的开局好感、记成见过，带上关系笔记和人情。
   */
  acquaintances: z
    .array(SeedNpcSchema.pick({ id: true, relation: true, ledger: true }))
    .max(100)
    .default([]),
  /** 建档时对原作/工坊人物卡的角色级覆写（按 id 盖过默认卡面，保留旧识关系与人情） */
  npcOverrides: z.array(NpcCardSchema).max(NPC_OVERRIDES_MAX).default([]),
});
export type BoardStart = z.infer<typeof BoardStartSchema>;
export type StartAcquaintance = BoardStart["acquaintances"][number];

/** 存档目录里的 meta.json */
export const SaveMetaSchema = z.object({
  title: z.string().min(1).max(80),
  characterId: z.string().min(1),
  createdAt: z.string().min(1),
  /** 开场的游戏时间（从 1970-01-01 00:00 起的分钟数） */
  startTime: z.number().int(),
  /** 旧存档没有：开档时没有选角色 */
  character: SaveCharacterSchema.optional(),
  /** 旧存档没有：用的是内容包里哪个开场 */
  opening: z.string().min(1).optional(),
  /**
   * 建档时选的开局地点（地点 id：原作固定地点，或原作地标 ft:、服务点 poi:），盖过开场自带的地点；引导委托、出场人物和行装照开场不变。
   * 用户定的（2026-10-30）："可以选择地点开局"。旧存档和没选的存档没有，照旧用开场自带的地点
   */
  startLocation: z.string().min(1).optional(),
  /** 旧存档没有：建档时按出身和经历挑的开局行装，读档重放时照这个发 */
  loadouts: z.array(z.string().min(1)).optional(),
  /** 旧存档和没用主板的角色没有 */
  board: BoardStartSchema.optional(),
  /** 建档时启用的内容包快照；后续停用或删除工坊包不会改变这份存档 */
  workshopPacks: z.array(WorkshopPackSchema).max(40).optional(),
});
export type SaveMeta = z.infer<typeof SaveMetaSchema>;
