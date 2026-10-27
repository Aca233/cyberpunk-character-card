import type { TurnInput } from "@cp/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { ApiError, api, newRequestId } from "../../api/client";
import { cssUrl } from "../../ui/Asset";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { KeyBar, KeyHint } from "../../ui/KeyHint";
import { useNarrativePrefs } from "../settings/prefs";
import { EmptyState } from "../status/StatusParts";
import { CheckBar } from "./CheckBar";
import { ChroniclePanel, type StoryEnd } from "./ChroniclePanel";
import { CloseupQueue } from "./Closeup";
import { DivePanel } from "./DivePanel";
import { FactionsPanel } from "./FactionsPanel";
import type { HabitAction } from "./Habits";
import { Hud, SidePanel } from "./Hud";
import { InputBar } from "./InputBar";
import { Journal } from "./Journal";
import { MapPanel } from "./MapPanel";
import { type MemoryEdit, MemoryPanel } from "./MemoryPanel";
import { NewsPanel } from "./NewsPanel";
import { PhoneDialog } from "./Phone";
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
    if (fresh.length > 0) setToasts((t) => [...t, ...fresh].slice(-6));
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
  // 日志开着时停用正文的快捷键；值是打开时的标签页
  const [journal, setJournal] = useState<"active" | "board" | null>(null);
  const [atDoc, setAtDoc] = useState(false);
  const [atShop, setAtShop] = useState<string | null>(null);
  const [atMap, setAtMap] = useState(false);
  const [atFactions, setAtFactions] = useState(false);
  const [atStash, setAtStash] = useState(false);
  const [atMemory, setAtMemory] = useState(false);
  const [atChronicle, setAtChronicle] = useState(false);
  const [atNews, setAtNews] = useState(false);
  // 准备买下的公寓 id：先弹确认框
  const [buyingHome, setBuyingHome] = useState<string | null>(null);
  const closeJournal = useCallback(() => setJournal(null), []);
  const [atPhone, setAtPhone] = useState(false);

  const warn = useCallback((key: string, error: unknown) => {
    const text = error instanceof Error ? error.message : String(error);
    const toast: Toast = { key: `${key}-${Date.now()}`, icon: "notify.warning", text, tone: "bad" };
    setToasts((t) => [...t, toast].slice(-6));
  }, []);

  // 分配属性点：不调用模型，失败时用提示条说明原因
  const spend = useCallback(
    async (attribute: keyof View["character"]["attributes"]) => {
      try {
        await api.action(saveId, {
          requestId: newRequestId(),
          baseVersion: version,
          action: { type: "spendPoint", attribute },
        });
      } catch (error) {
        warn("spend", error);
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

  // 在委托板上接单：不调用模型；失败时提示原因，确认框留着
  const acceptJob = useCallback(
    async (id: string) => {
      try {
        await api.action(saveId, {
          requestId: newRequestId(),
          baseVersion: version,
          action: { type: "acceptJob", id },
        });
      } catch (error) {
        warn("accept", error);
        await refresh();
        throw error;
      }
      await refresh();
    },
    [saveId, version, refresh, warn],
  );

  // 义体医生那里买、卸义体：不调用模型；失败时提示原因，确认框留着
  const cyberAction = useCallback(
    async (
      action:
        | { type: "buyCyberware"; id: string; credit: boolean }
        | { type: "removeCyberware"; id: string }
        | { type: "repairCyberware"; id: string }
        | { type: "repayRipperdoc" },
    ) => {
      const doc = view?.ripperdoc;
      if (!doc) return;
      try {
        await api.action(saveId, {
          requestId: newRequestId(),
          baseVersion: version,
          action: { ...action, doc: doc.id },
        });
      } catch (error) {
        warn("ripperdoc", error);
        await refresh();
        throw error;
      }
      await refresh();
    },
    [view?.ripperdoc, saveId, version, refresh, warn],
  );

  // 商店里买卖：不调用模型；失败时提示原因，确认框留着
  const shopAction = useCallback(
    async (type: "buyItem" | "sellItem", shop: string, id: string) => {
      try {
        await api.action(saveId, {
          requestId: newRequestId(),
          baseVersion: version,
          action: { type, shop, id },
        });
      } catch (error) {
        warn("shop", error);
        await refresh();
        throw error;
      }
      await refresh();
    },
    [saveId, version, refresh, warn],
  );

  // 装备栏里换装备：不调用模型；战斗中由代码拒绝
  const gearAction = useCallback(
    async (type: "equipItem" | "unequipItem", id: string) => {
      try {
        await api.action(saveId, {
          requestId: newRequestId(),
          baseVersion: version,
          action: { type, id },
        });
      } catch (error) {
        warn("gear", error);
      }
      await refresh();
    },
    [saveId, version, refresh, warn],
  );
  // 存放箱和后备箱：不调用模型；战斗中由代码拒绝
  const stashAction = useCallback(
    async (action: "store" | "take", item: string, where: string) => {
      try {
        await api.action(saveId, {
          requestId: newRequestId(),
          baseVersion: version,
          action: { type: "stash", action, item, where },
        });
      } catch (error) {
        warn("gear", error);
      }
      await refresh();
    },
    [saveId, version, refresh, warn],
  );
  const outfitAction = useCallback(
    async (action: "save" | "wear") => {
      try {
        await api.action(saveId, {
          requestId: newRequestId(),
          baseVersion: version,
          action: { type: "outfit", action },
        });
      } catch (error) {
        warn("gear", error);
      }
      await refresh();
    },
    [saveId, version, refresh, warn],
  );
  // 打开消息：未读的标成已读，不调用模型
  const unread = view?.phone.unread ?? 0;
  const openPhone = useCallback(async () => {
    setAtPhone(true);
    if (unread === 0) return;
    try {
      await api.action(saveId, {
        requestId: newRequestId(),
        baseVersion: version,
        action: { type: "readMessages" },
      });
    } catch (error) {
      warn("phone", error);
    }
    await refresh();
  }, [saveId, version, refresh, warn, unread]);
  // 改习惯：不调用模型，失败时用提示条说明原因
  const habitAction = useCallback(
    async (action: HabitAction, text: string) => {
      try {
        await api.action(saveId, {
          requestId: newRequestId(),
          baseVersion: version,
          action: { type: "habit", action, text },
        });
      } catch (error) {
        warn("habit", error);
      }
      await refresh();
    },
    [saveId, version, refresh, warn],
  );
  // 改、删记忆：不调用模型；失败时提示原因，表单留着
  const memoryAction = useCallback(
    async (edit: MemoryEdit) => {
      try {
        await api.action(saveId, {
          requestId: newRequestId(),
          baseVersion: version,
          action: { type: "editMemory", ...edit },
        });
      } catch (error) {
        warn("memory", error);
        await refresh();
        throw error;
      }
      await refresh();
    },
    [saveId, version, refresh, warn],
  );
  // 给故事收尾：不调用模型；之后存档只读，失败时确认框留着
  const endStory = useCallback(
    async (how: StoryEnd, epitaph: string | undefined) => {
      try {
        await api.action(saveId, {
          requestId: newRequestId(),
          baseVersion: version,
          action: { type: "endStory", how, ...(epitaph ? { epitaph } : {}) },
        });
      } catch (error) {
        warn("chronicle", error);
        await refresh();
        throw error;
      }
      await refresh();
    },
    [saveId, version, refresh, warn],
  );
  const craftAction = useCallback(
    async (action: "dismantle" | "tune", id: string) => {
      try {
        await api.action(saveId, {
          requestId: newRequestId(),
          baseVersion: version,
          action: { type: "craft", action, id },
        });
      } catch (error) {
        warn("craft", error);
      }
      await refresh();
    },
    [saveId, version, refresh, warn],
  );
  const squadAction = useCallback(
    async (action: "accept" | "decline" | "dismiss" | "pay", npc: string) => {
      try {
        await api.action(saveId, {
          requestId: newRequestId(),
          baseVersion: version,
          action: { type: "squad", action, npc },
        });
      } catch (error) {
        warn("squad", error);
      }
      await refresh();
    },
    [saveId, version, refresh, warn],
  );
  const modAction = useCallback(
    async (action: "attach" | "detach", weapon: string, mod: string) => {
      try {
        await api.action(saveId, {
          requestId: newRequestId(),
          baseVersion: version,
          action: { type: "modWeapon", action, weapon, mod },
        });
      } catch (error) {
        warn("gear", error);
      }
      await refresh();
    },
    [saveId, version, refresh, warn],
  );
  // 买公寓：不调用模型；钱不够、这里已经有住处时由代码拒绝
  const homeAction = useCallback(
    async (id: string) => {
      setBuyingHome(null);
      try {
        await api.action(saveId, {
          requestId: newRequestId(),
          baseVersion: version,
          action: { type: "buyHome", id },
        });
      } catch (error) {
        warn("home", error);
      }
      await refresh();
    },
    [saveId, version, refresh, warn],
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

  // 1–5 选选项；Esc 收起检定（已掷过骰的不能收起）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
      if (
        journal ||
        atDoc ||
        atShop ||
        atMap ||
        atFactions ||
        atStash ||
        atMemory ||
        atChronicle ||
        atNews ||
        story.spend
      )
        return;
      if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        setAtMemory(true);
      } else if (e.key === "h" || e.key === "H") {
        e.preventDefault();
        setAtChronicle(true);
      } else if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        setAtNews(true);
      } else if (e.key === "j" || e.key === "J") {
        e.preventDefault();
        setJournal("active");
      } else if (e.key === "m" || e.key === "M") {
        e.preventDefault();
        setAtMap(true);
      } else if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        setAtFactions(true);
      } else if (e.key === "b" || e.key === "B") {
        e.preventDefault();
        setAtStash(true);
      } else if (/^[1-5]$/.test(e.key)) {
        e.preventDefault();
        choose(Number(e.key) - 1);
      } else if (e.key === "Escape" && !story.failure) {
        // 对话框自己处理 Esc；没有对话框时先收起检定，再按一次回主菜单
        if (pickedId && !offers?.rolled) setPicked(null);
        else if (!pickedId && !busy) navigate("/menu");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    choose,
    pickedId,
    offers?.rolled,
    story.failure,
    story.spend,
    busy,
    navigate,
    journal,
    atDoc,
    atShop,
    atMap,
    atFactions,
    atStash,
    atMemory,
    atChronicle,
    atNews,
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
      <Hud
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
      <SidePanel
        view={view}
        onSpend={busy || offers?.rolled ? undefined : (a) => void spend(a)}
        onJournal={(board) => setJournal(board ? "board" : "active")}
        onRipperdoc={() => setAtDoc(true)}
        onShop={setAtShop}
        onEquip={busy ? undefined : (id) => void gearAction("equipItem", id)}
        onUnequip={busy ? undefined : (id) => void gearAction("unequipItem", id)}
        onOutfit={busy ? undefined : (action) => void outfitAction(action)}
        onMod={busy ? undefined : (action, weapon, mod) => void modAction(action, weapon, mod)}
        onHabit={busy ? undefined : (action, text) => void habitAction(action, text)}
        onSquad={busy ? undefined : (action, npc) => void squadAction(action, npc)}
        onCraft={busy ? undefined : (action, id) => void craftAction(action, id)}
        onPhone={() => void openPhone()}
        onMap={() => setAtMap(true)}
        onFactions={() => setAtFactions(true)}
        onMemory={() => setAtMemory(true)}
        onChronicle={() => setAtChronicle(true)}
        onNews={() => setAtNews(true)}
        onStash={() => setAtStash(true)}
        onBuyHome={busy || offers?.rolled ? undefined : setBuyingHome}
      />

      <main className={styles.column}>
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
              <Button onClick={() => setAtChronicle(true)}>看履历</Button>
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
          <KeyBar>
            <KeyHint keyId="key.esc" label="主菜单" onClick={() => navigate("/menu")} />
            <KeyHint
              keyId="key.tab"
              label="设置"
              onClick={() => navigate(`/settings?tab=context&save=${saveId}`)}
            />
          </KeyBar>
        </div>
      </main>

      <Toasts toasts={toasts} onDone={dropToast} />

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
      {journal && (
        <Journal
          view={view}
          initialTab={journal}
          onAccept={busy || offers?.rolled ? undefined : acceptJob}
          onClose={closeJournal}
        />
      )}
      {atShop &&
        (() => {
          const shop = view.shops.find((s) => s.id === atShop);
          return (
            shop && (
              <Shop
                view={view}
                shop={shop}
                onBuy={busy ? undefined : (id) => shopAction("buyItem", shop.id, id)}
                onSell={busy ? undefined : (id) => shopAction("sellItem", shop.id, id)}
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
            busy ? undefined : (id, credit) => cyberAction({ type: "buyCyberware", id, credit })
          }
          onRemove={busy ? undefined : (id) => cyberAction({ type: "removeCyberware", id })}
          onRepay={busy ? undefined : () => cyberAction({ type: "repayRipperdoc" })}
          onRepair={busy ? undefined : (id) => cyberAction({ type: "repairCyberware", id })}
          onClose={() => setAtDoc(false)}
        />
      )}
      {atStash && (
        <StashPanel
          view={view}
          onMove={busy ? undefined : (action, item, where) => void stashAction(action, item, where)}
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
      {atFactions && <FactionsPanel view={view} onClose={() => setAtFactions(false)} />}
      {atMemory && (
        <MemoryPanel
          view={view}
          onEdit={busy ? undefined : memoryAction}
          onClose={() => setAtMemory(false)}
        />
      )}
      {atChronicle && (
        <ChroniclePanel
          view={view}
          onEnd={busy || view.death || view.ended ? undefined : endStory}
          onClose={() => setAtChronicle(false)}
        />
      )}
      {atNews && <NewsPanel view={view} onClose={() => setAtNews(false)} />}
      {atMap && (
        <MapPanel
          view={view}
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
          onClose={() => setAtMap(false)}
        />
      )}
      {settled[0] && <SettlementCard job={settled[0]} onClose={closeSettlement} />}
      {!settled[0] && rivalsDone[0] && (
        <NemesisSettlementCard nemesis={rivalsDone[0]} onClose={closeRival} />
      )}
      {!settled[0] && !rivalsDone[0] && <CloseupQueue turns={view.turns} />}
      {atPhone && (
        <PhoneDialog
          view={view}
          onClose={() => setAtPhone(false)}
          onReply={
            busy
              ? undefined
              : (id) => {
                  story.setDraft({ replyTo: id });
                  setAtPhone(false);
                }
          }
        />
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
