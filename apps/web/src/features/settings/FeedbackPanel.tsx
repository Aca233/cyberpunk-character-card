import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { api, type RuntimeDiagnosticsReport } from "../../api/client";
import {
  type ClientApiTrace,
  type ClientStorageEstimate,
  clearClientApiTraces,
  clearClientDiagnosticErrors,
  collectStorageEstimate,
  getClientApiTraces,
  getClientDiagnosticErrors,
  redactPossibleSecrets,
} from "../../api/diagnostics";
import { Button } from "../../ui/Button";
import { Panel } from "../../ui/Panel";
import { CHANGELOG_ENTRIES } from "../menu/changelog";
import { type NarrativePrefs, useNarrativePrefs } from "./prefs";
import styles from "./settings.module.css";

const GITHUB_ISSUES_NEW = "https://github.com/Aca233/cyberpunk-character-card/issues/new";

type FeedbackCategory =
  | "loop"
  | "combat"
  | "trade"
  | "npc"
  | "image"
  | "model"
  | "character"
  | "workshop"
  | "ui"
  | "idea";

const DEFAULT_CATEGORY = {
  id: "loop" as const,
  label: "剧情卡死 / 鬼打墙",
  tag: "bug,story",
  placeholder: "例：给老方转 1000 欧破译芯片，连转 5 轮都被各种理由拒收，或推进不动……",
};

const CATEGORIES: readonly {
  readonly id: FeedbackCategory;
  readonly label: string;
  readonly tag: string;
  readonly placeholder: string;
}[] = [
  DEFAULT_CATEGORY,
  {
    id: "combat",
    label: "战斗 / 检定 / 潜行 / 黑客",
    tag: "bug,gameplay",
    placeholder: "例：掷骰检定异常、斯安威斯坦/快速破解/RAM 结算不对、伤势或通缉等级异常……",
  },
  {
    id: "trade",
    label: "交易 / 经济 / 义体 / 物品",
    tag: "bug,economy",
    placeholder: "例：买义体/改枪/付定金后扣款不对、报价单异常、背包负重或物品丢失……",
  },
  {
    id: "npc",
    label: "NPC / 手机 / 委托 / 记忆",
    tag: "bug,world",
    placeholder: "例：NPC 设定穿帮/死人复活、手机私信报错、委托不结算、旧记忆检索不准……",
  },
  {
    id: "image",
    label: "文生图 / 立绘 / 提示词",
    tag: "bug,image",
    placeholder: "例：NAI/中转站生图报错、出图与提示词不符、画幅比例异常、重绘或绑定失败……",
  },
  {
    id: "model",
    label: "模型连接 / 报错 / 预设",
    tag: "bug,provider",
    placeholder: "例：配置中转站后报 400/429/503/空回复、流式输出中断、酒馆预设正则异常……",
  },
  {
    id: "character",
    label: "捏人 / 角色卡 / 存档",
    tag: "bug,save",
    placeholder: "例：捏人主板选模块报错、一键成稿失败、存档导入导出损坏或回溯异常……",
  },
  {
    id: "workshop",
    label: "创意工坊 / 扩展包",
    tag: "bug,workshop",
    placeholder: "例：导入工坊内容包失败、启用后商店/义体医生/NPC 未生效或字段冲突……",
  },
  {
    id: "ui",
    label: "界面 / 地图 / 字体 / 音频",
    tag: "bug,ui",
    placeholder: "例：地图/弹窗按钮被遮挡、人物页排版错位、导入字体不生效或音效异常……",
  },
  {
    id: "idea",
    label: "体验优化 / 新建议",
    tag: "enhancement",
    placeholder: "说说你希望增加或改进的功能、玩法机制或交互体验……",
  },
];

const TURN_COUNTS = [5, 10, 20, 30] as const;

