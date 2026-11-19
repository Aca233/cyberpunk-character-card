import type { Draft } from "immer";
import type { ApplyOutcome, SystemContext } from "../../kernel/system";
import type { Npc, NpcState } from "../npc";
import {
  ARC_NOTES_KEPT,
  ARC_OPEN_MAX,
  ArcCatalogSchema,
  type ArcCommand,
  type ArcConcernSeed,
  type ArcOffscreenCommand,
  type ArcProgress,
  type ArcSeed,
  type ArcStartCommand,
  type ArcsState,
  type ConcernBy,
  type ConcernProgress,
} from "./schema";

type State = Draft<ArcsState>;
type Data = Readonly<Record<string, unknown>>;

const fail = (reason: string): ApplyOutcome => ({ ok: false, reason });

const catalogs = new WeakMap<object, ReadonlyMap<string, ArcSeed>>();

/** 读取并校验个人线的种子表（按人物 id）；没有时是空表 */
export function arcCatalog(data: Data): ReadonlyMap<string, ArcSeed> {
  const raw = data.arcs;
  if (typeof raw !== "object" || raw === null) return new Map();
  const cached = catalogs.get(raw);
  if (cached) return cached;
  const catalog = new Map(ArcCatalogSchema.parse(raw).map((a) => [a.npc, a] as const));
  catalogs.set(raw, catalog);
  return catalog;
}

const EMPTY_ARC: ArcProgress = {
  unlockedAt: null,
  concerns: {},
  doneAt: null,
};
const EMPTY_CONCERN: ConcernProgress = {
  onset: null,
  status: null,
  toldAt: null,
  notes: [],
  outcome: null,
};

export function arcOf(state: ArcsState, npc: string): ArcProgress {
  return state.arcs[npc] ?? EMPTY_ARC;
}

export function concernOf(arc: ArcProgress, id: string): ConcernProgress {
  return arc.concerns[id] ?? EMPTY_CONCERN;
}

/** 这一刻够不够条件：见过面、活着，好感和共同记忆都够 */
export function arcReady(seed: ArcSeed, card: Npc | undefined): boolean {
  return (
    card?.alive === true &&
    card.met &&
    card.affinity >= seed.unlock.affinity &&
    card.memories.length >= seed.unlock.memories
  );
}

/** 解锁过一次就一直算；还没记下时按眼下的条件算 */
export function arcUnlocked(state: ArcsState, seed: ArcSeed, card: Npc | undefined): boolean {
  return arcOf(state, seed.npc).unlockedAt !== null || arcReady(seed, card);
}

/** 说出口了、玩家还没表态或正在管的几件 */
export function openConcerns(seed: ArcSeed, arc: ArcProgress): ArcConcernSeed[] {
  return seed.concerns.filter((c) => {
    const s = concernOf(arc, c.id).status;
    return s === "told" || s === "involved";
  });
}

function slot(draft: State, npc: string): Draft<ArcProgress> {
  const existing = draft.arcs[npc];
  if (existing) return existing;
  draft.arcs[npc] = { unlockedAt: null, concerns: {}, doneAt: null };
  return draft.arcs[npc] as Draft<ArcProgress>;
}

function concernSlot(arc: Draft<ArcProgress>, id: string): Draft<ConcernProgress> {
  const existing = arc.concerns[id];
  if (existing) return existing;
  arc.concerns[id] = { onset: null, status: null, toldAt: null, notes: [], outcome: null };
  return arc.concerns[id] as Draft<ConcernProgress>;
}

function pushNote(p: Draft<ConcernProgress>, text: string, at: number, by: ConcernBy): void {
  p.notes.push({ text, at, by });
  if (p.notes.length > ARC_NOTES_KEPT) p.notes.splice(0, p.notes.length - ARC_NOTES_KEPT);
}

/** 几件都有了结果就记下了结时间，返回要加的提示 */
function markDone(seed: ArcSeed, arc: Draft<ArcProgress>, name: string, now: number): string[] {
  if (arc.doneAt !== null) return [];
  if (!seed.concerns.every((c) => arc.concerns[c.id]?.status === "resolved")) return [];
  arc.doneAt = now;
  return [`${name}的几件心事都有了结果`];
}

