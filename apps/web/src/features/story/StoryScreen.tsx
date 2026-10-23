import type { TurnInput } from "@cp/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { ApiError, api } from "../../api/client";
import { cssUrl } from "../../ui/Asset";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { KeyBar, KeyHint } from "../../ui/KeyHint";
import { EmptyState } from "../status/StatusParts";
import { CheckBar } from "./CheckBar";
import { Hud, SidePanel } from "./Hud";
import { InputBar } from "./InputBar";
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
  useEffect(() => {
    if (!view) return;
    const prev = previous.current;
    previous.current = view;
    if (!prev) return;
    const fresh = diffViews(prev, view);
    if (fresh.length > 0) setToasts((t) => [...t, ...fresh].slice(-6));
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
      send({ mode: "do", text: choice.text });
    },
    [offers, busy, send, version],
  );

  // 1–5 选选项；Esc 收起检定（已掷过骰的不能收起）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
      if (/^[1-5]$/.test(e.key)) {
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
  }, [choose, pickedId, offers?.rolled, story.failure, busy, navigate]);

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
    story.setDraft({ mode: "do", text: label });
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
      <SidePanel view={view} />

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
          <InputBar
            busy={busy}
            streaming={story.phase === "streaming"}
            disabled={offers?.rolled != null}
            reason={offers?.rolled != null ? "上一次检定已经掷过骰，先继续结算" : undefined}
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
