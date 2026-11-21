import type { Draft } from "immer";
import type { ApplyOutcome, SystemContext } from "../../kernel/system";
import type { NpcState } from "../npc";
import type { WorldClockState } from "../world";
import type { CommerceState, ServiceCommand, ServiceSession } from "./schema";

function isConfirmedAdult(npc: { age?: number | undefined; adult?: boolean | undefined }): boolean {
  if (npc.age !== undefined && npc.age < 18) return false;
  return npc.adult === true || (npc.age !== undefined && npc.age >= 18);
}

export function applyService(
  draft: Draft<CommerceState>,
  command: ServiceCommand,
  ctx: SystemContext,
): ApplyOutcome {
  const here = ctx.read<WorldClockState>("world").location;
  if (command.action === "start") {
    const existing = draft.sessions[command.id];
    if (existing) {
      return existing.status === "active"
        ? { ok: true }
        : { ok: false, reason: "该服务会话 id 已使用，请用新 id 开启下一次会话" };
    }
    if (!command.seller || !command.service) {
      return { ok: false, reason: "开启服务会话需要 seller 与 service" };
    }
    if (!here) return { ok: false, reason: "当前地点未确立，无法开启在场服务会话" };
    if (command.service === "adult-service") {
      const npcs = ctx.read<NpcState>("npc").npcs;
      const targetId = command.subject ?? command.seller;
      const person = npcs[targetId];
      if (person) {
        if (!person.alive) return { ok: false, reason: `${person.name}已死亡，不能开启服务会话` };
        if (!isConfirmedAdult(person)) {
          return { ok: false, reason: "只有已明确确认成年的角色才能参与成人服务" };
        }
      }
    }
    draft.sessions[command.id] = {
      id: command.id,
      seller: command.seller,
      service: command.service,
      subject: command.subject ?? null,
      location: here,
      startedAt: ctx.now,
      status: "active",
      ...(command.note ? { note: command.note } : {}),
    };
    return { ok: true, notes: [`已开始在场服务会话 ${command.id}`] };
  }

  const session = draft.sessions[command.id];
  if (!session) return { ok: false, reason: `没有找到服务会话 ${command.id}` };
  if (session.status === "finished" || session.status === "exited") {
    return (command.action === "finish" && session.status === "finished") ||
      (command.action === "exit" && session.status === "exited")
      ? { ok: true }
      : { ok: false, reason: "该服务会话已经结束" };
  }
  if (command.action === "pause") {
    session.status = "paused";
    if (command.note) session.note = command.note;
    return { ok: true, notes: ["服务会话已暂停"] };
  }
  if (command.action === "resume") {
    if (here !== session.location) return { ok: false, reason: "已离开原服务地点，无法恢复会话" };
    session.status = "active";
    if (command.note) session.note = command.note;
    return { ok: true, notes: ["服务会话已恢复"] };
  }
  session.status = command.action === "finish" ? "finished" : "exited";
  if (command.note) session.note = command.note;
  return {
    ok: true,
    notes: [command.action === "finish" ? "服务会话已结束" : "服务会话已中止"],
  };
}

export function serviceSessionText(session: ServiceSession): string {
  const statusLabel =
    session.status === "active"
      ? "进行中"
      : session.status === "paused"
        ? "暂停"
        : session.status === "finished"
          ? "已结束"
          : "已中止";
  return `服务会话 ${session.id}：${session.seller} ${session.service}${session.subject ? `／${session.subject}` : ""}（${statusLabel}，地点 ${session.location}${session.note ? `，${session.note}` : ""}）`;
}
