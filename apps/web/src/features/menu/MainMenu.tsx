import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { api, type Difficulty, type SaveSummary } from "../../api/client";
import { LOCAL_MODE } from "../../api/transport";
import { DIFFICULTY_LABELS, DIFFICULTY_NOTES, formatDate } from "../../labels";
import { Asset, cssUrl, NineSlice } from "../../ui/Asset";
import { Button } from "../../ui/Button";
import { CellFrame, FrameBox } from "../../ui/FrameBox";
import { KeyBar, KeyHint } from "../../ui/KeyHint";
import { MenuItem } from "../../ui/MenuItem";
import { Panel } from "../../ui/Panel";
import { defaultStartLocationFor } from "../characters/creator";
import { anchorLabel, startAnchor } from "../characters/StartMapPicker";
import { EmptyState } from "../status/StatusParts";
import { LegendsPanel } from "./LegendsPanel";
import styles from "./menu.module.css";

type Item = "continue" | "new" | "load" | "legends" | "characters" | "settings";

/** 右侧舞台的标题，跟着左边选中的菜单项走 */
const STAGE_TITLES: Partial<Record<Item, string>> = {
  continue: "继续",
  new: "新建存档",
  load: "读取存档",
  legends: "传说名册",
};

/** 原作 panel.frame（1060×1560）：切角和侧边缺口都在离边 120 原图像素以内，按 120 切 */
const FRAME_SLICE = 120;

const byNewest = (a: SaveSummary, b: SaveSummary) => b.createdAt.localeCompare(a.createdAt);

/**
 * 主菜单（用户定的重排）：照神经界面的外框，夜之城远景压暗、扫描线、原作 panel.frame 红框；
 * 左边一列是标志、菜单和状态，右边是选中项的舞台，标题压在原作 menu.header 上
 */
