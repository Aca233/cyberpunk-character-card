import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ChangeEvent, useId, useState } from "react";
import {
  api,
  type WorldbookEntryDetail,
  type WorldbookEntryPatch,
  type WorldbookNewEntryInput,
  type WorldbookPosition,
  type WorldbookSelectiveLogic,
  type WorldbookSummary,
} from "../../api/client";
import { formatDate } from "../../labels";
import { Asset, cssUrl, NineSlice } from "../../ui/Asset";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { CellFrame, FrameBox } from "../../ui/FrameBox";
import { ITEM_CELL_SLICE, Panel } from "../../ui/Panel";
import { ToggleCheck } from "../../ui/ToggleCheck";
import ms from "./model-settings.module.css";
import styles from "./settings.module.css";

/**
 * 酒馆世界书（SillyTavern World Info / Lorebook）：
 * 支持导入标准 World Info JSON 或角色卡内嵌 character_book、自建空白世界书、多本并行启用、
 * 蓝灯常驻（进静态 system 缓存层）与绿灯关键词动态命中（进本轮 user 槽位）、@D 深度注入，
 * 以及导出为标准 SillyTavern JSON。
 */

const POSITION_LABELS: Readonly<Record<WorldbookPosition, string>> = {
  before: "规则前",
  after: "规则后",
  at_depth: "指定深度 @D",
};

const ROLE_LABELS = { system: "系统", user: "用户", assistant: "助手" } as const;

const SELECTIVE_LOGIC_LABELS: Readonly<Record<WorldbookSelectiveLogic, string>> = {
  0: "任一命中（AND ANY）",
  1: "并非全中（NOT ALL）",
  2: "全不命中（NOT ANY）",
  3: "全部命中（AND ALL）",
};

type EntryFilterMode = "all" | "on" | "off" | "constant" | "keyword";

async function readWorldbookFile(file: File): Promise<unknown> {
  try {
    return JSON.parse(await file.text());
  } catch {
    throw new Error("文件不是合法的 JSON，请确认导入的是酒馆世界书或角色卡文件");
  }
}

