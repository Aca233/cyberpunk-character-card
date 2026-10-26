import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { api, type TurnContext } from "../../api/client";
import { formatDate } from "../../labels";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { KeyBar, KeyHint } from "../../ui/KeyHint";
import { EmptyState } from "../status/StatusParts";
import { ModelSettings } from "./ModelSettings";
import { NarrativeSettings } from "./NarrativeSettings";
import { setNarrativePref } from "./prefs";
import { useSpoilerView } from "./SpoilerBadge";
import styles from "./settings.module.css";

type Tab = "profiles" | "narrative" | "context";

const CITY_WEIGHT = { minor: "街角小事", normal: "几个街区在传", major: "头条" } as const;

export function SettingsScreen() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [dirty, setDirty] = useState(false);
  const [leaving, setLeaving] = useState<Tab | "menu" | null>(null);
  const tabParam = params.get("tab");
  const tab: Tab = tabParam === "context" || tabParam === "narrative" ? tabParam : "profiles";

  const go = (target: Tab | "menu") => {
    setDirty(false);
    setLeaving(null);
    if (target === "menu") {
      navigate("/menu");
    } else {
      setParams((p) => {
        const next = new URLSearchParams(p);
        next.set("tab", target);
        return next;
      });
    }
  };
  const requestGo = (target: Tab | "menu") => {
    if (target === tab) return;
    if (dirty) setLeaving(target);
    else go(target);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (document.querySelector("[role=dialog]")) return;
      if (e.target instanceof HTMLElement && e.target.closest("input, textarea, select")) return;
      if (dirty) setLeaving("menu");
      else navigate("/menu");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dirty, navigate]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  return (
    <div className={styles.screen}>
      <header className={styles.head}>
        <h1>设置</h1>
        <div className={styles.tabs}>
          <button
            type="button"
            aria-pressed={tab === "profiles"}
            onClick={() => requestGo("profiles")}
          >
            模型连接
          </button>
          <button
            type="button"
            aria-pressed={tab === "narrative"}
            onClick={() => requestGo("narrative")}
          >
            叙事偏好
          </button>
          <button
            type="button"
            aria-pressed={tab === "context"}
            onClick={() => requestGo("context")}
          >
            上下文（调试）
          </button>
        </div>
      </header>
      <main className={styles.body}>
        {tab === "profiles" ? (
          <ModelSettings onDirtyChange={setDirty} />
        ) : tab === "narrative" ? (
          <NarrativeSettings />
        ) : (
          <ContextViewer />
        )}
      </main>
      <footer className={styles.foot}>
        <KeyBar>
          <KeyHint keyId="key.esc" label="返回主菜单" onClick={() => requestGo("menu")} />
        </KeyBar>
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
    </div>
  );
}

/* ———— 上下文 ———— */

