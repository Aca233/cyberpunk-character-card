/** 新存档的初始世界和给玩家看的状态投影；后端和网页共用 */
import { currentOffers, prepareFor } from "./gm/pending";
import { effectiveTurns, type LogRecord, logVersion } from "./kernel/turnlog";
import type { WorldState } from "./kernel/world";
import type { SaveMeta } from "./schemas/save";
import { type TurnInput, TurnInputSchema } from "./schemas/turn";
import { CharacterStateSchema } from "./systems/character/schema";
import { CombatStateSchema } from "./systems/combat/schema";
import { ATTRIBUTE_LABELS, DiceStateSchema, OPPONENT_TIERS } from "./systems/dice/schema";
import { CONDITION_LABELS, woundTag } from "./systems/health/apply";
import { HealthStateSchema } from "./systems/health/schema";
import { humanityCap, humanityStage, STAGE_LABELS } from "./systems/humanity/apply";
import { HUMANITY_MAX, HumanityStateSchema } from "./systems/humanity/schema";
import { InventoryStateSchema } from "./systems/inventory/schema";
import { onStage } from "./systems/npc/prompt";
import { type NpcCard, NpcStateSchema } from "./systems/npc/schema";
import { registry } from "./systems/registry";
import { formatGameTime, PERIOD_LABELS, periodOf } from "./systems/world/apply";
import { WorldClockStateSchema } from "./systems/world/schema";

/** 状态接口最多带最近这么多轮的正文；更早的按需翻页 */
export const VIEW_TURNS = 50;

/** 新存档要放进世界的静态内容（content 包），例如原作人物卡 */
export interface GameContent {
  readonly npcs?: readonly (NpcCard & { readonly affinity?: number | undefined })[];
}

const setupRng = { roll: () => 1 };

/** 新存档的世界：按存档的开场时间和难度模式初始化，写入玩家角色和原作人物卡 */
export function newGameWorld(
  meta: Pick<SaveMeta, "startTime" | "difficulty"> & Partial<Pick<SaveMeta, "character">>,
  content: GameContent = {},
): WorldState {
  const base = registry.initialWorld(meta.startTime);
  const clock = WorldClockStateSchema.parse(base.slices.world);
  const world: WorldState = {
    ...base,
    slices: {
      ...base.slices,
      dice: DiceStateSchema.parse({ mode: meta.difficulty }),
      world: { ...clock, sceneStartedAt: meta.startTime },
    },
  };
  const commands = [
    ...(meta.character ? [{ type: "character.set", ...meta.character }] : []),
    ...(content.npcs ?? []).map((card) => ({ type: "npc.seed", ...card })),
  ];
  if (commands.length === 0) return world;
  const parsed = commands.map((raw) => {
    const result = registry.parseInternal(raw);
    if (!result.ok) throw new Error(`开局内容不合格：${result.error}`);
    return result.command;
  });
  const applied = registry.applyCommands(world, parsed, { rng: setupRng });
  for (const { command, result } of applied.results) {
    if (!result.ok) throw new Error(`开局的 ${command.type} 没有生效：${result.reason}`);
  }
  return applied.world;
}

function turnInput(raw: unknown): TurnInput {
  const parsed = TurnInputSchema.safeParse(raw);
  return parsed.success ? parsed.data : { text: String(raw) };
}

/** 最近一轮留给玩家的选项和待确认的检定；成功率按当前属性现算 */
function projectOffers(world: WorldState, records: readonly LogRecord[]) {
  const offers = currentOffers(records);
  const character = CharacterStateSchema.parse(world.slices.character);
  const checks = offers.checks.flatMap((offer) => {
    const prepared = prepareFor(world, offer.spec);
    if (!prepared.ok) return [];
    const { spec } = offer;
    const { check } = prepared;
    return [
      {
        id: offer.id,
        label: offer.label,
        attribute: spec.attribute,
        attributeLabel: ATTRIBUTE_LABELS[spec.attribute],
        attributeValue: check.attributeValue,
        tierLabel: OPPONENT_TIERS[spec.tier].label,
        /** 档位给的基础难度值；最终难度值 dv = 基础值 + 修正（封顶后）+ 难度模式 */
        baseDv: spec.dv,
        dv: check.dv,
        modeDv: check.modeDv,
        /** 检定值：属性 + 加成 − 减值（封顶后） */
        modifier: check.modifier,
        /** 逐条来源；raw 是封顶前的合计，和 total 不同时界面标“已封顶” */
        bonuses: check.bonus,
        penalties: check.penalty,
        dvMods: check.dvMods,
        capped:
          check.bonus.raw !== check.bonus.total ||
          check.penalty.raw !== check.penalty.total ||
          check.dvMods.raw !== check.dvMods.total,
        chance: check.chance,
        success: spec.success,
        failure: spec.failure,
        damage: spec.damage ?? null,
        rolled: offers.rolled?.offer.id === offer.id,
      },
    ];
  });
  const seq = offers.turn?.seq;
  return {
    read: offers.turn?.read ?? null,
    choices: offers.choices.map((choice, i) => ({
      text: choice.text,
      gate: choice.gate
        ? {
            ...choice.gate,
            attributeLabel: ATTRIBUTE_LABELS[choice.gate.attribute],
            met: character.attributes[choice.gate.attribute] >= choice.gate.value,
          }
        : null,
      checkId: choice.check && seq !== undefined ? `${seq}.${i + 1}` : null,
    })),
    checks,
    /** 已经掷过骰的检定 id；这时只能确认它 */
    rolled: offers.rolled?.offer.id ?? null,
  };
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
  const character = CharacterStateSchema.parse(world.slices.character);
  const npcs = NpcStateSchema.parse(world.slices.npc);
  const stage = { location: clock.location, sceneStartedAt: clock.sceneStartedAt };
  const period = periodOf(world.time);
  const humanityLevel = humanityStage(humanity.current);
  const turns = effectiveTurns(records);
  const active = combat.active;

  return {
    version: logVersion(records),
    difficulty: dice.mode,
    character: {
      name: character.name,
      brief: character.brief,
      attributes: character.attributes,
      streetCred: character.streetCred,
    },
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
      stage: humanityLevel,
      stageLabel: STAGE_LABELS[humanityLevel],
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
    /** 见过的人；诉求、底线和秘密只给模型看，不在这里 */
    npcs: Object.values(npcs.npcs)
      .filter((n) => n.met)
      .sort((a, b) => (b.lastSeenAt ?? -1) - (a.lastSeenAt ?? -1))
      .map((n) => ({
        id: n.id,
        name: n.name,
        alias: n.alias ?? null,
        pronoun: n.pronoun,
        role: n.role,
        look: n.look,
        affinity: n.affinity,
        alive: n.alive,
        here: onStage(n, stage),
        memories: n.memories,
      })),
    deadlines: clock.deadlines
      .filter((d) => d.handledAt === null)
      .map((d) => ({
        id: d.id,
        label: d.label,
        due: formatGameTime(d.due),
        overdue: d.due <= world.time,
      })),
    offers: projectOffers(world, records),
    totalTurns: turns.length,
    turns: turns.slice(-VIEW_TURNS).map((t) => ({
      seq: t.seq,
      at: t.at,
      input: turnInput(t.input),
      text: t.text,
      dice: t.dice,
      /** 被丢弃的指令条数；大于 0 时界面提示“本轮有数值没结算” */
      dropped: t.dropped.length,
    })),
  };
}

export type PlayerView = ReturnType<typeof projectState>;