function downloadJson(data: unknown, fileName: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName.replace(/[\\/:*?"<>|]/g, "_");
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function parseKeysInput(raw: string): string[] {
  return raw
    .split(/[,，\n]/)
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

function formatKeysInput(keys: readonly string[]): string {
  return keys.join(", ");
}

export function WorldbookSettings() {
  const client = useQueryClient();
  const list = useQuery({ queryKey: ["worldbooks"], queryFn: api.worldbooks });
  const [picked, setPicked] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newBookName, setNewBookName] = useState("");

  const refresh = () => client.invalidateQueries({ queryKey: ["worldbooks"] });

  const upload = useMutation({
    mutationFn: async (file: File) =>
      api.importWorldbook({ fileName: file.name, raw: await readWorldbookFile(file) }),
    onSuccess: async (r) => {
      setPicked(r.worldbook.id);
      await refresh();
    },
  });

  const create = useMutation({
    mutationFn: (name: string) => api.createWorldbook(name),
    onSuccess: async (r) => {
      setCreateOpen(false);
      setNewBookName("");
      setPicked(r.worldbook.id);
      await refresh();
    },
  });

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) upload.mutate(file);
  };

  const books = list.data?.worldbooks ?? [];
  const enabledBooks = books.filter((b) => b.enabled);
  const totalConstant = enabledBooks.reduce(
    (n, b) => n + b.entries.filter((e) => e.enabled && e.constant).length,
    0,
  );
  const totalKeyword = enabledBooks.reduce(
    (n, b) => n + b.entries.filter((e) => e.enabled && !e.constant).length,
    0,
  );
  const selected = books.find((b) => b.id === picked) ?? enabledBooks[0] ?? books[0];

  return (
    <div className={ms.root}>
      <section
        className={ms.readiness}
        data-ready={enabledBooks.length > 0 ? true : undefined}
        aria-label="当前世界书状态"
      >
        <NineSlice
          id="notify.itemCellBg"
          slice={ITEM_CELL_SLICE}
          tint="var(--cp-surface-strong)"
          className={ms.slice}
        />
        <NineSlice
          id="notify.itemCellFg"
          slice={ITEM_CELL_SLICE}
          tint={enabledBooks.length > 0 ? "var(--cp-cyan)" : "var(--cp-yellow)"}
          className={ms.slice}
        />
        <Asset
          id="panel.glowLeft"
          height={38}
          tint={enabledBooks.length > 0 ? "var(--cp-cyan)" : "var(--cp-yellow)"}
          className={ms.readyGlow}
        />
        <div className={ms.readyMain}>
          <div className={ms.readyTop}>
            <span
              className={ms.statusBadge}
              data-ready={enabledBooks.length > 0 ? true : undefined}
            >
              {enabledBooks.length > 0 ? `已启用 ${enabledBooks.length} 本世界书` : "未启用世界书"}
            </span>
            <strong className={ms.readyTitle}>
              {enabledBooks.length > 0
                ? enabledBooks.map((b) => b.name).join(" · ")
                : "仅使用内置赛博朋克世界设定"}
            </strong>
          </div>
          {enabledBooks.length > 0 ? (
            <div className={styles.presetStats}>
              <span className={styles.statChip} data-tone="ok">
                蓝灯常驻 {totalConstant} 条（进系统缓存）
              </span>
              <span className={styles.statChip}>绿灯关键词 {totalKeyword} 条（命中才注入）</span>
              <span className={styles.statChip}>仅写正文生效 · 不影响酒馆预设破甲位置</span>
            </div>
          ) : (
            <p className={ms.help}>
              支持导入 SillyTavern 世界书（.json）或角色卡内嵌
              character_book，可同时启用多本；蓝灯常驻进静态缓存，绿灯按关键词动态触发。
            </p>
          )}
        </div>
      </section>

      {upload.isError && (
        <p className={ms.error} role="alert">
          没导入：{upload.error.message}
        </p>
      )}
      {upload.isSuccess && (
        <div className={ms.banner} role="status">
          <span>
            已导入世界书「{upload.data.worldbook.name}」（共 {upload.data.worldbook.entries.length}{" "}
            条，默认已启用，下一回合起生效）。
          </span>
          <button
            type="button"
            className={ms.bannerClose}
            aria-label="关闭提示"
            onClick={() => upload.reset()}
          >
            关闭
          </button>
        </div>
      )}

      <div className={ms.workspace}>
        <aside className={ms.sidebar} aria-label="世界书列表">
          <NineSlice
            id="notify.itemCellBg"
            slice={ITEM_CELL_SLICE}
            tint="var(--cp-surface)"
            className={ms.slice}
          />
          <NineSlice
            id="notify.itemCellFg"
            slice={ITEM_CELL_SLICE}
            tint="var(--cp-red-dim)"
            className={ms.slice}
          />
          <div className={ms.listHead}>
            <div className={ms.listTitleWrap}>
              <h3>附加世界书</h3>
              <span className={ms.countBadge}>{books.length}</span>
            </div>
            <div className={styles.wbSidebarActions}>
              <label className={styles.fileButton}>
                <NineSlice id="tab.bg" tint="currentColor" slice={14} className={styles.fileBg} />
                <input type="file" accept=".json,application/json" onChange={onFile} />
                <span>{upload.isPending ? "导入中…" : "+ 导入 .json"}</span>
              </label>
              <Button small onClick={() => setCreateOpen(true)}>
                + 新建
              </Button>
            </div>
          </div>
          <div className={ms.listScroll}>
            {list.isPending && <p className={ms.help}>正在读取世界书…</p>}
            {list.isError && (
              <div className={styles.sidebarState}>
                <p className={ms.error}>读取失败：{list.error.message}</p>
                <Button small onClick={() => void list.refetch()}>
                  重试
                </Button>
              </div>
            )}
            {list.isSuccess && books.length === 0 && (
              <p className={ms.help}>
                还没有世界书。点上方「+ 导入 .json」导入酒馆世界书，或「+ 新建」自建一本。
              </p>
            )}
            {books.length > 0 && (
              <ul className={ms.list}>
                {books.map((b) => {
                  const enabledCount = b.entries.filter((e) => e.enabled).length;
                  const constCount = b.entries.filter((e) => e.enabled && e.constant).length;
                  const kwCount = enabledCount - constCount;
                  return (
                    <li key={b.id}>
                      <button
                        type="button"
                        className={ms.connection}
                        aria-pressed={selected?.id === b.id}
                        onClick={() => setPicked(b.id)}
                      >
                        <CellFrame />
                        <div className={ms.connTop}>
                          <strong>{b.name}</strong>
                          {b.enabled && (
                            <span className={ms.rolePill} data-role="narrator">
                              已启用
                            </span>
                          )}
                        </div>
                        <span className={ms.modelName}>
                          蓝灯 {constCount} · 绿灯 {kwCount} · 共 {b.entries.length} 条
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </aside>

        <section className={ms.editor} aria-label="世界书详情">
          <NineSlice
            id="notify.itemCellBg"
            slice={ITEM_CELL_SLICE}
            tint="var(--cp-surface)"
            className={ms.slice}
          />
          <NineSlice
            id="notify.itemCellFg"
            slice={ITEM_CELL_SLICE}
            tint="var(--cp-red-dim)"
            className={ms.slice}
          />
          <div className={ms.editorScroll}>
            {selected ? (
              <WorldbookDetail
                key={selected.id}
                book={selected}
                onChanged={refresh}
                onDeleted={() => setPicked(null)}
              />
            ) : (
              <Panel line="var(--cp-red-dim)" className={styles.emptyPresetPanel}>
                <div className={styles.emptyPresetBody}>
                  <span className={ms.kicker}>{"WORLD INFO // STANDBY"}</span>
                  <h3>导入 SillyTavern 世界书或自建设定集</h3>
                  <p className={ms.help}>
                    支持标准 World Info JSON 与角色卡内嵌
                    character_book，可同时开启多本世界书。蓝灯条目常驻系统缓存层，绿灯条目按本轮输入、近期正文与在场人物/地点关键词自动触发，且绝不干扰酒馆预设的破甲与预填位置。
                  </p>
                  <div className={styles.wbHeadActions}>
                    <label className={styles.fileButton}>
                      <NineSlice
                        id="tab.bg"
                        tint="currentColor"
                        slice={14}
                        className={styles.fileBg}
                      />
                      <input type="file" accept=".json,application/json" onChange={onFile} />
                      <span>{upload.isPending ? "导入中…" : "选择酒馆 .json 世界书"}</span>
                    </label>
                    <Button onClick={() => setCreateOpen(true)}>新建空白世界书</Button>
                  </div>
                </div>
              </Panel>
            )}
          </div>
        </section>
      </div>

      {createOpen && (
        <Dialog
          title="新建空白世界书"
          onClose={() => {
            setCreateOpen(false);
            create.reset();
          }}
          actions={
            <>
              <Button onClick={() => setCreateOpen(false)}>取消</Button>
              <Button
                primary
                disabled={create.isPending || newBookName.trim() === ""}
                onClick={() => create.mutate(newBookName.trim())}
              >
                {create.isPending ? "创建中…" : "创建"}
              </Button>
            </>
          }
        >
          <div className={styles.wbModalForm}>
            <p className={ms.help}>
              创建后会默认启用，可随时新增常驻（蓝灯）或关键词（绿灯）条目。
            </p>
            <label className={styles.wbField}>
              <span className={styles.wbFieldLabel}>世界书名称</span>
              <FrameBox>
                <input
                  value={newBookName}
                  maxLength={60}
                  placeholder="例如：夜之城黑帮补充设定"
                  onChange={(e) => setNewBookName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newBookName.trim() !== "" && !create.isPending) {
                      create.mutate(newBookName.trim());
                    }
                  }}
                />
              </FrameBox>
            </label>
            {create.isError && <p className={ms.error}>{create.error.message}</p>}
          </div>
        </Dialog>
      )}
    </div>
  );
}

function WorldbookDetail({
  book,
  onChanged,
  onDeleted,
}: {
  readonly book: WorldbookSummary;
  readonly onChanged: () => Promise<void>;
  readonly onDeleted: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(book.name);
  const [addOpen, setAddOpen] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filterMode, setFilterMode] = useState<EntryFilterMode>("all");
  const [openEntryId, setOpenEntryId] = useState<string | null>(null);
  const listId = useId();
  const recursiveId = useId();

  const patch = useMutation({
    mutationFn: (body: Parameters<typeof api.updateWorldbook>[1]) =>
      api.updateWorldbook(book.id, body),
    onSuccess: onChanged,
  });

  const remove = useMutation({
    mutationFn: () => api.deleteWorldbook(book.id),
    onSuccess: async () => {
      await onChanged();
      onDeleted();
    },
  });

  const exporting = useMutation({
    mutationFn: () => api.exportWorldbook(book.id),
    onSuccess: (res) => {
      setExportError(null);
      downloadJson(res.data, res.fileName);
    },
    onError: (err) => {
      setExportError(err instanceof Error ? err.message : String(err));
    },
  });

  const pending = patch.isPending || remove.isPending;
  const onCount = book.entries.filter((e) => e.enabled).length;
  const offCount = book.entries.length - onCount;
  const constCount = book.entries.filter((e) => e.constant).length;
  const kwCount = book.entries.length - constCount;

  const shown = book.entries.filter((e) => {
    if (filterMode === "on" && !e.enabled) return false;
    if (filterMode === "off" && e.enabled) return false;
    if (filterMode === "constant" && !e.constant) return false;
    if (filterMode === "keyword" && e.constant) return false;
    const q = query.trim().toLowerCase();
    if (q !== "") {
      const inName = e.name.toLowerCase().includes(q);
      const inKeys =
        e.keys.some((k) => k.toLowerCase().includes(q)) ||
        e.secondaryKeys.some((k) => k.toLowerCase().includes(q));
      if (!inName && !inKeys) return false;
    }
    return true;
  });

  return (
    <div className={ms.form} aria-busy={pending}>
      <header className={styles.detailHead}>
        <div>
          <span className={ms.kicker}>{"WORLD INFO // 世界书详情"}</span>
          {renaming ? (
            <div className={styles.wbBookNameRow}>
              <FrameBox>
                <input
                  value={nameDraft}
                  maxLength={60}
                  onChange={(e) => setNameDraft(e.target.value)}
                />
              </FrameBox>
              <Button
                small
                primary
                disabled={pending || nameDraft.trim() === ""}
                onClick={async () => {
                  await patch.mutateAsync({ name: nameDraft.trim() });
                  setRenaming(false);
                }}
              >
                保存名称
              </Button>
              <Button
                small
                onClick={() => {
                  setNameDraft(book.name);
                  setRenaming(false);
                }}
              >
                取消
              </Button>
            </div>
          ) : (
            <div className={styles.wbBookNameRow}>
              <h3>{book.name}</h3>
              <Button
                small
                disabled={pending}
                onClick={() => {
                  setNameDraft(book.name);
                  setRenaming(true);
                }}
              >
                改名
              </Button>
            </div>
          )}
          <p className={ms.help}>导入/创建于 {formatDate(book.importedAt)}</p>
        </div>
        <div className={styles.wbHeadActions}>
          <Button small disabled={exporting.isPending} onClick={() => exporting.mutate()}>
            {exporting.isPending ? "导出中…" : "导出 .json"}
          </Button>
          <Button
            primary
            pressed={book.enabled}
            disabled={pending}
            onClick={() => patch.mutate({ enabled: !book.enabled })}
          >
            {book.enabled ? "已启用（点击停用）" : "启用这本世界书"}
          </Button>
        </div>
      </header>

      {exportError && (
        <p className={ms.error} role="alert">
          没导出：{exportError}
        </p>
      )}

      <span
        className={styles.thinLine}
        style={{ maskImage: cssUrl("tab.line"), WebkitMaskImage: cssUrl("tab.line") }}
        aria-hidden
      />

      <section className={ms.usage}>
        <span className={ms.kicker}>01 / 扫描与递归设置</span>
        <div className={styles.wbScanRow}>
          <label className={styles.wbScanField}>
            <span>扫描最近原文轮数</span>
            <FrameBox className={styles.wbScanInput}>
              <input
                type="number"
                min={0}
                max={20}
                value={book.scanDepth}
                disabled={pending}
                onChange={(e) => {
                  const v = Number.parseInt(e.target.value, 10);
                  if (Number.isInteger(v) && v >= 0 && v <= 20) {
                    patch.mutate({ scanDepth: v });
                  }
                }}
              />
            </FrameBox>
            <small className={ms.help}>0 = 仅扫本轮输入与当前在场人物/地点</small>
          </label>
          <label htmlFor={recursiveId} className={styles.wbCheckLabel}>
            <ToggleCheck
              id={recursiveId}
              variant="checkbox"
              checked={book.recursiveScanning}
              disabled={pending}
              onChange={(checked) => patch.mutate({ recursiveScanning: checked })}
            />
            <span>启用递归扫描（已命中条目的正文可继续触发其他条目，最多 2 轮）</span>
          </label>
        </div>
      </section>

      {book.warnings.length > 0 && (
        <div className={ms.notice}>
          {book.warnings.map((w) => (
            <p key={w}>{w}</p>
          ))}
        </div>
      )}

      <span
        className={styles.thinLine}
        style={{ maskImage: cssUrl("tab.line"), WebkitMaskImage: cssUrl("tab.line") }}
        aria-hidden
      />

      <section className={ms.usage}>
        <div className={ms.usageHead}>
          <span className={ms.kicker}>
            02 / 世界书条目 · {onCount}/{book.entries.length} 开启
          </span>
          <Button small primary disabled={pending} onClick={() => setAddOpen(true)}>
            + 新增条目
          </Button>
        </div>

        <div className={styles.toggleBox}>
          <div className={styles.toggleToolbar}>
            <FrameBox className={styles.toggleFilter}>
              <input
                type="search"
                value={query}
                placeholder={`按条目名或关键词筛选（共 ${book.entries.length} 条）`}
                onChange={(e) => setQuery(e.target.value)}
              />
            </FrameBox>
            <fieldset className={styles.filterPills} aria-label="按条目状态筛选">
              {(
                [
                  ["all", `全部 ${book.entries.length}`],
                  ["on", `已开 ${onCount}`],
                  ["off", `已关 ${offCount}`],
                  ["constant", `蓝灯 ${constCount}`],
                  ["keyword", `绿灯 ${kwCount}`],
                ] as const
              ).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  className={styles.filterPill}
                  aria-pressed={filterMode === mode}
                  onClick={() => setFilterMode(mode)}
                >
                  {label}
                </button>
              ))}
            </fieldset>
          </div>

          <ul className={styles.presetToggles} data-expandable>
            {shown.map((entry, index) => {
              const isOpen = openEntryId === entry.id;
              const controlId = `${listId}-${index}`;
              const posLabel =
                entry.position === "at_depth"
                  ? `@D ${entry.depth}`
                  : POSITION_LABELS[entry.position];
              return (
                <li
                  key={entry.id}
                  data-off={entry.enabled ? undefined : true}
                  data-open={isOpen || undefined}
                >
                  <div className={styles.toggleRow}>
                    <label htmlFor={controlId}>
                      <ToggleCheck
                        id={controlId}
                        variant="checkbox"
                        checked={entry.enabled}
                        disabled={pending}
                        onChange={(checked) =>
                          patch.mutate({ entryToggles: { [entry.id]: checked } })
                        }
                      />
                      <div className={styles.wbEntryMain}>
                        <div className={styles.wbEntryTitleLine}>
                          <span
                            className={styles.wbLamp}
                            data-kind={entry.constant ? "constant" : "keyword"}
                          >
                            {entry.constant ? "蓝灯" : "绿灯"}
                          </span>
                          <span className={styles.toggleName}>{entry.name}</span>
                        </div>
                        {!entry.constant && entry.keys.length > 0 && (
                          <div className={styles.wbKeyChips}>
                            {entry.keys.slice(0, 5).map((k) => (
                              <span key={k} className={styles.wbKeyChip}>
                                {k}
                              </span>
                            ))}
                            {entry.keys.length > 5 && (
                              <span className={styles.wbKeyChip}>+{entry.keys.length - 5}</span>
                            )}
                          </div>
                        )}
                      </div>
                      <span className={styles.toggleMetaWrap}>
                        <span className={styles.entryRole} data-role={entry.role}>
                          {entry.position === "at_depth" ? ROLE_LABELS[entry.role] : posLabel}
                        </span>
                        <small>
                          {entry.position === "at_depth" ? `${posLabel} · ` : ""}序 {entry.order} ·{" "}
                          {entry.chars.toLocaleString()} 字
                        </small>
                      </span>
                    </label>
                    <button
                      type="button"
                      className={styles.expand}
                      aria-expanded={isOpen}
                      onClick={() => setOpenEntryId(isOpen ? null : entry.id)}
                    >
                      <span>{isOpen ? "收起" : "编辑"}</span>
                      <Asset
                        id="menu.arrowFill"
                        width={9}
                        tint="currentColor"
                        className={styles.expandArrow}
                      />
                    </button>
                  </div>
                  {isOpen && (
                    <div className={styles.entryDetail}>
                      <WorldbookEntryEditor
                        bookId={book.id}
                        entryId={entry.id}
                        disabled={pending}
                        onSave={(entryPatch) =>
                          patch.mutateAsync({ entryUpdates: { [entry.id]: entryPatch } })
                        }
                        onRemove={async () => {
                          await patch.mutateAsync({ removeEntryId: entry.id });
                          setOpenEntryId(null);
                        }}
                      />
                    </div>
                  )}
                </li>
              );
            })}
            {shown.length === 0 && (
              <li className={styles.toggleEmpty}>
                {book.entries.length === 0
                  ? "这本世界书还没有条目，点击右上角「+ 新增条目」添加。"
                  : query.trim()
                    ? `没有匹配「${query.trim()}」的条目`
                    : "当前筛选条件下没有条目"}
              </li>
            )}
          </ul>
        </div>
      </section>

      {patch.isError && (
        <p className={ms.error} role="alert">
          没改上：{patch.error.message}
        </p>
      )}

      <details className={ms.advanced}>
        <summary className={ms.advSummary}>
          <span className={ms.advTitle}>
            <Asset id="menu.arrowFill" width={9} tint="currentColor" className={ms.advArrow} />
            <span>世界书管理：删除</span>
          </span>
          <span className={ms.advMeta}>不会影响本地原始 .json 文件</span>
        </summary>
        <div className={ms.advBody}>
          <Button onClick={() => setConfirmDelete(true)} disabled={pending}>
            删除这本世界书
          </Button>
          {remove.isError && (
            <p className={ms.error} role="alert">
              没删掉：{remove.error.message}
            </p>
          )}
        </div>
      </details>

      {confirmDelete && (
        <Dialog
          title="删除这本世界书？"
          tone="danger"
          onClose={() => setConfirmDelete(false)}
          actions={
            <>
              <Button onClick={() => setConfirmDelete(false)}>取消</Button>
              <Button
                primary
                onClick={() => {
                  setConfirmDelete(false);
                  remove.mutate();
                }}
              >
                确认删除
              </Button>
            </>
          }
        >
          <p>删除「{book.name}」后将不再注入其条目。如需备份请先点「导出 .json」。</p>
        </Dialog>
      )}

      {addOpen && (
        <AddEntryDialog
          busy={patch.isPending}
          onClose={() => setAddOpen(false)}
          onAdd={async (entry) => {
            await patch.mutateAsync({ addEntry: entry });
            setAddOpen(false);
          }}
        />
      )}
    </div>
  );
}

function AddEntryDialog({
  busy,
  onClose,
  onAdd,
}: {
  readonly busy: boolean;
  readonly onClose: () => void;
  readonly onAdd: (entry: WorldbookNewEntryInput) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [constant, setConstant] = useState(false);
  const [keysText, setKeysText] = useState("");
  const [position, setPosition] = useState<WorldbookPosition>("after");
  const [depth, setDepth] = useState(4);
  const [role, setRole] = useState<"system" | "user" | "assistant">("system");
  const [order, setOrder] = useState(100);
  const [content, setContent] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const constId = useId();

  const submit = async () => {
    setErr(null);
    try {
      await onAdd({
        name: name.trim(),
        content,
        enabled: true,
        constant,
        keys: parseKeysInput(keysText),
        secondaryKeys: [],
        selective: false,
        selectiveLogic: 0,
        caseSensitive: false,
        matchWholeWords: false,
        order,
        position,
        depth,
        role,
        scanDepth: null,
      });
    } catch (error) {
      setErr(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <Dialog
      title="新增世界书条目"
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>取消</Button>
          <Button
            primary
            disabled={busy || name.trim() === "" || content.trim() === ""}
            onClick={() => void submit()}
          >
            {busy ? "添加中…" : "添加条目"}
          </Button>
        </>
      }
    >
      <div className={styles.wbModalForm}>
        <div className={styles.wbFormGrid}>
          <label className={`${styles.wbField} ${styles.wbFieldWide}`}>
            <span className={styles.wbFieldLabel}>条目名称 / 备注</span>
            <FrameBox>
              <input
                value={name}
                maxLength={80}
                placeholder="例如：暴恐机动队出动规则"
                onChange={(e) => setName(e.target.value)}
              />
            </FrameBox>
          </label>
          <label htmlFor={constId} className={`${styles.wbCheckLabel} ${styles.wbFieldWide}`}>
            <ToggleCheck
              id={constId}
              variant="checkbox"
              checked={constant}
              onChange={setConstant}
            />
            <span>蓝灯常驻（每轮固定注入静态缓存；不勾则为绿灯，命中关键词时动态注入）</span>
          </label>
          {!constant && (
            <label className={`${styles.wbField} ${styles.wbFieldWide}`}>
              <span className={styles.wbFieldLabel}>主关键词（逗号或换行分隔，支持 /正则/i）</span>
              <FrameBox>
                <input
                  value={keysText}
                  placeholder="例如：暴恐机动队, MaxTac, /赛博精神病/"
                  onChange={(e) => setKeysText(e.target.value)}
                />
              </FrameBox>
            </label>
          )}
          <label className={styles.wbField}>
            <span className={styles.wbFieldLabel}>插入位置</span>
            <FrameBox>
              <select
                value={position}
                onChange={(e) => setPosition(e.target.value as WorldbookPosition)}
              >
                <option value="before">规则前</option>
                <option value="after">规则后</option>
                <option value="at_depth">指定深度 @D</option>
              </select>
            </FrameBox>
          </label>
          <label className={styles.wbField}>
            <span className={styles.wbFieldLabel}>优先级 Order</span>
            <FrameBox>
              <input
                type="number"
                value={order}
                onChange={(e) => setOrder(Number.parseInt(e.target.value, 10) || 0)}
              />
            </FrameBox>
          </label>
          {position === "at_depth" && (
            <>
              <label className={styles.wbField}>
                <span className={styles.wbFieldLabel}>深度 Depth</span>
                <FrameBox>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={depth}
                    onChange={(e) =>
                      setDepth(Math.max(0, Number.parseInt(e.target.value, 10) || 0))
                    }
                  />
                </FrameBox>
              </label>
              <label className={styles.wbField}>
                <span className={styles.wbFieldLabel}>消息角色 Role</span>
                <FrameBox>
                  <select
                    value={role}
                    onChange={(e) => setRole(e.target.value as "system" | "user" | "assistant")}
                  >
                    <option value="system">系统 (system)</option>
                    <option value="user">用户 (user)</option>
                    <option value="assistant">助手 (assistant)</option>
                  </select>
                </FrameBox>
              </label>
            </>
          )}
          <label className={`${styles.wbField} ${styles.wbFieldWide}`}>
            <span className={styles.wbFieldLabel}>条目正文</span>
            <FrameBox>
              <textarea
                rows={6}
                value={content}
                placeholder="输入要注入给叙事模型的世界观、人物设定或规则补充…"
                onChange={(e) => setContent(e.target.value)}
              />
            </FrameBox>
          </label>
        </div>
        {err && <p className={ms.error}>{err}</p>}
      </div>
    </Dialog>
  );
}

interface EntryDraft {
  readonly name: string;
  readonly constant: boolean;
  readonly keysText: string;
  readonly secondaryKeysText: string;
  readonly selective: boolean;
  readonly selectiveLogic: WorldbookSelectiveLogic;
  readonly caseSensitive: boolean;
  readonly matchWholeWords: boolean;
  readonly order: number;
  readonly position: WorldbookPosition;
  readonly depth: number;
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
}

function toDraft(e: WorldbookEntryDetail): EntryDraft {
  return {
    name: e.name,
    constant: e.constant,
    keysText: formatKeysInput(e.keys),
    secondaryKeysText: formatKeysInput(e.secondaryKeys),
    selective: e.selective,
    selectiveLogic: e.selectiveLogic,
    caseSensitive: e.caseSensitive,
    matchWholeWords: e.matchWholeWords,
    order: e.order,
    position: e.position,
    depth: e.depth,
    role: e.role,
    content: e.content,
  };
}

function isEntryDirty(draft: EntryDraft, original: WorldbookEntryDetail): boolean {
  return (
    draft.name !== original.name ||
    draft.constant !== original.constant ||
    draft.keysText !== formatKeysInput(original.keys) ||
    draft.secondaryKeysText !== formatKeysInput(original.secondaryKeys) ||
    draft.selective !== original.selective ||
    draft.selectiveLogic !== original.selectiveLogic ||
    draft.caseSensitive !== original.caseSensitive ||
    draft.matchWholeWords !== original.matchWholeWords ||
    draft.order !== original.order ||
    draft.position !== original.position ||
    draft.depth !== original.depth ||
    draft.role !== original.role ||
    draft.content !== original.content
  );
}

function WorldbookEntryEditor({
  bookId,
  entryId,
  disabled,
  onSave,
  onRemove,
}: {
  readonly bookId: string;
  readonly entryId: string;
  readonly disabled: boolean;
  readonly onSave: (patch: WorldbookEntryPatch) => Promise<unknown>;
  readonly onRemove: () => Promise<void>;
}) {
  const entry = useQuery({
    queryKey: ["worldbookEntry", bookId, entryId],
    queryFn: () => api.worldbookEntry(bookId, entryId),
    gcTime: 0,
  });
  const [draft, setDraft] = useState<EntryDraft | null>(null);
  const [saved, setSaved] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const constId = useId();
  const selectiveId = useId();
  const caseId = useId();
  const wholeId = useId();

  const save = useMutation({
    mutationFn: (patch: WorldbookEntryPatch) => onSave(patch),
    onSuccess: async () => {
      setSaved(true);
      setDraft(null);
      await entry.refetch();
    },
  });

  const remove = useMutation({
    mutationFn: onRemove,
  });

  if (entry.isPending) return <p className={ms.help}>正在读取条目详情…</p>;
  if (entry.isError) return <p className={ms.error}>没读到：{entry.error.message}</p>;

  const original = entry.data.entry;
  const current = draft ?? toDraft(original);
  const edited = draft !== null && isEntryDirty(draft, original);
  const busy = disabled || save.isPending || remove.isPending;

  const update = (next: Partial<EntryDraft>) => {
    setSaved(false);
    setDraft({ ...current, ...next });
  };

  return (
    <div className={styles.entryEditor}>
      <div className={styles.entryEditorHead}>
        <span className={styles.entryEditorLabel}>LOREBOOK ENTRY</span>
        <div className={styles.entryEditorBadges}>
          {edited && <span className={styles.unsavedPill}>有未保存修改</span>}
          {saved && !edited && <span className={styles.savedPill}>已保存 · 下一回合生效</span>}
          <span className={styles.charCount}>{current.content.length.toLocaleString()} 字</span>
        </div>
      </div>

      <div className={styles.wbFormGrid}>
        <label className={`${styles.wbField} ${styles.wbFieldWide}`}>
          <span className={styles.wbFieldLabel}>条目名称 / 备注</span>
          <FrameBox>
            <input
              value={current.name}
              maxLength={80}
              disabled={busy}
              onChange={(e) => update({ name: e.target.value })}
            />
          </FrameBox>
        </label>

        <div className={`${styles.wbCheckRow} ${styles.wbFieldWide}`}>
          <label htmlFor={constId} className={styles.wbCheckLabel}>
            <ToggleCheck
              id={constId}
              variant="checkbox"
              checked={current.constant}
              disabled={busy}
              onChange={(checked) => update({ constant: checked })}
            />
            <span>蓝灯常驻（无视关键词固定注入）</span>
          </label>
          {!current.constant && (
            <>
              <label htmlFor={selectiveId} className={styles.wbCheckLabel}>
                <ToggleCheck
                  id={selectiveId}
                  variant="checkbox"
                  checked={current.selective}
                  disabled={busy}
                  onChange={(checked) => update({ selective: checked })}
                />
                <span>启用次级关键词过滤</span>
              </label>
              <label htmlFor={caseId} className={styles.wbCheckLabel}>
                <ToggleCheck
                  id={caseId}
                  variant="checkbox"
                  checked={current.caseSensitive}
                  disabled={busy}
                  onChange={(checked) => update({ caseSensitive: checked })}
                />
                <span>区分大小写</span>
              </label>
              <label htmlFor={wholeId} className={styles.wbCheckLabel}>
                <ToggleCheck
                  id={wholeId}
                  variant="checkbox"
                  checked={current.matchWholeWords}
                  disabled={busy}
                  onChange={(checked) => update({ matchWholeWords: checked })}
                />
                <span>英文全词匹配</span>
              </label>
            </>
          )}
        </div>

        {!current.constant && (
          <label className={`${styles.wbField} ${styles.wbFieldWide}`}>
            <span className={styles.wbFieldLabel}>主关键词（逗号或换行分隔，支持 /正则/i）</span>
            <FrameBox>
              <input
                value={current.keysText}
                disabled={busy}
                placeholder="例如：荒坂, Arasaka, /三郎/"
                onChange={(e) => update({ keysText: e.target.value })}
              />
            </FrameBox>
          </label>
        )}

        {!current.constant && current.selective && (
          <>
            <label className={styles.wbField}>
              <span className={styles.wbFieldLabel}>次级关键词</span>
              <FrameBox>
                <input
                  value={current.secondaryKeysText}
                  disabled={busy}
                  placeholder="逗号分隔"
                  onChange={(e) => update({ secondaryKeysText: e.target.value })}
                />
              </FrameBox>
            </label>
            <label className={styles.wbField}>
              <span className={styles.wbFieldLabel}>次级过滤逻辑</span>
              <FrameBox>
                <select
                  value={current.selectiveLogic}
                  disabled={busy}
                  onChange={(e) =>
                    update({
                      selectiveLogic: Number(e.target.value) as WorldbookSelectiveLogic,
                    })
                  }
                >
                  {([0, 1, 2, 3] as const).map((code) => (
                    <option key={code} value={code}>
                      {SELECTIVE_LOGIC_LABELS[code]}
                    </option>
                  ))}
                </select>
              </FrameBox>
            </label>
          </>
        )}

        <label className={styles.wbField}>
          <span className={styles.wbFieldLabel}>插入位置</span>
          <FrameBox>
            <select
              value={current.position}
              disabled={busy}
              onChange={(e) => update({ position: e.target.value as WorldbookPosition })}
            >
              <option value="before">规则前</option>
              <option value="after">规则后</option>
              <option value="at_depth">指定深度 @D</option>
            </select>
          </FrameBox>
        </label>

        <label className={styles.wbField}>
          <span className={styles.wbFieldLabel}>优先级 Order</span>
          <FrameBox>
            <input
              type="number"
              value={current.order}
              disabled={busy}
              onChange={(e) => update({ order: Number.parseInt(e.target.value, 10) || 0 })}
            />
          </FrameBox>
        </label>

        {current.position === "at_depth" && (
          <>
            <label className={styles.wbField}>
              <span className={styles.wbFieldLabel}>深度 Depth（0 = 贴近末尾）</span>
              <FrameBox>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={current.depth}
                  disabled={busy}
                  onChange={(e) =>
                    update({ depth: Math.max(0, Number.parseInt(e.target.value, 10) || 0) })
                  }
                />
              </FrameBox>
            </label>
            <label className={styles.wbField}>
              <span className={styles.wbFieldLabel}>消息角色 Role</span>
              <FrameBox>
                <select
                  value={current.role}
                  disabled={busy}
                  onChange={(e) =>
                    update({ role: e.target.value as "system" | "user" | "assistant" })
                  }
                >
                  <option value="system">系统 (system)</option>
                  <option value="user">用户 (user)</option>
                  <option value="assistant">助手 (assistant)</option>
                </select>
              </FrameBox>
            </label>
          </>
        )}
      </div>

      <FrameBox>
        <textarea
          value={current.content}
          rows={Math.min(18, Math.max(6, current.content.split("\n").length + 1))}
          spellCheck={false}
          disabled={busy}
          onChange={(e) => update({ content: e.target.value })}
        />
      </FrameBox>

      <div className={styles.wbEntryActions}>
        <div className={ms.actions}>
          <Button
            primary
            disabled={!edited || busy || current.name.trim() === ""}
            onClick={() =>
              save.mutate({
                name: current.name.trim(),
                constant: current.constant,
                keys: parseKeysInput(current.keysText),
                secondaryKeys: parseKeysInput(current.secondaryKeysText),
                selective: current.selective,
                selectiveLogic: current.selectiveLogic,
                caseSensitive: current.caseSensitive,
                matchWholeWords: current.matchWholeWords,
                order: current.order,
                position: current.position,
                depth: current.depth,
                role: current.role,
                content: current.content,
              })
            }
          >
            {save.isPending ? "保存中…" : "保存条目"}
          </Button>
          <Button disabled={!edited || busy} onClick={() => setDraft(null)}>
            撤销修改
          </Button>
        </div>
        <div>
          {confirmRemove ? (
            <div className={ms.actions}>
              <Button small primary disabled={busy} onClick={() => remove.mutate()}>
                确认删除条目
              </Button>
              <Button small disabled={busy} onClick={() => setConfirmRemove(false)}>
                取消
              </Button>
            </div>
          ) : (
            <Button small disabled={busy} onClick={() => setConfirmRemove(true)}>
              删除此条目
            </Button>
          )}
        </div>
      </div>

      {save.isError && (
        <p className={ms.error} role="alert">
          没保存：{save.error.message}
        </p>
      )}
      {remove.isError && (
        <p className={ms.error} role="alert">
          没删掉：{remove.error.message}
        </p>
      )}
    </div>
  );
}
