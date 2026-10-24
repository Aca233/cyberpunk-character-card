import type { RuleModule } from "../../kernel/system";
import { CITY_STATUS_LABELS, type CityState } from "./schema";

const NARRATE = `- 【城里的动静】是玩家角色没在场时城里在发生的事，只有你知道；角色没听说之前不算知道。可以借 N54 新闻快讯、电台、街头传闻、路人闲聊、一条消息让它透出来；一轮最多透一件，不必每轮都提，传到玩家耳朵里的版本可以夸大或走样。
- 标着「头条」的那件，近一两场里找机会让玩家听到或者撞上；和玩家做过的事有关的，让人认出来、议论、追究。几个街区在传的，等合适的人和地方再提；街角小事可以一直不提。
- N54 和电台用公司口径，带一点黑色幽默，和真相可以不一样；玩家主动打听时，按打听的渠道给对应的版本，不直接报真相。最近几轮正文已经提过的，别再原样播一遍。
- 战斗、潜入和闪回里不带。`;

export const cityRules: RuleModule<CityState> = {
  id: "city",
  title: "城里的动静",
  commands: [],
  when: (state) => state.events.some((e) => e.status !== "over"),
  narrate: NARRATE,
  text: NARRATE,
};

/** 给模型看的【城里的动静】：没结束的，最近有变化的在前 */
export function citySection(state: CityState): string | undefined {
  const live = state.events
    .filter((e) => e.status !== "over")
    .sort((a, b) => b.updatedAt - a.updatedAt);
  if (live.length === 0) return undefined;
  return live
    .map((e) => {
      const weight =
        e.weight === "major" ? "，头条" : e.weight === "normal" ? "，几个街区在传" : "";
      const where = e.district ? `${e.district}：` : "";
      return `- ${e.title}［${e.id}，${CITY_STATUS_LABELS[e.status]}${weight}］${where}${e.body}`;
    })
    .join("\n");
}
