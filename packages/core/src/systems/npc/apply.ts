import type { Draft } from "immer";
import type { ApplyOutcome } from "../../kernel/system";
import { memberDeathBlocked } from "../dice";
import { applyNpcBody, bodyProblems } from "./body";
import {
  AFFINITY_MAX,
  AFFINITY_MIN,
  AFFINITY_STEP_CAP,
  KNOWN_KEPT,
  KNOWN_SOURCE_LABELS,
  LEDGER_KEPT,
  LEDGER_KIND_LABELS,
  MEMORY_KEPT,
  type Npc,
  type NpcCommand,
  type NpcMemoryEdit,
  type NpcOffscreenDeath,
  type NpcPast,
  type NpcState,
  type SeedNpc,
  TIMELINE_KEPT,
  TIMELINE_TAIL,
} from "./schema";

function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** 名字或外号撞上已有人物时返回那个人 */
function nameTaken(state: Draft<NpcState>, name: string, alias?: string): Npc | undefined {
  const wanted = [name, ...(alias === undefined ? [] : [alias])];
  return Object.values(state.npcs).find((n) => {
    const own = [n.name, ...(n.alias === undefined ? [] : [n.alias])];
    return wanted.some((w) => own.some((o) => sameName(w, o)));
  });
}

export function seedNpc(
  draft: Draft<NpcState>,
  command: SeedNpc,
  data: Readonly<Record<string, unknown>> = {},
): ApplyOutcome {
  const { type: _type, affinity, met, ...card } = command;
  if (draft.npcs[card.id]) return { ok: false, reason: `人物 ${card.id} 已经有卡了` };
  const problems = bodyProblems(card.body, data);
  if (problems.length) return { ok: false, reason: `${card.name} 的身体：${problems.join("；")}` };
  draft.npcs[card.id] = {
    ...card,
    affinity,
    alive: true,
    met,
    location: card.home ?? null,
    lastSeenAt: null,
    memories: [],
    doing: null,
    timeline: [],
    past: null,
    offscreenDeath: null,
    relation: null,
    ledger: [],
    known: [],
    vitals: null,
  };
  return { ok: true };
}

/** 记忆面板：改写或删掉一条共同记忆；原文对不上就不改，死了的人的记忆也能改 */
export function editNpcMemory(draft: Draft<NpcState>, command: NpcMemoryEdit): ApplyOutcome {
  const npc = draft.npcs[command.id];
  if (!npc) return { ok: false, reason: `没有 id 为 ${command.id} 的人物卡` };
  if (npc.memories[command.index] !== command.before) {
    return { ok: false, reason: `和${npc.name}的这条共同记忆已经变了，刷新后再改` };
  }
  if (command.action === "remove") {
    npc.memories.splice(command.index, 1);
    return { ok: true, notes: [`删掉了和${npc.name}的一条共同记忆`] };
  }
  const text = command.text?.trim();
  if (!text) return { ok: false, reason: "改写的内容不能为空" };
  if (text === command.before) return { ok: false, reason: "内容没变" };
  if (npc.memories.some((m, i) => i !== command.index && m === text)) {
    return { ok: false, reason: `和${npc.name}已经有一条一样的共同记忆` };
  }
  npc.memories[command.index] = text;
  return { ok: true, notes: [`改写了和${npc.name}的一条共同记忆`] };
}

/** 场外推演压的经历摘要：替换旧摘要，经历只留最近 TIMELINE_TAIL 条；经历还不多时不压 */
export function applyNpcPast(draft: Draft<NpcState>, command: NpcPast, now: number): ApplyOutcome {
  const npc = draft.npcs[command.id];
  if (!npc) return { ok: false, reason: `没有 id 为 ${command.id} 的人物卡` };
  if (npc.timeline.length <= TIMELINE_TAIL) {
    return { ok: false, reason: `${npc.name}的经历还不多，不用压` };
  }
  npc.past = { text: command.text, at: now };
  npc.timeline.splice(0, npc.timeline.length - TIMELINE_TAIL);
  return { ok: true };
}

