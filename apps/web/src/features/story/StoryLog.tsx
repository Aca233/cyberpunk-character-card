import { useQuery } from "@tanstack/react-query";
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { api } from "../../api/client";
import type { AssetId } from "../../assets";
import { Asset, NineSlice } from "../../ui/Asset";
import { useNarrativePrefs } from "../settings/prefs";
import { useSpoilerView } from "../settings/SpoilerBadge";
import type { CompletedStage, LiveStage, useStory } from "./store";
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

type Live = Pick<
  ReturnType<typeof useStory.getState>,
  "phase" | "text" | "rolled" | "boost" | "pending" | "stage" | "stageTrace"
>;

function formatElapsed(ms: number): string {
  return `${(Math.max(0, ms) / 1000).toFixed(1)}s`;
}

/** 实时显示本轮当前正在跑的调用阶段、对应模型与已耗时，避免出字前和出字后干等 */
function LiveStageBar({
  stage,
  trace,
}: {
  readonly stage: LiveStage | null;
  readonly trace: readonly CompletedStage[];
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!stage) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(timer);
  }, [stage]);

  if (!stage && trace.length === 0) return null;
  const visibleTrace = trace.filter((t) => t.ms >= 150);

  return (
    <div className={styles.liveStage} aria-live="polite">
      {visibleTrace.length > 0 && (
        <div className={styles.liveStageTrace}>
          {visibleTrace.map((item, idx) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: 已完成阶段按推进顺序追加
            <span key={`${item.label}-${idx}`} className={styles.liveStageDone}>
              ✓ {item.label} {formatElapsed(item.ms)}
            </span>
          ))}
        </div>
      )}
      {stage && (
        <div className={styles.liveStageNow}>
          <span className={styles.liveStageDot} aria-hidden />
          <strong className={styles.liveStageLabel}>{stage.label}</strong>
          {stage.model && <code className={styles.liveStageModel}>{stage.model}</code>}
          {stage.detail && <span className={styles.liveStageDetail}>{stage.detail}</span>}
          <span className={styles.liveStageTimer}>{formatElapsed(now - stage.startedAt)}</span>
        </div>
      )}
    </div>
  );
}

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

/** 点了正文里的人名或地名：人物开档案，地点开地图并选中（第 3 条） */
export type OnMark = (mark: Speaker) => void;

/**
 * 一段正文；名字上色：自己用黄色，别人用青色，地点另一种颜色；黑话加虚线，悬停看释义。
 * 人物和地点在给了 onMark 时可以点，正文原样不改
 */
function Paragraph({
  text,
  speakers,
  onMark,
}: {
  readonly text: string;
  readonly speakers: readonly Speaker[];
  readonly onMark?: OnMark | undefined;
}) {
  const glossary = useGlossary();
  return (
    <p>
      {splitSpeakers(text, speakers).map((part, i) => {
        const s = part.speaker;
        if (s && onMark && (s.npc !== undefined || s.place !== undefined)) {
          return (
            <button
              // biome-ignore lint/suspicious/noArrayIndexKey: 同一段里的片段按顺序排，不会重排
              key={i}
              type="button"
              className={`${styles.speaker} ${styles.mark}`}
              data-place={s.place !== undefined || undefined}
              title={s.place !== undefined ? `在地图上看${part.text}` : `看${part.text}的档案`}
              onClick={() => onMark(s)}
            >
              {part.text}
            </button>
          );
        }
        return s ? (
          <b
            // biome-ignore lint/suspicious/noArrayIndexKey: 同一段里的片段按顺序排，不会重排
            key={i}
            className={styles.speaker}
            data-self={s.self || undefined}
            data-place={s.place !== undefined || undefined}
          >
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
        );
      })}
    </p>
  );
}

