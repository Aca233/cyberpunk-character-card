import type { ImagePromptRequest, PlayerAction, TurnInput } from "@cp/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import {
  ApiError,
  type AspectRatio,
  api,
  newRequestId,
  type SaveImageBindings,
} from "../../api/client";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { KeyBar, KeyHint } from "../../ui/KeyHint";
import { layerOpen, useLayer } from "../../ui/layers";
import { Panel } from "../../ui/Panel";
import { ImageLightbox } from "../images/GeneratedImage";
import { ImageGenModal } from "../images/ImageGenModal";
import { type SaveImagesController, SaveImagesProvider } from "../images/SaveImagesContext";
import { imageStyleConfig, useNarrativePrefs } from "../settings/prefs";
import { EmptyState } from "../status/StatusParts";
import { CheckBar } from "./CheckBar";
import { ChronicleBody, EndStoryModal } from "./ChroniclePanel";
import { CityBackdrop } from "./CityBackdrop";
import {
  Banner,
  BioMonitor,
  CornerSide,
  HoloCall,
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
import { FactionsBody } from "./FactionsPanel";
import { InputBar } from "./InputBar";
import { MapBody } from "./MapPanel";
import {
  CharacterPage,
  CyberwarePage,
  InventoryPage,
  JournalPage,
  MessagesPage,
  ShardsPanel,
} from "./NeuralPages";
import { type NoteEntry, NotesPanel } from "./NotesPanel";
import neuralStyles from "./neural.module.css";
import type { PhoneSendResult } from "./Phone";
import { Profile } from "./Profile";
import { type Expand, peekOnTop } from "./peek";
import { Ripperdoc } from "./Ripperdoc";
import {
  type EndedNemesis,
  NemesisSettlementCard,
  type SettledJob,
  SettlementCard,
} from "./Settlement";
import { Shop } from "./Shop";
import { buildTurnPromptRequest, ChoiceList, StoryLog } from "./StoryLog";
import { useStory } from "./store";
import styles from "./story.module.css";
import { Toasts } from "./Toasts";
import { VehiclesPage } from "./VehiclesPage";
import { diffViews, type Speaker, type Toast, type View } from "./view";

/** 钉住的未读块、生物监测块里的页签 */
type UnreadTab = "messages" | "news" | "factions" | "shards";
/** 物品栏和车辆沿用右下角装备块的展开区。 */
type GearTab = "inventory" | "vehicles";
type BioTab = "character" | "cyberware" | "chronicle";

interface AutoImageTask {
  readonly controller: AbortController;
  readonly saveId: string;
  readonly promptKey: string;
}

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || target.closest("input, textarea, select") !== null)
  );
}

/** 人性干扰的强度：0 没有，1 轻度失真，2 边缘干扰，3 临界/发作/戒断高危；压制剂压住日常噪点 */
function glitchLevel(view: View): 0 | 1 | 2 | 3 {
  const { humanity, psychosis } = view;
  if (psychosis.blackoutOpen || psychosis.episodeHere) return 3;
  if (humanity.suppressed) return psychosis.suppressant.withdrawal ? 1 : 0;
  if (humanity.current === 0 || psychosis.suppressant.withdrawal) return 3;
  if (humanity.current < 20) return 2;
  if (humanity.current < 40) return 1;
  return 0;
}