/** 场外推演写的死亡：只限原作人物、活着、不是队员；玩家听说以前人物档案照旧显示活着 */
export function applyOffscreenDeath(
  draft: Draft<NpcState>,
  command: NpcOffscreenDeath,
  now: number,
  facts: Readonly<Record<string, unknown>> = {},
): ApplyOutcome {
  const npc = draft.npcs[command.id];
  if (!npc) return { ok: false, reason: `没有 id 为 ${command.id} 的人物卡` };
  if (!npc.canon) return { ok: false, reason: `${npc.name}不是原作人物，屏幕外不能死` };
  if (!npc.alive) return { ok: false, reason: `${npc.name} 已经死了` };
  const squad = Array.isArray(facts.squad) ? (facts.squad as unknown[]) : [];
  if (squad.includes(command.id)) return { ok: false, reason: `${npc.name}是队员，不能死在屏幕外` };
  npc.alive = false;
  npc.offscreenDeath = { cause: command.cause, at: now };
  return { ok: true, notes: [`${npc.name} 在屏幕外死了：${command.cause}`] };
}

/** 人物档案里显示死了没有：屏幕外死的，要等玩家在那之后听说了这个人的事（learn）才算知道 */
export function deathKnown(npc: Npc): boolean {
  if (npc.alive) return false;
  const off = npc.offscreenDeath;
  return off === null || npc.known.some((k) => k.at >= off.at);
}

