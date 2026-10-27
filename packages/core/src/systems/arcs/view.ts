import type { ViewContext } from "../../kernel/system";
import { arcCatalog } from "./apply";
import { ArcsStateSchema, CONCERN_STATUS_LABELS, type ConcernStatus } from "./schema";

/**
 * 人物列表里的心事一栏，按人物 id：这个人跟玩家说过的事和玩家听说的结果；
 * 处境、盼头、走向和原作结局只给模型看，不在这里。
 * 还没熟到能说心事、也没说过任何一件的人不在表里
 */
export function arcCardsView({ world, data }: ViewContext) {
  // 旧存档没有心事
  const state = ArcsStateSchema.parse(world.slices.arcs ?? {});
  const seeds = arcCatalog(data ?? {});
  const cards: Record<
    string,
    {
      readonly done: boolean;
      readonly concerns: readonly {
        readonly id: string;
        readonly title: string;
        readonly status: ConcernStatus;
        readonly statusLabel: string;
        readonly outcome: string | null;
      }[];
    }
  > = {};
  for (const [id, progress] of Object.entries(state.arcs)) {
    const seed = seeds.get(id);
    if (!seed) continue;
    const concerns = seed.concerns.flatMap((c) => {
      const p = progress.concerns[c.id];
      if (!p) return [];
      const heard = p.outcome?.known === true;
      // 场外暗中出的结局玩家还不知道：照结局之前的状态显示
      const status: ConcernStatus | null = heard
        ? "resolved"
        : p.outcome
          ? (p.outcome.previousStatus ?? null)
          : p.status;
      if (status === null) return [];
      return [
        {
          id: c.id,
          title: c.title,
          status,
          statusLabel: CONCERN_STATUS_LABELS[status],
          outcome: heard && p.outcome ? p.outcome.text : null,
        },
      ];
    });
    if (progress.unlockedAt === null && concerns.length === 0) continue;
    // 几件都了结要按玩家知道的算，doneAt 会把暗中的结局算进去
    const done = seed.concerns.every((c) => progress.concerns[c.id]?.outcome?.known === true);
    cards[id] = { done, concerns };
  }
  return cards;
}
