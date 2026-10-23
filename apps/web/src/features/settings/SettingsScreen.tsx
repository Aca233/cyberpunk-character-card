import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { api, type TurnContext } from "../../api/client";
import { formatDate } from "../../labels";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { KeyBar, KeyHint } from "../../ui/KeyHint";
import { EmptyState } from "../status/StatusParts";
import { ModelSettings } from "./ModelSettings";
import styles from "./settings.module.css";

type Tab = "profiles" | "context";

export function SettingsScreen() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [dirty, setDirty] = useState(false);
  const [leaving, setLeaving] = useState<Tab | "menu" | null>(null);
  const tab: Tab = params.get("tab") === "context" ? "context" : "profiles";

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
            aria-pressed={tab === "context"}
            onClick={() => requestGo("context")}
          >
            上下文（调试）
          </button>
        </div>
      </header>
      <main className={styles.body}>
        {tab === "profiles" ? <ModelSettings onDirtyChange={setDirty} /> : <ContextViewer />}
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
    enabled: saveId !== "" && seq !== null,
  });

  const update = (key: "save" | "seq", value: string) =>
    setParams((p) => {
      p.set("tab", "context");
      p.set(key, value);
      if (key === "save") p.delete("seq");
      return p;
    });

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
      {context.data && <ContextDetail ctx={context.data} />}
    </div>
  );
}

function ContextDetail({ ctx }: { readonly ctx: TurnContext }) {
  return (
    <div className={styles.detail}>
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
        <Section title={`被丢弃的指令（${ctx.dropped.length}）`} tone="warn">
          <pre>{JSON.stringify(ctx.dropped, null, 2)}</pre>
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
      <Section title={`生效的指令（${ctx.commands.length}）`}>
        <pre>{JSON.stringify(ctx.commands, null, 2)}</pre>
      </Section>
      {ctx.prompt && (
        <Section title={`发给模型的消息（${ctx.prompt.messages.length}）`}>
          {ctx.prompt.messages.map((m, i) => (
            <details
              // biome-ignore lint/suspicious/noArrayIndexKey: 消息按发送顺序排，角色会重复
              key={`${i}-${m.role}`}
              className={styles.message}
              open={i === (ctx.prompt?.messages.length ?? 0) - 1}
            >
              <summary>
                {m.role} · {m.content.length} 字
              </summary>
              <pre>{m.content}</pre>
            </details>
          ))}
        </Section>
      )}
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
