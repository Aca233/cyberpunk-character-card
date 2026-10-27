import type { RuleModule } from "../../kernel/system";
import { DV_MOD_CAP, MOD_STEP } from "../dice";
import { formatGameTime } from "../world";
import { canMove, moveOverdue } from "./apply";
import {
  HOW_MAX,
  NEMESES_MAX,
  NEMESIS_CRED_HALVES,
  NEMESIS_DUE_DAYS,
  NEMESIS_END_LABELS,
  NEMESIS_GAP_DAYS,
  NEMESIS_RISE_HOURS,
  NEMESIS_STYLE_LABELS,
  type NemesisState,
  PREP_MAX,
} from "./schema";

const DAY = 24 * 60;
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
- rise 或之后的 prep 写他回来前做的准备：against 写玩家最常用的打法（${STYLES}），按玩家这一路的检定和打法判断；prep 写他怎么专克这一手（例如装了防火墙专克快速破解，${PREP_MAX} 字以内）。打法变了可以再写 prep。
- 玩家扫描他、找人打听或亲眼看穿时写 nemesis reveal；在这之前正文只露端倪，不点破准备的内容。
- 宿敌标着「可以出场」时才亲自露面，每 ${NEMESIS_GAP_DAYS}–${NEMESIS_DUE_DAYS} 个游戏日最多一次；没标时只通过消息、传闻和被他找过麻烦的人带出他的动静。屏幕外的行动（打听玩家的下落、找玩家在乎的人麻烦、抢玩家的单子）由场外推演写，正文写这些行动的后果，不要自己另编一次。
- 了结宿敌写 nemesis end：end 写 killed（要先写他的死）、reconciled 或 gone（彻底退场），text 写怎么了结的。街头声望由代码自动加 ${NEMESIS_CRED_HALVES / 2} 级，不要另写 streetCred。`,
  judge: `- 玩家对上宿敌，用的打法正是他准备专克的（【宿敌】里写了专克什么）时，dvMods 加一项：source 写「宿敌的准备：他的名字」，+${MOD_STEP}，和其他修正合计不超过 +${DV_MOD_CAP}。玩家还不知道这个准备也照样加。`,
};

/** 给叙事模型的【宿敌】：怎么输的、准备（玩家知不知道）、最近的动静、能不能出场；还有刚打完能升级的人和了结过的 */
export function nemesisSection(state: NemesisState, now: number): string {
  const lines: string[] = [];
  for (const n of state.nemeses) {
    const days = Math.floor((now - (n.lastMoveAt ?? n.since)) / DAY);
    const prep = n.prep
      ? `准备：专克${NEMESIS_STYLE_LABELS[n.prep.against]}，${n.prep.text}（${n.known ? "玩家知道了" : "玩家还不知道"}）`
      : "还没写准备";
    const moves = n.moves.slice(-2).map((m) => `${formatGameTime(m.at)} ${m.text}`);
    const appear = canMove(n, now)
      ? "可以出场"
      : `${n.lastMoveAt === null ? "成了宿敌" : "上次动静"}才 ${days} 天，先别亲自露面`;
    lines.push(
      `- ${n.name}（${n.npc}），${formatGameTime(n.since)} 起成了宿敌；怎么输的：${n.how}；${prep}；${appear}${moves.length > 0 ? `；最近：${moves.join("；")}` : ""}`,
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

/** 给场外推演的【宿敌】：只列这次可以动的；拖太久的标「这次要写」 */
export function nemesisOffscreenSection(state: NemesisState, now: number): string {
  return state.nemeses
    .filter((n) => canMove(n, now))
    .map((n) => {
      const last = n.moves[n.moves.length - 1];
      return `- ${n.npc}：${n.name}，怎么输给玩家的：${n.how}${last ? `；上一步：${last.text}` : ""}${moveOverdue(n, now) ? "；这次要写" : ""}`;
    })
    .join("\n");
}
