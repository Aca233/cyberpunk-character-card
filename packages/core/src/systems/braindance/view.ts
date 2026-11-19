import { formatGameTime } from "../world";
import type { BraindanceState } from "./schema";

/** 只投影简介、已呈现片段、实际体验和已查明材料，不投影未发现细节。 */
export function braindanceView(state: BraindanceState) {
  const work = state.active ? state.works[state.active.work] : undefined;
  return {
    active:
      state.active && work
        ? {
            id: state.active.id,
            work: work.id,
            title: work.title,
            recorder: work.recorder,
            startedAt: formatGameTime(state.active.startedAt),
            status: state.active.status,
            watchedMinutes: state.active.watchedMinutes,
            durationMinutes: work.durationMinutes,
          }
        : null,
    works: Object.values(state.works).map((w) => ({
      id: w.id,
      title: w.title,
      recorder: w.recorder,
      synopsis: w.synopsis,
      durationMinutes: w.durationMinutes,
      passages: Object.entries(state.passages[w.id] ?? {}).map(([id, text]) => ({ id, text })),
    })),
    discoveries: state.discoveries.map((d) => ({ ...d, at: formatGameTime(d.at) })),
    history: state.history.map((h) => ({
      id: h.id,
      work: h.work,
      title: state.works[h.work]?.title ?? h.work,
      watchedMinutes: h.watchedMinutes,
      elapsed: h.elapsed,
      outcome: h.outcome,
      startedAt: formatGameTime(h.startedAt),
      at: formatGameTime(h.at),
    })),
  };
}
export type BraindanceView = ReturnType<typeof braindanceView>;