function formatBytes(bytes: number | null): string {
  if (bytes === null) return "未知";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function collectEnvironment(storage: ClientStorageEstimate | null) {
  if (typeof window === "undefined") return {};
  return {
    appVersion: CHANGELOG_ENTRIES[0]?.version ?? "unknown",
    url: `${window.location.origin}${window.location.pathname}`,
    route: `${window.location.pathname}${window.location.search}`,
    online: navigator.onLine,
    userAgent: navigator.userAgent,
    language: navigator.language,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    dpr: window.devicePixelRatio,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    storage,
  };
}

function sanitizeClientPrefs(prefs: NarrativePrefs) {
  return {
    ...prefs,
    imageCustomPrompt: redactPossibleSecrets(prefs.imageCustomPrompt),
    imagePortraitPrompt: redactPossibleSecrets(prefs.imagePortraitPrompt),
    imageScenePrompt: redactPossibleSecrets(prefs.imageScenePrompt),
    imageNegativePrompt: redactPossibleSecrets(prefs.imageNegativePrompt),
    imageAuxInstruction: redactPossibleSecrets(prefs.imageAuxInstruction),
    imageAuxSystemPrompt: redactPossibleSecrets(prefs.imageAuxSystemPrompt),
  };
}

function downloadJson(filename: string, payload: unknown): void {
  const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function buildMarkdownSummary(params: {
  readonly categoryLabel: string;
  readonly title: string;
  readonly description: string;
  readonly steps: string;
  readonly report: RuntimeDiagnosticsReport | undefined;
  readonly clientErrorCount: number;
  readonly apiTraces: readonly ClientApiTrace[];
  readonly storage: ClientStorageEstimate | null;
}): string {
  const { categoryLabel, title, description, steps, report, clientErrorCount, apiTraces, storage } =
    params;
  const env = collectEnvironment(storage);
  const lines: string[] = [];
  lines.push(`## [${categoryLabel}] ${title.trim() || "问题反馈"}`);
  lines.push("");
  if (description.trim()) {
    lines.push("### 现象描述");
    lines.push(redactPossibleSecrets(description.trim()));
    lines.push("");
  }
  if (steps.trim()) {
    lines.push("### 复现步骤");
    lines.push(redactPossibleSecrets(steps.trim()));
    lines.push("");
  }
  lines.push("### 环境与全模块概况");
  lines.push(
    `- 应用版本：\`${env.appVersion ?? "unknown"}\` · 诊断格式：\`${report?.schemaVersion ?? "cp-diagnostic-v2"}\``,
  );
  lines.push(
    `- 视口 / 存储：\`${env.viewport ?? "-"}\` · IndexedDB ${formatBytes(storage?.usageBytes ?? null)} / ${formatBytes(storage?.quotaBytes ?? null)}`,
  );
  if (report) {
    lines.push(
      `- 叙事模型：${report.health.narrator.ready ? `\`${report.health.narrator.model}\`` : `未就绪（${report.health.narrator.error ?? "未知"}）`}`,
    );
    lines.push(
      `- 辅助模型：${report.health.aux.ready ? `\`${report.health.aux.model}\`` : `未就绪（${report.health.aux.error ?? "未知"}）`}`,
    );
    if (report.health.image.ready) {
      lines.push(
        `- 文生图模型：\`${report.health.image.model}\`${report.health.image.protocol ? `（${report.health.image.protocol}）` : ""}`,
      );
    }
    if (report.health.embedding.configured || report.health.reranker.configured) {
      const emb = report.health.embedding.configured
        ? report.health.embedding.ready
          ? `向量 \`${report.health.embedding.model}\``
          : `向量异常（${report.health.embedding.error ?? "未知"}）`
        : "向量未配";
      const rrk = report.health.reranker.configured
        ? report.health.reranker.ready
          ? `重排 \`${report.health.reranker.model}\``
          : `重排异常（${report.health.reranker.error ?? "未知"}）`
        : "重排未配";
      lines.push(`- 检索增强：${emb} · ${rrk}`);
    }
    if (report.activePreset) {
      lines.push(
        `- 写作预设：\`${report.activePreset.name}\`（启用条目 ${report.activePreset.enabledEntries}/${report.activePreset.entryCount} · 启用正则 ${report.activePreset.enabledRegex?.length ?? 0}）`,
      );
    }
    const enabledPacks = (report.workshop?.packs ?? []).filter((p) => p.enabled);
    if (enabledPacks.length > 0) {
      lines.push(
        `- 启用工坊包（${enabledPacks.length}）：${enabledPacks.map((p) => `\`${p.id}\``).join("、")}`,
      );
    }
    if (report.save) {
      const s = report.save.snapshot;
      lines.push(
        `- 关联存档：\`${report.save.meta.title}\`（第 ${s.totalTurns} 轮 · ${s.locationName ?? s.locationId ?? "未知地点"} · ${s.gameTime} · ${s.eddies} €$ · ${s.sliceKeys?.length ?? 0} 个系统切片）`,
      );
      if (report.save.checkpoint) {
        lines.push(`- 挂起断点：\`${report.save.checkpoint.stage}\``);
      }
      if (report.save.commerce.activeQuotes.length > 0) {
        lines.push(`- 活跃报价单：${report.save.commerce.activeQuotes.length} 条`);
      }
    }
    const failedApis = apiTraces.filter((t) => !t.ok);
    lines.push(
      `- 日志统计：运行时日志 ${report.runtimeLogs.length} 条 · API 轨迹 ${apiTraces.length} 条（失败 ${failedApis.length}）· 前端异常 ${clientErrorCount} 条`,
    );
  }

  const failedTraces = apiTraces.filter((t) => !t.ok).slice(-5);
  if (failedTraces.length > 0) {
    lines.push("");
    lines.push("### 最近失败接口调用");
    for (const tr of failedTraces) {
      lines.push(
        `- \`${tr.at.slice(11, 19)}\` \`${tr.method} ${tr.path}\` → HTTP ${tr.status}（${tr.ms}ms）${tr.error ? `：${tr.error.slice(0, 180)}` : ""}`,
      );
    }
  }

  const recentImgWarnings = (report?.images?.recent ?? [])
    .filter((img) => (img.metadata.warnings?.length ?? 0) > 0)
    .slice(0, 3);
  if (recentImgWarnings.length > 0) {
    lines.push("");
    lines.push("### 最近文生图告警");
    for (const img of recentImgWarnings) {
      lines.push(
        `- \`${img.metadata.model}\`（${img.metadata.protocol} · ${img.width}x${img.height}）：${img.metadata.warnings?.join("；")}`,
      );
    }
  }

  if (report?.save && report.save.recentTurns.length > 0) {
    const tail = report.save.recentTurns.slice(-3);
    lines.push("");
    lines.push("### 最近回合关键诊断");
    for (const t of tail) {
      const inputText =
        typeof t.input === "object" && t.input !== null && "text" in t.input
          ? String((t.input as { text?: unknown }).text ?? "")
          : "";
      lines.push(`- **第 ${t.seq} 轮** 输入：「${inputText.slice(0, 80)}」`);
      if (t.decided.length > 0) {
        lines.push(`  - 本轮已定：${t.decided.slice(0, 3).join(" ｜ ").slice(0, 220)}`);
      }
      if (t.dropped.length > 0) {
        lines.push(
          `  - 被拦指令（${t.dropped.length}）：${t.dropped
            .slice(0, 3)
            .map((d) => `${d.where}:${d.reason}`)
            .join("；")
            .slice(0, 220)}`,
        );
      }
      if (t.flags && t.flags.length > 0) {
        lines.push(`  - 守则提醒：${t.flags.slice(0, 2).join("；").slice(0, 180)}`);
      }
      if (t.notes.length > 0) {
        lines.push(`  - 结算备注：${t.notes.slice(0, 2).join("；").slice(0, 180)}`);
      }
    }
  }

  if (report && report.runtimeLogs.length > 0) {
    lines.push("");
    lines.push("### 最近运行日志");
    for (const log of report.runtimeLogs.slice(-5)) {
      lines.push(`- \`${log.at}\` ${log.message.slice(0, 180)}`);
    }
  }

  lines.push("");
  lines.push(
    "> 请将同时导出的 `cp-diag-*.json` 完整诊断日志文件拖入下方附件区，方便定位全游戏任意子系统问题。",
  );
  return lines.join("\n");
}

