import type { PlayerView } from "@cp/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { api, newRequestId, type TurnContext } from "../../api/client";
import { useAudioPrefs } from "../../audio";
import { formatDate } from "../../labels";
import { Asset, cssUrl, NineSlice } from "../../ui/Asset";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { FrameBox } from "../../ui/FrameBox";
import { useLayer } from "../../ui/layers";
import { ITEM_CELL_SLICE, Panel } from "../../ui/Panel";
import { EmptyState } from "../status/StatusParts";
import { LiveStageBar } from "../story/LiveStageBar";
import neural from "../story/neural.module.css";
import { useStory } from "../story/store";
import { ShellBackdrop, ThemeModal, themeById, useShellTheme } from "../theme";
import { AudioSettings } from "./AudioSettings";
import { FeedbackPanel } from "./FeedbackPanel";
import { ModelSettings } from "./ModelSettings";
import { NarrativeSettings } from "./NarrativeSettings";
import { PresetSettings } from "./PresetSettings";
import { setNarrativePref } from "./prefs";
import { useSpoilerView } from "./SpoilerBadge";
import styles from "./settings.module.css";

type Tab = "profiles" | "presets" | "narrative" | "audio" | "context" | "feedback";

const TABS: readonly { readonly id: Tab; readonly code: string; readonly label: string }[] = [
  { id: "profiles", code: "01", label: "模型连接" },
  { id: "presets", code: "02", label: "酒馆预设" },
  { id: "narrative", code: "03", label: "叙事偏好" },
  { id: "audio", code: "04", label: "音频" },
  { id: "context", code: "05", label: "上下文（调试）" },
  { id: "feedback", code: "06", label: "问题反馈" },
];

const CITY_WEIGHT = { minor: "街角小事", normal: "几个街区在传", major: "头条" } as const;

type Destination = Tab | "back" | "menu";

function safeBackTarget(state: unknown, fromParam: string | null): string | null {
  const raw =
    typeof state === "object" && state !== null && "from" in state && typeof state.from === "string"
      ? state.from
      : fromParam;
  if (!raw?.startsWith("/") || raw.startsWith("//")) return null;
  if (raw === "/settings" || raw.startsWith("/settings?")) return null;
  return raw;
}

