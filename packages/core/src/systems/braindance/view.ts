import { formatGameTime } from "../world";
import {
  BD_LAYER_LABELS,
  BD_MODE_LABELS,
  BD_TIER_LABELS,
  type BdLayer,
  type BraindanceState,
} from "./schema";

const ALL_LAYERS: readonly BdLayer[] = ["visual", "audio", "thermal"];

/** 只投影简介、已呈现片段、实际体验、三层扫描进度和已查明材料，不剧透未发现细节。 */
export function braindanceView(state: BraindanceState) {
  const work = state.active ? state.works[state.active.work] : undefined;
  return {
    active:
      state.active && work
        ? {
            id: state.active.id,
            work: work.id,
            title: work.title,
            tier: work.tier,
            tierLabel: BD_TIER_LABELS[work.tier],
            mode: state.active.mode,
            modeLabel: BD_MODE_LABELS[state.active.mode],
            recorder: work.recorder,
            startedAt: formatGameTime(state.active.startedAt),
            status: state.active.status,
            watchedMinutes: state.active.watchedMinutes,
            durationMinutes: work.durationMinutes,
            layers: ALL_LAYERS.map((layer) => ({
              layer,
              label: BD_LAYER_LABELS[layer],
              found: state.discoveries.filter((d) => d.work === work.id && d.layer === layer)
                .length,
              total: work.details.filter((d) => d.layer === layer).length,
            })),
          }
        : null,
    works: Object.values(state.works).map((w) => ({
      id: w.id,
      title: w.title,
      tier: w.tier,
      tierLabel: BD_TIER_LABELS[w.tier],
      recorder: w.recorder,
      synopsis: w.synopsis,
      durationMinutes: w.durationMinutes,
      xbdRisk: w.xbdRisk ?? null,
      passages: Object.entries(state.passages[w.id] ?? {}).map(([id, text]) => {
        const passage = w.passages.find((candidate) => candidate.id === id);
        return { id, label: passage?.label ?? id, text, media: passage?.media ?? [] };
      }),
      layers: ALL_LAYERS.map((layer) => ({
        layer,
        label: BD_LAYER_LABELS[layer],
        found: state.discoveries.filter((d) => d.work === w.id && d.layer === layer).length,
        total: w.details.filter((d) => d.layer === layer).length,
      })),
    })),
    discoveries: state.discoveries.map((d) => ({
      ...d,
      layerLabel: BD_LAYER_LABELS[d.layer],
      at: formatGameTime(d.at),
    })),
    history: state.history.map((h) => ({
      id: h.id,
      work: h.work,
      title: state.works[h.work]?.title ?? h.work,
      mode: h.mode,
      modeLabel: BD_MODE_LABELS[h.mode],
      watchedMinutes: h.watchedMinutes,
      elapsed: h.elapsed,
      outcome: h.outcome,
      startedAt: formatGameTime(h.startedAt),
      at: formatGameTime(h.at),
    })),
  };
}
export type BraindanceView = ReturnType<typeof braindanceView>;
