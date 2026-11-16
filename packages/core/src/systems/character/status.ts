import type { StatusContext, SystemStatus } from "../../kernel/system";
import type { characterView } from "./view";

/** 【当前状态】里人物的几组行：名字与履历背景、习惯和闪回、过往里确认的事（彻底不展示属性点） */

type CharacterView = ReturnType<typeof characterView>;

const characterOf = (ctx: StatusContext) => ctx.views.character as CharacterView;

export const characterStatus: readonly SystemStatus[] = [
  {
    order: 10,
    lines(ctx) {
      const c = characterOf(ctx);
      return [
        `人物：${c.name ?? "（还没建档）"}${c.brief ? `。${c.brief}` : ""}`,
        `街面名声：${c.credTier}——${c.credWorld}`,
      ];
    },
  },
  {
    order: 70,
    lines(ctx) {
      const c = characterOf(ctx);
      const lines: string[] = [];
      if (c.habits.length > 0) lines.push(`习惯：${c.habits.join("；")}`);
      if (c.habitOffers.length > 0)
        lines.push(`提议过、等玩家确认的习惯：${c.habitOffers.join("；")}（不要再提）`);
      if (c.flashback) {
        lines.push(
          `闪回中：${c.flashback.past}，本段已经交互 ${c.flashback.turn} 次；不推进当前时间、不改当前财物；内容结束或玩家返回现在时写 flashback end 和确认的事`,
        );
      } else if (c.pasts.some((p) => !p.used)) {
        lines.push(
          `可以回忆的过往：${c.pasts
            .filter((p) => !p.used)
            .map((p) => p.label)
            .join("、")}`,
        );
      }
      return lines;
    },
  },
  {
    order: 90,
    lines(ctx) {
      const c = characterOf(ctx);
      return c.pastFacts.length > 0
        ? [
            `过往里确认的事（已确定的事实）：${c.pastFacts.map((f) => `${f.past}：${f.text}`).join("；")}`,
          ]
        : [];
    },
  },
];
