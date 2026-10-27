import type { ViewContext } from "../../kernel/system";
import { formatGameTime } from "../world";
import {
  NEMESIS_CRED_HALVES,
  NEMESIS_END_LABELS,
  NEMESIS_STYLE_LABELS,
  NemesisStateSchema,
} from "./schema";

/**
 * 人物列表里的宿敌一栏，按人物 id：怎么输给你的；准备只在扫描或打听到以后给，屏幕外的动静不在这里。
 * 了结了的写怎么了结的；不是宿敌的人不在表里
 */
export function nemesisCardsView({ world }: ViewContext) {
  // 旧存档没有宿敌系统
  const state = NemesisStateSchema.parse(world.slices.nemesis ?? {});
  const cards: Record<
    string,
    {
      readonly how: string;
      readonly since: string;
      readonly prep: string | null;
      readonly ended: string | null;
    }
  > = {};
  for (const e of state.ended) {
    if (cards[e.npc]) continue;
    cards[e.npc] = {
      how: e.how,
      since: formatGameTime(e.since),
      prep: null,
      ended: `${NEMESIS_END_LABELS[e.end]}：${e.text}`,
    };
  }
  // 还在的宿敌优先于同一个人了结过的旧记录
  const active: typeof cards = {};
  for (const a of state.nemeses) {
    if (active[a.npc]) continue;
    active[a.npc] = {
      how: a.how,
      since: formatGameTime(a.since),
      prep:
        a.prep && a.known ? `专克${NEMESIS_STYLE_LABELS[a.prep.against]}：${a.prep.text}` : null,
      ended: null,
    };
  }
  return { ...cards, ...active };
}

/** 了结了的宿敌：界面按新出现的弹结算卡；旧的在前。屏幕外的动静和没揭露的准备不在这里 */
export function nemesesEndedView({ world }: ViewContext) {
  // 旧存档没有宿敌系统
  const state = NemesisStateSchema.parse(world.slices.nemesis ?? {});
  return state.ended.map((e) => ({
    npc: e.npc,
    name: e.name,
    end: e.end,
    endLabel: NEMESIS_END_LABELS[e.end],
    text: e.text,
    how: e.how,
    since: formatGameTime(e.since),
    at: formatGameTime(e.at),
    /** 了结宿敌给的街头声望（级） */
    cred: NEMESIS_CRED_HALVES / 2,
  }));
}
