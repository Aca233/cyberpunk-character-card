import {
  buildTurnSegmentPromptInput,
  type cyberwareRules,
  type ImagePromptRequest,
  type PlayerAction,
  type TurnInput,
} from "@cp/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { useShallow } from "zustand/react/shallow";
import {
  ApiError,
  type AspectRatio,
  api,
  newRequestId,
  type SaveImageBindings,
  type SaveImageUnbindTarget,
  turnImagesOf,
} from "../../api/client";
import { useStoryPreload } from "../../assets/usePreload";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { KeyBar, KeyHint } from "../../ui/KeyHint";
import { layerOpen, useLayer } from "../../ui/layers";
import { Panel } from "../../ui/Panel";
import { ImageLightbox } from "../images/GeneratedImage";
import { ImageGenModal } from "../images/ImageGenModal";
import {
  cancelImageJob,
  cancelTurnImageJobs,
  type ImageTarget,
  imageTargetKey,
  isImageJobPending,
  useImageJobs,
} from "../images/image-jobs";
import { type SaveImagesController, SaveImagesProvider } from "../images/SaveImagesContext";
import { imageStyleConfig, useNarrativePrefs } from "../settings/prefs";
import { EmptyState } from "../status/StatusParts";
import { AutofixerModal } from "./AutofixerModal";
import { syncCustomGearArtFromView } from "./art";
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
import { CyberdeckPage } from "./CyberdeckPage";
import type { HackTarget } from "./DeckQuickbar";
import { DivePanel } from "./DivePanel";
import { MapLayer } from "./EdgeDrawers";
import { EscMenu } from "./EscMenu";
import { FactionsBody } from "./FactionsPanel";
import { InputBar } from "./InputBar";
import {
  type InventoryFilter,
  InventoryPage,
  type InventoryViewKey,
  partitionStorageGroups,
} from "./InventoryPage";
import { MapBody } from "./MapPanel";
import { CharacterPage, CyberwarePage, MessagesPage, ShardsPanel } from "./NeuralPages";
import neuralStyles from "./neural.module.css";
import { PeopleBody } from "./PeoplePanel";
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
import { TrackerPanel } from "./TrackerPanel";
import { useStoryAudio } from "./useStoryAudio";
import {
  diffViews,
  type MapAreaTarget,
  type MapFocus,
  type Speaker,
  type Toast,
  trackTelemetry,
  type View,
} from "./view";

/** 钉住的未读块、生物监测块里的页签 */
type UnreadTab = "messages" | "people" | "news" | "factions" | "shards";
type BioTab = "character" | "deck" | "cyberware" | "chronicle";

