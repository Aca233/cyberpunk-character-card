import {
  type InstalledWorkshopPack,
  InstalledWorkshopPackSchema,
  type WorkshopPack,
  WorkshopPackSchema,
} from "@cp/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ChangeEvent, type DragEvent, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { api } from "../../api/client";
import { formatDate } from "../../labels";
import { ActionButton } from "../../ui/ActionButton";
import { Asset, cssUrl, NineSlice } from "../../ui/Asset";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { CellFrame, FrameBox } from "../../ui/FrameBox";
import { KeyBar, KeyHint } from "../../ui/KeyHint";
import { useLayer } from "../../ui/layers";
import { ToggleCheck } from "../../ui/ToggleCheck";
import { exportLocalWorkshopPack, loadLocalCustomModules } from "../characters/creator";
import styles from "./workshop.module.css";

const FRAME_SLICE = 120;

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

type EntryCategory =
  | "modules"
  | "acquaintances"
  | "npcs"
  | "seedNpcs"
  | "items"
  | "cyberware"
  | "braindances"
  | "chipContents"
  | "shopListings"
  | "ripperdocListings";

interface PreviewEntry {
  readonly key: string;
  readonly category: EntryCategory;
  readonly label: string;
  readonly name: string;
  readonly id: string;
  readonly detail: string;
}

const CATEGORY_LABELS: Readonly<Record<EntryCategory, string>> = {
  modules: "模块",
  acquaintances: "人脉",
  npcs: "人物",
  seedNpcs: "开局人物",
  items: "物品",
  cyberware: "义体",
  braindances: "超梦",
  chipContents: "芯片资料",
  shopListings: "商店货架",
  ripperdocListings: "诊所货架",
};

const MODULE_SLOT_LABELS: Readonly<Record<string, string>> = {
  origin: "出身",
  skill: "特质",
  past: "过往",
  flaw: "缺陷",
};