export function FeedbackPanel({ initialSaveId }: { readonly initialSaveId?: string | null }) {
  const prefs = useNarrativePrefs();
  const savesQuery = useQuery({ queryKey: ["saves"], queryFn: api.saves });
  const saves = savesQuery.data ?? [];
  const [selectedSaveId, setSelectedSaveId] = useState<string>(initialSaveId ?? "");
  const [category, setCategory] = useState<FeedbackCategory>("loop");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [steps, setSteps] = useState("");
  const [turnLimit, setTurnLimit] = useState<(typeof TURN_COUNTS)[number]>(10);
  const [includeWorldState, setIncludeWorldState] = useState(true);
  const [includeThought, setIncludeThought] = useState(true);
  const [includeImages, setIncludeImages] = useState(true);
  const [includePrompt, setIncludePrompt] = useState(true);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [busyExport, setBusyExport] = useState(false);
  const [clientErrors, setClientErrors] = useState(() => getClientDiagnosticErrors());
  const [apiTraces, setApiTraces] = useState(() => getClientApiTraces());
  const [storage, setStorage] = useState<ClientStorageEstimate | null>(null);

  useEffect(() => {
    let active = true;
    void collectStorageEstimate().then((est) => {
      if (active) setStorage(est);
    });
    return () => {
      active = false;
    };
  }, []);

  // 初始未指定存档时自动选中最新存档
  useEffect(() => {
    if (selectedSaveId !== "" || initialSaveId === null) return;
    if (initialSaveId) {
      setSelectedSaveId(initialSaveId);
      return;
    }
    const latest = [...saves].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    if (latest) setSelectedSaveId(latest.id);
  }, [initialSaveId, saves, selectedSaveId]);

  const diagQuery = useQuery({
    queryKey: [
      "diagnostics",
      selectedSaveId,
      turnLimit,
      includeWorldState,
      includeThought,
      includeImages,
      includePrompt,
    ],
    queryFn: () =>
      api.diagnostics({
        saveId: selectedSaveId || null,
        turns: turnLimit,
        includeWorldState,
        includeThought,
        includeImages,
        includePrompt,
      }),
    staleTime: 0,
  });

  const activeCategory = useMemo(
    () => CATEGORIES.find((c) => c.id === category) ?? DEFAULT_CATEGORY,
    [category],
  );

  const buildFullBundle = async () => {
    const [freshReport, freshStorage] = await Promise.all([
      api.diagnostics({
        saveId: selectedSaveId || null,
        turns: turnLimit,
        includeWorldState,
        includeThought,
        includeImages,
        includePrompt,
      }),
      collectStorageEstimate(),
    ]);
    const freshClientErrors = getClientDiagnosticErrors();
    const freshApiTraces = getClientApiTraces();
    setClientErrors(freshClientErrors);
    setApiTraces(freshApiTraces);
    setStorage(freshStorage);
    return {
      schemaVersion: freshReport.schemaVersion,
      exportedAt: new Date().toISOString(),
      feedback: {
        category,
        categoryLabel: activeCategory.label,
        title: redactPossibleSecrets(title.trim()),
        description: redactPossibleSecrets(description.trim()),
        steps: redactPossibleSecrets(steps.trim()),
      },
      environment: collectEnvironment(freshStorage),
      clientPrefs: sanitizeClientPrefs(prefs),
      clientErrors: freshClientErrors,
      clientApiTraces: freshApiTraces,
      runtime: freshReport,
    };
  };

  const handleDownload = async () => {
    setBusyExport(true);
    setStatusMessage(null);
    try {
      const bundle = await buildFullBundle();
      const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const saveTag = selectedSaveId ? selectedSaveId.slice(0, 12) : "nosave";
      const fileName = `cp-diag-${saveTag}-${stamp}.json`;
      downloadJson(fileName, bundle);
      setStatusMessage(
        `已导出全量脱敏诊断包：${fileName}（含全部游戏子系统状态、API 轨迹与生图元数据，不含 API 密钥与图片本体）`,
      );
    } catch (error) {
      setStatusMessage(`导出失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusyExport(false);
    }
  };

  const handleCopyMarkdown = async () => {
    setBusyExport(true);
    setStatusMessage(null);
    try {
      const bundle = await buildFullBundle();
      const md = buildMarkdownSummary({
        categoryLabel: activeCategory.label,
        title,
        description,
        steps,
        report: bundle.runtime,
        clientErrorCount: bundle.clientErrors.length,
        apiTraces: bundle.clientApiTraces,
        storage: bundle.environment.storage ?? null,
      });
      await navigator.clipboard.writeText(md);
      setStatusMessage("已复制 Markdown 反馈摘要，可直接粘贴到 GitHub Issue 或群聊。");
    } catch (error) {
      setStatusMessage(`复制失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusyExport(false);
    }
  };

  const handleOpenGitHub = async () => {
    setBusyExport(true);
    setStatusMessage(null);
    try {
      const bundle = await buildFullBundle();
      const md = buildMarkdownSummary({
        categoryLabel: activeCategory.label,
        title,
        description,
        steps,
        report: bundle.runtime,
        clientErrorCount: bundle.clientErrors.length,
        apiTraces: bundle.clientApiTraces,
        storage: bundle.environment.storage ?? null,
      });
      const issueTitle = `[${activeCategory.label}] ${title.trim() || "请补充简短标题"}`;
      const body =
        md.length > 3500 ? `${md.slice(0, 3500)}\n\n…（摘要已截断，请附上导出 JSON）` : md;
      const url = new URL(GITHUB_ISSUES_NEW);
      url.searchParams.set("title", issueTitle);
      url.searchParams.set("body", body);
      url.searchParams.set("labels", activeCategory.tag);
      window.open(url.toString(), "_blank", "noopener,noreferrer");
      setStatusMessage("已打开 GitHub Issues 页面；建议顺手点左侧「导出诊断日志」并拖入附件。");
    } catch (error) {
      setStatusMessage(`打开失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusyExport(false);
    }
  };

  const report = diagQuery.data;
  const droppedCount = useMemo(
    () => (report?.save?.recentTurns ?? []).reduce((n, t) => n + t.dropped.length, 0),
    [report],
  );
  const failedApiTraces = useMemo(() => apiTraces.filter((t) => !t.ok), [apiTraces]);
  const workshopPacks = report?.workshop?.packs ?? [];
  const enabledWorkshopCount = workshopPacks.filter((p) => p.enabled).length;
  const recentImageCount = report?.images?.recent?.length ?? 0;

  return (
    <div className={styles.feedbackLayout}>
      <Panel title="全游戏问题反馈与诊断包导出" as="section" className={styles.feedbackMain}>
        <p className={styles.feedbackIntro}>
          无论是剧情卡死、战斗/黑客/检定、交易义体、NPC/手机/委托、文生图、捏人存档、工坊扩展、模型预设还是界面显示问题，均可一键导出全量脱敏诊断包（覆盖全部
          35+ 游戏子系统、生图元数据、API 调用轨迹、偏好配置与存储配额，自动剥离所有 API 密钥）。
        </p>

        <div className={styles.feedbackField}>
          <span className={styles.feedbackLabel}>问题所属模块</span>
          <div className={styles.feedbackChips}>
            {CATEGORIES.map((c) => (
              <button
                key={c.id}
                type="button"
                aria-pressed={category === c.id}
                className={styles.feedbackChip}
                data-active={category === c.id || undefined}
                onClick={() => setCategory(c.id)}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        <label className={styles.feedbackField}>
          <span className={styles.feedbackLabel}>简短标题</span>
          <input
            type="text"
            className={styles.feedbackInput}
            value={title}
            maxLength={120}
            placeholder={`[${activeCategory.label}] 用一句话概括遇到了什么`}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>

        <label className={styles.feedbackField}>
          <span className={styles.feedbackLabel}>现象描述</span>
          <textarea
            className={styles.feedbackTextarea}
            rows={4}
            value={description}
            placeholder={activeCategory.placeholder}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>

        <label className={styles.feedbackField}>
          <span className={styles.feedbackLabel}>复现步骤（选填）</span>
          <textarea
            className={styles.feedbackTextarea}
            rows={2}
            value={steps}
            placeholder="1. 先做了什么  2. 输入或点击了什么  3. 预期结果 vs 实际发生了什么"
            onChange={(e) => setSteps(e.target.value)}
          />
        </label>

        <div className={styles.feedbackConfigGrid}>
          <label className={styles.feedbackField}>
            <span className={styles.feedbackLabel}>附带存档诊断</span>
            <select
              className={styles.feedbackSelect}
              value={selectedSaveId}
              onChange={(e) => setSelectedSaveId(e.target.value)}
            >
              <option value="">不附带存档（仅全局配置、生图、工坊与接口轨迹）</option>
              {saves.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}（{s.createdAt.slice(0, 10)}）
                </option>
              ))}
            </select>
          </label>

          <div className={styles.feedbackField}>
            <span className={styles.feedbackLabel}>包含最近回合数</span>
            <div className={styles.feedbackTurnPills}>
              {TURN_COUNTS.map((n) => (
                <button
                  key={n}
                  type="button"
                  className={styles.feedbackChip}
                  data-active={turnLimit === n || undefined}
                  disabled={!selectedSaveId}
                  onClick={() => setTurnLimit(n)}
                >
                  最近 {n} 轮
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className={styles.feedbackChecks}>
          <label className={styles.feedbackCheck}>
            <input
              type="checkbox"
              checked={includeWorldState}
              disabled={!selectedSaveId}
              onChange={(e) => setIncludeWorldState(e.target.checked)}
            />
            <span>
              附带完整世界状态快照（全部 35+
              子系统：战斗/黑客/伤势/义体/背包/经济/NPC/手机/任务/记忆/通缉等）
            </span>
          </label>
          <label className={styles.feedbackCheck}>
            <input
              type="checkbox"
              checked={includeThought}
              disabled={!selectedSaveId}
              onChange={(e) => setIncludeThought(e.target.checked)}
            />
            <span>
              附带模型思维链、骰子检定、记忆召回与抽取考量（强烈推荐，定位误判/漏抽最管用）
            </span>
          </label>
          <label className={styles.feedbackCheck}>
            <input
              type="checkbox"
              checked={includeImages}
              onChange={(e) => setIncludeImages(e.target.checked)}
            />
            <span>
              附带最近 15 条文生图元数据与立绘绑定（含提示词/协议/尺寸/告警，不含图片本体）
            </span>
          </label>
          <label className={styles.feedbackCheck}>
            <input
              type="checkbox"
              checked={includePrompt}
              disabled={!selectedSaveId}
              onChange={(e) => setIncludePrompt(e.target.checked)}
            />
            <span>
              附带最后一轮全阶段完整提示词（①判断 / ③正文 / ④抽取 /
              ⑥场外，可直接还原发给模型的上下文）
            </span>
          </label>
        </div>

        <p className={styles.feedbackPrivacy}>
          隐私保护：导出时由运行时与浏览器双重剥离全部 API 密钥（含
          sk-/nk-/pst-/AIza/Bearer）、请求头与 URL 查询参数，且不导出图片二进制本体。
        </p>

        <div className={styles.feedbackActions}>
          <Button primary disabled={busyExport} onClick={() => void handleDownload()}>
            {busyExport ? "正在打包…" : "导出全量诊断日志 (.json)"}
          </Button>
          <Button disabled={busyExport} onClick={() => void handleCopyMarkdown()}>
            复制 Markdown 摘要
          </Button>
          <Button disabled={busyExport} onClick={() => void handleOpenGitHub()}>
            打开 GitHub Issues 提交
          </Button>
        </div>

        {statusMessage && <p className={styles.feedbackNotice}>{statusMessage}</p>}
      </Panel>

      <Panel title="当前全量诊断快照预览" as="aside" className={styles.feedbackPreview}>
        <div className={styles.feedbackPreviewHead}>
          <span className={styles.feedbackMetaTag}>
            {CHANGELOG_ENTRIES[0]?.version ?? "dev"} · {report?.schemaVersion ?? "v2"}
          </span>
          <Button
            small
            onClick={() => {
              setClientErrors(getClientDiagnosticErrors());
              setApiTraces(getClientApiTraces());
              void collectStorageEstimate().then(setStorage);
              void diagQuery.refetch();
            }}
          >
            刷新快照
          </Button>
        </div>

        {diagQuery.isLoading ? (
          <p className={styles.feedbackDim}>正在采集全游戏运行状态…</p>
        ) : report ? (
          <dl className={styles.feedbackStats}>
            <div>
              <dt>叙事模型</dt>
              <dd data-tone={report.health.narrator.ready ? "ok" : "warn"}>
                {report.health.narrator.ready
                  ? report.health.narrator.model
                  : (report.health.narrator.error ?? "未就绪")}
              </dd>
            </div>
            <div>
              <dt>辅助模型</dt>
              <dd data-tone={report.health.aux.ready ? "ok" : "warn"}>
                {report.health.aux.ready
                  ? report.health.aux.model
                  : (report.health.aux.error ?? "未就绪")}
              </dd>
            </div>
            <div>
              <dt>文生图模型</dt>
              <dd data-tone={report.health.image.ready ? "ok" : undefined}>
                {report.health.image.ready
                  ? `${report.health.image.model}${report.health.image.protocol ? ` (${report.health.image.protocol})` : ""}`
                  : "未启用"}
              </dd>
            </div>
            <div>
              <dt>向量 / 重排</dt>
              <dd
                data-tone={
                  (report.health.embedding.configured && !report.health.embedding.ready) ||
                  (report.health.reranker.configured && !report.health.reranker.ready)
                    ? "warn"
                    : "ok"
                }
              >
                {report.health.embedding.configured
                  ? (report.health.embedding.model ?? "异常")
                  : "未配"}{" "}
                /{" "}
                {report.health.reranker.configured
                  ? (report.health.reranker.model ?? "异常")
                  : "未配"}
              </dd>
            </div>
            <div>
              <dt>写作预设 / 工坊</dt>
              <dd>
                {report.activePreset
                  ? `${report.activePreset.name}（${report.activePreset.enabledEntries}条/${report.activePreset.enabledRegex?.length ?? 0}正则）`
                  : "无预设"}{" "}
                · 工坊 {enabledWorkshopCount}/{workshopPacks.length}
              </dd>
            </div>
            <div>
              <dt>角色卡 / 存档 / 生图</dt>
              <dd>
                角色 {report.characters?.custom ?? 0} 自建 · 存档 {saves.length} · 生图记录{" "}
                {recentImageCount}
              </dd>
            </div>
            {report.save && (
              <>
                <div>
                  <dt>存档状态</dt>
                  <dd>
                    第 {report.save.snapshot.totalTurns} 轮 ·{" "}
                    {report.save.snapshot.locationName ?? report.save.snapshot.locationId ?? "未知"}{" "}
                    · {report.save.snapshot.eddies} €$ ·{" "}
                    {report.save.snapshot.sliceKeys?.length ?? 0} 切片
                  </dd>
                </div>
                <div>
                  <dt>拦截指令 / 报价 / 断点</dt>
                  <dd data-tone={droppedCount > 0 ? "warn" : "ok"}>
                    拦截 {droppedCount} · 报价 {report.save.commerce.activeQuotes.length} · 断点{" "}
                    {report.save.checkpoint ? report.save.checkpoint.stage : "无"}
                  </dd>
                </div>
              </>
            )}
            <div>
              <dt>浏览器存储占用</dt>
              <dd
                data-tone={
                  storage?.usagePercent !== null &&
                  storage?.usagePercent !== undefined &&
                  storage.usagePercent >= 80
                    ? "warn"
                    : "ok"
                }
              >
                {storage
                  ? `${formatBytes(storage.usageBytes)} / ${formatBytes(storage.quotaBytes)}${storage.usagePercent !== null ? ` (${storage.usagePercent}%)` : ""}`
                  : "浏览器未提供"}
              </dd>
            </div>
            <div>
              <dt>接口轨迹 / 运行日志 / 异常</dt>
              <dd
                data-tone={
                  failedApiTraces.length > 0 ||
                  report.runtimeLogs.length > 0 ||
                  clientErrors.length > 0
                    ? "warn"
                    : "ok"
                }
              >
                接口 {apiTraces.length}（败 {failedApiTraces.length}）· 日志{" "}
                {report.runtimeLogs.length} · 异常 {clientErrors.length}
              </dd>
            </div>
          </dl>
        ) : (
          <p className={styles.feedbackDim}>暂时无法读取诊断快照。</p>
        )}

        {failedApiTraces.length > 0 && (
          <div className={styles.feedbackLogBox}>
            <div className={styles.feedbackLogTitleRow}>
              <span className={styles.feedbackLogTitle}>最近失败接口调用</span>
              <Button
                small
                onClick={() => {
                  clearClientApiTraces();
                  setApiTraces([]);
                }}
              >
                清空
              </Button>
            </div>
            <ul>
              {failedApiTraces.slice(-6).map((entry) => (
                <li key={`${entry.at}-${entry.method}-${entry.path}-${entry.status}`}>
                  <code>
                    {entry.at.slice(11, 19)} {entry.status}
                  </code>{" "}
                  {entry.method} {entry.path}
                  {entry.error ? `：${entry.error}` : ""}
                </li>
              ))}
            </ul>
          </div>
        )}

        {(report?.runtimeLogs.length ?? 0) > 0 && (
          <div className={styles.feedbackLogBox}>
            <span className={styles.feedbackLogTitle}>最近运行时日志</span>
            <ul>
              {report?.runtimeLogs.slice(-6).map((entry) => (
                <li key={`${entry.at}-${entry.message.slice(0, 40)}`}>
                  <code>{entry.at.slice(11, 19)}</code> {entry.message}
                </li>
              ))}
            </ul>
          </div>
        )}

        {clientErrors.length > 0 && (
          <div className={styles.feedbackLogBox}>
            <div className={styles.feedbackLogTitleRow}>
              <span className={styles.feedbackLogTitle}>前端捕获异常</span>
              <Button
                small
                onClick={() => {
                  clearClientDiagnosticErrors();
                  setClientErrors([]);
                }}
              >
                清空
              </Button>
            </div>
            <ul>
              {clientErrors.slice(-6).map((entry) => (
                <li key={`${entry.at}-${entry.source}-${entry.message.slice(0, 40)}`}>
                  <code>{entry.source}</code> {entry.message}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Panel>
    </div>
  );
}