interface AutoImageTask {
  readonly controller: AbortController;
  readonly saveId: string;
  readonly promptKey: string;
  readonly boundIds: string[];
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

/** 剧情主界面：左右夜之城角块 HUD、中列连续叙事流、底部选项与神经输入终端 */
export function StoryScreen() {
  const { saveId = "" } = useParams();
  const navigate = useNavigate();
  const client = useQueryClient();
  const story = useStory(
    useShallow((s) => ({
      phase: s.phase,
      stopping: s.stopping,
      boost: s.boost,
      pending: s.pending,
      failure: s.failure,
      spend: s.spend,
      draft: s.draft,
      enter: s.enter,
      submit: s.submit,
      stop: s.stop,
      setDraft: s.setDraft,
      dismiss: s.dismiss,
      cancelSpend: s.cancelSpend,
    })),
  );
  const { enter, submit: submitStory, dismiss: dismissStory, stop: stopStory, setDraft } = story;

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
    readonly bind: ImageTarget;
    readonly turnPromptKey?: string | undefined;
  } | null>(null);
  const [lightbox, setLightbox] = useState<{
    readonly id: string;
    readonly title: string;
    readonly onReplace?: () => void;
    readonly replaceLabel?: string;
  } | null>(null);
  const [autoPendingTurnSeqs, setPendingTurnSeqs] = useState<ReadonlySet<number>>(() => new Set());
  const [autoTurnProgress, setAutoTurnProgress] = useState<
    Readonly<Record<number, { readonly current: number; readonly total: number }>>
  >({});
  const imageJobs = useImageJobs();
  const manualPendingTurnSeqs = useMemo(
    () =>
      new Set(
        imageJobs.flatMap((job) =>
          isImageJobPending(job) &&
          job.binding?.saveId === saveId &&
          job.binding.target.kind === "turn"
            ? [job.binding.target.seq]
            : [],
        ),
      ),
    [imageJobs, saveId],
  );
  const pendingTurnSeqs = useMemo(
    () => new Set([...autoPendingTurnSeqs, ...manualPendingTurnSeqs]),
    [autoPendingTurnSeqs, manualPendingTurnSeqs],
  );
  const turnImageProgress = useMemo(() => {
    const merged: Record<number, { readonly current: number; readonly total: number }> = {
      ...autoTurnProgress,
    };
    for (const job of imageJobs) {
      if (
        isImageJobPending(job) &&
        job.progress &&
        job.binding?.saveId === saveId &&
        job.binding.target.kind === "turn"
      ) {
        merged[job.binding.target.seq] = job.progress;
      }
    }
    return merged;
  }, [autoTurnProgress, imageJobs, saveId]);
  const turnImageErrors = useMemo(
    () =>
      Object.fromEntries(
        imageJobs.flatMap((job) =>
          job.status === "error" &&
          job.error &&
          job.binding?.saveId === saveId &&
          job.binding.target.kind === "turn"
            ? [[job.binding.target.seq, job.error]]
            : [],
        ),
      ),
    [imageJobs, saveId],
  );
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
    setAutoTurnProgress({});
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
  useMemo(() => {
    syncCustomGearArtFromView(view);
  }, [view]);
  useStoryPreload(view, bindings, client);
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
          (imageModal.turnPromptKey ?? JSON.stringify(imageModal.promptRequest))));
  const imageContextRef = useRef({ saveId, view, enabled: prefs.autoTurnImage, bindings });
  imageContextRef.current = { saveId, view, enabled: prefs.autoTurnImage, bindings };

  const isAutoImageCurrent = useCallback((seq: number, task: AutoImageTask) => {
    const current = imageContextRef.current;
    if (
      task.controller.signal.aborted ||
      autoAbortRef.current.get(seq) !== task ||
      current.saveId !== task.saveId ||
      !current.enabled
    )
      return false;
    const currentList = turnImagesOf(current.bindings, seq);
    if (
      currentList.length !== task.boundIds.length ||
      currentList.some((id, idx) => id !== task.boundIds[idx])
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

  // 新的一轮写进存档后，和上一次看到的状态比，在右侧常驻列出变化通知，点一下即收起
  const [toasts, setToasts] = useState<readonly Toast[]>([]);
  const previous = useRef<{ saveId: string; view: View } | null>(null);
  // 委托结束后排队弹出的结算卡
  const [settled, setSettled] = useState<readonly SettledJob[]>([]);
  const closeSettlement = useCallback(() => setSettled((q) => q.slice(1)), []);
  // 了结宿敌后排队弹出的结算卡，在委托结算卡之后
  const [rivalsDone, setRivalsDone] = useState<readonly EndedNemesis[]>([]);
  const closeRival = useCallback(() => setRivalsDone((q) => q.slice(1)), []);
  useEffect(() => {
    if (!view) return;
    const prevEntry = previous.current;
    previous.current = { saveId, view };
    if (!prevEntry || prevEntry.saveId !== saveId) return;
    const prev = prevEntry.view;
    const fresh = diffViews(prev, view);
    if (fresh.length > 0) {
      setToasts((t) => [...t, ...fresh].slice(-6));
    }
    const wasOpen = new Set(prev.jobs.list.filter((j) => j.open).map((j) => j.id));
    const closed = view.jobs.list.filter(
      (j) => !j.open && j.settlement !== null && wasOpen.has(j.id),
    );
    if (closed.length > 0) setSettled((q) => [...q, ...closed]);
    const wasEnded = new Set(prev.nemesesEnded.map((n) => n.npc));
    const ended = view.nemesesEnded.filter((n) => !wasEnded.has(n.npc));
    if (ended.length > 0) setRivalsDone((q) => [...q, ...ended]);
  }, [saveId, view]);
  const dropToast = useCallback(
    (key: string) => setToasts((t) => t.filter((x) => x.key !== key)),
    [],
  );

  const version = view?.version ?? 0;
  const offers = view?.offers;

  const busy = story.phase !== "idle";
  // 装备块当前查看的位置（随身 / 某个自有住处或车辆 / 别处留置）；收起后复位回随身，避免悬停误弹
  const [inventoryView, setInventoryView] = useState<InventoryViewKey>("carried");
  const [inventoryFocus, setInventoryFocus] = useState<{
    readonly filter?: InventoryFilter;
    readonly itemId?: string;
    readonly nonce: number;
  } | null>(null);
  const hackTargets: readonly HackTarget[] = useMemo(() => {
    if (!view?.hacking) return [];
    const breached = view.hacking.breachedTargets;
    const allEffects = view.hacking.activeEffects;
    const breachOf = (name: string, npcId?: string | null) =>
      breached.find((b) => (npcId && b.npc === npcId) || b.target === name);
    const effectsOf = (name: string, isBreached: boolean): readonly string[] => [
      ...new Set(
        allEffects
          .filter((e) => {
            if (e.target !== name) return false;
            if (isBreached && e.categoryLabel === null && /破冰|breach/i.test(e.label)) {
              return false;
            }
            return true;
          })
          .map((e) => e.label),
      ),
    ];
    const foes = (view.combat.active?.foes ?? []).filter(
      (f) => f.state !== "dead" && f.state !== "fled",
    );
    const foeOf = (n: (typeof view.npcs)[number]) =>
      foes.find((f) => f.npc === n.id || f.id === n.id || f.name === n.name);
    const herePeople = view.npcs.filter((n) => n.here && n.alive);
    const extraFoes = foes.filter(
      (f) => !herePeople.some((n) => f.npc === n.id || f.id === n.id || f.name === n.name),
    );
    const toNpcTarget = (
      n: (typeof view.npcs)[number],
      tone: "hostile" | "companion" | "present",
    ): HackTarget => {
      const hit = breachOf(n.name, n.id);
      const scanInfo = n.body?.scan;
      const isBreached = Boolean(hit);
      const activeEffects = effectsOf(n.name, isBreached);
      return {
        key: `npc:${n.id}`,
        npcId: n.id,
        kind: "person",
        name: n.name,
        role: n.role || undefined,
        tone,
        breached: isBreached,
        breachedVia: hit?.via ?? null,
        activeEffects: activeEffects.length > 0 ? activeEffects : undefined,
        netStatus: scanInfo?.netStatus ?? null,
        netLabel: scanInfo?.netLabel ?? null,
        chromeSummary: scanInfo?.chrome.length ? scanInfo.chrome.slice(0, 3).join("、") : null,
      };
    };
    const hostiles: HackTarget[] = [
      ...herePeople.filter((n) => Boolean(foeOf(n))).map((n) => toNpcTarget(n, "hostile")),
      ...extraFoes.map((f): HackTarget => {
        const hit = breachOf(f.name, f.npc);
        const isBreached = Boolean(hit);
        const activeEffects = effectsOf(f.name, isBreached);
        return {
          key: `foe:${f.id}`,
          kind: "person",
          name: f.name,
          role: [f.tierLabel, f.stateLabel].filter(Boolean).join(" · ") || undefined,
          tone: "hostile",
          breached: isBreached,
          breachedVia: hit?.via ?? null,
          activeEffects: activeEffects.length > 0 ? activeEffects : undefined,
        };
      }),
    ];
    const companions = herePeople
      .filter((n) => !foeOf(n) && n.following)
      .map((n) => toNpcTarget(n, "companion"));
    const regulars = herePeople
      .filter((n) => !foeOf(n) && !n.following)
      .map((n) => toNpcTarget(n, "present"));
    const envTarget: HackTarget = {
      key: "env:local",
      kind: "env",
      name: `${view.names.location}现场设备/监控`,
      role: "摄像头、炮塔、门禁与局域节点",
      tone: "env",
      breached: view.hacking.breaches.length > 0,
      breachedVia: view.hacking.breaches[0]?.name ?? null,
    };
    return [...hostiles, ...companions, ...regulars, envTarget];
  }, [view]);
  const [bioTab, setBioTab] = useState<BioTab>("character");
  const openBioTab = useCallback((tab: BioTab) => {
    setPerson(null);
    setAtMap(false);
    setBioTab(tab);
    setExpand("bio");
  }, []);
  const openDeckTab = useCallback(() => openBioTab("deck"), [openBioTab]);
  // 视野里就地展开：四角的块、在场的人，同一时间只展开一处；
  // 点击卡片或按 P/J/T/O 展开完整内容
  const [expand, setExpand] = useState<Expand | null>(null);
  const peek = useMemo(() => ({ expand, setExpand }), [expand]);
  useEffect(() => {
    if (expand !== "weapon") {
      if (inventoryView !== "carried") setInventoryView("carried");
      if (inventoryFocus !== null) setInventoryFocus(null);
    }
  }, [expand, inventoryView, inventoryFocus]);
  const storagePartition = useMemo(
    () => (view ? partitionStorageGroups(view) : { own: [], elsewhere: [] }),
    [view],
  );
  const nearbyCompanions = useMemo(
    () => view?.npcs.filter((n) => n.alive && n.following && n.here) ?? [],
    [view?.npcs],
  );
  const lootTotalCount = useMemo(
    () => (view ? view.combat.loot.reduce((sum, group) => sum + group.items.length, 0) : 0),
    [view],
  );
  const inventoryViewKeys = useMemo<readonly InventoryViewKey[]>(() => {
    const keys: InventoryViewKey[] = ["carried"];
    if (lootTotalCount > 0) keys.push("loot");
    for (const comp of nearbyCompanions) keys.push(`npc:${comp.id}`);
    keys.push(...storagePartition.own.map((g) => g.key));
    if (storagePartition.elsewhere.length > 0) keys.push("elsewhere");
    return keys;
  }, [lootTotalCount, nearbyCompanions, storagePartition]);
  const effectiveInventoryView: InventoryViewKey = inventoryViewKeys.includes(inventoryView)
    ? inventoryView
    : "carried";
  // 钉住的未读块停在哪个页签；收起后再钉住还是那个
  const [unreadTab, setUnreadTab] = useState<UnreadTab>("messages");
  // 从「人物」页或正文档案跳到手机「消息」页时自动选中的联系人 key
  const [focusPhoneContact, setFocusPhoneContact] = useState<string | null>(null);
  const consumeFocusPhoneContact = useCallback(() => setFocusPhoneContact(null), []);
  const openPhoneChatWith = useCallback((contactId: string) => {
    setPerson(null);
    setAtMap(false);
    setFocusPhoneContact(contactId);
    setUnreadTab("messages");
    setExpand("unread");
  }, []);
  // 地图浮层（M）；mapFocus 是正文里点了地名/区域或追踪定位时打开地图先聚焦的目标，按 M 打开时不选
  const [atMap, setAtMap] = useState(false);
  const [mapFocus, setMapFocus] = useState<MapFocus | undefined>(undefined);
  const closeMap = useCallback(() => setAtMap(false), []);
  const closePinned = useCallback(() => setExpand(null), []);
  // 正文里点了人名：弹出这个人的档案
  const [person, setPerson] = useState<string | null>(null);
  // 商店、义体医生、好车中间人终端叠在界面上面
  const [atDoc, setAtDoc] = useState(false);
  const [docFocus, setDocFocus] = useState<
    | {
        readonly category?: cyberwareRules.CyberwareCategoryId | "installed";
        readonly installedId?: string;
      }
    | undefined
  >(undefined);
  const [atShop, setAtShop] = useState<string | null>(null);
  const [atAutofixer, setAtAutofixer] = useState(false);
  // 准备买下的公寓 id：先弹确认框
  const [buyingHome, setBuyingHome] = useState<string | null>(null);
  // 点按 Tab 或点击扫描按钮切换义眼扫描模式（开启时自动全扫在场目标）；H 沉浸模式；Esc 菜单
  const [scan, setScan] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [atEsc, setAtEsc] = useState(false);
  const [atEndStory, setAtEndStory] = useState(false);

  useStoryAudio({
    saveId,
    view,
    atEsc,
    overlayOpen:
      atEsc || atMap || atDoc || atShop !== null || atAutofixer || person !== null || atEndStory,
    scan,
    settledCount: settled.length,
    rivalsCount: rivalsDone.length,
    latestToasts: toasts,
  });

  // 切换存档路由时组件不卸载，重置所有与当前存档绑定的局部浮层与排队状态
  useEffect(() => {
    void saveId;
    setToasts([]);
    setSettled([]);
    setRivalsDone([]);
    setExpand(null);
    setFocusPhoneContact(null);
    setAtMap(false);
    setMapFocus(undefined);
    setPerson(null);
    setAtDoc(false);
    setDocFocus(undefined);
    setAtShop(null);
    setAtAutofixer(false);
    setBuyingHome(null);
    setScan(false);
    setAtEsc(false);
    setAtEndStory(false);
  }, [saveId]);

  const warn = useCallback((key: string, error: unknown) => {
    const text = error instanceof Error ? error.message : String(error);
    const toast: Toast = { key: `${key}-${Date.now()}`, icon: "notify.warning", text, tone: "bad" };
    setToasts((t) => [...t, toast].slice(-6));
  }, []);

  const clearAutoTurnState = useCallback((seq: number) => {
    setPendingTurnSeqs((prev) => {
      if (!prev.has(seq)) return prev;
      const next = new Set(prev);
      next.delete(seq);
      return next;
    });
    setAutoTurnProgress((prev) => {
      if (!(seq in prev)) return prev;
      const { [seq]: _dropped, ...rest } = prev;
      return rest;
    });
  }, []);

  const unbindImage = useCallback(
    async (target: SaveImageUnbindTarget) => {
      if (target.kind === "turn") {
        cancelTurnImageJobs(saveId, target.seq);
        autoAbortRef.current.get(target.seq)?.controller.abort();
        autoAbortRef.current.delete(target.seq);
        clearAutoTurnState(target.seq);
      } else {
        cancelImageJob(imageTargetKey({ saveId, target }));
      }
      try {
        const next = await api.unbindSaveImage(saveId, target);
        client.setQueryData(["saveImages", saveId], next);
      } catch (error) {
        warn("image-unbind", error);
      }
    },
    [saveId, client, warn, clearAutoTurnState],
  );

  const cancelTurnAutoImage = useCallback(
    (seq: number) => {
      autoAbortRef.current.get(seq)?.controller.abort();
      autoAbortRef.current.delete(seq);
      clearAutoTurnState(seq);
    },
    [clearAutoTurnState],
  );

  useEffect(() => {
    for (const [seq, task] of autoAbortRef.current) {
      if (manualPendingTurnSeqs.has(seq) || !isAutoImageCurrent(seq, task))
        cancelTurnAutoImage(seq);
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
      manualPendingTurnSeqs.has(latest.seq) ||
      turnImagesOf(bindings, latest.seq).length > 0 ||
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
    const totalCount = prefs.imageBatchCount;
    const task: AutoImageTask = {
      controller,
      saveId,
      promptKey: JSON.stringify(request),
      boundIds: [],
    };
    autoAbortRef.current.set(seq, task);
    setPendingTurnSeqs((prev) => new Set(prev).add(seq));
    if (totalCount > 1) {
      setAutoTurnProgress((prev) => ({ ...prev, [seq]: { current: 1, total: totalCount } }));
    }

    void (async () => {
      try {
        const profiles = await api.profiles();
        if (!isAutoImageCurrent(seq, task)) return;
        if (!profiles.image) throw new Error("尚未设置文生图模型");

        for (let i = 0; i < totalCount; i++) {
          if (!isAutoImageCurrent(seq, task)) return;
          if (totalCount > 1) {
            setAutoTurnProgress((prev) => ({
              ...prev,
              [seq]: { current: i + 1, total: totalCount },
            }));
          }
          const segmentRequest =
            totalCount > 1 ? buildTurnSegmentPromptInput(request, i, totalCount) : request;
          const promptRes = await api.draftImagePrompt(
            {
              request: segmentRequest,
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
            i === 0
              ? { kind: "turn", seq, imageId: generated.image.id, expectedImageId: null }
              : { kind: "turn", seq, imageId: generated.image.id, append: true },
            controller.signal,
          );
          if (!isAutoImageCurrent(seq, task)) return;
          task.boundIds.push(generated.image.id);
          // 同步更新本地引用，避免下一轮循环读取到渲染前的旧 bindings
          imageContextRef.current = { ...imageContextRef.current, bindings: nextBindings };
          client.setQueryData(["saveImages", saveId], nextBindings);
        }
      } catch (error) {
        if (isAutoImageCurrent(seq, task)) {
          warn("auto-turn-image", error);
        }
      } finally {
        if (autoAbortRef.current.get(seq) === task) {
          autoAbortRef.current.delete(seq);
          if (imageContextRef.current.saveId === saveId) {
            clearAutoTurnState(seq);
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
    prefs.imageBatchCount,
    bindings,
    manualPendingTurnSeqs,
    healthQuery.data?.models?.image?.ready,
    client,
    warn,
    isAutoImageCurrent,
    cancelTurnAutoImage,
    clearAutoTurnState,
  ]);

  const saveImagesController = useMemo<SaveImagesController>(
    () => ({
      saveId,
      bindings,
      pendingTurnSeqs,
      manualPendingTurnSeqs,
      turnImageProgress,
      turnImageErrors,
      openImageModal: (options) => {
        let turnPromptKey: string | undefined;
        if (options.bind.kind === "turn") {
          const turnSeq = options.bind.seq;
          autoAttemptedRef.current.add(turnSeq);
          cancelTurnAutoImage(turnSeq);
          const sourceTurn = imageContextRef.current.view?.turns.find((t) => t.seq === turnSeq);
          if (sourceTurn) {
            turnPromptKey = JSON.stringify(buildTurnPromptRequest(sourceTurn));
          }
        }
        setImageModal({ ...structuredClone(options), saveId, turnPromptKey });
      },
      unbindImage,
      openLightbox: (id, title, options) =>
        setLightbox({
          id,
          title,
          ...(options?.onReplace ? { onReplace: options.onReplace } : {}),
          ...(options?.replaceLabel ? { replaceLabel: options.replaceLabel } : {}),
        }),
      cancelTurnAutoImage: (seq) => {
        cancelTurnAutoImage(seq);
        cancelTurnImageJobs(saveId, seq);
      },
    }),
    [
      saveId,
      bindings,
      pendingTurnSeqs,
      manualPendingTurnSeqs,
      turnImageProgress,
      turnImageErrors,
      unbindImage,
      cancelTurnAutoImage,
    ],
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

  // 逐个扫描在场未扫目标：串联每次返回的最新 version，避免并发/旧版本 409
  const scanAllPresent = useCallback(async () => {
    if (!view || busy || view.death || view.ended) return;
    const intactEye = view.cyberware.find((c) => c.slot === "eyes" && !c.broken);
    if (!intactEye) {
      const brokenEye = view.cyberware.find((c) => c.slot === "eyes" && c.broken);
      warn(
        "scan",
        brokenEye
          ? "义眼打坏了，扫描不了；先去义体医生处修好"
          : "没装义眼，扫描不了；去义体医生那里装一副",
      );
      return;
    }
    const targets = view.npcs.filter((n) => n.here && n.alive && !n.body?.scan);
    if (targets.length === 0) return;
    let nextVersion = version;
    try {
      for (const npc of targets) {
        const res = await api.action(saveId, {
          requestId: newRequestId(),
          baseVersion: nextVersion,
          action: { type: "scanNpc", id: npc.id },
        });
        nextVersion = res.version;
      }
    } catch (error) {
      warn("scan", error);
    }
    await refresh();
  }, [view, busy, version, saveId, refresh, warn]);

  const toggleScan = useCallback(() => {
    const next = !scan;
    if (next && view && !busy && !view.death && !view.ended) {
      const intactEye = view.cyberware.find((c) => c.slot === "eyes" && !c.broken);
      if (!intactEye) {
        const brokenEye = view.cyberware.find((c) => c.slot === "eyes" && c.broken);
        warn(
          "scan",
          brokenEye
            ? "义眼打坏了，扫描不了；先去义体医生处修好"
            : "没装义眼，扫描不了；去义体医生那里装一副",
        );
        return;
      }
      setScan(true);
      const hasUnscanned = view.npcs.some((n) => n.here && n.alive && !n.body?.scan);
      if (hasUnscanned) void scanAllPresent();
      return;
    }
    setScan(next);
  }, [scan, view, busy, scanAllPresent, warn]);

  // 夜之城难度死亡后重来：作废这个场景的回合，回到场景开头
  const restart = useCallback(async () => {
    try {
      await api.restart(saveId, version);
    } catch (error) {
      warn("restart", error);
    }
    await refresh();
  }, [saveId, version, refresh, warn]);

  // 取消指定回合及之后回合挂起的手动/自动生图任务，避免撤回或重写后旧图继续回写
  const cancelTurnImagesFrom = useCallback(
    (fromSeq: number) => {
      const seqs = new Set<number>([fromSeq]);
      for (const turn of view?.turns ?? []) {
        if (turn.seq >= fromSeq) seqs.add(turn.seq);
      }
      for (const seq of autoAbortRef.current.keys()) {
        if (seq >= fromSeq) seqs.add(seq);
      }
      for (const seq of seqs) {
        cancelTurnImageJobs(saveId, seq);
        cancelTurnAutoImage(seq);
      }
    },
    [saveId, view?.turns, cancelTurnAutoImage],
  );

  // 重新生成最后一轮：后端作废它，再用当时的输入按原流程重推
  const regenerate = useCallback(async () => {
    try {
      const r = await api.regenerate(saveId, version);
      cancelTurnImagesFrom(r.voided);
      await refresh();
      await submitStory(saveId, r.version, r.pending, refresh);
    } catch (error) {
      warn("regenerate", error);
      await refresh();
    }
  }, [saveId, version, cancelTurnImagesFrom, refresh, warn, submitStory]);

  // 删楼：撤回指定回合及之后所有有效记录，并把被删那一楼的原输入填回输入框便于修改重发
  const undoTurn = useCallback(
    async (fromSeq?: number) => {
      try {
        const r = await api.undoTurn(saveId, version, fromSeq);
        cancelTurnImagesFrom(r.fromSeq);
        const restoredText = r.input?.text?.trim() ?? "";
        if (restoredText !== "") {
          setDraft({
            text: restoredText,
            ...(r.input?.sandevistan ? { sandevistan: true } : {}),
          });
          requestAnimationFrame(() => {
            const el = inputRef.current;
            if (!el || el.disabled) return;
            el.focus();
            const end = el.value.length;
            el.setSelectionRange(end, end);
          });
        }
        await refresh();
      } catch (error) {
        warn("undo", error);
        await refresh();
      }
    },
    [saveId, version, cancelTurnImagesFrom, setDraft, refresh, warn],
  );

  // 按账目改写最后一轮：只换正文，不改状态
  const rewrite = useCallback(async () => {
    try {
      await api.rewrite(saveId, version);
    } catch (error) {
      warn("rewrite", error);
    }
    await refresh();
  }, [saveId, version, refresh, warn]);

  // 展开右下角装备块；再次按 O 或点击时若已在随身视图就收起，否则切回随身。
  const showGear = useCallback(
    (target: InventoryViewKey = "carried") => {
      setAtMap(false);
      setInventoryView(target);
      setExpand((cur) => (cur === "weapon" && effectiveInventoryView === target ? null : "weapon"));
    },
    [effectiveInventoryView],
  );
  // 从生物检测的个人神经芯片槽直接跳到随身物品栏的芯片/超梦分类并定位对应芯片
  const openNeuralInventory = useCallback((itemId?: string) => {
    setAtMap(false);
    setInventoryView("carried");
    setInventoryFocus((prev) => ({
      filter: "neural",
      ...(itemId ? { itemId } : {}),
      nonce: (prev?.nonce ?? 0) + 1,
    }));
    setExpand("weapon");
  }, []);
  const openMap = useCallback(() => {
    setExpand(null);
    setMapFocus(undefined);
    setAtMap(true);
  }, []);
  const focusPlace = useCallback((placeId: string) => {
    setExpand(null);
    setMapFocus((prev) => ({ kind: "place", id: placeId, nonce: (prev?.nonce ?? 0) + 1 }));
    setAtMap(true);
  }, []);
  const focusArea = useCallback((area: MapAreaTarget) => {
    setExpand(null);
    setMapFocus((prev) => ({ kind: "area", area, nonce: (prev?.nonce ?? 0) + 1 }));
    setAtMap(true);
  }, []);
  // 正文里点了名字（第 3 条）：地点打开地图并放大选中，出普通路线卡；城区/街区打开地图并放大到对应区域；人物弹档案
  const onMark = useCallback(
    (mark: Speaker) => {
      if (mark.place !== undefined) {
        focusPlace(mark.place);
      } else if (mark.area !== undefined) {
        focusArea(mark.area);
      } else if (mark.npc !== undefined) {
        setPerson(mark.npc);
      }
    },
    [focusPlace, focusArea],
  );
  // 展开/收起一个块（P 生物监测、J 追踪、T 未读）；按键时同一块已经展开就收起
  const pinBlock = useCallback((id: string) => {
    setAtMap(false);
    setExpand((cur) => (cur === id ? null : id));
  }, []);
  // 只在具体某个会话被打开时按联系人粒度标已读；并发触发时排队合并，避免切联系人吞掉已读请求
  const readingPromise = useRef<Promise<void> | null>(null);
  const queuedFeed = useRef<Set<string>>(new Set());
  const readPhoneFeed = useCallback(
    (feed: readonly string[]) => {
      if (feed.length === 0) return;
      for (const id of feed) queuedFeed.current.add(id);
      if (readingPromise.current !== null) return;
      const drain = async () => {
        while (queuedFeed.current.size > 0) {
          const batch = [...queuedFeed.current];
          queuedFeed.current.clear();
          await act({ type: "readMessages", feed: batch }, "phone");
        }
      };
      const pending = drain().finally(() => {
        if (readingPromise.current === pending) readingPromise.current = null;
      });
      readingPromise.current = pending;
    },
    [act],
  );
  const readThread = useCallback(
    (unreadIds: readonly number[]) => readPhoneFeed(unreadIds.map((id) => `phone:message:${id}`)),
    [readPhoneFeed],
  );
  const readCall = useCallback(
    (id: number) => readPhoneFeed([`phone:call:${id}`]),
    [readPhoneFeed],
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
      void submitStory(saveId, version, { kind: "input", input }, refresh);
    },
    [submitStory, saveId, version, view, refresh],
  );
  const retry = useCallback(() => {
    const pending =
      story.pending ??
      (view?.checkpoint && view.checkpoint.baseVersion === version
        ? ({ kind: "input", input: view.checkpoint.input } as const)
        : null);
    dismissStory();
    if (pending) void submitStory(saveId, version, pending, refresh);
  }, [story.pending, dismissStory, submitStory, saveId, version, refresh, view?.checkpoint]);
  const clearCheckpoint = useCallback(async () => {
    await api.clearCheckpoint(saveId);
    await refresh();
  }, [saveId, refresh]);
  const discardAndRetry = useCallback(async () => {
    const pending =
      story.pending ??
      (view?.checkpoint && view.checkpoint.baseVersion === version
        ? ({ kind: "input", input: view.checkpoint.input } as const)
        : null);
    dismissStory();
    await api.clearCheckpoint(saveId);
    await refresh();
    if (pending) void submitStory(saveId, version, pending, refresh);
  }, [story.pending, dismissStory, submitStory, saveId, version, refresh, view?.checkpoint]);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const focusInputEnd = useCallback(() => {
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el || el.disabled) return;
      el.focus();
      const end = el.value.length;
      el.setSelectionRange(end, end);
    });
  }, []);

  const choose = useCallback(
    (index: number) => {
      const choice = offers?.choices[index];
      if (!choice || busy || view?.death || view?.ended) return;
      const choiceBoost =
        view?.sandevistan != null && Boolean(choice.source?.includes(view.sandevistan.name));
      if (prefs.choiceFillOnly) {
        setDraft({
          text: choice.text,
          sandevistan: choiceBoost,
        });
        focusInputEnd();
        return;
      }
      send({
        text: choice.text,
        ...(choiceBoost ? { sandevistan: true } : {}),
      });
    },
    [
      offers,
      busy,
      prefs.choiceFillOnly,
      setDraft,
      focusInputEnd,
      send,
      view?.sandevistan,
      view?.death,
      view?.ended,
    ],
  );
  const lastSentText = useMemo(() => {
    const turns = view?.turns;
    if (!turns) return undefined;
    for (let i = turns.length - 1; i >= 0; i -= 1) {
      const turn = turns[i];
      if (!turn || turn.draft) continue;
      const candidate = turn.input?.text?.trim();
      if (candidate) return candidate;
    }
    return undefined;
  }, [view?.turns]);

  // 剧情页快捷键：1–5 选选项，/ 聚焦输入框，P/O/J/T 钉住对应角块，M 地图，H 沉浸模式，按住 Tab 扫描
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
        e.preventDefault();
        if (!e.repeat) toggleScan();
        return;
      }
      if (e.repeat) return;
      if (e.key === "/") {
        const el = inputRef.current;
        if (el && !el.disabled) {
          e.preventDefault();
          el.focus();
          const end = el.value.length;
          el.setSelectionRange(end, end);
        }
        return;
      }
      const k = e.key.toLowerCase();
      if (k === "o") {
        e.preventDefault();
        showGear("carried");
      } else if ((k === "q" || k === "e") && expand === "weapon") {
        if (inventoryViewKeys.length <= 1) return;
        e.preventDefault();
        setInventoryView((cur) => {
          const i = inventoryViewKeys.indexOf(cur);
          const curIdx = Math.max(i, 0);
          const next =
            (curIdx + (k === "e" ? 1 : -1) + inventoryViewKeys.length) % inventoryViewKeys.length;
          return inventoryViewKeys[next] ?? "carried";
        });
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
      } else if (k === "h") {
        e.preventDefault();
        setFocusMode((v) => !v);
      } else if (/^[1-5]$/.test(e.key)) {
        e.preventDefault();
        choose(Number(e.key) - 1);
      } else if (e.key === "Escape" && !story.failure) {
        if (scan) setScan(false);
        else setAtEsc(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [
    choose,
    expand,
    inventoryViewKeys,
    scan,
    toggleScan,
    story.failure,
    story.spend,
    showGear,
    pinBlock,
    openMap,
  ]);

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

  // 钉住块时块里放的完整内容：页签放进 BioMonitor 展开顶栏，不再上下叠两道标题
  const effectiveBioTab: BioTab = bioTab === "deck" && !view.hacking ? "character" : bioTab;
  const deckTabBadge =
    view.hacking && (view.hacking.thermal.level === "critical" || Boolean(view.hacking.traceAlert))
      ? 1
      : 0;
  const characterTabs = (
    <PinTabs<BioTab>
      tabs={[
        ["character", "人物", 0],
        ...(view.hacking ? ([["deck", "接入仓", deckTabBadge]] as const) : []),
        ["cyberware", "义体", view.cyberware.filter((c) => c.broken).length],
        ["chronicle", "履历", 0],
      ]}
      value={effectiveBioTab}
      onChange={setBioTab}
    />
  );
  const draftAction =
    busy || view.death || view.ended
      ? undefined
      : (text: string) => {
          story.setDraft({
            text: `${story.draft.text}${story.draft.text ? "\n" : ""}${text}`,
          });
          closePinned();
          setScan(false);
          setPerson(null);
        };
  const deckLoadHandler =
    busy || view.death || view.ended
      ? undefined
      : (action: Extract<PlayerAction, { type: "deckLoad" }>) => act(action, "deckLoad", true);
  const intactEye = view.cyberware.find((c) => c.slot === "eyes" && !c.broken) ?? null;
  const scanEnvironment =
    draftAction && intactEye
      ? () => {
          draftAction(
            `启动${intactEye.name}扫描周围环境，排查监控探头、警报炮塔、陷阱地雷、掩体弱点与墙后/暗处潜在伏兵。`,
          );
        }
      : undefined;
  const characterFull = (
    <div className={neuralStyles.pinBody}>
      {/* 按页签重新挂载，切页签时新内容淡入 */}
      <div key={effectiveBioTab} className={neuralStyles.pinPane}>
        {effectiveBioTab === "deck" ? (
          <CyberdeckPage
            view={view}
            busy={busy}
            onDeckLoad={deckLoadHandler}
            onActionDraft={draftAction}
          />
        ) : effectiveBioTab === "cyberware" ? (
          <CyberwarePage
            view={view}
            busy={busy}
            onRipperdoc={(focus) => {
              setDocFocus(focus);
              setAtDoc(true);
            }}
            onOpenDeck={view.hacking ? () => setBioTab("deck") : undefined}
            onActionDraft={draftAction}
            onUseSuppressant={
              busy || view.death || view.ended
                ? undefined
                : () => act({ type: "useSuppressant" }, "suppressant", true)
            }
          />
        ) : effectiveBioTab === "chronicle" ? (
          <ChronicleBody view={view} />
        ) : (
          <CharacterPage
            view={view}
            busy={busy}
            onOpenNeuralChip={openNeuralInventory}
            onActionDraft={draftAction}
            onTrauma={
              busy || view.death || view.ended ? undefined : (action) => act(action, "trauma", true)
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
  const gearDisabledReason =
    view.death || view.ended
      ? "这份存档已结束，只能查看物品"
      : busy
        ? "正在处理行动，请稍候"
        : undefined;
  const carriedUniqueCount =
    view.inventory.clothing.length +
    view.travel.vehicles.length +
    new Set([
      ...Object.entries(view.inventory.backpack)
        .filter(([, n]) => n > 0)
        .map(([id]) => id),
      ...[view.inventory.healing, view.inventory.grenade].flatMap((slot) =>
        slot ? [slot.id] : [],
      ),
    ]).size;
  const placeItemAction =
    busy || view.death || view.ended
      ? undefined
      : async (
          action: "leave" | "take",
          item: string,
          where: string,
          source?: "backpack" | "worn" | "quick",
          count?: number,
        ) => {
          await act(
            {
              type: "placeItem",
              action,
              item,
              where,
              ...(source ? { source } : {}),
              ...(count && count > 1 ? { count } : {}),
            },
            "storage",
            true,
          );
        };
  const transferItemAction =
    busy || view.death || view.ended
      ? undefined
      : async (item: string, from: string, to: string, count?: number) => {
          await act(
            {
              type: "transferItem",
              item,
              from,
              to,
              ...(count && count > 1 ? { count } : {}),
            },
            "storage",
            true,
          );
        };
  const elsewhereTotalCount = storagePartition.elsewhere.reduce(
    (sum, group) => sum + group.items.reduce((s, item) => s + item.count, 0),
    0,
  );
  const gearTabItems: readonly (
    | readonly [InventoryViewKey, string, number]
    | readonly [InventoryViewKey, string, number, boolean]
  )[] = [
    ["carried", "随身", carriedUniqueCount],
    ...(lootTotalCount > 0
      ? ([["loot", "战利品", lootTotalCount, !view.combat.active]] as const)
      : []),
    ...nearbyCompanions.map((comp): readonly [InventoryViewKey, string, number, boolean] => [
      `npc:${comp.id}`,
      comp.name,
      comp.body?.gear.length ?? 0,
      !view.combat.active,
    ]),
    ...storagePartition.own.map((group): readonly [InventoryViewKey, string, number, boolean] => [
      group.key,
      group.name,
      group.items.reduce((sum, item) => sum + item.count, 0),
      group.canStore || group.canTake,
    ]),
    ...(storagePartition.elsewhere.length > 0
      ? ([["elsewhere", "别处", elsewhereTotalCount]] as const)
      : []),
  ];
  const gearFull = (
    <div className={`${neuralStyles.pinBody} ${neuralStyles.pinPane}`}>
      <InventoryPage
        view={view}
        activeView={effectiveInventoryView}
        onSelectView={setInventoryView}
        initialFocus={inventoryFocus}
        disabledReason={gearDisabledReason}
        onHeal={
          busy || view.death || view.ended
            ? undefined
            : (id) => act({ type: "useHealing", id }, "healing", true)
        }
        onSuppressant={
          busy || view.death || view.ended
            ? undefined
            : () => act({ type: "useSuppressant" }, "suppressant", true)
        }
        onUse={
          busy || view.death || view.ended
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
        onActionDraft={draftAction}
        onEquip={
          busy || view.death || view.ended || view.combat.active
            ? undefined
            : (id) => void act({ type: "equipItem", id }, "gear")
        }
        onUnequip={
          busy || view.death || view.ended || view.combat.active
            ? undefined
            : (id) => void act({ type: "unequipItem", id }, "gear")
        }
        onOutfitPreset={
          busy || view.death || view.ended || view.combat.active
            ? undefined
            : (action, opts) =>
                act(
                  {
                    type: "outfitPreset",
                    action,
                    ...(opts?.id ? { id: opts.id } : {}),
                    ...(opts?.name ? { name: opts.name } : {}),
                  },
                  "gear",
                  true,
                )
        }
        onFieldAid={
          busy || view.death || view.ended || view.combat.active
            ? undefined
            : (id) => act({ type: "useFieldAid", id }, "healing", true)
        }
        onMod={
          busy || view.death || view.ended || view.combat.active
            ? undefined
            : (action, weapon, mod) => void act({ type: "modWeapon", action, weapon, mod }, "gear")
        }
        onPlaceItem={placeItemAction}
        onTransferItem={transferItemAction}
        onLootCombatItem={
          busy || view.death || view.ended || view.combat.active
            ? undefined
            : (from, item) => act({ type: "lootCombatItem", from, item }, "loot", true)
        }
        onLootCombatAll={
          busy || view.death || view.ended || view.combat.active
            ? undefined
            : (from) => act({ type: "lootCombatAll", ...(from ? { from } : {}) }, "loot", true)
        }
        onExchangeCompanionGear={
          busy || view.death || view.ended || view.combat.active
            ? undefined
            : (id, action, item) => act({ type: "npcExchangeGear", id, action, item }, "gear", true)
        }
        onBuyHome={busy ? undefined : setBuyingHome}
        onCallVehicle={
          busy || view.death || view.ended || view.combat.active
            ? undefined
            : (id) => act({ type: "callVehicle", id }, "vehicle", true)
        }
      />
    </div>
  );
  // 未读块往上长，页签放在底下挨着常态那一行，切频道或看芯片时手不用伸到块顶上（用户定的）
  const unreadTabs = (
    <PinTabs<UnreadTab>
      tabs={[
        [
          "messages",
          "消息",
          view.phone.unread +
            view.phone.feedUnread.messages.filter((id) => id.startsWith("phone:call:")).length,
        ],
        ["people", "人物", 0],
        ["news", "新闻", view.phone.feedUnread.news.length + view.phone.feedUnread.street.length],
        ["factions", "势力", 0],
        ["shards", "资料", view.shards.unread],
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
      {unreadTab === "people" ? (
        <PeopleBody
          view={view}
          onOpenChat={openPhoneChatWith}
          onLocatePlace={focusPlace}
          onScan={
            busy || view.death || view.ended
              ? undefined
              : (id) => void act({ type: "scanNpc", id }, "scan")
          }
          onCompanion={
            busy || view.death || view.ended
              ? undefined
              : (id, following) => void act({ type: "npcCompanion", id, following }, "companion")
          }
          onSetRelation={
            busy || view.death || view.ended
              ? undefined
              : (id, text) => void act({ type: "setNpcRelation", id, text }, "relation")
          }
          onDraftAction={draftAction}
        />
      ) : unreadTab === "shards" ? (
        <ShardsPanel
          view={view}
          onReadShard={(id) => void act({ type: "readShards", ids: [id] }, "shards")}
        />
      ) : unreadTab === "factions" ? (
        <FactionsBody
          view={view}
          onDraftAction={view.death || view.ended ? undefined : draftAction}
        />
      ) : (
        <MessagesPage
          key={unreadTab}
          view={view}
          initialTab={unreadTab === "news" ? "news" : "dm"}
          hideTabs
          onNews={() => void readNews()}
          onSendChat={sendPhoneChat}
          onReadThread={readThread}
          onReadCall={readCall}
          onAnswerCall={
            busy || view.death || view.ended
              ? undefined
              : (id, answer) => void act({ type: "answerCall", id, answer }, "call")
          }
          onAcceptJob={
            busy || view.death || view.ended
              ? undefined
              : (id) => void act({ type: "acceptJob", id }, "job")
          }
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
          onLocatePlace={focusPlace}
          onOpenRipperdoc={() => {
            closePinned();
            setAtDoc(true);
          }}
          onOpenPeople={() => setUnreadTab("people")}
          focusContact={focusPhoneContact}
          onConsumeFocus={consumeFocusPhoneContact}
        />
      )}
    </div>
  );
  const trackSummary = trackTelemetry(view);
  const trackFull = (
    <div className={neuralStyles.pinBody}>
      <div className={neuralStyles.pinPane}>
        <TrackerPanel
          view={view}
          onLocatePlace={focusPlace}
          onAcceptJob={
            busy || view.death || view.ended
              ? undefined
              : (id) => void act({ type: "acceptJob", id }, "job")
          }
          onPayRent={
            busy || view.death || view.ended || view.combat.active
              ? undefined
              : (id) => void act({ type: "payRent", id }, "rent")
          }
          onOpenRipperdoc={() => {
            closePinned();
            setAtDoc(true);
          }}
          onOpenChat={openPhoneChatWith}
          onOpenMap={openMap}
          onDraftAction={draftAction}
        />
      </div>
    </div>
  );

  const glitch = glitchLevel(view);
  const draftBoost = view.sandevistan != null && story.draft.sandevistan === true;
  const screenBoost =
    draftBoost ||
    (story.phase !== "idle" &&
      (story.boost !== null ||
        (story.pending?.kind === "input" && story.pending.input.sandevistan === true)));
  const currentDistrict =
    view.names.district ?? view.travel.destinations.find((d) => d.here)?.district ?? null;
  const unreadBadgeCount =
    view.phone.unread +
    view.phone.feedUnread.messages.filter((id) => id.startsWith("phone:call:")).length +
    view.phone.feedUnread.news.length +
    view.phone.feedUnread.street.length +
    view.shards.unread;
  const activeTrackCount = trackSummary.activeCount + trackSummary.offeredCount;
  const currentLocationName = view.names.location ?? view.location ?? "夜之城";
  return (
    <SaveImagesProvider value={saveImagesController}>
      <div
        className={styles.screen}
        data-stage={view.humanity.stage}
        data-glitch={glitch || undefined}
        data-boost={screenBoost || undefined}
        data-focus={focusMode || undefined}
      >
        <CityBackdrop
          location={view.location}
          locationName={view.names.location}
          district={currentDistrict}
          period={view.time.period}
        />
        {/* 左侧角块：生物监测 / 全息来电 / 在场目标 / 通讯未读 */}
        <CornerSide side="left" quiet={focusMode}>
          <BioMonitor
            view={view}
            peek={peek}
            tabs={characterTabs}
            full={characterFull}
            wide={effectiveBioTab === "cyberware"}
            diag={
              effectiveBioTab === "character" ||
              effectiveBioTab === "deck" ||
              effectiveBioTab === "chronicle"
            }
            onOpenTab={openBioTab}
          />
          <HoloCall
            view={view}
            disabled={busy || Boolean(view.death || view.ended)}
            onAnswer={(id, answer) => void act({ type: "answerCall", id, answer }, "call")}
            onOpenPhone={() => {
              setUnreadTab("messages");
              pinBlock("unread");
            }}
          />
          <Present
            view={view}
            scan={scan}
            peek={peek}
            onScan={
              busy || view.death || view.ended
                ? undefined
                : (id) => void act({ type: "scanNpc", id }, "scan")
            }
            onScanAll={busy || view.death || view.ended ? undefined : () => void scanAllPresent()}
            onScanEnv={scanEnvironment}
            onToggleScan={toggleScan}
            onCompanion={
              busy || view.death || view.ended
                ? undefined
                : (id, following) => void act({ type: "npcCompanion", id, following }, "companion")
            }
            onSetRelation={
              busy || view.death || view.ended
                ? undefined
                : (id, text) => void act({ type: "setNpcRelation", id, text }, "relation")
            }
            onDraftAction={draftAction}
          />
          <Unread view={view} peek={peek} full={unreadFull} tabs={unreadTabs} />
        </CornerSide>
        {/* 右侧角块：地点 / 潜网深度（潜网时融入列流，不遮挡追踪与武器） / 追踪+系统通知 / 武器装备 */}
        <CornerSide side="right" quiet={focusMode}>
          <Zone
            view={view}
            onMap={openMap}
            onShop={setAtShop}
            onRipperdoc={() => setAtDoc(true)}
            onAutofixer={() => setAtAutofixer(true)}
            onBuyHome={busy || view.death || view.ended ? undefined : setBuyingHome}
            onPayRent={
              busy || view.death || view.ended || view.combat.active
                ? undefined
                : (id) => void act({ type: "payRent", id }, "rent")
            }
          />
          {view.hacking?.dive && (
            <DivePanel dive={view.hacking.dive} health={view.health} combat={view.combat} />
          )}
          <Track view={view} peek={peek} full={trackFull}>
            {toasts.length > 0 && <Toasts toasts={toasts} onDone={dropToast} />}
          </Track>
          <Weapon
            view={view}
            peek={peek}
            full={gearFull}
            tabs={
              <PinTabs<InventoryViewKey>
                tabs={gearTabItems}
                value={effectiveInventoryView}
                onChange={setInventoryView}
              />
            }
          />
        </CornerSide>
        {/* 地图浮层（M）：盖在中列和右边四角上，选好路线就收起出发 */}
        {atMap && (
          <MapLayer onClose={closeMap}>
            <MapBody
              view={view}
              onClose={closeMap}
              focus={mapFocus}
              onTravel={
                busy || view.death || view.ended
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
          {/* 横幅：潜网、闪回、神经异常，同时只出一个 */}
          <Banner view={view} />
          <StoryLog
            view={view}
            saveId={saveId}
            onRegenerate={view.death || view.ended ? undefined : () => void regenerate()}
            onRewrite={view.death || view.ended ? undefined : rewrite}
            onUndo={view.ended && !view.death ? undefined : undoTurn}
            onMark={onMark}
            openingGuide={{
              onSendPrompt:
                busy || view.death || view.ended
                  ? undefined
                  : (text) => {
                      if (prefs.choiceFillOnly) {
                        setDraft({ text });
                        focusInputEnd();
                      } else {
                        send({ text });
                      }
                    },
            }}
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
            {view.offers.choices.length > 0 && !busy && !view.death && !view.ended && (
              <ChoiceList choices={view.offers.choices} locked={false} onChoose={choose} />
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
                  这份存档已封存，只能留作回看。
                </span>
                <Button
                  onClick={() => {
                    setBioTab("chronicle");
                    setExpand("bio");
                  }}
                >
                  看履历
                </Button>
              </div>
            )}
            <InputBar
              busy={busy}
              streaming={story.phase === "streaming"}
              stopping={story.stopping}
              disabled={view.death !== null || view.ended !== null}
              reason={
                view.death !== null
                  ? "角色已经死亡"
                  : view.ended !== null
                    ? "这个角色的故事已经结束"
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
              sandevistan={view.sandevistan}
              hacking={view.hacking}
              hackTargets={hackTargets}
              hasOptics={Boolean(intactEye)}
              onScanTarget={
                busy || view.death || view.ended
                  ? undefined
                  : (id) => void act({ type: "scanNpc", id }, "scan")
              }
              onScanAllTargets={
                busy || view.death || view.ended ? undefined : () => void scanAllPresent()
              }
              onOpenDeckTab={view.hacking ? openDeckTab : undefined}
              lastSentText={lastSentText}
              inputRef={inputRef}
              onSend={send}
              onStop={() => void stopStory()}
            />
            <KeyBar>
              <KeyHint
                keyId="key.p"
                label="人物"
                active={expand === "bio"}
                onClick={() => pinBlock("bio")}
              />
              <KeyHint
                keyId="key.o"
                label="装备"
                active={expand === "weapon"}
                onClick={() => showGear("carried")}
              />
              <KeyHint
                keyId="key.j"
                label="追踪"
                active={expand === "track"}
                badge={activeTrackCount}
                onClick={() => pinBlock("track")}
              />
              <KeyHint keyId="key.m" label="地图" active={atMap} onClick={openMap} />
              <KeyHint
                keyId="key.t"
                label="消息"
                active={expand === "unread"}
                badge={unreadBadgeCount}
                onClick={() => pinBlock("unread")}
              />
              <KeyHint
                keyId="key.tab"
                label="扫描"
                active={scan}
                title="按 Tab 或点击切换 Kiroshi 义眼扫描（开启时自动扫描在场目标）"
                onClick={toggleScan}
              />
              <KeyHint
                keyText="H"
                label={focusMode ? "还原 HUD" : "沉浸"}
                active={focusMode}
                title="柔和隐去两侧 HUD 卡片，专注阅读剧情"
                onClick={() => setFocusMode((v) => !v)}
              />
              <KeyHint keyId="key.esc" label="菜单" active={atEsc} onClick={() => setAtEsc(true)} />
            </KeyBar>
          </div>
        </main>

        {atEsc && (
          <EscMenu
            context={{
              name: view.character.name ?? "无名雇佣兵",
              location: currentLocationName,
              time: `${view.time.text} · ${view.time.periodLabel}`,
              turns: view.totalTurns,
            }}
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
            onFeedback={() =>
              navigate(`/settings?tab=feedback&save=${encodeURIComponent(saveId)}`, {
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
                    busy || view.death || view.ended
                      ? undefined
                      : (id, forNpc) =>
                          act(
                            {
                              type: "buyItem",
                              shop: shop.id,
                              id,
                              ...(forNpc ? { forNpc } : {}),
                            },
                            "shop",
                            true,
                          )
                  }
                  onSell={
                    busy || view.death || view.ended
                      ? undefined
                      : (id) => act({ type: "sellItem", shop: shop.id, id }, "shop", true)
                  }
                  onGunsmith={
                    busy || view.death || view.ended || view.combat.active
                      ? undefined
                      : (action) =>
                          act({ ...action, type: "gunsmith", shop: shop.id }, "shop", true)
                  }
                  gunsmithDisabledReason={
                    view.death || view.ended
                      ? "这份存档已结束，无法进行枪匠改装"
                      : view.combat.active
                        ? "战斗中无法进行枪匠工坊改装"
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
            initialCategory={docFocus?.category}
            initialInstalledId={docFocus?.installedId}
            onBuy={
              busy || view.death || view.ended
                ? undefined
                : async (id, credit, options) => {
                    const doc = view.ripperdoc;
                    if (!doc) return;
                    await act(
                      {
                        type: "buyCyberware",
                        id,
                        credit,
                        doc: doc.id,
                        ...(options?.armSide ? { armSide: options.armSide } : {}),
                        ...(options?.replace ? { replace: options.replace } : {}),
                        ...(options?.forNpc ? { forNpc: options.forNpc } : {}),
                      },
                      "ripperdoc",
                      true,
                    );
                  }
            }
            onRemove={
              busy || view.death || view.ended
                ? undefined
                : async (id) => {
                    const doc = view.ripperdoc;
                    if (!doc) return;
                    await act({ type: "removeCyberware", id, doc: doc.id }, "ripperdoc", true);
                  }
            }
            onRepay={
              busy || view.death || view.ended
                ? undefined
                : async () => {
                    const doc = view.ripperdoc;
                    if (!doc) return;
                    await act({ type: "repayRipperdoc", doc: doc.id }, "ripperdoc", true);
                  }
            }
            onRepair={
              busy || view.death || view.ended
                ? undefined
                : async (id) => {
                    const doc = view.ripperdoc;
                    if (!doc) return;
                    await act({ type: "repairCyberware", id, doc: doc.id }, "ripperdoc", true);
                  }
            }
            onPayChromeCare={
              busy || view.death || view.ended || view.combat.active
                ? undefined
                : async () => {
                    const doc = view.ripperdoc;
                    if (!doc) return;
                    await act({ type: "payChromeCare", doc: doc.id }, "ripperdoc", true);
                  }
            }
            onClose={() => {
              setAtDoc(false);
              setDocFocus(undefined);
            }}
          />
        )}
        {atAutofixer && view.travel.autofixer && (
          <AutofixerModal
            view={view}
            terminal={view.travel.autofixer}
            onBuy={
              busy || view.death || view.ended
                ? undefined
                : async (model) => {
                    await act({ type: "buyVehicle", model }, "autofixer", true);
                  }
            }
            onClose={() => setAtAutofixer(false)}
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
        {person &&
          (() => {
            // 正文里点了人名（第 3 条）：弹这个人的档案；扫描照档案里的按钮，回合进行中不让点
            const npc = view.npcs.find((n) => n.id === person);
            const hasContact = Boolean(npc && view.phone.contacts.some((c) => c.from === npc.id));
            return (
              npc && (
                <PersonModal
                  npc={npc}
                  fixer={view.jobs.fixers.find((f) => f.id === npc.id)}
                  foe={view.combat.active?.foes.find(
                    (f) => f.npc === npc.id || f.id === npc.id || f.name === npc.name,
                  )}
                  hasContact={hasContact}
                  onOpenChat={hasContact ? () => openPhoneChatWith(npc.id) : undefined}
                  onScan={
                    busy || view.death || view.ended
                      ? undefined
                      : (id) => void act({ type: "scanNpc", id }, "scan")
                  }
                  onCompanion={
                    busy || view.death || view.ended
                      ? undefined
                      : (id, following) =>
                          void act({ type: "npcCompanion", id, following }, "companion")
                  }
                  onSetRelation={
                    busy || view.death || view.ended
                      ? undefined
                      : (id, text) => void act({ type: "setNpcRelation", id, text }, "relation")
                  }
                  onDraftAction={draftAction}
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
                <Button primary onClick={story.dismiss}>
                  改一改再发
                </Button>
                <Button onClick={retry}>{activeCheckpoint ? "从断点重试" : "原样重试"}</Button>
                {activeCheckpoint && (
                  <Button onClick={() => void discardAndRetry()}>清除断点重头生成</Button>
                )}
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
            <p>
              这一轮没有写进存档。原样重试可能再次触发拦截，建议换个说法，或到设置里检查当前方案的安全选项。
            </p>
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
          onReplace={lightbox?.onReplace}
          replaceLabel={lightbox?.replaceLabel}
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
  foe,
  hasContact,
  onOpenChat,
  onScan,
  onCompanion,
  onSetRelation,
  onDraftAction,
  onClose,
}: {
  readonly npc: View["npcs"][number];
  readonly fixer?: View["jobs"]["fixers"][number] | undefined;
  readonly foe?: NonNullable<View["combat"]["active"]>["foes"][number] | undefined;
  readonly hasContact?: boolean | undefined;
  readonly onOpenChat?: (() => void) | undefined;
  readonly onScan?: ((id: string) => void) | undefined;
  readonly onCompanion?: ((id: string, following: boolean) => void) | undefined;
  readonly onSetRelation?: ((id: string, text: string) => void) | undefined;
  readonly onDraftAction?: ((text: string) => void) | undefined;
  readonly onClose: () => void;
}) {
  useLayer(onClose);
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: 点击半透明遮罩关闭弹窗，键盘 Esc 由 useLayer 负责
    // biome-ignore lint/a11y/useKeyWithClickEvents: Esc 已由 useLayer 注册
    <div
      className={styles.journalBackdrop}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div role="dialog" aria-label={npc.name} className={styles.dossierDialog}>
        <Panel as="div" title="人物档案" line="var(--cp-cyan)" frame>
          <Profile
            npc={npc}
            fixer={fixer}
            foe={foe}
            onScan={onScan}
            onCompanion={onCompanion}
            onSetRelation={onSetRelation}
            onDraftAction={onDraftAction}
          />
          <div className={styles.journalActions}>
            {hasContact && onOpenChat && (
              <Button primary onClick={onOpenChat}>
                发消息
              </Button>
            )}
            <Button onClick={onClose}>关闭</Button>
          </div>
        </Panel>
      </div>
    </div>
  );
}
