import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import {
  api,
  type ConnectionTest,
  type NewProfile,
  type ProfilePatch,
  type PublicProfile,
  type TurnContext,
} from "../../api/client";
import { formatDate } from "../../labels";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { KeyBar, KeyHint } from "../../ui/KeyHint";
import { Panel } from "../../ui/Panel";
import { EmptyState } from "../status/StatusParts";
import styles from "./settings.module.css";

type Tab = "profiles" | "context";

const KEY_LABELS: Readonly<Record<PublicProfile["keyStatus"], string>> = {
  configured: "密钥已配置",
  missing: "缺少密钥",
  notNeeded: "不需要密钥",
};

/** 设置：模型方案和每一轮的上下文 */
export function SettingsScreen() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get("tab") === "context" ? "context" : "profiles";
  const setTab = (next: Tab) =>
    setParams((p) => {
      p.set("tab", next);
      return p;
    });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (
        e.target instanceof HTMLElement &&
        e.target.closest("input, textarea, select, [role=dialog]")
      )
        return;
      navigate(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);

  return (
    <div className={styles.screen}>
      <header className={styles.head}>
        <h1>设置</h1>
        <div className={styles.tabs} role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "profiles"}
            onClick={() => setTab("profiles")}
          >
            模型方案
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "context"}
            onClick={() => setTab("context")}
          >
            上下文
          </button>
        </div>
      </header>
      <main className={styles.body}>{tab === "profiles" ? <Profiles /> : <ContextViewer />}</main>
      <footer className={styles.foot}>
        <KeyBar>
          <KeyHint keyId="key.esc" label="返回" onClick={() => navigate(-1)} />
        </KeyBar>
      </footer>
    </div>
  );
}

/* ———— 模型方案 ———— */

const TYPE_LABELS: Readonly<Record<PublicProfile["type"], string>> = {
  openai: "OpenAI 兼容（中转站、DeepSeek、OpenRouter 等）",
  ollama: "Ollama 本地模型",
  gemini: "Gemini 原生接口（还没接好）",
  anthropic: "Anthropic 原生接口（还没接好）",
};

function useRefreshConfig() {
  const client = useQueryClient();
  return async () => {
    await client.invalidateQueries({ queryKey: ["profiles"] });
    await client.invalidateQueries({ queryKey: ["health"] });
  };
}

