import type { Draft } from "immer";
import type { ApplyOutcome, SystemContext, TimeSpan } from "../../kernel/system";
import { factionCatalog } from "./apply";
import {
  AGENDA_DERAIL,
  AGENDA_DUE_MAX,
  AGENDA_EVERY,
  AGENDA_MOVE_LABELS,
  AGENDA_MOVES_KEPT,
  AGENDA_OUTCOME_LABELS,
  AGENDA_STALL,
  AgendaCatalogSchema,
  type AgendaCommand,
  type AgendaDue,
  type AgendaMoveCommand,
  type AgendaMoveRecord,
  type AgendaOutcome,
  type AgendaProgress,
  type AgendaSeed,
  type AgendaTold,
  type FactionsState,
  type TurfChange,
} from "./schema";

type Data = Readonly<Record<string, unknown>>;

const catalogs = new WeakMap<object, ReadonlyMap<string, AgendaSeed>>();

/** 读取并校验势力动向的种子表；没有时是空表 */
export function agendaCatalog(data: Data): ReadonlyMap<string, AgendaSeed> {
  const raw = data.agendas;
  if (typeof raw !== "object" || raw === null) return new Map();
  const cached = catalogs.get(raw);
  if (cached) return cached;
  const catalog = new Map(AgendaCatalogSchema.parse(raw).map((a) => [a.id, a] as const));
  catalogs.set(raw, catalog);
  return catalog;
}

const EMPTY: AgendaProgress = { moves: [], holdUntil: null };

/** 一条动向走过的几步；没动过的是空的 */
export function progressOf(state: FactionsState, id: string): AgendaProgress {
  return state.agendas[id] ?? EMPTY;
}

/** 这个时刻能不能到点：没被拖住或搅黄，也没挂在到点队列里 */
export function agendaReady(state: FactionsState, id: string, at: number): boolean {
  const p = progressOf(state, id);
  if (p.holdUntil !== null && p.holdUntil > at) return false;
  return !state.due.some((d) => d.id === id);
}

const mix = (k: number, salt: number): number => Math.imul(k ^ salt, 2654435761) >>> 0;

/** 第 k 个到点挑哪一条：不用骰子，重放时结果不变 */
export function agendaPick(k: number, n: number): number {
  return mix(k, 0x5bd1e995) % n;
}

/** 代码掷的倾向：约五成成了、三成受挫、两成出岔子；只是倾向，场外推演可以按局面改 */
export function agendaRoll(k: number): AgendaOutcome {
  const r = mix(k, 0x27d4eb2f) % 10;
  return r < 5 ? "success" : r < 8 ? "setback" : "twist";
}

function slot(draft: Draft<FactionsState>, id: string): Draft<AgendaProgress> {
  const existing = draft.agendas[id];
  if (existing) return existing;
  draft.agendas[id] = { moves: [], holdUntil: null };
  return draft.agendas[id] as Draft<AgendaProgress>;
}

function queueDue(draft: Draft<FactionsState>, due: AgendaDue): void {
  draft.due = draft.due.filter((d) => d.id !== due.id);
  draft.due.push(due);
  while (draft.due.length > AGENDA_DUE_MAX) draft.due.shift();
}

function dropDue(draft: Draft<FactionsState>, id: string): void {
  draft.due = draft.due.filter((d) => d.id !== id);
}

function record(draft: Draft<FactionsState>, id: string, move: AgendaMoveRecord): void {
  const p = slot(draft, id);
  p.moves.push(move);
  if (p.moves.length > AGENDA_MOVES_KEPT) p.moves.splice(0, p.moves.length - AGENDA_MOVES_KEPT);
}

/** 时间推进：每过 AGENDA_EVERY 挑一条能到点的动向、掷一个倾向，挂进到点队列等场外推演写 */
export function tickAgendas(draft: Draft<FactionsState>, span: TimeSpan, data: Data): void {
  if (draft.agendaClock === null) draft.agendaClock = span.from;
  const first = Math.floor(draft.agendaClock / AGENDA_EVERY) + 1;
  const last = Math.floor(span.to / AGENDA_EVERY);
  draft.agendaClock = Math.max(draft.agendaClock, span.to);
  const seeds = [...agendaCatalog(data).keys()];
  if (seeds.length === 0) return;
  for (let k = Math.max(first, last - AGENDA_DUE_MAX + 1); k <= last; k++) {
    const at = k * AGENDA_EVERY;
    const ready = seeds.filter((id) => agendaReady(draft as FactionsState, id, at));
    if (ready.length === 0) continue;
    const id = ready[agendaPick(k, ready.length)] as string;
    queueDue(draft, { id, at, outcome: agendaRoll(k) });
  }
}

const fail = (reason: string): ApplyOutcome => ({ ok: false, reason });

export function agendaLabel(seed: AgendaSeed, data: Data): string {
  return `${factionCatalog(data).get(seed.faction)?.name ?? seed.faction}·${seed.title}`;
}

