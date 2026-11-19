import { InstalledWorkshopPackSchema, type WorkshopPack, WorkshopPackSchema } from "@cp/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ChangeEvent, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { api } from "../../api/client";
import { Asset, cssUrl, NineSlice } from "../../ui/Asset";
import { Button } from "../../ui/Button";
import { CellFrame } from "../../ui/FrameBox";
import { ToggleCheck } from "../../ui/ToggleCheck";
import { exportLocalWorkshopPack } from "../characters/creator";
import styles from "./workshop.module.css";

const EMPTY_PACK: WorkshopPack = {
  format: "cp2077-workshop-pack",
  version: 2,
  id: "my-pack",
  title: "我的夜之城内容包",
  author: "",
  description: "",
  modules: [],
  acquaintances: [],
  npcs: [],
  seedNpcs: [],
  items: [],
  cyberware: [],
  braindances: [],
  chipContents: [],
  shopListings: [],
  ripperdocListings: [],
};

function downloadJson(value: unknown, fileName: string) {
  const blob = new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function counts(pack: WorkshopPack): string {
  const groups = [
    ["模块", pack.modules.length],
    ["人脉预设", pack.acquaintances.length],
    ["人物", pack.npcs.length],
    ["物品", pack.items.length],
    ["义体", pack.cyberware.length],
    ["超梦", pack.braindances.length],
    ["芯片资料", pack.chipContents.length],
  ] as const;
  return (
    groups
      .filter(([, count]) => count > 0)
      .map(([label, count]) => `${label} ${count}`)
      .join(" · ") || "空内容包"
  );
}

function previewEntries(pack: WorkshopPack) {
  return [
    ...pack.modules.map((entry) => ({
      key: `module-${entry.id}`,
      label: "模块",
      name: entry.label,
      detail: entry.ability,
    })),
    ...pack.acquaintances.map((entry) => ({
      key: `person-${entry.id}`,
      label: "人脉",
      name: entry.name,
      detail: entry.note,
    })),
    ...pack.npcs.map((entry) => ({
      key: `npc-${entry.id}`,
      label: "NPC",
      name: entry.name,
      detail: entry.role,
    })),
    ...pack.items.map((entry) => ({
      key: `item-${entry.id}`,
      label: entry.kind === "weapon" ? "武器" : "物品",
      name: entry.name,
      detail: entry.ability,
    })),
    ...pack.cyberware.map((entry) => ({
      key: `chrome-${entry.id}`,
      label: "义体",
      name: entry.name,
      detail: entry.ability,
    })),
    ...pack.braindances.map((entry) => ({
      key: `bd-${entry.id}`,
      label: "超梦",
      name: entry.title,
      detail: `${entry.durationMinutes} 分钟 · ${entry.synopsis}`,
    })),
    ...pack.chipContents.map((entry) => ({
      key: `chip-${entry.id}`,
      label: "芯片资料",
      name: entry.title,
      detail: entry.summary,
    })),
  ];
}

export function WorkshopScreen() {
  const navigate = useNavigate();
  const client = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const packages = useQuery({ queryKey: ["workshop"], queryFn: api.workshopPackages });
  const [candidate, setCandidate] = useState<WorkshopPack | null>(null);
  const [validation, setValidation] = useState<Awaited<
    ReturnType<typeof api.validateWorkshopPack>
  > | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const validate = useMutation({
    mutationFn: async (pack: unknown) => {
      const parsed = WorkshopPackSchema.safeParse(pack);
      if (!parsed.success) {
        return {
          pack: null,
          result: {
            valid: false,
            issues: parsed.error.issues.map((issue) => `${issue.path.join(".")}：${issue.message}`),
          } as Awaited<ReturnType<typeof api.validateWorkshopPack>>,
        };
      }
      return { pack: parsed.data, result: await api.validateWorkshopPack(parsed.data) };
    },
    onMutate: () => {
      setValidation(null);
      setError(null);
    },
    onSuccess: ({ pack, result }) => {
      setCandidate(pack);
      setValidation(result);
      setError(pack ? null : result.issues.join("\n"));
    },
    onError: (reason) => {
      setValidation(null);
      setError(reason.message);
    },
  });
  const install = useMutation({
    mutationFn: () => {
      if (!candidate) throw new Error("先选择并校验一个内容包");
      return api.installWorkshopPack(candidate);
    },
    onSuccess: async () => {
      setCandidate(null);
      setValidation(null);
      await client.invalidateQueries({ queryKey: ["workshop"] });
      await client.invalidateQueries({ queryKey: ["characterBoard"] });
    },
    onError: (reason) => setError(reason.message),
  });
  const setEnabled = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.setWorkshopEnabled(id, enabled),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["workshop"] });
      await client.invalidateQueries({ queryKey: ["characterBoard"] });
    },
    onError: (reason) => setError(reason.message),
  });
  const remove = useMutation({
    mutationFn: api.removeWorkshopPack,
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["workshop"] });
      await client.invalidateQueries({ queryKey: ["characterBoard"] });
    },
    onError: (reason) => setError(reason.message),
  });
  const busy =
    reading || validate.isPending || install.isPending || setEnabled.isPending || remove.isPending;

  const readFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || busy) return;
    setReading(true);
    setCandidate(null);
    setValidation(null);
    setError(null);
    try {
      const data: unknown = JSON.parse(await file.text());
      validate.mutate(data);
    } catch {
      setError("所选文件不是合法的 JSON");
    } finally {
      setReading(false);
    }
  };
  const installed = (packages.data ?? [])
    .map((entry) => (InstalledWorkshopPackSchema.safeParse(entry).success ? entry : null))
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  return (
    <main className={styles.screen}>
      <span
        className={styles.bg}
        style={{ backgroundImage: cssUrl("menu.nightCity") }}
        aria-hidden
      />
      <span className={styles.shade} aria-hidden />
      <span
        className={styles.scan}
        style={{ backgroundImage: cssUrl("fx.scanlines") }}
        aria-hidden
      />
      <NineSlice id="panel.frame" tint="var(--cp-red)" slice={120} className={styles.frame} />
      <header className={styles.head}>
        <Asset id="menu.header" tint="var(--cp-red)" height={56} className={styles.headBg} />
        <h1>创意工坊</h1>
        <Asset id="fluff.code" tint="var(--cp-red)" height={14} />
        <span className={styles.spacer} />
        <Button small onClick={() => inputRef.current?.click()} disabled={busy}>
          导入内容包
        </Button>
        <Button small onClick={() => downloadJson(EMPTY_PACK, "cp2077-workshop-pack-v2.json")}>
          下载空白模板
        </Button>
        <Button
          small
          onClick={() => {
            const pack = exportLocalWorkshopPack();
            downloadJson(pack, `${pack.id}.json`);
          }}
        >
          导出自创模块
        </Button>
        <Button small disabled={busy} onClick={() => navigate("/characters")}>
          角色档案
        </Button>
        <Button small disabled={busy} onClick={() => navigate("/menu")}>
          返回主菜单
        </Button>
        <input
          ref={inputRef}
          hidden
          type="file"
          accept=".json,application/json"
          onChange={readFile}
        />
      </header>
      <div className={styles.body}>
        <section className={styles.importArea} aria-label="待导入内容包">
          <CellFrame />
          <div className={styles.sectionHead}>
            <h2>待导入</h2>
            <span>
              {reading
                ? "正在读取文件…"
                : validate.isPending
                  ? "正在校验…"
                  : candidate
                    ? candidate.title
                    : "未选择文件"}
            </span>
          </div>
          {candidate && (
            <>
              <p className={styles.description}>{candidate.description || "无描述"}</p>
              <p className={styles.counts}>{counts(candidate)}</p>
              <details className={styles.preview}>
                <summary>查看包内条目</summary>
                <ul>
                  {previewEntries(candidate).map((entry) => (
                    <li key={entry.key}>
                      <strong>
                        {entry.label} · {entry.name}
                      </strong>
                      {entry.detail && <span>{entry.detail}</span>}
                    </li>
                  ))}
                </ul>
              </details>
              {validation && (
                <div className={styles.validation} data-valid={validation.valid || undefined}>
                  <strong>
                    {validation.valid ? "引用校验通过" : `发现 ${validation.issues.length} 个问题`}
                  </strong>
                  {validation.issues.length > 0 && (
                    <ul>
                      {[...new Set(validation.issues)].map((issue) => (
                        <li key={issue}>{issue}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              <div className={styles.actions}>
                <Button small onClick={() => validate.mutate(candidate)} disabled={busy}>
                  重新校验
                </Button>
                <Button
                  small
                  primary
                  onClick={() => install.mutate()}
                  disabled={!validation?.valid || busy}
                >
                  {install.isPending ? "安装中…" : "安装内容包"}
                </Button>
                <Button
                  small
                  disabled={busy}
                  onClick={() => {
                    setCandidate(null);
                    setValidation(null);
                  }}
                >
                  取消
                </Button>
              </div>
            </>
          )}
        </section>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        {packages.isError && (
          <p className={styles.error} role="alert">
            读取失败：{packages.error.message}
          </p>
        )}
        <section className={styles.packages} aria-label="已安装内容包">
          <div className={styles.sectionHead}>
            <h2>本地内容包</h2>
            <span>{installed.length} 件</span>
          </div>
          <p className={styles.note}>
            启用包用于新建存档；角色已经选用的包会随新存档一并保存。已有存档保留自己的内容快照，之后停用或卸载不会改变该存档。
          </p>
          {packages.isPending && <p className={styles.note}>正在读取内容包…</p>}
          {installed.length === 0 && packages.isSuccess && (
            <p className={styles.note}>尚未安装内容包。</p>
          )}
          <ul className={styles.list}>
            {installed.map(({ pack, enabled }) => (
              <li className={styles.row} key={pack.id}>
                <CellFrame />
                <div className={styles.packInfo}>
                  <div className={styles.packTitle}>
                    <strong>{pack.title}</strong>
                    <code>{pack.id}</code>
                  </div>
                  <p>{counts(pack)}</p>
                  <small>
                    {pack.author || "未署名"}
                    {pack.description ? ` · ${pack.description}` : ""}
                  </small>
                </div>
                <div className={styles.enabled}>
                  <span>启用</span>
                  <ToggleCheck
                    variant="switch"
                    checked={enabled}
                    disabled={busy}
                    aria-label={`启用${pack.title}`}
                    onChange={(next) => setEnabled.mutate({ id: pack.id, enabled: next })}
                  />
                </div>
                <div className={styles.rowActions}>
                  <Button small onClick={() => downloadJson(pack, `${pack.id}.json`)}>
                    导出
                  </Button>
                  <Button
                    small
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm(`卸载「${pack.title}」？已有存档保留该包快照。`))
                        remove.mutate(pack.id);
                    }}
                  >
                    卸载
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
