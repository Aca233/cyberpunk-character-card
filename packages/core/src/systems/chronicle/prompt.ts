import type { RuleModule } from "../../kernel/system";
import { formatGameTime } from "../world";
import { CHRONICLE_RECENT, type ChronicleState } from "./schema";

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
