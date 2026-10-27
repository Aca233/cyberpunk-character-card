import type { RuleModule } from "../../kernel/system";
import {
  CITY_STATUS_LABELS,
  type CityState,
  RUMOR_REACH_LABELS,
  RUMOR_TRUTH_LABELS,
} from "./schema";

const NARRATE = `- 【城里的动静】是玩家角色没在场时城里在发生的事，只有你知道；角色没听说之前不算知道。可以借 N54 新闻快讯、电台、街头传闻、路人闲聊、一条消息让它透出来；一轮最多透一件，不必每轮都提，传到玩家耳朵里的版本可以夸大或走样。
- 标着「头条」的那件，近一两场里找机会让玩家听到或者撞上；和玩家做过的事有关的，让人认出来、议论、追究。几个街区在传的，等合适的人和地方再提；街角小事可以一直不提。
- N54 和电台用公司口径，带一点黑色幽默，和真相可以不一样；玩家主动打听时，按打听的渠道给对应的版本，不直接报真相。最近几轮正文已经提过的，别再原样播一遍。
- 战斗、潜入和闪回里不带。
- 【街头传闻】是街上在传的说法，标了和真相差多少（属实、夸大、走样）和传多远：在传播范围里的人才听说过；NPC 按自己听到的那个版本对待玩家（听说玩家一个人端了整个据点的，会怕、会想招揽、会想踩着玩家出名），不按真相；玩家打听时给传闻的版本，可以自己去辨真假。说的是玩家角色的那几条，也是「别人眼里的你」的一部分。`;

export const cityRules: RuleModule<CityState> = {
  id: "city",
  title: "城里的动静",
  commands: ["rumorHeard"],
  when: (state) => state.events.some((e) => e.status !== "over") || state.rumors.length > 0,
  narrate: NARRATE,
  text: `${NARRATE}
- 正文里有人把【街头传闻】里带编号的某一条说给玩家听了（原话或差不多的意思），抽取写 {"type": "rumorHeard", "id": 编号}；只是你知道、正文没让玩家听到的不写，玩家已经听说过的不再写。`,
};

/** 给模型看的【街头传闻】：新的在前；说的是玩家的标出来 */
export function rumorSection(state: CityState): string | undefined {
  if (state.rumors.length === 0) return undefined;
  return [...state.rumors]
    .reverse()
    .map((r) => {
      const where = r.reach !== "city" && r.district ? `，${r.district}` : "";
      const about = r.player ? "，说的是玩家角色" : "";
      const event = r.event ? `，关于 ${r.event}` : "";
      const heard = r.heard ? "，玩家听说过" : "";
      const id = r.id > 0 ? `#${r.id} ` : "";
      return `- ${id}「${r.text}」［${RUMOR_TRUTH_LABELS[r.truth]}，${RUMOR_REACH_LABELS[r.reach]}${where}${about}${event}${heard}］`;
    })
    .join("\n");
}

/** 「别人眼里的你」后面接的一句：最近两条说的是玩家角色的传闻原话 */
export function playerRumorLine(state: CityState): string | undefined {
  const mine = state.rumors.filter((r) => r.player).slice(-2);
  if (mine.length === 0) return undefined;
  return mine.map((r) => `「${r.text}」（${RUMOR_REACH_LABELS[r.reach]}）`).join("；");
}

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
