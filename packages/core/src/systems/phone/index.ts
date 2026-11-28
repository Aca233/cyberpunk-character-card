import { defineSystem } from "../../kernel/system";
import { isOpen, type JobsState } from "../jobs";
import type { NpcState } from "../npc";
import { phoneActions } from "./actions";
import {
  addContact,
  answerCall,
  applyChatMeta,
  readAll,
  receiveCall,
  receiveMessage,
  removeContact,
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
  hasContactChannel,
  isContactBlocked,
  type PhoneCommand,
  PhoneContactSchema,
  type PhoneInternal,
  type PhoneState,
  PhoneStateSchema,
  ReadSchema,
  ReceiveSchema,
  ReplySchema,
  SeedContactSchema,
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

/** 按 id 优先查找人物卡或中间人；若模型误填中文名且唯一命中则回退解析其 id */
function resolveContactTarget(
  rawId: string,
  npcs: NpcState,
  jobs: JobsState,
): { readonly id: string; readonly name: string; readonly alive: boolean } | undefined {
  const directNpc = npcs.npcs[rawId];
  if (directNpc) return { id: directNpc.id, name: directNpc.name, alive: directNpc.alive };
  const directFixer = jobs.fixers[rawId];
  if (directFixer) {
    const fixerNpc = npcs.npcs[directFixer.id];
    return {
      id: directFixer.id,
      name: fixerNpc?.name ?? directFixer.name,
      alive: fixerNpc?.alive !== false,
    };
  }
  const byNpcName = Object.values(npcs.npcs).filter((n) => n.name === rawId);
  if (byNpcName.length === 1 && byNpcName[0]) {
    return { id: byNpcName[0].id, name: byNpcName[0].name, alive: byNpcName[0].alive };
  }
  const byFixerName = Object.values(jobs.fixers).filter((f) => f.name === rawId);
  if (byFixerName.length === 1 && byFixerName[0]) {
    const fixerNpc = npcs.npcs[byFixerName[0].id];
    return {
      id: byFixerName[0].id,
      name: fixerNpc?.name ?? byFixerName[0].name,
      alive: fixerNpc?.alive !== false,
    };
  }
  return undefined;
}

/** 消息与通讯录：抽取按正文记 messages 与 phoneContact，玩家看、回复、私聊、全息电话 */
export const phone = defineSystem<PhoneState, PhoneCommand, PhoneInternal>({
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
    contacts: {},
    blockedChannels: [],
  }),
  commands: {
    phoneContact: PhoneContactSchema,
  },
  internal: {
    "phone.receive": ReceiveSchema,
    "phone.read": ReadSchema,
    "phone.reply": ReplySchema,
    "phone.call": CallCommandSchema,
    "phone.answer": AnswerSchema,
    "phone.send": SendSchema,
    "phone.chatMeta": ChatMetaSchema,
    "phone.seedContact": SeedContactSchema,
  },
  apply(draft, command, ctx) {
    switch (command.type) {
      case "phoneContact": {
        const npcs = ctx.read<NpcState>("npc");
        const jobs = ctx.read<JobsState>("jobs");
        const history =
          draft.messages.find((message) => message.from === command.id) ??
          draft.calls.find((call) => call.from === command.id);
        const target =
          resolveContactTarget(command.id, npcs, jobs) ??
          (hasContactChannel(draft, command.id) || isContactBlocked(draft, command.id)
            ? { id: command.id, name: history?.name ?? command.id, alive: true }
            : undefined);
        if (!target) {
          return {
            ok: false,
            reason: `找不到人物或中间人 ${command.id}，先建卡再记录联系方式`,
          };
        }
        if (command.action === "remove") {
          return removeContact(draft, target.id, target.name, ctx.now);
        }
        if (!target.alive) {
          return { ok: false, reason: `${target.name} 已经死亡，无法交换联系方式` };
        }
        return addContact(draft, target.id, target.name, "exchange", ctx.now, command.note);
      }
      case "phone.seedContact": {
        const npcs = ctx.read<NpcState>("npc");
        const jobs = ctx.read<JobsState>("jobs");
        const name = contactNameOf(command.id, npcs, jobs);
        return addContact(draft, command.id, name, command.source, ctx.now, command.note, true);
      }
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
