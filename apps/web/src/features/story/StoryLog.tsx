import { extractThoughtFromText, type TurnImagePromptInput } from "@cp/core";
import { useQuery } from "@tanstack/react-query";
import {
  type CSSProperties,
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router";
import { api } from "../../api/client";
import type { AssetId } from "../../assets";
import { Asset } from "../../ui/Asset";
import { useCardTilt } from "../../ui/useCardTilt";
import { GeneratedImage } from "../images/GeneratedImage";
import { useSaveImages } from "../images/SaveImagesContext";
import { useNarrativePrefs } from "../settings/prefs";
import { useSpoilerView } from "../settings/SpoilerBadge";
import { ContentMediaList } from "./ContentMedia";
import mediaStyles from "./content-media.module.css";
import { type DialoguePart, dialogueParagraphs as paragraphs } from "./dialogue";
import { buildGearMatcher, type GearMatcher, type InlineGearItem, splitGear } from "./inlineGear";
import { LiveStageBar } from "./LiveStageBar";
import { OpeningGuide, type OpeningGuideActions } from "./OpeningGuide";
import type { useStory } from "./store";
import styles from "./story.module.css";
import { ThoughtBlock } from "./ThoughtBlock";
import {
  type Choice,
  formatInput,
  type GlossMatcher,
  glossMatcher,
  type Speaker,
  speakersOf,
  splitSlang,
  splitSpeakers,
  type Turn,
  type View,
} from "./view";

type Live = Pick<
  ReturnType<typeof useStory.getState>,
  "phase" | "text" | "thought" | "boost" | "pending" | "stage" | "stageTrace"
>;

/** 合并已保存/流式思维链与正文内联思考标签（兼容旧存档残留标签），保持正文阅读纯净。 */
function splitDisplayThought(
  text: string,
  savedThought?: string | null,
): { readonly body: string; readonly thought: string } {
  const inline = extractThoughtFromText(text);
  const thought = [savedThought?.trim() ?? "", inline.thought]
    .filter((part) => part !== "")
    .join("\n\n");
  return { body: inline.body, thought };
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

/** 点了正文里的人名或地名：人物开档案，地点开地图并选中 */
export type OnMark = (mark: Speaker) => void;

interface GearHoverState {
  readonly item: InlineGearItem;
  readonly rect: DOMRect;
}

type OnGearHover = (next: GearHoverState | null) => void;

/** 悬浮在正文武器/义体名上方的赛博信息卡，Portal 到 body 以免被滚动容器裁剪 */
function GearHoverCard({ hover }: { readonly hover: GearHoverState }) {
  const { item, rect } = hover;
  const width = 304;
  const margin = 12;
  const centerX = rect.left + rect.width / 2;
  const left = Math.max(margin, Math.min(window.innerWidth - width - margin, centerX - width / 2));
  const preferBelow = rect.top < 210;
  const top = preferBelow ? rect.bottom + 8 : rect.top - 8;

  const style: CSSProperties = {
    left: `${left}px`,
    top: `${top}px`,
    width: `${width}px`,
    transform: preferBelow ? "translateY(0)" : "translateY(-100%)",
  };

  return createPortal(
    <aside
      className={styles.gearCard}
      data-kind={item.kind}
      data-rarity={item.rarity}
      data-iconic={item.iconic || undefined}
      style={style}
      role="tooltip"
    >
      <div className={styles.gearCardHead}>
        {item.art && (
          <div className={styles.gearCardThumb}>
            <Asset id={item.art} height={38} />
          </div>
        )}
        <div className={styles.gearCardTitleWrap}>
          <div className={styles.gearCardTags}>
            <span className={styles.gearCardType}>
              {item.kind === "weapon" ? "WEAPON" : "CYBERWARE"}
            </span>
            {item.statusTag && <span className={styles.gearCardStatus}>{item.statusTag}</span>}
          </div>
          <strong className={styles.gearCardName}>{item.name}</strong>
          <span className={styles.gearCardMeta}>
            {[item.categoryLabel, item.weaponTypeLabel, item.rarityLabel]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </div>
      </div>
      <p className={styles.gearCardDesc}>{item.ability}</p>
    </aside>,
    document.body,
  );
}

/**
 * 正文行内标记：人名青色可点开档案，地名绿色可点开地图，自己黄色；
 * 武器橙红色、义体紫罗兰色，悬停或键盘聚焦显示详情卡片与描述；
 * 黑话带虚线下划线与零延迟赛博释义浮层，正文原样不改。
 */
function InlineText({
  text,
  speakers,
  onMark,
  glossary,
  gearMatcher,
  onGearHover,
}: {
  readonly text: string;
  readonly speakers: readonly Speaker[];
  readonly onMark?: OnMark | undefined;
  readonly glossary: GlossMatcher | null | undefined;
  readonly gearMatcher: GearMatcher | null | undefined;
  readonly onGearHover?: OnGearHover | undefined;
}) {
  return (
    <>
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
              title={s.place !== undefined ? `在地图上看 ${part.text}` : `查看 ${part.text} 的档案`}
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
            {splitGear(part.text, gearMatcher).map((seg, g) =>
              seg.gear ? (
                <button
                  // biome-ignore lint/suspicious/noArrayIndexKey: 同一段里的片段按顺序排，不会重排
                  key={g}
                  type="button"
                  className={styles.gearMention}
                  data-kind={seg.gear.kind}
                  data-iconic={seg.gear.iconic || undefined}
                  aria-label={`${seg.gear.name}（${seg.gear.categoryLabel}）：${seg.gear.ability}`}
                  onMouseEnter={(e) =>
                    onGearHover?.({
                      item: seg.gear as InlineGearItem,
                      rect: e.currentTarget.getBoundingClientRect(),
                    })
                  }
                  onMouseLeave={() => onGearHover?.(null)}
                  onFocus={(e) =>
                    onGearHover?.({
                      item: seg.gear as InlineGearItem,
                      rect: e.currentTarget.getBoundingClientRect(),
                    })
                  }
                  onBlur={() => onGearHover?.(null)}
                >
                  {seg.text}
                </button>
              ) : (
                // biome-ignore lint/suspicious/noArrayIndexKey: 同上
                <Fragment key={g}>
                  {splitSlang(seg.text, glossary).map((bit, j) =>
                    bit.meaning ? (
                      <abbr
                        // biome-ignore lint/suspicious/noArrayIndexKey: 同上
                        key={j}
                        className={styles.slang}
                        data-meaning={bit.meaning}
                        aria-label={`${bit.text}：${bit.meaning}`}
                      >
                        {bit.text}
                      </abbr>
                    ) : (
                      bit.text
                    ),
                  )}
                </Fragment>
              ),
            )}
          </Fragment>
        );
      })}
    </>
  );
}