/** 玩家插手：push 让它马上到点并且得手，stall 拖住两轮，derail 搅黄、隔一周才换法子再来；插手过的玩家都知道 */
export function applyAgenda(
  draft: Draft<FactionsState>,
  command: AgendaCommand,
  ctx: SystemContext,
): ApplyOutcome {
  const seed = agendaCatalog(ctx.data).get(command.id);
  if (!seed) return fail(`没有 ${command.id} 这条势力动向`);
  const p = progressOf(draft as FactionsState, seed.id);
  const last = p.moves.at(-1);
  if (last && last.at === ctx.now && last.kind !== "move")
    return fail(`「${seed.title}」这一刻已经插过手了，一次只算一下`);
  if (command.move === "stall" && p.holdUntil !== null && p.holdUntil > ctx.now)
    return fail(`「${seed.title}」已经被拖住了`);
  if (command.move === "push") {
    slot(draft, seed.id).holdUntil = null;
    queueDue(draft, { id: seed.id, at: ctx.now, outcome: "success" });
  } else {
    dropDue(draft, seed.id);
    slot(draft, seed.id).holdUntil =
      ctx.now + (command.move === "stall" ? AGENDA_STALL : AGENDA_DERAIL);
  }
  record(draft, seed.id, {
    at: ctx.now,
    kind: command.move,
    outcome: null,
    title: AGENDA_MOVE_LABELS[command.move],
    text: command.reason,
    news: command.reason,
    turf: null,
    why: null,
    next: null,
    told: true,
  });
  return {
    ok: true,
    notes: [`${agendaLabel(seed, ctx.data)}：${AGENDA_MOVE_LABELS[command.move]}`],
  };
}

/** 动向里的事传到玩家耳朵里了：把还没听说的几步都记成听说了 */
export function applyAgendaTold(
  draft: Draft<FactionsState>,
  command: AgendaTold,
  ctx: SystemContext,
): ApplyOutcome {
  const seed = agendaCatalog(ctx.data).get(command.id);
  if (!seed) return fail(`没有 ${command.id} 这条势力动向`);
  const fresh = draft.agendas[seed.id]?.moves.filter((m) => !m.told) ?? [];
  if (fresh.length === 0) return fail(`「${seed.title}」没有玩家还没听说的事`);
  for (const m of fresh) m.told = true;
  return {
    ok: true,
    notes: [`${agendaLabel(seed, ctx.data)}：${fresh[fresh.length - 1]?.news ?? ""}`],
  };
}

/**
 * 一步动向能不能这样改地盘：一次最多一个城区，只在种子能争的城区里。
 * 成了：这个势力拿下一个，或者对头丢掉一个；受挫：这个势力丢掉一个，或者对头抢走一个；出了岔子：不改地盘
 */
export function agendaTurfProblem(
  seed: AgendaSeed,
  outcome: AgendaOutcome,
  change: TurfChange | null,
  turf: ReadonlyMap<string, readonly string[]>,
): string | undefined {
  if (change === null) return undefined;
  if (outcome === "twist") return "出了岔子的一步不改地盘";
  if (!seed.districts.includes(change.district))
    return `${change.district} 不在「${seed.title}」能争的城区里`;
  const own = change.faction === seed.faction;
  const rival = seed.rivals.includes(change.faction);
  const gain = change.change === "gain";
  const allowed = outcome === "success" ? (gain ? own : rival) : gain ? rival : own;
  if (!allowed)
    return outcome === "success"
      ? "成了的一步只能让这个势力拿地盘，或者让对头丢地盘"
      : "受挫的一步只能让这个势力丢地盘，或者让对头抢地盘";
  const has = (turf.get(change.faction) ?? []).includes(change.district);
  if (gain && has) return `${change.faction} 已经在 ${change.district} 有地盘了`;
  if (!gain && !has) return `${change.faction} 在 ${change.district} 本来就没有地盘`;
  return undefined;
}

/** 场外推演写下到点的一步：结果可以改（模型的判断），地盘按最终结果限制 */
export function applyAgendaMove(
  draft: Draft<FactionsState>,
  command: AgendaMoveCommand,
  ctx: SystemContext,
): ApplyOutcome {
  const seed = agendaCatalog(ctx.data).get(command.id);
  if (!seed) return fail(`没有 ${command.id} 这条势力动向`);
  const due = draft.due.find((d) => d.id === seed.id);
  if (!due) return fail(`「${seed.title}」没到点，不能推演`);
  const outcome = command.outcome ?? due.outcome;
  const problem = agendaTurfProblem(
    seed,
    outcome,
    command.turf,
    currentTurf(draft as FactionsState, ctx.data),
  );
  if (problem) return fail(problem);
  dropDue(draft, seed.id);
  record(draft, seed.id, {
    at: ctx.now,
    kind: "move",
    outcome,
    title: command.title,
    text: command.text,
    news: command.news,
    turf: command.turf,
    why: outcome !== due.outcome ? (command.why ?? null) : null,
    next: command.next ?? null,
    told: false,
  });
  return { ok: true };
}

