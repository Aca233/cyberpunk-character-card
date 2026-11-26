import {
  type CharacterCard,
  type CommunityWorkshopSummary,
  cyberwareRules,
  type InstalledWorkshopPack,
  InstalledWorkshopPackSchema,
  type WorkshopPack,
} from "@cp/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { api } from "../../api/client";
import {
  type CommunityCategoryFilter,
  type CommunitySortKey,
  CommunityWorkshopError,
  communityCoverUrl,
  communityWorkshopApi,
  loadCommunityEditTokens,
  removeCommunityEditToken,
  saveCommunityEditToken,
} from "../../api/communityWorkshop";
import { formatDate } from "../../labels";
import { ActionButton } from "../../ui/ActionButton";
import { Asset, cssUrl, NineSlice } from "../../ui/Asset";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { CellFrame, FrameBox } from "../../ui/FrameBox";
import { KeyBar, KeyHint } from "../../ui/KeyHint";
import { useLayer } from "../../ui/layers";
import { ToggleCheck } from "../../ui/ToggleCheck";
import { ShellBackdrop } from "../theme/ShellBackdrop";
import {
  type PublishSourceTab,
  type PublishSubmitPayload,
  WorkshopPublishModal,
} from "./WorkshopPublishModal";
import styles from "./workshop.module.css";

type MainView = "market" | "library";
type StatusFilter = "all" | "enabled" | "disabled";

type EntryCategory =
  | "characters"
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
  characters: "角色卡",
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

const COMMUNITY_CATEGORIES: readonly {
  readonly id: CommunityCategoryFilter;
  readonly label: string;
}[] = [
  { id: "all", label: "全部" },
  { id: "characters", label: "角色卡" },
  { id: "cyberware", label: "义体" },
  { id: "items", label: "武器与物品" },
  { id: "npcs", label: "人物与人脉" },
  { id: "modules", label: "出身与特质" },
  { id: "media", label: "超梦与芯片" },
];

const COMMUNITY_SORTS: readonly { readonly id: CommunitySortKey; readonly label: string }[] = [
  { id: "popular", label: "最多订阅" },
  { id: "newest", label: "最新发布" },
  { id: "updated", label: "最近更新" },
];

