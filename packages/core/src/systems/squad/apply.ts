import type { Draft } from "immer";
import type { ApplyOutcome, SystemContext } from "../../kernel/system";
import { memberDeathBlocked } from "../dice";
import type { NpcState } from "../npc";
import { formatGameTime } from "../world";
import {
  GONE_KEPT,
  GONE_WHY_LABELS,
  type GoneWhy,
  MEMBER_STATUS_LABELS,
  PREPAY_MAX,
  SHARE_TOTAL_MAX,
  SQUAD_KIND_LABELS,
  SQUAD_MAX,
  type SquadCommand,
  type SquadInternal,
  type SquadKind,
  type SquadState,
  SquadStateSchema,
  WAGE_PERIOD,
} from "./schema";

const fail = (reason: string): ApplyOutcome => ({ ok: false, reason });

/** 条件的一句话：分成或周薪 */
export function termsLabel(m: { kind: SquadKind; share: number; wage: number }): string {
  return m.kind === "friend" ? `分成 ${m.share}%` : `周薪 ${m.wage.toLocaleString("en-US")} 欧元`;
}

function sharesTaken(members: readonly { kind: SquadKind; share: number }[]): number {
  return members.reduce((sum, m) => sum + (m.kind === "friend" ? m.share : 0), 0);
}

function removeMember(
  draft: Draft<SquadState>,
  npc: string,
  why: GoneWhy,
  at: number,
  note?: string,
): void {
  const i = draft.members.findIndex((m) => m.npc === npc);
  const member = draft.members[i];
  if (!member) return;
  draft.members.splice(i, 1);
  draft.gone.push({ npc, name: member.name, why, at, ...(note === undefined ? {} : { note }) });
  if (draft.gone.length > GONE_KEPT) draft.gone.splice(0, draft.gone.length - GONE_KEPT);
}

/** 叙事模型的 squad 指令 */
export function applySquad(
  draft: Draft<SquadState>,
  command: SquadCommand,
  ctx: SystemContext,
): ApplyOutcome {
  const card = ctx.read<NpcState>("npc").npcs[command.npc];
  const name = card?.name ?? command.npc;
  const member = draft.members.find((m) => m.npc === command.npc);
  switch (command.action) {
    case "offer": {
      if (!card) return fail(`没有人物卡 ${command.npc}；先写 npc 建卡`);
      if (!card.met) return fail(`还没见过${name}`);
      if (!card.alive) return fail(`${name}已经死了`);
      if (member) return fail(`${name}已经在小队里`);
      if (draft.members.length >= SQUAD_MAX) return fail(`小队已经满了（最多 ${SQUAD_MAX} 人）`);
      if (command.kind === undefined) return fail("offer 要写 kind：friend 或 hired");
      if (command.specialty === undefined || command.trouble === undefined) {
        return fail("offer 要写 specialty（专长）和 trouble（个人麻烦）");
      }
      let share = 0;
      let wage = 0;
      if (command.kind === "friend") {
        if (command.share === undefined) return fail("朋友型要写 share（分成百分比）");
        const taken = sharesTaken(draft.members);
        if (taken + command.share > SHARE_TOTAL_MAX) {
          return fail(`分成合计不能超过 ${SHARE_TOTAL_MAX}%；已经分出 ${taken}%`);
        }
        share = command.share;
      } else {
        if (command.wage === undefined) return fail("雇佣型要写 wage（周薪）");
        wage = command.wage;
      }
      const offer = {
        npc: command.npc,
        name: card.name,
        kind: command.kind,
        share,
        wage,
        specialty: command.specialty,
        trouble: command.trouble,
        at: ctx.now,
      };
      const i = draft.offers.findIndex((o) => o.npc === command.npc);
      if (i >= 0) draft.offers[i] = offer;
      else draft.offers.push(offer);
      return {
        ok: true,
        notes: [
          `${card.name}想入队（${SQUAD_KIND_LABELS[command.kind]}，${termsLabel(offer)}）：等玩家确认`,
        ],
      };
    }
    case "leave": {
      if (member) {
        removeMember(draft, command.npc, "left", ctx.now, command.reason);
        return { ok: true, notes: [`${name}离开了小队：${command.reason}`] };
      }
      const i = draft.offers.findIndex((o) => o.npc === command.npc);
      if (i < 0) return fail(`${name}不在小队里`);
      draft.offers.splice(i, 1);
      return { ok: true, notes: [`${name}收回了入队的话`] };
    }
    case "status": {
      if (!member) return fail(`${name}不在小队里`);
      if (command.status === undefined) return fail("status 要写 status：ok、hurt 或 captured");
      if (member.status === command.status) return { ok: true };
      member.status = command.status;
      return {
        ok: true,
        notes: [`队员${name}：${MEMBER_STATUS_LABELS[command.status]}（${command.reason}）`],
      };
    }
    case "dead": {
      if (!member) return fail(`${name}不在小队里；不是队员的人死了写 npcDeath`);
      // 保底：检定事先点名警告过致命危险、又失败了才会死
      const names = [
        member.name,
        ...(card ? [card.name] : []),
        ...(card?.alias ? [card.alias] : []),
      ];
      const blocked = memberDeathBlocked(ctx.facts, names);
      if (blocked) return fail(blocked);
      removeMember(draft, command.npc, "dead", ctx.now, command.reason);
      return {
        ok: true,
        notes: [`队员${name}死了：${command.reason}`],
        ...(card?.alive
          ? { emit: [{ type: "npcDeath", id: command.npc, reason: command.reason }] }
          : {}),
      };
    }
  }
}

