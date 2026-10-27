import type { StatusContext, SystemStatus } from "../../kernel/system";
import { ATTRIBUTE_LABELS, type Attribute } from "../dice";
import type { characterView } from "./view";

/** 【当前状态】里人物的几组行：开头的名字和属性、习惯和闪回、过往里确认的事 */

type CharacterView = ReturnType<typeof characterView>;

const characterOf = (ctx: StatusContext) => ctx.views.character as CharacterView;

function attributeLine(values: Readonly<Record<Attribute, number>>): string {
  return (Object.keys(ATTRIBUTE_LABELS) as Attribute[])
    .map((a) => `${ATTRIBUTE_LABELS[a]} ${values[a]}`)
    .join("，");
}

export const characterStatus: readonly SystemStatus[] = [
  {
    order: 10,
    lines(ctx) {
      const c = characterOf(ctx);
      return [
        `角色：${c.name ?? "（还没建档）"}${c.brief ? `。${c.brief}` : ""}`,
        `属性：${attributeLine(c.attributes)}；街头声望 ${c.streetCred} 级${c.credHalf ? "（再得半级就升级）" : ""}，${c.credTier}：${c.credWorld}`,
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
          `闪回中：${c.flashback.past}，第 ${c.flashback.turn}/${c.flashback.turns} 轮；不掷骰、不推进时间、不记账，最后一轮写 flashback end 和确认的事`,
        );
      } else if (c.pasts.some((p) => !p.used)) {
        lines.push(
          `还能闪回的过往：${c.pasts
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
