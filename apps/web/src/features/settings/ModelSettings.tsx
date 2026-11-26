import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { useLocation, useSearchParams } from "react-router";
import {
  api,
  type ConnectionTest,
  type ImageProtocol,
  type ProfilePatch,
  type PublicProfile,
  type RoleKey,
} from "../../api/client";
import { Asset, cssUrl, NineSlice } from "../../ui/Asset";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { CellFrame, FrameBox } from "../../ui/FrameBox";
import { ITEM_CELL_SLICE, Panel } from "../../ui/Panel";
import styles from "./model-settings.module.css";
import shared from "./settings.module.css";

type Preset =
  | "gemini"
  | "vertex"
  | "anthropic"
  | "relay"
  | "openai"
  | "ollama"
  | "novelai"
  | "sdwebui"
  | "comfyui";
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
  vertex: {
    title: "Vertex AI（GCP 赠金）",
    hint: "密钥栏贴 AI Studio key 或整段服务账号 JSON；区域默认 global，要换区域就改 baseUrl 域名",
    type: "vertex",
    baseUrl: "https://aiplatform.googleapis.com/v1",
  },
  anthropic: {
    title: "Anthropic 官方",
    hint: "Anthropic Console 密钥（x-api-key）",
    type: "anthropic",
    baseUrl: "https://api.anthropic.com/v1",
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
  novelai: {
    title: "NovelAI（文生图）",
    hint: "Persistent API Token (pst-...)，支持 V5 / V4.5",
    type: "novelai",
    baseUrl: "https://image.novelai.net",
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
  { id: "novelai", label: "NovelAI V5 / V4.5 (/ai/generate-image)" },
];

function problems(profile: PublicProfile | undefined): string[] {
  if (!profile) return ["还没有选择模型连接"];
  const out: string[] = [];
  if (profile.keyStatus === "missing") out.push("还没有填写 API 密钥");
  return out;
}

function textRoleProblems(profile: PublicProfile | undefined): string[] {
  const out = problems(profile);
  if (
    profile &&
    (profile.type === "sdwebui" || profile.type === "comfyui" || profile.type === "novelai")
  ) {
    out.push(`${profile.type} 仅用于文生图模型`);
  }
  return out;
}

function embeddingRoleProblems(profile: PublicProfile | undefined): string[] {
  const out = problems(profile);
  if (
    profile &&
    profile.type !== "openai" &&
    profile.type !== "ollama" &&
    profile.type !== "gemini"
  ) {
    out.push(`${profile.type} 暂不支持向量嵌入（请使用 OpenAI 兼容、Ollama 或 Gemini 连接）`);
  }
  return out;
}

function rerankerRoleProblems(profile: PublicProfile | undefined): string[] {
  const out = problems(profile);
  if (profile && profile.type !== "openai" && profile.type !== "ollama") {
    out.push(`${profile.type} 暂不支持 /rerank 重排接口（请使用 OpenAI 兼容或 Ollama 连接）`);
  }
  return out;
}

function imageRoleProblems(profile: PublicProfile | undefined): string[] {
  const out = problems(profile);
  if (profile && profile.type === "anthropic") {
    out.push("anthropic 暂不支持文生图接口");
  }
  return out;
}

function isProfileCompatibleWithRole(profile: PublicProfile, role: RoleKey): boolean {
  if (role === "narrator" || role === "aux") {
    return profile.type !== "sdwebui" && profile.type !== "comfyui" && profile.type !== "novelai";
  }
  if (role === "image") {
    return profile.type !== "anthropic";
  }
  if (role === "embedding") {
    return profile.type === "openai" || profile.type === "ollama" || profile.type === "gemini";
  }
  return profile.type === "openai" || profile.type === "ollama";
}

function defaultModelForRole(profile: PublicProfile, role: RoleKey): string {
  if (role === "embedding") return profile.embeddingModel || profile.model;
  return profile.model;
}

const ROLE_FILTER_PRESETS: Partial<
  Record<RoleKey, readonly { readonly label: string; readonly query: string }[]>
> = {
  embedding: [{ label: "只看 embedding / bge / m3", query: "embed" }],
  reranker: [{ label: "只看 rerank", query: "rerank" }],
  image: [{ label: "只看 image / flux / gpt-image / nai", query: "image" }],
};

function matchesRoleModelFilter(id: string, query: string): boolean {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return true;
  if (trimmed === "embed") {
    return /embed|bge-|m3e|text-embedding|jina-embeddings|nomic-embed/i.test(id);
  }
  if (trimmed === "rerank") {
    return /rerank|bge-reranker/i.test(id);
  }
  if (trimmed === "image") {
    return /image|imagen|dall-e|flux|midjourney|mj|sdxl|stable-diffusion|nai-|kolors|ideogram|recraft|seedream|wanx|grok-2-image/i.test(
      id,
    );
  }
  return id.toLowerCase().includes(trimmed);
}

function useRefresh() {
  const client = useQueryClient();
  return async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ["profiles"] }),
      client.invalidateQueries({ queryKey: ["health"] }),
      client.invalidateQueries({ queryKey: ["imageCapabilities"] }),
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
  const [modelCache, setModelCache] = useState<Record<string, readonly string[]>>({});
  const [pickerRole, setPickerRole] = useState<RoleKey | null>(null);
  const [pickerFilter, setPickerFilter] = useState("");
  const [pickerCustomModel, setPickerCustomModel] = useState("");
  const [pickerError, setPickerError] = useState("");

  const assign = useMutation({
    mutationFn: api.setRoles,
    onSuccess: async (_result, variables) => {
      const roleModelKeys = variables.roleModels
        ? (Object.keys(variables.roleModels) as RoleKey[])
        : [];
      setNotice(
        variables.image === null
          ? "已停用文生图模型，后续不会自动生图，也可删除该连接。"
          : variables.embedding === null
            ? "已停用独立向量模型，若对话方案未附挂向量模型则回退规则检索。"
            : variables.reranker === null
              ? "已停用语义重排模型，后续回合将跳过二阶段精排。"
              : roleModelKeys.length > 0 &&
                  variables.narrator === undefined &&
                  variables.aux === undefined &&
                  variables.image === undefined &&
                  variables.embedding === undefined &&
                  variables.reranker === undefined
                ? "该角色的独立模型已更新。同一连接可直接复用于多个角色，无需重复创建连接。"
                : "使用方案已更新。没有发送模型请求，后续回合使用新选择。",
      );
      await refresh();
    },
  });

  const fetchRoleModels = useMutation({
    gcTime: 0,
    retry: false,
    mutationFn: async (profileName: string) => ({
      profileName,
      result: await api.fetchModels({ profileName }),
    }),
    onSuccess: ({ profileName, result }) => {
      if (!result.ok) {
        setPickerError(result.error);
        return;
      }
      setPickerError("");
      setModelCache((prev) => ({ ...prev, [profileName]: result.models }));
    },
    onError: (err) => {
      setPickerError(err instanceof Error ? err.message : String(err));
    },
  });

  const openRoleModelPicker = (
    role: RoleKey,
    profileName: string,
    currentEffectiveModel: string,
  ) => {
    if (pickerRole === role) {
      setPickerRole(null);
      setPickerError("");
      return;
    }
    setPickerRole(role);
    setPickerFilter("");
    setPickerCustomModel(currentEffectiveModel);
    setPickerError("");
    if (!(profileName in modelCache)) {
      fetchRoleModels.mutate(profileName);
    }
  };

  const applyRoleModel = (role: RoleKey, profile: PublicProfile, rawModel: string | null) => {
    const trimmed = rawModel === null ? null : rawModel.trim();
    const defaultModel = defaultModelForRole(profile, role);
    const nextValue = !trimmed || trimmed === defaultModel ? null : trimmed;
    assign.mutate(
      { roleModels: { [role]: nextValue } },
      {
        onSuccess: () => {
          setPickerRole(null);
          setPickerError("");
        },
      },
    );
  };

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
  const image = data.profiles.find((p) => p.name === data.image);
  const embedding = data.profiles.find((p) => p.name === data.embedding);
  const reranker = data.profiles.find((p) => p.name === data.reranker);
  const attachedEmbedding = !data.embedding
    ? aux?.embeddingModel
      ? aux
      : narrator?.embeddingModel
        ? narrator
        : undefined
    : undefined;
  const activeEmbedding = embedding ?? attachedEmbedding;
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

  const roleSlots: readonly {
    readonly key: RoleKey;
    readonly code: string;
    readonly label: string;
    readonly optional: boolean;
    readonly boundProfile: PublicProfile | undefined;
    readonly displayName: string | undefined;
    readonly model: string | undefined;
    readonly overrideModel: string | undefined;
    readonly state: "ok" | "warn" | "optional";
  }[] = [
    {
      key: "narrator",
      code: "NARRATOR",
      label: "叙事模型",
      optional: false,
      boundProfile: narrator,
      displayName: data.narrator,
      model: data.roleModels?.narrator || narrator?.model,
      overrideModel: data.roleModels?.narrator,
      state: narratorProblems.length === 0 ? "ok" : "warn",
    },
    {
      key: "aux",
      code: "AUX",
      label: "辅助模型",
      optional: false,
      boundProfile: aux,
      displayName: data.aux,
      model: data.roleModels?.aux || aux?.model,
      overrideModel: data.roleModels?.aux,
      state: auxProblems.length === 0 ? "ok" : "warn",
    },
    {
      key: "image",
      code: "IMAGE",
      label: "文生图模型",
      optional: true,
      boundProfile: image,
      displayName: data.image,
      model: data.roleModels?.image || image?.model,
      overrideModel: data.roleModels?.image,
      state: data.image ? (imageRoleProblems(image).length === 0 ? "ok" : "warn") : "optional",
    },
    {
      key: "embedding",
      code: "EMBEDDING",
      label: "向量检索",
      optional: true,
      boundProfile: embedding,
      displayName: activeEmbedding?.name,
      model: embedding
        ? data.roleModels?.embedding || embedding.embeddingModel || embedding.model
        : attachedEmbedding?.embeddingModel
          ? `${attachedEmbedding.embeddingModel}（附挂）`
          : undefined,
      overrideModel: embedding ? data.roleModels?.embedding : undefined,
      state: activeEmbedding
        ? embeddingRoleProblems(activeEmbedding).length === 0
          ? "ok"
          : "warn"
        : "optional",
    },
    {
      key: "reranker",
      code: "RERANKER",
      label: "语义重排",
      optional: true,
      boundProfile: reranker,
      displayName: data.reranker,
      model: data.roleModels?.reranker || reranker?.model,
      overrideModel: data.roleModels?.reranker,
      state: data.reranker
        ? rerankerRoleProblems(reranker).length === 0
          ? "ok"
          : "warn"
        : "optional",
    },
  ];

  const activePickerSlot = pickerRole ? roleSlots.find((s) => s.key === pickerRole) : undefined;
  const activePickerProfile = activePickerSlot?.boundProfile;
  const cachedPickerModels = activePickerProfile ? modelCache[activePickerProfile.name] : undefined;
  const visiblePickerModels = cachedPickerModels
    ? cachedPickerModels.filter((id) => matchesRoleModelFilter(id, pickerFilter))
    : [];
  const activeFilterPresets = activePickerSlot
    ? ROLE_FILTER_PRESETS[activePickerSlot.key]
    : undefined;

  return (
    <div className={styles.root}>
      <section
        className={styles.readiness}
        data-ready={ready || undefined}
        aria-label="当前配置状态"
      >
        <NineSlice
          id="notify.itemCellBg"
          slice={ITEM_CELL_SLICE}
          tint="var(--cp-surface-strong)"
          className={styles.slice}
        />
        <NineSlice
          id="notify.itemCellFg"
          slice={ITEM_CELL_SLICE}
          tint={ready ? "var(--cp-cyan)" : "var(--cp-yellow)"}
          className={styles.slice}
        />
        <Asset
          id="panel.glowLeft"
          height={42}
          tint={ready ? "var(--cp-cyan)" : "var(--cp-yellow)"}
          className={styles.readyGlow}
        />
        <div className={styles.readyMain}>
          <div className={styles.readyTop}>
            <span className={styles.statusBadge} data-ready={ready || undefined}>
              {ready ? "配置已就绪" : "还差一步"}
            </span>
            <strong className={styles.readyTitle}>
              {ready
                ? "同一连接可直接分配给多个角色，点「换模型」单独指定模型 ID"
                : "当前选择还不能开始剧情"}
            </strong>
            {!ready && (
              <span className={styles.readyErrors}>
                {[
                  ...narratorProblems.map((p) => `叙事：${p}`),
                  ...auxProblems.map((p) => `辅助：${p}`),
                ].join(" · ")}
              </span>
            )}
          </div>
          <div className={styles.roleSlots}>
            {roleSlots.map((slot) => {
              const isSelected = Boolean(
                slot.displayName && !adding && selected?.name === slot.displayName,
              );
              const isPickerOpen = pickerRole === slot.key;
              const compatible = data.profiles.filter(
                (p) =>
                  isProfileCompatibleWithRole(p, slot.key) || p.name === slot.boundProfile?.name,
              );
              return (
                <div
                  key={slot.key}
                  className={styles.roleSlot}
                  data-state={slot.state}
                  data-selected={isSelected || undefined}
                  data-picker-open={isPickerOpen || undefined}
                >
                  <div className={styles.roleSlotHead}>
                    <div className={styles.roleSlotTitleWrap}>
                      <span className={styles.roleSlotLabel}>{slot.label}</span>
                      {slot.overrideModel && (
                        <span className={styles.roleOverrideTag}>独立模型</span>
                      )}
                    </div>
                    {slot.displayName ? (
                      <button
                        type="button"
                        className={styles.roleSlotEditBtn}
                        onClick={() => {
                          if (!slot.displayName || isSelected) return;
                          requestSelect(slot.displayName);
                        }}
                      >
                        {isSelected ? "编辑中" : "编辑"}
                      </button>
                    ) : (
                      <span className={styles.roleSlotCode}>{slot.code}</span>
                    )}
                  </div>
                  <select
                    aria-label={`${slot.label}所用连接`}
                    className={styles.roleSlotSelect}
                    value={slot.boundProfile?.name ?? ""}
                    disabled={assign.isPending || dirty}
                    title={dirty ? "请先保存或撤销正在编辑的连接" : `切换${slot.label}的连接`}
                    onChange={(e) => {
                      const nextName = e.target.value;
                      if (pickerRole === slot.key) setPickerRole(null);
                      if (!nextName) {
                        if (slot.optional) assign.mutate({ [slot.key]: null });
                        return;
                      }
                      assign.mutate({ [slot.key]: nextName });
                    }}
                  >
                    {slot.optional ? (
                      <option value="">
                        {slot.key === "embedding" && attachedEmbedding
                          ? `跟随附挂（${attachedEmbedding.name}）`
                          : "未启用（可选）"}
                      </option>
                    ) : (
                      !slot.boundProfile && <option value="">未选择连接</option>
                    )}
                    {compatible.map((p) => (
                      <option key={p.name} value={p.name}>
                        {p.name}
                        {p.keyStatus === "missing" ? " · 缺密钥" : ""}
                      </option>
                    ))}
                  </select>
                  <div className={styles.roleSlotModelRow}>
                    <span
                      className={styles.roleSlotModel}
                      data-override={Boolean(slot.overrideModel) || undefined}
                      title={slot.model}
                    >
                      {slot.model || (slot.boundProfile ? "未填模型名" : "未分配")}
                    </span>
                    {slot.boundProfile && (
                      <button
                        type="button"
                        className={styles.roleSlotModelBtn}
                        aria-expanded={isPickerOpen}
                        disabled={assign.isPending || dirty}
                        title={
                          dirty ? "请先保存或撤销正在编辑的连接" : `为${slot.label}单独指定模型 ID`
                        }
                        onClick={() => {
                          if (!slot.boundProfile) return;
                          openRoleModelPicker(
                            slot.key,
                            slot.boundProfile.name,
                            slot.overrideModel || defaultModelForRole(slot.boundProfile, slot.key),
                          );
                        }}
                      >
                        {isPickerOpen ? "收起" : "换模型"}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {activePickerSlot && activePickerProfile && (
            <section className={styles.roleModelTray} aria-label="角色独立模型选择器">
              <div className={styles.roleModelTrayHead}>
                <div className={styles.roleModelTrayHeading}>
                  <strong className={styles.roleModelTrayTitle}>
                    为「{activePickerSlot.label}」独立选模型 · 连接：{activePickerProfile.name}
                  </strong>
                  <span className={styles.roleModelTraySub}>
                    连接默认模型：
                    {defaultModelForRole(activePickerProfile, activePickerSlot.key) || "未设置"}
                    {cachedPickerModels
                      ? ` · 已缓存 ${cachedPickerModels.length} 个模型（同连接切换角色免重复拉取）`
                      : ""}
                  </span>
                </div>
                <div className={styles.roleModelTrayActions}>
                  {activePickerSlot.overrideModel && (
                    <Button
                      small
                      disabled={assign.isPending}
                      onClick={() =>
                        applyRoleModel(activePickerSlot.key, activePickerProfile, null)
                      }
                    >
                      恢复连接默认
                    </Button>
                  )}
                  <Button
                    small
                    disabled={fetchRoleModels.isPending}
                    onClick={() => {
                      setPickerError("");
                      fetchRoleModels.mutate(activePickerProfile.name);
                    }}
                  >
                    {fetchRoleModels.isPending ? "拉取中…" : "刷新模型列表"}
                  </Button>
                  <Button
                    small
                    onClick={() => {
                      setPickerRole(null);
                      setPickerError("");
                    }}
                  >
                    收起
                  </Button>
                </div>
              </div>
              <form
                className={styles.roleModelCustomRow}
                onSubmit={(e) => {
                  e.preventDefault();
                  if (assign.isPending) return;
                  applyRoleModel(activePickerSlot.key, activePickerProfile, pickerCustomModel);
                }}
              >
                <div className={styles.roleModelInputWrap}>
                  <FrameBox>
                    <input
                      aria-label={`${activePickerSlot.label}独立模型 ID`}
                      value={pickerCustomModel}
                      onChange={(e) => setPickerCustomModel(e.target.value)}
                      spellCheck={false}
                      placeholder="直接输入或粘贴模型 ID，留空则恢复连接默认"
                    />
                  </FrameBox>
                </div>
                <Button small primary type="submit" disabled={assign.isPending}>
                  {assign.isPending ? "应用中…" : "应用模型"}
                </Button>
              </form>
              {pickerError && (
                <p className={styles.error} role="alert">
                  拉取模型列表失败：{pickerError}（仍可在上方直接手填模型 ID 并点「应用模型」）
                </p>
              )}
              {fetchRoleModels.isPending && !cachedPickerModels ? (
                <p className={styles.help} role="status">
                  正在从「{activePickerProfile.name}」拉取可用模型列表…
                </p>
              ) : cachedPickerModels ? (
                <div className={styles.roleModelListWrap}>
                  <div className={styles.roleModelFilterRow}>
                    <div className={styles.pickerFilter}>
                      <FrameBox>
                        <input
                          aria-label="筛选该连接的可用模型"
                          value={pickerFilter}
                          onChange={(e) => setPickerFilter(e.target.value)}
                          spellCheck={false}
                          placeholder={`搜索 ${cachedPickerModels.length} 个模型…`}
                        />
                      </FrameBox>
                    </div>
                    {activeFilterPresets && (
                      <div className={styles.roleFilterChips}>
                        <button
                          type="button"
                          className={styles.inlineToggle}
                          aria-pressed={pickerFilter === ""}
                          onClick={() => setPickerFilter("")}
                        >
                          全部 ({cachedPickerModels.length})
                        </button>
                        {activeFilterPresets.map((chip) => (
                          <button
                            key={chip.query}
                            type="button"
                            className={styles.inlineToggle}
                            aria-pressed={pickerFilter === chip.query}
                            onClick={() =>
                              setPickerFilter((cur) => (cur === chip.query ? "" : chip.query))
                            }
                          >
                            {chip.label}
                          </button>
                        ))}
                      </div>
                    )}
                    <span className={styles.roleModelCount}>
                      匹配 {visiblePickerModels.length} / {cachedPickerModels.length}
                    </span>
                  </div>
                  {cachedPickerModels.length === 0 ? (
                    <p className={styles.help}>接口未返回模型列表，请在上方手动填写模型 ID。</p>
                  ) : visiblePickerModels.length === 0 ? (
                    <p className={styles.help}>
                      没有匹配「{pickerFilter.trim()}」的模型，可清空筛选或直接在上方手填。
                    </p>
                  ) : (
                    <div
                      className={styles.modelList}
                      role="listbox"
                      aria-label={`${activePickerSlot.label}可选模型列表`}
                    >
                      {visiblePickerModels.map((id) => {
                        const effective =
                          activePickerSlot.overrideModel ||
                          defaultModelForRole(activePickerProfile, activePickerSlot.key);
                        const active = id === effective;
                        return (
                          <button
                            key={id}
                            type="button"
                            role="option"
                            aria-selected={active}
                            title={id}
                            disabled={assign.isPending}
                            className={[styles.modelOption, active ? styles.modelOptionActive : ""]
                              .filter(Boolean)
                              .join(" ")}
                            onClick={() =>
                              applyRoleModel(activePickerSlot.key, activePickerProfile, id)
                            }
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
              ) : null}
            </section>
          )}
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
        <div className={styles.banner} role="status">
          <span>{notice}</span>
          <button
            type="button"
            className={styles.bannerClose}
            aria-label="关闭提示"
            onClick={() => setNotice("")}
          >
            关闭
          </button>
        </div>
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
            slice={ITEM_CELL_SLICE}
            tint="var(--cp-surface)"
            className={styles.slice}
          />
          <NineSlice
            id="notify.itemCellFg"
            slice={ITEM_CELL_SLICE}
            tint="var(--cp-red-dim)"
            className={styles.slice}
          />
          <div className={styles.listHead}>
            <div className={styles.listTitleWrap}>
              <h3>我的连接</h3>
              <span className={styles.countBadge}>{data.profiles.length}</span>
            </div>
            <Button
              small
              primary={adding}
              onClick={() => {
                if (!adding) requestSelect("@new");
              }}
            >
              + 添加连接
            </Button>
          </div>
          <div className={styles.listScroll}>
            {data.profiles.length === 0 ? (
              <p className={styles.help}>还没有连接，请在右侧新增第一个模型连接。</p>
            ) : (
              <ul className={styles.list}>
                {data.profiles.map((profile) => {
                  const issues = problems(profile);
                  const isNarrator = data.narrator === profile.name;
                  const isAux = data.aux === profile.name;
                  const isImage = data.image === profile.name;
                  const isEmbedding = data.embedding === profile.name;
                  const isReranker = data.reranker === profile.name;
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
                            {issues.length ? "待处理" : "就绪"}
                          </span>
                        </div>
                        <div className={styles.connSub}>
                          <span className={styles.typeTag}>{profile.type}</span>
                          <span className={styles.modelName} title={profile.model || undefined}>
                            {profile.model || "未填模型名"}
                          </span>
                        </div>
                        {(isNarrator || isAux || isImage || isEmbedding || isReranker) && (
                          <div className={styles.roles}>
                            {isNarrator && (
                              <span
                                className={styles.rolePill}
                                data-role="narrator"
                                title={`叙事模型：${data.roleModels?.narrator || profile.model}`}
                              >
                                叙事模型
                              </span>
                            )}
                            {isAux && (
                              <span
                                className={styles.rolePill}
                                title={`辅助模型：${data.roleModels?.aux || profile.model}`}
                              >
                                辅助模型
                              </span>
                            )}
                            {isImage && (
                              <span
                                className={styles.rolePill}
                                data-role="image"
                                title={`文生图：${data.roleModels?.image || profile.model}`}
                              >
                                文生图
                              </span>
                            )}
                            {isEmbedding && (
                              <span
                                className={styles.rolePill}
                                data-role="embedding"
                                title={`向量模型：${data.roleModels?.embedding || profile.embeddingModel || profile.model}`}
                              >
                                向量模型
                              </span>
                            )}
                            {isReranker && (
                              <span
                                className={styles.rolePill}
                                data-role="reranker"
                                title={`重排模型：${data.roleModels?.reranker || profile.model}`}
                              >
                                重排模型
                              </span>
                            )}
                          </div>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </aside>

        <section className={styles.editor} aria-label="编辑模型连接">
          <NineSlice
            id="notify.itemCellBg"
            slice={ITEM_CELL_SLICE}
            tint="var(--cp-surface)"
            className={styles.slice}
          />
          <NineSlice
            id="notify.itemCellFg"
            slice={ITEM_CELL_SLICE}
            tint="var(--cp-red-dim)"
            className={styles.slice}
          />
          <div className={styles.editorScroll}>
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
                  onModelsFetched={(profileName, models) =>
                    setModelCache((prev) => ({ ...prev, [profileName]: models }))
                  }
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
                    <h3>同一连接可同时承担多个角色，顶部槽位可按角色单独换模型。</h3>
                  </div>
                  {/* 用户定的：保留三个独立角色按钮，不要合并按钮和折叠区 */}
                  <div className={styles.roleActions}>
                    <Button
                      primary
                      pressed={data.narrator === selected.name}
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
                      pressed={data.aux === selected.name}
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
                      pressed={data.image === selected.name}
                      disabled={
                        dirty ||
                        assign.isPending ||
                        (data.image !== selected.name && imageRoleProblems(selected).length > 0)
                      }
                      reason={
                        dirty
                          ? "请先保存连接"
                          : data.image === selected.name
                            ? "点击停用文生图模型"
                            : imageRoleProblems(selected).join("；")
                      }
                      onClick={() =>
                        assign.mutate({
                          image: data.image === selected.name ? null : selected.name,
                        })
                      }
                    >
                      {data.image === selected.name ? "文生图使用中（点击停用）" : "设为文生图模型"}
                    </Button>
                    <Button
                      primary
                      pressed={data.embedding === selected.name}
                      disabled={
                        dirty ||
                        assign.isPending ||
                        (data.embedding !== selected.name &&
                          embeddingRoleProblems(selected).length > 0)
                      }
                      reason={
                        dirty
                          ? "请先保存连接"
                          : data.embedding === selected.name
                            ? "点击停用独立向量模型"
                            : embeddingRoleProblems(selected).join("；")
                      }
                      onClick={() =>
                        assign.mutate({
                          embedding: data.embedding === selected.name ? null : selected.name,
                        })
                      }
                    >
                      {data.embedding === selected.name ? "向量使用中（点击停用）" : "设为向量模型"}
                    </Button>
                    <Button
                      primary
                      pressed={data.reranker === selected.name}
                      disabled={
                        dirty ||
                        assign.isPending ||
                        (data.reranker !== selected.name &&
                          rerankerRoleProblems(selected).length > 0)
                      }
                      reason={
                        dirty
                          ? "请先保存连接"
                          : data.reranker === selected.name
                            ? "点击停用语义重排模型"
                            : rerankerRoleProblems(selected).join("；")
                      }
                      onClick={() =>
                        assign.mutate({
                          reranker: data.reranker === selected.name ? null : selected.name,
                        })
                      }
                    >
                      {data.reranker === selected.name ? "重排使用中（点击停用）" : "设为重排模型"}
                    </Button>
                  </div>
                  {data.image && (
                    <div className={styles.roleMetaRow}>
                      <span className={styles.help}>
                        当前文生图模型：{data.image}（可选功能，停用后可卸载或删除该连接）
                      </span>
                      <Button
                        small
                        disabled={dirty || assign.isPending}
                        reason="请先保存连接"
                        onClick={() => assign.mutate({ image: null })}
                      >
                        停用文生图模型
                      </Button>
                    </div>
                  )}
                  {data.embedding && (
                    <div className={styles.roleMetaRow}>
                      <span className={styles.help}>
                        当前独立向量模型：{data.embedding}
                        （旧记忆语义检索已启用本地持久化缓存，停用后可删除该连接）
                      </span>
                      <Button
                        small
                        disabled={dirty || assign.isPending}
                        reason="请先保存连接"
                        onClick={() => assign.mutate({ embedding: null })}
                      >
                        停用向量模型
                      </Button>
                    </div>
                  )}
                  {data.reranker && (
                    <div className={styles.roleMetaRow}>
                      <span className={styles.help}>
                        当前语义重排模型：{data.reranker}
                        （可与向量模型配合做「粗排 + 精排」，也可单独使用，如 Qwen3-Reranker）
                      </span>
                      <Button
                        small
                        disabled={dirty || assign.isPending}
                        reason="请先保存连接"
                        onClick={() => assign.mutate({ reranker: null })}
                      >
                        停用重排模型
                      </Button>
                    </div>
                  )}
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
                    data.image === selected.name ||
                    data.embedding === selected.name ||
                    data.reranker === selected.name
                  }
                  inUseReason={
                    data.narrator === selected.name || data.aux === selected.name
                      ? "先将叙事或辅助模型改用其他连接，再删除此连接"
                      : "先点击上方停用对应的可选模型，再删除此连接"
                  }
                  onDuplicate={() => duplicate(selected)}
                  onDeleted={() => select("@new")}
                />
              </div>
            ) : null}
          </div>
        </section>
      </div>

      <div className={styles.privacyBar}>
        <span className={styles.privacyTag}>{"LOCAL // INDEXEDDB"}</span>
        <p className={styles.privacy}>
          密钥只存在这个浏览器里，由浏览器直接发给模型服务商，不经过本站服务器；公用电脑用完请清除密钥。服务商需允许网页跨域访问（CORS），本地
          Ollama 需设置 OLLAMA_ORIGINS。
        </p>
      </div>

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
  onModelsFetched,
  onSaved,
}: {
  readonly profile?: PublicProfile;
  readonly copyFrom?: PublicProfile;
  readonly names: readonly string[];
  readonly onDirty: (dirty: boolean) => void;
  readonly onModelsFetched?: (profileName: string, models: readonly string[]) => void;
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
  const [showKey, setShowKey] = useState(false);
  const [contextWindow, setContextWindow] = useState(String(source?.contextWindow ?? 128000));
  const [temperature, setTemperature] = useState(source?.temperature?.toString() ?? "");
  const [maxOutput, setMaxOutput] = useState(source?.maxOutputTokens?.toString() ?? "");
  const [embeddingModel, setEmbeddingModel] = useState(source?.embeddingModel ?? "");
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
          embeddingModel.trim() !== "" ||
          imageProtocol !== "auto" ||
          comfyWorkflow.trim() !== "",
      )
    : model !== profile.model ||
      baseUrl !== (profile.baseUrl ?? "") ||
      contextWindow !== String(profile.contextWindow) ||
      temperature !== (profile.temperature?.toString() ?? "") ||
      maxOutput !== (profile.maxOutputTokens?.toString() ?? "") ||
      embeddingModel !== (profile.embeddingModel ?? "") ||
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
      if (embeddingModel.trim()) {
        patch.embeddingModel = embeddingModel.trim();
      } else if (profile?.embeddingModel !== undefined) {
        patch.embeddingModel = null;
      }
      if (url) patch.baseUrl = url;
      if (temperature.trim()) {
        const value = Number(temperature);
        if (!Number.isFinite(value) || value < 0 || value > 2)
          throw new Error("温度要填写 0 到 2 之间的数字。");
        patch.temperature = value;
      } else if (profile?.temperature !== undefined) {
        patch.temperature = null;
      }
      if (maxOutput.trim()) {
        const value = Number(maxOutput);
        if (!Number.isSafeInteger(value) || value < 1) throw new Error("最大输出长度要填正整数。");
        patch.maxOutputTokens = value;
      } else if (profile?.maxOutputTokens !== undefined) {
        patch.maxOutputTokens = null;
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
          ...(copyFrom && copyFrom.keyStatus === "configured" && !key.trim()
            ? { copyKeyFrom: copyFrom.name }
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
        setShowKey(false);
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
      const profileName = persisted.current ?? copyFrom?.name ?? null;
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
      const cachedName = persisted.current ?? profile?.name;
      if (cachedName) onModelsFetched?.(cachedName, res.models);
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
    setEmbeddingModel(profile?.embeddingModel ?? "");
    setImageProtocol(profile?.imageProtocol ?? "auto");
    setComfyWorkflow(profile?.comfyWorkflow ?? "");
    setKey("");
    setShowKey(false);
    setSaved("");
    setStage("");
    save.reset();
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!save.isPending) save.mutate();
  };
  const selectPreset = (next: Preset) => {
    if (persisted.current !== null || save.isPending) return;
    setPreset(next);
    setBaseUrl(PRESETS[next].baseUrl);
    if (next === "sdwebui") {
      setImageProtocol("sdwebui");
      if (!model.trim()) setModel("default");
    } else if (next === "comfyui") {
      setImageProtocol("comfyui");
    } else if (next === "novelai") {
      setImageProtocol("novelai");
      if (!model.trim() || model === "default") setModel("nai-diffusion-4-5-full");
    } else {
      setImageProtocol("auto");
    }
  };
  const keyBadge =
    profile?.keyStatus === "configured"
      ? { label: "已保存密钥", tone: "ok" as const }
      : !profile && copyFrom?.keyStatus === "configured"
        ? { label: "将沿用原密钥", tone: "ok" as const }
        : isLocalNoKey
          ? { label: "本地免密钥", tone: "dim" as const }
          : { label: "未填写", tone: "warn" as const };
  const advSummaryParts = [
    `窗口 ${contextWindow.trim() ? Number(contextWindow).toLocaleString() : "—"}`,
    `温度 ${temperature.trim() || "默认"}`,
    `输出 ${maxOutput.trim() || "默认"}`,
  ];

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
          <p>
            {copyFrom.keyStatus === "configured"
              ? `已复制连接参数；保存时会在本地自动沿用「${copyFrom.name}」的 API 密钥（留空即可，填新密钥则会替换）。`
              : "已复制连接参数；原连接尚未保存 API 密钥。"}
          </p>
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
            <div className={`${styles.field} ${styles.span2}`}>
              <span>接入方式</span>
              <fieldset className={styles.presetGrid} aria-label="选择接入方式">
                {(Object.entries(PRESETS) as [Preset, (typeof PRESETS)[Preset]][]).map(
                  ([id, value]) => (
                    <button
                      key={id}
                      type="button"
                      className={styles.presetCard}
                      aria-pressed={preset === id}
                      disabled={persisted.current !== null || save.isPending}
                      onClick={() => selectPreset(id)}
                    >
                      <CellFrame />
                      <strong className={styles.presetCardTitle}>{value.title}</strong>
                      <span className={styles.presetCardHint}>{value.hint}</span>
                    </button>
                  ),
                )}
              </fieldset>
            </div>
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
                  : currentType === "novelai"
                    ? "NovelAI 图像服务根地址（默认 https://image.novelai.net），自动请求 /ai/generate-image。"
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
          <div className={`${styles.field} ${styles.span2}`}>
            <div className={styles.fieldHead}>
              <div className={styles.fieldTitleGroup}>
                <label htmlFor="cp-api-key">API 密钥</label>
                <span className={styles.keyBadge} data-tone={keyBadge.tone}>
                  {keyBadge.label}
                </span>
              </div>
              <button
                type="button"
                className={styles.inlineToggle}
                disabled={save.isPending || key.length === 0}
                onClick={() => setShowKey((v) => !v)}
              >
                {showKey ? "隐藏输入" : "显示输入"}
              </button>
            </div>
            <FrameBox>
              <input
                id="cp-api-key"
                type={showKey ? "text" : "password"}
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
                    : copyFrom?.keyStatus === "configured"
                      ? `留空沿用「${copyFrom.name}」已保存的密钥；填新密钥则替换`
                      : "在这里粘贴密钥，保存后不会回显"
                }
              />
            </FrameBox>
            <small>
              {isLocalNoKey
                ? `本地 ${currentType} 通常不需要密钥。`
                : "没有密钥也可以先保存连接，但不能用于剧情或文生图。"}
            </small>
          </div>
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
          <summary className={styles.advSummary}>
            <span className={styles.advTitle}>
              <Asset
                id="menu.arrowFill"
                width={9}
                tint="currentColor"
                className={styles.advArrow}
              />
              <span>高级参数</span>
            </span>
            <span className={styles.advMeta}>{advSummaryParts.join(" · ")}</span>
          </summary>
          <div className={styles.advBody}>
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
              {(currentType === "openai" ||
                currentType === "ollama" ||
                currentType === "gemini") && (
                <label className={styles.field}>
                  <span>向量嵌入模型（可选，留空可清除）</span>
                  <FrameBox>
                    <input
                      name="cp-embedding-model"
                      autoComplete="off"
                      data-lpignore="true"
                      placeholder={
                        currentType === "gemini"
                          ? "如 gemini-embedding-001"
                          : "如 text-embedding-3-small / BAAI/bge-m3"
                      }
                      value={embeddingModel}
                      onChange={(e) => setEmbeddingModel(e.target.value)}
                    />
                  </FrameBox>
                  <small>
                    独立设为「向量模型」时可直接复用上方模型名；此处用于在同一对话连接里附挂不同向量模型，支持
                    OpenAI 兼容、Ollama 与 Gemini 原生向量，且自动缓存旧记忆向量。
                  </small>
                </label>
              )}
            </div>
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
  inUseReason,
  dirty,
  onDuplicate,
  onDeleted,
}: {
  readonly configVersion: number;
  readonly profile: PublicProfile;
  readonly inUse: boolean;
  readonly inUseReason: string;
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
      <div className={styles.actionBar}>
        <div className={styles.actionGroup}>
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
        </div>
        <div className={styles.dangerGroup}>
          {profile.keySource === "config" && (
            <Button disabled={busy || dirty} onClick={() => setDialog("key")}>
              清除已保存密钥
            </Button>
          )}
          <Button
            disabled={busy || dirty || inUse}
            reason={inUse ? inUseReason : "先保存或撤销修改"}
            onClick={() => setDialog("delete")}
          >
            删除连接
          </Button>
          {inUse && <span className={styles.help}>使用中不可删</span>}
        </div>
      </div>
      {result && (
        <div role="status" className={styles.testResult} data-ok={result.ok || undefined}>
          <span className={styles.testBadge} data-ok={result.ok || undefined}>
            {result.ok ? "连通成功" : "连接失败"}
          </span>
          {result.ok ? (
            <>
              <span className={styles.testModel}>{result.model}</span>
              <span className={styles.testLatency}>{result.ms} ms</span>
            </>
          ) : (
            <span className={styles.testErrText}>{result.error}</span>
          )}
        </div>
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