export function SettingsScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const [dirty, setDirty] = useState(false);
  const [leaving, setLeaving] = useState<Destination | null>(null);
  const [themeModalOpen, setThemeModalOpen] = useState(false);
  const activeSaveId = useStory((s) => (s.phase !== "idle" ? s.saveId : null));
  const { open: spoilersOpen } = useSpoilerView();
  const audioPrefs = useAudioPrefs();
  const shellTheme = useShellTheme();
  const activeTheme = themeById(shellTheme.effectiveId);
  const profilesQuery = useQuery({ queryKey: ["profiles"], queryFn: api.profiles });
  const presetsQuery = useQuery({ queryKey: ["presets"], queryFn: api.tavernPresets });
  const profilesReady = (() => {
    const data = profilesQuery.data;
    if (data?.status !== "ok") return false;
    const okRole = (name: string | undefined) => {
      if (!name) return false;
      const p = data.profiles.find((item) => item.name === name);
      return Boolean(
        p &&
          p.keyStatus !== "missing" &&
          p.type !== "sdwebui" &&
          p.type !== "comfyui" &&
          p.type !== "novelai",
      );
    };
    return okRole(data.narrator) && okRole(data.aux);
  })();
  const profilesLoaded = profilesQuery.data !== undefined;
  const activePreset = presetsQuery.data?.presets.find((p) => p.active);

  const tabParam = params.get("tab");
  const tab: Tab =
    tabParam === "context" ||
    tabParam === "narrative" ||
    tabParam === "presets" ||
    tabParam === "audio" ||
    tabParam === "feedback"
      ? tabParam
      : "profiles";
  const backTarget = activeSaveId
    ? `/play/${activeSaveId}`
    : safeBackTarget(location.state, params.get("from"));
  const canReturnBack = backTarget !== null && backTarget !== "/menu";
  const escTarget: "back" | "menu" = canReturnBack ? "back" : "menu";
  const backLabel = backTarget?.startsWith("/play/") ? "返回游戏" : "返回上一页";

  const go = (target: Destination) => {
    setDirty(false);
    setLeaving(null);
    if (target === "back") {
      navigate(backTarget ?? "/menu");
    } else if (target === "menu") {
      navigate("/menu");
    } else {
      setParams(
        (p) => {
          const next = new URLSearchParams(p);
          next.set("tab", target);
          return next;
        },
        { replace: true, state: location.state },
      );
    }
  };
  const requestGo = (target: Destination) => {
    if (target === tab) return;
    if (dirty) setLeaving(target);
    else go(target);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (document.querySelector("[role=dialog]")) return;
      if (e.target instanceof HTMLElement && e.target.closest("input, textarea, select")) return;
      if (dirty) setLeaving(escTarget);
      else navigate(canReturnBack ? backTarget : "/menu");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [backTarget, canReturnBack, dirty, escTarget, navigate]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const tabDot = (id: Tab): "ok" | "warn" | null => {
    if (id === "profiles" && profilesLoaded) return profilesReady ? "ok" : "warn";
    if (id === "presets" && activePreset) return "ok";
    if (id === "audio" && audioPrefs.muted) return "warn";
    if (id === "context" && spoilersOpen) return "warn";
    return null;
  };

  return (
    <div className={styles.screen}>
      <ShellBackdrop variant="settings" />
      <header className={styles.head}>
        <Asset id="menu.header" tint="var(--cp-red)" height={52} className={styles.headBg} />
        <Asset id="panel.glowLeft" height={28} tint="var(--cp-cyan)" className={styles.headGlow} />
        <div className={styles.headTitleWrap}>
          <span className={styles.headCode}>{"SYS // CONFIG"}</span>
          <h1>设置</h1>
        </div>
        <div className={styles.headRight}>
          <div className={styles.headTelemetry}>
            <button
              type="button"
              className={`${styles.teleChip} ${styles.teleChipBtn}`}
              data-tone={activeTheme.media ? "ok" : undefined}
              title="切换或按需下载外壳界面主题"
              onClick={() => setThemeModalOpen(true)}
            >
              <span className={styles.teleDot} aria-hidden />
              主题：{activeTheme.name}
            </button>
            {profilesLoaded && (
              <span className={styles.teleChip} data-tone={profilesReady ? "ok" : "warn"}>
                <span className={styles.teleDot} aria-hidden />
                {profilesReady ? "模型就绪" : "模型待配置"}
              </span>
            )}
            {activePreset && (
              <span className={styles.teleChip} data-tone="ok" title={activePreset.name}>
                <span className={styles.teleDot} aria-hidden />
                预设：{activePreset.name}
              </span>
            )}
            {spoilersOpen && (
              <span className={styles.teleChip} data-tone="warn">
                <span className={styles.teleDot} aria-hidden />
                剧透调试
              </span>
            )}
            {audioPrefs.muted && (
              <span className={styles.teleChip} data-tone="warn">
                <span className={styles.teleDot} aria-hidden />
                音频静音
              </span>
            )}
          </div>
          <Asset id="fluff.code" tint="var(--cp-red)" height={18} className={styles.headFluff} />
        </div>
      </header>
      {/* 页签：原作 tab.bg 九宫格，切法同神经界面；下面一道 tab.line */}
      <nav className={styles.tabs} aria-label="设置分页">
        {TABS.map((t) => {
          const dot = tabDot(t.id);
          return (
            <button
              key={t.id}
              type="button"
              className={`${neural.tab} ${styles.tabBtn}`}
              aria-pressed={tab === t.id}
              data-sfx={tab === t.id ? "none" : "tab"}
              onClick={() => requestGo(t.id)}
            >
              <NineSlice id="tab.bg" tint="currentColor" slice={14} className={neural.tabBg} />
              <span className={neural.inner}>
                <span className={styles.tabCode}>{t.code}</span>
                <span>{t.label}</span>
                {dot && <span className={styles.tabStatus} data-tone={dot} aria-hidden />}
              </span>
            </button>
          );
        })}
      </nav>
      <span
        className={`${neural.tabLine} ${styles.tabLine}`}
        style={{ maskImage: cssUrl("tab.line"), WebkitMaskImage: cssUrl("tab.line") }}
        aria-hidden
      />
      <main className={styles.body} key={tab}>
        {tab === "profiles" ? (
          <ModelSettings onDirtyChange={setDirty} />
        ) : tab === "presets" ? (
          <PresetSettings />
        ) : tab === "narrative" ? (
          <NarrativeSettings onOpenContext={() => requestGo("context")} />
        ) : tab === "audio" ? (
          <AudioSettings />
        ) : tab === "feedback" ? (
          <FeedbackPanel initialSaveId={params.get("save") ?? activeSaveId} />
        ) : (
          <ContextViewer />
        )}
      </main>
      <footer className={styles.foot}>
        <span
          className={styles.footLine}
          style={{ maskImage: cssUrl("tab.line"), WebkitMaskImage: cssUrl("tab.line") }}
          aria-hidden
        />
        <div className={styles.footRow}>
          <span className={styles.footHint}>{"LOCAL // 配置仅存于本机浏览器"}</span>
          <SettingsTurnProgress />
          <div className={styles.footActions}>
            {canReturnBack ? (
              <>
                <Button small keyId="key.esc" onClick={() => requestGo("back")}>
                  {backLabel}
                </Button>
                <Button small onClick={() => requestGo("menu")}>
                  返回主菜单
                </Button>
              </>
            ) : (
              <Button small keyId="key.esc" onClick={() => requestGo("menu")}>
                返回主菜单
              </Button>
            )}
          </div>
        </div>
      </footer>
      {leaving !== null && (
        <Dialog
          title="还有未保存的内容"
          onClose={() => setLeaving(null)}
          actions={
            <>
              <Button primary onClick={() => setLeaving(null)}>
                继续编辑
              </Button>
              <Button onClick={() => go(leaving)}>放弃未保存内容</Button>
            </>
          }
        >
          <p>输入中的设置和密钥还没有保存。已经保存成功的步骤不会撤回。</p>
        </Dialog>
      )}
      <ThemeModal open={themeModalOpen} onClose={() => setThemeModalOpen(false)} />
    </div>
  );
}

