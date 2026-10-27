import { formatGameTime } from "../world";
import { canConclude, keyProgress } from "./apply";
import { BD_ABANDON, BD_LAYER_LABELS, type BraindanceState } from "./schema";

/**
 * 玩家看得到的超梦：录像各段各层的描写、线索点的名字，标出来的才带扫描结果；
 * 哪条是关键线索、正确结论、真相和推没推对都不给，只给关键线索找到了几条
 */
export function braindanceView(state: BraindanceState) {
  const inv = state.active;
  return {
    active: inv && {
      title: inv.recording.title,
      recorder: inv.recording.recorder,
      startedAt: formatGameTime(inv.startedAt),
      segments: inv.recording.segments.map((s) => ({
        time: s.time,
        label: s.label,
        visual: s.visual,
        audio: s.audio,
        thermal: s.thermal,
      })),
      points: inv.recording.points.map((p) => {
        const marked = inv.marked.includes(p.id);
        return {
          id: p.id,
          segment: p.segment,
          layer: p.layer,
          layerLabel: BD_LAYER_LABELS[p.layer],
          label: p.label,
          marked,
          scan: marked
            ? {
                facts: p.scan.facts.map((f) => ({ name: f.name, value: f.value })),
                conclusion: p.scan.conclusion,
              }
            : null,
        };
      }),
      /** 关键线索找到了几条、一共几条 */
      keys: keyProgress(inv),
      /** 关键线索都找到了：可以下结论 */
      ready: canConclude(inv),
      /** 找全关键线索以后才给 */
      conclusions: canConclude(inv)
        ? inv.recording.conclusions.map((o) => ({ id: o.id, text: o.text }))
        : [],
    },
    /** 查完的几次：只有玩家自己选的结论，对错由正文透出来 */
    history: state.history.map((h) => ({
      title: h.title,
      recorder: h.recorder,
      conclusion: h.option === BD_ABANDON ? null : h.optionText,
      startedAt: formatGameTime(h.startedAt),
      at: formatGameTime(h.at),
    })),
  };
}
export type BraindanceView = ReturnType<typeof braindanceView>;
