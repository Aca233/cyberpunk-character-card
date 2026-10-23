import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { api, type ConnectionTest, type ProfilePatch, type PublicProfile } from "../../api/client";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import styles from "./model-settings.module.css";

type Preset = "relay" | "openai" | "ollama";
const PRESETS: Record<
  Preset,
  {
    title: string;
    hint: string;
    type: PublicProfile["type"];
    baseUrl: string;
  }
> = {
  relay: {
    title: "中转站 / OpenAI 兼容",
    hint: "模型名和接口地址照服务商提供的填写。",
    type: "openai",
    baseUrl: "",
  },
  openai: {
    title: "OpenAI 官方",
    hint: "使用 OpenAI 官方账户的模型与密钥。",
    type: "openai",
    baseUrl: "https://api.openai.com/v1",
  },
  ollama: {
    title: "Ollama 本地",
    hint: "先启动 Ollama，填写已经下载的模型名。",
    type: "ollama",
    baseUrl: "",
  },
};

function problems(profile: PublicProfile | undefined): string[] {
  if (!profile) return ["还没有选择模型连接"];
  const out: string[] = [];
  if (profile.type === "gemini" || profile.type === "anthropic")
    out.push(`${profile.type} 原生接口暂未实现，请另建 OpenAI 兼容连接`);
  if (profile.keyStatus === "missing") out.push("还没有填写 API 密钥");
  return out;
}

function useRefresh() {
  const client = useQueryClient();
  return async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ["profiles"] }),
      client.invalidateQueries({ queryKey: ["health"] }),
    ]);
  };
}

