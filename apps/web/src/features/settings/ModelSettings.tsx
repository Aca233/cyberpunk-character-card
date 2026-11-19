import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { useLocation, useSearchParams } from "react-router";
import {
  api,
  type ConnectionTest,
  type ImageProtocol,
  type ProfilePatch,
  type PublicProfile,
} from "../../api/client";
import { Asset, cssUrl, NineSlice } from "../../ui/Asset";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { CellFrame, FrameBox } from "../../ui/FrameBox";
import { Panel } from "../../ui/Panel";
import styles from "./model-settings.module.css";
import shared from "./settings.module.css";

type Preset = "gemini" | "relay" | "openai" | "ollama" | "sdwebui" | "comfyui";
const PRESETS: Record<
  Preset,
  {
    title: string;
    hint: string;
    type: PublicProfile["type"];
    baseUrl: string;
  }
> = {
  gemini: {
    title: "Gemini 官方",
    hint: "Google AI Studio 密钥",
    type: "gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
  },
  relay: {
    title: "中转站 / OpenAI 兼容",
    hint: "照服务商文档填写",
    type: "openai",
    baseUrl: "",
  },
  openai: {
    title: "OpenAI 官方",
    hint: "OpenAI 官方密钥",
    type: "openai",
    baseUrl: "https://api.openai.com/v1",
  },
  ollama: {
    title: "Ollama 本地",
    hint: "需先启动 Ollama",
    type: "ollama",
    baseUrl: "",
  },
  sdwebui: {
    title: "SD WebUI 本地（文生图）",
    hint: "启动需带 --api --cors-allow-origins=*",
    type: "sdwebui",
    baseUrl: "http://127.0.0.1:7860",
  },
  comfyui: {
    title: "ComfyUI 本地（文生图）",
    hint: "启动需带 --enable-cors-header",
    type: "comfyui",
    baseUrl: "http://127.0.0.1:8188",
  },
};

const IMAGE_PROTOCOLS: readonly { readonly id: ImageProtocol; readonly label: string }[] = [
  { id: "auto", label: "自动识别（推荐）" },
  { id: "openai-images", label: "OpenAI Images (/images/generations)" },
  { id: "openai-chat", label: "OpenAI Chat 模态 (/chat/completions)" },
  { id: "gemini-native", label: "Gemini 原生图像 (generateContent)" },
  { id: "gemini-imagen", label: "Gemini Imagen (:predict)" },
  { id: "sdwebui", label: "Stable Diffusion WebUI (/sdapi/v1/txt2img)" },
  { id: "comfyui", label: "ComfyUI (/prompt)" },
];

function problems(profile: PublicProfile | undefined): string[] {
  if (!profile) return ["还没有选择模型连接"];
  const out: string[] = [];
  if (profile.type === "anthropic") out.push("anthropic 原生接口暂未实现，请另建 OpenAI 兼容连接");
  if (profile.keyStatus === "missing") out.push("还没有填写 API 密钥");
  return out;
}