/** 界面动作：玩家回应入队请求、请人离开、发薪水 */
export function applyMember(
  draft: Draft<SquadState>,
  command: SquadInternal,
  ctx: SystemContext,
): ApplyOutcome {
  const card = ctx.read<NpcState>("npc").npcs[command.npc];
  const name = card?.name ?? command.npc;
  const member = draft.members.find((m) => m.npc === command.npc);
  switch (command.action) {
    case "accept": {
      const i = draft.offers.findIndex((o) => o.npc === command.npc);
      const offer = draft.offers[i];
      if (!offer) return fail(`${name}没有提过入队`);
      if (!card?.alive) return fail(`${name}已经死了`);
      if (member) return fail(`${name}已经在小队里`);
      if (draft.members.length >= SQUAD_MAX) return fail(`小队已经满了（最多 ${SQUAD_MAX} 人）`);
      if (offer.kind === "friend") {
        const taken = sharesTaken(draft.members);
        if (taken + offer.share > SHARE_TOTAL_MAX) {
          return fail(`分成合计不能超过 ${SHARE_TOTAL_MAX}%；已经分出 ${taken}%`);
        }
      }
      draft.offers.splice(i, 1);
      const hired = offer.kind === "hired";
      draft.members.push({
        npc: offer.npc,
        name: offer.name,
        kind: offer.kind,
        share: offer.share,
        wage: offer.wage,
        specialty: offer.specialty,
        trouble: offer.trouble,
        since: ctx.now,
        status: "ok",
        paidUntil: hired ? ctx.now + WAGE_PERIOD : null,
      });
      const notes = [`${offer.name}入队（${SQUAD_KIND_LABELS[offer.kind]}，${termsLabel(offer)}）`];
      if (!hired || offer.wage <= 0) return { ok: true, notes };
      return {
        ok: true,
        notes,
        emit: [
          {
            type: "money",
            delta: -offer.wage,
            reason: `${offer.name}的第一周薪水`,
            event: `squad:wage:${offer.npc}:${ctx.now}`,
          },
        ],
      };
    }
    case "decline": {
      const i = draft.offers.findIndex((o) => o.npc === command.npc);
      if (i < 0) return fail(`${name}没有提过入队`);
      draft.offers.splice(i, 1);
      return { ok: true, notes: [`回绝了${name}的入队请求`] };
    }
    case "dismiss": {
      if (!member) return fail(`${name}不在小队里`);
      removeMember(draft, command.npc, "dismissed", ctx.now);
      return { ok: true, notes: [`请${name}离开了小队`] };
    }
    case "pay": {
      if (!member) return fail(`${name}不在小队里`);
      if (member.kind !== "hired" || member.paidUntil === null) {
        return fail(`${name}是朋友型，按分成拿钱，不发薪水`);
      }
      const from = member.paidUntil;
      if (from - ctx.now >= PREPAY_MAX * WAGE_PERIOD) {
        return fail(`${name}的薪水已经付到 ${formatGameTime(from)}`);
      }
      const weeks = ctx.now < from ? 1 : Math.floor((ctx.now - from) / WAGE_PERIOD) + 1;
      member.paidUntil = from + weeks * WAGE_PERIOD;
      return {
        ok: true,
        notes: [`给${name}发了 ${weeks} 周薪水，付到 ${formatGameTime(member.paidUntil)}`],
        emit: [
          {
            type: "money",
            delta: -weeks * member.wage,
            reason: `${name}的薪水（${weeks} 周）`,
            event: `squad:wage:${command.npc}:${from}`,
          },
        ],
      };
    }
  }
}

