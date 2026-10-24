import type { Draft } from "immer";
import type { ApplyOutcome, Command, SystemContext } from "../../kernel/system";
import { checkFact, type DiceState, isSuccess, OPPONENT_TIERS } from "../dice";
import type { HealthState } from "../health";
import type { NpcState } from "../npc";
import {
  type ActiveFoe,
  type CombatCommand,
  type CombatOutcome,
  type CombatState,
  DirectFactSchema,
  FOE_HITS,
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

export function startCombat(
  draft: Combat,
  command: CombatCommand,
  ctx: SystemContext,
): ApplyOutcome {
  if (draft.active) return fail("已经在战斗中");
  const { moments, defeat } = command;
  const enemies = command.enemies ?? [];
  if (moments === undefined || defeat === undefined) return fail("开战要写 moments 和 defeat");
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
    foes.push({
      npc: f.npc,
      name: card.name,
      tier: f.tier,
      need: FOE_HITS[f.tier] + (f.armor ? 1 : 0),
      hits: 0,
      rolled: false,
      scanned: false,
    });
  }
  draft.active = {
    startedAt: ctx.now,
    moments,
    current: 0,
    defeat,
    enemies,
    foes,
    quick: 0,
    results: [],
    dyingUntil: null,
  };
  draft.usedChecks = [];
  const named = foes.map(
    (f) => `${f.name}（${OPPONENT_TIERS[f.tier].label}，${f.need} 次成功打到濒死）`,
  );
  return {
    ok: true,
    notes: [
      `战斗开始：${moments} 次交锋；败局：${defeat}`,
      ...(named.length > 0 ? [`有卡敌人：${named.join("、")}`] : []),
    ],
  };
}

/** 主行动打中有卡敌人：掷骰成功 1 次、大成功 2 次、直接成功 1 次；传奇档至少要掷一次骰才拿得下 */
function hitFoe(foe: Draft<ActiveFoe>, facts: SystemContext["facts"]): string {
  const fact = checkFact(facts);
  const rolled = fact !== undefined;
  const gain = fact?.outcome === "critical" ? 2 : 1;
  let hits = Math.min(foe.need, foe.hits + gain);
  const notes: string[] = [];
  if (hits >= foe.need && foe.tier === "legend" && !foe.rolled && !rolled) {
    hits = foe.need - 1;
    notes.push("传奇档对手至少要掷一次骰才拿得下");
  }
  if (rolled) foe.rolled = true;
  foe.hits = hits;
  if (hits >= foe.need) return `${foe.name}被打到濒死：杀、放还是抓，由玩家决定`;
  return [`${foe.name}挨了${gain === 2 ? "重重的" : ""}一下（${hits}/${foe.need}）`, ...notes].join(
    "；",
  );
}

/** 玩家扫描了有卡敌人：之后界面显示他的血条 */
export function scanFoe(draft: Combat, target: string | undefined): ApplyOutcome {
  const foe = (draft.active?.foes ?? []).find((f) => f.npc === target);
  if (!draft.active) return fail("不在战斗中");
  if (!foe) return fail(`战斗里没有有卡敌人 ${target}`);
  if (foe.scanned) return { ok: true, notes: [] };
  foe.scanned = true;
  return {
    ok: true,
    notes: [`扫描了${foe.name}：要 ${foe.need} 次成功打到濒死，已中 ${foe.hits} 次`],
  };
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
export function resolveMoment(
  draft: Combat,
  ctx: SystemContext,
  retreat: boolean,
  target?: string,
): ApplyOutcome {
  const active = draft.active;
  if (!active) return fail("不在战斗中");
  const foe = target === undefined ? undefined : (active.foes ?? []).find((f) => f.npc === target);
  if (target !== undefined) {
    if (retreat) return fail("撤退不打人，不写 target");
    if (!foe) return fail(`战斗里没有有卡敌人 ${target}`);
    if (foe.hits >= foe.need) return fail(`${foe.name}已经被打到濒死`);
  }
  const r = momentResult(draft, ctx.facts);
  if (typeof r === "string") return fail(r);
  if (retreat && r.result === "draw") return fail("撤退是主行动，要有检定结果或直接成功");
  if (r.checkId !== undefined) draft.usedChecks.push(r.checkId);

  const index = active.current;
  active.results.push(r.result);
  const notes = [`交锋 ${index + 1} / ${active.moments}：${RESULT_LABELS[r.result]}`];
  if (foe && r.result === "win") notes.push(hitFoe(foe, ctx.facts));
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
  active.quick = 0;
  return { ok: true, notes, emit };
}

/** 上一次交锋获胜、敌人已经打垮时可以提前结束 */
/** 快捷栏扣了一次（治疗品、手雷）：战斗中记一个快捷动作；上限由主持流程在结算前拦 */
export function countQuick(draft: Combat): void {
  if (draft.active) draft.active.quick = (draft.active.quick ?? 0) + 1;
}

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
      return startCombat(draft, command, ctx);
    case "next":
      return resolveMoment(draft, ctx, false, command.target);
    case "retreat":
      return resolveMoment(draft, ctx, true, command.target);
    case "end":
      return endCombat(draft, ctx.now);
    case "scan":
      return scanFoe(draft, command.target);
  }
}
