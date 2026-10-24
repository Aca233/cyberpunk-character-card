import type { Draft } from "immer";
import type { ApplyOutcome, Command, SystemContext } from "../../kernel/system";
import { type DiceState, OPPONENT_TIERS } from "../dice";
import type { HealthState } from "../health";
import type { NpcState } from "../npc";
import {
  type ActiveCombat,
  type ActiveFoe,
  type CombatCommand,
  type CombatOutcome,
  type CombatState,
  EDGE_LABELS,
  FOE_STATE_LABELS,
} from "./schema";

type Combat = Draft<CombatState>;

export const OUTCOME_LABELS: Readonly<Record<CombatOutcome, string>> = {
  victory: "战斗胜利",
  defeat: "败局",
  retreat: "撤退成功",
};

const fail = (reason: string): ApplyOutcome => ({ ok: false, reason });

export function startCombat(
  draft: Combat,
  command: CombatCommand,
  ctx: SystemContext,
): ApplyOutcome {
  if (draft.active) return fail("已经在战斗中");
  const { moments, objective, defeat } = command;
  const enemies = command.enemies ?? [];
  if (moments === undefined || objective === undefined || defeat === undefined) {
    return fail("开战要写 moments、objective 和 defeat");
  }
  if (enemies.length === 0 && (command.foes ?? []).length === 0) {
    return fail("开战要写 enemies 或 foes");
  }
  const cards = ctx.read<NpcState>("npc").npcs;
  const foes: ActiveFoe[] = [];
  for (const f of command.foes ?? []) {
    const card = cards[f.npc];
    if (!card) return fail(`没有 ${f.npc} 的人物卡；有卡敌人要先建卡，杂兵写进 enemies`);
    if (!card.alive) return fail(`${card.name}已经死了`);
    if (foes.some((x) => x.npc === f.npc)) return fail(`${card.name}写了两次`);
    foes.push({ npc: f.npc, name: card.name, tier: f.tier, state: "up", scanned: false });
  }
  // 对峙谈崩：时间到了还没人让步，对方先动手
  const standoff = draft.standoff;
  const edge = command.edge ?? (standoff && standoff.left === 0 ? "enemy" : null);
  draft.standoff = null;
  draft.active = {
    startedAt: ctx.now,
    moments,
    current: 0,
    objective,
    defeat,
    enemies,
    foes,
    quick: 0,
    dyingUntil: null,
    edge,
  };
  const named = foes.map((f) => `${f.name}（${OPPONENT_TIERS[f.tier].label}）`);
  return {
    ok: true,
    notes: [
      ...(standoff ? [`和${standoff.opponent}的对峙谈崩了`] : []),
      `战斗开始：分 ${moments} 段；目标：${objective}；败局：${defeat}`,
      ...(edge ? [`第一段${EDGE_LABELS[edge]}`] : []),
      ...(named.length > 0 ? [`有卡敌人：${named.join("、")}`] : []),
    ],
  };
}

/** 玩家扫描了有卡敌人：之后界面显示他的情况 */
export function scanFoe(draft: Combat, target: string | undefined): ApplyOutcome {
  const foe = (draft.active?.foes ?? []).find((f) => f.npc === target);
  if (!draft.active) return fail("不在战斗中");
  if (!foe) return fail(`战斗里没有有卡敌人 ${target}`);
  if (foe.scanned) return { ok: true, notes: [] };
  foe.scanned = true;
  return {
    ok: true,
    notes: [`扫描了${foe.name}：${OPPONENT_TIERS[foe.tier].label}，${FOE_STATE_LABELS[foe.state]}`],
  };
}

/** 有卡敌人的情况变了：由叙事模型按正文写，代码只记下来给界面看 */
export function setFoe(
  draft: Combat,
  target: string | undefined,
  state: CombatCommand["state"],
): ApplyOutcome {
  if (!draft.active) return fail("不在战斗中");
  if (target === undefined || state === undefined) return fail("foe 要写 target 和 state");
  const foe = draft.active.foes.find((f) => f.npc === target);
  if (!foe) return fail(`战斗里没有有卡敌人 ${target}`);
  if (foe.state === state) return { ok: true, notes: [] };
  foe.state = state;
  return {
    ok: true,
    notes: [
      state === "down"
        ? `${foe.name}倒下了：杀、放还是抓，由玩家决定`
        : `${foe.name}${FOE_STATE_LABELS[state]}`,
    ],
  };
}

function finish(
  draft: Combat,
  outcome: CombatOutcome,
  notes: string[],
  emit: Command[],
  now: number,
): ApplyOutcome {
  const defeat = draft.active?.defeat ?? null;
  draft.last = { outcome, defeat: outcome === "defeat" ? defeat : null, endedAt: now };
  draft.active = null;
  notes.push(
    outcome === "defeat" ? `${OUTCOME_LABELS.defeat}：${defeat}` : OUTCOME_LABELS[outcome],
  );
  emit.push({ type: "inventory.recharge" });
  return { ok: true, notes, emit, signals: ["combat.end"] };
}

