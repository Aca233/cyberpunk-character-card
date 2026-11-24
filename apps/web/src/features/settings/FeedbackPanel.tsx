import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { api, type RuntimeDiagnosticsReport } from "../../api/client";
import {
  clearClientDiagnosticErrors,
  getClientDiagnosticErrors,
  redactPossibleSecrets,
} from "../../api/diagnostics";
import { Button } from "../../ui/Button";
import { Panel } from "../../ui/Panel";
import { CHANGELOG_ENTRIES } from "../menu/changelog";
import styles from "./settings.module.css";

const GITHUB_ISSUES_NEW = "https://github.com/Aca233/cyberpunk-character-card/issues/new";

type FeedbackCategory = "loop" | "trade" | "model" | "ui" | "lore" | "idea";

const DEFAULT_CATEGORY = {
  id: "loop" as const,
  label: "剧情卡死 / 鬼打墙",
  tag: "bug,story",
  placeholder: "例：给老方转 1000 欧破译芯片，连转 5 轮都被各种理由拒收……",
};

const CATEGORIES: readonly {
  readonly id: FeedbackCategory;
  readonly label: string;
  readonly tag: string;
  readonly placeholder: string;
}[] = [
  DEFAULT_CATEGORY,
  {
    id: "trade",
    label: "交易 / 结算异常",
    tag: "bug,economy",
    placeholder: "例：买义体/改枪/付定金后扣款不对，或提示报价不成立……",
  },
  {
    id: "model",
    label: "模型连接 / 报错",
    tag: "bug,provider",
    placeholder: "例：配置中转站后报 400/429/空回复，或流式输出中途断开……",
  },
  {
    id: "ui",
    label: "界面 / 地图 / 显示",
    tag: "bug,ui",
    placeholder: "例：地图/人物页排版错位、按钮点不动、字体异常……",
  },
  {
    id: "lore",
    label: "人物 / 设定问题",
    tag: "bug,content",
    placeholder: "例：某原作 NPC 头像、义体配置、阵营或商店地点与 2077 不符……",
  },
  {
    id: "idea",
    label: "体验优化 / 新建议",
    tag: "enhancement",
    placeholder: "说说你希望增加或改进的功能与交互体验……",
  },
];

const TURN_COUNTS = [5, 10, 20] as const;

function collectEnvironment() {
  if (typeof window === "undefined") return {};
  return {
    appVersion: CHANGELOG_ENTRIES[0]?.version ?? "unknown",
    url: `${window.location.origin}${window.location.pathname}`,
    userAgent: navigator.userAgent,
    language: navigator.language,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    dpr: window.devicePixelRatio,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
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
}): string {
  const { categoryLabel, title, description, steps, report, clientErrorCount } = params;
  const env = collectEnvironment();
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
  lines.push("### 环境与模型概况");
  lines.push(`- 应用版本：\`${env.appVersion ?? "unknown"}\``);
  lines.push(`- 浏览器视口：\`${env.viewport ?? "-"}\``);
  if (report) {
    lines.push(
      `- 叙事模型：${report.health.narrator.ready ? `\`${report.health.narrator.model}\`` : `未就绪（${report.health.narrator.error ?? "未知"}）`}`,
    );
    lines.push(
      `- 辅助模型：${report.health.aux.ready ? `\`${report.health.aux.model}\`` : `未就绪（${report.health.aux.error ?? "未知"}）`}`,
    );
    if (report.activePreset) {
      lines.push(
        `- 写作预设：\`${report.activePreset.name}\`（启用 ${report.activePreset.enabledEntries}/${report.activePreset.entryCount} 条）`,
      );
    }
    if (report.save) {
      const s = report.save.snapshot;
      lines.push(
        `- 关联存档：\`${report.save.meta.title}\`（第 ${s.totalTurns} 轮 · ${s.locationName ?? s.locationId ?? "未知地点"} · ${s.gameTime} · ${s.eddies} €$）`,
      );
      if (report.save.checkpoint) {
        lines.push(`- 挂起断点：\`${report.save.checkpoint.stage}\``);
      }
      if (report.save.commerce.activeQuotes.length > 0) {
        lines.push(`- 活跃报价单：${report.save.commerce.activeQuotes.length} 条`);
      }
    }
    lines.push(
      `- 运行时日志：${report.runtimeLogs.length} 条；前端捕获异常：${clientErrorCount} 条`,
    );
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
  lines.push("> 📎 请将同时导出的 `cp-diag-*.json` 完整诊断日志文件拖入下方附件区，方便快速定位。");
  return lines.join("\n");
}