function TurnBlock({
  turn,
  saveId,
  speakers,
  onRegenerate,
  onRewrite,
  onMark,
}: {
  readonly turn: Turn;
  readonly saveId: string;
  readonly speakers: readonly Speaker[];
  /** 只有最后一轮、没在生成时才有 */
  readonly onRegenerate?: (() => void) | undefined;
  /** 按账目改写；和重新生成同样只给最后一轮 */
  readonly onRewrite?: (() => Promise<void>) | undefined;
  /** 点了正文里的人名或地名 */
  readonly onMark?: OnMark | undefined;
}) {
  const prefs = useNarrativePrefs();
  const [rewriting, setRewriting] = useState(false);
  return (
    <article className={styles.turn} data-boost={turn.sandevistan || undefined}>
      {prefs.sceneTitles && turn.sceneTitle && (
        <p className={styles.sceneTitle}>{turn.sceneTitle}</p>
      )}
      {turn.input.text.trim() !== "" && (
        <p
          className={styles.input}
          data-mode={turn.input.mode}
          data-boost={turn.sandevistan || undefined}
        >
          {formatInput(turn.input)}
        </p>
      )}
      {turn.sandevistan && (
        <p className={styles.boostLine}>
          <span>{"SANDEVISTAN // 斯安威斯坦超频"}</span>
        </p>
      )}
      {turn.dice.map((d, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: 同一轮的骰子按掷出的顺序排，不会重排
        <p key={`${turn.seq}-d${i}`} className={styles.diceLine}>
          <Asset id="skillcheck.default" tint="var(--cp-cyan)" height={14} />
          {d.purpose} · d{d.sides} → {d.faces.join(" / ")}
        </p>
      ))}
      {turn.episode && (
        <p className={styles.episode} data-severity={turn.episode.severity}>
          <strong>{turn.episode.severity === "severe" ? "// 神经突触过载" : "// 神经飘移"}</strong>{" "}
          · {turn.episode.trigger}
        </p>
      )}
      {turn.lostControl && (
        <p className={styles.lostControl}>
          <strong>[失控]</strong> 你想：{turn.lostControl.intent}；实际：{turn.lostControl.actual}
        </p>
      )}
      {turn.blackout ? (
        <details className={styles.blackout}>
          <summary className={styles.blackoutTitle}>
            [记忆缺失] 这一段角色记不起来；展开看回合日志里的原文
          </summary>
          {paragraphs(turn.text).map((p, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: 段落按正文顺序排，不会重排
            <Paragraph key={`${turn.seq}-${i}`} text={p} speakers={speakers} onMark={onMark} />
          ))}
        </details>
      ) : (
        paragraphs(turn.text).map((p, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: 段落按正文顺序排，不会重排
          <Paragraph key={`${turn.seq}-${i}`} text={p} speakers={speakers} onMark={onMark} />
        ))
      )}
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
          <span className={styles.dropped} title="本轮部分指令未能通过系统校验，已自动舍弃">
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
  onMark,
}: {
  readonly view: View;
  readonly saveId: string;
  readonly live: Live;
  /** 重新生成最后一轮；角色死了时不给 */
  readonly onRegenerate?: (() => void) | undefined;
  /** 按账目改写最后一轮；角色死了时不给 */
  readonly onRewrite?: (() => Promise<void>) | undefined;
  /** 点了正文里的人名或地名（第 3 条）；正在生成的这一轮还在变，不给点 */
  readonly onMark?: OnMark | undefined;
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
  const liveBoosting =
    live.boost !== null ||
    (live.pending?.kind === "input" && live.pending.input.sandevistan === true);
  const earlier = view.totalTurns - view.turns.length;
  const speakers = speakersOf(view);

  return (
    <div className={styles.log} ref={box} aria-live="polite" aria-busy={generating}>
      <div className={styles.logInner}>
        {earlier > 0 && <p className={styles.dim}>更早的 {earlier} 轮暂不显示</p>}
        {view.turns.length === 0 && !generating && (
          <p className={styles.dim}>
            自由沙盘已就绪
            {view.location ? ` · 当前位于${view.names.location ?? view.location}` : ""}
            {view.deadlines[0]
              ? ` · 眼下期限：${view.deadlines[0].label}（${view.deadlines[0].due} 前）`
              : ""}
            。写下你的第一句话，或第一个行动。
          </p>
        )}
        {view.turns.map((t, i) => (
          <TurnBlock
            key={t.seq}
            turn={t}
            saveId={saveId}
            speakers={speakers}
            onRegenerate={
              i === view.turns.length - 1 && !generating && !view.offers.rolled
                ? onRegenerate
                : undefined
            }
            onRewrite={onRewrite}
            onMark={onMark}
          />
        ))}

        {!generating && view.offers.read && <p className={styles.read}>{view.offers.read}</p>}

        {generating && (
          <article className={styles.turn} data-live data-boost={liveBoosting || undefined}>
            {live.pending?.kind === "input" && (
              <p
                className={styles.input}
                data-mode={live.pending.input.mode}
                data-boost={liveBoosting || undefined}
              >
                {formatInput(live.pending.input)}
              </p>
            )}
            {live.pending?.kind === "confirm" && (
              <p className={styles.input}>检定：{live.pending.label}</p>
            )}
            {liveBoosting && (
              <p className={styles.boostLine}>
                <span>{`SANDEVISTAN // ${live.boost?.name ?? "斯安威斯坦"}超频`}</span>
              </p>
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
            <LiveStageBar stage={live.stage} trace={live.stageTrace} />
          </article>
        )}
      </div>
    </div>
  );
}

const KEYS: readonly AssetId[] = ["key.1", "key.2", "key.3", "key.4"];
/** dialog.skillSelect 的切线（4K 原图像素，CSS 顺序上、右、下、左）：原作只切左 20、下 20，左下是切角 */
const TAG_SLICE = [0, 0, 20, 20] as const;

/** 选项 */
export function ChoiceList({
  choices,
  locked,
  onChoose,
}: {
  readonly choices: readonly Choice[];
  readonly locked: boolean;
  readonly onChoose: (index: number) => void;
}) {
  return (
    <ol className={styles.choices}>
      {choices.map((c, i) => {
        const key = KEYS[i];
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: 选项的位置对应数字键，位置就是身份
          <li key={`${i}-${c.text}`}>
            <button
              type="button"
              className={styles.choice}
              disabled={locked}
              data-check={c.checkId !== null || undefined}
              onClick={() => onChoose(i)}
            >
              {key ? (
                <Asset id={key} tint="currentColor" height={22} />
              ) : (
                <span className={styles.num}>{i + 1}</span>
              )}
              {c.source && <span className={styles.source}>[{c.source}]</span>}
              <span className={styles.choiceText}>{c.text}</span>
              {c.checkId && (
                <span className={styles.tag}>
                  <NineSlice id="dialog.skillSelect" tint="var(--tag-tint)" slice={TAG_SLICE} />
                  冒险
                </span>
              )}
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
    <Link
      to={`/settings?tab=context&save=${encodeURIComponent(saveId)}&seq=${seq}`}
      state={{ from: `/play/${encodeURIComponent(saveId)}` }}
    >
      #{seq} 上下文
    </Link>
  );
}
