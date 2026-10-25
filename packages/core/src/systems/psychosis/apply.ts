import type { Draft } from "immer";
import type { ApplyOutcome, SystemContext } from "../../kernel/system";
import { HUMANITY_KINDS } from "../humanity";
import type { InventoryState } from "../inventory";
import type { NpcState } from "../npc";
import { formatGameTime } from "../world";
import {
  ANCHOR_LOSS_LABELS,
  ANCHORS_MAX,
  type AnchorCommand,
  DEPENDENCE_DOSES,
  DEPENDENCE_WINDOW,
  type PsychosisInternal,
  type PsychosisState,
  PsychosisStateSchema,
  SUPPRESSANT_ID,
  SUPPRESSANT_MINUTES,
  type SuppressantCommand,
  TOLERANCE_DOSES,
  TOLERANCE_WINDOW,
  WITHDRAWAL_AFTER,
} from "./schema";

const fail = (reason: string): ApplyOutcome => ({ ok: false, reason });

const anchored = (draft: Draft<PsychosisState>) => ({
  type: "humanity.setAnchored",
  anchored: draft.anchors.length > 0,
});

/** 压制剂现在的情况：药效到几点、耐受、依赖、戒断 */
export interface SuppressantStatus {
  readonly until: number | null;
  readonly tolerant: boolean;
  readonly dependent: boolean;
  readonly withdrawal: boolean;
}

export function suppressantStatus(doses: readonly number[], now: number): SuppressantStatus {
  const past = doses.filter((t) => t <= now);
  const last = past.length === 0 ? null : Math.max(...past);
  const week = past.filter((t) => now - t < TOLERANCE_WINDOW).length;
  const fortnight = past.filter((t) => now - t < DEPENDENCE_WINDOW).length;
  const tolerant = week >= TOLERANCE_DOSES;
  const length = tolerant ? SUPPRESSANT_MINUTES / 2 : SUPPRESSANT_MINUTES;
  const dependent = fortnight >= DEPENDENCE_DOSES;
  return {
    until: last !== null && now - last < length ? last + length : null,
    tolerant,
    dependent,
    withdrawal: dependent && last !== null && now - last >= WITHDRAWAL_AFTER,
  };
}

/** 玩家在人物卡上设锚点或取消；取消不扣人性（决裂和死去由叙事模型写 anchor） */
export function setAnchor(
  draft: Draft<PsychosisState>,
  command: Extract<PsychosisInternal, { type: "psychosis.anchor" }>,
  ctx: SystemContext,
): ApplyOutcome {
  const npc = Object.values(ctx.read<NpcState>("npc").npcs).find((n) => n.id === command.npc);
  const name = npc?.name ?? command.npc;
  if (command.action === "remove") {
    const index = draft.anchors.findIndex((a) => a.npc === command.npc);
    if (index < 0) return fail(`${name}不是锚点`);
    draft.anchors.splice(index, 1);
    return { ok: true, notes: [`${name}不再是锚点`], emit: [anchored(draft)] };
  }
  if (!npc) return fail(`没有人物卡 ${command.npc}`);
  if (!npc.alive) return fail(`${npc.name}已经不在了`);
  if (!npc.met) return fail(`还没见过${npc.name}`);
  if (draft.anchors.some((a) => a.npc === npc.id)) return fail(`${npc.name}已经是锚点`);
  if (draft.anchors.length >= ANCHORS_MAX) {
    return fail(`锚点最多 ${ANCHORS_MAX} 个，先取消一个`);
  }
  draft.anchors.push({ npc: npc.id, name: npc.name, since: ctx.now });
  return {
    ok: true,
    notes: [`${npc.name}成了锚点：快撑不住的时候，这个人能把你拉回来`],
    emit: [anchored(draft)],
  };
}

/** 锚点死去或决裂：从锚点里去掉，人性 −15，同一个人只扣一次 */
export function loseAnchor(
  draft: Draft<PsychosisState>,
  command: AnchorCommand,
  ctx: SystemContext,
): ApplyOutcome {
  const index = draft.anchors.findIndex((a) => a.npc === command.npc);
  const gone = draft.anchors[index];
  if (index < 0 || !gone) {
    const list = draft.anchors.map((a) => a.npc).join("、");
    return fail(`${command.npc} 不是锚点；现在的锚点：${list || "没有"}`);
  }
  const entry = { npc: gone.npc, name: gone.name, since: gone.since };
  draft.anchors.splice(index, 1);
  draft.lost.push({ ...entry, at: ctx.now, how: command.how });
  const how = ANCHOR_LOSS_LABELS[command.how];
  return {
    ok: true,
    notes: [`失去锚点：${entry.name}（${how}）`],
    emit: [
      {
        type: "humanity",
        delta: HUMANITY_KINDS.anchor.sizes.medium,
        reason: `失去锚点${entry.name}（${how}）：${command.reason}`,
        event: `anchor:${entry.npc}`,
      },
      anchored(draft),
    ],
  };
}

/** 吞下一片压制剂：背包扣一件，记下服用时间；14 天前的记录丢掉 */
export function takeSuppressant(
  draft: Draft<PsychosisState>,
  command: SuppressantCommand,
  ctx: SystemContext,
): ApplyOutcome {
  const backpack = ctx.read<InventoryState>("inventory").backpack;
  if ((backpack[SUPPRESSANT_ID] ?? 0) < 1) return fail("背包里没有压制剂");
  draft.doses = draft.doses.filter((t) => ctx.now - t < DEPENDENCE_WINDOW);
  const before = suppressantStatus(draft.doses, ctx.now);
  draft.doses.push(ctx.now);
  const after = suppressantStatus(draft.doses, ctx.now);
  const notes = [`压制剂起效到 ${formatGameTime(after.until ?? ctx.now)}`];
  if (after.tolerant && !before.tolerant) notes.push("一周里吃得太勤，开始耐受：药效变短");
  if (after.dependent && !before.dependent) {
    notes.push("两周里吃了太多次，已经依赖：停药一天就会戒断");
  }
  if (before.withdrawal) notes.push("戒断缓下来了");
  return {
    ok: true,
    notes,
    emit: [{ type: "item", action: "use", id: SUPPRESSANT_ID, reason: command.reason }],
  };
}

/** 给界面和提示词的锚点、压制剂情况 */
export function psychosisView(slice: unknown, now: number) {
  const state = PsychosisStateSchema.parse(slice ?? {});
  const s = suppressantStatus(state.doses, now);
  return {
    anchors: state.anchors.map((a) => ({
      npc: a.npc,
      name: a.name,
      since: formatGameTime(a.since),
    })),
    lost: state.lost.map((l) => ({
      npc: l.npc,
      name: l.name,
      how: ANCHOR_LOSS_LABELS[l.how],
      at: formatGameTime(l.at),
    })),
    max: ANCHORS_MAX,
    suppressant: {
      until: s.until === null ? null : formatGameTime(s.until),
      tolerant: s.tolerant,
      dependent: s.dependent,
      withdrawal: s.withdrawal,
    },
  };
}
