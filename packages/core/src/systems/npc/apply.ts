import type { Draft } from "immer";
import type { ApplyOutcome } from "../../kernel/system";
import { applyBehaviorChip, cyberwareCatalog, isActiveBehaviorMode } from "../cyberware";
import { memberDeathBlocked } from "../dice";
import { locationCatalog } from "../world";
import { applyNpcBody, bodyProblems, EMPTY_NPC_BODY, sanitizeNpcBody } from "./body";
import {
  AFFINITY_MAX,
  AFFINITY_MIN,
  AFFINITY_STEP_CAP,
  type Doing,
  KNOWN_KEPT,
  KNOWN_SOURCE_LABELS,
  LEDGER_KEPT,
  LEDGER_KIND_LABELS,
  MEMORY_KEPT,
  NO_FACTION,
  NPC_SAMPLES_MAX,
  NPC_UNDECIDED_PREFIX,
  type Npc,
  type NpcCommand,
  type NpcMemoryEdit,
  type NpcOffscreenDeath,
  type NpcOffscreenDoing,
  type NpcPast,
  type NpcState,
  type SeedNpc,
  TIES_KEPT,
  TIMELINE_KEPT,
  TIMELINE_TAIL,
  type Tie,
} from "./schema";

/**
 * 势力表里的 id（用户 2026-10-31："npc加个所属势力 没有就填无"）：直接读内容数据的 factions，
 * 不引 factions 系统免得互相依赖；没有势力表时是 undefined，不校验
 */
function factionIds(data: Readonly<Record<string, unknown>>): ReadonlySet<string> | undefined {
  const raw = data.factions;
  if (!Array.isArray(raw)) return undefined;
  const ids = new Set<string>();
  for (const f of raw) {
    if (typeof f === "object" && f !== null && typeof (f as { id?: unknown }).id === "string") {
      ids.add((f as { id: string }).id);
    }
  }
  return ids;
}

/** 所属势力写的不是 none、也不在势力表里时返回出错原因 */
function factionProblem(
  faction: string,
  data: Readonly<Record<string, unknown>>,
): string | undefined {
  if (faction === NO_FACTION) return undefined;
  const ids = factionIds(data);
  if (ids === undefined || ids.has(faction)) return undefined;
  return `势力表里没有 ${faction}；不属于任何势力写 ${NO_FACTION}，现有：${[...ids].join("、")}`;
}

/** 运行期对模型给出的 faction 做容错解析：支持中文/英文名映射，实在对不上回落到 none */
function resolveFaction(
  faction: string,
  data: Readonly<Record<string, unknown>>,
  notes: string[],
): string {
  if (faction === NO_FACTION) return NO_FACTION;
  const raw = data.factions;
  if (!Array.isArray(raw)) return faction;
  const needle = faction.trim().toLowerCase();
  for (const f of raw) {
    if (typeof f !== "object" || f === null) continue;
    const rec = f as { id?: unknown; name?: unknown; en?: unknown };
    if (typeof rec.id !== "string") continue;
    if (
      rec.id.toLowerCase() === needle ||
      (typeof rec.name === "string" && rec.name.trim().toLowerCase() === needle) ||
      (typeof rec.en === "string" && rec.en.trim().toLowerCase() === needle)
    ) {
      return rec.id;
    }
  }
  notes.push(`未知势力「${faction}」已按无势力归档`);
  return NO_FACTION;
}

