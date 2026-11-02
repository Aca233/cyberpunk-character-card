import type { Draft } from "immer";
import type { Rng } from "../../kernel/ports";
import type { ApplyOutcome, Command, SystemContext } from "../../kernel/system";
import { checkFact, type DiceState, isSuccess, OPPONENT_TIERS } from "../dice";
import type { HealthState } from "../health";
import type { HumanityState } from "../humanity";
import { type ItemDef, itemCatalog } from "../inventory";
import type { NpcState } from "../npc";
import {
  type ActiveFoe,
  ARCHETYPE_INTENTS,
  BRACE_AT,
  type CombatCommand,
  type CombatInternal,
  type CombatState,
  FOE_STATE_LABELS,
  HABIT_DECAY,
  INTENTS,
  LOOT_EXTRA_KINDS,
  LOOT_RARITY,
  LOOT_WEAPONS,
  MAX_ROUNDS,
  OVERCLOCK_COST,
  OVERCLOCK_STEP,
  TACTIC_LABELS,
  TAKEOVER_BELOW,
  TAKEOVER_PERCENT_PER_POINT,
  type Tactic,
  TacticSchema,
} from "./schema";

type CombatPay = Extract<CombatInternal, { type: "combat.pay" }>;

type Combat = Draft<CombatState>;
type Outcome = "victory" | "defeat" | "retreat";

export const OUTCOME_LABELS: Readonly<Record<Outcome, string>> = {
  victory: "战斗胜利",
  defeat: "败局",
  retreat: "撤退成功",
};

const fail = (reason: string): ApplyOutcome => ({ ok: false, reason });
const standing = (f: { state: string }) => f.state === "up" || f.state === "hurt";

/** 按路数抽一轮的打算；重复的权重高 */
export function drawIntent(foe: Pick<ActiveFoe, "archetype">, rng: Rng) {
  const pool = ARCHETYPE_INTENTS[foe.archetype];
  return pool[rng.roll(pool.length) - 1] ?? pool[0] ?? "shoot";
}

/** 用得最多、到了门槛的打法：下一伙敌人防着它；没有是 null */
export function bracedTactic(habits: Readonly<Partial<Record<Tactic, number>>>): Tactic | null {
  let best: Tactic | null = null;
  for (const t of TacticSchema.options) {
    const n = habits[t] ?? 0;
    if (n >= BRACE_AT && (best === null || n > (habits[best] ?? 0))) best = t;
  }
  return best;
}

/** 开打时按路数和档位抽敌人身上带的：一把武器，一半机会再带一件治疗品或手雷；不朽的不掉 */
export function drawLoot(
  foe: Pick<ActiveFoe, "archetype" | "tier">,
  data: Readonly<Record<string, unknown>>,
  rng: Rng,
): string[] {
  if (data.items === undefined) return [];
  const all = [...itemCatalog(data).values()].filter((d) => !d.iconic);
  const rarities: readonly string[] = LOOT_RARITY[foe.tier];
  const pick = (fits: (d: ItemDef) => boolean): string[] => {
    let pool = all.filter((d) => fits(d) && rarities.includes(d.rarity ?? "common"));
    if (pool.length === 0) pool = all.filter((d) => fits(d) && (d.rarity ?? "common") === "common");
    // 骰子至少两面：只剩一件就直接给，不掷
    const got = pool.length > 1 ? pool[rng.roll(pool.length) - 1] : pool[0];
    return got ? [got.id] : [];
  };
  const weapons: readonly string[] = LOOT_WEAPONS[foe.archetype];
  const carry = pick((d) => d.kind === "weapon" && weapons.includes(d.category ?? ""));
  if (rng.roll(2) === 2) carry.push(...pick((d) => LOOT_EXTRA_KINDS.includes(d.kind)));
  return carry;
}

