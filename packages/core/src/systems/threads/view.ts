import type { ViewContext } from "../../kernel/system";
import { formatGameTime } from "../world";
import { ThreadsStateSchema } from "./schema";

/**
 * 玩家只看听说过的消息，不带幕后目标、阶段和倒计时；
 * 暗中收场也不显示收场标记，标题用最近听到的说法，避免透露秘密
 * （用户 2026-11-01 定的「全改」第 4 步："只显示听说过的"）
 */
export function threadsView({ world }: ViewContext) {
  const state = ThreadsStateSchema.parse(world.slices.threads ?? {});
  return [...state.threads, ...state.closed]
    .flatMap((t) => {
      const heard = t.steps.filter((s) => s.told);
      const latest = heard.at(-1);
      if (!latest) return [];
      return [
        {
          id: t.id,
          title: latest.news,
          at: latest.at,
          news: heard.map((s) => ({
            text: s.news,
            at: s.at,
            time: formatGameTime(s.at),
          })),
        },
      ];
    })
    .sort((a, b) => b.at - a.at || a.id.localeCompare(b.id));
}
