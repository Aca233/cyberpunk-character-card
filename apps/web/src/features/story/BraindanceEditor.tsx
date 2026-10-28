import { useEffect, useState } from "react";
import type { AssetId } from "../../assets";
import { Asset } from "../../ui/Asset";
import { Button } from "../../ui/Button";
import { useLayer } from "../../ui/layers";
import styles from "./braindance.module.css";
import type { View } from "./view";

type Layer = "visual" | "audio" | "thermal";

/** 原作编辑器的编码层叫法和图标（文本库：视频、音频、红外层） */
const LAYERS: readonly {
  readonly id: Layer;
  readonly label: string;
  readonly icon: AssetId;
  readonly iconOn: AssetId;
}[] = [
  { id: "visual", label: "视频", icon: "braindance.visual", iconOn: "braindance.visualOn" },
  { id: "audio", label: "音频", icon: "braindance.sound", iconOn: "braindance.soundOn" },
  { id: "thermal", label: "红外", icon: "braindance.thermal", iconOn: "braindance.thermalOn" },
];

/**
 * 超梦体验编辑器：切编码层、拖时间轴，在取景框里标出可扫描的点；标出来才看得到扫描结果。
 * 关键线索都找到以后才出现结论选项；下结论走回合，叙事模型接着写。标线索不调用模型、不花时间
 */