export function ModelSettings({
  onDirtyChange,
}: {
  readonly onDirtyChange: (dirty: boolean) => void;
}) {
  const [params, setParams] = useSearchParams();
  const overview = useQuery({ queryKey: ["profiles"], queryFn: api.profiles });
  const refresh = useRefresh();
  const [dirty, setDirty] = useState(false);
  const [leaving, setLeaving] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const assign = useMutation({
    mutationFn: api.setRoles,
    onSuccess: async () => {
      setNotice("使用方案已更新。没有发送模型请求，后续回合使用新选择。");
      await refresh();
    },
  });
  const init = useMutation({ mutationFn: api.initConfig, onSuccess: refresh });

  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);
  const select = (id: string) => {
    setDirty(false);
    setParams((p) => {
      const next = new URLSearchParams(p);
      next.set("profile", id);
      return next;
    });
  };
  const requestSelect = (id: string) => {
    if (dirty) setLeaving(id);
    else select(id);
  };

  if (overview.isPending) return <p role="status">正在读取模型连接…</p>;
  if (overview.isError)
    return (
      <div className={styles.notice} role="alert">
        <h2>没有读到配置</h2>
        <p>{overview.error.message}</p>
        <Button onClick={() => void overview.refetch()}>重试</Button>
      </div>
    );

  const data = overview.data;
  if (data.status === "missing")
    return (
      <section className={styles.root}>
        <div className={styles.intro}>
          <span className={styles.kicker}>MODEL CONNECTION</span>
          <h2>先连接一个模型，再进夜之城。</h2>
          <p>第一步创建本机配置；接着填写接口地址、模型名和密钥。</p>
          <Button primary disabled={init.isPending} onClick={() => init.mutate()}>
            {init.isPending ? "创建中…" : "创建本机配置"}
          </Button>
          {init.isError && (
            <p className={styles.error} role="alert">
              {init.error.message}
            </p>
          )}
          <p className={styles.help}>只创建本地文件，不发送模型请求。</p>
        </div>
      </section>
    );
  if (data.status === "invalid")
    return (
      <section className={styles.notice} role="alert">
        <h2>配置文件有错误，暂时不能安全修改</h2>
        <p>不会覆盖现有文件或密钥。请按下面的具体错误修正 config.json。</p>
        <ul>
          {data.errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
        <Button onClick={() => void overview.refetch()}>修好后重新读取</Button>
      </section>
    );

  const gm = data.profiles.find((p) => p.name === data.gm);
  const aux = data.profiles.find((p) => p.name === data.aux);
  const gmProblems = problems(gm);
  const auxProblems = problems(aux);
  const ready = gmProblems.length === 0 && auxProblems.length === 0;
  const candidate = data.profiles.find((p) => problems(p).length === 0);
  const requested = params.get("profile");
  const adding = requested === "@new" || data.profiles.length === 0;
  const selected = data.profiles.find((p) => p.name === requested) ?? gm ?? data.profiles[0];

  return (
    <div className={styles.root}>
      <header className={styles.intro}>
        <span className={styles.kicker}>MODEL CONNECTION</span>
        <h2>连接模型，开始角色扮演。</h2>
        <p>选连接 → 填写并保存 → 设为游戏使用。通常一个连接就够了。</p>
      </header>

      <section
        className={styles.readiness}
        data-ready={ready || undefined}
        aria-label="当前配置状态"
      >
        <div>
          <span className={styles.kicker}>{ready ? "配置已就绪" : "还差一步"}</span>
          <h3>{ready ? "模型已选好，连接尚需实际验证。" : "当前选择还不能开始剧情。"}</h3>
          <p>
            角色模型：<strong>{data.gm ?? "未选择"}</strong> · 辅助模型：
            <strong>{data.aux ?? "未选择"}</strong>
          </p>
          {!ready && (
            <ul>
              {gmProblems.map((p) => (
                <li key={`gm-${p}`}>角色模型：{p}</li>
              ))}
              {auxProblems.map((p) => (
                <li key={`aux-${p}`}>辅助模型：{p}</li>
              ))}
            </ul>
          )}
          <p className={styles.help}>这里只检查配置。已填密钥不等于服务商已经连接成功。</p>
        </div>
        {!ready && candidate && (
          <div className={styles.fix}>
            <p>「{candidate.name}」已填写所需配置，可同时用于角色和辅助。</p>
            <Button
              primary
              disabled={assign.isPending || dirty}
              reason={dirty ? "先保存或撤销正在编辑的内容" : "正在更新"}
              onClick={() => assign.mutate({ gm: candidate.name, aux: candidate.name })}
            >
              {assign.isPending ? "切换中…" : `角色和辅助都改用「${candidate.name}」`}
            </Button>
          </div>
        )}
      </section>
      {notice && (
        <p className={styles.success} role="status">
          {notice}
        </p>
      )}
      {assign.isError && (
        <p className={styles.error} role="alert">
          {assign.error.message}
        </p>
      )}

      <div className={styles.workspace}>
        <aside className={styles.sidebar} aria-label="模型连接列表">
          <div className={styles.listHead}>
            <h3>我的连接</h3>
            <Button onClick={() => requestSelect("@new")}>添加连接</Button>
          </div>
          <ul className={styles.list}>
            {data.profiles.map((profile) => {
              const issues = problems(profile);
              return (
                <li key={profile.name}>
                  <button
                    type="button"
                    className={styles.connection}
                    aria-pressed={!adding && selected?.name === profile.name}
                    onClick={() => {
                      if (!adding && selected?.name === profile.name) return;
                      requestSelect(profile.name);
                    }}
                  >
                    <strong>{profile.name}</strong>
                    <span className={styles.modelName}>{profile.model}</span>
                    <span className={styles.status} data-ready={issues.length === 0 || undefined}>
                      {issues.length ? "需要处理" : "配置齐全 · 未验证"}
                    </span>
                    <span className={styles.roles}>
                      {data.gm === profile.name ? "角色模型 " : ""}
                      {data.aux === profile.name ? "辅助模型" : ""}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className={styles.help}>修改连接不会自动改变游戏使用的模型。</p>
        </aside>

        <section className={styles.editor} aria-label="编辑模型连接">
          {adding ? (
            <ConnectionForm
              key="new"
              names={data.profiles.map((p) => p.name)}
              onDirty={setDirty}
              onSaved={(name) => {
                setNotice(`「${name}」已保存。接下来点击“角色和辅助都用这个”。`);
                select(name);
              }}
            />
          ) : selected ? (
            <div key={selected.name}>
              <ConnectionForm
                profile={selected}
                names={data.profiles.map((p) => p.name)}
                onDirty={setDirty}
                onSaved={() => {
                  setDirty(false);
                  setNotice("连接设置已保存。未发送模型请求。");
                }}
              />
              <section className={styles.usage}>
                <span className={styles.kicker}>02 / 用于游戏</span>
                <h3>保存之后，明确选它来玩。</h3>
                <p>角色模型扮演 NPC、推进剧情；辅助模型处理格式修复等后台工作。</p>
                <div className={styles.actions}>
                  <Button
                    primary
                    disabled={
                      dirty ||
                      assign.isPending ||
                      problems(selected).length > 0 ||
                      (data.gm === selected.name && data.aux === selected.name)
                    }
                    reason={
                      dirty ? "请先保存连接" : problems(selected).join("；") || "角色和辅助已经在用"
                    }
                    onClick={() => assign.mutate({ gm: selected.name, aux: selected.name })}
                  >
                    {data.gm === selected.name && data.aux === selected.name
                      ? "角色和辅助正在使用"
                      : "角色和辅助都用这个"}
                  </Button>
                </div>
                <details className={styles.advanced}>
                  <summary>想分别使用两个模型？</summary>
                  <div className={styles.actions}>
                    <Button
                      disabled={
                        dirty ||
                        assign.isPending ||
                        problems(selected).length > 0 ||
                        data.gm === selected.name
                      }
                      onClick={() => assign.mutate({ gm: selected.name })}
                    >
                      只设为角色模型
                    </Button>
                    <Button
                      disabled={
                        dirty ||
                        assign.isPending ||
                        problems(selected).length > 0 ||
                        data.aux === selected.name
                      }
                      onClick={() => assign.mutate({ aux: selected.name })}
                    >
                      只设为辅助模型
                    </Button>
                  </div>
                </details>
              </section>
              <ConnectionActions
                configVersion={overview.dataUpdatedAt}
                profile={selected}
                dirty={dirty}
                inUse={data.gm === selected.name || data.aux === selected.name}
                onDeleted={() => select("@new")}
              />
            </div>
          ) : null}
        </section>
      </div>
      <p className={styles.privacy}>
        密钥只发送到本机后端，保存在已忽略的 config.json 中；
        保存后不会从接口返回。不要将配置文件分享或提交到 Git。
      </p>
      {leaving !== null && (
        <Dialog
          title="切换前要放弃未保存内容吗？"
          onClose={() => setLeaving(null)}
          actions={
            <>
              <Button primary onClick={() => setLeaving(null)}>
                继续编辑
              </Button>
              <Button
                onClick={() => {
                  select(leaving);
                  setLeaving(null);
                }}
              >
                放弃未保存内容
              </Button>
            </>
          }
        >
          <p>当前输入的内容还没有全部保存。已成功写入的步骤不会撤回。</p>
        </Dialog>
      )}
    </div>
  );
}

function ConnectionForm({
  profile,
  names,
  onDirty,
  onSaved,
}: {
  readonly profile?: PublicProfile;
  readonly names: readonly string[];
  readonly onDirty: (dirty: boolean) => void;
  readonly onSaved: (name: string) => void;
}) {
  const refresh = useRefresh();
  const firstName = () => {
    let n = 1;
    while (names.includes(`connection-${n}`)) n += 1;
    return `connection-${n}`;
  };
  const [preset, setPreset] = useState<Preset>("relay");
  const [name, setName] = useState(profile?.name ?? firstName);
  const [model, setModel] = useState(profile?.model ?? "");
  const [baseUrl, setBaseUrl] = useState(profile?.baseUrl ?? "");
  const [key, setKey] = useState("");
  const [contextWindow, setContextWindow] = useState(String(profile?.contextWindow ?? 128000));
  const [temperature, setTemperature] = useState(profile?.temperature?.toString() ?? "");
  const [maxOutput, setMaxOutput] = useState(profile?.maxOutputTokens?.toString() ?? "");
  const [stage, setStage] = useState("");
  const [saved, setSaved] = useState("");
  // 创建成功后保留名字；后续步骤失败时重试更新，不重复创建。
  const persisted = useRef<string | null>(profile?.name ?? null);
  const edited = !profile
    ? Boolean(model || baseUrl || key)
    : model !== profile.model ||
      baseUrl !== (profile.baseUrl ?? "") ||
      contextWindow !== String(profile.contextWindow) ||
      temperature !== (profile.temperature?.toString() ?? "") ||
      maxOutput !== (profile.maxOutputTokens?.toString() ?? "") ||
      key !== "";

  const save = useMutation({
    gcTime: 0,
    retry: false,
    // 不传含密钥的 mutation variables，也不返回密钥。
    mutationFn: async () => {
      setSaved("");
      const modelName = model.trim();
      const connectionName = (persisted.current ?? name).trim();
      if (!/^[a-zA-Z0-9._-]+$/.test(connectionName))
        throw new Error("连接名只能包含字母、数字、点、下划线和短横线。");
      if (!modelName) throw new Error("请填写服务商提供的模型名。");
      const size = Number(contextWindow);
      if (!Number.isSafeInteger(size) || size < 1) throw new Error("上下文长度要填正整数。");

      const url = baseUrl.trim();
      if (url) {
        let parsed: URL;
        try {
          parsed = new URL(url);
        } catch {
          throw new Error("接口地址不是有效的网址。");
        }
        if (
          !["http:", "https:"].includes(parsed.protocol) ||
          parsed.username ||
          parsed.password ||
          parsed.search ||
          parsed.hash
        )
          throw new Error(
            "接口地址只能使用 HTTP/HTTPS，不能带用户名、密码、查询参数或片段。密钥填在单独的密钥栏。",
          );
      }
      if (!profile && preset === "relay" && !url)
        throw new Error("请填写中转站提供的接口地址，例如其 /v1 地址。");
      if (profile?.baseUrl && !url)
        throw new Error("当前接口暂不支持清空已保存的地址，请填写要使用的地址。");
      const patch: ProfilePatch = { model: modelName, contextWindow: size };
      if (url) patch.baseUrl = url;
      if (temperature.trim()) {
        const value = Number(temperature);
        if (!Number.isFinite(value) || value < 0 || value > 2)
          throw new Error("温度要填写 0 到 2 之间的数字。");
        patch.temperature = value;
      } else if (profile?.temperature !== undefined) {
        throw new Error("当前接口不支持通过留空删除温度，请填写一个值或撤销修改。");
      }
      if (maxOutput.trim()) {
        const value = Number(maxOutput);
        if (!Number.isSafeInteger(value) || value < 1) throw new Error("最大输出长度要填正整数。");
        patch.maxOutputTokens = value;
      } else if (profile?.maxOutputTokens !== undefined) {
        throw new Error("当前接口不支持通过留空删除输出限制，请填写一个值或撤销修改。");
      }

      if (!persisted.current) {
        setStage("正在创建连接…");
        await api.createProfile({
          name: connectionName,
          type: PRESETS[preset].type,
          model: modelName,
          contextWindow: size,
          ...(url ? { baseUrl: url } : {}),
        });
        persisted.current = connectionName;
      }
      setStage("正在保存连接参数…");
      await api.updateProfile(connectionName, patch);
      if (key.trim()) {
        setStage("参数已保存，正在保存密钥…");
        await api.setKey(connectionName, key.trim());
        setKey("");
      }
      return connectionName;
    },
    onSuccess: async (connectionName) => {
      setStage("");
      setSaved("已保存。下一步：设为游戏使用的模型。");
      await refresh();
      onDirty(false);
      onSaved(connectionName);
    },
    onError: async () => {
      // 已完成的步骤不回滚；错误在原表单中展示，可重试。
      await refresh();
    },
  });

  useEffect(() => onDirty(edited || save.isPending), [edited, save.isPending, onDirty]);
  const reset = () => {
    setModel(profile?.model ?? "");
    setBaseUrl(profile?.baseUrl ?? "");
    setContextWindow(String(profile?.contextWindow ?? 128000));
    setTemperature(profile?.temperature?.toString() ?? "");
    setMaxOutput(profile?.maxOutputTokens?.toString() ?? "");
    setKey("");
    setSaved("");
    setStage("");
    save.reset();
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!save.isPending) save.mutate();
  };

  return (
    <form className={styles.form} onSubmit={submit}>
      <span className={styles.kicker}>01 / 连接资料</span>
      <h3>{profile ? profile.name : "添加一个模型连接"}</h3>
      {profile && problems(profile).length > 0 && (
        <div className={styles.notice}>
          {problems(profile).map((p) => (
            <p key={p}>{p}</p>
          ))}
        </div>
      )}
      <fieldset disabled={save.isPending}>
        {!profile && (
          <label className={styles.field}>
            <span>接入方式</span>
            <select
              value={preset}
              disabled={persisted.current !== null}
              onChange={(event) => {
                const next = event.target.value as Preset;
                setPreset(next);
                setBaseUrl(PRESETS[next].baseUrl);
              }}
            >
              {Object.entries(PRESETS).map(([id, value]) => (
                <option key={id} value={id}>
                  {value.title}
                </option>
              ))}
            </select>
            <small>{PRESETS[preset].hint}</small>
          </label>
        )}
        {profile && (
          <p className={styles.help}>接口类型：{profile.type}。如需更换类型，请新建连接。</p>
        )}
        {!profile && (
          <label className={styles.field}>
            <span>连接名称</span>
            <input
              required
              value={name}
              disabled={persisted.current !== null}
              onChange={(e) => setName(e.target.value)}
            />
            <small>只是本机区分连接的名字，不是模型名。</small>
          </label>
        )}
        <label className={styles.field}>
          <span>接口地址</span>
          <input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            spellCheck={false}
            placeholder="例如 https://服务商地址/v1"
          />
          <small>
            OpenAI 兼容通常填 /v1 根地址，不要填写 /chat/completions；本地模型可留空用默认地址。
          </small>
        </label>
        <label className={styles.field}>
          <span>模型名</span>
          <input
            required
            value={model}
            onChange={(e) => setModel(e.target.value)}
            spellCheck={false}
            placeholder="填写服务商提供的完整模型 ID"
          />
        </label>
        <label className={styles.field}>
          <span>API 密钥{profile?.keyStatus === "configured" ? " · 已保存" : ""}</span>
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={
              profile?.keyStatus === "configured"
                ? "留空保留现有密钥；填新密钥则替换"
                : "在这里粘贴密钥，保存后不会回显"
            }
          />
          <small>
            {profile?.keySource === "env"
              ? `当前使用环境变量 ${profile.apiKeyEnv ?? ""}。这里填写会保存一个本机配置密钥。`
              : profile?.type === "ollama" || (!profile && preset === "ollama")
                ? "本地 Ollama 通常不需要密钥。"
                : "没有密钥也可以先保存连接，但不能用于剧情。"}
          </small>
        </label>
        <details className={styles.advanced}>
          <summary>高级参数 · 不确定时先保持原值</summary>
          <label className={styles.field}>
            <span>上下文长度（tokens）</span>
            <input
              required
              inputMode="numeric"
              value={contextWindow}
              onChange={(e) => setContextWindow(e.target.value)}
            />
            <small>按服务商文档填写；这不是单次回复的字数。</small>
          </label>
          <label className={styles.field}>
            <span>温度（0–2，可不设置）</span>
            <input
              inputMode="decimal"
              value={temperature}
              onChange={(e) => setTemperature(e.target.value)}
            />
          </label>
          <label className={styles.field}>
            <span>最大输出长度（tokens，可不设置）</span>
            <input
              inputMode="numeric"
              value={maxOutput}
              onChange={(e) => setMaxOutput(e.target.value)}
            />
          </label>
        </details>
        <div className={styles.actions}>
          <Button primary type="submit" disabled={save.isPending || (Boolean(profile) && !edited)}>
            {save.isPending ? "保存中…" : profile ? "保存连接" : "保存连接，继续"}
          </Button>
          {profile && (
            <Button disabled={save.isPending || !edited} onClick={reset}>
              撤销未保存修改
            </Button>
          )}
        </div>
      </fieldset>
      {save.isPending && <p role="status">{stage}</p>}
      {save.isError && (
        <div className={styles.error} role="alert">
          <p>{save.error.message}</p>
          {stage && <p>{stage} 此步骤未完成；之前成功的步骤已保留，修正后可以重试。</p>}
        </div>
      )}
      {saved && (
        <p className={styles.success} role="status">
          {saved}
        </p>
      )}
      <p className={styles.help}>保存只写入本机配置，不会发送模型请求或自动切换游戏使用的模型。</p>
    </form>
  );
}

function ConnectionActions({
  configVersion,
  profile,
  inUse,
  dirty,
  onDeleted,
}: {
  readonly configVersion: number;
  readonly profile: PublicProfile;
  readonly inUse: boolean;
  readonly dirty: boolean;
  readonly onDeleted: () => void;
}) {
  const refresh = useRefresh();
  const [dialog, setDialog] = useState<"test" | "delete" | "key" | null>(null);
  const [result, setResult] = useState<ConnectionTest | null>(null);
  const test = useMutation({
    mutationFn: () => api.testProfile(profile.name),
    onSuccess: setResult,
    onError: (error) => setResult({ ok: false, error: error.message }),
  });
  const remove = useMutation({
    mutationFn: () => api.deleteProfile(profile.name),
    onSuccess: async () => {
      await refresh();
      onDeleted();
    },
  });
  const clear = useMutation({ mutationFn: () => api.clearKey(profile.name), onSuccess: refresh });
  const busy = test.isPending || remove.isPending || clear.isPending;
  // 配置刷新后使旧测试结果失效，包括替换密钥但公开状态未变化的情况。
  const previousConfigVersion = useRef(configVersion);
  useEffect(() => {
    if (previousConfigVersion.current !== configVersion) {
      previousConfigVersion.current = configVersion;
      setResult(null);
    }
  }, [configVersion]);
  return (
    <section className={styles.usage}>
      <span className={styles.kicker}>03 / 可选验证</span>
      <h3>测试连接会发出真实请求。</h3>
      <p>不是保存设置的必选步骤。点击后还会确认一次费用。</p>
      <Button
        disabled={busy || dirty || problems(profile).length > 0}
        reason={dirty ? "先保存或撤销修改" : problems(profile).join("；")}
        onClick={() => setDialog("test")}
      >
        {test.isPending ? "正在测试…" : "测试连接…"}
      </Button>
      {result && (
        <p role="status" className={result.ok ? styles.success : styles.error}>
          {result.ok
            ? `本次连接成功 · ${result.model} · ${result.ms} ms`
            : `连接失败：${result.error}`}
        </p>
      )}
      <details className={styles.advanced}>
        <summary>连接管理：删除或清除密钥</summary>
        <div className={styles.actions}>
          {profile.keySource === "config" && (
            <Button disabled={busy || dirty} onClick={() => setDialog("key")}>
              清除已保存密钥
            </Button>
          )}
          <Button
            disabled={busy || dirty || inUse}
            reason={inUse ? "先将角色和辅助模型改用其他连接" : "先保存或撤销修改"}
            onClick={() => setDialog("delete")}
          >
            删除连接
          </Button>
        </div>
        {inUse && (
          <p className={styles.help}>这个连接正在使用，不能删除。先将角色和辅助改用其他连接。</p>
        )}
      </details>
      {remove.isError && (
        <p className={styles.error} role="alert">
          {remove.error.message}
        </p>
      )}
      {clear.isError && (
        <p className={styles.error} role="alert">
          {clear.error.message}
        </p>
      )}
      {dialog && (
        <Dialog
          title={
            dialog === "test"
              ? "确认发送付费测试请求？"
              : dialog === "delete"
                ? "删除这个连接？"
                : "清除本机保存的密钥？"
          }
          tone={dialog === "test" ? "info" : "danger"}
          onClose={() => setDialog(null)}
          actions={
            <>
              <Button onClick={() => setDialog(null)}>取消</Button>
              <Button
                primary
                onClick={() => {
                  const action = dialog;
                  setDialog(null);
                  if (action === "test") {
                    setResult(null);
                    test.mutate();
                  } else if (action === "delete") remove.mutate();
                  else clear.mutate();
                }}
              >
                {dialog === "test" ? "确认发送，可能产生费用" : "确认"}
              </Button>
            </>
          }
        >
          <p>
            {dialog === "test"
              ? `向「${profile.name}」的 ${profile.model} 发送一条短请求，可能按服务商价格计费。`
              : dialog === "delete"
                ? `删除「${profile.name}」及其本机密钥，之后需要重新添加。`
                : "只删除 config.json 中的密钥。若配置了环境变量密钥，仍可能继续使用环境变量。"}
          </p>
        </Dialog>
      )}
    </section>
  );
}