/** 时间推进：死了的人移出小队；雇佣型欠薪超过一期就走 */
export function tickSquad(draft: Draft<SquadState>, to: number, npcs: NpcState["npcs"]): void {
  for (const m of [...draft.members]) {
    if (!npcs[m.npc]?.alive) removeMember(draft, m.npc, "dead", to);
    else if (m.kind === "hired" && m.paidUntil !== null && to >= m.paidUntil + WAGE_PERIOD) {
      removeMember(draft, m.npc, "left", m.paidUntil + WAGE_PERIOD, "薪水断了一周，走了");
    }
  }
  for (let i = draft.offers.length - 1; i >= 0; i--) {
    const offer = draft.offers[i];
    if (offer && !npcs[offer.npc]?.alive) draft.offers.splice(i, 1);
  }
}

/** 欠了几期薪水；朋友型和没欠的是 0 */
export function owedWeeks(m: { kind: SquadKind; paidUntil: number | null }, now: number): number {
  if (m.kind !== "hired" || m.paidUntil === null || now < m.paidUntil) return 0;
  return Math.floor((now - m.paidUntil) / WAGE_PERIOD) + 1;
}

export function squadView(slice: unknown, npcs: NpcState["npcs"], now: number) {
  const state = SquadStateSchema.parse(slice ?? {});
  return {
    max: SQUAD_MAX,
    members: state.members.map((m) => {
      const card = npcs[m.npc];
      const owed = owedWeeks(m, now);
      return {
        npc: m.npc,
        name: m.name,
        kind: m.kind,
        kindLabel: SQUAD_KIND_LABELS[m.kind],
        terms: termsLabel(m),
        share: m.share,
        wage: m.wage,
        specialty: m.specialty,
        trouble: m.trouble,
        status: m.status,
        statusLabel: MEMBER_STATUS_LABELS[m.status],
        since: formatGameTime(m.since),
        affinity: card?.affinity ?? 0,
        doing: card?.doing?.text ?? null,
        here: card !== undefined && card.lastSeenAt === now,
        paidUntil: m.paidUntil === null ? null : formatGameTime(m.paidUntil),
        owed,
        /** 欠薪时再过多久不发就走 */
        leavesAt:
          owed > 0 && m.paidUntil !== null ? formatGameTime(m.paidUntil + WAGE_PERIOD) : null,
        canPay:
          m.kind === "hired" &&
          m.paidUntil !== null &&
          m.paidUntil - now < PREPAY_MAX * WAGE_PERIOD,
      };
    }),
    offers: state.offers.map((o) => ({
      npc: o.npc,
      name: o.name,
      kind: o.kind,
      kindLabel: SQUAD_KIND_LABELS[o.kind],
      terms: termsLabel(o),
      wage: o.wage,
      specialty: o.specialty,
      trouble: o.trouble,
      at: formatGameTime(o.at),
    })),
    gone: [...state.gone]
      .reverse()
      .slice(0, 5)
      .map((g) => ({
        npc: g.npc,
        name: g.name,
        why: GONE_WHY_LABELS[g.why],
        at: formatGameTime(g.at),
        note: g.note ?? null,
      })),
  };
}
