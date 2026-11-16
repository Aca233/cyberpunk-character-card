import { z } from "zod";
import type { WorldState } from "./kernel/world";
import { CharacterStateSchema, effectiveAttributes } from "./systems/character/schema";
import { WeaponConcealmentSchema } from "./systems/dice/schema";
import { woundSlotOf } from "./systems/health/apply";
import { HealthStateSchema, WOUND_SLOT_LABELS, WoundSlotSchema } from "./systems/health/schema";
import { isImmunosuppressed, neuralDisplay, neuralStage } from "./systems/humanity/apply";
import { HumanityStateSchema } from "./systems/humanity/schema";
import { itemCatalog } from "./systems/inventory/apply";
import {
  InventoryStateSchema,
  type ItemDef,
  loadoutSummary,
  weaponConcealment,
} from "./systems/inventory/schema";
import { isBlackLaceWithdrawal, isFatigued, phaseClockOf } from "./systems/world/apply";
import { PhaseClockSchema, WorldClockStateSchema } from "./systems/world/schema";

/**
 * 3.0 夜之城社会生态与生存之道（Career Role & Rank）核心状态结构（Chapter 3 & Chapter 7）：
 * - edgerunner：街头佣兵（自由接单、同行抢活、事后分赃）
 * - corpo：公司雇员（C1 基层专员 -> C5 董事会高管，绩效考核、企业人事清算与产权义体锁 DRM Lock、反情报追杀）
 * - joytoyPatron：欢愉场所熟客与地下耳目网
 * - dollSpy：玩偶芯片与贴身间谍（微表情调谐、枕边窃密）
 * - nomad：恶土流浪者（改装车走私暗格、城外法外安全屋与外围接应）
 */
export const CareerRoleSchema = z.enum(["edgerunner", "corpo", "joytoyPatron", "dollSpy", "nomad"]);
export type CareerRole = z.infer<typeof CareerRoleSchema>;

export const CorpoRankSchema = z.enum(["C1", "C2", "C3", "C4", "C5"]);
export type CorpoRank = z.infer<typeof CorpoRankSchema>;

export const CareerStateSchema = z.object({
  role: CareerRoleSchema.default("edgerunner"),
  rank: CorpoRankSchema.default("C1"),
  /** 周期绩效评估（0..100+）；基层垫底触发 HR 清算（冻结账户、收回公寓、远程锁死产权义体），而非无脑派杀手 */
  kpi: z.number().int().min(0).max(200).default(50),
  /** 部门可支配公款经费（Slush Fund，可用于雇佣外包佣兵干脏活） */
  slushFund: z.number().int().min(0).default(0),
  /** 企业产权义体是否已被公司远程锁死/降级（DRM Lock） */
  drmLocked: z.boolean().default(false),
  /** 是否因窃取核心机密、亏空公款或掌握高管致命黑料而被公司反情报部列入物理抹除名单 */
  counterIntelTargeted: z.boolean().default(false),
  /** 是否已安装玩偶神经芯片（Doll Chip） */
  dollChipInstalled: z.boolean().default(false),
  /** 流浪者家族声望/贡献度与外围车队接应可用性 */
  nomadContribution: z.number().int().min(0).default(0),
});
export type CareerState = z.infer<typeof CareerStateSchema>;

/**
 * 《边缘账本》3.0 顶层聚合状态树（Chapter 7 `packages/core/state.ts`）
 */
export const EdgeLedgerStateSchema = z.object({
  timeMinutes: z.number().int().min(0),
  wounds: WoundSlotSchema,
  phaseClock: PhaseClockSchema,
  loadout: z.object({
    bulkyCount: z.number().int().min(0),
    bulkyMax: z.number().int().min(2),
    bulkyOverloaded: z.boolean(),
    hasHeavyWeapon: z.boolean(),
    concealment: WeaponConcealmentSchema,
  }),
  humanity: z.object({
    current: z.number().int().min(0).max(100),
    cap: z.number().int().min(0).max(100),
    suppressed: z.boolean(),
    glitchZone: z.boolean(),
  }),
  fatigued: z.boolean(),
  blackLaceWithdrawal: z.boolean(),
  career: CareerStateSchema,
});
export type EdgeLedgerState = z.infer<typeof EdgeLedgerStateSchema>;

/** 从 WorldState 提取 3.0 核心聚合状态树 */
export function extractEdgeLedgerState(
  world: WorldState,
  data: Readonly<Record<string, unknown>> = {},
): EdgeLedgerState {
  const health = HealthStateSchema.parse(world.slices.health);
  const humanity = HumanityStateSchema.parse(world.slices.humanity);
  const inventory = InventoryStateSchema.parse(world.slices.inventory);
  const clock = WorldClockStateSchema.parse(world.slices.world);
  const career = CareerStateSchema.parse(world.slices.career ?? {});

  const catalog = data.items === undefined ? new Map<string, ItemDef>() : itemCatalog(data);
  const loadout = loadoutSummary(inventory, catalog);
  const wounds = woundSlotOf(health);
  const phase = phaseClockOf(world.time, clock.sceneStartedAt);
  const suppressed = isImmunosuppressed(humanity, world.time);

  return {
    timeMinutes: world.time,
    wounds,
    phaseClock: { day: phase.day, phase: phase.phase },
    loadout: {
      bulkyCount: loadout.bulkyCount,
      bulkyMax: loadout.bulkyMax,
      bulkyOverloaded: loadout.bulkyOverloaded,
      hasHeavyWeapon: loadout.hasHeavyWeapon,
      concealment: loadout.concealment,
    },
    humanity: {
      current: neuralDisplay(humanity),
      cap: 100,
      suppressed,
      glitchZone: !suppressed && ["unstable", "edge", "crisis"].includes(neuralStage(humanity)),
    },
    fatigued: isFatigued(clock),
    blackLaceWithdrawal: isBlackLaceWithdrawal(clock, world.time),
    career,
  };
}

export {
  CharacterStateSchema,
  effectiveAttributes,
  HealthStateSchema,
  HumanityStateSchema,
  InventoryStateSchema,
  PhaseClockSchema,
  WeaponConcealmentSchema,
  WOUND_SLOT_LABELS,
  WorldClockStateSchema,
  WoundSlotSchema,
  weaponConcealment,
};