/** 放在分页内容外，切换设置分页和滚动工作台时仍能看见当前调用。 */
function SettingsTurnProgress() {
  const busy = useStory((s) => s.phase !== "idle");
  const stage = useStory((s) => s.stage);
  const trace = useStory((s) => s.stageTrace);
  if (!busy) return null;
  return (
    <div className={styles.turnProgress}>
      <LiveStageBar stage={stage} trace={trace} />
    </div>
  );
}

/* ———— 上下文 ———— */

type SceneSummaryItem = PlayerView["memory"]["scenes"][number];
type SceneImportance = SceneSummaryItem["importance"];

const SCENE_IMPORTANCE: readonly [SceneImportance, string][] = [
  ["minor", "小事"],
  ["normal", "普通"],
  ["key", "关键"],
];
const SCENE_TITLE_CHARS = 24;
const SCENE_TEXT_CHARS = 200;
const BOND_TEXT_CHARS = 120;

interface SceneEditInput {
  readonly action: "edit" | "remove";
  readonly scene: number;
  readonly before: string;
  readonly title?: string;
  readonly text?: string;
  readonly importance?: SceneImportance;
}

interface BondEditInput {
  readonly action: "edit" | "remove";
  readonly npc: string;
  readonly index: number;
  readonly before: string;
  readonly text?: string;
}

interface BondMemoryGroup {
  readonly npcId: string;
  readonly npcName: string;
  readonly memories: readonly string[];
}