/**
 * 每个势力现在的地盘：势力卡上的，按时间先后加上动向里拿下的、减去丢掉的。
 * toldOnly 只算玩家听说了的（玩家视图用），叙事模型看的是实际的
 */
export function currentTurf(
  state: FactionsState,
  data: Data,
  toldOnly = false,
): ReadonlyMap<string, readonly string[]> {
  const turf = new Map([...factionCatalog(data).values()].map((f) => [f.id, [...f.turf]]));
  const changes = [...agendaCatalog(data).keys()]
    .flatMap((id) => progressOf(state, id).moves)
    .filter((m) => !toldOnly || m.told)
    .flatMap((m) => (m.turf ? [{ at: m.at, change: m.turf }] : []))
    .sort((a, b) => a.at - b.at);
  for (const { change } of changes) {
    const list = turf.get(change.faction);
    if (!list) continue;
    const at = list.indexOf(change.district);
    if (change.change === "gain" && at < 0) list.push(change.district);
    if (change.change === "lose" && at >= 0) list.splice(at, 1);
  }
  return turf;
}

function moveLine(m: AgendaMoveRecord): string {
  const kind = m.kind === "move" ? AGENDA_OUTCOME_LABELS[m.outcome ?? "twist"] : `玩家${m.title}`;
  const heard = m.told ? "玩家听说了" : "玩家还没听说";
  return `${m.title}（${kind}，${heard}）——${m.text}`;
}

/** 给叙事模型的【势力动向】：每个势力在打什么主意、最近发生了什么、变过的地盘；没有种子时是 undefined */
export function agendaSection(state: FactionsState, data: Data, now: number): string | undefined {
  const lines: string[] = [];
  for (const seed of agendaCatalog(data).values()) {
    const p = progressOf(state, seed.id);
    const held = p.holdUntil !== null && p.holdUntil > now ? "，被玩家拖住了" : "";
    const recent = p.moves.slice(-2).map(moveLine);
    const next = p.moves.at(-1)?.next;
    lines.push(
      `- ${agendaLabel(seed, data)}［${seed.id}${held}］想要：${seed.goal}` +
        (recent.length > 0 ? `｜最近：${recent.join("；")}` : "｜还没有动静") +
        (next ? `｜可能接着：${next}` : ""),
    );
  }
  const turf = currentTurf(state, data);
  for (const f of factionCatalog(data).values()) {
    const held = turf.get(f.id) ?? f.turf;
    if (held.length === f.turf.length && held.every((d) => f.turf.includes(d))) continue;
    const was = f.turf.length > 0 ? f.turf.join("、") : "没有固定地盘";
    lines.push(
      `- 地盘变了：${f.name}现在在${held.length > 0 ? held.join("、") : "哪里都没有地盘"}（原来是${was}）`,
    );
  }
  return lines.length > 0 ? lines.join("\n") : undefined;
}

/** 给场外推演的到点动向：种子的素材、代码掷的倾向、之前几步和后续钩子；没有到点的是 undefined */
export function agendaDueSection(state: FactionsState, data: Data): string | undefined {
  const catalog = agendaCatalog(data);
  const factions = factionCatalog(data);
  const turf = currentTurf(state, data);
  const name = (id: string) => factions.get(id)?.name ?? id;
  const lines: string[] = [];
  for (const due of state.due) {
    const seed = catalog.get(due.id);
    if (!seed) continue;
    const p = progressOf(state, seed.id);
    const parts = [
      `- ${seed.id}｜${agendaLabel(seed, data)}｜代码掷的倾向：${AGENDA_OUTCOME_LABELS[due.outcome]}`,
      `想要：${seed.goal}`,
      `可能的法子：${seed.means.join("；")}`,
      `能争的城区：${seed.districts.length > 0 ? seed.districts.join("、") : "（不争地盘）"}`,
      `现在的地盘：${(turf.get(seed.faction) ?? []).join("、") || "没有"}`,
    ];
    if (seed.rivals.length > 0)
      parts.push(
        `对头：${seed.rivals.map((r) => `${name(r)}（${r}，地盘 ${(turf.get(r) ?? []).join("、") || "没有"}）`).join("、")}`,
      );
    if (seed.canon.length > 0) parts.push(`原作参考：${seed.canon.join("；")}`);
    const recent = p.moves.slice(-3).map(moveLine);
    if (recent.length > 0) parts.push(`之前：${recent.join("；")}`);
    const next = p.moves.at(-1)?.next;
    if (next) parts.push(`上次留的钩子：${next}`);
    lines.push(parts.join("｜"));
  }
  return lines.length > 0 ? lines.join("\n") : undefined;
}