function downloadJson(value: unknown, fileName: string) {
  const blob = new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName.replace(/[\\/:*?"<>|]/g, "_");
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(bytes >= 10 * 1024 ? 0 : 1)} KB`;
}

function packCategoryCounts(pack: WorkshopPack): readonly {
  readonly key: EntryCategory;
  readonly label: string;
  readonly count: number;
}[] {
  const entries: readonly [EntryCategory, number][] = [
    ["characters", pack.characters.length],
    ["cyberware", pack.cyberware.length],
    ["items", pack.items.length],
    ["modules", pack.modules.length],
    ["npcs", pack.npcs.length],
    ["acquaintances", pack.acquaintances.length],
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
    pack.characters.length +
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

function communitySummaryChips(summary: CommunityWorkshopSummary["summary"]): readonly string[] {
  const out: string[] = [];
  if (summary.characters > 0) out.push(`角色卡 ${summary.characters}`);
  if (summary.cyberware > 0) out.push(`义体 ${summary.cyberware}`);
  if (summary.weapons > 0) out.push(`武器 ${summary.weapons}`);
  const otherItems = summary.items - summary.weapons;
  if (otherItems > 0) out.push(`物品 ${otherItems}`);
  if (summary.modules > 0) out.push(`模块 ${summary.modules}`);
  if (summary.npcs > 0) out.push(`人物 ${summary.npcs}`);
  if (summary.acquaintances > 0) out.push(`人脉 ${summary.acquaintances}`);
  if (summary.braindances > 0) out.push(`超梦 ${summary.braindances}`);
  if (summary.chipContents > 0) out.push(`芯片 ${summary.chipContents}`);
  if (summary.listings > 0) out.push(`货架 ${summary.listings}`);
  return out;
}

function primaryBadgeForSummary(summary: CommunityWorkshopSummary["summary"]): string {
  if (summary.characters > 0) return "CHARACTER CARD";
  if (summary.cyberware > 0) return "CYBERWARE";
  if (summary.weapons > 0 || summary.items > 0) return "ARSENAL & GEAR";
  if (summary.npcs > 0 || summary.acquaintances > 0) return "NIGHT CITY CAST";
  if (summary.modules > 0) return "LIFEPATH & TRAITS";
  if (summary.braindances > 0 || summary.chipContents > 0) return "BD & SHARDS";
  return "WORKSHOP PACK";
}

function previewEntries(pack: WorkshopPack): PreviewEntry[] {
  const npcNameById = new Map(pack.npcs.map((npc) => [npc.id, npc.name]));
  return [
    ...pack.cyberware.map((entry, index) => ({
      key: `chrome-${entry.id}-${index}`,
      category: "cyberware" as const,
      label: cyberwareRules.CYBERWARE_CATEGORY_LABELS[cyberwareRules.cyberwareCategoryOf(entry)],
      name: entry.name,
      id: entry.id,
      detail: entry.ability ?? "",
    })),
    ...pack.items.map((entry, index) => ({
      key: `item-${entry.id}-${index}`,
      category: "items" as const,
      label: entry.kind === "weapon" ? "武器" : entry.kind === "mod" ? "改装件" : "物品",
      name: entry.name,
      id: entry.id,
      detail: entry.ability ?? "",
    })),
    ...pack.modules.map((entry, index) => ({
      key: `module-${entry.id}-${index}`,
      category: "modules" as const,
      label: MODULE_SLOT_LABELS[entry.slot] ?? "模块",
      name: entry.label,
      id: entry.id,
      detail: entry.ability || entry.hook,
    })),
    ...pack.npcs.map((entry, index) => ({
      key: `npc-${entry.id}-${index}`,
      category: "npcs" as const,
      label: "人物",
      name: entry.alias ? `${entry.name}「${entry.alias}」` : entry.name,
      id: entry.id,
      detail: entry.role,
    })),
    ...pack.seedNpcs.map((id, index) => ({
      key: `seed-${id}-${index}`,
      category: "seedNpcs" as const,
      label: "开局登场",
      name: npcNameById.get(id) ?? id,
      id,
      detail: "新建存档时直接写入城内人物表",
    })),
    ...pack.acquaintances.map((entry, index) => ({
      key: `person-${entry.id}-${index}`,
      category: "acquaintances" as const,
      label: "人脉",
      name: entry.name,
      id: entry.id,
      detail: [entry.role, entry.note].filter(Boolean).join(" · "),
    })),
    ...pack.braindances.map((entry, index) => ({
      key: `bd-${entry.id}-${index}`,
      category: "braindances" as const,
      label: "超梦",
      name: entry.title,
      id: entry.id,
      detail: `${entry.durationMinutes} 分钟 · ${entry.synopsis}`,
    })),
    ...pack.chipContents.map((entry, index) => ({
      key: `chip-${entry.id}-${index}`,
      category: "chipContents" as const,
      label: "芯片资料",
      name: entry.title,
      id: entry.id,
      detail: entry.summary,
    })),
    ...pack.shopListings.map((entry, index) => ({
      key: `shop-${entry.shop}-${entry.item}-${index}`,
      category: "shopListings" as const,
      label: "商店上架",
      name: `${entry.shop} → ${entry.item}`,
      id: entry.item,
      detail: `库存 ${entry.stock}`,
    })),
    ...pack.ripperdocListings.map((entry, index) => ({
      key: `clinic-${entry.ripperdoc}-${entry.cyberware}-${index}`,
      category: "ripperdocListings" as const,
      label: "诊所上架",
      name: `${entry.ripperdoc} → ${entry.cyberware}`,
      id: entry.cyberware,
      detail: `库存 ${entry.stock}`,
    })),
  ];
}

function PackEntryBrowser({ pack }: { readonly pack: WorkshopPack }) {
  const [cat, setCat] = useState<EntryCategory | "all">("all");
  const [query, setQuery] = useState("");
  const entries = useMemo(() => previewEntries(pack), [pack]);
  const counts = useMemo(() => {
    const map = new Map<EntryCategory, number>();
    for (const e of entries) map.set(e.category, (map.get(e.category) ?? 0) + 1);
    return [...map.entries()].map(([key, count]) => ({
      key,
      label: CATEGORY_LABELS[key],
      count,
    }));
  }, [entries]);
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

  if (entries.length === 0) return null;

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
      {entries.length > 6 && (
        <FrameBox className={styles.compactInput}>
          <input
            type="search"
            value={query}
            placeholder="筛选条目名称或说明…"
            aria-label="筛选包内条目"
            onChange={(e) => setQuery(e.target.value)}
          />
        </FrameBox>
      )}
      <ul className={styles.entryList} data-compact>
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
    </div>
  );
}

export function WorkshopScreen() {
  const navigate = useNavigate();
  const client = useQueryClient();

  const [view, setView] = useState<MainView>("market");
  const [notice, setNotice] = useState<{
    readonly tone: "ok" | "error";
    readonly text: string;
  } | null>(null);

  // ———— 社区广场状态 ————
  const [communityQuery, setCommunityQuery] = useState("");
  const [communityCategory, setCommunityCategory] = useState<CommunityCategoryFilter>("all");
  const [communitySort, setCommunitySort] = useState<CommunitySortKey>("popular");
  const [communityPage, setCommunityPage] = useState(1);

  // ———— 我的订阅状态 ————
  const [librarySearch, setLibrarySearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  // ———— 弹窗状态 ————
  const [publishModal, setPublishModal] = useState<{
    readonly tab: PublishSourceTab;
    readonly pack: WorkshopPack | null;
    readonly existingCoverHash: string | null;
  } | null>(null);

  const [detailModal, setDetailModal] = useState<
    | {
        readonly source: "community";
        readonly item: CommunityWorkshopSummary;
        readonly pack: WorkshopPack;
      }
    | {
        readonly source: "local";
        readonly entry: InstalledWorkshopPack;
      }
    | null
  >(null);

  const [issuedTokenDialog, setIssuedTokenDialog] = useState<{
    readonly packId: string;
    readonly title: string;
    readonly token: string;
    readonly copied: boolean;
  } | null>(null);

  const [unpublishDialog, setUnpublishDialog] = useState<{
    readonly item: CommunityWorkshopSummary;
    readonly tokenInput: string;
  } | null>(null);

  const [confirmRemove, setConfirmRemove] = useState<InstalledWorkshopPack | null>(null);

  const [savedTokens, setSavedTokens] = useState<Record<string, string>>(() =>
    loadCommunityEditTokens(),
  );

  // ———— 数据查询 ————
  const packages = useQuery({ queryKey: ["workshop"], queryFn: api.workshopPackages });
  const community = useQuery({
    queryKey: [
      "communityWorkshop",
      communityQuery.trim(),
      communityCategory,
      communitySort,
      communityPage,
    ],
    queryFn: () =>
      communityWorkshopApi.list({
        q: communityQuery.trim(),
        category: communityCategory,
        sort: communitySort,
        page: communityPage,
        pageSize: 18,
      }),
    retry: false,
  });

  const installed = useMemo(
    () =>
      (packages.data ?? [])
        .map((entry) => (InstalledWorkshopPackSchema.safeParse(entry).success ? entry : null))
        .filter((entry): entry is InstalledWorkshopPack => entry !== null),
    [packages.data],
  );
  const installedIds = useMemo(() => new Set(installed.map((e) => e.pack.id)), [installed]);
  const enabledCount = useMemo(() => installed.filter((e) => e.enabled).length, [installed]);

  const filteredLibrary = useMemo(() => {
    const q = librarySearch.trim().toLowerCase();
    return installed.filter((entry) => {
      if (statusFilter === "enabled" && !entry.enabled) return false;
      if (statusFilter === "disabled" && entry.enabled) return false;
      if (!q) return true;
      return `${entry.pack.title} ${entry.pack.id} ${entry.pack.author} ${entry.pack.description}`
        .toLowerCase()
        .includes(q);
    });
  }, [installed, librarySearch, statusFilter]);

  // ———— 变更操作 ————
  const installLocalPack = useMutation({
    mutationFn: async (pack: WorkshopPack) => {
      const replacing = installedIds.has(pack.id);
      await api.installWorkshopPack(pack, replacing);
      return { pack, replacing };
    },
    onSuccess: async ({ pack, replacing }) => {
      setPublishModal(null);
      setView("library");
      setNotice({
        tone: "ok",
        text: replacing
          ? `已覆盖更新本地内容包「${pack.title}」`
          : `已安装并启用内容包「${pack.title}」`,
      });
      await client.invalidateQueries({ queryKey: ["workshop"] });
      await client.invalidateQueries({ queryKey: ["characterBoard"] });
    },
    onError: (err) => setNotice({ tone: "error", text: err.message }),
  });

  const subscribeCommunity = useMutation({
    mutationFn: async (summary: CommunityWorkshopSummary) => {
      const { pack } = await communityWorkshopApi.fetchPack(summary.id, { download: true });
      const check = await api.validateWorkshopPack(pack, pack.id);
      if (!check.valid) {
        throw new Error(`该内容包未通过本地引用校验：${check.issues[0] ?? "格式不兼容"}`);
      }
      const replacing = installedIds.has(pack.id);
      await api.installWorkshopPack(pack, replacing);
      return { pack, replacing };
    },
    onSuccess: async ({ pack, replacing }) => {
      const hasChars = pack.characters.length > 0;
      setNotice({
        tone: "ok",
        text: replacing
          ? `已更新「${pack.title}」到本地`
          : hasChars
            ? `已订阅「${pack.title}」（包含 ${pack.characters.length} 张角色卡，点详情可一键导入角色档案）`
            : `已订阅并启用「${pack.title}」（新建存档时自动生效）`,
      });
      await client.invalidateQueries({ queryKey: ["workshop"] });
      await client.invalidateQueries({ queryKey: ["characterBoard"] });
      await client.invalidateQueries({ queryKey: ["communityWorkshop"] });
    },
    onError: (err) => setNotice({ tone: "error", text: err.message }),
  });

  const openCommunityDetail = useMutation({
    mutationFn: async (id: string) => communityWorkshopApi.fetchPack(id, { download: false }),
    onSuccess: ({ item, pack }) => {
      setDetailModal({ source: "community", item, pack });
    },
    onError: (err) => setNotice({ tone: "error", text: err.message }),
  });

  const importCharacterCard = useMutation({
    mutationFn: async (card: CharacterCard) => api.createCharacter(card),
    onSuccess: async (entry) => {
      setNotice({
        tone: "ok",
        text: `已将角色卡「${entry.card.name}」导入你的角色档案，可在「角色档案」中直接选用开局！`,
      });
      await client.invalidateQueries({ queryKey: ["characters"] });
    },
    onError: (err) => setNotice({ tone: "error", text: `导入角色卡失败：${err.message}` }),
  });

  const publishCommunity = useMutation({
    mutationFn: async (payload: PublishSubmitPayload) => {
      const { pack, mode, tokenInput, coverBlob, clearExistingCover } = payload;
      const check = await api.validateWorkshopPack(pack, pack.id);
      if (!check.valid) {
        throw new Error(`发布前本地校验未通过：${check.issues[0] ?? "请检查条目引用"}`);
      }

      // 先确保社区写入
      const res =
        mode === "update"
          ? await communityWorkshopApi.update(pack, tokenInput)
          : await communityWorkshopApi.publish(pack);
      const effectiveToken = res.editToken ?? tokenInput.trim();

      let coverWarning: string | null = null;
      if (coverBlob && effectiveToken) {
        try {
          await communityWorkshopApi.uploadCover(res.item.id, coverBlob, effectiveToken);
        } catch (err) {
          coverWarning = err instanceof Error ? err.message : "封面上传失败";
        }
      } else if (clearExistingCover && effectiveToken) {
        try {
          await communityWorkshopApi.deleteCover(res.item.id, effectiveToken);
        } catch (err) {
          coverWarning = err instanceof Error ? err.message : "封面移除失败";
        }
      }

      // 同步保存一份到本机「我的订阅」（不影响已有其他包）
      try {
        await api.installWorkshopPack(pack, installedIds.has(pack.id));
      } catch {
        // 社区已发布成功，本机同步失败不阻断提示
      }

      return { mode, res, coverWarning };
    },
    onSuccess: async ({ mode, res, coverWarning }) => {
      setPublishModal(null);
      setView("market");
      if (res.editToken) {
        saveCommunityEditToken(res.item.id, res.editToken);
        setSavedTokens(loadCommunityEditTokens());
        setIssuedTokenDialog({
          packId: res.item.id,
          title: res.item.title,
          token: res.editToken,
          copied: false,
        });
      }
      setNotice({
        tone: coverWarning ? "error" : "ok",
        text: coverWarning
          ? `作品「${res.item.title}」已发布，但封面未保存：${coverWarning}`
          : mode === "update"
            ? `已更新社区作品「${res.item.title}」（版本 r${res.item.revision}）`
            : `已将「${res.item.title}」发布到社区广场！`,
      });
      await client.invalidateQueries({ queryKey: ["communityWorkshop"] });
      await client.invalidateQueries({ queryKey: ["workshop"] });
      await client.invalidateQueries({ queryKey: ["characterBoard"] });
    },
    onError: (err) => {
      const text =
        err instanceof CommunityWorkshopError && err.code === "PACK_EXISTS"
          ? `${err.message}（若这是你发布的作品，请切换到「更新已有社区作品」填入密钥）`
          : err.message;
      setNotice({ tone: "error", text });
    },
  });

  const unpublishPack = useMutation({
    mutationFn: async (input: {
      readonly id: string;
      readonly title: string;
      readonly token: string;
    }) => {
      await communityWorkshopApi.unpublish(input.id, input.token);
      return input;
    },
    onSuccess: async ({ id, title }) => {
      removeCommunityEditToken(id);
      setSavedTokens(loadCommunityEditTokens());
      setUnpublishDialog(null);
      if (detailModal?.source === "community" && detailModal.item.id === id) {
        setDetailModal(null);
      }
      setNotice({ tone: "ok", text: `已从社区广场下架「${title}」` });
      await client.invalidateQueries({ queryKey: ["communityWorkshop"] });
    },
    onError: (err) => setNotice({ tone: "error", text: err.message }),
  });

  const setEnabled = useMutation({
    mutationFn: async ({ id, title, enabled }: { id: string; title: string; enabled: boolean }) => {
      await api.setWorkshopEnabled(id, enabled);
      return { id, title, enabled };
    },
    onSuccess: async ({ id, title, enabled }) => {
      if (detailModal?.source === "local" && detailModal.entry.pack.id === id) {
        setDetailModal({
          source: "local",
          entry: { ...detailModal.entry, enabled },
        });
      }
      setNotice({
        tone: "ok",
        text: enabled ? `已启用「${title}」（新建存档时生效）` : `已停用「${title}」`,
      });
      await client.invalidateQueries({ queryKey: ["workshop"] });
      await client.invalidateQueries({ queryKey: ["characterBoard"] });
    },
    onError: (err) => setNotice({ tone: "error", text: err.message }),
  });

  const removeLocal = useMutation({
    mutationFn: async (entry: InstalledWorkshopPack) => {
      await api.removeWorkshopPack(entry.pack.id);
      return entry;
    },
    onSuccess: async (entry) => {
      setConfirmRemove(null);
      if (detailModal?.source === "local" && detailModal.entry.pack.id === entry.pack.id) {
        setDetailModal(null);
      }
      setNotice({ tone: "ok", text: `已卸载「${entry.pack.title}」` });
      await client.invalidateQueries({ queryKey: ["workshop"] });
      await client.invalidateQueries({ queryKey: ["characterBoard"] });
    },
    onError: (err) => setNotice({ tone: "error", text: err.message }),
  });

  const busy =
    installLocalPack.isPending ||
    subscribeCommunity.isPending ||
    openCommunityDetail.isPending ||
    importCharacterCard.isPending ||
    publishCommunity.isPending ||
    unpublishPack.isPending ||
    setEnabled.isPending ||
    removeLocal.isPending;

  const hasOpenDialog = Boolean(
    publishModal || detailModal || issuedTokenDialog || unpublishDialog || confirmRemove,
  );

  useLayer(() => {
    if (!busy) navigate("/menu");
  }, !hasOpenDialog);

  const openPublishForExisting = (pack: WorkshopPack) => {
    const matched = community.data?.items.find((item) => item.id === pack.id);
    setPublishModal({
      tab: "local",
      pack,
      existingCoverHash: matched?.coverHash ?? null,
    });
  };

  const tabLineMask = cssUrl("tab.line");

  return (
    <main className={styles.screen}>
      <ShellBackdrop variant="workshop" />

      {/* ———— 顶部 Steam 工坊风格导航栏 ———— */}
      <header className={styles.head}>
        <Asset id="menu.header" tint="var(--cp-red)" height={52} className={styles.headBg} />
        <Asset id="panel.glowLeft" height={28} tint="var(--cp-cyan)" className={styles.headGlow} />
        <div className={styles.headTitleWrap}>
          <span className={styles.headCode}>{"WK // WORKSHOP"}</span>
          <h1>创意工坊</h1>
        </div>

        <nav className={styles.viewNav} aria-label="工坊视图切换">
          <Button
            small
            primary={view === "market"}
            pressed={view === "market"}
            onClick={() => setView("market")}
          >
            社区广场{community.isSuccess ? ` (${community.data.total})` : ""}
          </Button>
          <Button
            small
            primary={view === "library"}
            pressed={view === "library"}
            onClick={() => setView("library")}
          >
            我的订阅 ({enabledCount}/{installed.length})
          </Button>
        </nav>

        <span className={styles.spacer} />

        <Button
          small
          primary
          disabled={busy}
          onClick={() => setPublishModal({ tab: "local", pack: null, existingCoverHash: null })}
        >
          ＋ 发布作品
        </Button>
        <Button small disabled={busy} onClick={() => navigate("/characters")}>
          角色档案
        </Button>
        <Button small keyId="key.esc" disabled={busy} onClick={() => navigate("/menu")}>
          返回主菜单
        </Button>
      </header>

      <span
        className={styles.headLine}
        style={{ maskImage: tabLineMask, WebkitMaskImage: tabLineMask }}
        aria-hidden
      />

      {/* ———— 主内容区（全屏宽版） ———— */}
      <div className={styles.workspace}>
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

        <section
          className={styles.mainStage}
          aria-label={view === "market" ? "社区广场" : "我的订阅"}
        >
          <NineSlice
            id="notify.itemCellBg"
            tint="var(--cp-panel)"
            slice={30}
            className={styles.paneLayer}
          />
          <NineSlice
            id="notify.itemCellFg"
            tint={view === "market" ? "var(--cp-cyan-dim)" : "var(--cp-red-dim)"}
            slice={30}
            className={styles.paneLayer}
          />

          {view === "market" ? (
            <>
              <div className={styles.toolbar}>
                <div className={styles.searchRow}>
                  <FrameBox className={styles.searchBox}>
                    <input
                      type="search"
                      value={communityQuery}
                      placeholder="搜索社区作品名称、作者、简介…"
                      aria-label="搜索社区作品"
                      onChange={(e) => {
                        setCommunityQuery(e.target.value);
                        setCommunityPage(1);
                      }}
                    />
                  </FrameBox>
                  <fieldset className={styles.filterPills} aria-label="排序方式">
                    {COMMUNITY_SORTS.map((sort) => (
                      <Button
                        key={sort.id}
                        small
                        pressed={communitySort === sort.id}
                        onClick={() => {
                          setCommunitySort(sort.id);
                          setCommunityPage(1);
                        }}
                      >
                        {sort.label}
                      </Button>
                    ))}
                  </fieldset>
                  <Button
                    small
                    disabled={community.isFetching}
                    onClick={() => void community.refetch()}
                  >
                    {community.isFetching ? "刷新中…" : "刷新"}
                  </Button>
                </div>

                <fieldset className={styles.filterPills} aria-label="按内容分类筛选">
                  {COMMUNITY_CATEGORIES.map((cat) => (
                    <Button
                      key={cat.id}
                      small
                      pressed={communityCategory === cat.id}
                      onClick={() => {
                        setCommunityCategory(cat.id);
                        setCommunityPage(1);
                      }}
                    >
                      {cat.label}
                    </Button>
                  ))}
                </fieldset>
              </div>

              <div className={styles.stageScroll}>
                {community.isPending && <p className={styles.note}>正在连接夜之城创意工坊广场…</p>}

                {community.isError && (
                  <div className={styles.emptyHero}>
                    <CellFrame />
                    <strong>暂时无法连接社区广场</strong>
                    <p className={styles.note}>{community.error.message}</p>
                    <div className={styles.actions}>
                      <Button small primary onClick={() => void community.refetch()}>
                        重试连接
                      </Button>
                      <Button
                        small
                        onClick={() =>
                          setPublishModal({ tab: "json", pack: null, existingCoverHash: null })
                        }
                      >
                        导入本地 JSON
                      </Button>
                    </div>
                  </div>
                )}

                {community.isSuccess && community.data.items.length === 0 && (
                  <div className={styles.emptyHero}>
                    <CellFrame />
                    <strong>
                      {communityQuery.trim() || communityCategory !== "all"
                        ? "没有符合筛选条件的社区作品"
                        : "社区广场虚位以待"}
                    </strong>
                    <p className={styles.note}>
                      {communityQuery.trim() || communityCategory !== "all"
                        ? "试试清空关键词或切回「全部」分类。"
                        : "点右上角「＋ 发布作品」，可以把你在角色档案里捏好的角色卡、自创义体和特质一键分享出来，或者用 AI 一句话生成整套扩展包！"}
                    </p>
                    <div className={styles.actions}>
                      {(communityQuery.trim() || communityCategory !== "all") && (
                        <Button
                          small
                          onClick={() => {
                            setCommunityQuery("");
                            setCommunityCategory("all");
                            setCommunityPage(1);
                          }}
                        >
                          重置筛选
                        </Button>
                      )}
                      <Button
                        small
                        primary
                        onClick={() =>
                          setPublishModal({ tab: "local", pack: null, existingCoverHash: null })
                        }
                      >
                        ＋ 发布我的第一份作品
                      </Button>
                      <Button
                        small
                        onClick={() =>
                          setPublishModal({ tab: "ai", pack: null, existingCoverHash: null })
                        }
                      >
                        AI 一句话生成扩展包
                      </Button>
                    </div>
                  </div>
                )}

                {community.isSuccess && community.data.items.length > 0 && (
                  <>
                    <ul className={styles.cardGrid}>
                      {community.data.items.map((item) => {
                        const isInstalled = installedIds.has(item.id);
                        const hasToken = Boolean(savedTokens[item.id]);
                        const chips = communitySummaryChips(item.summary);
                        const coverUrl = communityCoverUrl(item.id, item.coverHash);
                        return (
                          <li
                            key={item.id}
                            className={styles.marketCard}
                            data-installed={isInstalled || undefined}
                          >
                            <CellFrame />
                            <button
                              type="button"
                              className={styles.cardCoverBtn}
                              onClick={() => openCommunityDetail.mutate(item.id)}
                            >
                              {coverUrl ? (
                                <img
                                  src={coverUrl}
                                  alt={`${item.title} 封面`}
                                  loading="lazy"
                                  className={styles.cardCoverImg}
                                />
                              ) : (
                                <div className={styles.cardCoverFallback}>
                                  <span className={styles.coverTypeTag}>
                                    {primaryBadgeForSummary(item.summary)}
                                  </span>
                                  <strong className={styles.coverFallbackTitle}>
                                    {item.title}
                                  </strong>
                                  <span className={styles.coverFallbackMeta}>
                                    {item.entryCount} 项内容 · {formatBytes(item.byteSize)}
                                  </span>
                                </div>
                              )}
                              <div className={styles.coverBadges}>
                                {hasToken && <span className={styles.ownerBadge}>我的发布</span>}
                                {isInstalled && (
                                  <span className={styles.statePill} data-on>
                                    已订阅
                                  </span>
                                )}
                                <span className={styles.revBadge}>r{item.revision}</span>
                              </div>
                            </button>

                            <div className={styles.cardBody}>
                              <button
                                type="button"
                                className={styles.cardTitleBtn}
                                onClick={() => openCommunityDetail.mutate(item.id)}
                              >
                                <strong>{item.title}</strong>
                              </button>
                              <p className={styles.packMeta}>
                                <span>{item.author || "匿名创作者"}</span>
                                <span>·</span>
                                <span>订阅 {item.downloads}</span>
                                <span>·</span>
                                <span>{formatDate(item.updatedAt)}</span>
                              </p>
                              <p className={styles.cardDesc}>
                                {item.description || "暂无简介，点击查看详情浏览收录条目。"}
                              </p>
                              <div className={styles.chipRow}>
                                {chips.slice(0, 4).map((label) => (
                                  <span key={label} className={styles.chip}>
                                    {label}
                                  </span>
                                ))}
                              </div>
                            </div>

                            <div className={styles.cardFooter}>
                              <Button
                                small
                                primary={!isInstalled}
                                disabled={busy}
                                onClick={() => subscribeCommunity.mutate(item)}
                              >
                                {isInstalled ? "更新到本地" : "＋ 订阅启用"}
                              </Button>
                              <Button
                                small
                                disabled={busy}
                                onClick={() => openCommunityDetail.mutate(item.id)}
                              >
                                详情
                              </Button>
                            </div>
                          </li>
                        );
                      })}
                    </ul>

                    {(communityPage > 1 || community.data.hasMore) && (
                      <div className={styles.pagerRow}>
                        <Button
                          small
                          disabled={communityPage <= 1 || community.isFetching}
                          onClick={() => setCommunityPage((p) => Math.max(1, p - 1))}
                        >
                          上一页
                        </Button>
                        <span className={styles.paneCount}>
                          第 {communityPage} 页 · 共 {community.data.total} 个作品
                        </span>
                        <Button
                          small
                          disabled={!community.data.hasMore || community.isFetching}
                          onClick={() => setCommunityPage((p) => p + 1)}
                        >
                          下一页
                        </Button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </>
          ) : (
            /* ———— 视图 2：我的订阅 ———— */
            <>
              <div className={styles.toolbar}>
                <div className={styles.searchRow}>
                  <FrameBox className={styles.searchBox}>
                    <input
                      type="search"
                      value={librarySearch}
                      placeholder="搜索已订阅或本地安装的作品…"
                      aria-label="搜索已安装内容包"
                      onChange={(e) => setLibrarySearch(e.target.value)}
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
                      启用中 ({enabledCount})
                    </Button>
                    <Button
                      small
                      pressed={statusFilter === "disabled"}
                      onClick={() => setStatusFilter("disabled")}
                    >
                      已停用 ({installed.length - enabledCount})
                    </Button>
                  </fieldset>
                </div>
              </div>

              <div className={styles.stageScroll}>
                {packages.isPending && <p className={styles.note}>正在读取本地订阅列表…</p>}

                {packages.isSuccess && installed.length === 0 && (
                  <div className={styles.emptyHero}>
                    <CellFrame />
                    <strong>还没有订阅任何工坊作品</strong>
                    <p className={styles.note}>
                      去「社区广场」一键订阅他人创作的角色卡、义体与扩展包，或点「＋
                      发布作品」打包你自己在角色档案里的创作 / 让 AI
                      生成一套！旧存档均保留独立快照，随时启停不影响已有进度。
                    </p>
                    <div className={styles.actions}>
                      <Button small primary onClick={() => setView("market")}>
                        逛逛社区广场
                      </Button>
                      <Button
                        small
                        onClick={() =>
                          setPublishModal({ tab: "local", pack: null, existingCoverHash: null })
                        }
                      >
                        ＋ 发布或制作作品
                      </Button>
                    </div>
                  </div>
                )}

                {packages.isSuccess && installed.length > 0 && filteredLibrary.length === 0 && (
                  <div className={styles.emptyHero}>
                    <CellFrame />
                    <p className={styles.note}>当前筛选条件下没有匹配的作品。</p>
                    <Button
                      small
                      onClick={() => {
                        setLibrarySearch("");
                        setStatusFilter("all");
                      }}
                    >
                      重置筛选
                    </Button>
                  </div>
                )}

                {filteredLibrary.length > 0 && (
                  <ul className={styles.libraryList}>
                    {filteredLibrary.map((entry) => {
                      const { pack, enabled, installedAt } = entry;
                      const chips = packCategoryCounts(pack);
                      const hasToken = Boolean(savedTokens[pack.id]);
                      return (
                        <li
                          key={pack.id}
                          className={styles.libraryRow}
                          data-enabled={enabled || undefined}
                        >
                          <CellFrame />
                          <div className={styles.rowMain}>
                            <div className={styles.packHeader}>
                              <button
                                type="button"
                                className={styles.cardTitleBtn}
                                onClick={() => setDetailModal({ source: "local", entry })}
                              >
                                <strong>{pack.title}</strong>
                              </button>
                              <code className={styles.packId}>{pack.id}</code>
                              {hasToken && <span className={styles.ownerBadge}>我的发布</span>}
                              <span className={styles.statePill} data-on={enabled || undefined}>
                                {enabled ? "已启用" : "已停用"}
                              </span>
                            </div>
                            <p className={styles.packMeta}>
                              <span>{pack.author || "匿名创作者"}</span>
                              <span>·</span>
                              <span>安装于 {formatDate(installedAt)}</span>
                              <span>·</span>
                              <span>共 {totalEntries(pack)} 项内容</span>
                            </p>
                            {pack.description && (
                              <p className={styles.packDesc}>{pack.description}</p>
                            )}
                            <div className={styles.chipRow}>
                              {chips.map((c) => (
                                <span key={c.key} className={styles.chip}>
                                  {c.label} {c.count}
                                </span>
                              ))}
                            </div>
                          </div>

                          <div className={styles.rowSide}>
                            <div className={styles.enabledControl}>
                              <span>{enabled ? "新建存档生效" : "已停用"}</span>
                              <ToggleCheck
                                variant="switch"
                                checked={enabled}
                                disabled={busy}
                                aria-label={`启用${pack.title}`}
                                onChange={(next) =>
                                  setEnabled.mutate({
                                    id: pack.id,
                                    title: pack.title,
                                    enabled: next,
                                  })
                                }
                              />
                            </div>
                            <div className={styles.actions}>
                              <Button
                                small
                                primary
                                disabled={busy || totalEntries(pack) === 0}
                                onClick={() => openPublishForExisting(pack)}
                              >
                                {hasToken ? "更新云端" : "上传社区"}
                              </Button>
                              <Button
                                small
                                onClick={() => setDetailModal({ source: "local", entry })}
                              >
                                查看详情
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
                                导出 JSON
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
                )}
              </div>
            </>
          )}
        </section>
      </div>

      <div className={styles.keys}>
        <KeyBar>
          <KeyHint keyId="key.esc" label="返回主菜单" onClick={() => navigate("/menu")} />
        </KeyBar>
      </div>

      {/* ———— 三合一发布弹窗 ———— */}
      {publishModal && (
        <WorkshopPublishModal
          initialTab={publishModal.tab}
          initialPack={publishModal.pack}
          initialExistingCoverHash={publishModal.existingCoverHash}
          installedPacks={installed}
          savedTokens={savedTokens}
          busy={busy}
          onClose={() => setPublishModal(null)}
          onInstallLocal={(pack) => installLocalPack.mutate(pack)}
          onPublishCommunity={(payload) => publishCommunity.mutate(payload)}
          onGoCharacters={() => {
            setPublishModal(null);
            navigate("/characters");
          }}
        />
      )}

      {/* ———— 作品详情弹窗（支持社区作品 & 本地作品） ———— */}
      {detailModal && (
        <Dialog
          title={
            detailModal.source === "community"
              ? detailModal.item.title
              : detailModal.entry.pack.title
          }
          onClose={() => setDetailModal(null)}
          actions={
            detailModal.source === "community" ? (
              <>
                <Button
                  disabled={busy}
                  onClick={() =>
                    setUnpublishDialog({
                      item: detailModal.item,
                      tokenInput: savedTokens[detailModal.item.id] ?? "",
                    })
                  }
                >
                  {savedTokens[detailModal.item.id] ? "下架我的作品" : "管理 / 下架"}
                </Button>
                <Button
                  onClick={() => downloadJson(detailModal.pack, `${detailModal.item.id}.json`)}
                >
                  另存 JSON
                </Button>
                <Button
                  primary
                  disabled={busy}
                  onClick={() => subscribeCommunity.mutate(detailModal.item)}
                >
                  {installedIds.has(detailModal.item.id) ? "更新到本地" : "＋ 一键订阅并启用"}
                </Button>
              </>
            ) : (
              <>
                <Button
                  disabled={busy}
                  onClick={() => {
                    const target = detailModal.entry;
                    setDetailModal(null);
                    setConfirmRemove(target);
                  }}
                >
                  卸载
                </Button>
                <Button
                  onClick={() =>
                    downloadJson(detailModal.entry.pack, `${detailModal.entry.pack.id}.json`)
                  }
                >
                  导出 JSON
                </Button>
                <Button
                  disabled={busy}
                  onClick={() => {
                    const pack = detailModal.entry.pack;
                    setDetailModal(null);
                    openPublishForExisting(pack);
                  }}
                >
                  {savedTokens[detailModal.entry.pack.id] ? "更新社区版本" : "上传到社区"}
                </Button>
                <Button
                  primary
                  disabled={busy}
                  onClick={() =>
                    setEnabled.mutate({
                      id: detailModal.entry.pack.id,
                      title: detailModal.entry.pack.title,
                      enabled: !detailModal.entry.enabled,
                    })
                  }
                >
                  {detailModal.entry.enabled ? "停用此包" : "启用此包"}
                </Button>
              </>
            )
          }
        >
          {(() => {
            const pack =
              detailModal.source === "community" ? detailModal.pack : detailModal.entry.pack;
            const cover =
              detailModal.source === "community"
                ? communityCoverUrl(detailModal.item.id, detailModal.item.coverHash)
                : null;
            return (
              <div className={styles.dialogBody}>
                {cover && (
                  <div className={styles.previewCoverWrap}>
                    <img
                      src={cover}
                      alt={`${pack.title} 封面`}
                      className={styles.previewCoverImg}
                    />
                  </div>
                )}

                <p className={styles.packMeta}>
                  <span>作者：{pack.author || "匿名创作者"}</span>
                  <span>·</span>
                  <code>{pack.id}</code>
                  {detailModal.source === "community" ? (
                    <>
                      <span>·</span>
                      <span>版本 r{detailModal.item.revision}</span>
                      <span>·</span>
                      <span>订阅 {detailModal.item.downloads}</span>
                      <span>·</span>
                      <span>{formatBytes(detailModal.item.byteSize)}</span>
                    </>
                  ) : (
                    <>
                      <span>·</span>
                      <span>安装于 {formatDate(detailModal.entry.installedAt)}</span>
                    </>
                  )}
                </p>

                {pack.description && <p className={styles.packDesc}>{pack.description}</p>}

                {/* 若包内包含角色卡：提供一键导入到角色档案！ */}
                {pack.characters.length > 0 && (
                  <div className={styles.charCardsBox}>
                    <strong>收录角色卡 ({pack.characters.length})</strong>
                    <ul className={styles.charCardList}>
                      {pack.characters.map((card) => (
                        <li
                          key={`${card.name}-${card.alias}-${card.origin}`}
                          className={styles.charCardItem}
                        >
                          <div className={styles.charCardInfo}>
                            <strong>{card.name}</strong>
                            <span>{card.origin || "原创角色"}</span>
                            {card.look && <p className={styles.entryDetail}>{card.look}</p>}
                          </div>
                          <Button
                            small
                            primary
                            disabled={busy}
                            onClick={() => importCharacterCard.mutate(card)}
                          >
                            导入到角色档案
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <PackEntryBrowser key={pack.id} pack={pack} />
              </div>
            );
          })()}
        </Dialog>
      )}

      {/* ———— 首次发布一次性密钥提示 ———— */}
      {issuedTokenDialog && (
        <Dialog
          title={`「${issuedTokenDialog.title}」已发布成功`}
          onClose={() => setIssuedTokenDialog(null)}
          actions={
            <>
              <Button
                onClick={() => {
                  void navigator.clipboard?.writeText(issuedTokenDialog.token);
                  setIssuedTokenDialog((d) => (d ? { ...d, copied: true } : null));
                }}
              >
                {issuedTokenDialog.copied ? "✓ 已复制密钥" : "复制管理密钥"}
              </Button>
              <Button primary onClick={() => setIssuedTokenDialog(null)}>
                我已记下
              </Button>
            </>
          }
        >
          <div className={styles.dialogBody}>
            <p className={styles.note}>
              以下是作品 <code>{issuedTokenDialog.packId}</code> 的专属管理密钥，
              <b>仅本次显示</b>（服务端只保存哈希，无法找回）：
            </p>
            <code className={styles.tokenBox}>{issuedTokenDialog.token}</code>
            <p className={styles.note}>
              本机浏览器已自动记住该密钥，当前设备可直接一键更新或下架；换设备管理请复制备份。
            </p>
          </div>
        </Dialog>
      )}

      {/* ———— 下架社区作品 ———— */}
      {unpublishDialog && (
        <Dialog
          title={`从社区广场下架「${unpublishDialog.item.title}」？`}
          tone="danger"
          onClose={() => {
            if (!unpublishPack.isPending) setUnpublishDialog(null);
          }}
          actions={
            <>
              <Button disabled={unpublishPack.isPending} onClick={() => setUnpublishDialog(null)}>
                取消
              </Button>
              <Button
                primary
                disabled={unpublishPack.isPending || unpublishDialog.tokenInput.trim() === ""}
                onClick={() =>
                  unpublishPack.mutate({
                    id: unpublishDialog.item.id,
                    title: unpublishDialog.item.title,
                    token: unpublishDialog.tokenInput,
                  })
                }
              >
                {unpublishPack.isPending ? "下架中…" : "确认从社区下架"}
              </Button>
            </>
          }
        >
          <div className={styles.dialogBody}>
            <p className={styles.note}>
              下架后其他玩家将无法在社区广场搜到 <code>{unpublishDialog.item.id}</code>
              （已订阅到本地或已有存档不受影响）。
            </p>
            <label className={styles.editField}>
              <span>
                管理密钥（作者密钥或站长密钥）
                <small>
                  {savedTokens[unpublishDialog.item.id]
                    ? "已自动填入本机缓存"
                    : "请输入发布时的管理密钥"}
                </small>
              </span>
              <FrameBox className={styles.compactInput}>
                <input
                  type="password"
                  value={unpublishDialog.tokenInput}
                  placeholder="cpwk_..."
                  onChange={(e) =>
                    setUnpublishDialog((d) => (d ? { ...d, tokenInput: e.target.value } : null))
                  }
                />
              </FrameBox>
            </label>
          </div>
        </Dialog>
      )}

      {/* ———— 卸载本地订阅确认 ———— */}
      {confirmRemove && (
        <Dialog
          title={`卸载「${confirmRemove.pack.title}」？`}
          tone="danger"
          onClose={() => {
            if (!removeLocal.isPending) setConfirmRemove(null);
          }}
          actions={
            <>
              <Button disabled={removeLocal.isPending} onClick={() => setConfirmRemove(null)}>
                取消
              </Button>
              <Button
                primary
                disabled={removeLocal.isPending}
                onClick={() => removeLocal.mutate(confirmRemove)}
              >
                {removeLocal.isPending ? "卸载中…" : "确认卸载"}
              </Button>
            </>
          }
        >
          <p>
            作品 <code>{confirmRemove.pack.id}</code> 将从本机订阅列表移除，新建存档不再加载其中的{" "}
            {totalEntries(confirmRemove.pack)} 项内容；已有存档仍保留完整独立快照。
          </p>
        </Dialog>
      )}
    </main>
  );
}
