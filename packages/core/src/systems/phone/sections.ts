import type { SystemSection } from "../../kernel/system";
import { formatGameTime } from "../world";
import { CALL_STATUS_LABELS, PhoneStateSchema } from "./schema";

/** 通话用意只给叙事模型；未接听时不能泄露，也不能替玩家接起 */
export const phoneSections: readonly SystemSection[] = [
  {
    order: 150,
    title: "全息电话",
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
            return `${line}。来意（仅供叙事模型）：${call.about}。按已有正文接着写；已经说过的不重播，不替玩家回应。`;
          }
          return `${line}。没有接通，不写对方说出了来意。`;
        })
        .join("\n");
    },
  },
];
