import type { RuleModule } from "../../kernel/system";
import type { InventoryState } from "./schema";

const WORDS = /零件|拆解|拆成零件|升级武器/;

export const partsRules: RuleModule<InventoryState> = {
  id: "parts",
  title: "零件",
  commands: ["parts"],
  when: (state, input) => input.mode !== "ooc" && (state.parts > 0 || WORDS.test(input.text)),
  text: `- 零件是拆东西得来的，用来给武器升稀有度。玩家自己拆背包里的东西、给武器升级在界面上做，你不发指令；剧情里搜刮到、拆了场景里的设备、别人送的零件写 parts（正数），剧情里花掉写负数，零件不够时整条不生效。
- 【当前状态】武器栏括号里写着"升到某档"的武器按那一档写手感和威力。`,
};