interface Resolved {
  readonly seed: ArcSeed;
  readonly concern: ArcConcernSeed;
  readonly card: Npc | undefined;
  readonly name: string;
}

function resolve(npc: string, concernId: string, ctx: SystemContext): Resolved | string {
  const seed = arcCatalog(ctx.data).get(npc);
  if (!seed) return `${npc} 没有个人线`;
  const concern = seed.concerns.find((c) => c.id === concernId);
  if (!concern) {
    return `${npc} 没有 ${concernId} 这件心事（有：${seed.concerns.map((c) => c.id).join("、")}）`;
  }
  const card = ctx.read<NpcState>("npc").npcs[npc];
  return { seed, concern, card, name: card?.name ?? npc };
}

export function applyArc(draft: State, command: ArcCommand, ctx: SystemContext): ApplyOutcome {
  if (command.action === "start") {
    return applyArcStart(
      draft,
      { type: "arc.start", npc: command.npc, concern: command.concern, text: command.text ?? "" },
      ctx,
      "scene",
    );
  }
  const found = resolve(command.npc, command.concern, ctx);
  if (typeof found === "string") return fail(found);
  const { seed, concern, card, name } = found;
  const now = ctx.now;
  const current = concernOf(arcOf(draft, seed.npc), concern.id);
  const title = concern.title;
  if (current.onset === null) {
    return fail(`「${title}」的前因尚未成立：${concern.trigger}；不能仅凭好感或原作剧情启动`);
  }

  switch (command.action) {
    case "tell": {
      if (!card?.alive) return fail(`${name}已经死了`);
      if (!card.met) return fail(`玩家还没见过${name}`);
      if (!arcUnlocked(draft, seed, card)) {
        return fail(
          `${name}跟玩家还没熟到说心事（要好感 ≥${seed.unlock.affinity}、共同记忆 ≥${seed.unlock.memories} 条，现在 ${card.affinity}、${card.memories.length} 条）`,
        );
      }
      const arc = slot(draft, seed.npc);
      if (arc.unlockedAt === null) arc.unlockedAt = now;
      const p = concernSlot(arc, concern.id);
      // 场外已经有了结果、玩家还不知道：他说起来就算玩家知道了
      if (p.outcome && !p.outcome.known) {
        p.outcome.known = true;
        if (p.toldAt === null) p.toldAt = now;
        return { ok: true, notes: [`${name}跟你说起：${title}——${p.outcome.text}`] };
      }
      if (p.status !== null) return fail(`${name}已经跟玩家说过「${title}」了`);
      const open = openConcerns(seed, arc).filter((c) => c.id !== concern.id);
      if (open.length >= ARC_OPEN_MAX) {
        return fail(
          `${name}还有一件没了的心事（${open.map((c) => c.title).join("、")}），先等那件有个结果`,
        );
      }
      p.status = "told";
      p.toldAt = now;
      return { ok: true, notes: [`${name}跟你说起：${title}`] };
    }
    case "join": {
      if (current.status !== "told" && current.status !== "declined") {
        return fail(
          current.status === null
            ? `${name}还没跟玩家说起「${title}」，先写 tell`
            : `「${title}」现在是${current.status === "involved" ? "玩家在管" : "已有结果"}`,
        );
      }
      const p = concernSlot(slot(draft, seed.npc), concern.id);
      p.status = "involved";
      return { ok: true, notes: [`你答应管${name}的事：${title}`] };
    }
    case "decline": {
      if (current.status !== "told") {
        return fail(`「${title}」不是刚说出口、等玩家表态的事`);
      }
      const p = concernSlot(slot(draft, seed.npc), concern.id);
      p.status = "declined";
      return { ok: true, notes: [`你没接${name}的事：${title}`] };
    }
    case "note": {
      if (current.status !== "involved" && current.status !== "told") {
        return fail(`「${title}」不是说出口、还没了的事`);
      }
      const p = concernSlot(slot(draft, seed.npc), concern.id);
      pushNote(p, command.text ?? "", now, "scene");
      return { ok: true, notes: [] };
    }
    case "resolve": {
      if (current.status === null) {
        return fail(`${name}还没跟玩家说起「${title}」；玩家看不到的结果交给场外推演`);
      }
      if (current.status === "resolved") return fail(`「${title}」已经有结果了`);
      const arc = slot(draft, seed.npc);
      const p = concernSlot(arc, concern.id);
      const text = command.text ?? "";
      p.status = "resolved";
      p.outcome = { text, fate: command.fate ?? "canon", at: now, by: "scene", known: true };
      const notes = [`${name}的事有了结果：${title}——${text}`, ...markDone(seed, arc, name, now)];
      return {
        ok: true,
        notes,
        emit: command.bond ? [{ type: "relation", id: seed.npc, text: command.bond }] : [],
      };
    }
    case "hear": {
      if (!current.outcome) return fail(`「${title}」还没有结果`);
      if (current.outcome.known) return { ok: true, notes: [] };
      const p = concernSlot(slot(draft, seed.npc), concern.id);
      if (p.outcome) p.outcome.known = true;
      return { ok: true, notes: [`听说了${name}的事：${title}——${current.outcome.text}`] };
    }
  }
}