/** 运行期地点名容错解析：如果写了地点中文名且能命中地点表，自动翻成对应 id */
function resolvePlace(place: string, data: Readonly<Record<string, unknown>>): string {
  if (!Array.isArray(data.locations)) return place;
  const catalog = locationCatalog(data);
  if (catalog.has(place)) return place;
  const needle = place.trim().toLowerCase();
  for (const loc of catalog.values()) {
    if (loc.name.trim().toLowerCase() === needle) return loc.id;
  }
  return place;
}

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
  /** 开局关系笔记和人情记在这个游戏时间；旧调用方不传时按 0 */
  now = 0,
): ApplyOutcome {
  const { type: _type, affinity, met, relation, ledger, ...card } = command;
  if (draft.npcs[card.id]) return { ok: false, reason: `人物 ${card.id} 已经有卡了` };
  const problems = bodyProblems(card.body, data, card.id);
  if (problems.length) return { ok: false, reason: `${card.name} 的身体：${problems.join("；")}` };
  const wrongFaction = factionProblem(card.faction, data);
  if (wrongFaction) return { ok: false, reason: `${card.name} 的所属势力：${wrongFaction}` };
  draft.npcs[card.id] = {
    ...card,
    affinity,
    goalProgress: 0,
    crisis: null,
    alive: true,
    met,
    location: card.home ?? null,
    lastKnownLocation: met ? (card.home ?? null) : null,
    lastSeenAt: null,
    memories: [],
    doing: card.initialDoing ? { text: card.initialDoing, at: now } : null,
    knownDoing: null,
    timeline: card.initialDoing ? [{ text: card.initialDoing, at: now }] : [],
    past: null,
    offscreenDeath: null,
    wearing: null,
    // 捏人第 3 步的旧识关系（用户定的关系表，2026-10-30）：老朋友、前任带关系笔记，人情和旧仇记进人情和仇
    relation: relation ? { text: relation, at: now } : null,
    ledger: ledger.map((e) => ({ kind: e.kind, text: e.text, at: now, settledAt: null })),
    known: [],
    ties: [],
    following: false,
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

/** 场外推演写的死亡：只限原作人物、活着、非当前同行者；玩家听说以前人物档案照旧显示活着 */
export function applyOffscreenDeath(
  draft: Draft<NpcState>,
  command: NpcOffscreenDeath,
  now: number,
  _facts: Readonly<Record<string, unknown>> = {},
): ApplyOutcome {
  const npc = draft.npcs[command.id];
  if (!npc) return { ok: false, reason: `没有 id 为 ${command.id} 的人物卡` };
  if (!npc.canon) return { ok: false, reason: `${npc.name}不是原作人物，屏幕外不能死` };
  if (!npc.alive) return { ok: false, reason: `${npc.name} 已经死了` };
  if (npc.following) return { ok: false, reason: `${npc.name}正与你同行，不能死在屏幕外` };
  npc.alive = false;
  npc.following = false;
  npc.offscreenDeath = { cause: command.cause, at: now };
  return { ok: true, notes: [`${npc.name} 在屏幕外死了：${command.cause}`], signals: ["npc.died"] };
}

function updateDoing(
  npc: Draft<Npc>,
  command: Pick<Doing, "text" | "location">,
  now: number,
): ApplyOutcome {
  if (command.location !== undefined) npc.location = command.location;
  if (npc.doing?.text === command.text) return { ok: true };
  npc.doing = { text: command.text, at: now };
  npc.timeline.push({ text: command.text, at: now });
  if (npc.timeline.length > TIMELINE_KEPT) {
    npc.timeline.splice(0, npc.timeline.length - TIMELINE_KEPT);
  }
  return { ok: true };
}

export function applyOffscreenDoing(
  draft: Draft<NpcState>,
  command: NpcOffscreenDoing,
  now: number,
): ApplyOutcome {
  const npc = draft.npcs[command.id];
  if (!npc) return { ok: false, reason: `没有 id 为 ${command.id} 的人物卡` };
  if (!npc.alive) return { ok: false, reason: `${npc.name} 已经死了，不能继续行动` };
  return updateDoing(npc, command, now);
}

/** 在一个人的卡上记下认识的人：替换和同一个人的旧关系，满了删最早的 */
function putTie(npc: Draft<Npc>, other: string, text: string, open: boolean, now: number): void {
  const at = npc.ties.findIndex((t) => t.id === other);
  if (at !== -1) npc.ties.splice(at, 1);
  npc.ties.push({ id: other, text, open, at: now });
  if (npc.ties.length > TIES_KEPT) npc.ties.splice(0, npc.ties.length - TIES_KEPT);
}

/**
 * 两个有卡的人之间的关系（用户 2026-10-31："npc也有自己的生活，也有认识的npc"）：两边各记一份。
 * 死了的人也能有关系（「死去的哥哥」），两个都死了不再记
 */
export function applyTie(draft: Draft<NpcState>, command: Tie, now: number): ApplyOutcome {
  if (command.a === command.b) return { ok: false, reason: "tie 的 a 和 b 不能是同一个人" };
  const a = draft.npcs[command.a];
  const b = draft.npcs[command.b];
  if (!a || !b) {
    const missing = [command.a, command.b].filter((id) => !draft.npcs[id]);
    return { ok: false, reason: `没有 id 为 ${missing.join("、")} 的人物卡，先用 npc 建卡` };
  }
  if (!a.alive && !b.alive) return { ok: false, reason: `${a.name}和${b.name}都死了` };
  const same =
    a.ties.some((t) => t.id === b.id && t.text === command.aToB && t.open === command.open) &&
    b.ties.some((t) => t.id === a.id && t.text === command.bToA && t.open === command.open);
  if (same) return { ok: true };
  putTie(a, b.id, command.aToB, command.open, now);
  putTie(b, a.id, command.bToA, command.open, now);
  return { ok: true };
}

/** 现在穿什么：换过装按存档的 wearing，没换过按卡上的 outfit；旧卡两样都没有时是 undefined（衣着还在 look 里） */
export function currentOutfit(npc: Npc): string | undefined {
  return npc.wearing?.text ?? npc.outfit;
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
    const { type: _type, location, home, body, faction, ...card } = command;
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
    const notes = [`新人物：${card.name}`];
    const resolvedFaction = resolveFaction(faction, data, notes);
    const resolvedHome = home === undefined ? undefined : resolvePlace(home, data);
    const resolvedLocation = location === undefined ? null : resolvePlace(location, data);
    const resolvedBody = body ? sanitizeNpcBody(body, data, notes, card.id) : EMPTY_NPC_BODY;
    draft.npcs[card.id] = {
      ...card,
      faction: resolvedFaction,
      ...(resolvedHome === undefined ? {} : { home: resolvedHome }),
      body: resolvedBody,
      canon: false,
      affinity: 0,
      goalProgress: 0,
      crisis: null,
      alive: true,
      met: true,
      location: resolvedLocation ?? resolvedHome ?? null,
      lastKnownLocation: resolvedLocation ?? resolvedHome ?? null,
      lastSeenAt: now,
      memories: [],
      doing: null,
      knownDoing: null,
      timeline: [],
      past: null,
      offscreenDeath: null,
      wearing: null,
      relation: null,
      ledger: [],
      known: [],
      ties: [],
      following: false,
      vitals: null,
    };
    return { ok: true, notes };
  }
  if (command.type === "tie") return applyTie(draft, command, now);

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
  if (!npc.alive && command.type === "npcGear" && command.action === "remove")
    return applyNpcBody(npc, command, now, data);
  if (!npc.alive) return { ok: false, reason: `${npc.name} 已经死了，不能再出场` };
  if (command.type === "npcBehavior") {
    const states = npc.behaviorChips ?? {};
    const result = applyBehaviorChip(
      states,
      npc.body?.cyberware ?? [],
      command,
      cyberwareCatalog(data),
      now,
    );
    if (result.ok) npc.behaviorChips = states;
    return result;
  }
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
    case "npcUpdate": {
      if (npc.canon) {
        return {
          ok: false,
          reason: `${npc.name} 是原作人物，核心卡面固定；换装改装备请用 npcOutfit / npcGear / npcChrome`,
        };
      }
      const notes: string[] = [];
      const unfinalized =
        npc.look.startsWith(NPC_UNDECIDED_PREFIX) || npc.voice.startsWith(NPC_UNDECIDED_PREFIX);
      const emptyUnscannedBody =
        (npc.body?.gear.length ?? 0) === 0 &&
        (npc.body?.cyberware.length ?? 0) === 0 &&
        npc.vitals?.scannedAt == null;
      const canInitializeBody = unfinalized || emptyUnscannedBody;
      if (command.body !== undefined && !canInitializeBody) {
        notes.push(`保留了 ${npc.name} 已确立的装备与义体；实际变化请用 npcGear / npcChrome`);
      }
      let updated = false;
      if (command.alias !== undefined && command.alias !== npc.alias) {
        const collide = Object.values(draft.npcs).find(
          (other) =>
            other.id !== npc.id &&
            (sameName(other.name, command.alias as string) ||
              (other.alias !== undefined && sameName(other.alias, command.alias as string))),
        );
        if (collide) {
          return { ok: false, reason: `外号「${command.alias}」与已有角色 ${collide.name} 重复` };
        }
        npc.alias = command.alias;
        updated = true;
      }
      if (command.age !== undefined && command.age !== npc.age) {
        npc.age = command.age;
        updated = true;
      }
      if (command.adult !== undefined && command.adult !== npc.adult) {
        npc.adult = command.adult;
        updated = true;
      }
      if (command.entity !== undefined && command.entity !== npc.entity) {
        npc.entity = command.entity;
        updated = true;
      }
      for (const field of ["role", "look", "voice", "want", "limit", "bio", "secret"] as const) {
        const val = command[field];
        if (val !== undefined && val !== npc[field]) {
          npc[field] = val;
          updated = true;
        }
      }
      if (command.faction !== undefined) {
        const nextFaction = resolveFaction(command.faction, data, notes);
        if (nextFaction !== npc.faction) {
          npc.faction = nextFaction;
          updated = true;
        }
      }
      if (command.outfit !== undefined && command.outfit !== npc.outfit) {
        npc.outfit = command.outfit;
        npc.wearing = null;
        updated = true;
      }
      if (command.samples !== undefined && command.samples.length > 0) {
        const merged = [...npc.samples];
        for (const s of command.samples) {
          if (!merged.includes(s)) merged.push(s);
        }
        const trimmed = merged.slice(-NPC_SAMPLES_MAX);
        if (trimmed.length !== npc.samples.length || trimmed.some((s, i) => s !== npc.samples[i])) {
          npc.samples = trimmed;
          updated = true;
        }
      }
      if (command.home !== undefined) {
        const nextHome = resolvePlace(command.home, data);
        if (nextHome !== npc.home) {
          npc.home = nextHome;
          if (npc.location === null) npc.location = nextHome;
          updated = true;
        }
      }
      const nextBody =
        command.body !== undefined && canInitializeBody
          ? sanitizeNpcBody(command.body, data, notes, npc.id)
          : undefined;
      if (nextBody !== undefined) {
        npc.body = nextBody;
        for (const [device, state] of Object.entries(npc.behaviorChips ?? {})) {
          if (!nextBody.cyberware.includes(device) && state.mode !== "off") {
            state.mode = "off";
            state.protocol = null;
            state.since = now;
            if (state.lastControl && state.lastControl.to === null) state.lastControl.to = now;
          }
        }
        updated = true;
      }
      return updated
        ? { ok: true, notes: [`完善了 ${npc.name} 的人物档案`, ...notes] }
        : { ok: true, notes };
    }
    case "meet": {
      const notes = npc.met ? [] : [`认识了 ${npc.name}`];
      npc.met = true;
      npc.lastSeenAt = now;
      if (command.location !== undefined) npc.location = command.location;
      npc.lastKnownLocation = npc.location;
      return { ok: true, notes };
    }
    case "affinity": {
      if (!npc.met && command.channel !== "phone") {
        return { ok: false, reason: `还没见过 ${npc.name}，先用 meet 让这个人出场` };
      }
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
      if (!npc.met && command.source !== "phone") {
        return { ok: false, reason: `还没见过 ${npc.name}，先用 meet 让这个人出场` };
      }
      const active = Object.entries(npc.behaviorChips ?? {}).find(([, state]) =>
        isActiveBehaviorMode(state.mode),
      );
      const profile = active ? cyberwareCatalog(data).get(active[0])?.behaviorChip : undefined;
      if (
        active?.[1].mode === "doll" &&
        profile &&
        (profile.awareness === "absent" || profile.recall === "none")
      )
        return {
          ok: false,
          reason: `${npc.name} 当前处于玩偶托管断片态，不能形成本人共同记忆；设备摘要须另记，恢复清醒后实际告知或查阅才是本人所知`,
        };
      let text = command.text;
      if (command.source === "log") {
        const entry =
          command.device && command.log
            ? npc.behaviorChips?.[command.device]?.logs.find((log) => log.id === command.log)
            : undefined;
        if (!entry || entry.reviewedAt === null)
          return { ok: false, reason: "这段摘要不存在或本人没有查阅，不能写成本人已经知道" };
        text = `从本人查阅的设备摘要得知：${entry.text}`;
      } else if (command.source === "told") {
        text = `后来被告知：${command.text}`;
      }
      if (npc.memories.includes(text)) return { ok: true };
      npc.memories.push(text);
      if (npc.memories.length > MEMORY_KEPT) {
        npc.memories.splice(0, npc.memories.length - MEMORY_KEPT);
      }
      return { ok: true };
    }
    case "doing": {
      // 公开近况与实际行动分开记录；只听说做什么，不代表知道其当前真实地点。
      npc.knownDoing = { text: command.text, at: now };
      if (command.location !== undefined) npc.lastKnownLocation = command.location;
      return updateDoing(npc, command, now);
    }
    case "relation": {
      if (!npc.met) return { ok: false, reason: `还没见过 ${npc.name}，先用 meet 让这个人出场` };
      if (npc.relation?.text === command.text) return { ok: true };
      npc.relation = { text: command.text, at: now };
      return { ok: true, notes: [`和${npc.name}的关系：${command.text}`] };
    }
    case "npcOutfit": {
      // 换装（用户定的，2026-11-02："长相 + 当前穿着"）：和现在穿的一样就不记
      if (currentOutfit(npc as Npc) === command.text) return { ok: true };
      npc.wearing = { text: command.text, at: now };
      return { ok: true };
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
    case "npcCompanion": {
      if (!npc.met) return { ok: false, reason: `还没见过 ${npc.name}，先用 meet 让这个人出场` };
      if (npc.following === command.following) return { ok: true };
      npc.following = command.following;
      if (command.following) npc.lastSeenAt = now;
      const tail = command.reason ? `（${command.reason}）` : "";
      return {
        ok: true,
        notes: [
          command.following
            ? `${npc.name} 开始与你同行${tail}`
            : `${npc.name} 暂别留守，不再随行${tail}`,
        ],
      };
    }
    case "npcDeath": {
      if (npc.following) {
        const names = [npc.name, ...(npc.alias === undefined ? [] : [npc.alias])];
        const blocked = memberDeathBlocked(facts, names);
        if (blocked) return { ok: false, reason: blocked };
      }
      npc.alive = false;
      npc.following = false;
      npc.lastSeenAt = now;
      return { ok: true, notes: [`${npc.name} 死了`], signals: ["npc.died"] };
    }
  }
}

/** 玩家移动到达新地点时，把正随行且活着的同行者同步带到该地点 */
export function moveFollowingNpcs(
  draft: Draft<NpcState>,
  location: string | null,
  now: number,
): void {
  if (location === null) return;
  for (const person of Object.values(draft.npcs)) {
    if (!person.alive || !person.following) continue;
    person.location = location;
    person.lastKnownLocation = location;
    person.lastSeenAt = now;
  }
}
