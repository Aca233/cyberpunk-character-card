import type { TurnInput } from "@cp/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { ApiError, api, newRequestId } from "../../api/client";
import { cssUrl } from "../../ui/Asset";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { KeyBar, KeyHint } from "../../ui/KeyHint";
import { EmptyState } from "../status/StatusParts";
import { CheckBar } from "./CheckBar";
import { Hud, SidePanel } from "./Hud";
import { InputBar } from "./InputBar";
import { Journal } from "./Journal";
import { Ripperdoc } from "./Ripperdoc";
import { type SettledJob, SettlementCard } from "./Settlement";
import { Shop } from "./Shop";
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
  }, [view]);
  const dropToast = useCallback(
    (key: string) => setToasts((t) => t.filter((x) => x.key !== key)),
    [],
  );

  // 当前打开的检定：已掷过骰的那个优先；其次是主持人这轮直接要求的检定（不挂在选项上）
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
  const closeJournal = useCallback(() => setJournal(null), []);

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
      if (journal || atDoc || atShop) return;
      if (e.key === "j" || e.key === "J") {
        e.preventDefault();
        setJournal("active");
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
  }, [choose, pickedId, offers?.rolled, story.failure, busy, navigate, journal, atDoc, atShop]);

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

  return (
    <div
      className={styles.screen}
      data-severe={severe || undefined}
      data-stage={view.humanity.stage}
      style={
        severe ? ({ "--glow-img": cssUrl("hud.damageGlow") ?? "none" } as CSSProperties) : undefined
      }
    >
      <div className={styles.fx} aria-hidden />
      <Hud view={view} />
      <SidePanel
        view={view}
        onSpend={busy || offers?.rolled ? undefined : (a) => void spend(a)}
        onJournal={(board) => setJournal(board ? "board" : "active")}
        onRipperdoc={() => setAtDoc(true)}
        onShop={setAtShop}
        onEquip={busy ? undefined : (id) => void gearAction("equipItem", id)}
        onUnequip={busy ? undefined : (id) => void gearAction("unequipItem", id)}
      />

      <main className={styles.column}>
        <StoryLog view={view} saveId={saveId} live={story} />

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
          <InputBar
            busy={busy}
            streaming={story.phase === "streaming"}
            disabled={offers?.rolled != null || view.death !== null}
            reason={
              view.death !== null
                ? "角色已经死亡"
                : offers?.rolled != null
                  ? "上一次检定已经掷过骰，先继续结算"
                  : undefined
            }
            draft={story.draft}
            onDraft={story.setDraft}
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
          onClose={() => setAtDoc(false)}
        />
      )}
      {settled[0] && <SettlementCard job={settled[0]} onClose={closeSettlement} />}
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