export function startCombat(
  draft: Combat,
  command: CombatCommand,
  ctx: SystemContext,
): ApplyOutcome {
  if (draft.active) return fail("已经在战斗中");
  const { objective, defeat } = command;
  if (objective === undefined || defeat === undefined) return fail("开打要写 objective 和 defeat");
  const cards = ctx.read<NpcState>("npc").npcs;
  const braced = bracedTactic(draft.habits);
  const foes: ActiveFoe[] = [];
  for (const [i, f] of (command.foes ?? []).entries()) {
    const card = f.npc === undefined ? undefined : cards[f.npc];
    if (f.npc !== undefined && !card) return fail(`没有 ${f.npc} 的人物卡；杂兵不写 npc`);
    if (card && !card.alive) return fail(`${card.name}已经死了`);
    const id = f.npc ?? `foe${i + 1}`;
    if (foes.some((x) => x.id === id)) return fail(`${f.name}写了两次`);
    const foe: ActiveFoe = {
      id,
      name: card?.name ?? f.name,
      npc: f.npc ?? null,
      archetype: f.archetype,
      tier: f.tier,
      state: "up",
      intent: null,
      known: false,
      fooled: false,
      braced,
      carry: [],
    };
    foe.intent = drawIntent(foe, ctx.rng);
    foe.carry = drawLoot(foe, ctx.data, ctx.rng);
    foes.push(foe);
  }
  if (foes.length === 0) return fail("开打要写 foes");
  draft.active = {
    startedAt: ctx.now,
    round: 1,
    objective,
    defeat,
    foes,
    pending: [],
    overclocked: false,
    overclocks: 0,
    takeoverRound: null,
  };
  const named = foes.map((f) => `${f.name}（${OPPONENT_TIERS[f.tier].label}）`);
  return {
    ok: true,
    notes: [
      `战斗开始：目标 ${objective}；败局 ${defeat}`,
      `敌人：${named.join("、")}；他们这一轮的打算还盖着`,
      ...(braced ? [`这伙人防着你的${TACTIC_LABELS[braced]}：你用得太多了`] : []),
    ],
  };
}

/** 这一轮的检定没掷或成功了；超频时算成功 */
function landed(draft: Combat, ctx: SystemContext): boolean {
  if (draft.active?.overclocked) return true;
  const fact = checkFact(ctx.facts);
  return fact === undefined || isSuccess(fact.outcome);
}

function foeOf(draft: Combat, target: string | undefined) {
  return draft.active?.foes.find((f) => f.id === target || f.npc === target);
}

/** 玩家这一轮的打法：记进习惯；对上了 target 的打算、他又没防着这一手，就拦下 */
export function act(draft: Combat, command: CombatCommand, ctx: SystemContext): ApplyOutcome {
  const active = draft.active;
  const tactic = command.tactic;
  if (!active) return fail("不在战斗中");
  if (tactic === undefined) return fail("act 要写 tactic");
  draft.habits[tactic] = (draft.habits[tactic] ?? 0) + 1;
  const foe = foeOf(draft, command.target);
  if (!foe || !standing(foe) || foe.intent === null) return { ok: true, notes: [] };
  const intent = INTENTS[foe.intent];
  if (!intent.counters.includes(tactic)) return { ok: true, notes: [] };
  if (foe.braced === tactic && !active.overclocked) {
    return {
      ok: true,
      notes: [`${foe.name}防着你的${TACTIC_LABELS[tactic]}，没拦住他${intent.label}`],
    };
  }
  if (!landed(draft, ctx)) return { ok: true, notes: [`没拦住${foe.name}${intent.label}`] };
  foe.fooled = true;
  return { ok: true, notes: [`拦下了${foe.name}：他这一轮${intent.label}落空`] };
}

export function reveal(draft: Combat, target: string | undefined): ApplyOutcome {
  const foe = foeOf(draft, target);
  if (!foe) return fail(`战斗里没有 ${target}`);
  if (foe.intent === null || foe.known) return { ok: true, notes: [] };
  foe.known = true;
  return { ok: true, notes: [`看穿了${foe.name}：这一轮要${INTENTS[foe.intent].label}`] };
}

export function fool(draft: Combat, target: string | undefined, ctx: SystemContext): ApplyOutcome {
  const foe = foeOf(draft, target);
  if (!foe || !standing(foe)) return fail(`战斗里没有还能打的 ${target}`);
  if (!landed(draft, ctx)) return fail("检定没成，骗不过他");
  foe.fooled = true;
  return { ok: true, notes: [`骗过了${foe.name}：他这一轮扑了个空`] };
}