function ContextViewer() {
  const { open } = useSpoilerView();
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

  const update = (key: "save" | "seq", value: string) =>
    setParams((p) => {
      p.set("tab", "context");
      p.set(key, value);
      if (key === "save") p.delete("seq");
      return p;
    });

  if (!open) {
    return (
      <div className={styles.prefs}>
        <p>
          这里是剧透调试视图：会显示发给模型的全部内容，包括人物的诉求、底线、秘密和委托的隐藏信息。
        </p>
        <p className={styles.dim}>打开后屏幕顶部会一直标着「剧透」，在叙事偏好里随时可以关掉。</p>
        <div>
          <Button primary onClick={() => setNarrativePref("spoilers", true)}>
            显示剧透
          </Button>
        </div>
      </div>
    );
  }
  if (saves.isPending) return <p className={styles.dim}>正在读取存档…</p>;
  if (saves.isError) return <EmptyState text={`读取存档失败：${saves.error.message}`} />;
  if (saves.data.length === 0)
    return <EmptyState text="还没有存档，玩过一轮以后这里能看到发给模型的内容" />;

  return (
    <div className={styles.context}>
      <div className={styles.pickers}>
        <label>
          <span>存档</span>
          <select value={saveId} onChange={(e) => update("save", e.target.value)}>
            {saves.data.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title} · {formatDate(s.createdAt)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>轮次</span>
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
        </label>
      </div>

      {turns.length === 0 && state.isSuccess && <EmptyState text="这个存档还没有写进任何一轮" />}
      {context.isPending && seq !== null && <p className={styles.dim}>正在重建这一轮的上下文…</p>}
      {context.isError && <EmptyState text={`读取失败：${context.error.message}`} />}
      {context.data && <ContextDetail ctx={context.data} saveId={saveId} />}
    </div>
  );
}

/** 把出问题的这一轮截成评测用例草稿；补上期望后移进 tools/evals/ */
function SaveAsCase({ saveId, seq }: { readonly saveId: string; readonly seq: number }) {
  const save = useMutation({ mutationFn: () => api.evalCase(saveId, seq) });
  return (
    <div className={styles.caseRow}>
      <Button onClick={() => save.mutate()} disabled={save.isPending}>
        存为评测用例
      </Button>
      {save.isSuccess && (
        <p className={styles.dim}>
          已写入 {save.data.file}：补上 expect 和 rubric，移到 tools/evals/ 就会进测评
        </p>
      )}
      {save.isError && <p className={styles.error}>没存上：{save.error.message}</p>}
    </div>
  );
}

function ContextDetail({ ctx, saveId }: { readonly ctx: TurnContext; readonly saveId: string }) {
  return (
    <div className={styles.detail}>
      <SaveAsCase key={`${saveId}-${ctx.seq}`} saveId={saveId} seq={ctx.seq} />
      <dl className={styles.facts}>
        <dt>时间</dt>
        <dd>{formatDate(ctx.at)}</dd>
        <dt>本轮用量</dt>
        <dd>
          {ctx.usage
            ? `输入 ${ctx.usage.inputTokens} · 输出 ${ctx.usage.outputTokens} tokens`
            : "没有记录"}
        </dd>
        <dt>存档累计</dt>
        <dd>
          {ctx.totalUsage.turns} 轮 · 输入 {ctx.totalUsage.inputTokens.toLocaleString()} · 输出{" "}
          {ctx.totalUsage.outputTokens.toLocaleString()} tokens
        </dd>
        <dt>载入模块</dt>
        <dd>{ctx.modules.length > 0 ? ctx.modules.join("、") : "无"}</dd>
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
        <Section title="结算记录">
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
        <Section title={`考虑过没记账的（${ctx.considered.length}）`}>
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
          <p>
            窗口 {ctx.budget.window.toLocaleString()} token；带了最近 {ctx.budget.history}{" "}
            轮原文；前情上限 {ctx.budget.recapTokens.toLocaleString()} token
          </p>
          <ul>
            {ctx.budget.parts.map((p) => (
              <li
                key={p.part}
                className={p.limit !== null && p.tokens > p.limit ? undefined : styles.dim}
              >
                {p.part === "reply" ? (
                  `${p.label}：预留 ${(p.limit ?? 0).toLocaleString()}`
                ) : (
                  <>
                    {p.label}：约 {p.tokens.toLocaleString()}
                    {p.limit === null ? "（不设上限）" : ` / ${p.limit.toLocaleString()}`}
                    {p.limit !== null && p.tokens > p.limit ? "（超了，必需的部分不裁）" : ""}
                  </>
                )}
              </li>
            ))}
          </ul>
          {ctx.budget.cuts.length > 0 ? (
            <p>为了塞进窗口：{ctx.budget.cuts.join("；")}</p>
          ) : (
            <p className={styles.dim}>没有砍任何部分</p>
          )}
          <p className={styles.dim}>token 数按字数粗估，和服务商实际计数会有出入</p>
        </Section>
      )}
      {(ctx.retrieval || (ctx.recalled && ctx.recalled.length > 0)) && (
        <Section title="扩展层（旧记忆）">
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
      {ctx.lore && (
        <Section title={`设定库（原作资料，${ctx.lore.picked.length} 段）`}>
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
        <Section title="⑥ 场外推演">
          <p className={styles.dim}>这一轮没跑：{ctx.offscreenSkip}</p>
        </Section>
      )}
      {ctx.city && ctx.city.length > 0 && (
        <Section title={`城里的动静（这一轮之后，${ctx.city.length}）`}>
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
      <Section title={`生效的指令（${ctx.commands.length}）`}>
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
  children,
}: {
  readonly title: string;
  readonly tone?: "warn";
  readonly children: React.ReactNode;
}) {
  return (
    <section className={styles.section} data-tone={tone}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}
