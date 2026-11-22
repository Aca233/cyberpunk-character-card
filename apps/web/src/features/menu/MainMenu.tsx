import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router";
import { api, type CharacterEntry, type SaveSummary } from "../../api/client";
import { playSfx, toggleMute, useAudioPrefs, useAudioState } from "../../audio";
import { formatDate } from "../../labels";
import { Asset, cssUrl, NineSlice } from "../../ui/Asset";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { CellFrame, FrameBox } from "../../ui/FrameBox";
import { KeyBar, KeyHint } from "../../ui/KeyHint";
import { layerOpen, useLayer } from "../../ui/layers";
import { MenuItem } from "../../ui/MenuItem";
import { Panel } from "../../ui/Panel";
import { useCardTilt } from "../../ui/useCardTilt";
import { defaultStartLocationFor } from "../characters/creator";
import {
  anchorLabel,
  DEFAULT_START,
  StartMapPicker,
  startAnchor,
} from "../characters/StartMapPicker";
import { EmptyState } from "../status/StatusParts";
import styles from "./menu.module.css";

type Item = "continue" | "new" | "load" | "characters" | "workshop" | "settings";

/** 右侧舞台的标题，跟着左边选中的菜单项走 */
const STAGE_TITLES: Partial<Record<Item, string>> = {
  continue: "继续",
  new: "新建存档",
  load: "读取存档",
  characters: "角色档案",
  workshop: "创意工坊",
  settings: "设置",
};

const STAGE_CODES: Partial<Record<Item, string>> = {
  continue: "01 // RESUME",
  new: "02 // NEW_RUN",
  load: "03 // ARCHIVE",
  characters: "04 // CITIZEN_ID",
  workshop: "05 // WORKSHOP",
  settings: "06 // SYS_CONFIG",
};

/** 原作 panel.frame（1060×1560）：切角和侧边缺口都在离边 120 原图像素以内，按 120 切 */
const FRAME_SLICE = 120;
const CELL_SLICE = [20, 30, 30, 20] as const;

const byNewest = (a: SaveSummary, b: SaveSummary) => b.createdAt.localeCompare(a.createdAt);

/**
 * 主菜单：夜之城远景压暗、扫描线、原作 panel.frame 红框；
 * 左列是标志、菜单和状态终端，右边是选中项的舞台
 */
