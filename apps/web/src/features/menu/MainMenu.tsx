import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { api, type Difficulty, type SaveSummary } from "../../api/client";
import { DIFFICULTY_LABELS, DIFFICULTY_NOTES, formatDate } from "../../labels";
import { Asset, cssUrl } from "../../ui/Asset";
import { Button } from "../../ui/Button";
import { KeyBar, KeyHint } from "../../ui/KeyHint";
import { MenuItem } from "../../ui/MenuItem";
import { Panel } from "../../ui/Panel";
import { EmptyState } from "../status/StatusParts";
import styles from "./menu.module.css";

type Item = "continue" | "new" | "load" | "characters" | "settings";

const byNewest = (a: SaveSummary, b: SaveSummary) => b.createdAt.localeCompare(a.createdAt);

/** 最简主菜单：左侧红色菜单，右侧是选中项的预览 */
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
    { id: "load", label: "读取存档", disabled: sorted.length === 0, reason: "还没有存档" },
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

  return (
    <main className={styles.menu} style={{ backgroundImage: cssUrl("menu.background") }}>
      <div className={styles.scan} style={{ backgroundImage: cssUrl("fx.scanlines") }} />
      <header className={styles.header}>
        <Asset id="splash.logo" height={72} alt="赛博朋克 2077" />
        <span className={styles.subtitle}>夜之城角色卡</span>
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
      <section className={styles.preview}>
        {health.data && health.data.config !== "ok" && (
          <Panel line="var(--cp-yellow)" className={styles.warn}>
            模型还没配好，剧情暂时不能开始。
            <Button onClick={() => navigate("/settings")}>去设置</Button>
          </Panel>
        )}
        {health.isError && (
          <Panel line="var(--cp-danger)" className={styles.warn}>
            {health.error.message}
          </Panel>
        )}
        {focus === "continue" && latest && (
          <SaveCard save={latest} onOpen={() => navigate(`/play/${latest.id}`)} />
        )}
        {focus === "new" && <NewSave onCreated={(id) => navigate(`/play/${id}`)} />}
        {focus === "load" && (
          <Panel title="读取存档">
            {saves.isError && <p className={styles.error}>{saves.error.message}</p>}
            {sorted.length === 0 ? (
              <EmptyState
                text="还没有存档"
                action={<Button onClick={() => setFocus("new")}>新建存档</Button>}
              />
            ) : (
              <ul className={styles.saveList}>
                {sorted.map((save) => (
                  <li key={save.id}>
                    <SaveCard save={save} onOpen={() => navigate(`/play/${save.id}`)} compact />
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        )}
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
      <Asset id="menu.saveSlot" height={compact ? 22 : 30} tint="var(--cp-red)" />
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
  const [selectedId, setSelectedId] = useState("");
  const [title, setTitle] = useState("");
  const [difficulty, setDifficulty] = useState<Difficulty>("nightCity");
  const entries = characters.data ?? [];
  const selected = entries.find((entry) => entry.id === selectedId) ?? entries[0];
  const characterId = selected?.id ?? "";
  const create = useMutation({
    mutationFn: () => api.createSave({ title: title.trim(), characterId, difficulty }),
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
    <Panel title="新建存档">
      <form className={styles.form} onSubmit={submit}>
        <label className={styles.field}>
          <span>存档名</span>
          <input
            value={title}
            maxLength={80}
            disabled={create.isPending}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="例如：沃森的第一单"
          />
        </label>
        <label className={styles.field}>
          <span>扮演的角色</span>
          <select
            value={characterId}
            disabled={create.isPending || !characters.isSuccess || entries.length === 0}
            onChange={(e) => setSelectedId(e.target.value)}
          >
            {entries.length === 0 && (
              <option value="">{characters.isPending ? "正在读取角色…" : "暂无可选角色"}</option>
            )}
            {entries.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.card.name} · {entry.card.origin}
                {entry.sample ? "（示例）" : ""}
              </option>
            ))}
          </select>
        </label>
        {characters.isError && (
          <div role="alert">
            <p className={styles.error}>{characters.error.message}</p>
            <Button disabled={characters.isFetching} onClick={() => void characters.refetch()}>
              重新读取角色
            </Button>
          </div>
        )}
        {characters.isSuccess && entries.length === 0 && (
          <p className={styles.note}>先创建一个角色，再开始这段故事。</p>
        )}
        {selected && (
          <p className={styles.note}>
            {selected.card.alias ? `外号「${selected.card.alias}」。` : ""}
            {selected.card.personality || selected.card.origin}
          </p>
        )}
        <Button disabled={create.isPending} onClick={() => navigate("/characters")}>
          管理角色
        </Button>
        <fieldset className={styles.difficulty} disabled={create.isPending}>
          <legend>难度</legend>
          {(Object.keys(DIFFICULTY_LABELS) as Difficulty[]).map((d) => (
            <label key={d} data-checked={difficulty === d || undefined}>
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
        <p className={styles.note}>开档时保存角色快照，以后修改角色卡不会改变这个存档。</p>
        {create.isError && (
          <p className={styles.error} role="alert">
            {create.error.message}
          </p>
        )}
        <Button type="submit" primary disabled={!canCreate} reason={reason}>
          {create.isPending ? "创建中…" : "开始"}
        </Button>
      </form>
    </Panel>
  );
}