function textRoleProblems(profile: PublicProfile | undefined): string[] {
  const out = problems(profile);
  if (profile && (profile.type === "sdwebui" || profile.type === "comfyui")) {
    out.push(`${profile.type} 仅用于文生图模型`);
  }
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
  const location = useLocation();
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
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        next.set("profile", id);
        next.delete("copy");
        return next;
      },
      { replace: true, state: location.state },
    );
  };
  const duplicate = (profile: PublicProfile) => {
    setDirty(false);
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        next.set("profile", "@new");
        next.set("copy", profile.name);
        return next;
      },
      { replace: true, state: location.state },
    );
  };
  const requestSelect = (id: string) => {
    if (dirty) setLeaving(id);
    else select(id);
  };

  if (overview.isPending)
    return (
      <Panel line="var(--cp-red-dim)" className={shared.gateCard}>
        <p role="status" className={styles.help}>
          正在读取模型连接…
        </p>
      </Panel>
    );
  if (overview.isError)
    return (
      <Panel line="var(--cp-danger)" className={shared.gateCard}>
        <div className={styles.notice} role="alert">
          <h2>没有读到配置</h2>
          <p>{overview.error.message}</p>
          <Button onClick={() => void overview.refetch()}>重试</Button>
        </div>
      </Panel>
    );

  const data = overview.data;
  if (data.status === "missing")
    return (
      <section className={styles.root}>
        <Panel line="var(--cp-yellow)" className={shared.gateCard}>
          <div className={styles.intro}>
            <span className={styles.kicker}>MODEL CONNECTION</span>
            <h2>先连接一个模型</h2>
            <Button primary disabled={init.isPending} onClick={() => init.mutate()}>
              {init.isPending ? "创建中…" : "初始化浏览器配置"}
            </Button>
            {init.isError && (
              <p className={styles.error} role="alert">
                {init.error.message}
              </p>
            )}
            <p className={styles.help}>仅存于浏览器本地存储，不发请求</p>
          </div>
        </Panel>
      </section>
    );
  if (data.status === "invalid")
    return (
      <Panel line="var(--cp-danger)" className={shared.gateCard}>
        <section className={styles.notice} role="alert">
          <h2>配置文件有错误，暂时不能安全修改</h2>
          <p>
            不会覆盖现有配置或密钥。配置保存在这个浏览器里，不能直接改文件；出现这个错误通常是版本不兼容，请带上下面的具体错误反馈。
          </p>
          <ul>
            {data.errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
          <Button onClick={() => void overview.refetch()}>修好后重新读取</Button>
        </section>
      </Panel>
    );

  const narrator = data.profiles.find((p) => p.name === data.narrator);
  const aux = data.profiles.find((p) => p.name === data.aux);
  const narratorProblems = textRoleProblems(narrator);
  const auxProblems = textRoleProblems(aux);
  const ready = narratorProblems.length === 0 && auxProblems.length === 0;
  const candidate = data.profiles.find((p) => textRoleProblems(p).length === 0);
  const requested = params.get("profile");
  const adding = requested === "@new" || data.profiles.length === 0;
  const copyFrom = adding
    ? data.profiles.find((profile) => profile.name === params.get("copy"))
    : undefined;
  const selected = data.profiles.find((p) => p.name === requested) ?? narrator ?? data.profiles[0];

  return (
    <div className={styles.root}>
      <section
        className={styles.readiness}
        data-ready={ready || undefined}
        aria-label="当前配置状态"
      >
        <NineSlice
          id="notify.itemCellBg"
          slice={30}
          tint="rgb(12 10 18 / 86%)"
          className={styles.slice}
        />
        <NineSlice
          id="notify.itemCellFg"
          slice={30}
          tint={ready ? "var(--cp-cyan)" : "var(--cp-yellow)"}
          className={styles.slice}
        />
        <Asset
          id="panel.glowLeft"
          height={34}
          tint={ready ? "var(--cp-cyan)" : "var(--cp-yellow)"}
          className={styles.readyGlow}
        />
        <div className={styles.readyMain}>
          <div className={styles.readyTop}>
            <span className={styles.statusBadge} data-ready={ready || undefined}>
              {ready ? "配置已就绪" : "还差一步"}
            </span>
            <strong className={styles.readyTitle}>
              {ready ? "模型已选好 · 仅检查配置，未发连通测试" : "当前选择还不能开始剧情"}
            </strong>
          </div>
          <div className={styles.readyMeta}>
            <span className={styles.rolePair}>
              叙事模型：
              <button
                type="button"
                className={styles.roleChip}
                disabled={!data.narrator}
                onClick={() => {
                  if (!data.narrator || (!adding && selected?.name === data.narrator)) return;
                  requestSelect(data.narrator);
                }}
              >
                {data.narrator ?? "未选择"}
              </button>
            </span>
            <span className={styles.rolePair}>
              辅助模型：
              <button
                type="button"
                className={styles.roleChip}
                disabled={!data.aux}
                onClick={() => {
                  if (!data.aux || (!adding && selected?.name === data.aux)) return;
                  requestSelect(data.aux);
                }}
              >
                {data.aux ?? "未选择"}
              </button>
            </span>
            <span className={styles.rolePair}>
              文生图模型：
              <button
                type="button"
                className={styles.roleChip}
                disabled={!data.image}
                onClick={() => {
                  if (!data.image || (!adding && selected?.name === data.image)) return;
                  requestSelect(data.image);
                }}
              >
                {data.image ?? "未选择（可选）"}
              </button>
            </span>
            {!ready && (
              <span className={styles.readyErrors}>
                {[
                  ...narratorProblems.map((p) => `叙事：${p}`),
                  ...auxProblems.map((p) => `辅助：${p}`),
                ].join(" · ")}
              </span>
            )}
          </div>
        </div>
        {!ready && candidate && (
          <div className={styles.fix}>
            <Button
              primary
              disabled={assign.isPending || dirty}
              reason={dirty ? "先保存或撤销正在编辑的内容" : "正在更新"}
              onClick={() => assign.mutate({ narrator: candidate.name, aux: candidate.name })}
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
          <NineSlice
            id="notify.itemCellBg"
            slice={30}
            tint="rgb(12 10 18 / 84%)"
            className={styles.slice}
          />
          <NineSlice
            id="notify.itemCellFg"
            slice={30}
            tint="var(--cp-red-dim)"
            className={styles.slice}
          />
          <div className={styles.listHead}>
            <h3>我的连接</h3>
            <Button
              small
              onClick={() => {
                if (!adding) requestSelect("@new");
              }}
            >
              添加连接
            </Button>
          </div>
          <div className={styles.listScroll}>
            <ul className={styles.list}>
              {data.profiles.map((profile) => {
                const issues = problems(profile);
                const isNarrator = data.narrator === profile.name;
                const isAux = data.aux === profile.name;
                const isImage = data.image === profile.name;
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
                      <CellFrame />
                      <div className={styles.connTop}>
                        <strong>{profile.name}</strong>
                        <span
                          className={styles.statusDot}
                          data-ready={issues.length === 0 || undefined}
                        >
                          {issues.length ? "待处理" : "已配"}
                        </span>
                      </div>
                      <span className={styles.modelName}>{profile.model || "未填模型名"}</span>
                      {(isNarrator || isAux || isImage) && (
                        <div className={styles.roles}>
                          {isNarrator && (
                            <span className={styles.rolePill} data-role="narrator">
                              叙事模型
                            </span>
                          )}
                          {isAux && <span className={styles.rolePill}>辅助模型</span>}
                          {isImage && (
                            <span className={styles.rolePill} data-role="image">
                              文生图
                            </span>
                          )}
                        </div>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </aside>

        <section className={styles.editor} aria-label="编辑模型连接">
          <NineSlice
            id="notify.itemCellBg"
            slice={30}
            tint="rgb(12 10 18 / 84%)"
            className={styles.slice}
          />
          <NineSlice
            id="notify.itemCellFg"
            slice={30}
            tint="var(--cp-red-dim)"
            className={styles.slice}
          />
          {adding ? (
            <ConnectionForm
              key={`new-${copyFrom?.name ?? ""}`}
              {...(copyFrom ? { copyFrom } : {})}
              names={data.profiles.map((p) => p.name)}
              onDirty={setDirty}
              onSaved={(name) => {
                setNotice(`「${name}」已保存。接下来点「设为叙事模型」或「设为辅助模型」。`);
                select(name);
              }}
            />
          ) : selected ? (
            <div key={selected.name} className={styles.form}>
              <ConnectionForm
                profile={selected}
                names={data.profiles.map((p) => p.name)}
                onDirty={setDirty}
                onSaved={() => {
                  setDirty(false);
                  setNotice("连接设置已保存。未发送模型请求。");
                }}
              />
              <span
                className={shared.thinLine}
                style={{ maskImage: cssUrl("tab.line"), WebkitMaskImage: cssUrl("tab.line") }}
                aria-hidden
              />
              <section className={styles.usage}>
                <div className={styles.usageHead}>
                  <span className={styles.kicker}>02 / 用于游戏</span>
                  <h3>保存之后，明确选它来玩。</h3>
                </div>
                {/* 用户定的：只留「设为叙事模型」「设为辅助模型」两个按钮，不要合并按钮和折叠区 */}
                <div className={styles.actions}>
                  <Button
                    primary
                    disabled={
                      dirty ||
                      assign.isPending ||
                      textRoleProblems(selected).length > 0 ||
                      data.narrator === selected.name
                    }
                    reason={
                      dirty
                        ? "请先保存连接"
                        : textRoleProblems(selected).join("；") || "已经是叙事模型"
                    }
                    onClick={() => assign.mutate({ narrator: selected.name })}
                  >
                    {data.narrator === selected.name ? "叙事模型使用中" : "设为叙事模型"}
                  </Button>
                  <Button
                    primary
                    disabled={
                      dirty ||
                      assign.isPending ||
                      textRoleProblems(selected).length > 0 ||
                      data.aux === selected.name
                    }
                    reason={
                      dirty
                        ? "请先保存连接"
                        : textRoleProblems(selected).join("；") || "已经是辅助模型"
                    }
                    onClick={() => assign.mutate({ aux: selected.name })}
                  >
                    {data.aux === selected.name ? "辅助模型使用中" : "设为辅助模型"}
                  </Button>
                  <Button
                    primary
                    disabled={
                      dirty ||
                      assign.isPending ||
                      problems(selected).length > 0 ||
                      data.image === selected.name
                    }
                    reason={
                      dirty ? "请先保存连接" : problems(selected).join("；") || "已经是文生图模型"
                    }
                    onClick={() => assign.mutate({ image: selected.name })}
                  >
                    {data.image === selected.name ? "文生图模型使用中" : "设为文生图模型"}
                  </Button>
                </div>
              </section>
              <span
                className={shared.thinLine}
                style={{ maskImage: cssUrl("tab.line"), WebkitMaskImage: cssUrl("tab.line") }}
                aria-hidden
              />
              <ConnectionActions
                configVersion={overview.dataUpdatedAt}
                profile={selected}
                dirty={dirty}
                inUse={
                  data.narrator === selected.name ||
                  data.aux === selected.name ||
                  data.image === selected.name
                }
                onDuplicate={() => duplicate(selected)}
                onDeleted={() => select("@new")}
              />
            </div>
          ) : null}
        </section>
      </div>

      <p className={styles.privacy}>
        密钥只存在这个浏览器里（IndexedDB），由浏览器直接发给模型服务商，不经过本站服务器；公用电脑上用完请清除密钥。服务商需允许网页跨域访问（CORS），本地
        Ollama 要设置 OLLAMA_ORIGINS。
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
  copyFrom,
  names,
  onDirty,
  onSaved,
}: {
  readonly profile?: PublicProfile;
  readonly copyFrom?: PublicProfile;
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
  const copyName = (sourceName: string) => {
    const base = `${sourceName.slice(0, 35)}-copy`;
    if (!names.includes(base)) return base;
    let n = 2;
    for (;;) {
      const suffix = `-${n}`;
      const candidate = `${sourceName.slice(0, 40 - 5 - suffix.length)}-copy${suffix}`;
      if (!names.includes(candidate)) return candidate;
      n += 1;
    }
  };
  const source = profile ?? copyFrom;
  const [preset, setPreset] = useState<Preset>("relay");
  const [name, setName] = useState(
    copyFrom ? copyName(copyFrom.name) : (profile?.name ?? firstName),
  );
  const [model, setModel] = useState(source?.model ?? "");
  const [baseUrl, setBaseUrl] = useState(source?.baseUrl ?? "");
  const [key, setKey] = useState("");
  const [contextWindow, setContextWindow] = useState(String(source?.contextWindow ?? 128000));
  const [temperature, setTemperature] = useState(source?.temperature?.toString() ?? "");
  const [maxOutput, setMaxOutput] = useState(source?.maxOutputTokens?.toString() ?? "");
  const [imageProtocol, setImageProtocol] = useState<ImageProtocol>(
    source?.imageProtocol ?? "auto",
  );
  const [comfyWorkflow, setComfyWorkflow] = useState(source?.comfyWorkflow ?? "");
  const [stage, setStage] = useState("");
  const [saved, setSaved] = useState("");
  const [modelList, setModelList] = useState<readonly string[] | null>(null);
  const [modelFilter, setModelFilter] = useState("");
  const [modelError, setModelError] = useState("");
  // 创建成功后保留名字；后续步骤失败时重试更新，不重复创建。
  const persisted = useRef<string | null>(profile?.name ?? null);
  const currentType = profile?.type ?? copyFrom?.type ?? PRESETS[preset].type;
  const isLocalNoKey =
    currentType === "ollama" || currentType === "sdwebui" || currentType === "comfyui";
  const isComfy = currentType === "comfyui" || imageProtocol === "comfyui";
  const baseDefault = PRESETS[preset].baseUrl;
  const edited = !profile
    ? Boolean(
        model.trim() ||
          key ||
          (baseUrl.trim() !== "" && baseUrl !== baseDefault) ||
          imageProtocol !== "auto" ||
          comfyWorkflow.trim() !== "",
      )
    : model !== profile.model ||
      baseUrl !== (profile.baseUrl ?? "") ||
      contextWindow !== String(profile.contextWindow) ||
      temperature !== (profile.temperature?.toString() ?? "") ||
      maxOutput !== (profile.maxOutputTokens?.toString() ?? "") ||
      imageProtocol !== (profile.imageProtocol ?? "auto") ||
      comfyWorkflow !== (profile.comfyWorkflow ?? "") ||
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
      if (!profile && !copyFrom && preset === "relay" && !url)
        throw new Error("请填写中转站提供的接口地址，例如其 /v1 地址。");
      if (profile?.baseUrl && !url)
        throw new Error("当前接口暂不支持清空已保存的地址，请填写要使用的地址。");
      const patch: ProfilePatch = {
        model: modelName,
        contextWindow: size,
        imageProtocol,
      };
      if (comfyWorkflow.trim()) {
        patch.comfyWorkflow = comfyWorkflow.trim();
      }
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
          type: copyFrom?.type ?? PRESETS[preset].type,
          model: modelName,
          contextWindow: size,
          ...(url ? { baseUrl: url } : {}),
          ...(copyFrom?.temperature !== undefined ? { temperature: copyFrom.temperature } : {}),
          ...(copyFrom?.maxOutputTokens !== undefined
            ? { maxOutputTokens: copyFrom.maxOutputTokens }
            : {}),
          ...(copyFrom?.thinkingLevel !== undefined
            ? { thinkingLevel: copyFrom.thinkingLevel }
            : {}),
          ...(copyFrom?.safety !== undefined ? { safety: copyFrom.safety } : {}),
          ...(copyFrom?.embeddingModel !== undefined
            ? { embeddingModel: copyFrom.embeddingModel }
            : {}),
          ...(copyFrom?.imageProtocol !== undefined
            ? { imageProtocol: copyFrom.imageProtocol }
            : {}),
          ...(copyFrom?.comfyWorkflow !== undefined
            ? { comfyWorkflow: copyFrom.comfyWorkflow }
            : {}),
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
  useEffect(() => () => onDirty(false), [onDirty]);
  useEffect(() => {
    void preset;
    setModelList(null);
    setModelError("");
    setModelFilter("");
  }, [preset]);

  const fetchModels = useMutation({
    gcTime: 0,
    retry: false,
    // 不把密钥放进 mutation variables，避免留在 React Query 内存状态里
    mutationFn: async () => {
      const trimmedBase = baseUrl.trim();
      const profileName = persisted.current;
      const type = profile?.type ?? copyFrom?.type ?? PRESETS[preset].type;
      return api.fetchModels({
        ...(profileName ? { profileName } : {}),
        type,
        baseUrl: trimmedBase,
        ...(key.trim() ? { apiKey: key.trim() } : {}),
      });
    },
    onSuccess: (res) => {
      if (!res.ok) {
        setModelError(res.error);
        return;
      }
      setModelError("");
      setModelFilter("");
      setModelList(res.models);
    },
    onError: (err) => {
      setModelError(err instanceof Error ? err.message : String(err));
    },
  });

  const handleFetchModels = () => {
    const trimmedBase = baseUrl.trim();
    if (!profile && !copyFrom && preset === "relay" && !trimmedBase) {
      setModelError("请先填写兼容接口地址（例如 https://服务商地址/v1）再获取模型列表");
      return;
    }
    setModelError("");
    fetchModels.mutate();
  };

  const visibleModels = modelList
    ? modelList.filter((id) =>
        modelFilter.trim() === ""
          ? true
          : id.toLowerCase().includes(modelFilter.trim().toLowerCase()),
      )
    : [];

  const reset = () => {
    setModel(profile?.model ?? "");
    setBaseUrl(profile?.baseUrl ?? "");
    setContextWindow(String(profile?.contextWindow ?? 128000));
    setTemperature(profile?.temperature?.toString() ?? "");
    setMaxOutput(profile?.maxOutputTokens?.toString() ?? "");
    setImageProtocol(profile?.imageProtocol ?? "auto");
    setComfyWorkflow(profile?.comfyWorkflow ?? "");
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
    <form className={styles.form} autoComplete="off" onSubmit={submit}>
      <div className={styles.editorHead}>
        <div>
          <span className={styles.kicker}>01 / 连接资料</span>
          <h3>
            {profile ? profile.name : copyFrom ? `复制「${copyFrom.name}」` : "添加一个模型连接"}
          </h3>
        </div>
        {(profile ?? copyFrom) && (
          <span className={styles.typePill}>接口：{(profile ?? copyFrom)?.type}</span>
        )}
      </div>
      {copyFrom && (
        <div className={styles.notice}>
          <p>已复制连接参数，API 密钥需要重新填写。</p>
        </div>
      )}
      {profile && problems(profile).length > 0 && (
        <div className={styles.notice}>
          {problems(profile).map((p) => (
            <p key={p}>{p}</p>
          ))}
        </div>
      )}
      <fieldset disabled={save.isPending}>
        <div className={styles.formGrid}>
          {!profile && !copyFrom && (
            <label className={styles.field}>
              <span>接入方式</span>
              <FrameBox>
                <select
                  value={preset}
                  disabled={persisted.current !== null}
                  onChange={(event) => {
                    const next = event.target.value as Preset;
                    setPreset(next);
                    setBaseUrl(PRESETS[next].baseUrl);
                    if (next === "sdwebui") {
                      setImageProtocol("sdwebui");
                      if (!model.trim()) setModel("default");
                    } else if (next === "comfyui") {
                      setImageProtocol("comfyui");
                    } else {
                      setImageProtocol("auto");
                    }
                  }}
                >
                  {Object.entries(PRESETS).map(([id, value]) => (
                    <option key={id} value={id}>
                      {value.title}
                    </option>
                  ))}
                </select>
              </FrameBox>
              <small>{PRESETS[preset].hint}</small>
            </label>
          )}
          {!profile && (
            <label className={styles.field}>
              <span>连接名称</span>
              <FrameBox>
                <input
                  name="cp-conn-name"
                  autoComplete="off"
                  data-lpignore="true"
                  data-form-type="other"
                  required
                  value={name}
                  disabled={persisted.current !== null}
                  onChange={(e) => setName(e.target.value)}
                />
              </FrameBox>
              <small>只是本机区分连接的名字，不是模型名。</small>
            </label>
          )}
          <label className={styles.field}>
            <span>接口地址</span>
            <FrameBox>
              <input
                name="cp-base-url"
                autoComplete="off"
                data-lpignore="true"
                data-form-type="other"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                spellCheck={false}
                placeholder="例如 https://服务商地址/v1"
              />
            </FrameBox>
            <small>
              {currentType === "sdwebui"
                ? "SD WebUI 根地址（默认 http://127.0.0.1:7860），不要带 /sdapi/v1。"
                : currentType === "comfyui"
                  ? "ComfyUI 根地址（默认 http://127.0.0.1:8188）。"
                  : "OpenAI 兼容填 /v1 根地址，不要填 /chat/completions 或 /images/generations。"}
            </small>
          </label>
          <div className={styles.field}>
            <div className={styles.fieldHead}>
              <label htmlFor="cp-model-id">模型名</label>
              <Button
                small
                disabled={fetchModels.isPending || save.isPending}
                onClick={handleFetchModels}
              >
                {fetchModels.isPending ? "获取中..." : "获取模型"}
              </Button>
            </div>
            <FrameBox>
              <input
                id="cp-model-id"
                name="cp-model-id"
                autoComplete="off"
                data-lpignore="true"
                data-form-type="other"
                required
                value={model}
                onChange={(e) => setModel(e.target.value)}
                spellCheck={false}
                placeholder="填写或点击「获取模型」选择模型 ID"
              />
            </FrameBox>
            {modelError && (
              <p className={styles.error} role="alert">
                {modelError}
              </p>
            )}
          </div>
          {modelList !== null && (
            <Panel as="div" line="var(--cp-red-dim)" className={styles.modelPicker}>
              <div className={styles.pickerInner}>
                <div className={styles.pickerHead}>
                  <span className={styles.pickerTitle}>
                    {modelFilter.trim()
                      ? `可用模型 · 匹配 ${visibleModels.length} / ${modelList.length} 个`
                      : `可用模型 · 共 ${modelList.length} 个`}
                  </span>
                  <div className={styles.pickerControls}>
                    {modelList.length > 0 && (
                      <div className={styles.pickerFilter}>
                        <FrameBox>
                          <input
                            aria-label="筛选模型"
                            name="cp-model-filter"
                            autoComplete="off"
                            data-lpignore="true"
                            value={modelFilter}
                            onChange={(e) => setModelFilter(e.target.value)}
                            spellCheck={false}
                            placeholder="筛选模型 ID..."
                          />
                        </FrameBox>
                      </div>
                    )}
                    <Button small onClick={() => setModelList(null)}>
                      收起
                    </Button>
                  </div>
                </div>
                {modelList.length === 0 ? (
                  <div className={styles.notice}>
                    <p>连接成功，但接口没有返回可用模型（可在上方手动输入模型名）。</p>
                  </div>
                ) : visibleModels.length === 0 ? (
                  <div className={styles.notice}>
                    <p>没有匹配「{modelFilter.trim()}」的模型。</p>
                  </div>
                ) : (
                  <div className={styles.modelList} role="listbox" aria-label="可用模型列表">
                    {visibleModels.map((id) => {
                      const active = id === model.trim();
                      return (
                        <button
                          key={id}
                          type="button"
                          role="option"
                          aria-selected={active}
                          title={id}
                          className={[styles.modelOption, active ? styles.modelOptionActive : ""]
                            .filter(Boolean)
                            .join(" ")}
                          onClick={() => {
                            setModel(id);
                            setModelError("");
                          }}
                        >
                          <CellFrame />
                          <span className={styles.modelOptionName}>{id}</span>
                          {active && <span className={styles.modelOptionTag}>当前</span>}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </Panel>
          )}
          <label className={`${styles.field} ${styles.span2}`}>
            <span>API 密钥{profile?.keyStatus === "configured" ? " · 已保存" : ""}</span>
            <FrameBox>
              <input
                type="password"
                name="cp-api-key"
                autoComplete="new-password"
                data-lpignore="true"
                data-1p-ignore="true"
                data-bwignore="true"
                data-form-type="other"
                spellCheck={false}
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder={
                  profile?.keyStatus === "configured"
                    ? "留空保留现有密钥；填新密钥则替换"
                    : "在这里粘贴密钥，保存后不会回显"
                }
              />
            </FrameBox>
            <small>
              {isLocalNoKey
                ? `本地 ${currentType} 通常不需要密钥。`
                : "没有密钥也可以先保存连接，但不能用于剧情或文生图。"}
            </small>
          </label>
          <label className={styles.field}>
            <span>文生图协议（用于「设为文生图模型」时）</span>
            <FrameBox>
              <select
                value={imageProtocol}
                onChange={(e) => setImageProtocol(e.target.value as ImageProtocol)}
              >
                {IMAGE_PROTOCOLS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </FrameBox>
            <small>中转站若把图像模型挂在对话接口上，请选「OpenAI Chat 模态」。</small>
          </label>
          {isComfy && (
            <label className={`${styles.field} ${styles.span2}`}>
              <span>ComfyUI API 工作流 JSON（可选，留空用内置文生图流程）</span>
              <FrameBox>
                <textarea
                  rows={4}
                  value={comfyWorkflow}
                  onChange={(e) => setComfyWorkflow(e.target.value)}
                  spellCheck={false}
                  placeholder="粘贴 ComfyUI「导出 (API 格式)」JSON；支持 {{prompt}}、{{negative_prompt}}、{{width}}、{{height}}、{{seed}}、{{steps}}、{{cfg}}、{{model}} 占位符"
                />
              </FrameBox>
            </label>
          )}
        </div>

        <details className={styles.advanced}>
          <summary>高级参数 · 不确定时先保持原值</summary>
          <div className={styles.advGrid}>
            <label className={styles.field}>
              <span>上下文长度（tokens）</span>
              <FrameBox>
                <input
                  name="cp-context-window"
                  autoComplete="off"
                  data-lpignore="true"
                  required
                  inputMode="numeric"
                  value={contextWindow}
                  onChange={(e) => setContextWindow(e.target.value)}
                />
              </FrameBox>
              <small>按服务商文档填写，非单次输出字数。</small>
            </label>
            <label className={styles.field}>
              <span>温度（0–2，可留空）</span>
              <FrameBox>
                <input
                  name="cp-temperature"
                  autoComplete="off"
                  data-lpignore="true"
                  inputMode="decimal"
                  value={temperature}
                  onChange={(e) => setTemperature(e.target.value)}
                />
              </FrameBox>
            </label>
            <label className={styles.field}>
              <span>最大输出（tokens，可留空）</span>
              <FrameBox>
                <input
                  name="cp-max-output"
                  autoComplete="off"
                  data-lpignore="true"
                  inputMode="numeric"
                  value={maxOutput}
                  onChange={(e) => setMaxOutput(e.target.value)}
                />
              </FrameBox>
            </label>
          </div>
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
      {save.isPending && (
        <p role="status" className={styles.help}>
          {stage}
        </p>
      )}
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
    </form>
  );
}

function ConnectionActions({
  configVersion,
  profile,
  inUse,
  dirty,
  onDuplicate,
  onDeleted,
}: {
  readonly configVersion: number;
  readonly profile: PublicProfile;
  readonly inUse: boolean;
  readonly dirty: boolean;
  readonly onDuplicate: () => void;
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
  const previousConfigVersion = useRef(configVersion);
  useEffect(() => {
    if (previousConfigVersion.current !== configVersion) {
      previousConfigVersion.current = configVersion;
      setResult(null);
    }
  }, [configVersion]);
  return (
    <section className={styles.usage}>
      <div className={styles.usageHead}>
        <span className={styles.kicker}>03 / 可选验证与管理</span>
        <span className={styles.help}>测试连接会发出真实请求，可能产生费用</span>
      </div>
      <div className={styles.actions}>
        <Button
          disabled={busy || dirty}
          reason={dirty ? "先保存或撤销修改" : "正在处理连接"}
          onClick={onDuplicate}
        >
          复制连接
        </Button>
        <Button
          disabled={busy || dirty || problems(profile).length > 0}
          reason={dirty ? "先保存或撤销修改" : problems(profile).join("；")}
          onClick={() => setDialog("test")}
        >
          {test.isPending ? "正在测试…" : "测试连接…"}
        </Button>
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
        {inUse && <span className={styles.help}>使用中，不能删除</span>}
      </div>
      {result && (
        <p role="status" className={result.ok ? styles.success : styles.error}>
          {result.ok
            ? `本次连接成功 · ${result.model} · ${result.ms} ms`
            : `连接失败：${result.error}`}
        </p>
      )}
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
                ? `删除「${profile.name}」及其本地密钥，之后需要重新添加。`
                : "只删除这个浏览器里保存的密钥，连接的其他设置保留；之后要重新填写密钥才能用于剧情。"}
          </p>
        </Dialog>
      )}
    </section>
  );
}
