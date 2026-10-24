import type { Draft } from "immer";
import type { ApplyOutcome, Command, SystemContext } from "../../kernel/system";
import { checkFact, type DiceState, isSuccess } from "../dice";
import type { HealthState } from "../health";
import {
  type CombatCommand,
  type CombatOutcome,
  type CombatState,
  DirectFactSchema,
  type MomentResult,
} from "./schema";

type Combat = Draft<CombatState>;

export const RESULT_LABELS: Readonly<Record<MomentResult, string>> = {
  win: "胜",
  lose: "负",
  draw: "平",
};

export const OUTCOME_LABELS: Readonly<Record<CombatOutcome, string>> = {
  victory: "战斗胜利",
  defeat: "败局",
  retreat: "撤退成功",
};

const fail = (reason: string): ApplyOutcome => ({ ok: false, reason });

/** 这次检定能不能用来结算交锋：每次交锋玩家方最多掷一次 */
export function canRollThisMoment(state: CombatState, checkId: string): boolean {
  return state.active !== null && !state.usedChecks.includes(checkId);
}

export function startCombat(draft: Combat, command: CombatCommand, now: number): ApplyOutcome {
  if (draft.active) return fail("已经在战斗中");
  const { moments, defeat, enemies } = command;
  if (moments === undefined || defeat === undefined || enemies === undefined) {
    return fail("开战要写 moments、defeat 和 enemies");
  }
  draft.active = {
    startedAt: now,
    moments,
    current: 0,
    defeat,
    enemies,
    results: [],
    dyingUntil: null,
  };
  draft.usedChecks = [];
  return { ok: true, notes: [`战斗开始：${moments} 次交锋；败局：${defeat}`] };
}

/** 交锋胜负由代码判定：掷骰看成败，没掷骰但直接成功算胜，都没有算平 */
function momentResult(
  draft: Combat,
  facts: SystemContext["facts"],
): { readonly result: MomentResult; readonly checkId?: string } | string {
  const fact = checkFact(facts);
  if (fact) {
    if (draft.usedChecks.includes(fact.id)) return "这次检定已经算过一次交锋";
    return { result: isSuccess(fact.outcome) ? "win" : "lose", checkId: fact.id };
  }
  const direct = DirectFactSchema.safeParse(facts.direct);
  if (!direct.success) throw new Error("本轮的 direct 应为布尔值");
  return { result: direct.data === true ? "win" : "draw" };
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

/** 结算当前交锋；retreat 时这次交锋的主行动是撤退 */
export function resolveMoment(draft: Combat, ctx: SystemContext, retreat: boolean): ApplyOutcome {
  const active = draft.active;
  if (!active) return fail("不在战斗中");
  const r = momentResult(draft, ctx.facts);
  if (typeof r === "string") return fail(r);
  if (retreat && r.result === "draw") return fail("撤退是主行动，要有检定结果或直接成功");
  if (r.checkId !== undefined) draft.usedChecks.push(r.checkId);

  const index = active.current;
  active.results.push(r.result);
  const notes = [`交锋 ${index + 1} / ${active.moments}：${RESULT_LABELS[r.result]}`];
  const emit: Command[] = [];
  const isLast = index + 1 >= active.moments;

  const health = ctx.read<HealthState>("health");
  if (health.condition === "dying") {
    if (active.dyingUntil === null) {
      active.dyingUntil = index + 1;
      notes.push(
        isLast ? "濒死：撑到这一轮结束，需要有人救治" : "濒死：撑到下一次交锋结束，需要有人救治",
      );
    } else if (active.dyingUntil <= index) {
      if (ctx.read<DiceState>("dice").mode === "streetLegend") {
        emit.push({ type: "health.revive" });
        notes.push("街头传说：总有一条退路，有人把你拖了出来；代价在戏里写（欧元、人性或关系）");
        return finish(draft, "defeat", notes, emit, ctx.now);
      }
      emit.push({ type: "health.die", reason: "濒死期间没人救治" });
      return finish(draft, "defeat", notes, emit, ctx.now);
    }
  } else {
    active.dyingUntil = null;
  }
  if (health.condition === "down") {
    notes.push("倒下了，战斗按败局结束");
    return finish(draft, "defeat", notes, emit, ctx.now);
  }
  if (health.condition === "dead") return finish(draft, "defeat", notes, emit, ctx.now);

  if (retreat && r.result === "win") return finish(draft, "retreat", notes, emit, ctx.now);
  if (isLast) return finish(draft, r.result === "win" ? "victory" : "defeat", notes, emit, ctx.now);
  active.current = index + 1;
  return { ok: true, notes, emit };
}

/** 上一次交锋获胜、敌人已经打垮时可以提前结束 */
export function endCombat(draft: Combat, now: number): ApplyOutcome {
  const active = draft.active;
  if (!active) return fail("不在战斗中");
  if (active.results.at(-1) !== "win") return fail("只有上一次交锋获胜时才能提前结束");
  return finish(draft, "victory", [], [], now);
}

export function applyCombat(
  draft: Combat,
  command: CombatCommand,
  ctx: SystemContext,
): ApplyOutcome {
  switch (command.action) {
    case "start":
      return startCombat(draft, command, ctx.now);
    case "next":
      return resolveMoment(draft, ctx, false);
    case "retreat":
      return resolveMoment(draft, ctx, true);
    case "end":
      return endCombat(draft, ctx.now);
  }
}