export function MainMenu() {
  const navigate = useNavigate();
  const audioPrefs = useAudioPrefs();
  const audioState = useAudioState();
  const saves = useQuery({ queryKey: ["saves"], queryFn: api.saves });
  const health = useQuery({ queryKey: ["health"], queryFn: api.health });
  const characters = useQuery({ queryKey: ["characters"], queryFn: api.characters });
  const profiles = useQuery({ queryKey: ["profiles"], queryFn: api.profiles, retry: false });

  const sorted = useMemo(() => [...(saves.data ?? [])].sort(byNewest), [saves.data]);
  const latest = sorted[0];
  const charById = useMemo(
    () => new Map((characters.data ?? []).map((entry) => [entry.id, entry])),
    [characters.data],
  );

  const [focus, setFocus] = useState<Item>("continue");
  const [loadFilter, setLoadFilter] = useState("");
  const navRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLElement>(null);
  const itemRefs = useRef<Partial<Record<Item, HTMLButtonElement | null>>>({});

  const modelReady = health.data
    ? health.data.config === "ok" && health.data.models?.ready !== false
    : null;

  const primaryItems: {
    id: Item;
    label: string;
    hint?: string | undefined;
    hintTone?: "dim" | "cyan" | "warn" | undefined;
    disabled?: boolean;
    reason?: string;
  }[] = [
    {
      id: "continue",
      label: "继续",
      hint: latest?.title ?? (saves.isSuccess ? "无存档" : undefined),
      hintTone: latest ? "cyan" : "dim",
      disabled: !latest,
      reason: "还没有存档",
    },
    {
      id: "new",
      label: "新建存档",
      hint: characters.data ? `${characters.data.length} 张卡` : undefined,
    },
    {
      id: "load",
      label: "读取存档",
      hint: saves.isSuccess ? `${sorted.length} 份` : undefined,
    },
    {
      id: "characters",
      label: "角色",
      hint: characters.data ? `${characters.data.length}` : undefined,
    },
  ];

  const utilityItems: {
    id: Item;
    label: string;
    hint?: string | undefined;
    hintTone?: "dim" | "cyan" | "warn" | undefined;
    disabled?: boolean;
    reason?: string;
  }[] = [
    {
      id: "workshop",
      label: "创意工坊",
      hint: "未完成",
      hintTone: "dim",
      disabled: true,
      reason: "创意工坊尚未完成，暂未启用",
    },
    {
      id: "settings",
      label: "设置",
      hint: modelReady === false ? "未配好" : modelReady ? "就绪" : undefined,
      hintTone: modelReady === false ? "warn" : modelReady ? "cyan" : "dim",
    },
  ];

  const allItems = [...primaryItems, ...utilityItems];

  const select = (id: Item) => {
    if (id === "continue" && latest) navigate(`/play/${latest.id}`);
    else if (id === "characters") navigate("/characters");
    else if (id === "workshop") return;
    else if (id === "settings") navigate("/settings");
    else setFocus(id);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || layerOpen()) return;
      const active = document.activeElement;
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) {
        if (e.key === "Escape" && stageRef.current?.contains(active)) {
          e.preventDefault();
          itemRefs.current[focus]?.focus();
        }
        return;
      }
      if (e.key === "Escape" && stageRef.current?.contains(active)) {
        e.preventDefault();
        itemRefs.current[focus]?.focus();
        return;
      }
      const inStage = Boolean(active && stageRef.current?.contains(active));
      if (inStage) return;
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      const enabled = allItems.filter((i) => !i.disabled).map((i) => i.id);
      const at = enabled.indexOf(focus);
      if (at === -1) return;
      e.preventDefault();
      const next =
        e.key === "ArrowDown"
          ? (enabled[(at + 1) % enabled.length] ?? focus)
          : (enabled[(at - 1 + enabled.length) % enabled.length] ?? focus);
      setFocus(next);
      itemRefs.current[next]?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    if (saves.isSuccess && !latest && focus === "continue") setFocus("new");
  }, [saves.isSuccess, latest, focus]);

  const normalizedFilter = loadFilter.trim().toLowerCase();
  const filteredSaves = useMemo(() => {
    if (!normalizedFilter) return sorted;
    return sorted.filter((save) => {
      const char = charById.get(save.characterId);
      const text = [save.title, char?.card.name, char?.card.alias, char?.card.origin]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return text.includes(normalizedFilter);
    });
  }, [sorted, charById, normalizedFilter]);

  const stageTitle = STAGE_TITLES[focus] ?? "";
  const stageCode = STAGE_CODES[focus] ?? "";
  const stageCount =
    focus === "load" && saves.isSuccess
      ? normalizedFilter
        ? `${filteredSaves.length} / ${sorted.length} 个存档`
        : `${sorted.length} 个存档`
      : focus === "continue" && latest
        ? "最近一次冒险"
        : focus === "new" && characters.data
          ? `${characters.data.length} 名可用角色`
          : focus === "characters" && characters.data
            ? `${characters.data.length} 张档案`
            : focus === "workshop"
              ? "未完成 · 暂未启用"
              : focus === "settings" && modelReady !== null
                ? modelReady
                  ? "连接就绪"
                  : "待配置"
                : "";

  const narratorName = profiles.data?.narrator;
  const statusTilt = useCardTilt<HTMLDivElement>({
    maxRotate: 5.5,
    shadowShift: 4.5,
  });

  return (
    <main className={styles.menu}>
      <span
        className={styles.bg}
        style={{ backgroundImage: cssUrl("menu.nightCity") }}
        aria-hidden
      />
      <span className={styles.dim} aria-hidden />
      <span
        className={styles.strip}
        style={{ backgroundImage: cssUrl("menu.background") }}
        aria-hidden
      />
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

      <aside className={styles.side}>
        <header className={styles.brand}>
          <Asset id="splash.logo" height={78} alt="赛博朋克2091" />
          <span
            className={styles.brandLine}
            style={{ maskImage: cssUrl("tab.line"), WebkitMaskImage: cssUrl("tab.line") }}
            aria-hidden
          />
        </header>

        <nav ref={navRef} className={styles.nav} aria-label="主菜单">
          {primaryItems.map((item) => (
            <MenuItem
              key={item.id}
              buttonRef={(el) => {
                itemRefs.current[item.id] = el;
              }}
              label={item.label}
              hint={item.hint}
              hintTone={item.hintTone}
              selected={focus === item.id}
              disabled={item.disabled ?? false}
              reason={item.reason}
              onFocus={() => !item.disabled && setFocus(item.id)}
              onSelect={() => select(item.id)}
            />
          ))}
          <span
            className={styles.navDivider}
            style={{ maskImage: cssUrl("tab.line"), WebkitMaskImage: cssUrl("tab.line") }}
            aria-hidden
          />
          {utilityItems.map((item) => (
            <MenuItem
              key={item.id}
              buttonRef={(el) => {
                itemRefs.current[item.id] = el;
              }}
              label={item.label}
              hint={item.hint}
              hintTone={item.hintTone}
              selected={focus === item.id}
              disabled={item.disabled ?? false}
              reason={item.reason}
              onFocus={() => !item.disabled && setFocus(item.id)}
              onSelect={() => select(item.id)}
            />
          ))}
        </nav>

        <div className={styles.statusCard} {...statusTilt}>
          <NineSlice
            id="notify.itemCellBg"
            slice={30}
            tint="rgb(10 7 14 / 86%)"
            className={styles.statusSlice}
          />
          <NineSlice
            id="notify.itemCellBg"
            slice={30}
            tint="transparent"
            className={styles.cardGlare}
          />
          <NineSlice
            id="notify.itemCellFg"
            slice={30}
            tint={modelReady === false ? "var(--cp-yellow)" : "var(--cp-red-dim)"}
            className={styles.statusSlice}
          />
          <div className={styles.statusTop}>
            <span className={styles.statusHead}>终端状态</span>
            <span className={styles.statusMode}>浏览器本地</span>
          </div>
          <dl className={styles.status}>
            <dt>模型</dt>
            <dd data-tone={modelReady === false ? "warn" : modelReady ? "ok" : undefined}>
              {modelReady === null ? (
                "检查中…"
              ) : modelReady ? (
                <>就绪{narratorName ? ` · ${narratorName}` : ""}</>
              ) : (
                <button
                  type="button"
                  className={styles.inlineLink}
                  onClick={() => navigate("/settings")}
                >
                  未配好 · 去设置 →
                </button>
              )}
            </dd>
            <dt>存档</dt>
            <dd className="num">
              {saves.isSuccess ? `${sorted.length} 个` : "—"}
              {characters.data ? ` · ${characters.data.length} 张角色卡` : ""}
            </dd>
            <dt>工坊</dt>
            <dd>未完成 · 暂未启用</dd>
            <dt>音频</dt>
            <dd data-tone={audioPrefs.muted ? "warn" : "ok"}>
              <button
                type="button"
                className={styles.inlineLink}
                data-sfx="none"
                title="点击切换静音（快捷键 Alt+M）"
                onClick={() => {
                  const muted = toggleMute();
                  if (!muted) playSfx("toggleOn");
                }}
              >
                {audioPrefs.muted
                  ? "已静音 · 点击开启"
                  : audioState.originalReady
                    ? "原版音频 · 点击静音"
                    : "已开启 · 点击静音"}
              </button>
            </dd>
          </dl>
        </div>
      </aside>

      <section ref={stageRef} className={styles.stage} aria-label={stageTitle}>
        <header className={styles.stageHead}>
          <Asset id="menu.header" tint="var(--cp-red)" height={52} className={styles.stageHeadBg} />
          <Asset
            id="panel.glowLeft"
            height={28}
            tint="var(--cp-cyan)"
            className={styles.stageGlow}
          />
          <div className={styles.stageHeading}>
            {stageCode && <span className={styles.stageCode}>{stageCode}</span>}
            <h1 className={styles.stageTitle}>{stageTitle}</h1>
          </div>
          {stageCount && <span className={styles.stageCount}>{stageCount}</span>}
        </header>
        <span
          className={styles.stageLine}
          style={{ maskImage: cssUrl("tab.line"), WebkitMaskImage: cssUrl("tab.line") }}
          aria-hidden
        />
        <div className={styles.stageBody} key={focus}>
          {health.data && (health.data.config !== "ok" || health.data.models?.ready === false) && (
            <Panel line="var(--cp-yellow)" className={styles.warn}>
              <div className={styles.warnRow}>
                <span>
                  {health.data.models?.narrator.error ??
                    health.data.models?.aux.error ??
                    "模型还没配好，剧情暂时不能开始。"}
                </span>
                <Button onClick={() => navigate("/settings")}>去设置</Button>
              </div>
            </Panel>
          )}
          {health.isError && (
            <Panel line="var(--cp-danger)" className={styles.warn}>
              {health.error.message}
            </Panel>
          )}

          {focus === "continue" && latest && (
            <div className={styles.continue}>
              <SaveCard
                save={latest}
                character={charById.get(latest.characterId)}
                featured
                onOpen={() => navigate(`/play/${latest.id}`)}
              />
              {sorted.length > 1 && (
                <>
                  <div className={styles.groupRow}>
                    <h2 className={styles.groupHead}>其他近期存档</h2>
                    {sorted.length > 4 && (
                      <Button small onClick={() => setFocus("load")}>
                        全部 {sorted.length} 份 →
                      </Button>
                    )}
                  </div>
                  <ul className={styles.saveList}>
                    {sorted.slice(1, 4).map((save) => (
                      <li key={save.id}>
                        <SaveCard
                          save={save}
                          character={charById.get(save.characterId)}
                          onOpen={() => navigate(`/play/${save.id}`)}
                          compact
                        />
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}

          {focus === "new" && <NewSave onCreated={(id) => navigate(`/play/${id}`)} />}

          {focus === "load" && (
            <div className={styles.load}>
              {saves.isError && <p className={styles.error}>{saves.error.message}</p>}
              <div className={styles.loadToolbar}>
                {sorted.length > 0 && (
                  <FrameBox className={styles.loadSearch}>
                    <input
                      value={loadFilter}
                      onChange={(e) => setLoadFilter(e.target.value)}
                      placeholder="筛选存档名、角色或出身…"
                      aria-label="筛选存档"
                    />
                  </FrameBox>
                )}
                <ImportSave onImported={(id) => navigate(`/play/${id}`)} />
              </div>
              <p className={styles.note}>
                存档只存在这个浏览器里，清除网站数据就没了，记得定期导出备份；导入的存档文件会建成新存档，文件内含剧透，请妥善保管。
              </p>
              {sorted.length === 0 ? (
                <EmptyState
                  text="还没有存档"
                  action={<Button onClick={() => setFocus("new")}>新建存档</Button>}
                />
              ) : filteredSaves.length === 0 ? (
                <EmptyState
                  text={`没有匹配「${loadFilter}」的存档`}
                  action={<Button onClick={() => setLoadFilter("")}>清空筛选</Button>}
                />
              ) : (
                <ul className={styles.saveList}>
                  {filteredSaves.map((save) => (
                    <li key={save.id} className={styles.saveRow}>
                      <SaveCard
                        save={save}
                        character={charById.get(save.characterId)}
                        onOpen={() => navigate(`/play/${save.id}`)}
                        compact
                      />
                      <ExportSave save={save} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {focus === "characters" && (
            <Panel line="var(--cp-red-dim)">
              <div className={styles.form}>
                <p className={styles.note}>
                  五步赛博建卡工作台：自由搭配出身、特质、负面缺陷、义体拓扑、随身行装与人脉关系，支持
                  AI 生成立绘与小传，以及 JSON 角色卡分享导入导出。
                </p>
                <div className={styles.submit}>
                  <span className={styles.note}>
                    当前本地共有 {characters.data?.length ?? 0} 张角色卡
                  </span>
                  <Button primary onClick={() => navigate("/characters")}>
                    进入角色工作台
                  </Button>
                </div>
              </div>
            </Panel>
          )}

          {focus === "workshop" && (
            <Panel line="var(--cp-red-dim)">
              <div className={styles.form}>
                <p className={styles.note}>创意工坊功能尚未完成，当前版本暂未启用。</p>
              </div>
            </Panel>
          )}

          {focus === "settings" && (
            <Panel line="var(--cp-red-dim)">
              <div className={styles.form}>
                <p className={styles.note}>
                  配置叙事模型、辅助模型与文生图连接，管理酒馆预设与叙事偏好，或在调试视图检查提示词上下文。
                </p>
                <div className={styles.submit}>
                  <span className={styles.note}>
                    {modelReady
                      ? `当前叙事模型：${narratorName || "已就绪"}`
                      : "尚未完成模型连接配置"}
                  </span>
                  <Button primary onClick={() => navigate("/settings")}>
                    打开设置
                  </Button>
                </div>
              </div>
            </Panel>
          )}
        </div>
      </section>

      <div className={styles.keys}>
        <KeyBar>
          <KeyHint keyId="key.enter" label="进入 / 选择" />
          <KeyHint keyId="key.tab" label="切到右侧" />
          <KeyHint keyId="key.esc" label="回菜单栏" />
        </KeyBar>
      </div>
    </main>
  );
}

const SPOILER_WARNING =
  "完整导出包含整个存档：人物的诉求、底线、秘密和委托的隐藏信息都在文件里，打开就会看到剧透。只用来备份和换电脑。确定导出吗？";

function downloadJson(data: unknown, name: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name.replace(/[\\/:*?"<>|]/g, "_");
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 完整导出：弹窗提示剧透，确认后下载 */
function ExportSave({ save }: { save: SaveSummary }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setError(null);
    setBusy(true);
    try {
      downloadJson(await api.exportSave(save.id), `存档-${save.title}.json`);
      setConfirmOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.saveTools}>
      <Button onClick={() => setConfirmOpen(true)}>导出</Button>
      {error && <span className={styles.error}>{error}</span>}
      {confirmOpen && (
        <Dialog
          title={`导出「${save.title}」`}
          tone="warning"
          onClose={() => !busy && setConfirmOpen(false)}
          actions={
            <>
              <Button disabled={busy} onClick={() => setConfirmOpen(false)}>
                取消
              </Button>
              <Button primary disabled={busy} onClick={() => void run()}>
                {busy ? "导出中……" : "确认导出"}
              </Button>
            </>
          }
        >
          <p>{SPOILER_WARNING}</p>
          {error && <p className={styles.error}>{error}</p>}
        </Dialog>
      )}
    </div>
  );
}

/** 导入完整导出的文件：建成一个新存档，原来的不动 */
function ImportSave({ onImported }: { onImported: (id: string) => void }) {
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [notesDialog, setNotesDialog] = useState<{
    id: string;
    notes: readonly string[];
  } | null>(null);
  const [busy, setBusy] = useState(false);

  const onFile = async (file: File) => {
    setError(null);
    setBusy(true);
    try {
      let data: unknown;
      try {
        data = JSON.parse(await file.text());
      } catch {
        throw new Error("文件不是合法的 JSON");
      }
      const made = await api.importSave(data);
      await queryClient.invalidateQueries({ queryKey: ["saves"] });
      if (made.notes.length > 0) {
        setNotesDialog({ id: made.id, notes: made.notes });
      } else {
        onImported(made.id);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.importRow}>
      <Button onClick={() => input.current?.click()} disabled={busy}>
        {busy ? "导入中……" : "导入存档"}
      </Button>
      <input
        ref={input}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void onFile(file);
        }}
      />
      {error && <span className={styles.error}>{error}</span>}
      {notesDialog && (
        <Dialog
          title="导入提示"
          tone="info"
          onClose={() => {
            const id = notesDialog.id;
            setNotesDialog(null);
            onImported(id);
          }}
          actions={
            <Button
              primary
              onClick={() => {
                const id = notesDialog.id;
                setNotesDialog(null);
                onImported(id);
              }}
            >
              进入存档
            </Button>
          }
        >
          {notesDialog.notes.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </Dialog>
      )}
    </div>
  );
}

/** 存档卡：原作 map.filterCell 格框，悬停变青，附带主角信息与难度标记 */
function SaveCard({
  save,
  character,
  onOpen,
  compact,
  featured,
}: {
  save: SaveSummary;
  character?: CharacterEntry | undefined;
  onOpen: () => void;
  compact?: boolean;
  featured?: boolean;
}) {
  const tilt = useCardTilt<HTMLButtonElement>({
    maxRotate: featured ? 5.5 : 4.8,
    shadowShift: 4.5,
  });
  return (
    <button
      type="button"
      className={styles.saveCard}
      data-compact={compact || undefined}
      data-featured={featured || undefined}
      onClick={onOpen}
      {...tilt}
    >
      <CellFrame
        surface={
          <NineSlice
            id="map.filterCellBg"
            slice={CELL_SLICE}
            tint="transparent"
            className={styles.cardGlare}
          />
        }
      />
      <Asset
        id="menu.saveSlot"
        height={compact ? 24 : 40}
        tint="currentColor"
        className={styles.saveIcon}
      />
      <div className={styles.saveInfo}>
        {featured && <span className={styles.featuredTag}>最近存档</span>}
        <span className={styles.saveTitle}>{save.title}</span>
        <span className={styles.saveMeta}>
          {character && (
            <span className={styles.saveChar}>
              {character.card.name}
              {character.card.origin ? ` · ${character.card.origin}` : ""}
            </span>
          )}
          <span className={styles.saveDate}>
            建于 <span className="num">{formatDate(save.createdAt)}</span>
          </span>
          {save.running && <span className={styles.runningBadge}>正在生成</span>}
        </span>
      </div>
      {featured && <span className={styles.saveCta}>继续 →</span>}
    </button>
  );
}

function NewSave({ onCreated }: { onCreated: (id: string) => void }) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const characters = useQuery({ queryKey: ["characters"], queryFn: api.characters });
  const boardData = useQuery({
    queryKey: ["characterBoard"],
    queryFn: api.characterBoard,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const [selectedId, setSelectedId] = useState("");
  const [title, setTitle] = useState("");
  const [customStartLocation, setCustomStartLocation] = useState("");
  const [mapPickerOpen, setMapPickerOpen] = useState(false);
  const dossierTilt = useCardTilt<HTMLDivElement>({
    maxRotate: 5.2,
    shadowShift: 4.5,
  });
  const entries = characters.data ?? [];
  const selected = entries.find((entry) => entry.id === selectedId) ?? entries[0];
  const characterId = selected?.id ?? "";
  const defaultLocation = selected
    ? selected.card.board?.startLocation && startAnchor(selected.card.board.startLocation)
      ? selected.card.board.startLocation
      : defaultStartLocationFor(selected.card, boardData.data)
    : undefined;
  const startLocation = customStartLocation || defaultLocation;
  const startSpot = startAnchor(startLocation);
  const defaultSpot = startAnchor(defaultLocation);
  const create = useMutation({
    mutationFn: () =>
      api.createSave({
        title: title.trim(),
        characterId,
        ...(startLocation ? { startLocation } : {}),
      }),
    onSuccess: async (save) => {
      await client.invalidateQueries({ queryKey: ["saves"] });
      onCreated(save.id);
    },
  });
  const canCreate =
    title.trim() !== "" && characterId !== "" && characters.isSuccess && !create.isPending;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (canCreate) create.mutate();
  };
  const reason = create.isPending ? "正在创建" : !title.trim() ? "先写存档名" : "先选一个可用角色";
  return (
    <Panel>
      <form className={styles.form} onSubmit={submit}>
        <div className={styles.fields}>
          <label className={styles.field}>
            <span>存档名</span>
            <FrameBox>
              <input
                value={title}
                maxLength={80}
                disabled={create.isPending}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="例如：沃森的第一单"
              />
            </FrameBox>
          </label>
          <div className={styles.field}>
            <label htmlFor="new-save-character">扮演的角色</label>
            <div className={styles.fieldRow}>
              <FrameBox className={styles.grow}>
                <select
                  id="new-save-character"
                  value={characterId}
                  disabled={create.isPending || !characters.isSuccess || entries.length === 0}
                  onChange={(e) => {
                    setSelectedId(e.target.value);
                    setCustomStartLocation("");
                  }}
                >
                  {entries.length === 0 && (
                    <option value="">
                      {characters.isPending ? "正在读取角色…" : "暂无可选角色"}
                    </option>
                  )}
                  {entries.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.card.name} · {entry.card.origin}
                      {entry.sample ? "（示例）" : ""}
                    </option>
                  ))}
                </select>
              </FrameBox>
              <Button disabled={create.isPending} onClick={() => navigate("/characters")}>
                管理角色
              </Button>
            </div>
          </div>
          {selected && (
            <div className={`${styles.field} ${styles.fieldSpan}`}>
              <span>开局地点（可选覆盖）</span>
              <div className={styles.fieldRow}>
                <div className={styles.startSpotBar}>
                  <CellFrame />
                  <span className={styles.startSpotName}>
                    {startSpot ? anchorLabel(startSpot) : "按出身分配"}
                  </span>
                  <span
                    className={styles.startSpotBadge}
                    data-custom={customStartLocation ? "" : undefined}
                  >
                    {customStartLocation ? "已自定义覆盖" : defaultSpot ? "角色默认" : "按出身分配"}
                  </span>
                </div>
                <Button disabled={create.isPending} onClick={() => setMapPickerOpen(true)}>
                  大地图选点
                </Button>
                {customStartLocation && (
                  <Button disabled={create.isPending} onClick={() => setCustomStartLocation("")}>
                    恢复默认
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
        {characters.isError && (
          <div role="alert" className={styles.fieldRow}>
            <p className={styles.error}>{characters.error.message}</p>
            <Button disabled={characters.isFetching} onClick={() => void characters.refetch()}>
              重新读取角色
            </Button>
          </div>
        )}
        {characters.isSuccess && entries.length === 0 && (
          <p className={styles.note}>还没有角色。</p>
        )}
        {selected && (
          <div className={styles.charDossier} {...dossierTilt}>
            <CellFrame
              surface={
                <NineSlice
                  id="map.filterCellBg"
                  slice={CELL_SLICE}
                  tint="transparent"
                  className={styles.cardGlare}
                />
              }
            />
            <div className={styles.charDossierHead}>
              <strong>{selected.card.name}</strong>
              {selected.card.alias && (
                <span className={styles.charTag}>外号「{selected.card.alias}」</span>
              )}
              <span className={styles.charTag}>{selected.card.origin}</span>
              {startSpot && (
                <span className={styles.charSpot}>开局地点：{anchorLabel(startSpot)}</span>
              )}
            </div>
            {selected.card.personality && (
              <p className={styles.charBio}>{selected.card.personality}</p>
            )}
          </div>
        )}
        {create.isError && (
          <p className={styles.error} role="alert">
            {create.error.message}
          </p>
        )}
        <div className={styles.submit}>
          <p className={styles.note}>开档时保存角色快照，以后修改角色卡不会改变这个存档。</p>
          <Button type="submit" primary disabled={!canCreate} reason={reason}>
            {create.isPending ? "创建中…" : "开始"}
          </Button>
        </div>
      </form>
      {selected && mapPickerOpen && (
        <StartLocationMapModal
          characterName={selected.card.name}
          value={startLocation ?? DEFAULT_START}
          defaultStart={defaultLocation ?? DEFAULT_START}
          automatic={!customStartLocation}
          onChange={(id) => {
            if (!id || id === defaultLocation) setCustomStartLocation("");
            else setCustomStartLocation(id);
          }}
          onClose={() => setMapPickerOpen(false)}
        />
      )}
    </Panel>
  );
}

/** 切法照地图浮层 map.panel* */
const MAP_PANEL_SLICE = [20, 20, 30, 30] as const;

/** 主菜单新建存档的全屏大地图开局选点浮层 */
function StartLocationMapModal({
  characterName,
  value,
  defaultStart,
  automatic,
  onChange,
  onClose,
}: {
  readonly characterName: string;
  readonly value: string;
  readonly defaultStart: string;
  readonly automatic: boolean;
  readonly onChange: (id: string) => void;
  readonly onClose: () => void;
}) {
  useLayer(onClose);
  const picked = startAnchor(value);
  const content = (
    <div className={styles.mapModalBackdrop}>
      <button
        type="button"
        className={styles.mapModalDismiss}
        aria-label="关闭大地图选点"
        onClick={onClose}
      />
      <section
        className={styles.mapModal}
        role="dialog"
        aria-modal="true"
        aria-label="夜之城大地图选开局地点"
      >
        <NineSlice id="map.panelBg" tint="var(--cp-surface)" slice={MAP_PANEL_SLICE} />
        <NineSlice id="map.panelFg" tint="var(--cp-red)" slice={MAP_PANEL_SLICE} />
        <div className={styles.mapModalInner}>
          <header className={styles.mapModalHead}>
            <div className={styles.mapModalHeading}>
              <span className={styles.mapModalCode}>{"NIGHT CITY // DROP POINT"}</span>
              <h2 className={styles.mapModalTitle}>为「{characterName}」选择开局地点</h2>
            </div>
            <div className={styles.mapModalActions}>
              <span className={styles.mapModalPicked}>
                当前选点：
                <strong>{picked ? anchorLabel(picked) : "按出身分配"}</strong>
                {automatic ? "（默认）" : "（已覆盖）"}
              </span>
              <Button primary small onClick={onClose}>
                确认此地点
              </Button>
              <Button small label="关闭大地图（Esc）" onClick={onClose}>
                关闭
              </Button>
            </div>
          </header>
          <div className={styles.mapModalBody}>
            <StartMapPicker
              value={value}
              defaultStart={defaultStart}
              automatic={automatic}
              resetLabel="恢复默认"
              automaticLabel="当前默认"
              fillHeight
              onChange={onChange}
            />
          </div>
        </div>
      </section>
    </div>
  );
  return createPortal(content, document.body);
}