export function MainMenu() {
  const navigate = useNavigate();
  const saves = useQuery({ queryKey: ["saves"], queryFn: api.saves });
  const health = useQuery({ queryKey: ["health"], queryFn: api.health });
  const sorted = [...(saves.data ?? [])].sort(byNewest);
  const latest = sorted[0];
  const [focus, setFocus] = useState<Item>("continue");

  const items: { id: Item; label: string; disabled?: boolean; reason?: string }[] = [
    { id: "continue", label: "继续", disabled: !latest, reason: "还没有存档" },
    { id: "new", label: "新建存档" },
    { id: "load", label: "读取存档" },
    { id: "legends", label: "传说名册" },
    { id: "characters", label: "角色" },
    { id: "settings", label: "设置" },
  ];

  const select = (id: Item) => {
    if (id === "continue" && latest) navigate(`/play/${latest.id}`);
    else if (id === "characters") navigate("/characters");
    else if (id === "settings") navigate("/settings");
    else setFocus(id);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      )
        return;
      const enabled = items.filter((i) => !i.disabled).map((i) => i.id);
      const at = enabled.indexOf(focus);
      if (e.key === "ArrowDown") setFocus(enabled[(at + 1) % enabled.length] ?? focus);
      else if (e.key === "ArrowUp")
        setFocus(enabled[(at - 1 + enabled.length) % enabled.length] ?? focus);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    if (saves.isSuccess && !latest && focus === "continue") setFocus("new");
  }, [saves.isSuccess, latest, focus]);

  const modelReady = health.data
    ? health.data.config === "ok" && health.data.models?.ready !== false
    : null;
  const stageTitle = STAGE_TITLES[focus] ?? "";
  const stageCount =
    focus === "load" && saves.isSuccess
      ? `${sorted.length} 个存档`
      : focus === "continue" && latest
        ? "最近的存档"
        : "";

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
          <Asset id="splash.logo" height={84} alt="赛博朋克 2077" />
          <span className={styles.subtitle}>
            <Asset id="fluff.code" tint="var(--cp-red)" height={14} />
            夜之城角色卡
          </span>
        </header>
        <nav className={styles.nav} aria-label="主菜单">
          {items.map((item) => (
            <MenuItem
              key={item.id}
              label={item.label}
              selected={focus === item.id}
              disabled={item.disabled ?? false}
              reason={item.reason}
              onFocus={() => !item.disabled && setFocus(item.id)}
              onSelect={() => select(item.id)}
            />
          ))}
        </nav>
        <dl className={styles.status}>
          <dt>存档</dt>
          <dd className="num">{saves.isSuccess ? sorted.length : "—"}</dd>
          <dt>模型</dt>
          <dd data-tone={modelReady === false ? "warn" : modelReady ? "ok" : undefined}>
            {modelReady === null ? "检查中" : modelReady ? "就绪" : "未配好"}
          </dd>
        </dl>
      </aside>

      <section className={styles.stage} aria-label={stageTitle}>
        <header className={styles.stageHead}>
          <Asset id="menu.header" tint="var(--cp-red)" height={56} className={styles.stageHeadBg} />
          <b className={styles.stageTitle}>{stageTitle}</b>
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
              <SaveCard save={latest} onOpen={() => navigate(`/play/${latest.id}`)} />
              {sorted.length > 1 && (
                <>
                  <h3 className={styles.groupHead}>其他存档</h3>
                  <ul className={styles.saveList}>
                    {sorted.slice(1, 4).map((save) => (
                      <li key={save.id}>
                        <SaveCard save={save} onOpen={() => navigate(`/play/${save.id}`)} compact />
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
          {focus === "new" && <NewSave onCreated={(id) => navigate(`/play/${id}`)} />}
          {focus === "legends" && <LegendsPanel onOpen={(id) => navigate(`/play/${id}`)} />}
          {focus === "load" && (
            <div className={styles.load}>
              {saves.isError && <p className={styles.error}>{saves.error.message}</p>}
              <ImportSave onImported={(id) => navigate(`/play/${id}`)} />
              {sorted.length === 0 ? (
                <EmptyState
                  text="还没有存档"
                  action={<Button onClick={() => setFocus("new")}>新建存档</Button>}
                />
              ) : (
                <ul className={styles.saveList}>
                  {sorted.map((save) => (
                    <li key={save.id} className={styles.saveRow}>
                      <SaveCard save={save} onOpen={() => navigate(`/play/${save.id}`)} compact />
                      <ExportSave save={save} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </section>

      <div className={styles.keys}>
        <KeyBar>
          <KeyHint keyId="key.enter" label="选择" />
          <KeyHint keyId="key.esc" label="返回" />
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

/** 完整导出：先提示有剧透，确认后下载 */
function ExportSave({ save }: { save: SaveSummary }) {
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    if (!window.confirm(SPOILER_WARNING)) return;
    setError(null);
    try {
      downloadJson(await api.exportSave(save.id), `存档-${save.title}.json`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <div className={styles.saveTools}>
      <Button onClick={() => void run()}>导出</Button>
      {error && <span className={styles.error}>{error}</span>}
    </div>
  );
}

/** 导入完整导出的文件：建成一个新存档，原来的不动 */
function ImportSave({ onImported }: { onImported: (id: string) => void }) {
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
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
      if (made.notes.length > 0) window.alert(made.notes.join("\n"));
      onImported(made.id);
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
      <span className={styles.note}>
        {LOCAL_MODE
          ? "存档只存在这个浏览器里，清除网站数据就没了，记得定期导出备份。本机服务器版导出的文件也能在这里导入，建成新存档；导出的文件含剧透"
          : "导入完整导出的文件，建成新存档；导出的文件含剧透"}
      </span>
      {error && <span className={styles.error}>{error}</span>}
    </div>
  );
}

/** 存档卡：原作 map.filterCell 格框（用户定的，不手画边框），悬停变青 */
function SaveCard({
  save,
  onOpen,
  compact,
}: {
  save: SaveSummary;
  onOpen: () => void;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      className={styles.saveCard}
      data-compact={compact || undefined}
      onClick={onOpen}
    >
      <CellFrame />
      <Asset
        id="menu.saveSlot"
        height={compact ? 22 : 36}
        tint="currentColor"
        className={styles.saveIcon}
      />
      <span className={styles.saveTitle}>{save.title}</span>
      <span className={styles.saveMeta}>
        {DIFFICULTY_LABELS[save.difficulty]} · 建于{" "}
        <span className="num">{formatDate(save.createdAt)}</span>
        {save.running ? " · 正在生成" : ""}
      </span>
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
  const [difficulty, setDifficulty] = useState<Difficulty>("nightCity");
  const lastCharacter = useRef("");
  const entries = characters.data ?? [];
  const selected = entries.find((entry) => entry.id === selectedId) ?? entries[0];
  const characterId = selected?.id ?? "";
  useEffect(() => {
    if (!selected || selected.id === lastCharacter.current) return;
    lastCharacter.current = selected.id;
    setDifficulty(selected.card.board?.difficulty ?? "nightCity");
  }, [selected]);
  const startLocation = selected
    ? selected.card.board?.startLocation && startAnchor(selected.card.board.startLocation)
      ? selected.card.board.startLocation
      : defaultStartLocationFor(selected.card, boardData.data)
    : undefined;
  const startSpot = startAnchor(startLocation);
  const create = useMutation({
    mutationFn: () =>
      api.createSave({
        title: title.trim(),
        characterId,
        difficulty,
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
                  onChange={(e) => setSelectedId(e.target.value)}
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
          <p className={styles.charNote}>
            {selected.card.alias ? `外号「${selected.card.alias}」。` : ""}
            {selected.card.personality || selected.card.origin}
            {startSpot ? ` · 开局地点：${anchorLabel(startSpot)}` : ""}
          </p>
        )}
        <fieldset className={styles.difficulty} disabled={create.isPending}>
          <legend>难度</legend>
          {(Object.keys(DIFFICULTY_LABELS) as Difficulty[]).map((d) => (
            <label key={d} data-checked={difficulty === d || undefined}>
              <CellFrame />
              <input
                type="radio"
                name="difficulty"
                checked={difficulty === d}
                onChange={() => setDifficulty(d)}
              />
              <strong>{DIFFICULTY_LABELS[d]}</strong>
              <span>{DIFFICULTY_NOTES[d]}</span>
            </label>
          ))}
        </fieldset>
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
    </Panel>
  );
}
