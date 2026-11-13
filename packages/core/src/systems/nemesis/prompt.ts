import type { RuleModule } from "../../kernel/system";
import { formatGameTime } from "../world";
import {
  HOW_MAX,
  NEMESES_MAX,
  NEMESIS_CRED_HALVES,
  NEMESIS_END_LABELS,
  NEMESIS_RISE_HOURS,
  NEMESIS_STYLE_LABELS,
  type NemesisState,
  PREP_MAX,
} from "./schema";

const WORDS = /宿敌/;
const STYLES = Object.entries(NEMESIS_STYLE_LABELS)
  .map(([id, label]) => `${id} ${label}`)
  .join("、");

export const nemesisRules: RuleModule<NemesisState> = {
  id: "nemesis",
  title: "宿敌",
  commands: ["nemesis"],
  when: (state, input) =>
    input.mode !== "ooc" &&
    (state.nemeses.length > 0 || state.recent !== null || WORDS.test(input.text)),
  text: `- 有人物卡、活着的敌人在战斗里逃走（combat foe 写了 fled），或战斗结束后 ${NEMESIS_RISE_HOURS} 小时内被玩家放走，而且真结下了梁子（被当众羞辱、丢了地盘或手下、发誓报复），写 nemesis rise 把他升级成宿敌：how 写他是怎么输给玩家的（${HOW_MAX} 字以内）。同时最多 ${NEMESES_MAX} 个；只是跑掉的杂鱼不要升。
- rise 或之后的 prep 写他回来前做的准备：against 写玩家最常用的打法（${STYLES}），按玩家这一路实际使顺手的战斗与应对方式判断；prep 写他怎么专克这一手（例如装了防火墙专克快速破解，${PREP_MAX} 字以内）。打法变了可以再写 prep。
- 玩家扫描他、找人打听或亲眼看穿时写 nemesis reveal；在这之前正文只露端倪，不点破准备的内容。
- 他什么时候亲自露面由你按情势定；没露面时通过消息、传闻和被他找过麻烦的人带出他的动静。他在屏幕外的报复（打听玩家的下落、找玩家在乎的人麻烦、抢玩家的单子）记在【城里在发酵的事】里，正文写这些行动的后果，不要自己另编一次。
- 了结宿敌写 nemesis end：end 写 killed（要先写他的死）、reconciled 或 gone（彻底退场），text 写怎么了结的。街头声望由代码自动加 ${NEMESIS_CRED_HALVES / 2} 级，不要另写 streetCred。`,
  judge: `- 玩家对上宿敌，用的打法正是他准备专克的（【宿敌】里写了专克什么）时，对方有备而来、手里握着克制手段（反制黑冰、重甲、埋伏等），玩家再用这套老办法会被直接卡死或反咬，裁决必须如实体现这份针对性优势。玩家还不知道这个准备也照样生效。`,
};

/**
 * 给叙事模型的【宿敌】：怎么输的、准备（玩家知不知道）；还有刚打完能升级的人和了结过的。
 * 屏幕外的动静和露面间隔不再写在这里，动静记在【城里在发酵的事】（用户 2026-11-01 定的「全改」第 4 步）
 */
export function nemesisSection(state: NemesisState, now: number): string {
  const lines: string[] = [];
  for (const n of state.nemeses) {
    const prep = n.prep
      ? `准备：专克${NEMESIS_STYLE_LABELS[n.prep.against]}，${n.prep.text}（${n.known ? "玩家知道了" : "玩家还不知道"}）`
      : "还没写准备";
    lines.push(
      `- ${n.name}（${n.npc}），${formatGameTime(n.since)} 起成了宿敌；怎么输的：${n.how}；${prep}`,
    );
  }
  const taken = new Set([...state.nemeses, ...state.ended].map((n) => n.npc));
  const candidates = (state.recent?.foes ?? []).filter((id) => !taken.has(id));
  if (state.recent && state.recent.until > now && candidates.length > 0) {
    lines.push(
      `- 刚打完的仗里活下来的有卡敌人：${candidates.join("、")}；${formatGameTime(state.recent.until)} 前可以升级成宿敌${state.nemeses.length >= NEMESES_MAX ? `（宿敌已满 ${NEMESES_MAX} 个，要先了结一个）` : ""}`,
    );
  }
  for (const e of state.ended.slice(-3)) {
    lines.push(`- 已了结：${e.name}，${NEMESIS_END_LABELS[e.end]}：${e.text}`);
  }
  return lines.join("\n");
}
