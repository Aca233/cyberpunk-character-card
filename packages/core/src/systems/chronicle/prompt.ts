import type { RuleModule } from "../../kernel/system";
import { formatGameTime } from "../world";
import { CHRONICLE_RECENT, type ChronicleState, ENDING_LABELS } from "./schema";

export const chronicleRules: RuleModule<ChronicleState> = {
  id: "chronicle",
  title: "履历",
  commands: ["chronicle"],
  when: () => true,
  judge: "",
  narrate: "",
  text: `- 一段剧情告一段落时（一单委托收尾、一条个人线收住、一段关系有了结果、角色的处境大变），写一条 chronicle 记进角色的履历：标题像章节名，正文两三句、第三人称、过去时，只写正文里已经发生的事。
- 履历玩家在角色卡上看得到：不写角色还不知道的事（别人的秘密、委托的内幕、没揭开的伏笔）。
- 不要每轮都写；【履历】里列了最近记下的几段，同一件事别记两次。`,
};

/** 给模型看的【履历】：最近几段的标题，免得重复记；没有就是 undefined */
export function chronicleSection(state: ChronicleState): string | undefined {
  const recent = state.arcs.slice(-CHRONICLE_RECENT);
  if (recent.length === 0) return undefined;
  return `最近记下的：${recent.map((a) => `「${a.title}」（${formatGameTime(a.at)}）`).join("、")}`;
}

/** 给模型看的【传说名册】：开局时已经进名册的前人；没有就是 undefined */
export function legendsSection(state: ChronicleState): string | undefined {
  if (state.legends.length === 0) return undefined;
  const lines = state.legends.map(
    (l) => `- ${l.name}（${ENDING_LABELS[l.ending]}，${l.when}）：${l.line}`,
  );
  return [
    "这座城里以前的传奇（玩家以前的角色），都是过去的事：",
    ...lines,
    "可以让酒保、中间人、街上的人提起他们，他们留下的东西、欠下的人情、认识他们的人也能出现；死了的人不会回来，退休的人很少露面、露面也只是配角。不要让他们抢戏，也不要每轮都提。",
  ].join("\n");
}
