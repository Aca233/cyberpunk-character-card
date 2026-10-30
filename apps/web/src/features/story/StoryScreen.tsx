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
import {
  Banner,
  BioMonitor,
  CornerSide,
  PinTabs,
  Present,
  Track,
  Unread,
  Weapon,
  Zone,
} from "./Corners";
import { DivePanel } from "./DivePanel";
import { MapLayer } from "./EdgeDrawers";
import { EscMenu } from "./EscMenu";
import { InputBar } from "./InputBar";
import { MapBody } from "./MapPanel";
import {
  CharacterPage,
  CyberwarePage,
  DatabasePage,
  InventoryPage,
  JournalPage,
  MessagesPage,
} from "./NeuralPages";
import { PoliceBody } from "./NewsPanel";
import { type NoteEntry, NotesPanel } from "./NotesPanel";
import neuralStyles from "./neural.module.css";
import { type Expand, peekOnTop } from "./peek";
import { Ripperdoc } from "./Ripperdoc";
import {
  type EndedNemesis,
  NemesisSettlementCard,
  type SettledJob,
  SettlementCard,
} from "./Settlement";
import { Shop } from "./Shop";
import { StashBody, stashHere } from "./StashPanel";
import { ChoiceList, StoryLog } from "./StoryLog";
import { useStory } from "./store";
import styles from "./story.module.css";
import { Toasts } from "./Toasts";
import { diffViews, type Toast, type View } from "./view";

/** 钉住的追踪块、未读块里的页签 */
type TrackTab = "todo" | "jobs" | "database";
type UnreadTab = "messages" | "news" | "police";
/** 不再开全屏神经界面（第十二节第 10 条）：物品栏进 H 武器块，义体进 A 生物监测块；
 * 物品栏精简（用户定的方案 A）：制作页签去掉，武器块只剩物品栏 */
