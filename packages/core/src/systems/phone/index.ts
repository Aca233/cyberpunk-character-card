import { defineSystem } from "../../kernel/system";
import { isOpen, type JobsState } from "../jobs";
import type { NpcState } from "../npc";
import { phoneActions } from "./actions";
import {
  answerCall,
  applyChatMeta,
  readAll,
  receiveCall,
  receiveMessage,
  replyMessage,
  sendPlayerMessage,
  tickCalls,
} from "./apply";
import { phoneFeed } from "./feed";
import { phoneMessagesView } from "./messages";
import { phoneRules } from "./prompt";
import {
  AnswerSchema,
  CallCommandSchema,
  ChatMetaSchema,
  type PhoneInternal,
  type PhoneState,
  PhoneStateSchema,
  ReadSchema,
  ReceiveSchema,
  ReplySchema,
  SendSchema,
} from "./schema";
import { phoneSections } from "./sections";
import { phoneStatus } from "./status";
import { phoneCallsView } from "./view";

function openJobIdsOf(jobs: JobsState): ReadonlySet<string> {
  return new Set(jobs.jobs.filter((j) => isOpen(j)).map((j) => j.id));
}

function contactNameOf(id: string, npcs: NpcState, jobs: JobsState): string {
  return npcs.npcs[id]?.name ?? jobs.fixers[id]?.name ?? id;
}

/** 消息：抽取按正文记 messages，玩家看、回复、私聊、全息电话 */
export const phone = defineSystem<PhoneState, never, PhoneInternal>({
  id: "phone",
  dependsOn: ["npc", "jobs"],
  state: PhoneStateSchema,
  initial: () => ({
    messages: [],
    nextId: 1,
    calls: [],
    nextCall: 1,
    feedRead: [],
    chatBudget: {},
  }),
  commands: {},
  internal: {
    "phone.receive": ReceiveSchema,
    "phone.read": ReadSchema,
    "phone.reply": ReplySchema,
    "phone.call": CallCommandSchema,
    "phone.answer": AnswerSchema,
    "phone.send": SendSchema,
    "phone.chatMeta": ChatMetaSchema,
  },
  apply(draft, command, ctx) {
    switch (command.type) {
      case "phone.call": {
        const caller = ctx.read<NpcState>("npc").npcs[command.from];
        if (caller?.alive === false) return { ok: false, reason: "对方已无法发起全息通话" };
        const name =
          caller?.name ?? ctx.read<JobsState>("jobs").fixers[command.from]?.name ?? command.from;
        return receiveCall(draft, command.from, name, command.about, ctx.now);
      }
      case "phone.answer": {
        const call = draft.calls.find((entry) => entry.id === command.id);
        if (command.answer && call && ctx.read<NpcState>("npc").npcs[call.from]?.alive === false) {
          return { ok: false, reason: "通讯已中断，对面没有回应" };
        }
        return answerCall(draft, command.id, command.answer, ctx.now);
      }
      case "phone.receive": {
        const npcs = ctx.read<NpcState>("npc");
        if (npcs.npcs[command.from]?.alive === false) {
          return { ok: false, reason: "对方已无法发送新消息" };
        }
        const jobs = ctx.read<JobsState>("jobs");
        if (command.job !== undefined) {
          const job = jobs.jobs.find((j) => j.id === command.job);
          if (job?.status !== "offered" || (job.due !== null && job.due <= ctx.now)) {
            return {
              ok: false,
              reason: `委托 ${command.job} 不存在或已不可接，不能附在派单消息里`,
            };
          }
        }
        return receiveMessage(
          draft,
          command.from,
          contactNameOf(command.from, npcs, jobs),
          command.text,
          ctx.now,
          command.job,
          openJobIdsOf(jobs),
        );
      }
      case "phone.send": {
        const jobs = ctx.read<JobsState>("jobs");
        const npcs = ctx.read<NpcState>("npc");
        return sendPlayerMessage(
          draft,
          command.to,
          contactNameOf(command.to, npcs, jobs),
          command.text,
          ctx.now,
          openJobIdsOf(jobs),
        );
      }
      case "phone.chatMeta":
        return applyChatMeta(draft, command);
      case "phone.read":
        return readAll(draft, command.feed);
      case "phone.reply":
        return replyMessage(draft, command.id, command.text, ctx.now);
    }
  },
  tick: (draft, span) => tickCalls(draft, span.to),
  rules: [phoneRules],
  sections: phoneSections,
  view: { key: "calls", project: phoneCallsView },
  views: [{ key: "phoneMessages", project: phoneMessagesView }],
  status: phoneStatus,
  actions: phoneActions,
  feed: phoneFeed,
});

export * from "./actions";
export * from "./apply";
export * from "./feed";
export * from "./messages";
export * from "./prompt";
export * from "./schema";
export * from "./sections";
export * from "./status";
export * from "./view";
