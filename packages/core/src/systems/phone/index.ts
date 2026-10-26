import { defineSystem } from "../../kernel/system";
import type { JobsState } from "../jobs";
import type { NpcState } from "../npc";
import { readAll, receiveMessage, replyMessage } from "./apply";
import { phoneRules } from "./prompt";
import {
  type PhoneInternal,
  type PhoneState,
  PhoneStateSchema,
  ReadSchema,
  ReceiveSchema,
  ReplySchema,
} from "./schema";

/** 消息：抽取按正文记 messages，玩家看、回复；联系人、全息电话和完整通讯界面在 M3 */
export const phone = defineSystem<PhoneState, never, PhoneInternal>({
  id: "phone",
  dependsOn: ["npc", "jobs"],
  state: PhoneStateSchema,
  initial: () => ({ messages: [], nextId: 1 }),
  commands: {},
  internal: {
    "phone.receive": ReceiveSchema,
    "phone.read": ReadSchema,
    "phone.reply": ReplySchema,
  },
  apply(draft, command, ctx) {
    switch (command.type) {
      case "phone.receive": {
        const name =
          ctx.read<NpcState>("npc").npcs[command.from]?.name ??
          ctx.read<JobsState>("jobs").fixers[command.from]?.name ??
          command.from;
        return receiveMessage(draft, command.from, name, command.text, ctx.now);
      }
      case "phone.read":
        return readAll(draft);
      case "phone.reply":
        return replyMessage(draft, command.id, command.text, ctx.now);
    }
  },
  rules: [phoneRules],
});

export * from "./apply";
export * from "./prompt";
export * from "./schema";