/** 一段打完时看玩家的伤势：濒死开始倒数，过了期限没人救就死；返回 true 时战斗按败局结束 */
function checkHealth(
  active: Draft<ActiveCombat>,
  ctx: SystemContext,
  notes: string[],
  emit: Command[],
  last: boolean,
): boolean {
  const index = active.current;
  const health = ctx.read<HealthState>("health");
  if (health.condition === "dying") {
    if (active.dyingUntil === null) {
      active.dyingUntil = index + 1;
      notes.push(
        last ? "濒死：撑到这一轮结束，需要有人救治" : "濒死：撑到下一段结束，需要有人救治",
      );
      return false;
    }
    if (active.dyingUntil > index) return false;
    if (ctx.read<DiceState>("dice").mode === "streetLegend") {
      emit.push({ type: "health.revive" });
      notes.push("街头传说：总有一条退路，有人把你拖了出来；代价在正文里写（欧元、人性或关系）");
    } else {
      emit.push({ type: "health.die", reason: "濒死期间没人救治" });
    }
    return true;
  }
  active.dyingUntil = null;
  if (health.condition === "down") {
    notes.push("倒下了，战斗按败局结束");
    return true;
  }
  return health.condition === "dead";
}

/** 这一段打完，进下一段；最后一段打完用 end 写结局 */
export function nextSegment(draft: Combat, ctx: SystemContext): ApplyOutcome {
  const active = draft.active;
  if (!active) return fail("不在战斗中");
  const index = active.current;
  if (index + 1 >= active.moments) {
    return fail(`已经是最后一段（共 ${active.moments} 段），用 combat end 写结局`);
  }
  const notes = [`第 ${index + 1}/${active.moments} 段打完`];
  const emit: Command[] = [];
  if (checkHealth(active, ctx, notes, emit, false)) {
    return finish(draft, "defeat", notes, emit, ctx.now);
  }
  active.current = index + 1;
  active.quick = 0;
  return { ok: true, notes, emit };
}

/** 收场：end 写赢了还是输了，retreat 是撤退成功；玩家倒下或死了一律按败局 */
export function endCombat(
  draft: Combat,
  ctx: SystemContext,
  outcome: CombatOutcome | undefined,
): ApplyOutcome {
  const active = draft.active;
  if (!active) return fail("不在战斗中");
  if (outcome === undefined) return fail("结束要写 outcome：victory 或 defeat");
  const notes: string[] = [];
  const emit: Command[] = [];
  const lost = checkHealth(active, ctx, notes, emit, true);
  return finish(draft, lost ? "defeat" : outcome, notes, emit, ctx.now);
}

/** 快捷栏扣了一次（治疗品、手雷）：战斗中记一个快捷动作；上限由回合流程在结算前拦 */
export function countQuick(draft: Combat): void {
  if (draft.active) draft.active.quick = (draft.active.quick ?? 0) + 1;
}

/** 开一场对峙：战斗中不能开 */
export function startStandoff(draft: Combat, command: CombatCommand, now: number): ApplyOutcome {
  if (draft.active) return fail("已经在战斗中，不能再开对峙");
  if (draft.standoff) return fail(`已经在和${draft.standoff.opponent}对峙`);
  const { opponent, rounds } = command;
  if (opponent === undefined || rounds === undefined) return fail("对峙要写 opponent 和 rounds");
  draft.standoff = { startedAt: now, opponent, rounds, left: rounds };
  return {
    ok: true,
    notes: [`对峙开始：和${opponent}，最多 ${rounds} 轮，时间到了对方先动手`],
  };
}

/** 对峙化解：说中诉求、亮出筹码或镇定门槛达标，这场仗不打了 */
export function defuseStandoff(draft: Combat): ApplyOutcome {
  const standoff = draft.standoff;
  if (!standoff) return fail("没有在对峙");
  draft.standoff = null;
  return { ok: true, notes: [`对峙化解：和${standoff.opponent}没打起来`] };
}

/** 每轮结束倒数一次；这一轮已经化解或开打时什么也不做 */
export function tickStandoff(draft: Combat): ApplyOutcome {
  const standoff = draft.standoff;
  if (!standoff || draft.active || standoff.left === 0) return { ok: true, notes: [] };
  standoff.left -= 1;
  return {
    ok: true,
    notes: [
      standoff.left === 0
        ? `和${standoff.opponent}的对峙到时间了：下一轮对方先动手`
        : `对峙还剩 ${standoff.left} 轮`,
    ],
  };
}

export function applyCombat(
  draft: Combat,
  command: CombatCommand,
  ctx: SystemContext,
): ApplyOutcome {
  switch (command.action) {
    case "start":
      return startCombat(draft, command, ctx);
    case "next":
      return nextSegment(draft, ctx);
    case "retreat":
      return endCombat(draft, ctx, "retreat");
    case "end":
      return endCombat(draft, ctx, command.outcome);
    case "foe":
      return setFoe(draft, command.target, command.state);
    case "scan":
      return scanFoe(draft, command.target);
    case "standoff":
      return startStandoff(draft, command, ctx.now);
    case "defuse":
      return defuseStandoff(draft);
  }
}