/** 记录实际前因，先于说出口或场外推进；重复登记不覆盖最初事实。 */
export function applyArcStart(
  draft: State,
  command: ArcStartCommand,
  ctx: SystemContext,
  by: ConcernBy = "offscreen",
): ApplyOutcome {
  const found = resolve(command.npc, command.concern, ctx);
  if (typeof found === "string") return fail(found);
  const { seed, concern, card, name } = found;
  if (!card?.alive) return fail(`${name}没有卡或已经死了，不能新开个人线`);
  if (!command.text.trim()) return fail("启动心事必须记录已在本存档成立的具体前因");
  const current = concernOf(arcOf(draft, seed.npc), concern.id);
  if (current.onset !== null) return { ok: true, notes: [] };
  const p = concernSlot(slot(draft, seed.npc), concern.id);
  p.onset = { text: command.text.trim(), at: ctx.now, by };
  return { ok: true, notes: [] };
}

/**
 * 【城里在发酵的事】里一件心事在场外走了一步或收场：由那边发来，这里只记进展和结果。
 * 不再卡间隔、不再拦玩家在管的事；已经有结果的不改，也不算失败，免得那边的一步跟着作废
 * （用户 2026-11-01 定的「全改」第 4 步：模型当主持人，代码只管记账）
 */
export function applyArcOffscreen(
  draft: State,
  command: ArcOffscreenCommand,
  ctx: SystemContext,
): ApplyOutcome {
  const found = resolve(command.npc, command.concern, ctx);
  if (typeof found === "string") return fail(found);
  const { seed, concern, name } = found;
  const now = ctx.now;
  const current = concernOf(arcOf(draft, seed.npc), concern.id);
  if (current.onset === null) return fail(`「${concern.title}」尚无已成立的前因，不能场外推进`);
  if (current.status === "resolved") return { ok: true, notes: [] };
  const arc = slot(draft, seed.npc);
  const p = concernSlot(arc, concern.id);
  // 推进时间由新单子的定时器管理，心事这里只记发生的事（用户 2026-11-01 定的「全改」第 4 步）
  pushNote(p, command.text, now, "offscreen");
  if (!command.resolve) {
    return {
      ok: true,
      notes: [`场外：${name}的「${concern.title}」往前走了一步：${command.text}`],
    };
  }
  const previousStatus = p.status;
  p.status = "resolved";
  p.outcome = {
    text: command.text,
    fate: command.fate ?? "canon",
    at: now,
    by: "offscreen",
    known: false,
    previousStatus,
  };
  return {
    ok: true,
    notes: [
      `场外：${name}的「${concern.title}」有了结果：${command.text}`,
      ...markDone(seed, arc, name, now),
    ],
  };
}

/** 时间往前走时记下第一次够条件的人 */
export function unlockArcs(draft: State, at: number, ctx: SystemContext): void {
  const npcs = ctx.read<NpcState>("npc").npcs;
  for (const seed of arcCatalog(ctx.data).values()) {
    if (draft.arcs[seed.npc]?.unlockedAt != null) continue;
    if (arcReady(seed, npcs[seed.npc])) slot(draft, seed.npc).unlockedAt = at;
  }
}

// 场外心事的挑选结果类型随旧挑选函数一起删了（用户 2026-11-01 定的「全改」第 4 步）
// 不再按人物挑选场外心事，开哪件、何时推进统一交给新单子（用户 2026-11-01 定的"全改"第 4 步）
