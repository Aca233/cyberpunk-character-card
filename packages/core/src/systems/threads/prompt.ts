import type { RuleModule } from "../../kernel/system";
import { formatGameTime } from "../world";
import { THREAD_KIND_LABELS, type Thread, type ThreadsState } from "./schema";

/**
 * 【城里在发酵的事】给写正文的规则（用户 2026-11-01 定的「全改」第 4 步：模型当主持人，代码只管记账）：
 * 原来势力动向、宿敌、心事各有一套到点的规矩，现在并成一张单子
 */
export const threadRules: RuleModule<ThreadsState> = {
  id: "threads",
  title: "城里在发酵的事",
  commands: ["thread", "threadTold"],
  when: (state, input) => input.mode !== "ooc" && state.threads.length + state.closed.length > 0,
  narrate: `- 【城里在发酵的事】是别人背地里在办的事和最近真发生了的事。怎么走、成不成由场外推演写，你不替它们往前走，也不写还没发生的结果。
- 标着「玩家还没听说」的，找合适的机会借新闻、电台、街头传闻、中间人或熟人透出来，用说话人的立场和偏见说；一轮最多透一件，战斗、潜入和闪回里不透。
- 玩家走进相关的城区或碰上相关的人，可以让这件事自然露出来，给玩家插手的机会；不硬塞。`,
  text: `- 正文里让玩家听说了某件事最近的事（新闻、传闻、消息、有人亲口说），写 threadTold，id 写那件事的 id；只听到风声、说不清是哪件的不算。
- 玩家亲手插手了才写 thread：帮它办成关键的一步写 push（马上到点）；拖住它（毁了货、抓了人、报了信）写 stall；彻底坏了它的事（干掉主事的人、端了据点、把证据交给对头）写 derail，这件事收场。reason 一句话写玩家做了什么。只是听说、议论不算插手。`,
};

function stepLine(t: Thread): string {
  const recent = t.steps.slice(-2).map((s) => {
    const who = s.kind === "move" ? "" : "玩家插手：";
    return `${formatGameTime(s.at)} ${who}${s.text}（${s.told ? "玩家听说了" : "玩家还没听说"}）`;
  });
  return recent.length > 0 ? `｜最近：${recent.join("；")}` : "｜还没有动静";
}

/** 给写正文的【城里在发酵的事】：在办的每一件，加最近收场的几件；没有时是 undefined */
export function threadSection(state: ThreadsState): string | undefined {
  const lines = state.threads.map(
    (t) =>
      `- ${t.id}｜${THREAD_KIND_LABELS[t.kind]}·${t.title}：想要${t.want}｜眼下：${t.stage}${stepLine(t)}`,
  );
  for (const t of state.closed.slice(-3)) {
    lines.push(`- ${t.id}｜已收场·${t.title}：${t.end}`);
  }
  return lines.length > 0 ? lines.join("\n") : undefined;
}
