import { useEffect, useLayoutEffect, useRef } from "react";
import { Link } from "react-router";
import type { AssetId } from "../../assets";
import { Asset } from "../../ui/Asset";
import type { useStory } from "./store";
import styles from "./story.module.css";
import {
  type Choice,
  formatDice,
  formatInput,
  isSuccess,
  OUTCOME_LABELS,
  type Turn,
  type View,
} from "./view";

type Live = Pick<ReturnType<typeof useStory.getState>, "phase" | "text" | "rolled" | "pending">;

function paragraphs(text: string): string[] {
  return text
    .split(/\n{2,}|\n/)
    .map((p) => p.trim())
    .filter((p) => p !== "");
}

function TurnBlock({ turn, saveId }: { readonly turn: Turn; readonly saveId: string }) {
  return (
    <article className={styles.turn}>
      {turn.seq > 0 && (
        <p className={styles.input} data-mode={turn.input.mode}>
          {formatInput(turn.input)}
        </p>
      )}
      {turn.dice.map((d, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: 同一轮的骰子按掷出的顺序排，不会重排
        <p key={`${turn.seq}-d${i}`} className={styles.diceLine}>
          <Asset id="skillcheck.default" tint="var(--cp-cyan)" height={14} />
          {d.purpose} · d{d.sides} → {d.faces.join(" / ")}
        </p>
      ))}
      {paragraphs(turn.text).map((p, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: 段落按正文顺序排，不会重排
        <p key={`${turn.seq}-${i}`}>{p}</p>
      ))}
      <footer className={styles.turnMeta}>
        {turn.dropped > 0 && (
          <span className={styles.dropped} title="主持人这轮写的部分指令没能通过校验，被丢弃了">
            本轮数值未结算（{turn.dropped} 条）
          </span>
        )}
        <Link to={`/settings?tab=context&save=${encodeURIComponent(saveId)}&seq=${turn.seq}`}>
          #{turn.seq} 上下文
        </Link>
      </footer>
    </article>
  );
}

/** 正文：已写进存档的各轮，加上正在生成的这一轮；贴近底部时自动跟随 */
export function StoryLog({
  view,
  saveId,
  live,
}: {
  readonly view: View;
  readonly saveId: string;
  readonly live: Live;
}) {
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onScroll = () => {
      stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useLayoutEffect(() => {
    const el = box.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  });

  const generating = live.phase !== "idle";
  const earlier = view.totalTurns - view.turns.length;

  return (
    <div className={styles.log} ref={box} aria-live="polite" aria-busy={generating}>
      <div className={styles.logInner}>
        {earlier > 0 && <p className={styles.dim}>更早的 {earlier} 轮暂不显示</p>}
        {view.turns.length === 0 && !generating && (
          <p className={styles.dim}>故事还没开始。写下你的第一个行动，或者直接问主持人怎么开场。</p>
        )}
        {view.turns.map((t) => (
          <TurnBlock key={t.seq} turn={t} saveId={saveId} />
        ))}

        {!generating && view.offers.read && <p className={styles.read}>{view.offers.read}</p>}

        {generating && (
          <article className={styles.turn} data-live>
            {live.pending?.kind === "input" && (
              <p className={styles.input} data-mode={live.pending.input.mode}>
                {formatInput(live.pending.input)}
              </p>
            )}
            {live.pending?.kind === "confirm" && (
              <p className={styles.input}>检定：{live.pending.label}</p>
            )}
            {live.rolled && (
              <p
                className={styles.rolled}
                data-success={isSuccess(live.rolled.outcome) || undefined}
              >
                <b>{OUTCOME_LABELS[live.rolled.outcome]}</b>
                <span>{formatDice(live.rolled)}</span>
              </p>
            )}
            {paragraphs(live.text).map((p, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: 正在生成的正文只会往后追加
              <p key={i}>{p}</p>
            ))}
            <span className={styles.caret} aria-hidden />
          </article>
        )}
      </div>
    </div>
  );
}

const KEYS: readonly AssetId[] = ["key.1", "key.2", "key.3", "key.4"];

/** 选项：门槛不够的锁住并写明差几点；带检定的选中后打开确认栏 */
export function ChoiceList({
  choices,
  attributes,
  locked,
  onChoose,
}: {
  readonly choices: readonly Choice[];
  readonly attributes: View["character"]["attributes"];
  readonly locked: boolean;
  readonly onChoose: (index: number) => void;
}) {
  return (
    <ol className={styles.choices}>
      {choices.map((c, i) => {
        const short =
          c.gate && !c.gate.met ? c.gate.value - (attributes[c.gate.attribute] ?? 0) : 0;
        const disabled = locked || short > 0;
        const key = KEYS[i];
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: 选项的位置对应数字键，位置就是身份
          <li key={`${i}-${c.text}`}>
            <button
              type="button"
              className={styles.choice}
              disabled={disabled}
              data-check={c.checkId !== null || undefined}
              title={short > 0 ? `${c.gate?.attributeLabel}差 ${short} 点` : undefined}
              onClick={() => onChoose(i)}
            >
              {key ? (
                <Asset id={key} tint="currentColor" height={22} />
              ) : (
                <span className={styles.num}>{i + 1}</span>
              )}
              <span className={styles.choiceText}>{c.text}</span>
              {c.gate && (
                <span className={styles.tag} data-met={c.gate.met || undefined}>
                  {c.gate.attributeLabel} {c.gate.value}
                  {short > 0 && ` · 差 ${short} 点`}
                </span>
              )}
              {c.checkId && <span className={styles.tag}>检定</span>}
            </button>
          </li>
        );
      })}
    </ol>
  );
}
