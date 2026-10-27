import { defineSystem } from "../../kernel/system";
import type { JobsState } from "../jobs";
import type { NpcState } from "../npc";
import { phoneActions } from "./actions";
import { answerCall, readAll, receiveCall, receiveMessage, replyMessage, tickCalls } from "./apply";
import { phoneFeed } from "./feed";
import { phoneRules } from "./prompt";
import {
  AnswerSchema,
  CallCommandSchema,
  type PhoneInternal,
  type PhoneState,
  PhoneStateSchema,
  ReadSchema,
  ReceiveSchema,
  ReplySchema,
} from "./schema";
import { phoneSections } from "./sections";
import { phoneCallsView } from "./view";

/** 消息：抽取按正文记 messages，玩家看、回复；联系人、全息电话和完整通讯界面在 M3 */
export const phone = defineSystem<PhoneState, never, PhoneInternal>({
  id: "phone",
  dependsOn: ["npc", "jobs"],
  state: PhoneStateSchema,
  initial: () => ({ messages: [], nextId: 1, calls: [], nextCall: 1, feedRead: [] }),
  commands: {},
  internal: {
    "phone.receive": ReceiveSchema,
    "phone.read": ReadSchema,
    "phone.reply": ReplySchema,
    "phone.call": CallCommandSchema,
    "phone.answer": AnswerSchema,
  },
  apply(draft, command, ctx) {
    switch (command.type) {
      case "phone.call": {
        const name =
          ctx.read<NpcState>("npc").npcs[command.from]?.name ??
          ctx.read<JobsState>("jobs").fixers[command.from]?.name ??
          command.from;
        return receiveCall(draft, command.from, name, command.about, ctx.now);
      }
      case "phone.answer":
        return answerCall(draft, command.id, command.answer, ctx.now);
      case "phone.receive": {
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
        const name =
          ctx.read<NpcState>("npc").npcs[command.from]?.name ??
          jobs.fixers[command.from]?.name ??
          command.from;
        return receiveMessage(draft, command.from, name, command.text, ctx.now, command.job);
      }
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
  actions: phoneActions,
  feed: phoneFeed,
});

export * from "./actions";
export * from "./apply";
export * from "./feed";
export * from "./prompt";
export * from "./schema";
export * from "./sections";
export * from "./view";