export function setFoe(draft: Combat, command: CombatCommand): ApplyOutcome {
  const foe = foeOf(draft, command.target);
  if (!foe || command.state === undefined) return fail(`战斗里没有 ${command.target}`);
  if (foe.state === command.state) return { ok: true, notes: [] };
  foe.state = command.state;
  if (!standing(foe)) foe.intent = null;
  const down = command.state === "down" ? "：杀、放还是抓，由玩家决定" : "";
  return { ok: true, notes: [`${foe.name}${FOE_STATE_LABELS[command.state]}${down}`] };
}

function finish(
  draft: Combat,
  outcome: Outcome,
  notes: string[],
  emit: Command[],
  now: number,
): ApplyOutcome {
  const active = draft.active;
  const foes = (active?.foes ?? []).flatMap((f) =>
    f.npc === null ? [] : [{ npc: f.npc, name: f.name, state: f.state }],
  );
  // 倒下的人身上剩的东西留在原地，打完还能搜；跑了的带走了
  const loot = (active?.foes ?? []).flatMap((f) =>
    f.state === "down" && f.carry.length > 0
      ? [{ from: f.id, name: f.name, items: [...f.carry] }]
      : [],
  );
  draft.last = { outcome, endedAt: now, foes, loot };
  draft.active = null;
  for (const t of TacticSchema.options) draft.habits[t] = (draft.habits[t] ?? 0) * HABIT_DECAY;
  notes.push(
    outcome === "defeat"
      ? `${OUTCOME_LABELS.defeat}：${active?.defeat ?? ""}`
      : OUTCOME_LABELS[outcome],
  );
  emit.push({ type: "inventory.recharge" });
  return { ok: true, notes, emit, signals: ["combat.end"] };
}

/** 一轮打完：没落空的打算打中你（记进 pending 等你挑拿什么抵）、想跑的跑掉，再抽下一轮 */
export function endRound(draft: Combat, ctx: SystemContext): ApplyOutcome {
  const active = draft.active;
  if (!active) return { ok: true, notes: [] };
  const notes: string[] = [];
  const emit: Command[] = [];
  for (const foe of active.foes) {
    if (!standing(foe) || foe.intent === null || foe.fooled) continue;
    const def = INTENTS[foe.intent];
    if (def.hit) {
      active.pending.push({ from: foe.id, name: foe.name, intent: foe.intent, tier: def.hit });
      notes.push(`${foe.name}${def.label}，打中了你：要拿身体的一部分去抵`);
    } else if (foe.intent === "flee") {
      foe.state = "fled";
      notes.push(`${foe.name}跑了，带着他看到的你的打法`);
    } else notes.push(`${foe.name}${def.label}得手了`);
  }
  // 倒下、死了按败局；濒死这一轮没人救回来：街头传说有人拖你出去，其他难度死亡
  const health = ctx.read<HealthState>("health");
  if (health.condition === "dying") {
    if (ctx.read<DiceState>("dice").mode === "streetLegend") {
      emit.push({ type: "health.revive" });
      notes.push("街头传说：有人把你拖了出来；代价在正文里写（欧元、人性或关系）");
    } else emit.push({ type: "health.die", reason: "濒死时没人救治" });
    return finish(draft, "defeat", notes, emit, ctx.now);
  }
  if (health.condition !== "up") return finish(draft, "defeat", notes, emit, ctx.now);
  if (!active.foes.some(standing)) return finish(draft, "victory", notes, emit, ctx.now);
  if (active.round >= MAX_ROUNDS) return finish(draft, "defeat", notes, emit, ctx.now);
  active.round += 1;
  active.overclocked = false;
  for (const foe of active.foes) {
    foe.known = false;
    foe.fooled = false;
    foe.intent = standing(foe) ? drawIntent(foe, ctx.rng) : null;
  }
  // 人性太低：每低于门槛一点多几分机会，下一轮你的手自己动；连着两轮不接管
  const humanity = ctx.read<HumanityState>("humanity").current;
  const chance = (TAKEOVER_BELOW - humanity) * TAKEOVER_PERCENT_PER_POINT;
  if (chance > 0 && active.takeoverRound !== active.round - 1 && ctx.rng.roll(100) <= chance) {
    active.takeoverRound = active.round;
    notes.push("这一轮你的手自己动了：代码替你出手，对离你最近的人下死手");
  }
  return { ok: true, notes, emit, signals: ["combat.next"] };
}

