import { useQuery } from "@tanstack/react-query";
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { api } from "../../api/client";
import type { AssetId } from "../../assets";
import { Asset } from "../../ui/Asset";
import { useNarrativePrefs } from "../settings/prefs";
import { useSpoilerView } from "../settings/SpoilerBadge";
import type { useStory } from "./store";
import styles from "./story.module.css";
import {
  type Choice,
  formatDice,
  formatInput,
  glossMatcher,
  isSuccess,
  OUTCOME_LABELS,
  type Speaker,
  speakersOf,
  splitSlang,
  splitSpeakers,
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

/** 黑话术语表只取一次；select 是模块级函数，react-query 会缓存编好的正则 */
function useGlossary() {
  return useQuery({
    queryKey: ["glossary"],
    queryFn: api.glossary,
    staleTime: Number.POSITIVE_INFINITY,
    select: glossMatcher,
  }).data;
}

/** 一段正文；名字上色：自己用黄色，别人用青色；黑话加虚线，悬停看释义 */
function Paragraph({
  text,
  speakers,
}: {
  readonly text: string;
  readonly speakers: readonly Speaker[];
}) {
  const glossary = useGlossary();
  return (
    <p>
      {splitSpeakers(text, speakers).map((part, i) =>
        part.speaker ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: 同一段里的片段按顺序排，不会重排
          <b key={i} className={styles.speaker} data-self={part.speaker.self || undefined}>
            {part.text}
          </b>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: 同一段里的片段按顺序排，不会重排
          <Fragment key={i}>
            {splitSlang(part.text, glossary).map((bit, j) =>
              bit.meaning ? (
                // biome-ignore lint/suspicious/noArrayIndexKey: 同上
                <abbr key={j} className={styles.slang} title={bit.meaning}>
                  {bit.text}
                </abbr>
              ) : (
                bit.text
              ),
            )}
          </Fragment>
        ),
      )}
    </p>
  );
}

const VOICE_LABELS = {
  past: "过往",
  chrome: "义体",
  humanity: "人性",
  iconic: "不朽武器",
} as const;

function TurnBlock({
  turn,
  saveId,
  speakers,
  onRegenerate,
  onRewrite,
}: {
  readonly turn: Turn;
  readonly saveId: string;
  readonly speakers: readonly Speaker[];
  /** 只有最后一轮、没在生成时才有 */
  readonly onRegenerate?: (() => void) | undefined;
  /** 按账目改写；和重新生成同样只给最后一轮 */
  readonly onRewrite?: (() => Promise<void>) | undefined;
}) {
  const prefs = useNarrativePrefs();
  const [rewriting, setRewriting] = useState(false);
  return (
    <article className={styles.turn}>
      {prefs.sceneTitles && turn.sceneTitle && (
        <p className={styles.sceneTitle}>{turn.sceneTitle}</p>
      )}
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
        <Paragraph key={`${turn.seq}-${i}`} text={p} speakers={speakers} />
      ))}
      {turn.voices.map((v, i) => (
        <p
          // biome-ignore lint/suspicious/noArrayIndexKey: 同一轮的内心声音按写下的顺序排，不会重排
          key={`${turn.seq}-v${i}`}
          className={styles.voice}
          data-from={v.from}
          title={`内心声音 · ${VOICE_LABELS[v.from]}`}
        >
          {v.text}
        </p>
      ))}
      <footer className={styles.turnMeta}>
        {turn.unsettled && (
          <span className={styles.unsettled} title={turn.unsettled}>
            本轮叙事和账目对不上
          </span>
        )}
        {turn.unsettled && onRegenerate && onRewrite && (
          <button
            type="button"
            className={styles.regenerate}
            disabled={rewriting}
            onClick={async () => {
              setRewriting(true);
              try {
                await onRewrite();
              } finally {
                setRewriting(false);
              }
            }}
            title="账目不动、骰子不重掷，只按已经记上的变化重写这一轮正文"
          >
            {rewriting ? "改写中…" : "按账目改写"}
          </button>
        )}
        {onRegenerate && (
          <button
            type="button"
            className={styles.regenerate}
            onClick={onRegenerate}
            title="作废这一轮，用同样的输入重写；掷过的骰子不重掷"
          >
            重新生成
          </button>
        )}
        {turn.dropped > 0 && !turn.unsettled && (
          <span className={styles.dropped} title="模型这轮写的部分指令没能通过校验，被丢弃了">
            本轮数值未结算（{turn.dropped} 条）
          </span>
        )}
        <ContextLink saveId={saveId} seq={turn.seq} />
      </footer>
    </article>
  );
}

/** 正文：已写进存档的各轮，加上正在生成的这一轮；贴近底部时自动跟随 */
export function StoryLog({
  view,
  saveId,
  live,
  onRegenerate,
  onRewrite,
}: {
  readonly view: View;
  readonly saveId: string;
  readonly live: Live;
  /** 重新生成最后一轮；角色死了时不给 */
  readonly onRegenerate?: (() => void) | undefined;
  /** 按账目改写最后一轮；角色死了时不给 */
  readonly onRewrite?: (() => Promise<void>) | undefined;
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
  const speakers = speakersOf(view);

  return (
    <div className={styles.log} ref={box} aria-live="polite" aria-busy={generating}>
      <div className={styles.logInner}>
        {earlier > 0 && <p className={styles.dim}>更早的 {earlier} 轮暂不显示</p>}
        {view.turns.length === 0 && !generating && (
          <p className={styles.dim}>
            故事还没开始。
            {view.deadlines[0]
              ? `眼下的活：${view.deadlines[0].label}，${view.deadlines[0].due} 前。`
              : ""}
            写下你的第一句话或第一个行动。
          </p>
        )}
        {view.turns.map((t, i) => (
          <TurnBlock
            key={t.seq}
            turn={t}
            saveId={saveId}
            speakers={speakers}
            onRegenerate={
              i === view.turns.length - 1 && t.seq > 0 && !generating && !view.offers.rolled
                ? onRegenerate
                : undefined
            }
            onRewrite={onRewrite}
          />
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
              <Paragraph key={i} text={p} speakers={speakers} />
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
              {c.source && <span className={styles.source}>[{c.source}]</span>}
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

/** 上下文是剧透调试视图：打开「显示剧透」或后端开发模式时才给入口 */
function ContextLink({ saveId, seq }: { readonly saveId: string; readonly seq: number }) {
  const { open } = useSpoilerView();
  if (!open) return null;
  return (
    <Link to={`/settings?tab=context&save=${encodeURIComponent(saveId)}&seq=${seq}`}>
      #{seq} 上下文
    </Link>
  );
}