function downloadJson(value: unknown, fileName: string) {
  const blob = new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName.replace(/[\\/:*?"<>|]/g, "_");
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function packCategoryCounts(pack: WorkshopPack): readonly {
  readonly key: EntryCategory;
  readonly label: string;
  readonly count: number;
}[] {
  const entries: readonly [EntryCategory, number][] = [
    ["modules", pack.modules.length],
    ["acquaintances", pack.acquaintances.length],
    ["npcs", pack.npcs.length],
    ["seedNpcs", pack.seedNpcs.length],
    ["items", pack.items.length],
    ["cyberware", pack.cyberware.length],
    ["braindances", pack.braindances.length],
    ["chipContents", pack.chipContents.length],
    ["shopListings", pack.shopListings.length],
    ["ripperdocListings", pack.ripperdocListings.length],
  ];
  return entries
    .filter(([, count]) => count > 0)
    .map(([key, count]) => ({ key, label: CATEGORY_LABELS[key], count }));
}

function totalEntries(pack: WorkshopPack): number {
  return (
    pack.modules.length +
    pack.acquaintances.length +
    pack.npcs.length +
    pack.seedNpcs.length +
    pack.items.length +
    pack.cyberware.length +
    pack.braindances.length +
    pack.chipContents.length +
    pack.shopListings.length +
    pack.ripperdocListings.length
  );
}

function previewEntries(pack: WorkshopPack): PreviewEntry[] {
  const npcNameById = new Map(pack.npcs.map((npc) => [npc.id, npc.name]));
  return [
    ...pack.modules.map((entry) => ({
      key: `module-${entry.id}`,
      category: "modules" as const,
      label: MODULE_SLOT_LABELS[entry.slot] ?? "模块",
      name: entry.label,
      id: entry.id,
      detail: entry.ability || entry.hook,
    })),
    ...pack.acquaintances.map((entry) => ({
      key: `person-${entry.id}`,
      category: "acquaintances" as const,
      label: "人脉",
      name: entry.name,
      id: entry.id,
      detail: [entry.role, entry.note].filter(Boolean).join(" · "),
    })),
    ...pack.npcs.map((entry) => ({
      key: `npc-${entry.id}`,
      category: "npcs" as const,
      label: "人物",
      name: entry.alias ? `${entry.name}「${entry.alias}」` : entry.name,
      id: entry.id,
      detail: entry.role,
    })),
    ...pack.seedNpcs.map((id) => ({
      key: `seed-${id}`,
      category: "seedNpcs" as const,
      label: "开局登场",
      name: npcNameById.get(id) ?? id,
      id,
      detail: "新建存档时直接写入城内人物表",
    })),
    ...pack.items.map((entry) => ({
      key: `item-${entry.id}`,
      category: "items" as const,
      label: entry.kind === "weapon" ? "武器" : entry.kind === "mod" ? "改装件" : "物品",
      name: entry.name,
      id: entry.id,
      detail: entry.ability ?? "",
    })),
    ...pack.cyberware.map((entry) => ({
      key: `chrome-${entry.id}`,
      category: "cyberware" as const,
      label: "义体",
      name: entry.name,
      id: entry.id,
      detail: entry.ability ?? "",
    })),
    ...pack.braindances.map((entry) => ({
      key: `bd-${entry.id}`,
      category: "braindances" as const,
      label: "超梦",
      name: entry.title,
      id: entry.id,
      detail: `${entry.durationMinutes} 分钟 · ${entry.synopsis}`,
    })),
    ...pack.chipContents.map((entry) => ({
      key: `chip-${entry.id}`,
      category: "chipContents" as const,
      label: "芯片资料",
      name: entry.title,
      id: entry.id,
      detail: entry.summary,
    })),
    ...pack.shopListings.map((entry, index) => ({
      key: `shop-${entry.shop}-${entry.item}-${index}`,
      category: "shopListings" as const,
      label: "商店货架",
      name: `${entry.shop} → ${entry.item}`,
      id: entry.item,
      detail: `库存 ${entry.stock}`,
    })),
    ...pack.ripperdocListings.map((entry, index) => ({
      key: `clinic-${entry.ripperdoc}-${entry.cyberware}-${index}`,
      category: "ripperdocListings" as const,
      label: "诊所货架",
      name: `${entry.ripperdoc} → ${entry.cyberware}`,
      id: entry.cyberware,
      detail: `库存 ${entry.stock}`,
    })),
  ];
}

function PackEntryBrowser({
  pack,
  compact = false,
}: {
  readonly pack: WorkshopPack;
  readonly compact?: boolean;
}) {
  const [cat, setCat] = useState<EntryCategory | "all">("all");
  const [query, setQuery] = useState("");
  const entries = useMemo(() => previewEntries(pack), [pack]);
  const counts = useMemo(() => packCategoryCounts(pack), [pack]);
  const normalized = query.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      entries.filter((entry) => {
        if (cat !== "all" && entry.category !== cat) return false;
        if (!normalized) return true;
        return `${entry.label} ${entry.name} ${entry.id} ${entry.detail}`
          .toLowerCase()
          .includes(normalized);
      }),
    [entries, cat, normalized],
  );

  if (entries.length === 0) {
    return <p className={styles.note}>这个内容包目前还没有收录任何条目。</p>;
  }

  return (
    <div className={styles.browser}>
      {counts.length > 1 && (
        <fieldset className={styles.filterPills} aria-label="按内容类型筛选">
          <Button small pressed={cat === "all"} onClick={() => setCat("all")}>
            全部 ({entries.length})
          </Button>
          {counts.map((item) => (
            <Button
              key={item.key}
              small
              pressed={cat === item.key}
              onClick={() => setCat(item.key)}
            >
              {item.label} ({item.count})
            </Button>
          ))}
        </fieldset>
      )}
      {entries.length > 5 && (
        <FrameBox className={styles.compactInput}>
          <input
            type="search"
            value={query}
            placeholder="筛选条目名称、id 或说明…"
            aria-label="筛选包内条目"
            onChange={(e) => setQuery(e.target.value)}
          />
        </FrameBox>
      )}
      {filtered.length === 0 ? (
        <p className={styles.note}>没有匹配「{query}」的条目。</p>
      ) : (
        <ul className={styles.entryList} data-compact={compact || undefined}>
          {filtered.map((entry) => (
            <li key={entry.key} className={styles.entryItem}>
              <div className={styles.entryTop}>
                <span className={styles.entryTag}>{entry.label}</span>
                <strong className={styles.entryName}>{entry.name}</strong>
                <code className={styles.entryId}>{entry.id}</code>
              </div>
              {entry.detail && <p className={styles.entryDetail}>{entry.detail}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type StatusFilter = "all" | "enabled" | "disabled";
type RightPaneTab = "import" | "inspect";

export function WorkshopScreen() {
  const navigate = useNavigate();
  const client = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const packages = useQuery({ queryKey: ["workshop"], queryFn: api.workshopPackages });

  const [rightTab, setRightTab] = useState<RightPaneTab>("import");
  const [selectedPackId, setSelectedPackId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const [candidate, setCandidate] = useState<WorkshopPack | null>(null);
  const [validation, setValidation] = useState<Awaited<
    ReturnType<typeof api.validateWorkshopPack>
  > | null>(null);
  const [reading, setReading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [confirmRemove, setConfirmRemove] = useState<InstalledWorkshopPack | null>(null);
  const [notice, setNotice] = useState<{
    readonly tone: "ok" | "error";
    readonly text: string;
  } | null>(null);

  const localModuleCount = useMemo(() => loadLocalCustomModules().length, []);

  const installed = useMemo(
    () =>
      (packages.data ?? [])
        .map((entry) => (InstalledWorkshopPackSchema.safeParse(entry).success ? entry : null))
        .filter((entry): entry is InstalledWorkshopPack => entry !== null),
    [packages.data],
  );

  const enabledPacks = useMemo(() => installed.filter((entry) => entry.enabled), [installed]);
  const enabledEntryTotal = useMemo(
    () => enabledPacks.reduce((sum, entry) => sum + totalEntries(entry.pack), 0),
    [enabledPacks],
  );

  const filteredPacks = useMemo(() => {
    const q = search.trim().toLowerCase();
    return installed.filter((entry) => {
      if (statusFilter === "enabled" && !entry.enabled) return false;
      if (statusFilter === "disabled" && entry.enabled) return false;
      if (!q) return true;
      const hay = `${entry.pack.title} ${entry.pack.id} ${entry.pack.author} ${entry.pack.description}`;
      return hay.toLowerCase().includes(q);
    });
  }, [installed, search, statusFilter]);

  const inspected = useMemo(
    () => installed.find((entry) => entry.pack.id === selectedPackId) ?? installed[0] ?? null,
    [installed, selectedPackId],
  );

  const existingMatch = useMemo(
    () => (candidate ? (installed.find((entry) => entry.pack.id === candidate.id) ?? null) : null),
    [candidate, installed],
  );

  const validate = useMutation({
    mutationFn: async (pack: unknown) => {
      const parsed = WorkshopPackSchema.safeParse(pack);
      if (!parsed.success) {
        return {
          pack: null,
          result: {
            valid: false,
            issues: parsed.error.issues.map((issue) =>
              issue.path.length > 0 ? `${issue.path.join(".")}：${issue.message}` : issue.message,
            ),
          } as Awaited<ReturnType<typeof api.validateWorkshopPack>>,
        };
      }
      return { pack: parsed.data, result: await api.validateWorkshopPack(parsed.data) };
    },
    onMutate: () => {
      setValidation(null);
      setNotice(null);
      setRightTab("import");
    },
    onSuccess: ({ pack, result }) => {
      setCandidate(pack);
      setValidation(result);
      if (!pack) {
        setNotice({ tone: "error", text: result.issues.join("\n") });
      }
    },
    onError: (reason) => {
      setValidation(null);
      setNotice({ tone: "error", text: reason.message });
    },
  });

  const install = useMutation({
    mutationFn: async () => {
      if (!candidate) throw new Error("先选择并校验一个内容包");
      const replacing = Boolean(existingMatch);
      const res = await api.installWorkshopPack(candidate);
      return { res, replacing, title: candidate.title, id: candidate.id };
    },
    onSuccess: async ({ replacing, title, id }) => {
      setCandidate(null);
      setValidation(null);
      setPasteOpen(false);
      setPasteText("");
      setSelectedPackId(id);
      setRightTab("inspect");
      setNotice({
        tone: "ok",
        text: replacing ? `已覆盖更新内容包「${title}」` : `已安装并启用内容包「${title}」`,
      });
      await client.invalidateQueries({ queryKey: ["workshop"] });
      await client.invalidateQueries({ queryKey: ["characterBoard"] });
    },
    onError: (reason) => setNotice({ tone: "error", text: reason.message }),
  });

  const setEnabled = useMutation({
    mutationFn: async ({ id, title, enabled }: { id: string; title: string; enabled: boolean }) => {
      await api.setWorkshopEnabled(id, enabled);
      return { title, enabled };
    },
    onSuccess: async ({ title, enabled }) => {
      setNotice({
        tone: "ok",
        text: enabled ? `已启用「${title}」（新建存档时生效）` : `已停用「${title}」`,
      });
      await client.invalidateQueries({ queryKey: ["workshop"] });
      await client.invalidateQueries({ queryKey: ["characterBoard"] });
    },
    onError: (reason) => setNotice({ tone: "error", text: reason.message }),
  });

  const remove = useMutation({
    mutationFn: async (entry: InstalledWorkshopPack) => {
      await api.removeWorkshopPack(entry.pack.id);
      return entry;
    },
    onSuccess: async (entry) => {
      setConfirmRemove(null);
      if (selectedPackId === entry.pack.id) setSelectedPackId(null);
      setNotice({
        tone: "ok",
        text: `已卸载「${entry.pack.title}」（已有存档保留其内容快照）`,
      });
      await client.invalidateQueries({ queryKey: ["workshop"] });
      await client.invalidateQueries({ queryKey: ["characterBoard"] });
    },
    onError: (reason) => setNotice({ tone: "error", text: reason.message }),
  });

  const busy =
    reading || validate.isPending || install.isPending || setEnabled.isPending || remove.isPending;

  useLayer(() => setPasteOpen(false), pasteOpen && !confirmRemove);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (e.target instanceof HTMLElement && e.target.closest("input, textarea, select")) return;
      navigate("/menu");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);

  const parseAndValidate = (rawText: string) => {
    setCandidate(null);
    setValidation(null);
    setNotice(null);
    try {
      const data: unknown = JSON.parse(rawText);
      validate.mutate(data);
    } catch {
      setNotice({ tone: "error", text: "输入内容不是合法的 JSON，请检查括号与引号格式" });
    }
  };

  const handleFile = async (file: File | undefined) => {
    if (!file || busy) return;
    setReading(true);
    try {
      parseAndValidate(await file.text());
    } finally {
      setReading(false);
    }
  };

  const readFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    await handleFile(file);
  };

  const onDragOver = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    if (!busy) setDragOver(true);
  };

  const onDragLeave = (event: DragEvent<HTMLElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setDragOver(false);
    }
  };

  const onDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setDragOver(false);
    const file = event.dataTransfer.files?.[0];
    void handleFile(file);
  };

  const tabLineMask = cssUrl("tab.line");

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
      <NineSlice
        id="panel.frame"
        tint="var(--cp-red)"
        slice={FRAME_SLICE}
        className={styles.frame}
      />

      <header className={styles.head}>
        <Asset id="menu.header" tint="var(--cp-red)" height={52} className={styles.headBg} />
        <Asset id="panel.glowLeft" height={28} tint="var(--cp-cyan)" className={styles.headGlow} />
        <div className={styles.headTitleWrap}>
          <span className={styles.headCode}>{"WK // WORKSHOP"}</span>
          <h1>创意工坊</h1>
        </div>
        <Asset id="fluff.code" tint="var(--cp-red)" height={16} className={styles.headFluff} />
        <span className={styles.spacer} />
        <Button small disabled={busy} onClick={() => navigate("/characters")}>
          角色档案
        </Button>
        <Button small keyId="key.esc" disabled={busy} onClick={() => navigate("/menu")}>
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

      <span
        className={styles.headLine}
        style={{ maskImage: tabLineMask, WebkitMaskImage: tabLineMask }}
        aria-hidden
      />

      <div className={styles.workspace}>
        {/* ———— 顶部概览状态条 ———— */}
        <section className={styles.telemetryBar} aria-label="工坊概览">
          <div className={styles.statCards}>
            <div className={styles.statCard}>
              <CellFrame />
              <span className={styles.statKey}>已安装内容包</span>
              <strong className={`${styles.statVal} num`}>{installed.length}</strong>
            </div>
            <div
              className={styles.statCard}
              data-accent={enabledPacks.length > 0 ? "cyan" : undefined}
            >
              <CellFrame />
              <span className={styles.statKey}>当前已启用</span>
              <strong className={`${styles.statVal} num`}>{enabledPacks.length}</strong>
            </div>
            <div className={styles.statCard}>
              <CellFrame />
              <span className={styles.statKey}>启用包注入条目</span>
              <strong className={`${styles.statVal} num`}>{enabledEntryTotal}</strong>
            </div>
          </div>
          <p className={styles.telemetryNote}>
            启用包会自动注入创角目录与新建存档；已有存档保留独立内容快照，后续停用或卸载不影响旧档。
          </p>
        </section>

        {notice && (
          <div
            className={styles.banner}
            data-tone={notice.tone}
            role={notice.tone === "error" ? "alert" : "status"}
          >
            <CellFrame />
            <p className={styles.bannerText}>{notice.text}</p>
            <ActionButton onClick={() => setNotice(null)}>关闭</ActionButton>
          </div>
        )}

        {packages.isError && (
          <div className={styles.banner} data-tone="error" role="alert">
            <CellFrame />
            <p className={styles.bannerText}>读取本地内容包失败：{packages.error.message}</p>
            <Button small onClick={() => void packages.refetch()}>
              重试
            </Button>
          </div>
        )}

        {/* ———— 主双栏工作区：左列本地内容包，右列导入/检视工作台 ———— */}
        <div className={styles.split}>
          <section className={styles.pane} aria-label="本地内容包">
            <NineSlice
              id="notify.itemCellBg"
              tint="rgb(8 8 14 / 86%)"
              slice={30}
              className={styles.paneLayer}
            />
            <NineSlice
              id="notify.itemCellFg"
              tint="var(--cp-red-dim)"
              slice={30}
              className={styles.paneLayer}
            />
            <div className={styles.paneHead}>
              <div className={styles.paneTitleGroup}>
                <h2>本地内容包</h2>
                <span className={styles.paneCount}>
                  {filteredPacks.length} / {installed.length} 件
                </span>
              </div>
              <Button
                small
                primary
                disabled={busy}
                onClick={() => {
                  setRightTab("import");
                  inputRef.current?.click();
                }}
              >
                ＋ 导入内容包
              </Button>
            </div>

            <div className={styles.listTools}>
              <FrameBox className={styles.searchBox}>
                <input
                  type="search"
                  value={search}
                  placeholder="搜索包名、id、作者或简介…"
                  aria-label="搜索已安装内容包"
                  onChange={(e) => setSearch(e.target.value)}
                />
              </FrameBox>
              <fieldset className={styles.filterPills} aria-label="按启用状态筛选">
                <Button
                  small
                  pressed={statusFilter === "all"}
                  onClick={() => setStatusFilter("all")}
                >
                  全部 ({installed.length})
                </Button>
                <Button
                  small
                  pressed={statusFilter === "enabled"}
                  onClick={() => setStatusFilter("enabled")}
                >
                  已启用 ({enabledPacks.length})
                </Button>
                <Button
                  small
                  pressed={statusFilter === "disabled"}
                  onClick={() => setStatusFilter("disabled")}
                >
                  已停用 ({installed.length - enabledPacks.length})
                </Button>
              </fieldset>
            </div>

            <div className={styles.paneScroll}>
              {packages.isPending && <p className={styles.note}>正在读取本地内容包…</p>}
              {packages.isSuccess && installed.length === 0 && (
                <div className={styles.emptyCard}>
                  <CellFrame />
                  <strong>还没有安装任何内容包</strong>
                  <p className={styles.note}>
                    拖入或选择 `.json` 内容包文件即可安装，也可以在右侧下载 v2 空白模板自行创作。
                  </p>
                  <div className={styles.actions}>
                    <Button small primary onClick={() => inputRef.current?.click()}>
                      选择内容包 JSON
                    </Button>
                    <Button
                      small
                      onClick={() => {
                        downloadJson(EMPTY_PACK, "cp2077-workshop-pack-v2.json");
                        setNotice({
                          tone: "ok",
                          text: "已下载空白模板 cp2077-workshop-pack-v2.json",
                        });
                      }}
                    >
                      下载空白模板
                    </Button>
                  </div>
                </div>
              )}
              {packages.isSuccess && installed.length > 0 && filteredPacks.length === 0 && (
                <div className={styles.emptyCard}>
                  <CellFrame />
                  <p className={styles.note}>当前筛选条件下没有匹配的内容包。</p>
                  <Button
                    small
                    onClick={() => {
                      setSearch("");
                      setStatusFilter("all");
                    }}
                  >
                    重置筛选
                  </Button>
                </div>
              )}
              <ul className={styles.list}>
                {filteredPacks.map((entry) => {
                  const { pack, enabled, installedAt } = entry;
                  const selected = rightTab === "inspect" && inspected?.pack.id === pack.id;
                  const chips = packCategoryCounts(pack);
                  return (
                    <li
                      key={pack.id}
                      className={styles.row}
                      data-selected={selected || undefined}
                      data-enabled={enabled || undefined}
                    >
                      <CellFrame />
                      <div className={styles.rowMain}>
                        <div className={styles.packHeader}>
                          <button
                            type="button"
                            className={styles.packSelect}
                            onClick={() => {
                              setSelectedPackId(pack.id);
                              setRightTab("inspect");
                            }}
                          >
                            <strong className={styles.packName}>{pack.title}</strong>
                            <code className={styles.packId}>{pack.id}</code>
                          </button>
                          <span className={styles.statePill} data-on={enabled || undefined}>
                            {enabled ? "已启用" : "已停用"}
                          </span>
                        </div>

                        <p className={styles.packMeta}>
                          <span>{pack.author || "未署名作者"}</span>
                          <span>·</span>
                          <span>安装于 {formatDate(installedAt)}</span>
                        </p>

                        {pack.description && <p className={styles.packDesc}>{pack.description}</p>}

                        <div className={styles.chipRow}>
                          {chips.length > 0 ? (
                            chips.map((c) => (
                              <span key={c.key} className={styles.chip}>
                                {c.label} {c.count}
                              </span>
                            ))
                          ) : (
                            <span className={styles.chip}>空内容包</span>
                          )}
                        </div>
                      </div>

                      <div className={styles.rowSide}>
                        <div className={styles.enabledControl}>
                          <span>{enabled ? "启用中" : "已停用"}</span>
                          <ToggleCheck
                            variant="switch"
                            checked={enabled}
                            disabled={busy}
                            aria-label={`启用${pack.title}`}
                            onChange={(next) =>
                              setEnabled.mutate({ id: pack.id, title: pack.title, enabled: next })
                            }
                          />
                        </div>
                        <div className={styles.rowActions}>
                          <Button
                            small
                            pressed={selected}
                            onClick={() => {
                              setSelectedPackId(pack.id);
                              setRightTab("inspect");
                            }}
                          >
                            查看条目
                          </Button>
                          <Button
                            small
                            onClick={() => {
                              downloadJson(pack, `${pack.id}.json`);
                              setNotice({
                                tone: "ok",
                                text: `已导出「${pack.title}」(${pack.id}.json)`,
                              });
                            }}
                          >
                            导出
                          </Button>
                          <Button small disabled={busy} onClick={() => setConfirmRemove(entry)}>
                            卸载
                          </Button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          </section>

          <section className={styles.pane} aria-label="导入与内容包检视">
            <NineSlice
              id="notify.itemCellBg"
              tint="rgb(8 8 14 / 88%)"
              slice={30}
              className={styles.paneLayer}
            />
            <NineSlice
              id="notify.itemCellFg"
              tint="var(--cp-cyan-dim)"
              slice={30}
              className={styles.paneLayer}
            />
            <div className={styles.paneHead}>
              <div className={styles.tabSwitch} role="tablist" aria-label="工作台视图">
                <Button
                  small
                  primary={rightTab === "import"}
                  pressed={rightTab === "import"}
                  onClick={() => setRightTab("import")}
                >
                  导入与制作
                </Button>
                <Button
                  small
                  primary={rightTab === "inspect"}
                  pressed={rightTab === "inspect"}
                  disabled={!inspected}
                  reason="安装至少一个内容包后可查看包内条目"
                  onClick={() => setRightTab("inspect")}
                >
                  内容包检视
                </Button>
              </div>
              {rightTab === "import" && candidate && (
                <span className={styles.paneCount}>待校验：{candidate.id}</span>
              )}
              {rightTab === "inspect" && inspected && (
                <span className={styles.paneCount}>{totalEntries(inspected.pack)} 项条目</span>
              )}
            </div>

            <div className={styles.paneScroll}>
              {rightTab === "import" ? (
                <div className={styles.workbenchCol}>
                  <section
                    className={styles.dropzone}
                    data-drag={dragOver || undefined}
                    aria-label="拖放或选择内容包"
                    onDragOver={onDragOver}
                    onDragLeave={onDragLeave}
                    onDrop={onDrop}
                  >
                    <CellFrame />
                    <div className={styles.dropHead}>
                      <strong>
                        {reading
                          ? "正在读取文件内容…"
                          : validate.isPending
                            ? "正在执行结构与引用校验…"
                            : dragOver
                              ? "松开鼠标以读取内容包"
                              : "拖入内容包 JSON，或点击下方选择文件"}
                      </strong>
                      <p className={styles.note}>
                        支持 `cp2077-workshop-pack` v2
                        格式；导入前会自动校验所有物品、义体、NPC、超梦与商店引用。
                      </p>
                    </div>
                    <div className={styles.actions}>
                      <Button
                        small
                        primary
                        disabled={busy}
                        onClick={() => inputRef.current?.click()}
                      >
                        选择本地 JSON 文件
                      </Button>
                      <Button
                        small
                        pressed={pasteOpen}
                        disabled={busy}
                        onClick={() => setPasteOpen((open) => !open)}
                      >
                        {pasteOpen ? "收起粘贴框" : "粘贴 JSON 文本"}
                      </Button>
                    </div>

                    {pasteOpen && (
                      <div className={styles.pasteBox}>
                        <FrameBox className={styles.pasteFrame}>
                          <textarea
                            rows={6}
                            value={pasteText}
                            placeholder='在此粘贴完整的内容包 JSON（format: "cp2077-workshop-pack", version: 2）…'
                            aria-label="粘贴内容包 JSON"
                            onChange={(e) => setPasteText(e.target.value)}
                            onKeyDown={(e) => {
                              if (
                                (e.ctrlKey || e.metaKey) &&
                                e.key === "Enter" &&
                                pasteText.trim()
                              ) {
                                e.preventDefault();
                                parseAndValidate(pasteText);
                              }
                            }}
                          />
                        </FrameBox>
                        <div className={styles.actions}>
                          <Button
                            small
                            primary
                            disabled={busy || pasteText.trim() === ""}
                            onClick={() => parseAndValidate(pasteText)}
                          >
                            解析并校验 (Ctrl+Enter)
                          </Button>
                          <Button
                            small
                            disabled={busy || pasteText === ""}
                            onClick={() => setPasteText("")}
                          >
                            清空文本
                          </Button>
                        </div>
                      </div>
                    )}
                  </section>

                  {candidate && (
                    <section className={styles.candidateCard} aria-label="待安装内容包校验结果">
                      <CellFrame />
                      <div className={styles.packHeader}>
                        <div className={styles.packTitleWrap}>
                          <strong className={styles.packName}>{candidate.title}</strong>
                          <code className={styles.packId}>{candidate.id}</code>
                        </div>
                        <span className={styles.paneCount}>
                          {candidate.author || "未署名作者"} · {totalEntries(candidate)} 项条目
                        </span>
                      </div>

                      {candidate.description && (
                        <p className={styles.packDesc}>{candidate.description}</p>
                      )}

                      {existingMatch && (
                        <div className={styles.overwriteWarn} role="status">
                          <strong>将覆盖本地已有内容包「{existingMatch.pack.title}」</strong>
                          <span>
                            同 ID（{candidate.id}）内容包将被更新为新版本；已有存档快照不受影响。
                          </span>
                        </div>
                      )}

                      {validation && (
                        <div
                          className={styles.validation}
                          data-valid={validation.valid || undefined}
                        >
                          <strong>
                            {validation.valid
                              ? "✓ 结构与引用校验通过，可以安装"
                              : `⚠ 发现 ${validation.issues.length} 个校验问题`}
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

                      <PackEntryBrowser key={candidate.id} pack={candidate} compact />

                      <div className={styles.actions}>
                        <Button
                          small
                          primary
                          disabled={!validation?.valid || busy}
                          reason={!validation?.valid ? "请先修复所有校验问题" : undefined}
                          onClick={() => install.mutate()}
                        >
                          {install.isPending
                            ? "安装中…"
                            : existingMatch
                              ? "覆盖更新内容包"
                              : "安装并启用内容包"}
                        </Button>
                        <Button small disabled={busy} onClick={() => validate.mutate(candidate)}>
                          重新校验
                        </Button>
                        <Button
                          small
                          disabled={busy}
                          onClick={() => {
                            setCandidate(null);
                            setValidation(null);
                          }}
                        >
                          放弃待导入项
                        </Button>
                      </div>
                    </section>
                  )}

                  <section className={styles.toolkitCard} aria-label="内容创作工具">
                    <CellFrame />
                    <div className={styles.toolkitHead}>
                      <h3>创作与打包工具</h3>
                      <span className={styles.paneCount}>v2 协议</span>
                    </div>
                    <p className={styles.note}>
                      需要自己编写内容包或分享你在角色工作台里创作的出身、特质和缺陷？可以直接导出模板或打包本地自创模块。
                    </p>
                    <div className={styles.actions}>
                      <Button
                        small
                        onClick={() => {
                          downloadJson(EMPTY_PACK, "cp2077-workshop-pack-v2.json");
                          setNotice({
                            tone: "ok",
                            text: "已下载空白内容包模板 cp2077-workshop-pack-v2.json",
                          });
                        }}
                      >
                        下载空白模板 (v2)
                      </Button>
                      <Button
                        small
                        disabled={localModuleCount === 0}
                        reason="你在角色工作台里还没有创建任何自定义模块"
                        onClick={() => {
                          const pack = exportLocalWorkshopPack();
                          downloadJson(pack, `${pack.id}.json`);
                          setNotice({
                            tone: "ok",
                            text: `已打包导出 ${localModuleCount} 个本地自创模块 (${pack.id}.json)`,
                          });
                        }}
                      >
                        导出自创模块 ({localModuleCount})
                      </Button>
                    </div>
                  </section>
                </div>
              ) : inspected ? (
                <div className={styles.workbenchCol}>
                  <section className={styles.inspectCard} aria-label="已安装内容包详情">
                    <CellFrame />
                    <div className={styles.packHeader}>
                      <div className={styles.packTitleWrap}>
                        <strong className={styles.packName}>{inspected.pack.title}</strong>
                        <code className={styles.packId}>{inspected.pack.id}</code>
                      </div>
                      <span className={styles.statePill} data-on={inspected.enabled || undefined}>
                        {inspected.enabled ? "已启用" : "已停用"}
                      </span>
                    </div>
                    <p className={styles.packMeta}>
                      <span>作者：{inspected.pack.author || "未署名"}</span>
                      <span>·</span>
                      <span>安装时间：{formatDate(inspected.installedAt)}</span>
                    </p>
                    <p className={styles.packDesc}>
                      {inspected.pack.description || "这个内容包没有填写简介。"}
                    </p>
                    <div className={styles.actions}>
                      <Button
                        small
                        primary={!inspected.enabled}
                        disabled={busy}
                        onClick={() =>
                          setEnabled.mutate({
                            id: inspected.pack.id,
                            title: inspected.pack.title,
                            enabled: !inspected.enabled,
                          })
                        }
                      >
                        {inspected.enabled ? "停用此包" : "启用此包"}
                      </Button>
                      <Button
                        small
                        onClick={() => {
                          downloadJson(inspected.pack, `${inspected.pack.id}.json`);
                          setNotice({
                            tone: "ok",
                            text: `已导出「${inspected.pack.title}」(${inspected.pack.id}.json)`,
                          });
                        }}
                      >
                        导出 JSON
                      </Button>
                      <Button small disabled={busy} onClick={() => setConfirmRemove(inspected)}>
                        卸载
                      </Button>
                    </div>
                  </section>

                  <section className={styles.inspectEntries} aria-label="包内条目清单">
                    <div className={styles.toolkitHead}>
                      <h3>包内收录条目</h3>
                      <span className={styles.paneCount}>共 {totalEntries(inspected.pack)} 项</span>
                    </div>
                    <PackEntryBrowser key={inspected.pack.id} pack={inspected.pack} />
                  </section>
                </div>
              ) : (
                <p className={styles.note}>在左侧选择任意已安装内容包以查看收录条目。</p>
              )}
            </div>
          </section>
        </div>
      </div>

      <div className={styles.keys}>
        <KeyBar>
          <KeyHint keyId="key.esc" label="返回主菜单" onClick={() => navigate("/menu")} />
        </KeyBar>
      </div>

      {confirmRemove && (
        <Dialog
          title={`卸载「${confirmRemove.pack.title}」？`}
          tone="danger"
          onClose={() => {
            if (!remove.isPending) setConfirmRemove(null);
          }}
          actions={
            <>
              <Button disabled={remove.isPending} onClick={() => setConfirmRemove(null)}>
                取消
              </Button>
              <Button
                primary
                disabled={remove.isPending}
                onClick={() => remove.mutate(confirmRemove)}
              >
                {remove.isPending ? "卸载中…" : "确认卸载"}
              </Button>
            </>
          }
        >
          <p>
            内容包 <code>{confirmRemove.pack.id}</code> 将从本地创意工坊移除，新建存档不再加载其中的
            {totalEntries(confirmRemove.pack)} 项条目。已有存档仍会保留各自的完整快照。
          </p>
        </Dialog>
      )}
    </main>
  );
}
