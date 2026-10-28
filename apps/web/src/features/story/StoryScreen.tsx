import type { PlayerAction, TurnInput } from "@cp/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { ApiError, api, newRequestId } from "../../api/client";
import { cssUrl } from "../../ui/Asset";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { KeyBar, KeyHint } from "../../ui/KeyHint";
import { layerOpen } from "../../ui/layers";
import { useNarrativePrefs } from "../settings/prefs";
import { EmptyState } from "../status/StatusParts";
import { BraindanceEditor } from "./BraindanceEditor";
import { CheckBar } from "./CheckBar";
import type { StoryEnd } from "./ChroniclePanel";
import { CloseupQueue } from "./Closeup";
import { Banner, BioMonitor, Present, Track, Unread, Weapon, Zone } from "./Corners";
import { DivePanel } from "./DivePanel";
import { EscMenu } from "./EscMenu";
import { InputBar } from "./InputBar";
import { MapBody } from "./MapPanel";
import { NeuralInterface, type NeuralPage, PAGE_KEYS } from "./NeuralInterface";
import {
  CharacterPage,
  ContactsPage,
  CraftingPage,
  CyberwarePage,
  DatabasePage,
  InventoryPage,
  JournalPage,
  MessagesPage,
} from "./NeuralPages";
import { type NoteEntry, NotesPanel } from "./NotesPanel";
import { Ripperdoc } from "./Ripperdoc";
import {
  type EndedNemesis,
  NemesisSettlementCard,
  type SettledJob,
  SettlementCard,
} from "./Settlement";
import { Shop } from "./Shop";
import { StashPanel } from "./StashPanel";
import { ChoiceList, StoryLog } from "./StoryLog";
import { useStory } from "./store";
import styles from "./story.module.css";
import { Toasts } from "./Toasts";
import { diffViews, type Toast, type View } from "./view";

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || target.closest("input, textarea, select") !== null)
  );
}

