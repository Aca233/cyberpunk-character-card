import type { Draft } from "immer";
import type { ApplyOutcome, SystemContext } from "../../kernel/system";
import type { NpcState } from "../npc";
import type { WorldClockState } from "../world";
import { tradeEvidence } from "./quotes";
import type { CommerceState, ServiceCommand, ServiceSession } from "./schema";

export function applyPaidService(
  draft: Draft<CommerceState>,
  id: string,
  ctx: SystemContext,
): ApplyOutcome {
  const quote = draft.quotes[id];
  if (
    quote?.status !== "offered" ||
    quote.kind !== "service" ||
    !["bd-session", "adult-service"].includes(quote.target) ||
    !quote.session
  )
    return { ok: false, reason: "缺少已约定的体验服务，不能建立消费记录" };
  if (draft.sessions[id]) return { ok: false, reason: "这份报价已经交付过服务，不能再次扣款" };
  const location = ctx.read<WorldClockState>("world").location;
  if (!location) return { ok: false, reason: "服务实际地点未确立" };
  if (Object.values(draft.sessions).some((s) => ["active", "paused"].includes(s.status)))
    return { ok: false, reason: "当前体验尚未结束；先继续或明确中止，再开始另一项体验" };
  draft.sessions[id] = {
    id,
    seller: quote.seller,
    service: quote.target as ServiceSession["service"],
    terms: { ...quote.session },
    price: quote.price,
    location,
    paidAt: ctx.now,
    elapsed: 0,
    status: "active",
  };
  return { ok: true, notes: ["已按本次约定支付；实际播放或相处进度另记，后续不再次扣款"] };
}

export function syncServiceProgress(
  draft: Draft<CommerceState>,
  id: string,
  elapsed: number,
  status: ServiceSession["status"],
): ApplyOutcome {
  const session = draft.sessions[id];
  if (!session) return { ok: false, reason: "没有这次已付款服务" };
  if (elapsed < session.elapsed) return { ok: false, reason: "已实际经过的服务时间不能倒退" };
  if (["finished", "exited"].includes(session.status))
    return elapsed === session.elapsed && status === session.status
      ? { ok: true }
      : { ok: false, reason: "本次服务已经结束；重新消费需要新的明确约定" };
  if (session.service === "adult-service" && elapsed > session.terms.duration)
    return { ok: false, reason: "超出已接受的服务时长；延长范围需要重新约定" };
  session.elapsed = elapsed;
  session.status = status;
  return { ok: true };
}

export function applyService(
  draft: Draft<CommerceState>,
  command: ServiceCommand,
  ctx: SystemContext,
): ApplyOutcome {
  const session = draft.sessions[command.id];
  if (!session) return { ok: false, reason: "需要这一次已经实际成交的服务" };
  if (!tradeEvidence(ctx.facts, command.evidence))
    return { ok: false, reason: "服务进展缺少本轮正文依据" };
  if (session.service === "bd-session") {
    if (command.action !== "exit")
      return { ok: false, reason: "超梦体验进度由 braindance 处理；未接入的已付款服务可单独 exit" };
    const active = ctx.data.braindanceActivity as
      | { source: { kind: string; id: string } }
      | null
      | undefined;
    if (active?.source.kind === "service" && active.source.id === session.id)
      return { ok: false, reason: "当前正在接入这次超梦，请用 braindance exit 一起保存观看位置" };
    if (command.elapsed !== undefined && command.elapsed !== session.elapsed)
      return { ok: false, reason: "取消尚未接入的超梦服务不虚构观看时间" };
    const result = syncServiceProgress(draft, session.id, session.elapsed, "exited");
    return result.ok
      ? { ok: true, notes: ["已结束这次未接入的按次服务；不伪造播放、重复收费或自动退款"] }
      : result;
  }
  const elapsed =
    command.elapsed ?? (command.action === "finish" ? session.terms.duration : session.elapsed);
  const status =
    command.action === "finish"
      ? "finished"
      : command.action === "exit"
        ? "exited"
        : command.action === "pause"
          ? "paused"
          : "active";
  if (["finished", "exited"].includes(session.status))
    return syncServiceProgress(draft, session.id, elapsed, status);
  if (command.action === "finish" && elapsed !== session.terms.duration)
    return { ok: false, reason: "正常完成需经过约定时长；提前结束请记录 exit 和实际分钟" };
  if (command.action === "resume" && (session.status !== "paused" || elapsed !== session.elapsed))
    return { ok: false, reason: "恢复只能从已暂停位置开始，不补算暂停期间时间" };
  if (session.status === "paused" && !["resume", "exit"].includes(command.action))
    return { ok: false, reason: "服务已暂停，先恢复或明确中止" };
  if (session.status === "paused" && elapsed !== session.elapsed)
    return { ok: false, reason: "暂停期间不补算服务分钟；需要先恢复" };
  if (command.action !== "exit" || elapsed > session.elapsed) {
    const here = ctx.read<WorldClockState>("world").location;
    if (here !== session.location) return { ok: false, reason: "已离开本次服务地点，不能隔空继续" };
    const people = ctx.read<NpcState>("npc").npcs;
    const provider = people[session.terms.subject];
    if (!provider?.alive || provider.location !== here)
      return { ok: false, reason: "本次服务者不在现场或无法继续" };
  }
  const delta = elapsed - session.elapsed;
  const result = syncServiceProgress(draft, command.id, elapsed, status);
  return result.ok
    ? {
        ok: true,
        advanceTo: ctx.now + delta,
        notes: [
          `本次服务已实际经过 ${elapsed} 分钟；${status === "finished" ? "正常结束" : status === "exited" ? "中止，按原约定保留实际消费" : status === "paused" ? "已暂停" : "继续相处"}`,
        ],
      }
    : result;
}

export function serviceSessionText(session: ServiceSession): string {
  return `${session.id}：${session.seller} ${session.service}／${session.terms.subject}；${session.status}；已实际 ${session.elapsed}/${session.terms.duration} 分钟；已支付 ${session.price} 欧元；范围：${session.terms.scope}；记录${session.terms.recording ? "已获许可但不代表已发生" : "未获许可"}；中止约定：${session.terms.earlyExit}`;
}
