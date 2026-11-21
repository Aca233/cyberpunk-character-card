import type { StatusContext, SystemStatus } from "../../kernel/system";
import type { perceivedView } from "./perceived";
import type { npcsView } from "./view";

/** 【当前状态】里别人眼里的你 + 当前同行者 */

type PerceivedView = ReturnType<typeof perceivedView>;
type NpcsView = ReturnType<typeof npcsView>;

const perceivedOf = (ctx: StatusContext) => ctx.views.perceived as PerceivedView;
const npcsOf = (ctx: StatusContext) => (ctx.views.npcs as NpcsView | undefined) ?? [];

export const npcStatus: readonly SystemStatus[] = [
  {
    order: 60,
    lines(ctx) {
      return [`别人眼里的你：${perceivedOf(ctx)}`];
    },
  },
  {
    order: 130,
    lines(ctx) {
      const companions = npcsOf(ctx).filter((n) => n.alive && n.following);
      if (companions.length === 0) return [];
      const summary = companions
        .map((n) => {
          const wound = n.body?.wound && n.body.wound !== "没受伤" ? `，${n.body.wound}` : "";
          return `${n.name}（${n.id}，${n.role}${wound}）`;
        })
        .join("；");
      return [`当前同行（随你转场并在现场协同，详细装备义体见【人物】）：${summary}`];
    },
  },
];