function ContextViewer() {
  const { open } = useSpoilerView();
  const queryClient = useQueryClient();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const saves = useQuery({ queryKey: ["saves"], queryFn: api.saves });
  const saveId = params.get("save") ?? saves.data?.[0]?.id ?? "";
  const state = useQuery({
    queryKey: ["state", saveId],
    queryFn: () => api.state(saveId),
    enabled: saveId !== "",
  });
  const turns = state.data?.turns ?? [];
  const seqParam = params.get("seq");
  const seq =
    seqParam !== null && /^\d+$/.test(seqParam) ? Number(seqParam) : (turns.at(-1)?.seq ?? null);

  const context = useQuery({
    queryKey: ["context", saveId, seq],
    queryFn: () => api.context(saveId, seq ?? 0),
    enabled: open && saveId !== "" && seq !== null,
  });

  const editScene = useMutation({
    mutationFn: async (edit: SceneEditInput) => {
      const current = state.data;
      if (!current) throw new Error("存档状态还没加载好");
      await api.action(saveId, {
        requestId: newRequestId(),
        baseVersion: current.version,
        action: { type: "editMemory", what: "scene", ...edit },
      });
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["state", saveId] }),
        queryClient.invalidateQueries({ queryKey: ["context", saveId] }),
      ]);
    },
  });

  const editBond = useMutation({
    mutationFn: async (edit: BondEditInput) => {
      const current = state.data;
      if (!current) throw new Error("存档状态还没加载好");
      await api.action(saveId, {
        requestId: newRequestId(),
        baseVersion: current.version,
        action: { type: "editMemory", what: "bond", ...edit },
      });
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["state", saveId] }),
        queryClient.invalidateQueries({ queryKey: ["context", saveId] }),
      ]);
    },
  });

  const update = (key: "save" | "seq", value: string) => {
    if (key === "save") {
      editScene.reset();
      editBond.reset();
    }
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        next.set("tab", "context");
        next.set(key, value);
        if (key === "save") next.delete("seq");
        return next;
      },
      { replace: true, state: location.state },
    );
  };

  if (!open) {
    return (
      <Panel line="var(--cp-yellow)" className={styles.gateCard}>
        <div className={styles.gateBody}>
          <span className={styles.gateKicker}>{"DEBUG // SPOILER GATE"}</span>
          <div className={styles.gateHead}>
            <Asset id="fluff.attentionFill" height={34} tint="var(--cp-yellow)" />
            <h2>剧透调试视图</h2>
          </div>
          <p>
            这里会显示发给模型的全部提示词与判定内部过程，包括人物的诉求、底线、秘密和委托的隐藏信息。
          </p>
          <ul className={styles.gateList}>
            <li>查看各阶段发送给模型的完整消息、规则模块与 token 预算占比</li>
            <li>直接核对结算记录、账目变动、旧记忆检索与设定库命中</li>
            <li>手动修订场景摘要与人物共同记忆，或将本轮导出为评测用例</li>
          </ul>
          <p className={styles.dim}>打开后屏幕顶部会一直标着「剧透」，在叙事偏好里随时可以关掉。</p>
          <div>
            <Button primary onClick={() => setNarrativePref("spoilers", true)}>
              显示剧透
            </Button>
          </div>
        </div>
      </Panel>
    );
  }
  if (saves.isPending)
    return (
      <Panel line="var(--cp-red-dim)" className={styles.gateCard}>
        <p className={styles.dim}>正在读取存档…</p>
      </Panel>
    );
  if (saves.isError)
    return (
      <Panel line="var(--cp-danger)" className={styles.gateCard}>
        <EmptyState
          text={`读取存档失败：${saves.error.message}`}
          action={<Button onClick={() => void saves.refetch()}>重试</Button>}
        />
      </Panel>
    );
  if (saves.data.length === 0)
    return (
      <Panel line="var(--cp-red-dim)" className={styles.gateCard}>
        <EmptyState text="还没有存档，玩过一轮以后这里能看到发给模型的内容" />
      </Panel>
    );

  return (
    <div className={styles.context}>
      <section className={styles.contextBar} aria-label="选择存档与轮次">
        <NineSlice
          id="notify.itemCellBg"
          slice={ITEM_CELL_SLICE}
          tint="var(--cp-surface-strong)"
          className={styles.slice}
        />
        <NineSlice
          id="notify.itemCellFg"
          slice={ITEM_CELL_SLICE}
          tint="var(--cp-red-dim)"
          className={styles.slice}
        />
        <div className={styles.pickers}>
          <label>
            <span>存档</span>
            <FrameBox>
              <select value={saveId} onChange={(e) => update("save", e.target.value)}>
                {saves.data.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title} · {formatDate(s.createdAt)}
                  </option>
                ))}
              </select>
            </FrameBox>
          </label>
          <label>
            <span>轮次</span>
            <FrameBox>
              <select
                value={seq ?? ""}
                onChange={(e) => update("seq", e.target.value)}
                disabled={turns.length === 0}
              >
                {turns.map((t) => (
                  <option key={t.seq} value={t.seq}>
                    #{t.seq} {t.input.text.slice(0, 24)}
                  </option>
                ))}
              </select>
            </FrameBox>
          </label>
          {seq !== null && <SaveAsCase key={`${saveId}-${seq}`} saveId={saveId} seq={seq} />}
        </div>
      </section>

      {turns.length === 0 && state.isSuccess && (
        <Panel line="var(--cp-red-dim)">
          <EmptyState text="这个存档还没有写进任何一轮" />
        </Panel>
      )}
      {context.isPending && seq !== null && <p className={styles.dim}>正在重建这一轮的上下文…</p>}
      {context.isError && (
        <Panel line="var(--cp-danger)">
          <EmptyState
            text={`读取失败：${context.error.message}`}
            action={<Button onClick={() => void context.refetch()}>重试</Button>}
          />
        </Panel>
      )}
      {context.data && (
        <ContextDetail
          ctx={context.data}
          saveId={saveId}
          scenes={state.data?.memory.scenes ?? []}
          sceneError={editScene.isError ? editScene.error.message : null}
          onEditScene={
            state.data
              ? async (edit) => {
                  await editScene.mutateAsync(edit);
                }
              : undefined
          }
          bonds={(state.data?.npcs ?? [])
            .filter((n) => n.memories.length > 0)
            .map((n) => ({ npcId: n.id, npcName: n.name, memories: n.memories }))}
          bondError={editBond.isError ? editBond.error.message : null}
          onEditBond={
            state.data
              ? async (edit) => {
                  await editBond.mutateAsync(edit);
                }
              : undefined
          }
        />
      )}
    </div>
  );
}