/** 剧情主界面：顶部 HUD、左侧角色栏、中间正文、底部选项 / 检定确认 / 输入框 */
export function StoryScreen() {
  const { saveId = "" } = useParams();
  const navigate = useNavigate();
  const client = useQueryClient();
  const story = useStory();
  const { enter } = story;

  useEffect(() => enter(saveId), [enter, saveId]);

  const prefs = useNarrativePrefs();
  const healthQuery = useQuery({
    queryKey: ["health"],
    queryFn: api.health,
    staleTime: 10_000,
  });
  const saveImagesQuery = useQuery({
    queryKey: ["saveImages", saveId],
    queryFn: () => api.saveImages(saveId),
    enabled: saveId !== "",
  });
  const bindings: SaveImageBindings = saveImagesQuery.data ?? { turns: {}, npcs: {} };

  const [imageModal, setImageModal] = useState<{
    readonly saveId: string;
    readonly title: string;
    readonly subtitle?: string | undefined;
    readonly promptRequest: ImagePromptRequest;
    readonly defaultAspectRatio: AspectRatio;
    readonly bind:
      | { readonly kind: "turn"; readonly seq: number }
      | { readonly kind: "npc"; readonly npcId: string }
      | { readonly kind: "character" };
  } | null>(null);
  const [lightbox, setLightbox] = useState<{ readonly id: string; readonly title: string } | null>(
    null,
  );
  const [pendingTurnSeqs, setPendingTurnSeqs] = useState<ReadonlySet<number>>(() => new Set());
  const autoAbortRef = useRef<Map<number, AutoImageTask>>(new Map());
  const baselineSeqRef = useRef<number | null>(null);
  const autoAttemptedRef = useRef<Set<number>>(new Set());
  const prevSaveIdRef = useRef<string>(saveId);

  if (prevSaveIdRef.current !== saveId) {
    prevSaveIdRef.current = saveId;
    baselineSeqRef.current = null;
    autoAttemptedRef.current.clear();
  }

  useEffect(() => {
    setPendingTurnSeqs(new Set());
    setImageModal(null);
    setLightbox(null);
    return () => {
      for (const [seq, task] of autoAbortRef.current) {
        if (task.saveId !== saveId) continue;
        task.controller.abort();
        autoAbortRef.current.delete(seq);
      }
    };
  }, [saveId]);

  const query = useQuery({
    queryKey: ["state", saveId],
    queryFn: () => api.state(saveId),
    enabled: saveId !== "",
    retry: (count, error) => !(error instanceof ApiError && error.status === 404) && count < 2,
  });
  const view = query.data;
  const imageModalTarget = imageModal?.bind;
  const modalTurn =
    imageModalTarget?.kind === "turn"
      ? view?.turns.find((turn) => turn.seq === imageModalTarget.seq)
      : undefined;
  const imageModalVisible =
    imageModal?.saveId === saveId &&
    (imageModalTarget?.kind !== "turn" ||
      (modalTurn !== undefined &&
        JSON.stringify(buildTurnPromptRequest(modalTurn)) ===
          JSON.stringify(imageModal.promptRequest)));
  const imageContextRef = useRef({ saveId, view, enabled: prefs.autoTurnImage, bindings });
  imageContextRef.current = { saveId, view, enabled: prefs.autoTurnImage, bindings };

  const isAutoImageCurrent = useCallback((seq: number, task: AutoImageTask) => {
    const current = imageContextRef.current;
    if (
      task.controller.signal.aborted ||
      autoAbortRef.current.get(seq) !== task ||
      current.saveId !== task.saveId ||
      !current.enabled ||
      current.bindings.turns[String(seq)] !== undefined
    )
      return false;
    const turn = current.view?.turns.find((candidate) => candidate.seq === seq);
    return (
      turn !== undefined &&
      !turn.draft &&
      turn.unsettled === null &&
      JSON.stringify(buildTurnPromptRequest(turn)) === task.promptKey
    );
  }, []);

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
  // 物品栏、车辆页签；收起后复位回物品栏，避免悬停误弹出车辆页
  const [gearTab, setGearTab] = useState<GearTab>("inventory");
  const [bioTab, setBioTab] = useState<BioTab>("character");
  // 视野里就地展开（第十二节第 7 条）：四角的块、在场的人，同一时间只展开一处；
  // 钉住（点块或按 P/J/T）时块里放完整内容
  const [expand, setExpand] = useState<Expand | null>(null);
  const peek = useMemo(() => ({ expand, setExpand }), [expand]);
  useEffect(() => {
    if (expand?.id !== "weapon" && gearTab !== "inventory") {
      setGearTab("inventory");
    }
  }, [expand?.id, gearTab]);
  // 钉住的未读块停在哪个页签；收起后再钉住还是那个
  const [unreadTab, setUnreadTab] = useState<UnreadTab>("messages");
  // 地图浮层（M）；mapFocus 是正文里点了地名时打开地图先选中的地点（第 3 条），按 M 打开时不选
  const [atMap, setAtMap] = useState(false);
  const [mapFocus, setMapFocus] = useState<string | undefined>(undefined);
  const closeMap = useCallback(() => setAtMap(false), []);
  const closePinned = useCallback(() => setExpand(null), []);
  // 正文里点了人名：弹出这个人的档案（第 3 条）
  const [person, setPerson] = useState<string | null>(null);
  // 商店、义体医生、超梦叠在神经界面上面（U3 商店等改走 F 交互）
  const [atDoc, setAtDoc] = useState(false);
  const [atShop, setAtShop] = useState<string | null>(null);
  // 准备买下的公寓 id：先弹确认框
  const [buyingHome, setBuyingHome] = useState<string | null>(null);
  // 按住 Tab 扫描；Z 通知记录；什么都没开时按 Esc 弹出的小菜单
  const [scan, setScan] = useState(false);
  const [atNotes, setAtNotes] = useState(false);
  const [atEsc, setAtEsc] = useState(false);
  const [atEndStory, setAtEndStory] = useState(false);

  const warn = useCallback((key: string, error: unknown) => {
    const text = error instanceof Error ? error.message : String(error);
    const toast: Toast = { key: `${key}-${Date.now()}`, icon: "notify.warning", text, tone: "bad" };
    setToasts((t) => [...t, toast].slice(-6));
  }, []);

  const unbindImage = useCallback(
    async (
      target:
        | { readonly kind: "turn"; readonly seq: number }
        | { readonly kind: "npc"; readonly npcId: string }
        | { readonly kind: "character" },
    ) => {
      if (target.kind === "turn") {
        autoAbortRef.current.get(target.seq)?.controller.abort();
        autoAbortRef.current.delete(target.seq);
        setPendingTurnSeqs((prev) => {
          if (!prev.has(target.seq)) return prev;
          const next = new Set(prev);
          next.delete(target.seq);
          return next;
        });
      }
      try {
        const next = await api.unbindSaveImage(saveId, target);
        client.setQueryData(["saveImages", saveId], next);
      } catch (error) {
        warn("image-unbind", error);
      }
    },
    [saveId, client, warn],
  );

  const cancelTurnAutoImage = useCallback((seq: number) => {
    autoAbortRef.current.get(seq)?.controller.abort();
    autoAbortRef.current.delete(seq);
    setPendingTurnSeqs((prev) => {
      if (!prev.has(seq)) return prev;
      const next = new Set(prev);
      next.delete(seq);
      return next;
    });
  }, []);

  useEffect(() => {
    for (const [seq, task] of autoAbortRef.current) {
      if (!isAutoImageCurrent(seq, task)) cancelTurnAutoImage(seq);
    }
    if (!view || !saveId) return;
    const latest = view.turns.at(-1);
    if (baselineSeqRef.current === null) {
      baselineSeqRef.current = latest?.seq ?? -1;
      return;
    }
    if (
      !prefs.autoTurnImage ||
      busy ||
      !latest ||
      latest.draft ||
      latest.unsettled !== null ||
      latest.seq <= baselineSeqRef.current ||
      autoAttemptedRef.current.has(latest.seq) ||
      bindings.turns[String(latest.seq)] !== undefined ||
      !healthQuery.data?.models?.image?.ready
    ) {
      return;
    }
    const seq = latest.seq;
    autoAttemptedRef.current.add(seq);
    const controller = new AbortController();
    const request = structuredClone(buildTurnPromptRequest(latest));
    const style = imageStyleConfig();
    const useAux = prefs.autoImageUseAux;
    const task: AutoImageTask = { controller, saveId, promptKey: JSON.stringify(request) };
    autoAbortRef.current.set(seq, task);
    setPendingTurnSeqs((prev) => new Set(prev).add(seq));

    void (async () => {
      try {
        const profiles = await api.profiles();
        if (!isAutoImageCurrent(seq, task)) return;
        if (!profiles.image) throw new Error("尚未设置文生图模型");
        const promptRes = await api.draftImagePrompt(
          {
            request,
            useAux,
            style,
            profileName: profiles.image,
          },
          controller.signal,
        );
        if (!isAutoImageCurrent(seq, task)) return;
        const generated = await api.generateImage(
          {
            prompt: promptRes.prompt,
            negativePrompt: promptRes.negativePrompt,
            aspectRatio: "16:9",
            profileName: profiles.image,
          },
          controller.signal,
        );
        if (!isAutoImageCurrent(seq, task)) return;
        client.setQueryData(["image", generated.image.id], generated.image);
        const nextBindings = await api.bindSaveImage(
          saveId,
          { kind: "turn", seq, imageId: generated.image.id, expectedImageId: null },
          controller.signal,
        );
        if (!isAutoImageCurrent(seq, task)) return;
        client.setQueryData(["saveImages", saveId], nextBindings);
      } catch (error) {
        if (isAutoImageCurrent(seq, task)) {
          warn("auto-turn-image", error);
        }
      } finally {
        if (autoAbortRef.current.get(seq) === task) {
          autoAbortRef.current.delete(seq);
          if (imageContextRef.current.saveId === saveId) {
            setPendingTurnSeqs((prev) => {
              if (!prev.has(seq)) return prev;
              const next = new Set(prev);
              next.delete(seq);
              return next;
            });
          }
        }
      }
    })();
  }, [
    view,
    saveId,
    busy,
    prefs.autoTurnImage,
    prefs.autoImageUseAux,
    bindings.turns,
    healthQuery.data?.models?.image?.ready,
    client,
    warn,
    isAutoImageCurrent,
    cancelTurnAutoImage,
  ]);

  const saveImagesController = useMemo<SaveImagesController>(
    () => ({
      saveId,
      bindings,
      pendingTurnSeqs,
      openImageModal: (options) => {
        if (options.bind.kind === "turn") cancelTurnAutoImage(options.bind.seq);
        setImageModal({ ...structuredClone(options), saveId });
      },
      unbindImage,
      openLightbox: (id, title) => setLightbox({ id, title }),
      cancelTurnAutoImage,
    }),
    [saveId, bindings, pendingTurnSeqs, unbindImage, cancelTurnAutoImage],
  );

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

  // 钉住右下角装备块并切页签；同一页签已经钉着就收起。
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
    setMapFocus(undefined);
    setAtMap(true);
  }, []);
  // 正文里点了名字（第 3 条）：地点打开地图并选中，出普通路线卡；人物弹档案
  const onMark = useCallback((mark: Speaker) => {
    if (mark.place !== undefined) {
      setExpand(null);
      setMapFocus(mark.place);
      setAtMap(true);
    } else if (mark.npc !== undefined) {
      setPerson(mark.npc);
    }
  }, []);
  // 钉住一个块（P 生物监测、J 追踪、T 未读）；按键时同一块已经钉着就收起
  const pinBlock = useCallback((id: string) => {
    setAtMap(false);
    setExpand((cur) => (cur?.id === id && cur.pinned ? null : { id, pinned: true }));
  }, []);
  // 只在具体某个会话被打开时按联系人粒度标已读；不再在切页签时把全部联系人的未读角标一次清光
  const readingPromise = useRef<Promise<void> | null>(null);
  const unreadCallFeeds = (view?.phone.feedUnread.messages ?? []).filter((id) =>
    id.startsWith("phone:call:"),
  );
  const readThread = useCallback(
    (unreadIds: readonly number[]) => {
      const feed = [...unreadIds.map((id) => `phone:message:${id}`), ...unreadCallFeeds];
      if (feed.length === 0 || readingPromise.current !== null) return;
      const pending = act({ type: "readMessages", feed }, "phone").finally(() => {
        if (readingPromise.current === pending) readingPromise.current = null;
      });
      readingPromise.current = pending;
    },
    [act, unreadCallFeeds],
  );
  // 手机窗口内轻量直聊：先等已读版本落库再取最新 version，失败时吐司提示并就地回显原因与还原草稿
  const [pendingChat, setPendingChat] = useState<{
    readonly contact: string;
    readonly text: string;
  } | null>(null);
  const sendingChat = useRef(false);
  const chatSending = pendingChat?.contact ?? null;
  const sendPhoneChat = useCallback(
    async (contact: string, text: string): Promise<PhoneSendResult> => {
      if (sendingChat.current) {
        return { ok: false, error: "上一条私信还在发送中，请稍候" };
      }
      sendingChat.current = true;
      setPendingChat({ contact, text });
      try {
        if (readingPromise.current !== null) {
          await readingPromise.current;
        }
        const baseVersion = client.getQueryData<View>(["state", saveId])?.version ?? version;
        await api.phoneChat(saveId, {
          requestId: newRequestId(),
          baseVersion,
          contact,
          text,
        });
        await refresh();
        return { ok: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        warn("phone-chat", error);
        await refresh();
        return { ok: false, error: message };
      } finally {
        sendingChat.current = false;
        setPendingChat(null);
      }
    },
    [client, saveId, version, refresh, warn],
  );
  // 切到消息页的新闻栏：把新闻播报和听说过的街头传闻一并标成已读
  const unreadNews = view?.phone.feedUnread.news;
  const unreadStreet = view?.phone.feedUnread.street;
  const readNews = useCallback(async () => {
    const ids = [...(unreadNews ?? []), ...(unreadStreet ?? [])];
    if (ids.length === 0) return;
    await act({ type: "readMessages", feed: ids }, "news");
  }, [act, unreadNews, unreadStreet]);
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
  const confirm = useCallback(
    (checkId: string, label: string) => {
      void story.submit(saveId, version, { kind: "confirm", checkId, label }, refresh);
    },
    [story, saveId, version, refresh],
  );
  const retry = useCallback(() => {
    const pending =
      story.pending ??
      (view?.checkpoint && view.checkpoint.baseVersion === version
        ? ({ kind: "input", input: view.checkpoint.input } as const)
        : null);
    story.dismiss();
    if (pending) void story.submit(saveId, version, pending, refresh);
  }, [story, saveId, version, refresh, view?.checkpoint]);
  const clearCheckpoint = useCallback(async () => {
    await api.clearCheckpoint(saveId);
    await refresh();
  }, [saveId, refresh]);
  const discardAndRetry = useCallback(async () => {
    const pending = story.pending;
    story.dismiss();
    await api.clearCheckpoint(saveId);
    await refresh();
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
      const choiceBoost =
        view?.sandevistan != null && Boolean(choice.source?.includes(view.sandevistan.name));
      send({
        text: choice.text,
        ...(choiceBoost ? { sandevistan: true } : {}),
      });
    },
    [offers, busy, send, version, view?.sandevistan],
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
        // 展开面板内保留 Tab 焦点导航，避免键盘无法访问物品和操作按钮。
        if (
          peekOnTop() ||
          (e.target instanceof Element && e.target.closest("[aria-expanded='true']"))
        ) {
          return;
        }
        // 没有展开面板时，按住扫描，松开收起。
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
  const activeCheckpoint =
    view.checkpoint && view.checkpoint.baseVersion === version ? view.checkpoint : undefined;
  const draftFromCheck = (label: string) => {
    story.setDraft({ text: label });
    setPicked(null);
  };

  // 钉住块时块里放的完整内容（第十二节第 7 条）：页签放进 BioMonitor 展开顶栏，不再上下叠两道标题
  const characterTabs = (
    <PinTabs<BioTab>
      tabs={[
        ["character", "人物", 0],
        ["cyberware", "义体", view.cyberware.filter((c) => c.broken).length],
        ["chronicle", "履历", 0],
      ]}
      value={bioTab}
      onChange={setBioTab}
    />
  );
  const characterFull = (
    <div className={neuralStyles.pinBody}>
      {/* 按页签重新挂载，切页签时新内容淡入（第十二节第 13 条） */}
      <div key={bioTab} className={neuralStyles.pinPane}>
        {bioTab === "cyberware" ? (
          <CyberwarePage view={view} onRipperdoc={() => setAtDoc(true)} />
        ) : bioTab === "chronicle" ? (
          <ChronicleBody view={view} />
        ) : (
          <CharacterPage
            view={view}
            busy={busy}
            onTrauma={
              busy || offers?.rolled || view.death || view.ended
                ? undefined
                : (action) => act(action, "trauma", true)
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
  const gearFull = (
    <div key={gearTab} className={`${neuralStyles.pinBody} ${neuralStyles.pinPane}`}>
      {gearTab === "vehicles" ? (
        <VehiclesPage view={view} />
      ) : (
        <InventoryPage
          view={view}
          disabledReason={
            view.death || view.ended
              ? "这份存档已结束，只能查看物品"
              : busy
                ? "正在处理行动，请稍候"
                : offers?.rolled
                  ? "请先完成当前检定的结算"
                  : undefined
          }
          onHeal={
            busy || offers?.rolled || view.death || view.ended
              ? undefined
              : (id) => act({ type: "useHealing", id }, "healing", true)
          }
          onSuppressant={
            busy || offers?.rolled || view.death || view.ended
              ? undefined
              : () => act({ type: "useSuppressant" }, "suppressant", true)
          }
          onUse={
            busy || offers?.rolled || view.death || view.ended
              ? undefined
              : (id) => {
                  const name = view.names.items[id] ?? id;
                  const verb = view.inventory.details?.[id]?.kind === "grenade" ? "投掷" : "使用";
                  story.setDraft({
                    text: `${story.draft.text}${story.draft.text ? "\n" : ""}${verb}${name}`,
                  });
                  closePinned();
                }
          }
          onEquip={
            busy || offers?.rolled || view.death || view.ended || view.combat.active
              ? undefined
              : (id) => void act({ type: "equipItem", id }, "gear")
          }
          onUnequip={
            busy || offers?.rolled || view.death || view.ended || view.combat.active
              ? undefined
              : (id) => void act({ type: "unequipItem", id }, "gear")
          }
          onMod={
            busy || offers?.rolled || view.death || view.ended || view.combat.active
              ? undefined
              : (action, weapon, mod) =>
                  void act({ type: "modWeapon", action, weapon, mod }, "gear")
          }
          onPlaceItem={
            busy || offers?.rolled || view.death || view.ended
              ? undefined
              : (action, item, where, source) =>
                  act(
                    { type: "placeItem", action, item, where, ...(source ? { source } : {}) },
                    "storage",
                    true,
                  )
          }
          onBuyHome={busy || offers?.rolled ? undefined : setBuyingHome}
        />
      )}
    </div>
  );
  // 未读块往上长，页签放在底下挨着常态那一行，切频道或看芯片时手不用伸到块顶上（用户定的）
  const unreadTabs = (
    <PinTabs<UnreadTab>
      tabs={[
        ["messages", "消息", view.phone.unread],
        ["news", "新闻", view.phone.feedUnread.news.length + view.phone.feedUnread.street.length],
        ["factions", "势力", 0],
        ["shards", "芯片", view.shards.unread],
      ]}
      value={unreadTab}
      onChange={(t) => {
        setUnreadTab(t);
        if (t === "news") void readNews();
      }}
    />
  );
  const unreadFull = (
    <div key={unreadTab} className={`${neuralStyles.pinBody} ${neuralStyles.pinPane}`}>
      {unreadTab === "shards" ? (
        <ShardsPanel
          view={view}
          onReadShard={(id) => void act({ type: "readShards", ids: [id] }, "shards")}
        />
      ) : unreadTab === "factions" ? (
        <FactionsBody view={view} />
      ) : (
        <MessagesPage
          key={unreadTab}
          view={view}
          initialTab={unreadTab === "news" ? "news" : "dm"}
          hideTabs
          onNews={() => void readNews()}
          onSendChat={sendPhoneChat}
          onReadThread={readThread}
          chatSending={chatSending}
          pendingChat={pendingChat}
          busy={busy}
          onReply={
            busy || view.death || view.ended
              ? undefined
              : (id) => {
                  story.setDraft({ replyTo: id });
                  closePinned();
                }
          }
          onMessageNpc={
            busy || view.death || view.ended
              ? undefined
              : (_id, name) => {
                  story.setDraft({
                    text: `${story.draft.text}${story.draft.text ? "\n" : ""}给 ${name} 发私信：`,
                    replyTo: undefined,
                  } as Partial<TurnInput>);
                  closePinned();
                }
          }
          onLocatePlace={(placeId) => {
            closePinned();
            setMapFocus(placeId);
            setAtMap(true);
          }}
          onOpenRipperdoc={() => {
            closePinned();
            setAtDoc(true);
          }}
        />
      )}
    </div>
  );
  const trackFull = (
    <div className={neuralStyles.pinBody}>
      <div className={neuralStyles.pinPane}>
        <JournalPage view={view} />
      </div>
    </div>
  );

  const glitch = glitchLevel(view);
  const screenBoost =
    story.phase !== "idle" &&
    (story.boost !== null ||
      (story.pending?.kind === "input" && story.pending.input.sandevistan === true));
  const currentDistrict =
    view.names.district ?? view.travel.destinations.find((d) => d.here)?.district ?? null;
  return (
    <SaveImagesProvider value={saveImagesController}>
      <div
        className={styles.screen}
        data-stage={view.humanity.stage}
        data-glitch={glitch || undefined}
        data-boost={screenBoost || undefined}
      >
        <CityBackdrop
          location={view.location}
          locationName={view.names.location}
          district={currentDistrict}
          period={view.time.period}
        />
        {/* 四角（计划第九节）：A 左上、S 左中、G 左下、B 右上、C 右中、H 右下 */}
        {/* 每侧三块排成一列：一块长高时把同侧别的块推开、缩成一行，不盖住（第十二节第 9 条） */}
        <CornerSide side="left">
          <BioMonitor
            view={view}
            peek={peek}
            tabs={characterTabs}
            full={characterFull}
            wide={bioTab === "cyberware"}
            diag={bioTab === "character" || bioTab === "chronicle"}
          />
          <HoloCall
            view={view}
            onOpenPhone={() => {
              setUnreadTab("messages");
              pinBlock("unread");
            }}
          />
          {/* 档案里的「扫描」：点一下立刻扫，不调模型；回合进行中不让点（用户定的，计划第十二节第 14 条） */}
          <Present
            view={view}
            scan={scan}
            peek={peek}
            onScan={busy ? undefined : (id) => void act({ type: "scanNpc", id }, "scan")}
          />
          <Unread view={view} peek={peek} full={unreadFull} tabs={unreadTabs} />
        </CornerSide>
        <CornerSide side="right">
          {/* 地点块不再悬停展开，威胁常态就列；点整块打开地图，同 M（用户定的） */}
          <Zone view={view} onMap={openMap} onShop={setAtShop} onRipperdoc={() => setAtDoc(true)} />
          {/* D 系统通知紧贴在 C 追踪下面，追踪多高都跟着走 */}
          <Track view={view} peek={peek} full={trackFull}>
            {toasts.length > 0 && <Toasts toasts={toasts} onDone={dropToast} />}
          </Track>
          <Weapon
            view={view}
            peek={peek}
            full={gearFull}
            tabs={
              <PinTabs<GearTab>
                tabs={[
                  ["inventory", "物品栏", 0],
                  ["vehicles", "车辆", view.travel.vehicles.length],
                ]}
                value={gearTab}
                onChange={setGearTab}
              />
            }
          />
        </CornerSide>
        {view.hacking?.dive && (
          <DivePanel dive={view.hacking.dive} health={view.health} combat={view.combat} />
        )}
        {/* 地图浮层（M）：盖在中列和右边四角上，选好路线就收起出发 */}
        {atMap && (
          <MapLayer onClose={closeMap}>
            <MapBody
              view={view}
              onClose={closeMap}
              focus={mapFocus}
              onTravel={
                busy || offers?.rolled
                  ? undefined
                  : (dest, route) => {
                      setAtMap(false);
                      send({
                        text: `${route.label}去${dest.name}`,
                        travel: {
                          to: dest.id,
                          mode: route.mode,
                          ...(route.vehicle ? { vehicle: route.vehicle } : {}),
                        },
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
            onMark={onMark}
          />

          {failure &&
            (failure.kind === "stopped" ||
              failure.kind === "rejected" ||
              failure.kind === "lost") && (
              <div className={styles.notice} data-kind={failure.kind} role="status">
                <span>
                  {failure.message}
                  {activeCheckpoint
                    ? `（已保存：${activeCheckpoint.completedLabels.join("、")}）`
                    : ""}
                </span>
                {failure.retryable && (
                  <Button onClick={retry}>{activeCheckpoint ? "从断点重试" : "重试"}</Button>
                )}
                {activeCheckpoint && (
                  <Button onClick={() => void clearCheckpoint()}>丢弃断点</Button>
                )}
                <Button onClick={story.dismiss}>知道了</Button>
              </div>
            )}

          {!busy && !failure && activeCheckpoint && (
            <div className={styles.notice} data-kind="stopped" role="status">
              <span>
                检测到未完成回合（已保存：{activeCheckpoint.completedLabels.join("、")}）·「
                {activeCheckpoint.input.text.length > 36
                  ? `${activeCheckpoint.input.text.slice(0, 36)}…`
                  : activeCheckpoint.input.text}
                」
              </span>
              <Button
                primary
                onClick={() =>
                  void story.submit(
                    saveId,
                    version,
                    { kind: "input", input: activeCheckpoint.input },
                    refresh,
                  )
                }
              >
                从断点继续
              </Button>
              <Button onClick={() => void clearCheckpoint()}>丢弃断点</Button>
            </div>
          )}

          <div className={styles.dock}>
            {openCheck ? (
              <CheckBar
                key={openCheck.id}
                check={openCheck}
                busy={busy}
                closable={!offers?.rolled && openCheck.id === pickedId}
                onConfirm={() => confirm(openCheck.id, openCheck.label)}
                onRewrite={() => draftFromCheck(openCheck.label)}
                onClose={() => setPicked(null)}
              />
            ) : (
              view.offers.choices.length > 0 &&
              !busy && (
                <ChoiceList
                  choices={view.offers.choices}
                  locked={offers?.rolled != null}
                  onChoose={choose}
                />
              )
            )}
            {view.death && (
              <div className={styles.notice} data-kind="dead" role="alert">
                <span>
                  {view.death.canRestart
                    ? "你死了。可以从这个场景开头重来一次：这个场景发生的事全部作废，所有抉择从这一刻重新推演，履历里记一笔“重来过”。"
                    : "你死了。这个场景已经重来过一次，这一次是真的死了；存档到此为止，只能回看。"}
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
                <Button
                  onClick={() => {
                    setBioTab("chronicle");
                    setExpand({ id: "bio", pinned: true });
                  }}
                >
                  看履历
                </Button>
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
            canEndStory={!view.death && !view.ended}
            onEndStory={
              busy
                ? undefined
                : () => {
                    setAtEsc(false);
                    setAtEndStory(true);
                  }
            }
            onSettings={() =>
              navigate(`/settings?tab=context&save=${encodeURIComponent(saveId)}`, {
                state: { from: `/play/${encodeURIComponent(saveId)}` },
              })
            }
            onQuit={busy ? undefined : () => navigate("/menu")}
          />
        )}

        {atEndStory && !view.death && !view.ended && (
          <EndStoryModal
            onEnd={(how, epitaph) =>
              act({ type: "endStory", how, ...(epitaph ? { epitaph } : {}) }, "chronicle", true)
            }
            onClose={() => setAtEndStory(false)}
          />
        )}

        {failure?.kind === "unavailable" && (
          <Dialog
            title="模型没有配好"
            tone="warning"
            onClose={story.dismiss}
            actions={
              <>
                <Button
                  primary
                  onClick={() =>
                    navigate("/settings", {
                      state: { from: `/play/${encodeURIComponent(saveId)}` },
                    })
                  }
                >
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
                  onGunsmith={
                    busy || offers?.rolled || view.death || view.ended || view.combat.active
                      ? undefined
                      : (action) =>
                          act({ ...action, type: "gunsmith", shop: shop.id }, "shop", true)
                  }
                  gunsmithDisabledReason={
                    view.death || view.ended
                      ? "这份存档已结束，无法进行枪匠改装"
                      : view.combat.active
                        ? "战斗中无法进行枪匠工坊改装"
                        : offers?.rolled
                          ? "请先完成当前检定的结算"
                          : busy
                            ? "正在处理行动，请稍候"
                            : undefined
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
                    。不收房租，买下后是个能休息落脚的安全屋，躲在里面热度降得快。
                  </p>
                </Dialog>
              )
            );
          })()}
        {atNotes && <NotesPanel notes={notes} onClose={() => setAtNotes(false)} />}
        {person &&
          (() => {
            // 正文里点了人名（第 3 条）：弹这个人的档案；扫描照档案里的按钮，回合进行中不让点
            const npc = view.npcs.find((n) => n.id === person);
            return (
              npc && (
                <PersonModal
                  npc={npc}
                  fixer={view.jobs.fixers.find((f) => f.id === npc.id)}
                  squad={view.squad.members.find((m) => m.npc === npc.id)}
                  foe={view.combat.active?.foes.find(
                    (f) => f.npc === npc.id || f.id === npc.id || f.name === npc.name,
                  )}
                  onScan={busy ? undefined : (id) => void act({ type: "scanNpc", id }, "scan")}
                  onClose={() => setPerson(null)}
                />
              )
            );
          })()}
        {settled[0] && <SettlementCard job={settled[0]} onClose={closeSettlement} />}
        {!settled[0] && rivalsDone[0] && (
          <NemesisSettlementCard nemesis={rivalsDone[0]} onClose={closeRival} />
        )}
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
                  {activeCheckpoint ? "从断点重试" : "原样重试"}
                </Button>
                {activeCheckpoint && (
                  <Button onClick={() => void discardAndRetry()}>清除断点重头生成</Button>
                )}
                <Button onClick={story.dismiss}>改一改再发</Button>
              </>
            }
          >
            <p>{failure.message}</p>
            {activeCheckpoint && (
              <p>
                已保存前面阶段：{activeCheckpoint.completedLabels.join("、")}
                。重试将跳过已完成步骤。
              </p>
            )}
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
                    {activeCheckpoint ? "从断点重试" : "重试"}
                  </Button>
                )}
                {activeCheckpoint && (
                  <Button onClick={() => void discardAndRetry()}>清除断点重头生成</Button>
                )}
                <Button onClick={story.dismiss}>关闭</Button>
              </>
            }
          >
            <p>{failure.message}</p>
            {activeCheckpoint && (
              <p>已保存进度：{activeCheckpoint.completedLabels.join("、")}，不会从头重跑。</p>
            )}
            {!failure.retryable && (
              <p>这个错误重试也不会好，先看看设置；详细原因在浏览器的开发者工具控制台里。</p>
            )}
          </Dialog>
        )}
        <ImageGenModal
          open={imageModalVisible}
          title={imageModal?.title ?? "文生图"}
          subtitle={imageModal?.subtitle}
          promptRequest={imageModal?.promptRequest ?? null}
          defaultAspectRatio={imageModal?.defaultAspectRatio ?? "3:4"}
          bind={imageModal ? { saveId: imageModal.saveId, target: imageModal.bind } : undefined}
          onClose={() => setImageModal(null)}
          onApplied={() => {}}
        />
        <ImageLightbox
          imageId={lightbox?.id ?? null}
          title={lightbox?.title ?? "图片预览"}
          onClose={() => setLightbox(null)}
        />
      </div>
    </SaveImagesProvider>
  );
}

/** 正文点人名打开的人物档案弹层：沿用夜之城档案 Panel 与全宽双栏排布，不再套用警告弹窗的惊叹号窄框 */
function PersonModal({
  npc,
  fixer,
  squad,
  foe,
  onScan,
  onClose,
}: {
  readonly npc: View["npcs"][number];
  readonly fixer?: View["jobs"]["fixers"][number] | undefined;
  readonly squad?: View["squad"]["members"][number] | undefined;
  readonly foe?: NonNullable<View["combat"]["active"]>["foes"][number] | undefined;
  readonly onScan?: ((id: string) => void) | undefined;
  readonly onClose: () => void;
}) {
  useLayer(onClose);
  return (
    <div className={styles.journalBackdrop}>
      <div role="dialog" aria-label={npc.name} className={styles.dossierDialog}>
        <Panel as="div" title="人物档案" line="var(--cp-cyan)" frame>
          <Profile npc={npc} fixer={fixer} squad={squad} foe={foe} onScan={onScan} />
          <div className={styles.journalActions}>
            <Button onClick={onClose}>关闭</Button>
          </div>
        </Panel>
      </div>
    </div>
  );
}
