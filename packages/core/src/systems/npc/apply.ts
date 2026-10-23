import type { Draft } from "immer";
import type { ApplyOutcome } from "../../kernel/system";
import {
  AFFINITY_MAX,
  AFFINITY_MIN,
  AFFINITY_STEP_CAP,
  MEMORY_KEPT,
  type Npc,
  type NpcCommand,
  type NpcState,
  type SeedNpc,
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

export function seedNpc(draft: Draft<NpcState>, command: SeedNpc): ApplyOutcome {
  const { type: _type, affinity, ...card } = command;
  if (draft.npcs[card.id]) return { ok: false, reason: `人物 ${card.id} 已经有卡了` };
  draft.npcs[card.id] = {
    ...card,
    affinity,
    alive: true,
    met: false,
    location: card.home ?? null,
    lastSeenAt: null,
    memories: [],
  };
  return { ok: true };
}

export function applyNpc(draft: Draft<NpcState>, command: NpcCommand, now: number): ApplyOutcome {
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
    };
    return { ok: true, notes: [`新人物：${card.name}`] };
  }

  const npc = draft.npcs[command.id];
  if (!npc) {
    return { ok: false, reason: `没有 id 为 ${command.id} 的人物卡，新认识的人先用 npc 建卡` };
  }
  if (!npc.alive) return { ok: false, reason: `${npc.name} 已经死了，不能再出场` };

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
    case "npcDeath": {
      npc.alive = false;
      npc.lastSeenAt = now;
      return { ok: true, notes: [`${npc.name} 死了`] };
    }
  }
}