/** 从倒下的人身上捡一件，不占这一轮出手；打完了从剩下的里捡。捡到的直接进物品栏 */
export function loot(draft: Combat, command: CombatCommand): ApplyOutcome {
  const { target, item } = command;
  if (target === undefined || item === undefined) return fail("loot 要写 target 和 item");
  let bag: string[];
  let name: string;
  if (draft.active) {
    const foe = foeOf(draft, target);
    if (!foe) return fail(`战斗里没有 ${target}`);
    if (foe.state === "fled") return fail(`${foe.name}跑了，东西也带走了`);
    if (foe.state !== "down") return fail(`${foe.name}还站着，捡不了他身上的东西`);
    bag = foe.carry;
    name = foe.name;
  } else {
    const left = draft.last?.loot.find((l) => l.from === target || l.name === target);
    if (!left) return fail(`${target}身上没有剩下的东西`);
    bag = left.items;
    name = left.name;
  }
  const i = bag.indexOf(item);
  if (i < 0) return fail(`${name}身上没有 ${item}`);
  bag.splice(i, 1);
  return {
    ok: true,
    notes: [],
    emit: [{ type: "item", action: "gain", id: item, reason: `从${name}身上捡的` }],
  };
}

/** 玩家挑了拿什么抵最早那一下：交给 health 记（打坏义体、断肢或扣血） */
export function pay(draft: Combat, command: CombatPay): ApplyOutcome {
  const hit = draft.active?.pending.shift();
  if (!hit) return fail("没有要抵的伤");
  const reason = `${hit.name}${INTENTS[hit.intent].label}`;
  return {
    ok: true,
    notes: [],
    emit: [
      {
        type: "health.hit",
        tier: hit.tier,
        pay: command.pay,
        ...(command.chrome ? { chrome: command.chrome } : {}),
        ...(command.limb ? { limb: command.limb } : {}),
        reason,
      },
    ],
  };
}

/** 超频：这一轮必中、拦得住防着你的人；人性代价同一仗里越超越贵 */
export function overclock(draft: Combat): ApplyOutcome {
  const active = draft.active;
  if (!active) return fail("不在战斗中，不能超频");
  if (active.overclocked) return { ok: true, notes: [] };
  const cost = OVERCLOCK_COST + active.overclocks * OVERCLOCK_STEP;
  active.overclocked = true;
  active.overclocks += 1;
  return {
    ok: true,
    notes: [`超频义体：这一轮必中，人性 −${cost}`],
    emit: [{ type: "humanity", delta: -cost, reason: "战斗中超频义体" }],
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
    case "act":
      return act(draft, command, ctx);
    case "reveal":
      return reveal(draft, command.target);
    case "fool":
      return fool(draft, command.target, ctx);
    case "foe":
      return setFoe(draft, command);
    case "loot":
      return loot(draft, command);
    case "retreat":
      return draft.active ? finish(draft, "retreat", [], [], ctx.now) : fail("不在战斗中");
    case "pay":
      // 玩家在输入里说了拿什么抵：和点按钮走同一条路，由 health 校验义体、胳膊腿还在不在
      return command.pay === undefined
        ? fail("pay 要写拿什么抵：chrome、limb 或 flesh")
        : pay(draft, {
            type: "combat.pay",
            pay: command.pay,
            ...(command.chrome ? { chrome: command.chrome } : {}),
            ...(command.limb ? { limb: command.limb } : {}),
          });
    case "end":
      return draft.active
        ? finish(draft, command.outcome ?? "victory", [], [], ctx.now)
        : fail("不在战斗中");
  }
}