export function applyNpc(
  draft: Draft<NpcState>,
  command: NpcCommand,
  now: number,
  facts: Readonly<Record<string, unknown>> = {},
  data: Readonly<Record<string, unknown>> = {},
): ApplyOutcome {
  if (command.type === "npc") {
    const { type: _type, location, ...card } = command;
    if (draft.npcs[card.id]) {
      return { ok: false, reason: `已经有 id 为 ${card.id} 的人物卡，见到这个人用 meet` };
    }
    const taken = nameTaken(draft, card.name, card.alias);
    if (taken) {
      return {
        ok: false,
        reason: `已经有叫「${taken.name}」的人物（${taken.id}）；是同一个人就用 meet，不是就换个名字`,
      };
    }
    const problems = bodyProblems(card.body, data);
    if (problems.length) {
      return {
        ok: false,
        reason: `${card.name} 的 body：${problems.join("；")}；id 照物品表和义体表写`,
      };
    }
    draft.npcs[card.id] = {
      ...card,
      samples: [],
      canon: false,
      affinity: 0,
      alive: true,
      met: true,
      location: location ?? null,
      lastSeenAt: now,
      memories: [],
      doing: null,
      timeline: [],
      past: null,
      offscreenDeath: null,
      relation: null,
      ledger: [],
      known: [],
      vitals: null,
    };
    return { ok: true, notes: [`新人物：${card.name}`] };
  }

  const npc = draft.npcs[command.id];
  if (!npc) {
    return { ok: false, reason: `没有 id 为 ${command.id} 的人物卡，新认识的人先用 npc 建卡` };
  }
  // 死了的人也能被打听到
  if (command.type === "learn") {
    if (npc.known.some((k) => k.text === command.text)) return { ok: true };
    npc.known.push({ text: command.text, source: command.source, at: now });
    if (npc.known.length > KNOWN_KEPT) npc.known.splice(0, npc.known.length - KNOWN_KEPT);
    return {
      ok: true,
      notes: [`关于${npc.name}（${KNOWN_SOURCE_LABELS[command.source]}）：${command.text}`],
    };
  }
  if (!npc.alive) return { ok: false, reason: `${npc.name} 已经死了，不能再出场` };
  if (
    command.type === "npcHurt" ||
    command.type === "npcHeal" ||
    command.type === "npcGear" ||
    command.type === "npcChrome" ||
    command.type === "npcHumanity" ||
    command.type === "npcScan"
  ) {
    return applyNpcBody(npc as Npc, command, now, data);
  }

  switch (command.type) {
    case "meet": {
      const notes = npc.met ? [] : [`认识了 ${npc.name}`];
      npc.met = true;
      npc.lastSeenAt = now;
      if (command.location !== undefined) npc.location = command.location;
      return { ok: true, notes };
    }
    case "affinity": {
      if (!npc.met) return { ok: false, reason: `还没见过 ${npc.name}，先用 meet 让这个人出场` };
      const notes: string[] = [];
      let delta = command.delta;
      if (Math.abs(delta) > AFFINITY_STEP_CAP) {
        const capped = Math.sign(delta) * AFFINITY_STEP_CAP;
        notes.push(`单次好感变化最多 ±${AFFINITY_STEP_CAP}，${delta} 已截断为 ${capped}`);
        delta = capped;
      }
      const before = npc.affinity;
      npc.affinity = Math.min(AFFINITY_MAX, Math.max(AFFINITY_MIN, before + delta));
      const applied = npc.affinity - before;
      if (applied !== 0) notes.push(`${npc.name} 好感 ${applied > 0 ? "+" : ""}${applied}`);
      return { ok: true, notes };
    }
    case "memory": {
      if (!npc.met) return { ok: false, reason: `还没见过 ${npc.name}，先用 meet 让这个人出场` };
      if (npc.memories.includes(command.text)) return { ok: true };
      npc.memories.push(command.text);
      if (npc.memories.length > MEMORY_KEPT) {
        npc.memories.splice(0, npc.memories.length - MEMORY_KEPT);
      }
      return { ok: true };
    }
    case "doing": {
      if (npc.doing?.text === command.text) return { ok: true };
      npc.doing = { text: command.text, at: now };
      npc.timeline.push({ text: command.text, at: now });
      // 兜底：场外推演一直没压摘要时直接删最早的
      if (npc.timeline.length > TIMELINE_KEPT) {
        npc.timeline.splice(0, npc.timeline.length - TIMELINE_KEPT);
      }
      return { ok: true };
    }
    case "relation": {
      if (!npc.met) return { ok: false, reason: `还没见过 ${npc.name}，先用 meet 让这个人出场` };
      if (npc.relation?.text === command.text) return { ok: true };
      npc.relation = { text: command.text, at: now };
      return { ok: true, notes: [`和${npc.name}的关系：${command.text}`] };
    }
    case "ledger": {
      if (!npc.met) return { ok: false, reason: `还没见过 ${npc.name}，先用 meet 让这个人出场` };
      const same = npc.ledger.some(
        (e) => e.settledAt === null && e.kind === command.kind && e.text === command.text,
      );
      if (same) return { ok: true };
      npc.ledger.push({ kind: command.kind, text: command.text, at: now, settledAt: null });
      while (npc.ledger.length > LEDGER_KEPT) {
        const settled = npc.ledger.findIndex((e) => e.settledAt !== null);
        npc.ledger.splice(settled === -1 ? 0 : settled, 1);
      }
      const line =
        command.kind === "owesYou"
          ? `${npc.name}欠你一个人情`
          : command.kind === "youOwe"
            ? `你欠${npc.name}一个人情`
            : `${npc.name}记下了你的仇`;
      return { ok: true, notes: [`${line}：${command.text}`] };
    }
    case "ledgerSettle": {
      const entry = npc.ledger[command.entry - 1];
      if (!entry) return { ok: false, reason: `${npc.name}的人情和仇里没有第 ${command.entry} 条` };
      if (entry.settledAt !== null) {
        return { ok: false, reason: `${npc.name}的第 ${command.entry} 条已经了结了` };
      }
      entry.settledAt = now;
      entry.how = command.how;
      return {
        ok: true,
        notes: [`了结了和${npc.name}的一笔账（${LEDGER_KIND_LABELS[entry.kind]}）：${command.how}`],
      };
    }
    case "npcDeath": {
      // 队员之死的保底：squad 不能被 npc 读（squad 读 npc），回合流程把队员名单放进事实 squad
      const squad = Array.isArray(facts.squad) ? (facts.squad as unknown[]) : [];
      if (squad.includes(command.id)) {
        const names = [npc.name, ...(npc.alias === undefined ? [] : [npc.alias])];
        const blocked = memberDeathBlocked(facts, names);
        if (blocked) return { ok: false, reason: blocked };
      }
      npc.alive = false;
      npc.lastSeenAt = now;
      return { ok: true, notes: [`${npc.name} 死了`] };
    }
  }
}