function Profiles() {
  const overview = useQuery({ queryKey: ["profiles"], queryFn: api.profiles });
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  if (overview.isPending) return <p className={styles.dim}>正在读取配置…</p>;
  if (overview.isError) return <EmptyState text={`读取配置失败：${overview.error.message}`} />;
  const data = overview.data;
  if (data.status === "missing") return <CreateConfig />;

  return (
    <div className={styles.profiles}>
      {data.status === "invalid" && (
        <Panel as="div" title="config.json 有错" line="var(--cp-danger)">
          <p>文件格式不对，设置页没法安全地改它。按下面的提示在编辑器里修好，再刷新这一页。</p>
          <ul className={styles.errors}>
            {data.errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </Panel>
      )}
      {data.status === "ok" && data.gm !== undefined && data.aux !== undefined && (
        <Roles profiles={data.profiles} gm={data.gm} aux={data.aux} />
      )}
      <ul className={styles.profileList}>
        {data.profiles.map((p) => (
          <li key={p.name}>
            <ProfileCard
              profile={p}
              roles={[
                data.gm === p.name ? "主持" : null,
                data.aux === p.name ? "辅助" : null,
              ].filter((r): r is string => r !== null)}
              editing={editing === p.name}
              onEdit={() => setEditing(editing === p.name ? null : p.name)}
              onSaved={() => setEditing(null)}
            />
          </li>
        ))}
      </ul>
      {data.status === "ok" &&
        (adding ? (
          <AddProfile onDone={() => setAdding(false)} />
        ) : (
          <div>
            <Button onClick={() => setAdding(true)}>添加方案</Button>
          </div>
        ))}
      <p className={styles.dim}>
        密钥只发给本机后端，存在项目根目录的 <code>config.json</code>
        里（这个文件不会提交到 git），保存后网页上不会再显示出来。
      </p>
    </div>
  );
}

function CreateConfig() {
  const refresh = useRefreshConfig();
  const create = useMutation({ mutationFn: () => api.initConfig(), onSuccess: refresh });
  return (
    <div className={styles.profiles}>
      <Panel as="div" title="还没有配置" line="var(--cp-yellow)">
        <p>先照示例建一份配置，再给要用的方案填上密钥，就能开始玩了。</p>
        {create.isError && <p className={styles.error}>{create.error.message}</p>}
        <div className={styles.actions}>
          <Button primary onClick={() => create.mutate()} disabled={create.isPending}>
            {create.isPending ? "创建中…" : "用示例创建"}
          </Button>
        </div>
      </Panel>
    </div>
  );
}

function Roles({
  profiles,
  gm,
  aux,
}: {
  readonly profiles: readonly PublicProfile[];
  readonly gm: string;
  readonly aux: string;
}) {
  const refresh = useRefreshConfig();
  const save = useMutation({ mutationFn: api.setRoles, onSuccess: refresh });
  const picker = (role: "gm" | "aux", label: string, value: string) => (
    <label>
      <span>{label}</span>
      <select
        value={value}
        disabled={save.isPending}
        onChange={(e) =>
          save.mutate(role === "gm" ? { gm: e.target.value } : { aux: e.target.value })
        }
      >
        {profiles.map((p) => (
          <option key={p.name} value={p.name}>
            {p.name}
            {p.keyStatus === "missing" ? "（缺密钥）" : ""}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <Panel as="div" title="用哪个方案" line="var(--cp-yellow)">
      <div className={styles.pickers}>
        {picker("gm", "主持（写剧情）", gm)}
        {picker("aux", "辅助（修格式、写摘要）", aux)}
      </div>
      {save.isError && <p className={styles.error}>{save.error.message}</p>}
    </Panel>
  );
}

function ProfileCard({
  profile,
  roles,
  editing,
  onEdit,
  onSaved,
}: {
  readonly profile: PublicProfile;
  readonly roles: readonly string[];
  readonly editing: boolean;
  readonly onEdit: () => void;
  readonly onSaved: () => void;
}) {
  const refresh = useRefreshConfig();
  const [asking, setAsking] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [result, setResult] = useState<ConnectionTest | null>(null);
  const test = useMutation({
    mutationFn: () => api.testProfile(profile.name),
    onSuccess: setResult,
    onError: (e) => setResult({ ok: false, error: e.message }),
  });
  const remove = useMutation({
    mutationFn: () => api.deleteProfile(profile.name),
    onSuccess: refresh,
  });
  const noKey = profile.keyStatus === "missing";
  const inUse = roles.length > 0;

  return (
    <Panel as="div" title={profile.name} line={inUse ? "var(--cp-yellow)" : "var(--cp-red)"}>
      <div className={styles.badges}>
        {roles.map((r) => (
          <span key={r} className={styles.role}>
            {r}
          </span>
        ))}
        <span className={styles.badge}>{profile.type}</span>
        <span className={styles.badge} data-key={profile.keyStatus}>
          {KEY_LABELS[profile.keyStatus]}
        </span>
      </div>
      <dl className={styles.facts}>
        <dt>模型</dt>
        <dd>{profile.model}</dd>
        {profile.baseUrl && (
          <>
            <dt>地址</dt>
            <dd>{profile.baseUrl}</dd>
          </>
        )}
        <dt>上下文窗口</dt>
        <dd>{profile.contextWindow.toLocaleString()} tokens</dd>
        {profile.temperature !== undefined && (
          <>
            <dt>温度</dt>
            <dd>{profile.temperature}</dd>
          </>
        )}
        {profile.maxOutputTokens !== undefined && (
          <>
            <dt>最多输出</dt>
            <dd>{profile.maxOutputTokens.toLocaleString()} tokens</dd>
          </>
        )}
      </dl>

      <KeyEditor profile={profile} />

      {editing && <ProfileForm profile={profile} onSaved={onSaved} />}

      <div className={styles.actions}>
        <Button onClick={onEdit}>{editing ? "收起" : "编辑"}</Button>
        <Button
          onClick={() => setAsking(true)}
          disabled={test.isPending || noKey}
          reason={noKey ? "先填好密钥" : undefined}
        >
          {test.isPending ? "测试中…" : "测试连接"}
        </Button>
        <Button
          onClick={() => setRemoving(true)}
          disabled={inUse || remove.isPending}
          reason={inUse ? "正在使用，先在上面换成别的方案" : undefined}
        >
          删除方案
        </Button>
      </div>

      {remove.isError && <p className={styles.error}>{remove.error.message}</p>}
      {result && (
        <p className={styles.testResult} data-ok={result.ok || undefined} role="status">
          {result.ok
            ? `连接正常 · ${result.model} · ${result.ms} ms · 回复：${result.reply}${
                result.usage
                  ? ` · 用量 ${result.usage.inputTokens}/${result.usage.outputTokens} tokens`
                  : ""
              }`
            : `连接失败：${result.error}`}
        </p>
      )}

      {asking && (
        <Dialog
          title="测试连接"
          tone="info"
          onClose={() => setAsking(false)}
          actions={
            <>
              <Button
                primary
                onClick={() => {
                  setAsking(false);
                  setResult(null);
                  test.mutate();
                }}
              >
                发送测试请求
              </Button>
              <Button onClick={() => setAsking(false)}>取消</Button>
            </>
          }
        >
          <p>
            会用「{profile.name}」向 {profile.model} 发一条很短的请求，产生极少量费用（几十个
            token）。
          </p>
        </Dialog>
      )}
      {removing && (
        <Dialog
          title="删除方案"
          tone="danger"
          onClose={() => setRemoving(false)}
          actions={
            <>
              <Button
                primary
                onClick={() => {
                  setRemoving(false);
                  remove.mutate();
                }}
              >
                删除
              </Button>
              <Button onClick={() => setRemoving(false)}>取消</Button>
            </>
          }
        >
          <p>会从 config.json 删掉「{profile.name}」和它的密钥，删了要重新添加。</p>
        </Dialog>
      )}
    </Panel>
  );
}

/** 密钥只进不出：保存后输入框立刻清空，后端也不会把它发回来 */
function KeyEditor({ profile }: { readonly profile: PublicProfile }) {
  const refresh = useRefreshConfig();
  const [value, setValue] = useState("");
  const [note, setNote] = useState<{ readonly ok: boolean; readonly text: string } | null>(null);
  const [clearing, setClearing] = useState(false);
  const save = useMutation({
    // 密钥直接从输入框读，不当 mutation 参数，免得留在 react-query 的缓存里
    mutationFn: () => api.setKey(profile.name, value),
    onSuccess: async () => {
      setValue("");
      setNote({ ok: true, text: "已保存，下一轮就用新密钥" });
      await refresh();
    },
    onError: (e) => setNote({ ok: false, text: e.message }),
  });
  const clear = useMutation({
    mutationFn: () => api.clearKey(profile.name),
    onSuccess: async () => {
      setNote({ ok: true, text: "已清除" });
      await refresh();
    },
    onError: (e) => setNote({ ok: false, text: e.message }),
  });

  const status =
    profile.keySource === "config"
      ? "已保存在 config.json"
      : profile.keySource === "env"
        ? `来自环境变量 ${profile.apiKeyEnv ?? ""}`
        : profile.keyStatus === "notNeeded"
          ? "本地模型，一般不需要"
          : "还没有";

  return (
    <form
      className={styles.keyForm}
      onSubmit={(e) => {
        e.preventDefault();
        setNote(null);
        if (value.trim() !== "") save.mutate();
      }}
    >
      <label>
        <span>密钥：{status}</span>
        <input
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={profile.keyStatus === "configured" ? "填新的会替换现在的" : "粘贴密钥"}
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      <div className={styles.actions}>
        <Button type="submit" primary disabled={save.isPending || value.trim() === ""}>
          {save.isPending ? "保存中…" : "保存密钥"}
        </Button>
        {profile.keySource === "config" && (
          <Button onClick={() => setClearing(true)} disabled={clear.isPending}>
            清除密钥
          </Button>
        )}
      </div>
      {note && (
        <p className={note.ok ? styles.ok : styles.error} role="status">
          {note.text}
        </p>
      )}
      {clearing && (
        <Dialog
          title="清除密钥"
          tone="danger"
          onClose={() => setClearing(false)}
          actions={
            <>
              <Button
                primary
                onClick={() => {
                  setClearing(false);
                  clear.mutate();
                }}
              >
                清除
              </Button>
              <Button onClick={() => setClearing(false)}>取消</Button>
            </>
          }
        >
          <p>会从 config.json 删掉「{profile.name}」的密钥，之后要重新填才能用这个方案。</p>
        </Dialog>
      )}
    </form>
  );
}

function AddProfile({ onDone }: { readonly onDone: () => void }) {
  const refresh = useRefreshConfig();
  const [name, setName] = useState("");
  const [type, setType] = useState<PublicProfile["type"]>("openai");
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [contextWindow, setContextWindow] = useState("128000");
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    // 密钥从输入框读，不进 mutation 参数
    mutationFn: async (profile: NewProfile) => {
      await api.createProfile(profile);
      if (key.trim() !== "") await api.setKey(profile.name, key);
    },
    onSuccess: async () => {
      setKey("");
      await refresh();
      onDone();
    },
    onError: async (e) => {
      setError(e.message);
      await refresh();
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const size = Number(contextWindow);
    if (!Number.isInteger(size)) {
      setError("上下文窗口要填整数");
      return;
    }
    create.mutate({
      name: name.trim(),
      type,
      model: model.trim(),
      contextWindow: size,
      ...(baseUrl.trim() !== "" ? { baseUrl: baseUrl.trim() } : {}),
    });
  };

  return (
    <Panel as="div" title="添加方案" line="var(--cp-cyan)">
      <form className={styles.form} onSubmit={submit}>
        <label>
          <span>名字（字母、数字、点、下划线、短横线）</span>
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label>
          <span>类型</span>
          <select value={type} onChange={(e) => setType(e.target.value as PublicProfile["type"])}>
            {Object.entries(TYPE_LABELS).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>模型</span>
          <input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="例如 deepseek-chat"
            required
          />
        </label>
        <label>
          <span>地址（baseUrl）</span>
          <input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="中转站填它给的地址，通常以 /v1 结尾"
          />
        </label>
        <label>
          <span>上下文窗口 tokens</span>
          <input
            value={contextWindow}
            onChange={(e) => setContextWindow(e.target.value)}
            inputMode="numeric"
            required
          />
        </label>
        <label>
          <span>密钥（可以之后再填）</span>
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        {error && <p className={styles.error}>{error}</p>}
        <div className={styles.actions}>
          <Button type="submit" primary disabled={create.isPending}>
            {create.isPending ? "添加中…" : "添加"}
          </Button>
          <Button onClick={onDone}>取消</Button>
        </div>
      </form>
    </Panel>
  );
}

function numberOrUndefined(text: string): number | undefined {
  if (text.trim() === "") return undefined;
  const n = Number(text);
  return Number.isFinite(n) ? n : Number.NaN;
}

function ProfileForm({
  profile,
  onSaved,
}: {
  readonly profile: PublicProfile;
  readonly onSaved: () => void;
}) {
  const client = useQueryClient();
  const [baseUrl, setBaseUrl] = useState(profile.baseUrl ?? "");
  const [model, setModel] = useState(profile.model);
  const [temperature, setTemperature] = useState(profile.temperature?.toString() ?? "");
  const [maxOutput, setMaxOutput] = useState(profile.maxOutputTokens?.toString() ?? "");
  const [contextWindow, setContextWindow] = useState(profile.contextWindow.toString());
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (patch: ProfilePatch) => api.updateProfile(profile.name, patch),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["profiles"] });
      await client.invalidateQueries({ queryKey: ["health"] });
      onSaved();
    },
    onError: (e) => setError(e.message),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const patch: ProfilePatch = {};
    if (baseUrl.trim() !== (profile.baseUrl ?? "") && baseUrl.trim() !== "")
      patch.baseUrl = baseUrl.trim();
    if (model.trim() !== profile.model) patch.model = model.trim();
    const t = numberOrUndefined(temperature);
    const m = numberOrUndefined(maxOutput);
    const c = numberOrUndefined(contextWindow);
    if ([t, m, c].some((n) => Number.isNaN(n))) {
      setError("数字格式不对");
      return;
    }
    if (t !== undefined && t !== profile.temperature) patch.temperature = t;
    if (m !== undefined && m !== profile.maxOutputTokens) patch.maxOutputTokens = m;
    if (c !== undefined && c !== profile.contextWindow) patch.contextWindow = c;
    if (Object.keys(patch).length === 0) {
      onSaved();
      return;
    }
    save.mutate(patch);
  };

  return (
    <form className={styles.form} onSubmit={submit}>
      <label>
        <span>模型</span>
        <input value={model} onChange={(e) => setModel(e.target.value)} required />
      </label>
      <label>
        <span>地址（baseUrl）</span>
        <input
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="留空用默认地址"
        />
      </label>
      <label>
        <span>温度</span>
        <input
          value={temperature}
          onChange={(e) => setTemperature(e.target.value)}
          inputMode="decimal"
        />
      </label>
      <label>
        <span>最多输出 tokens</span>
        <input
          value={maxOutput}
          onChange={(e) => setMaxOutput(e.target.value)}
          inputMode="numeric"
        />
      </label>
      <label>
        <span>上下文窗口 tokens</span>
        <input
          value={contextWindow}
          onChange={(e) => setContextWindow(e.target.value)}
          inputMode="numeric"
          required
        />
      </label>
      {error && <p className={styles.error}>{error}</p>}
      <div className={styles.actions}>
        <Button type="submit" primary disabled={save.isPending}>
          {save.isPending ? "保存中…" : "保存到 config.json"}
        </Button>
      </div>
    </form>
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