type GearTab = "inventory";
type BioTab = "character" | "cyberware";

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
  // 物品栏、制作、义体不再开全屏（第十二节第 10 条），各自停在块里的哪个页签；收起后再钉住还是那个
  const [gearTab, setGearTab] = useState<GearTab>("inventory");
  const [bioTab, setBioTab] = useState<BioTab>("character");
  // 视野里就地展开（第十二节第 7 条）：四角的块、在场的人，同一时间只展开一处；
  // 钉住（点块或按 P/J/T）时块里放完整内容
  const [expand, setExpand] = useState<Expand | null>(null);
  const peek = useMemo(() => ({ expand, setExpand }), [expand]);
  // 钉住的追踪块、未读块各自停在哪个页签；收起后再钉住还是那个
  const [trackTab, setTrackTab] = useState<TrackTab>("todo");
  const [unreadTab, setUnreadTab] = useState<UnreadTab>("messages");
  // 地图浮层（M）
  const [atMap, setAtMap] = useState(false);
  const closeMap = useCallback(() => setAtMap(false), []);
  const closePinned = useCallback(() => setExpand(null), []);
  // 商店、义体医生、超梦叠在神经界面上面（U3 商店等改走 F 交互）；存放不再弹窗，进右上角地点块（用户定的）
  const [atDoc, setAtDoc] = useState(false);
  const [atShop, setAtShop] = useState<string | null>(null);
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

  // O 物品栏、K 制作：钉住 H 武器块并切到那个页签；同一页签已经钉着就收起（第十二节第 10 条）
  const showGear = useCallback(
    (tab: GearTab) => {
      setAtMap(false);
      setGearTab(tab);
      setExpand((cur) =>
        cur?.id === "weapon" && cur.pinned && gearTab === tab
          ? null
          : { id: "weapon", pinned: true },
      );
    },
    [gearTab],
  );
  const openMap = useCallback(() => {
    setExpand(null);
    setAtMap(true);
  }, []);
  // 钉住一个块（P 生物监测、J 追踪、T 未读）；按键时同一块已经钉着就收起
  const pinBlock = useCallback((id: string) => {
    setAtMap(false);
    setExpand((cur) => (cur?.id === id && cur.pinned ? null : { id, pinned: true }));
  }, []);
  const showTrack = useCallback((tab: TrackTab) => {
    setTrackTab(tab);
    setExpand({ id: "track", pinned: true });
  }, []);
  // 未读块钉在消息页签时未读私信标成已读，不调用模型
  const unread = view?.phone.unread ?? 0;
  const unreadPinned = expand?.id === "unread" && expand.pinned;
  const reading = useRef(false);
  useEffect(() => {
    if (!unreadPinned || unreadTab !== "messages" || unread === 0 || reading.current) return;
    reading.current = true;
    void act({ type: "readMessages" }, "phone").finally(() => {
      reading.current = false;
    });
  }, [unreadPinned, unreadTab, unread, act]);
  // 切到消息页的新闻栏：只把新闻频道的未读标成已读；街头传闻在 U4 接
  const unreadNews = view?.phone.feedUnread.news;
  const readNews = useCallback(async () => {
    if (!unreadNews || unreadNews.length === 0) return;
    await act({ type: "readMessages", feed: [...unreadNews] }, "news");
  }, [act, unreadNews]);
  // 切到警用频段：只把这个频道的未读标成已读（第六节第 1 条）
  const unreadPolice = view?.phone.feedUnread.police;
  const readPolice = useCallback(async () => {
    if (!unreadPolice || unreadPolice.length === 0) return;
    await act({ type: "readMessages", feed: [...unreadPolice] }, "police");
  }, [act, unreadPolice]);
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

  // 剧情页的键（计划第七节第 2 条）：1–5 选选项，P/O/K/J/T 钉住对应的四角块，M 地图，
  // Z 通知记录，按住 Tab 扫描。有面板开着时一律不响应，Esc 由面板栈交给最上面那层；
  // 全屏神经界面和 I 键已去掉（第十二节第 10 条）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
      // 钉住的展开层在栈顶时照常响应，商店、确认框这类层开着时不响应
      if ((layerOpen() && !peekOnTop()) || story.spend) return;
      if (e.key === "Tab") {
        // 按住扫描，松开收起；不让焦点跳走
        e.preventDefault();
        if (!e.repeat) setScan(true);
        return;
      }
      if (e.repeat) return;
      const k = e.key.toLowerCase();
      // 不再有全屏神经界面（第十二节第 10 条）：O 物品栏钉在 H 武器块里；K 制作随制作页签去掉（物品栏精简，方案 A）
      if (k === "o") {
        e.preventDefault();
        showGear("inventory");
      } else if (k === "p") {
        e.preventDefault();
        pinBlock("bio");
      } else if (k === "j") {
        e.preventDefault();
        pinBlock("track");
      } else if (k === "t") {
        e.preventDefault();
        pinBlock("unread");
      } else if (k === "m") {
        e.preventDefault();
        openMap();
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
  }, [choose, pickedId, offers?.rolled, story.failure, story.spend, showGear, pinBlock, openMap]);

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

  // 钉住块时块里放的完整内容（第十二节第 7 条）：还用 U2 的页面主体，只是放进四角那一列
  // A 生物监测：人物和义体两个页签（第十二节第 10 条），义体不再开全屏
  const characterFull = (
    <div className={neuralStyles.pinBody}>
      <PinTabs<BioTab>
        tabs={[
          ["character", "人物", view.character.attributePoints],
          ["cyberware", "义体", view.cyberware.filter((c) => c.broken).length],
        ]}
        value={bioTab}
        onChange={setBioTab}
      />
      {/* 按页签重新挂载，切页签时新内容淡入（第十二节第 13 条） */}
      <div key={bioTab} className={neuralStyles.pinPane}>
        {bioTab === "cyberware" ? (
          <CyberwarePage view={view} onRipperdoc={() => setAtDoc(true)} />
        ) : (
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
      </div>
    </div>
  );
  // H 武器块往上长，页签放在底下挨着武器格，同 G 未读（第十二节第 10 条）
  // 物品栏精简（用户定的方案 A）：制作页签和整套外观去掉，武器块里只放物品栏
  const gearTabs = (
    <PinTabs<GearTab> tabs={[["inventory", "物品栏", 0]]} value={gearTab} onChange={setGearTab} />
  );
  const gearFull = (
    <div key={gearTab} className={`${neuralStyles.pinBody} ${neuralStyles.pinPane}`}>
      <InventoryPage
        view={view}
        onEquip={busy ? undefined : (id) => void act({ type: "equipItem", id }, "gear")}
        onUnequip={busy ? undefined : (id) => void act({ type: "unequipItem", id }, "gear")}
        onMod={
          busy
            ? undefined
            : (action, weapon, mod) => void act({ type: "modWeapon", action, weapon, mod }, "gear")
        }
        onShop={setAtShop}
        onBuyHome={busy || offers?.rolled ? undefined : setBuyingHome}
      />
    </div>
  );
  // 未读块往上长，页签放在底下挨着常态那一行，切频道时手不用伸到块顶上（用户定的）
  const unreadTabs = (
    <PinTabs<UnreadTab>
      tabs={[
        ["messages", "消息", view.phone.unread],
        ["news", "新闻", view.phone.feedUnread.news.length],
        ["police", "警用频段", view.phone.feedUnread.police.length],
      ]}
      value={unreadTab}
      onChange={(t) => {
        setUnreadTab(t);
        if (t === "news") void readNews();
        if (t === "police") void readPolice();
      }}
    />
  );
  const unreadFull = (
    <div key={unreadTab} className={`${neuralStyles.pinBody} ${neuralStyles.pinPane}`}>
      {unreadTab === "police" ? (
        <PoliceBody view={view} onMap={openMap} />
      ) : (
        <MessagesPage
          key={unreadTab}
          view={view}
          initialTab={unreadTab === "news" ? "news" : "dm"}
          hideTabs
          onNews={() => void readNews()}
          onReply={
            busy
              ? undefined
              : (id) => {
                  story.setDraft({ replyTo: id });
                  closePinned();
                }
          }
        />
      )}
    </div>
  );
  const trackFull = (
    <div className={neuralStyles.pinBody}>
      <PinTabs<TrackTab>
        tabs={[
          ["todo", "待办", 0],
          ["jobs", "委托", view.jobs.list.filter((j) => j.status === "offered").length],
          ["database", "数据库", view.shards.unread],
        ]}
        value={trackTab}
        onChange={setTrackTab}
      />
      <div key={trackTab} className={neuralStyles.pinPane}>
        {trackTab !== "database" ? (
          <JournalPage
            key={trackTab}
            part={trackTab}
            view={view}
            onAccept={
              busy || offers?.rolled
                ? undefined
                : (id) => act({ type: "acceptJob", id }, "accept", true)
            }
            onBraindance={() => setAtBraindance(true)}
          />
        ) : (
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
      </div>
    </div>
  );

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
      {/* 每侧三块排成一列：一块长高时把同侧别的块推开、缩成一行，不盖住（第十二节第 9 条） */}
      <CornerSide side="left">
        <BioMonitor view={view} peek={peek} full={characterFull} wide={bioTab === "cyberware"} />
        {/* 档案里的「扫描」：点一下立刻扫，不调模型；回合进行中不让点（用户定的，计划第十二节第 14 条） */}
        <Present
          view={view}
          scan={scan}
          peek={peek}
          onScan={busy ? undefined : (id) => void act({ type: "scanNpc", id }, "scan")}
        />
        <Unread
          view={view}
          peek={peek}
          full={unreadFull}
          tabs={unreadTabs}
          wide={unreadTab === "messages"}
        />
      </CornerSide>
      <CornerSide side="right">
        {/* 地点块不再悬停展开，威胁常态就列；点整块打开地图，同 M（用户定的） */}
        {/* 存放进地点块（用户定的）：能存放的地点才出，不再弹窗 */}
        <Zone
          view={view}
          onMap={openMap}
          peek={peek}
          stash={
            stashHere(view) ? (
              <StashBody
                view={view}
                onMove={
                  busy
                    ? undefined
                    : (action, item, where) =>
                        void act({ type: "stash", action, item, where }, "gear")
                }
              />
            ) : undefined
          }
        />
        {/* D 系统通知紧贴在 C 追踪下面，追踪多高都跟着走 */}
        <Track view={view} peek={peek} full={trackFull}>
          {toasts.length > 0 && <Toasts toasts={toasts} onDone={dropToast} />}
        </Track>
        <Weapon
          view={view}
          peek={peek}
          full={gearFull}
          tabs={gearTabs}
          onQuickhack={
            busy
              ? undefined
              : (name) =>
                  story.setDraft({
                    text: `${story.draft.text}${story.draft.text ? " " : ""}用快速破解「${name}」`,
                  })
          }
        />
      </CornerSide>
      {view.hacking?.dive && <DivePanel dive={view.hacking.dive} health={view.health} />}
      {/* 地图浮层（M）：盖在中列和右边四角上，选好路线就收起出发 */}
      {atMap && (
        <MapLayer onClose={closeMap}>
          <MapBody
            view={view}
            onClose={closeMap}
            onTravel={
              busy || offers?.rolled
                ? undefined
                : (dest, route) => {
                    setAtMap(false);
                    send({
                      text: `${route.label}去${dest.name}`,
                      travel: { to: dest.id, mode: route.mode },
                    });
                  }
            }
          />
        </MapLayer>
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
              <Button onClick={() => showTrack("database")}>看履历</Button>
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
            <KeyHint keyId="key.p" label="人物" onClick={() => pinBlock("bio")} />
            <KeyHint keyId="key.o" label="物品栏" onClick={() => showGear("inventory")} />
            <KeyHint keyId="key.j" label="日志" onClick={() => pinBlock("track")} />
            <KeyHint keyId="key.m" label="地图" onClick={openMap} />
            <KeyHint keyId="key.t" label="消息" onClick={() => pinBlock("unread")} />
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