/** 剧情主界面：顶部 HUD、左侧角色栏、中间正文、底部选项 / 检定确认 / 输入框 */
export function StoryScreen() {
  const { saveId = "" } = useParams();
  const navigate = useNavigate();
  const client = useQueryClient();
  const story = useStory();
  const { enter } = story;

  useEffect(() => enter(saveId), [enter, saveId]);

  const query = useQuery({
    queryKey: ["state", saveId],
    queryFn: () => api.state(saveId),
    enabled: saveId !== "",
    retry: (count, error) => !(error instanceof ApiError && error.status === 404) && count < 2,
  });
  const view = query.data;

  const refresh = useCallback(
    () => client.refetchQueries({ queryKey: ["state", saveId], exact: true }),
    [client, saveId],
  );

  // 新的一轮写进存档后，和上一次看到的状态比，弹出变化提示
  const [toasts, setToasts] = useState<readonly Toast[]>([]);
  // Z 键的通知记录：弹过的系统通知都记一份，只在网页里，不写存档
  const [notes, setNotes] = useState<readonly NoteEntry[]>([]);
  const previous = useRef<View | null>(null);
  // 委托结束后排队弹出的结算卡
  const [settled, setSettled] = useState<readonly SettledJob[]>([]);
  const closeSettlement = useCallback(() => setSettled((q) => q.slice(1)), []);
  // 了结宿敌后排队弹出的结算卡，在委托结算卡之后
  const [rivalsDone, setRivalsDone] = useState<readonly EndedNemesis[]>([]);
  const closeRival = useCallback(() => setRivalsDone((q) => q.slice(1)), []);
  useEffect(() => {
    if (!view) return;
    const prev = previous.current;
    previous.current = view;
    if (!prev) return;
    const fresh = diffViews(prev, view);
    if (fresh.length > 0) {
      setToasts((t) => [...t, ...fresh].slice(-6));
      const at = view.time.text;
      setNotes((n) => [...n, ...fresh.map((f) => ({ ...f, at }))].slice(-100));
    }
    const wasOpen = new Set(prev.jobs.list.filter((j) => j.open).map((j) => j.id));
    const closed = view.jobs.list.filter(
      (j) => !j.open && j.settlement !== null && wasOpen.has(j.id),
    );
    if (closed.length > 0) setSettled((q) => [...q, ...closed]);
    const wasEnded = new Set(prev.nemesesEnded.map((n) => n.npc));
    const ended = view.nemesesEnded.filter((n) => !wasEnded.has(n.npc));
    if (ended.length > 0) setRivalsDone((q) => [...q, ...ended]);
  }, [view]);
  const dropToast = useCallback(
    (key: string) => setToasts((t) => t.filter((x) => x.key !== key)),
    [],
  );

  // 当前打开的检定：已掷过骰的那个优先；其次是叙事模型这轮直接要求的检定（不挂在选项上）
  const version = view?.version ?? 0;
  const [picked, setPicked] = useState<{ readonly id: string; readonly version: number } | null>(
    null,
  );
  const pickedId = picked?.version === version ? picked.id : null;
  const offers = view?.offers;
  const choiceChecks = useMemo(
    () => new Set(offers?.choices.flatMap((c) => (c.checkId ? [c.checkId] : [])) ?? []),
    [offers],
  );
  const mainCheck = offers?.checks.find((c) => !choiceChecks.has(c.id)) ?? null;
  const openId = offers?.rolled ?? pickedId ?? mainCheck?.id ?? null;
  const openCheck = offers?.checks.find((c) => c.id === openId) ?? null;

  const busy = story.phase !== "idle";
  // 神经界面开着的那一页；I 键重开时回到上次看的那页
  const [neural, setNeural] = useState<NeuralPage | null>(null);
  const lastPage = useRef<NeuralPage>("character");
  const closeNeural = useCallback(() => setNeural(null), []);
  // 商店、义体医生、存放、超梦叠在神经界面上面（U3 商店等改走 F 交互）
  const [atDoc, setAtDoc] = useState(false);
  const [atShop, setAtShop] = useState<string | null>(null);
  const [atStash, setAtStash] = useState(false);
  const [atBraindance, setAtBraindance] = useState(false);
  // 准备买下的公寓 id：先弹确认框
  const [buyingHome, setBuyingHome] = useState<string | null>(null);
  // 按住 Tab 扫描；Z 通知记录；什么都没开时按 Esc 弹出的小菜单
  const [scan, setScan] = useState(false);
  const [atNotes, setAtNotes] = useState(false);
  const [atEsc, setAtEsc] = useState(false);

  const warn = useCallback((key: string, error: unknown) => {
    const text = error instanceof Error ? error.message : String(error);
    const toast: Toast = { key: `${key}-${Date.now()}`, icon: "notify.warning", text, tone: "bad" };
    setToasts((t) => [...t, toast].slice(-6));
  }, []);

  // 界面操作统一走这里：不调用模型，失败时用提示条说明原因，之后刷新状态。
  // rethrow 时刷新后把错误抛回去，让确认框或表单留着
  const act = useCallback(
    async (action: PlayerAction, key: string, rethrow = false) => {
      try {
        await api.action(saveId, { requestId: newRequestId(), baseVersion: version, action });
      } catch (error) {
        warn(key, error);
        if (rethrow) {
          await refresh();
          throw error;
        }
      }
      await refresh();
    },
    [saveId, version, refresh, warn],
  );

  // 夜之城难度死亡后重来：作废这个场景的回合，回到场景开头
  const restart = useCallback(async () => {
    try {
      await api.restart(saveId, version);
    } catch (error) {
      warn("restart", error);
    }
    await refresh();
  }, [saveId, version, refresh, warn]);

  // 重新生成最后一轮：后端作废它，再用当时的输入或检定按原流程提交；骰子不重掷
  const regenerate = useCallback(async () => {
    try {
      const r = await api.regenerate(saveId, version);
      await refresh();
      await story.submit(saveId, r.version, r.pending, refresh);
    } catch (error) {
      warn("regenerate", error);
      await refresh();
    }
  }, [saveId, version, refresh, warn, story]);

  // 按账目改写最后一轮：只换正文，不重掷、不改状态
  const rewrite = useCallback(async () => {
    try {
      await api.rewrite(saveId, version);
    } catch (error) {
      warn("rewrite", error);
    }
    await refresh();
  }, [saveId, version, refresh, warn]);

  // 打开神经界面的一页；切到消息页时未读私信标成已读，不调用模型
  const unread = view?.phone.unread ?? 0;
  const openNeural = useCallback(
    (page: NeuralPage) => {
      lastPage.current = page;
      setNeural(page);
      if (page === "messages" && unread > 0) void act({ type: "readMessages" }, "phone");
    },
    [act, unread],
  );
  // 切到消息页的新闻栏：只把新闻频道的未读标成已读；警方频段和街头传闻在 U4 接
  const unreadNews = view?.phone.feedUnread.news;
  const readNews = useCallback(async () => {
    if (!unreadNews || unreadNews.length === 0) return;
    await act({ type: "readMessages", feed: [...unreadNews] }, "news");
  }, [act, unreadNews]);
  // 新接上一段超梦就打开编辑器；同一段关掉以后不再自己弹出来
  const bdKey = view?.braindance.active
    ? `${view.braindance.active.title}@${view.braindance.active.startedAt}`
    : null;
  const bdSeen = useRef<string | null>(null);
  useEffect(() => {
    if (bdKey === null || bdKey === bdSeen.current) return;
    bdSeen.current = bdKey;
    setAtBraindance(true);
  }, [bdKey]);
  // 买公寓：先关闭确认框，再提交操作；失败时提示原因
  const homeAction = useCallback(
    async (id: string) => {
      setBuyingHome(null);
      await act({ type: "buyHome", id }, "home");
    },
    [act],
  );

  const send = useCallback(
    (input: TurnInput) => {
      if (!view) return;
      void story.submit(saveId, version, { kind: "input", input }, refresh);
    },
    [story, saveId, version, view, refresh],
  );
  const narrative = useNarrativePrefs();
  const confirm = useCallback(
    (checkId: string, label: string, matrix?: number) => {
      void story.submit(
        saveId,
        version,
        { kind: "confirm", checkId, label, ...(matrix === undefined ? {} : { matrix }) },
        refresh,
      );
    },
    [story, saveId, version, refresh],
  );
  const retry = useCallback(() => {
    const pending = story.pending;
    story.dismiss();
    if (pending) void story.submit(saveId, version, pending, refresh);
  }, [story, saveId, version, refresh]);

  const choose = useCallback(
    (index: number) => {
      const choice = offers?.choices[index];
      if (!choice || busy || offers?.rolled) return;
      if (choice.gate && !choice.gate.met) return;
      if (choice.checkId) {
        setPicked({ id: choice.checkId, version });
        return;
      }
      send({ text: choice.text });
    },
    [offers, busy, send, version],
  );

  // 剧情页的键（计划第七节第 2 条）：1–5 选选项，I 神经界面（回到上次那页），P/O/K/J/M/T 直达各页，
  // Z 通知记录，按住 Tab 扫描。有面板开着时一律不响应，Esc 由面板栈交给最上面那层；
  // 神经界面里的 Q/E 翻页和 I 关闭由 NeuralInterface 自己管
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
      if (layerOpen() || story.spend) return;
      if (e.key === "Tab") {
        // 按住扫描，松开收起；不让焦点跳走
        e.preventDefault();
        if (!e.repeat) setScan(true);
        return;
      }
      if (e.repeat) return;
      const k = e.key.toLowerCase();
      const page = (PAGE_KEYS as Readonly<Record<string, NeuralPage | undefined>>)[k];
      if (k === "i") {
        e.preventDefault();
        openNeural(lastPage.current);
      } else if (page) {
        e.preventDefault();
        openNeural(page);
      } else if (k === "z") {
        e.preventDefault();
        setAtNotes(true);
      } else if (/^[1-5]$/.test(e.key)) {
        e.preventDefault();
        choose(Number(e.key) - 1);
      } else if (e.key === "Escape" && !story.failure) {
        // 先收起检定（已掷过骰的不能收起），什么都没开时弹 Esc 菜单，不再直接回主菜单
        if (pickedId && !offers?.rolled) setPicked(null);
        else if (!pickedId) setAtEsc(true);
      }
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.key === "Tab") setScan(false);
    };
    // 按着 Tab 切走窗口收不到 keyup，失焦时也收起
    const onBlur = () => setScan(false);
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [choose, pickedId, offers?.rolled, story.failure, story.spend, openNeural]);

  if (query.isPending) {
    return (
      <div className={styles.center}>
        <span className={styles.loading}>正在读取存档…</span>
      </div>
    );
  }
  if (query.isError || !view) {
    const missing = query.error instanceof ApiError && query.error.status === 404;
    return (
      <div className={styles.center}>
        <EmptyState
          text={
            missing
              ? "找不到这个存档，可能已经被删掉了"
              : `读取存档失败：${query.error instanceof Error ? query.error.message : "未知错误"}`
          }
          action={<Button onClick={() => navigate("/menu")}>回主菜单</Button>}
        />
      </div>
    );
  }

  const failure = story.failure;
  const severe = view.health.wound === "severe" || view.health.condition !== "up";
  const draftFromCheck = (label: string) => {
    story.setDraft({ text: label });
    setPicked(null);
  };

  /** 人性干扰的强度：0 没有，3 最强；人性归零、发作和记忆空白时拉满 */
  const glitch =
    view.humanity.current === 0 || view.psychosis.episodeHere || view.psychosis.blackoutOpen
      ? 3
      : view.humanity.current < 25
        ? 2
        : view.humanity.current < 40
          ? 1
          : 0;
  return (
    <div
      className={styles.screen}
      data-severe={severe || undefined}
      data-stage={view.humanity.stage}
      data-glitch={glitch || undefined}
      style={
        severe ? ({ "--glow-img": cssUrl("hud.damageGlow") ?? "none" } as CSSProperties) : undefined
      }
    >
      <div className={styles.fx} aria-hidden />
      <div className={styles.weather} data-weather={view.weather.kind} aria-hidden />
      <div className={styles.glitch} data-level={glitch} aria-hidden />
      {/* 四角（计划第九节）：A 左上、S 左中、G 左下、B 右上、C 右中、H 右下 */}
      <BioMonitor view={view} onSheet={() => openNeural("character")} />
      <Present view={view} scan={scan} />
      <Unread view={view} />
      <Zone view={view} />
      {/* D 系统通知紧贴在 C 追踪下面，追踪多高都跟着走 */}
      <Track view={view}>
        {toasts.length > 0 && <Toasts toasts={toasts} onDone={dropToast} />}
      </Track>
      <Weapon
        view={view}
        onQuickhack={
          busy
            ? undefined
            : (name) =>
                story.setDraft({
                  text: `${story.draft.text}${story.draft.text ? " " : ""}用快速破解「${name}」`,
                })
        }
      />
      {view.hacking?.dive && <DivePanel dive={view.hacking.dive} health={view.health} />}
      {/* 神经界面（计划第五节第 4 条）：九页，Q/E 翻页，I 或 Esc 关；商店、义体医生、存放、超梦叠在上面 */}
      {neural && (
        <NeuralInterface
          page={neural}
          eddies={view.money.eddies}
          badges={{ messages: view.phone.unread, database: view.shards.unread }}
          onPage={openNeural}
          onClose={closeNeural}
        >
          {neural === "character" && (
            <CharacterPage
              view={view}
              onSpend={
                busy || offers?.rolled
                  ? undefined
                  : (attribute) => void act({ type: "spendPoint", attribute }, "spend")
              }
              onHabit={
                busy
                  ? undefined
                  : (action, text) => void act({ type: "habit", action, text }, "habit")
              }
            />
          )}
          {neural === "cyberware" && (
            <CyberwarePage view={view} onRipperdoc={() => setAtDoc(true)} />
          )}
          {neural === "inventory" && (
            <InventoryPage
              view={view}
              onEquip={busy ? undefined : (id) => void act({ type: "equipItem", id }, "gear")}
              onUnequip={busy ? undefined : (id) => void act({ type: "unequipItem", id }, "gear")}
              onOutfit={busy ? undefined : (action) => void act({ type: "outfit", action }, "gear")}
              onMod={
                busy
                  ? undefined
                  : (action, weapon, mod) =>
                      void act({ type: "modWeapon", action, weapon, mod }, "gear")
              }
              onShop={setAtShop}
              onStash={() => setAtStash(true)}
              onBuyHome={busy || offers?.rolled ? undefined : setBuyingHome}
            />
          )}
          {neural === "crafting" && (
            <CraftingPage
              view={view}
              onCraft={
                busy ? undefined : (action, id) => void act({ type: "craft", action, id }, "craft")
              }
            />
          )}
          {neural === "journal" && (
            <JournalPage
              view={view}
              onAccept={
                busy || offers?.rolled
                  ? undefined
                  : (id) => act({ type: "acceptJob", id }, "accept", true)
              }
              onBraindance={() => setAtBraindance(true)}
            />
          )}
          {neural === "map" && (
            <MapBody
              view={view}
              onTravel={
                busy || offers?.rolled
                  ? undefined
                  : (dest, route) => {
                      setNeural(null);
                      send({
                        text: `${route.label}去${dest.name}`,
                        travel: { to: dest.id, mode: route.mode },
                      });
                    }
              }
            />
          )}
          {neural === "messages" && (
            <MessagesPage
              view={view}
              onNews={() => void readNews()}
              onReply={
                busy
                  ? undefined
                  : (id) => {
                      story.setDraft({ replyTo: id });
                      setNeural(null);
                    }
              }
            />
          )}
          {neural === "contacts" && (
            <ContactsPage
              view={view}
              onSquad={
                busy
                  ? undefined
                  : (action, npc) => void act({ type: "squad", action, npc }, "squad")
              }
            />
          )}
          {neural === "database" && (
            <DatabasePage
              view={view}
              onReadShard={(id) => void act({ type: "readShards", ids: [id] }, "shards")}
              onEdit={
                busy ? undefined : (edit) => act({ type: "editMemory", ...edit }, "memory", true)
              }
              onEnd={
                busy || view.death || view.ended
                  ? undefined
                  : (how: StoryEnd, epitaph: string | undefined) =>
                      act(
                        { type: "endStory", how, ...(epitaph ? { epitaph } : {}) },
                        "chronicle",
                        true,
                      )
              }
            />
          )}
        </NeuralInterface>
      )}

      <main className={styles.column}>
        {/* 横幅：交战、对峙、潜网、闪回，同时只出一个 */}
        <Banner view={view} />
        <StoryLog
          view={view}
          saveId={saveId}
          live={story}
          onRegenerate={view.death || view.ended ? undefined : () => void regenerate()}
          onRewrite={view.death || view.ended ? undefined : rewrite}
        />

        {failure &&
          (failure.kind === "stopped" ||
            failure.kind === "rejected" ||
            failure.kind === "lost") && (
            <div className={styles.notice} data-kind={failure.kind} role="status">
              <span>{failure.message}</span>
              {failure.retryable && <Button onClick={retry}>重试</Button>}
              <Button onClick={story.dismiss}>知道了</Button>
            </div>
          )}

        <div className={styles.dock}>
          {openCheck ? (
            <CheckBar
              key={openCheck.id}
              check={openCheck}
              matrix={
                narrative.breachMatrix &&
                view.hacking !== null &&
                openCheck.attribute === "intelligence" &&
                !offers?.rolled
              }
              busy={busy}
              closable={!offers?.rolled && openCheck.id === pickedId}
              onConfirm={(matrix) => confirm(openCheck.id, openCheck.label, matrix)}
              onRewrite={() => draftFromCheck(openCheck.label)}
              onClose={() => setPicked(null)}
            />
          ) : (
            view.offers.choices.length > 0 &&
            !busy && (
              <ChoiceList
                choices={view.offers.choices}
                attributes={view.character.attributes}
                locked={offers?.rolled != null}
                onChoose={choose}
              />
            )
          )}
          {view.death && (
            <div className={styles.notice} data-kind="dead" role="alert">
              <span>
                {view.death.canRestart
                  ? "你死了。夜之城难度下可以从这个场景开头重来一次：这个场景发生的事全部作废，骰子重新掷，履历里记一笔“重来过”。"
                  : view.difficulty === "nightCity"
                    ? "你死了。这个场景已经重来过一次，这一次是真的死了；存档到此为止，只能回看。"
                    : "你死了。这份存档到此为止，只能回看。"}
              </span>
              {view.death.canRestart && (
                <Button onClick={() => void restart()} disabled={busy}>
                  从场景开头重来
                </Button>
              )}
            </div>
          )}
          {view.ended && !view.death && (
            <div className={styles.notice} data-kind="dead" role="status">
              <span>
                {view.ended.how === "retired"
                  ? "你离开了这一行，活着走出了夜之城。"
                  : "故事停在这里。"}
                {view.ended.epitaph && `「${view.ended.epitaph}」`}
                这份存档只能回看，角色已经进了主菜单的传说名册。
              </span>
              <Button onClick={() => openNeural("database")}>看履历</Button>
            </div>
          )}
          <InputBar
            busy={busy}
            streaming={story.phase === "streaming"}
            disabled={offers?.rolled != null || view.death !== null || view.ended !== null}
            reason={
              view.death !== null
                ? "角色已经死亡"
                : view.ended !== null
                  ? "这个角色的故事已经结束"
                  : offers?.rolled != null
                    ? "上一次检定已经掷过骰，先继续结算"
                    : undefined
            }
            draft={story.draft}
            onDraft={story.setDraft}
            reply={
              story.draft.replyTo === undefined
                ? undefined
                : view.phone.messages.find((m) => m.id === story.draft.replyTo)
            }
            onCancelReply={() => story.setDraft({ replyTo: undefined } as Partial<TurnInput>)}
            boost={offers?.clutch && view.sandevistan ? view.sandevistan : undefined}
            onSend={send}
            onStop={() => void story.stop()}
          />
          {/* 键位图标是原作 icons_keyboard；原作图集里没有 Z，通知记录的键照样能用，只是这里不列 */}
          <KeyBar>
            <KeyHint keyId="key.i" label="神经界面" onClick={() => openNeural(lastPage.current)} />
            <KeyHint keyId="key.j" label="日志" onClick={() => openNeural("journal")} />
            <KeyHint keyId="key.m" label="地图" onClick={() => openNeural("map")} />
            <KeyHint keyId="key.t" label="消息" onClick={() => openNeural("messages")} />
            <KeyHint keyId="key.tab" label="扫描（长按）" />
            <KeyHint keyId="key.esc" label="菜单" onClick={() => setAtEsc(true)} />
          </KeyBar>
        </div>
      </main>

      {atEsc && (
        <EscMenu
          onResume={() => setAtEsc(false)}
          onSettings={() => navigate(`/settings?tab=context&save=${saveId}`)}
          onQuit={busy ? undefined : () => navigate("/menu")}
        />
      )}

      {failure?.kind === "unavailable" && (
        <Dialog
          title="模型没有配好"
          tone="warning"
          onClose={story.dismiss}
          actions={
            <>
              <Button primary onClick={() => navigate("/settings")}>
                去设置
              </Button>
              <Button onClick={story.dismiss}>关闭</Button>
            </>
          }
        >
          <p>{failure.message}</p>
          <p>你的输入还留在输入框里，配好以后可以直接重发。</p>
        </Dialog>
      )}
      {atShop &&
        (() => {
          const shop = view.shops.find((s) => s.id === atShop);
          return (
            shop && (
              <Shop
                view={view}
                shop={shop}
                onBuy={
                  busy
                    ? undefined
                    : (id) => act({ type: "buyItem", shop: shop.id, id }, "shop", true)
                }
                onSell={
                  busy
                    ? undefined
                    : (id) => act({ type: "sellItem", shop: shop.id, id }, "shop", true)
                }
                onClose={() => setAtShop(null)}
              />
            )
          );
        })()}
      {atDoc && view.ripperdoc && (
        <Ripperdoc
          view={view}
          doc={view.ripperdoc}
          onBuy={
            busy
              ? undefined
              : async (id, credit) => {
                  const doc = view.ripperdoc;
                  if (!doc) return;
                  await act({ type: "buyCyberware", id, credit, doc: doc.id }, "ripperdoc", true);
                }
          }
          onRemove={
            busy
              ? undefined
              : async (id) => {
                  const doc = view.ripperdoc;
                  if (!doc) return;
                  await act({ type: "removeCyberware", id, doc: doc.id }, "ripperdoc", true);
                }
          }
          onRepay={
            busy
              ? undefined
              : async () => {
                  const doc = view.ripperdoc;
                  if (!doc) return;
                  await act({ type: "repayRipperdoc", doc: doc.id }, "ripperdoc", true);
                }
          }
          onRepair={
            busy
              ? undefined
              : async (id) => {
                  const doc = view.ripperdoc;
                  if (!doc) return;
                  await act({ type: "repairCyberware", id, doc: doc.id }, "ripperdoc", true);
                }
          }
          onClose={() => setAtDoc(false)}
        />
      )}
      {atStash && (
        <StashPanel
          view={view}
          onMove={
            busy
              ? undefined
              : (action, item, where) => void act({ type: "stash", action, item, where }, "gear")
          }
          onClose={() => setAtStash(false)}
        />
      )}
      {buyingHome &&
        (() => {
          const home = view.safehouse.forSale.find((h) => h.id === buyingHome);
          return (
            home && (
              <Dialog
                title={`买下${home.name}`}
                tone="info"
                onClose={() => setBuyingHome(null)}
                actions={
                  <>
                    <Button primary disabled={busy} onClick={() => void homeAction(home.id)}>
                      一次付清
                    </Button>
                    <Button onClick={() => setBuyingHome(null)}>再想想</Button>
                  </>
                }
              >
                <p>{home.note}</p>
                <p>
                  要 {home.price.toLocaleString("en-US")} 欧元，身上有{" "}
                  {view.money.eddies.toLocaleString("en-US")} 欧元，付完剩{" "}
                  {(view.money.eddies - home.price).toLocaleString("en-US")}
                  。不收房租，买下后有床、存放箱和衣柜，躲在里面热度降得快。
                </p>
              </Dialog>
            )
          );
        })()}
      {atNotes && <NotesPanel notes={notes} onClose={() => setAtNotes(false)} />}
      {atBraindance && view.braindance.active && (
        <BraindanceEditor
          view={view}
          onMark={
            busy
              ? undefined
              : (point) => void act({ type: "braindance", action: "mark", point }, "braindance")
          }
          onConclude={
            busy || offers?.rolled
              ? undefined
              : (id, text) => {
                  setAtBraindance(false);
                  send({ text: `超梦里的结论：${text}`, braindance: id });
                }
          }
          onAbandon={
            busy || offers?.rolled
              ? undefined
              : () => {
                  setAtBraindance(false);
                  send({ text: "退出超梦，不查了", braindance: "abandon" });
                }
          }
          onClose={() => setAtBraindance(false)}
        />
      )}
      {settled[0] && <SettlementCard job={settled[0]} onClose={closeSettlement} />}
      {!settled[0] && rivalsDone[0] && (
        <NemesisSettlementCard nemesis={rivalsDone[0]} onClose={closeRival} />
      )}
      {!settled[0] && !rivalsDone[0] && <CloseupQueue turns={view.turns} />}
      {story.spend && (
        <Dialog
          title={`花一大笔钱：${story.spend.label}`}
          tone="info"
          onClose={story.cancelSpend}
          actions={
            <>
              <Button
                primary
                onClick={() => {
                  const spend = story.spend;
                  if (spend) send({ ...spend.input, spendOk: true });
                }}
              >
                花这笔钱
              </Button>
              <Button onClick={story.cancelSpend}>再想想</Button>
            </>
          }
        >
          <p>
            要花 {story.spend.price.toLocaleString("en-US")} 欧元，身上有{" "}
            {story.spend.eddies.toLocaleString("en-US")} 欧元，花完剩{" "}
            {(story.spend.eddies - story.spend.price).toLocaleString("en-US")}。
          </p>
          <p>取消不算一轮，输入还留在输入框里。</p>
        </Dialog>
      )}
      {failure?.kind === "blocked" && (
        <Dialog
          title="这一轮被安全过滤拦下了"
          tone="danger"
          onClose={story.dismiss}
          actions={
            <>
              <Button primary onClick={retry}>
                原样重试
              </Button>
              <Button onClick={story.dismiss}>改一改再发</Button>
            </>
          }
        >
          <p>{failure.message}</p>
          <p>这一轮没有写进存档。可以换个说法，或者到设置里检查这个方案的安全选项。</p>
        </Dialog>
      )}
      {failure?.kind === "error" && (
        <Dialog
          title="生成出错"
          tone="danger"
          onClose={story.dismiss}
          actions={
            <>
              {failure.retryable && (
                <Button primary onClick={retry}>
                  重试
                </Button>
              )}
              <Button onClick={story.dismiss}>关闭</Button>
            </>
          }
        >
          <p>{failure.message}</p>
          {!failure.retryable && <p>这个错误重试也不会好，先看看设置或后端日志。</p>}
        </Dialog>
      )}
    </div>
  );
}