export function BraindanceEditor({
  view,
  onMark,
  onConclude,
  onAbandon,
  onClose,
}: {
  readonly view: View;
  /** 标一个点；正在生成时不传 */
  readonly onMark?: ((point: string) => void) | undefined;
  /** 下结论；正在生成或还不能下时不传 */
  readonly onConclude?: ((id: string, text: string) => void) | undefined;
  /** 不查了，退出超梦 */
  readonly onAbandon?: (() => void) | undefined;
  readonly onClose: () => void;
}) {
  const bd = view.braindance.active;
  const [layer, setLayer] = useState<Layer>("visual");
  const [segment, setSegment] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [option, setOption] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const count = bd?.segments.length ?? 0;

  useLayer(onClose);
  // 编辑器自己的键：方向键拖时间轴，1/2/3 切编码层；Esc 由面板栈处理
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "ArrowLeft") setSegment((s) => Math.max(0, s - 1));
      else if (e.key === "ArrowRight") setSegment((s) => Math.min(count - 1, s + 1));
      else if (e.key === "1" || e.key === "2" || e.key === "3") {
        const next = LAYERS[Number(e.key) - 1];
        if (next) setLayer(next.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [count]);

  if (!bd) {
    return (
      <div className={styles.backdrop} role="dialog" aria-label="超梦体验编辑器">
        <div className={styles.head}>
          <span className={styles.headTitle}>
            <b>超梦体验编辑器</b>
          </span>
          <span className={styles.headMeta}>现在没有接上的超梦。</span>
          <Button onClick={onClose}>关闭</Button>
        </div>
      </div>
    );
  }

  const current = bd.segments[Math.min(segment, count - 1)];
  const here = bd.points.filter((p) => p.segment === segment && p.layer === layer);
  const pending = (l: Layer) =>
    bd.points.some((p) => p.segment === segment && p.layer === l && !p.marked);
  const marked = bd.points.filter((p) => p.marked);
  const shown = bd.points.find((p) => p.id === picked && p.marked);
  const text = current ? current[layer] : "";
  const chosen = bd.conclusions.find((o) => o.id === option);

  return (
    <div className={styles.backdrop} role="dialog" aria-label="超梦体验编辑器">
      <div className={styles.head}>
        <span className={styles.headTitle}>
          <Asset id="braindance.recording" tint="var(--cp-red)" height={18} />
          <b>超梦体验编辑器</b>
        </span>
        <span className={styles.headMeta}>
          录像「{bd.title}」· {bd.recorder}录制 · {bd.startedAt}接上
        </span>
        {onAbandon &&
          (leaving ? (
            <>
              <span className={styles.dim}>不下结论就退出？</span>
              <Button onClick={onAbandon}>退出超梦</Button>
              <Button onClick={() => setLeaving(false)}>接着查</Button>
            </>
          ) : (
            <Button onClick={() => setLeaving(true)}>不查了</Button>
          ))}
        <Button onClick={onClose}>先放下 [Esc]</Button>
      </div>

      <div className={styles.body}>
        <section className={styles.stage}>
          <div className={styles.layers}>
            <span className={styles.layerLabel}>编码层：</span>
            {LAYERS.map((l, i) => (
              <button
                key={l.id}
                type="button"
                className={styles.layerTab}
                data-on={layer === l.id}
                data-hint={pending(l.id)}
                onClick={() => setLayer(l.id)}
              >
                <Asset id={layer === l.id ? l.iconOn : l.icon} height={18} />
                {l.label} [{i + 1}]
              </button>
            ))}
          </div>
          <div className={styles.viewport} data-layer={layer}>
            <Asset
              id="braindance.frame"
              tint="var(--cp-cyan)"
              height={40}
              className={styles.frame}
            />
            {current && (
              <p className={styles.segmentHead}>
                {current.time} · {current.label}
              </p>
            )}
            <p className={styles.layerText}>{text}</p>
            {here.length > 0 && (
              <div className={styles.hotspots}>
                {here.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={styles.hotspot}
                    data-marked={p.marked}
                    disabled={!p.marked && !onMark}
                    onClick={() => {
                      setPicked(p.id);
                      if (!p.marked) onMark?.(p.id);
                    }}
                  >
                    <Asset id="braindance.clue" tint="currentColor" height={14} />
                    {p.marked ? p.label : `扫描：${p.label}`}
                  </button>
                ))}
              </div>
            )}
            {shown?.scan && (
              <div className={styles.scan}>
                <b>{shown.label}</b>
                <dl>
                  {shown.scan.facts.map((f) => (
                    <div key={f.name} className={styles.facts}>
                      <dt>{f.name}</dt>
                      <dd>{f.value}</dd>
                    </div>
                  ))}
                </dl>
                <p>结论：{shown.scan.conclusion}</p>
              </div>
            )}
          </div>
        </section>

        <aside className={styles.side}>
          <p className={styles.progress}>
            关键线索 {bd.keys.found}/{bd.keys.total}
            {bd.ready ? " · 可以下结论了" : ""}
          </p>
          {marked.length === 0 ? (
            <p className={styles.dim}>还没标出线索。</p>
          ) : (
            <ul className={styles.clues}>
              {marked.map((p) => (
                <li key={p.id} className={styles.clue}>
                  <header>
                    <Asset id="braindance.clue" tint="currentColor" height={12} />
                    <button
                      type="button"
                      className={styles.clueJump}
                      onClick={() => {
                        setSegment(p.segment);
                        setLayer(p.layer);
                        setPicked(p.id);
                      }}
                    >
                      {bd.segments[p.segment]?.time} {p.layerLabel}
                    </button>
                    <b>{p.label}</b>
                  </header>
                  {p.scan && <p>{p.scan.conclusion}</p>}
                </li>
              ))}
            </ul>
          )}
          {bd.ready ? (
            <div className={styles.verdict}>
              <b>结论</b>
              {bd.conclusions.map((o) => (
                <label key={o.id} className={styles.option}>
                  <input
                    type="radio"
                    name="bd-conclusion"
                    checked={option === o.id}
                    onChange={() => setOption(o.id)}
                  />
                  <span>{o.text}</span>
                </label>
              ))}
              <Button
                disabled={!onConclude || !chosen}
                onClick={() => chosen && onConclude?.(chosen.id, chosen.text)}
              >
                下结论
              </Button>
              <p className={styles.dim}>下了就不能改，后面的事照这个结论走。</p>
            </div>
          ) : (
            <p className={styles.dim}>关键线索找全以后才能下结论。</p>
          )}
        </aside>
      </div>

      <div className={styles.timeline}>
        <div className={styles.track}>
          {bd.segments.map((s, i) => (
            <button
              key={s.time}
              type="button"
              className={styles.tick}
              data-on={i === segment}
              onClick={() => setSegment(i)}
            >
              {i === segment && (
                <Asset
                  id="braindance.playhead"
                  tint="var(--cp-cyan)"
                  height={14}
                  className={styles.playhead}
                />
              )}
              {s.time} {s.label}
            </button>
          ))}
        </div>
        <input
          type="range"
          className={styles.scrubber}
          aria-label="时间轴"
          min={0}
          max={count - 1}
          step={1}
          value={segment}
          onChange={(e) => setSegment(Number(e.target.value))}
        />
      </div>
    </div>
  );
}