/** 台词统一上色，行内的人物、地点、武器、义体与术语保留原有交互。 */
function Paragraph({
  text,
  speakers,
  onMark,
  gearMatcher,
  onGearHover,
}: {
  readonly text: readonly DialoguePart[];
  readonly speakers: readonly Speaker[];
  readonly onMark?: OnMark | undefined;
  readonly gearMatcher?: GearMatcher | null | undefined;
  readonly onGearHover?: OnGearHover | undefined;
}) {
  const glossary = useGlossary();
  return (
    <p>
      {text.map((part, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: 正文片段按原文顺序展示，不会重排
        <span key={i} className={part.dialogue ? styles.dialogue : undefined}>
          <InlineText
            text={part.text}
            speakers={speakers}
            onMark={onMark}
            glossary={glossary}
            gearMatcher={gearMatcher}
            onGearHover={onGearHover}
          />
        </span>
      ))}
    </p>
  );
}

/** 只读该轮正文与结算时保存的视觉资料，重绘时不借用当前世界。 */
export function buildTurnPromptRequest(turn: Turn): TurnImagePromptInput {
  return {
    kind: "turn",
    sceneText: turn.text,
    actionText: turn.input.text.trim(),
    location: turn.imageContext?.location ?? "",
    district: turn.imageContext?.district ?? "",
    timeText: turn.imageContext?.timeText ?? "",
    weather: turn.imageContext?.weather ?? "",
    characters: turn.imageContext?.characters ?? [],
    instruction: "",
  };
}