function downloadJson(data: unknown, name: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name.replace(/[\\/:*?"<>|]/g, "_");
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 把出问题的这一轮截成评测用例草稿并下载；补上期望后可放进 tools/evals/ */
function SaveAsCase({ saveId, seq }: { readonly saveId: string; readonly seq: number }) {
  const save = useMutation({
    mutationFn: () => api.evalCase(saveId, seq),
    onSuccess: (res) => {
      downloadJson(res.draft, res.fileName);
    },
  });
  return (
    <div className={styles.caseAction}>
      <Button onClick={() => save.mutate()} disabled={save.isPending}>
        {save.isPending ? "导出中…" : "导出评测用例"}
      </Button>
      {save.isSuccess && (
        <p className={styles.caseNote}>
          已下载 {save.data.fileName}（补上 expect 和 rubric 即可放进 tools/evals/）
        </p>
      )}
      {save.isError && <p className={styles.error}>没导成：{save.error.message}</p>}
    </div>
  );
}

function SceneSummariesSection({
  scenes,
  error,
  onEdit,
}: {
  readonly scenes: readonly SceneSummaryItem[];
  readonly error: string | null;
  readonly onEdit?: ((edit: SceneEditInput) => Promise<void>) | undefined;
}) {
  const [draft, setDraft] = useState<{
    readonly scene: number;
    readonly title: string;
    readonly text: string;
    readonly importance: SceneImportance;
  } | null>(null);
  const [confirming, setConfirming] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  useLayer(
    () => {
      setDraft(null);
      setConfirming(null);
    },
    draft !== null || confirming !== null,
  );

  const run = async (edit: SceneEditInput) => {
    if (!onEdit) return;
    setSaving(true);
    try {
      await onEdit(edit);
      setDraft(null);
      setConfirming(null);
    } catch {
      // 失败原因由外层 error 提示
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section title={scenes.length > 0 ? `场景摘要（${scenes.length}）` : "场景摘要"}>
      {error && <p className={styles.error}>{error}</p>}
      {scenes.length === 0 ? (
        <p className={styles.dim}>还没有场景摘要。</p>
      ) : (
        <ul className={styles.sceneList}>
          {scenes.map((s) => (
            <li key={s.scene} className={styles.sceneCard}>
              <div className={styles.sceneHead}>
                <strong>
                  第 {s.scene} 场 · {s.title}
                </strong>
                <span className={styles.dim}>{s.at}</span>
                <span className={styles.sceneTag} data-importance={s.importance}>
                  {s.importanceLabel}
                </span>
                {s.edited && <span className={styles.dim}>改过</span>}
              </div>
              {draft?.scene === s.scene ? (
                <div className={styles.sceneForm}>
                  <div className={styles.sceneFormRow}>
                    <input
                      className={styles.sceneInput}
                      aria-label="标题"
                      value={draft.title}
                      maxLength={SCENE_TITLE_CHARS}
                      onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                    />
                    <select
                      className={styles.sceneSelect}
                      aria-label="分量"
                      value={draft.importance}
                      onChange={(e) =>
                        setDraft({ ...draft, importance: e.target.value as SceneImportance })
                      }
                    >
                      {SCENE_IMPORTANCE.map(([id, label]) => (
                        <option key={id} value={id}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <textarea
                    className={styles.sceneTextarea}
                    aria-label="内容"
                    rows={3}
                    value={draft.text}
                    maxLength={SCENE_TEXT_CHARS}
                    onChange={(e) => setDraft({ ...draft, text: e.target.value })}
                  />
                  <div className={styles.sceneActions}>
                    <Button
                      primary
                      disabled={saving || draft.title.trim() === "" || draft.text.trim() === ""}
                      onClick={() =>
                        void run({
                          action: "edit",
                          scene: s.scene,
                          before: s.text,
                          title: draft.title.trim(),
                          text: draft.text.trim(),
                          importance: draft.importance,
                        })
                      }
                    >
                      保存
                    </Button>
                    <Button onClick={() => setDraft(null)}>取消</Button>
                  </div>
                </div>
              ) : (
                <p>{s.text}</p>
              )}
              {s.people.length > 0 && <p className={styles.dim}>在场：{s.people.join("、")}</p>}
              {onEdit && draft?.scene !== s.scene && (
                <div className={styles.sceneActions}>
                  {confirming === s.scene ? (
                    <>
                      <span className={styles.dim}>删掉以后 AI 就不记得这条了。</span>
                      <Button
                        primary
                        disabled={saving}
                        onClick={() =>
                          void run({ action: "remove", scene: s.scene, before: s.text })
                        }
                      >
                        删掉
                      </Button>
                      <Button onClick={() => setConfirming(null)}>留着</Button>
                    </>
                  ) : (
                    <>
                      <Button
                        disabled={saving}
                        onClick={() => {
                          setConfirming(null);
                          setDraft({
                            scene: s.scene,
                            title: s.title,
                            text: s.text,
                            importance: s.importance,
                          });
                        }}
                      >
                        改
                      </Button>
                      <Button
                        disabled={saving}
                        onClick={() => {
                          setDraft(null);
                          setConfirming(s.scene);
                        }}
                      >
                        删
                      </Button>
                    </>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function BondMemoriesSection({
  bonds,
  error,
  onEdit,
}: {
  readonly bonds: readonly BondMemoryGroup[];
  readonly error: string | null;
  readonly onEdit?: ((edit: BondEditInput) => Promise<void>) | undefined;
}) {
  const [draft, setDraft] = useState<{
    readonly npc: string;
    readonly index: number;
    readonly before: string;
    readonly text: string;
  } | null>(null);
  const [confirming, setConfirming] = useState<{
    readonly npc: string;
    readonly index: number;
  } | null>(null);
  const [saving, setSaving] = useState(false);

  useLayer(
    () => {
      setDraft(null);
      setConfirming(null);
    },
    draft !== null || confirming !== null,
  );

  const totalCount = bonds.reduce((sum, g) => sum + g.memories.length, 0);

  const run = async (edit: BondEditInput) => {
    if (!onEdit) return;
    setSaving(true);
    try {
      await onEdit(edit);
      setDraft(null);
      setConfirming(null);
    } catch {
      // 失败原因由外层 error 提示
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section title={totalCount > 0 ? `人物共同记忆（${totalCount}）` : "人物共同记忆"}>
      {error && <p className={styles.error}>{error}</p>}
      {totalCount === 0 ? (
        <p className={styles.dim}>还没有人物共同记忆。</p>
      ) : (
        <ul className={styles.sceneList}>
          {bonds.flatMap((group) =>
            group.memories.map((text, index) => {
              const key = `${group.npcId}-${index}`;
              const isEditing = draft?.npc === group.npcId && draft.index === index;
              const isConfirming = confirming?.npc === group.npcId && confirming.index === index;
              return (
                <li key={key} className={styles.sceneCard}>
                  <div className={styles.sceneHead}>
                    <strong>{group.npcName}</strong>
                    <span className={styles.dim}>#{index + 1}</span>
                  </div>
                  {isEditing ? (
                    <div className={styles.sceneForm}>
                      <textarea
                        className={styles.sceneTextarea}
                        aria-label={`${group.npcName}的共同记忆`}
                        rows={2}
                        value={draft.text}
                        maxLength={BOND_TEXT_CHARS}
                        onChange={(e) => setDraft({ ...draft, text: e.target.value })}
                      />
                      <div className={styles.sceneActions}>
                        <Button
                          primary
                          disabled={saving || draft.text.trim() === ""}
                          onClick={() =>
                            void run({
                              action: "edit",
                              npc: group.npcId,
                              index,
                              before: text,
                              text: draft.text.trim(),
                            })
                          }
                        >
                          保存
                        </Button>
                        <Button onClick={() => setDraft(null)}>取消</Button>
                      </div>
                    </div>
                  ) : (
                    <p>{text}</p>
                  )}
                  {onEdit && !isEditing && (
                    <div className={styles.sceneActions}>
                      {isConfirming ? (
                        <>
                          <span className={styles.dim}>删掉以后该人物就不记得这条了。</span>
                          <Button
                            primary
                            disabled={saving}
                            onClick={() =>
                              void run({
                                action: "remove",
                                npc: group.npcId,
                                index,
                                before: text,
                              })
                            }
                          >
                            删掉
                          </Button>
                          <Button onClick={() => setConfirming(null)}>留着</Button>
                        </>
                      ) : (
                        <>
                          <Button
                            disabled={saving}
                            onClick={() => {
                              setConfirming(null);
                              setDraft({ npc: group.npcId, index, before: text, text });
                            }}
                          >
                            改
                          </Button>
                          <Button
                            disabled={saving}
                            onClick={() => {
                              setDraft(null);
                              setConfirming({ npc: group.npcId, index });
                            }}
                          >
                            删
                          </Button>
                        </>
                      )}
                    </div>
                  )}
                </li>
              );
            }),
          )}
        </ul>
      )}
    </Section>
  );
}

function formatUsageSummary(usage: {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedInputTokens?: number | undefined;
  readonly cacheWriteTokens?: number | undefined;
}): string {
  const cached = usage.cachedInputTokens ?? 0;
  const write = usage.cacheWriteTokens ?? 0;
  const rate = usage.inputTokens > 0 ? Math.round((cached / usage.inputTokens) * 100) : 0;
  const parts = [
    `输入 ${usage.inputTokens.toLocaleString()}`,
    ...(cached > 0 ? [`缓存命中 ${cached.toLocaleString()} (${rate}%)`] : []),
    ...(write > 0 ? [`写入缓存 ${write.toLocaleString()}`] : []),
    `输出 ${usage.outputTokens.toLocaleString()} tokens`,
  ];
  return parts.join(" · ");
}

function ContextDetail({
  ctx,
  saveId,
  scenes,
  sceneError,
  onEditScene,
  bonds,
  bondError,
  onEditBond,
}: {
  readonly ctx: TurnContext;
  readonly saveId: string;
  readonly scenes: readonly SceneSummaryItem[];
  readonly sceneError: string | null;
  readonly onEditScene?: ((edit: SceneEditInput) => Promise<void>) | undefined;
  readonly bonds: readonly BondMemoryGroup[];
  readonly bondError: string | null;
  readonly onEditBond?: ((edit: BondEditInput) => Promise<void>) | undefined;
}) {
  return (
    <div className={styles.detail}>
      <dl className={styles.facts}>
        <div className={styles.factCard}>
          <dt>时间</dt>
          <dd className="num">{formatDate(ctx.at)}</dd>
        </div>
        <div className={styles.factCard}>
          <dt>本轮用量</dt>
          <dd className="num">{ctx.usage ? formatUsageSummary(ctx.usage) : "没有记录"}</dd>
        </div>
        <div className={styles.factCard}>
          <dt>存档累计</dt>
          <dd className="num">
            {ctx.totalUsage.turns} 轮 · {formatUsageSummary(ctx.totalUsage)}
          </dd>
        </div>
        <div className={`${styles.factCard} ${styles.factCardWide}`}>
          <dt>载入模块（{ctx.modules.length}）</dt>
          <dd>
            {ctx.modules.length > 0 ? (
              <div className={styles.modulePills}>
                {ctx.modules.map((m) => (
                  <span key={m} className={styles.modulePill}>
                    {m}
                  </span>
                ))}
              </div>
            ) : (
              <span className={styles.dim}>无</span>
            )}
          </dd>
        </div>
      </dl>

      {ctx.rebuildError && (
        <p className={styles.error}>
          重建提示词失败：{ctx.rebuildError}（下面只有日志里记下的内容）
        </p>
      )}
      {ctx.dropped.length > 0 && (
        <Section title={`被丢弃的提议（${ctx.dropped.length}）`} tone="warn">
          <pre>{JSON.stringify(ctx.dropped, null, 2)}</pre>
        </Section>
      )}
      {ctx.flags && ctx.flags.length > 0 && (
        <Section title={`守则提醒（${ctx.flags.length}）`} tone="warn">
          <ul>
            {ctx.flags.map((f, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: 按核对给出的顺序排，可能重复
              <li key={`${i}-${f}`}>{f}</li>
            ))}
          </ul>
        </Section>
      )}
      {ctx.notes.length > 0 && (
        <Section title={`结算记录（${ctx.notes.length}）`}>
          <ul>
            {ctx.notes.map((n, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: 结算记录按发生顺序排，可能重复
              <li key={`${i}-${n}`}>{n}</li>
            ))}
          </ul>
        </Section>
      )}
      {ctx.ledger && ctx.ledger.length > 0 && (
        <Section
          title={`账目对账（最近 ${ctx.ledger.filter((e) => e.kind === "turn").length} 轮）`}
          defaultOpen={false}
        >
          <ul>
            {ctx.ledger.map((e) => (
              <li key={e.seq}>
                <strong>
                  {e.kind === "turn" ? `第 ${e.seq} 轮` : `第 ${e.seq} 条（界面操作）`}
                </strong>
                {e.changes.length === 0
                  ? "：硬数值没变"
                  : `：${e.changes.map((c) => `${c.label} ${c.before ?? "—"} → ${c.after ?? "—"}`).join("，")}`}
                {e.commands.length > 0 && (
                  <pre>{e.commands.map((c) => JSON.stringify(c)).join("\n")}</pre>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}
      {ctx.considered.length > 0 && (
        <Section title={`考虑过没记账的（${ctx.considered.length}）`} defaultOpen={false}>
          <ul>
            {ctx.considered.map((n, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: 按抽取给的顺序排，可能重复
              <li key={`${i}-${n}`}>{n}</li>
            ))}
          </ul>
        </Section>
      )}
      {ctx.ruling && (
        <Section title="裁决理由">
          <p>{ctx.ruling}</p>
        </Section>
      )}
      {ctx.budget && (
        <Section
          title={`上下文预算（约 ${ctx.budget.total.toLocaleString()} / ${ctx.budget.limit.toLocaleString()} token）`}
          {...(ctx.budget.total > ctx.budget.limit ? { tone: "warn" as const } : {})}
        >
          <p className={styles.budgetSummary}>
            窗口 {ctx.budget.window.toLocaleString()} token · 带了最近 {ctx.budget.history} 轮原文 ·
            前情上限 {ctx.budget.recapTokens.toLocaleString()} token
          </p>
          <div className={styles.budgetList}>
            {ctx.budget.parts.map((p) => {
              const denom = p.limit ?? Math.max(ctx.budget?.limit ?? 1, p.tokens, 1);
              const val = p.part === "reply" ? (p.limit ?? 0) : p.tokens;
              const pct = Math.min(100, Math.max(0, Math.round((val / denom) * 100)));
              const over = p.limit !== null && p.tokens > p.limit;
              return (
                <div key={p.part} className={styles.budgetRow} data-over={over || undefined}>
                  <div className={styles.budgetRowHead}>
                    <span className={styles.budgetLabel}>{p.label}</span>
                    <span className={styles.budgetVal}>
                      {p.part === "reply" ? (
                        `预留 ${(p.limit ?? 0).toLocaleString()}`
                      ) : (
                        <>
                          约 {p.tokens.toLocaleString()}
                          {p.limit === null ? "（不设上限）" : ` / ${p.limit.toLocaleString()}`}
                          {over ? " · 超限（必需保留）" : ""}
                        </>
                      )}
                    </span>
                  </div>
                  <div className={styles.budgetTrack} aria-hidden>
                    <span
                      className={styles.budgetFill}
                      data-over={over || undefined}
                      data-reply={p.part === "reply" || undefined}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
          {ctx.budget.cuts.length > 0 ? (
            <p className={styles.budgetCut}>为了塞进窗口：{ctx.budget.cuts.join("；")}</p>
          ) : (
            <p className={styles.dim}>没有砍任何部分</p>
          )}
          <p className={styles.dim}>token 数按字数粗估，和服务商实际计数会有出入</p>
        </Section>
      )}
      {(ctx.retrieval || (ctx.recalled && ctx.recalled.length > 0)) && (
        <Section title="扩展层（旧记忆）" defaultOpen={false}>
          {ctx.recalled && ctx.recalled.length > 0 && <p>判断调的：{ctx.recalled.join("；")}</p>}
          {ctx.retrieval ? (
            <>
              <p>
                {ctx.retrieval.triggers.length > 0
                  ? `检索原因：${ctx.retrieval.triggers.join("；")}`
                  : "覆盖够了，没检索"}
              </p>
              <p>
                补进来的：
                {ctx.retrieval.picked.length > 0 ? ctx.retrieval.picked.join("；") : "没有"}
              </p>
              {ctx.retrieval.fallback.length > 0 && (
                <p className={styles.dim}>退回：{ctx.retrieval.fallback.join(" → ")}</p>
              )}
              {ctx.retrieval.top.length > 0 && (
                <ul>
                  {ctx.retrieval.top.map((t) => (
                    <li key={t.id}>
                      <strong>{t.score}</strong> {t.title}
                      <span className={styles.dim}>（{t.parts}）</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <p className={styles.dim}>这一轮没有检索记录（旧记录或确认检定的一轮）</p>
          )}
        </Section>
      )}
      <SceneSummariesSection key={saveId} scenes={scenes} error={sceneError} onEdit={onEditScene} />
      <BondMemoriesSection
        key={`bond-${saveId}`}
        bonds={bonds}
        error={bondError}
        onEdit={onEditBond}
      />
      {ctx.lore && (
        <Section title={`设定库（原作资料，${ctx.lore.picked.length} 段）`} defaultOpen={false}>
          <p>
            检索词：{ctx.lore.terms.length > 0 ? ctx.lore.terms.join("、") : "没有"}；命中{" "}
            {ctx.lore.candidates} 段
          </p>
          {ctx.lore.note && <p className={styles.dim}>没给的原因：{ctx.lore.note}</p>}
          {ctx.lore.picked.length > 0 && (
            <ul>
              {ctx.lore.picked.map((p) => (
                <li key={p.source}>
                  <strong>{p.score}</strong> {p.kind}「{p.title}」
                  <span className={styles.dim}>
                    （命中 {p.hits.join("、")}；{p.source}）
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}
      {ctx.offscreenSkip && (
        <Section title="⑥ 场外推演" defaultOpen={false}>
          <p className={styles.dim}>这一轮没跑：{ctx.offscreenSkip}</p>
        </Section>
      )}
      {ctx.city && ctx.city.length > 0 && (
        <Section title={`城里的动静（这一轮之后，${ctx.city.length}）`} defaultOpen={false}>
          <ul>
            {ctx.city.map((e) => (
              <li key={e.id} className={e.over ? styles.dim : undefined}>
                {e.title}［{e.status}，{CITY_WEIGHT[e.weight]}
                {e.district ? `，${e.district}` : ""}］{e.body}
              </li>
            ))}
          </ul>
        </Section>
      )}
      <Section title={`生效的指令（${ctx.commands.length}）`} defaultOpen={false}>
        <pre>{JSON.stringify(ctx.commands, null, 2)}</pre>
      </Section>
      {(
        ctx.prompts ??
        (ctx.prompt
          ? [
              {
                stage: "narrate" as const,
                label: "③ 写正文",
                ...ctx.prompt,
                chars: ctx.prompt.messages.reduce((n, m) => n + m.content.length, 0),
              },
            ]
          : [])
      ).map((p) => (
        <Section
          key={p.stage}
          title={`${p.label}：${p.messages.length} 条消息 · ${p.chars.toLocaleString()} 字`}
          defaultOpen={p.stage === "narrate"}
        >
          <p className={styles.stageModules}>
            规则模块：{p.modules.length > 0 ? p.modules.join("、") : "无"}
          </p>
          {p.messages.map((m, i) => (
            <details
              // biome-ignore lint/suspicious/noArrayIndexKey: 消息按发送顺序排，角色会重复
              key={`${i}-${m.role}`}
              className={styles.message}
              open={p.stage === "narrate" && i === p.messages.length - 1}
            >
              <summary>
                {m.role} · {m.content.length} 字
              </summary>
              <pre>{m.content}</pre>
            </details>
          ))}
        </Section>
      ))}
      <Section title="模型的回复正文">
        <pre>{ctx.text}</pre>
      </Section>
    </div>
  );
}

function Section({
  title,
  tone,
  defaultOpen = true,
  children,
}: {
  readonly title: string;
  readonly tone?: "warn";
  readonly defaultOpen?: boolean;
  readonly children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={styles.section} data-tone={tone} data-collapsed={!open || undefined}>
      <NineSlice
        id="notify.itemCellBg"
        slice={ITEM_CELL_SLICE}
        tint="var(--cp-surface)"
        className={styles.slice}
      />
      <NineSlice
        id="notify.itemCellFg"
        slice={ITEM_CELL_SLICE}
        tint={tone === "warn" ? "var(--cp-yellow)" : "var(--cp-red-dim)"}
        className={styles.slice}
      />
      <button
        type="button"
        className={styles.sectionToggle}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <h2>{title}</h2>
        <span className={styles.sectionState}>
          <span>{open ? "收起" : "展开"}</span>
          <Asset
            id="menu.arrowFill"
            width={9}
            tint="currentColor"
            className={styles.sectionArrow}
          />
        </span>
      </button>
      {open && <div className={styles.sectionBody}>{children}</div>}
    </section>
  );
}
