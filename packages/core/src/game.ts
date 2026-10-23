/** 新存档的初始世界和给玩家看的状态投影；后端和网页共用 */
import { effectiveTurns, type LogRecord, logVersion } from "./kernel/turnlog";
import type { WorldState } from "./kernel/world";
import type { SaveMeta } from "./schemas/save";
import { type TurnInput, TurnInputSchema } from "./schemas/turn";
import { CombatStateSchema } from "./systems/combat/schema";
import { DiceStateSchema } from "./systems/dice/schema";
import { CONDITION_LABELS, woundTag } from "./systems/health/apply";
import { HealthStateSchema } from "./systems/health/schema";
import { humanityCap, humanityStage, STAGE_LABELS } from "./systems/humanity/apply";
import { HUMANITY_MAX, HumanityStateSchema } from "./systems/humanity/schema";
import { InventoryStateSchema } from "./systems/inventory/schema";
import { registry } from "./systems/registry";
import { formatGameTime, PERIOD_LABELS, periodOf } from "./systems/world/apply";
import { WorldClockStateSchema } from "./systems/world/schema";

/** 状态接口最多带最近这么多轮的正文；更早的按需翻页 */
export const VIEW_TURNS = 50;

/** 新存档的世界：按存档的开场时间和难度模式初始化 */
export function newGameWorld(meta: Pick<SaveMeta, "startTime" | "difficulty">): WorldState {
  const base = registry.initialWorld(meta.startTime);
  const clock = WorldClockStateSchema.parse(base.slices.world);
  return {
    ...base,
    slices: {
      ...base.slices,
      dice: DiceStateSchema.parse({ mode: meta.difficulty }),
      world: { ...clock, sceneStartedAt: meta.startTime },
    },
  };
}

function turnInput(raw: unknown): TurnInput {
  const parsed = TurnInputSchema.safeParse(raw);
  return parsed.success ? parsed.data : { mode: "do", text: String(raw) };
}

/**
 * 玩家能看到的状态。只放界面要显示的东西：
 * 去重用的已结算事件、已用检定 id、换装防刷的次数记录、被丢弃的指令都不出现
 */
export function projectState(world: WorldState, records: readonly LogRecord[]) {
  const dice = DiceStateSchema.parse(world.slices.dice);
  const clock = WorldClockStateSchema.parse(world.slices.world);
  const health = HealthStateSchema.parse(world.slices.health);
  const humanity = HumanityStateSchema.parse(world.slices.humanity);
  const inventory = InventoryStateSchema.parse(world.slices.inventory);
  const combat = CombatStateSchema.parse(world.slices.combat);
  const period = periodOf(world.time);
  const stage = humanityStage(humanity.current);
  const turns = effectiveTurns(records);
  const active = combat.active;

  return {
    version: logVersion(records),
    difficulty: dice.mode,
    time: {
      minutes: world.time,
      text: formatGameTime(world.time),
      period,
      periodLabel: PERIOD_LABELS[period],
    },
    location: clock.location,
    scene: clock.scene,
    health: {
      hp: health.hp,
      max: health.max,
      condition: health.condition,
      conditionLabel: CONDITION_LABELS[health.condition],
      wound: woundTag(health),
    },
    humanity: {
      current: humanity.current,
      cap: humanityCap(humanity),
      max: HUMANITY_MAX,
      stage,
      stageLabel: STAGE_LABELS[stage],
    },
    inventory: {
      weapons: inventory.weapons,
      active: inventory.active,
      healing: inventory.healing,
      grenade: inventory.grenade,
      backpack: inventory.backpack,
    },
    combat: {
      active: active && {
        /** 第几次交锋，从 1 起 */
        moment: active.current + 1,
        moments: active.moments,
        defeat: active.defeat,
        enemies: active.enemies,
        results: active.results,
        /** 濒死时还剩几次交锋结束前要被救回；不在濒死时为 null */
        dyingMomentsLeft:
          active.dyingUntil === null ? null : active.dyingUntil - active.current + 1,
      },
      last: combat.last,
    },
    deadlines: clock.deadlines
      .filter((d) => d.handledAt === null)
      .map((d) => ({
        id: d.id,
        label: d.label,
        due: formatGameTime(d.due),
        overdue: d.due <= world.time,
      })),
    totalTurns: turns.length,
    turns: turns.slice(-VIEW_TURNS).map((t) => ({
      seq: t.seq,
      at: t.at,
      input: turnInput(t.input),
      text: t.text,
      dice: t.dice,
    })),
  };
}

export type PlayerView = ReturnType<typeof projectState>;