export function FeedbackPanel({ initialSaveId }: { readonly initialSaveId?: string | null }) {
  const savesQuery = useQuery({ queryKey: ["saves"], queryFn: api.saves });
  const saves = savesQuery.data ?? [];
  const [selectedSaveId, setSelectedSaveId] = useState<string>(initialSaveId ?? "");
  const [category, setCategory] = useState<FeedbackCategory>("loop");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [steps, setSteps] = useState("");
  const [turnLimit, setTurnLimit] = useState<(typeof TURN_COUNTS)[number]>(10);
  const [includeThought, setIncludeThought] = useState(true);
  const [includePrompt, setIncludePrompt] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [busyExport, setBusyExport] = useState(false);
  const [clientErrors, setClientErrors] = useState(() => getClientDiagnosticErrors());

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
    queryKey: ["diagnostics", selectedSaveId, turnLimit, includeThought, includePrompt],
    queryFn: () =>
      api.diagnostics({
        saveId: selectedSaveId || null,
        turns: turnLimit,
        includeThought,
        includePrompt,
      }),
    staleTime: 0,
  });

  const activeCategory = useMemo(
    () => CATEGORIES.find((c) => c.id === category) ?? DEFAULT_CATEGORY,
    [category],
  );

  const buildFullBundle = async () => {
    const freshReport = await api.diagnostics({
      saveId: selectedSaveId || null,
      turns: turnLimit,
      includeThought,
      includePrompt,
    });
    const freshClientErrors = getClientDiagnosticErrors();
    setClientErrors(freshClientErrors);
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
      environment: collectEnvironment(),
      clientErrors: freshClientErrors,
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
      setStatusMessage(`已导出脱敏诊断包：${fileName}（不含任何 API 密钥）`);
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

  return (
    <div className={styles.feedbackLayout}>
      <Panel title="问题反馈与诊断包导出" as="section" className={styles.feedbackMain}>
        <p className={styles.feedbackIntro}>
          遇到剧情卡死、交易结算异常、模型报错或界面问题时，填几句现场说明即可一键导出完整脱敏诊断包（自动剥离全部
          API 密钥与鉴权头），直接发给开发者或提交到 GitHub Issues 即可快速定位。
        </p>

        <div className={styles.feedbackField}>
          <span className={styles.feedbackLabel}>问题类型</span>
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
            placeholder="1. 先做了什么  2. 输入了什么  3. 预期结果 vs 实际发生了什么"
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
              <option value="">不附带存档（仅环境与运行日志）</option>
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
              checked={includeThought}
              disabled={!selectedSaveId}
              onChange={(e) => setIncludeThought(e.target.checked)}
            />
            <span>附带模型思维链（强烈推荐，定位鬼打墙/误判最管用）</span>
          </label>
          <label className={styles.feedbackCheck}>
            <input
              type="checkbox"
              checked={includePrompt}
              disabled={!selectedSaveId}
              onChange={(e) => setIncludePrompt(e.target.checked)}
            />
            <span>附带最后一轮完整发送给模型的提示词（文件体积会变大，排查上下文问题时勾选）</span>
          </label>
        </div>

        <p className={styles.feedbackPrivacy}>
          隐私保护：导出时由运行时强制剥离全部 API 密钥、请求头与 URL
          查询参数，仅保留模型名称、主机路径、脱敏报错与所选回合记录。
        </p>

        <div className={styles.feedbackActions}>
          <Button primary disabled={busyExport} onClick={() => void handleDownload()}>
            {busyExport ? "正在打包…" : "导出诊断日志 (.json)"}
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

      <Panel title="当前诊断快照预览" as="aside" className={styles.feedbackPreview}>
        <div className={styles.feedbackPreviewHead}>
          <span className={styles.feedbackMetaTag}>
            版本 {CHANGELOG_ENTRIES[0]?.version ?? "dev"}
          </span>
          <Button
            small
            onClick={() => {
              setClientErrors(getClientDiagnosticErrors());
              void diagQuery.refetch();
            }}
          >
            刷新快照
          </Button>
        </div>

        {diagQuery.isLoading ? (
          <p className={styles.feedbackDim}>正在采集本地运行状态…</p>
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
              <dt>写作预设</dt>
              <dd>
                {report.activePreset
                  ? `${report.activePreset.name}（${report.activePreset.enabledEntries} 条启用）`
                  : "未启用"}
              </dd>
            </div>
            {report.save && (
              <>
                <div>
                  <dt>存档状态</dt>
                  <dd>
                    第 {report.save.snapshot.totalTurns} 轮 ·{" "}
                    {report.save.snapshot.locationName ?? report.save.snapshot.locationId ?? "未知"}{" "}
                    · {report.save.snapshot.eddies} €$
                  </dd>
                </div>
                <div>
                  <dt>最近拦截指令</dt>
                  <dd data-tone={droppedCount > 0 ? "warn" : "ok"}>{droppedCount} 条</dd>
                </div>
                <div>
                  <dt>活跃报价单 / 断点</dt>
                  <dd>
                    报价 {report.save.commerce.activeQuotes.length} 条 · 断点{" "}
                    {report.save.checkpoint ? report.save.checkpoint.stage : "无"}
                  </dd>
                </div>
              </>
            )}
            <div>
              <dt>运行时日志</dt>
              <dd data-tone={report.runtimeLogs.length > 0 ? "warn" : "ok"}>
                {report.runtimeLogs.length} 条
              </dd>
            </div>
            <div>
              <dt>前端异常捕获</dt>
              <dd data-tone={clientErrors.length > 0 ? "warn" : "ok"}>{clientErrors.length} 条</dd>
            </div>
          </dl>
        ) : (
          <p className={styles.feedbackDim}>暂时无法读取诊断快照。</p>
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
