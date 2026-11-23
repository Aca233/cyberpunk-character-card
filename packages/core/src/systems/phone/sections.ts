import type { SystemSection } from "../../kernel/system";
import { JobsStateSchema } from "../jobs";
import { deathKnown, NpcStateSchema } from "../npc";
import { formatGameTime } from "../world";
import { CALL_STATUS_LABELS, PhoneStateSchema } from "./schema";

/** 通讯录与通话用意：通讯录告诉三阶段哪些人已有私人频道；通话用意只给叙事模型，未接听时不泄露 */
export const phoneSections: readonly SystemSection[] = [
  {
    order: 145,
    title: "通讯录",
    stages: ["judge", "narrate", "extract"],
    render: ({ world }) => {
      const phone = PhoneStateSchema.parse(world.slices.phone ?? {});
      const npcs = NpcStateSchema.parse(world.slices.npc).npcs;
      const fixers = JobsStateSchema.parse(world.slices.jobs).fixers;
      const keys = new Set<string>([
        ...Object.keys(phone.contacts),
        ...phone.messages.map((m) => m.from),
        ...phone.calls.map((c) => c.from),
      ]);
      if (keys.size === 0) {
        return "暂无已交换联系方式的联系人（普通人物未在通讯录里时，双方没有彼此私人全息号）。";
      }
      const items = [...keys].map((id) => {
        const npc = npcs[id];
        const name = npc?.name ?? fixers[id]?.name ?? id;
        const deadTag = npc && deathKnown(npc) ? "，已故" : "";
        const note = phone.contacts[id]?.note ? `（${phone.contacts[id]?.note}）` : "";
        return `${name}［${id}${deadTag}］${note}`;
      });
      return `已有联系方式：${items.join("、")}。其余人物未留全息频道。`;
    },
  },
  {
    order: 150,
    title: "全息电话",
    stages: ["judge", "narrate"],
    render: ({ world }) => {
      const { calls } = PhoneStateSchema.parse(world.slices.phone ?? {});
      if (calls.length === 0) return undefined;
      return calls
        .slice(-3)
        .map((call) => {
          const line = `- #${call.id} ${call.name}｜${formatGameTime(call.at)}｜${CALL_STATUS_LABELS[call.status]}`;
          if (call.status === "ringing") {
            return `${line}。只写来电提示，不替玩家接听或拒接，不透露通话内容。`;
          }
          if (call.status === "answered") {
            return `${line}。来意（仅供幕后参考）：${call.about}。按已有正文接着写；已经说过的不重播，不替玩家回应。`;
          }
          return `${line}。没有接通，不写对方说出了来意。`;
        })
        .join("\n");
    },
  },
];