function UiActionsStrip({
  actions,
  pending = false,
}: {
  readonly actions: readonly { readonly seq: number; readonly summary: string }[];
  readonly pending?: boolean;
}) {
  if (actions.length === 0) return null;
  return (
    <aside
      className={styles.uiActions}
      data-pending={pending || undefined}
      aria-label={pending ? "待写进下一条正文的界面操作" : "本轮前界面操作"}
    >
      <span className={styles.uiActionsTag}>
        {pending ? "已结算 · 将写入下一条正文" : "界面操作"}
      </span>
      <ul className={styles.uiActionsList}>
        {actions.map((action) => (
          <li key={action.seq}>{action.summary}</li>
        ))}
      </ul>
    </aside>
  );
}

function TurnBlock({
  turn,
  view,
  saveId,
  speakers,
  gearMatcher,
  onGearHover,
  onRegenerate,
  onRewrite,
  onMark,
}: {
  readonly turn: Turn;
  readonly view: View;
  readonly saveId: string;
  readonly speakers: readonly Speaker[];
  readonly gearMatcher: GearMatcher | null;
  readonly onGearHover: OnGearHover;
  /** 只有最后一轮、没在生成时才有 */
  readonly onRegenerate?: (() => void) | undefined;
  /** 按账目改写；和重新生成同样只给最后一轮 */
  readonly onRewrite?: (() => Promise<void>) | undefined;
  /** 点了正文里的人名或地名 */
  readonly onMark?: OnMark | undefined;
}) {
  const prefs = useNarrativePrefs();
  const [rewriting, setRewriting] = useState(false);
  const [confirmRegen, setConfirmRegen] = useState(false);
  const saveImages = useSaveImages();
  const imageId = saveImages?.bindings.turns[String(turn.seq)] ?? null;
  const autoPending = saveImages?.pendingTurnSeqs.has(turn.seq) ?? false;
  const imageError = saveImages?.turnImageErrors[turn.seq];

  useEffect(() => {
    if (!confirmRegen) return;
    const t = window.setTimeout(() => setConfirmRegen(false), 4000);
    return () => window.clearTimeout(t);
  }, [confirmRegen]);

  const attachedMedia = turn.media?.map((group) => (
    <section className={mediaStyles.group} key={group.id} aria-label={group.title}>
      <h3 className={mediaStyles.groupTitle}>
        {group.source === "chip" ? "芯片" : "超梦"} · {group.title}
      </h3>
      <ContentMediaList media={group.media} />
    </section>
  ));

  const openIllustration = () => {
    if (!saveImages) return;
    saveImages.openImageModal({
      title: imageId ? `重绘 #${turn.seq + 1} 场景插图` : `为 #${turn.seq + 1} 生成场景插图`,
      subtitle: turn.sceneTitle ?? view.names.location ?? undefined,
      defaultAspectRatio: "16:9",
      bind: { kind: "turn", seq: turn.seq },
      promptRequest: buildTurnPromptRequest(turn),
    });
  };

  const display = useMemo(
    () => splitDisplayThought(turn.text, turn.thought),
    [turn.text, turn.thought],
  );

  return (
    <article className={styles.turn} data-boost={turn.sandevistan || undefined}>
      {prefs.sceneTitles && turn.sceneTitle && (
        <p className={styles.sceneTitle}>{turn.sceneTitle}</p>
      )}
      {turn.uiActions && turn.uiActions.length > 0 && <UiActionsStrip actions={turn.uiActions} />}
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
      {display.thought !== "" && <ThoughtBlock thought={display.thought} />}
      {turn.blackout ? (
        <details className={styles.blackout}>
          <summary className={styles.blackoutTitle}>
            [记忆缺失] 这一段角色记不起来；展开看回合日志里的原文
          </summary>
          {paragraphs(display.body).map((p, i) => (
            <Paragraph
              // biome-ignore lint/suspicious/noArrayIndexKey: 段落按正文顺序排，不会重排
              key={`${turn.seq}-${i}`}
              text={p}
              speakers={speakers}
              onMark={onMark}
              gearMatcher={gearMatcher}
              onGearHover={onGearHover}
            />
          ))}
          {attachedMedia}
        </details>
      ) : (
        <>
          {paragraphs(display.body).map((p, i) => (
            <Paragraph
              // biome-ignore lint/suspicious/noArrayIndexKey: 段落按正文顺序排，不会重排
              key={`${turn.seq}-${i}`}
              text={p}
              speakers={speakers}
              onMark={onMark}
              gearMatcher={gearMatcher}
              onGearHover={onGearHover}
            />
          ))}
          {attachedMedia}
        </>
      )}
      {imageId ? (
        <figure className={styles.turnIllustration}>
          <button
            type="button"
            className={styles.turnIllusButton}
            title="点击查看大图"
            onClick={() => saveImages?.openLightbox(imageId, `#${turn.seq + 1} 场景插图`)}
          >
            <GeneratedImage
              imageId={imageId}
              alt={`第 ${turn.seq + 1} 轮场景插图`}
              className={styles.turnIllusImg}
            />
          </button>
          <figcaption className={styles.turnIllusFoot}>
            <span>场景插图</span>
            <span className={styles.turnIllusActions}>
              <button type="button" className={styles.regenerate} onClick={openIllustration}>
                重绘
              </button>
              <button
                type="button"
                className={styles.regenerate}
                onClick={() => void saveImages?.unbindImage({ kind: "turn", seq: turn.seq })}
              >
                移除
              </button>
            </span>
          </figcaption>
        </figure>
      ) : null}
      {autoPending && (
        <div className={styles.turnIllusPending} role="status">
          <span>正在后台绘制本回合场景插图…</span>
          {saveImages?.manualPendingTurnSeqs.has(turn.seq) && (
            <button type="button" className={styles.regenerate} onClick={openIllustration}>
              查看进度
            </button>
          )}
          <button
            type="button"
            className={styles.regenerate}
            onClick={() => saveImages?.cancelTurnAutoImage(turn.seq)}
          >
            取消
          </button>
        </div>
      )}
      {!autoPending && imageError && (
        <div className={styles.turnIllusPending} role="status">
          <span>插图未能采用：{imageError}</span>
          <button type="button" className={styles.regenerate} onClick={openIllustration}>
            查看详情
          </button>
        </div>
      )}
      <footer className={styles.turnMeta}>
        {turn.unsettled && (
          <span className={styles.unsettled} title={turn.unsettled}>
            {turn.draft ? "本轮未完成记账（草稿）" : "本轮叙事和账目对不上"}
            <span className={styles.unsettledDetail}>：{turn.unsettled}</span>
          </span>
        )}
        {turn.unsettled && !turn.draft && onRegenerate && onRewrite && (
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
            title="账目不动，只按已记录的变化重写这一轮正文"
          >
            {rewriting ? "改写中…" : "按账目改写"}
          </button>
        )}
        {onRegenerate &&
          (confirmRegen ? (
            <span className={styles.regenConfirm}>
              <button
                type="button"
                className={`${styles.regenerate} ${styles.regenDanger}`}
                onClick={() => {
                  setConfirmRegen(false);
                  onRegenerate();
                }}
              >
                确认重写本轮
              </button>
              <button
                type="button"
                className={styles.regenerate}
                onClick={() => setConfirmRegen(false)}
              >
                取消
              </button>
            </span>
          ) : (
            <button
              type="button"
              className={styles.regenerate}
              onClick={() => setConfirmRegen(true)}
              title="作废这一轮，用同样的输入重新生成"
            >
              重新生成
            </button>
          ))}
        {saveImages && !imageId && !autoPending && (
          <button
            type="button"
            className={styles.regenerate}
            onClick={openIllustration}
            title="由文生图模型为这一轮剧情绘制场景插图"
          >
            生成插图
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

/** 正文：已写进存档的各轮，加上正在生成的这一轮；贴近底部时自动跟随，向上翻阅时提供一键回底 */
export function StoryLog({
  view,
  saveId,
  live,
  onRegenerate,
  onRewrite,
  onMark,
  openingGuide,
}: {
  readonly view: View;
  readonly saveId: string;
  readonly live: Live;
  /** 重新生成最后一轮；角色死了时不给 */
  readonly onRegenerate?: (() => void) | undefined;
  /** 按账目改写最后一轮；角色死了时不给 */
  readonly onRewrite?: (() => Promise<void>) | undefined;
  /** 点了正文里的人名或地名；正在生成的这一轮还在变，不给点 */
  readonly onMark?: OnMark | undefined;
  /** 0 轮新档开局引导快捷动作 */
  readonly openingGuide?: OpeningGuideActions | undefined;
}) {
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [atBottom, setAtBottom] = useState(true);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onScroll = () => {
      const near = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
      stick.current = near;
      setAtBottom((prev) => (prev === near ? prev : near));
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useLayoutEffect(() => {
    const el = box.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  });

  const scrollToBottom = () => {
    const el = box.current;
    if (!el) return;
    stick.current = true;
    setAtBottom(true);
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  };

  const [gearHover, setGearHover] = useState<GearHoverState | null>(null);
  const onGearHover = useCallback<OnGearHover>((next) => setGearHover(next), []);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const hide = () => setGearHover(null);
    el.addEventListener("scroll", hide, { passive: true });
    return () => el.removeEventListener("scroll", hide);
  }, []);

  const generating = live.phase !== "idle";
  const liveBoosting =
    live.boost !== null ||
    (live.pending?.kind === "input" && live.pending.input.sandevistan === true);
  const earlier = view.totalTurns - view.turns.length;
  const speakers = useMemo(() => speakersOf(view), [view]);
  const gearMatcher = useMemo(
    () => buildGearMatcher(view, new Set(speakers.map((s) => s.name))),
    [view, speakers],
  );
  const liveDisplay = useMemo(
    () => (generating ? splitDisplayThought(live.text, live.thought) : { body: "", thought: "" }),
    [generating, live.text, live.thought],
  );
  const cpDisplay = useMemo(
    () =>
      !generating && view.checkpoint && view.checkpoint.baseVersion === view.version
        ? splitDisplayThought(
            view.checkpoint.narrativePreview ?? "",
            view.checkpoint.thoughtPreview,
          )
        : null,
    [generating, view.checkpoint, view.version],
  );

  return (
    <div className={styles.logShell}>
      <div className={styles.log} ref={box} aria-live="polite" aria-busy={generating}>
        <div className={styles.logInner}>
          {earlier > 0 && (
            <p className={styles.earlier}>
              <span>ARCHIVE</span>
              更早的 {earlier} 轮已归档
            </p>
          )}
          {view.turns.length === 0 && !generating && (
            <OpeningGuide view={view} busy={generating} actions={openingGuide ?? {}} />
          )}
          {view.turns.map((t, i) => (
            <TurnBlock
              key={t.seq}
              turn={t}
              view={view}
              saveId={saveId}
              speakers={speakers}
              gearMatcher={gearMatcher}
              onGearHover={onGearHover}
              onRegenerate={i === view.turns.length - 1 && !generating ? onRegenerate : undefined}
              onRewrite={onRewrite}
              onMark={onMark}
            />
          ))}

          {!generating && view.pendingUiActions && view.pendingUiActions.length > 0 && (
            <UiActionsStrip actions={view.pendingUiActions} pending />
          )}

          {!generating && view.offers.read && (
            <aside className={styles.read} aria-label="局势感知">
              <span className={styles.readTag}>{"KIROSHI // 局势感知"}</span>
              <p className={styles.readText}>{view.offers.read}</p>
            </aside>
          )}

          {!generating &&
            view.checkpoint &&
            view.checkpoint.baseVersion === view.version &&
            cpDisplay &&
            (cpDisplay.body !== "" || cpDisplay.thought !== "") && (
              <article className={styles.turn} data-live>
                <p className={styles.input} data-mode={view.checkpoint.input.mode}>
                  {formatInput(view.checkpoint.input)}
                </p>
                {cpDisplay.thought !== "" && <ThoughtBlock thought={cpDisplay.thought} />}
                {paragraphs(cpDisplay.body).map((p, i) => (
                  <Paragraph
                    // biome-ignore lint/suspicious/noArrayIndexKey: 断点预览正文按段落顺序展示
                    key={`cp-${i}`}
                    text={p}
                    speakers={speakers}
                    gearMatcher={gearMatcher}
                    onGearHover={onGearHover}
                  />
                ))}
                <p className={styles.dim}>
                  [断点已保存 · {view.checkpoint.completedLabels.join(" / ")}，等待继续完成剩余步骤]
                </p>
              </article>
            )}

          {generating && (
            <article className={styles.turn} data-live data-boost={liveBoosting || undefined}>
              {view.pendingUiActions && view.pendingUiActions.length > 0 && (
                <UiActionsStrip actions={view.pendingUiActions} />
              )}
              {live.pending?.kind === "input" && (
                <p
                  className={styles.input}
                  data-mode={live.pending.input.mode}
                  data-boost={liveBoosting || undefined}
                >
                  {formatInput(live.pending.input)}
                </p>
              )}
              {liveBoosting && (
                <p className={styles.boostLine}>
                  <span>{`SANDEVISTAN // ${live.boost?.name ?? "斯安威斯坦"}超频`}</span>
                </p>
              )}
              {liveDisplay.thought !== "" && (
                <ThoughtBlock thought={liveDisplay.thought} streaming={liveDisplay.body === ""} />
              )}
              {paragraphs(liveDisplay.body).map((p, i) => (
                <Paragraph
                  // biome-ignore lint/suspicious/noArrayIndexKey: 正在生成的正文只会往后追加
                  key={i}
                  text={p}
                  speakers={speakers}
                  gearMatcher={gearMatcher}
                  onGearHover={onGearHover}
                />
              ))}
              <span className={styles.caret} aria-hidden />
              <LiveStageBar stage={live.stage} trace={live.stageTrace} />
            </article>
          )}
        </div>
      </div>
      {gearHover && <GearHoverCard hover={gearHover} />}
      {!atBottom && (
        <button
          type="button"
          className={styles.scrollBottomBtn}
          data-live={generating || undefined}
          onClick={scrollToBottom}
        >
          {generating ? "↓ 跟随最新生成" : "↓ 回到最新"}
        </button>
      )}
    </div>
  );
}

const KEYS: readonly AssetId[] = ["key.1", "key.2", "key.3", "key.4"];

function ChoiceRow({
  choice,
  index,
  locked,
  onChoose,
}: {
  readonly choice: Choice;
  readonly index: number;
  readonly locked: boolean;
  readonly onChoose: (index: number) => void;
}) {
  const key = KEYS[index];
  const tilt = useCardTilt<HTMLButtonElement>({
    disabled: locked,
    maxRotate: 1.8,
    shadowShift: 1.5,
  });
  return (
    <li style={{ "--i": index } as CSSProperties}>
      <button
        type="button"
        className={styles.choice}
        disabled={locked}
        onClick={() => onChoose(index)}
        {...tilt}
      >
        {key ? (
          <Asset id={key} tint="currentColor" height={20} />
        ) : (
          <span className={styles.num}>{index + 1}</span>
        )}
        {choice.source && <span className={styles.source}>{choice.source}</span>}
        <span className={styles.choiceText}>{choice.text}</span>
        <span className={styles.choiceArrow} aria-hidden>
          ▸
        </span>
      </button>
    </li>
  );
}

/** 行动选项：纯直觉行动列表，数字键 1–4 直选 */
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
      {choices.map((c, i) => (
        <ChoiceRow
          // biome-ignore lint/suspicious/noArrayIndexKey: 选项的位置对应数字键，位置就是身份
          key={`${i}-${c.text}`}
          choice={c}
          index={i}
          locked={locked}
          onChoose={onChoose}
        />
      ))}
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
