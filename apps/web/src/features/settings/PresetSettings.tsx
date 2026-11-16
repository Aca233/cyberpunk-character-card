import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ChangeEvent, type ReactNode, useId, useState } from "react";
import { api, type PresetSummary } from "../../api/client";
import { formatDate } from "../../labels";
import { Asset, cssUrl, NineSlice } from "../../ui/Asset";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { CellFrame, FrameBox } from "../../ui/FrameBox";
import { Panel } from "../../ui/Panel";
import { ToggleCheck } from "../../ui/ToggleCheck";
import ms from "./model-settings.module.css";
import styles from "./settings.module.css";

/**
 * 酒馆预设（用户定的）：导入 SillyTavern 聊天补全预设，只给叙事模型写正文那一步用；
 * 条目叠在本作提示词前面当文风，本作的规则、状态格式在后面说了算。导入后要手动启用。
 */

async function readPresetFile(file: File): Promise<unknown> {
  try {
    return JSON.parse(await file.text());
  } catch {
    throw new Error("文件不是合法的 JSON，确认导出的是酒馆的预设文件");
  }
}

export function PresetSettings() {
  const client = useQueryClient();
  const list = useQuery({ queryKey: ["presets"], queryFn: api.tavernPresets });
  const [picked, setPicked] = useState<string | null>(null);
  const refresh = () => client.invalidateQueries({ queryKey: ["presets"] });
  const upload = useMutation({
    mutationFn: async (file: File) =>
      api.importPreset({ fileName: file.name, raw: await readPresetFile(file) }),
    onSuccess: async (r) => {
      setPicked(r.preset.id);
      await refresh();
    },
  });
  const choose = useMutation({ mutationFn: api.setActivePreset, onSuccess: refresh });

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) upload.mutate(file);
  };

  const presets = list.data?.presets ?? [];
  const active = presets.find((p) => p.active);
  const selected = presets.find((p) => p.id === picked) ?? active ?? presets[0];

  return (
    <div className={ms.root}>
      <section
        className={ms.readiness}
        data-ready={active ? true : undefined}
        aria-label="当前预设"
      >
        <NineSlice
          id="notify.itemCellBg"
          slice={30}
          tint="rgb(12 10 18 / 86%)"
          className={ms.slice}
        />
        <NineSlice
          id="notify.itemCellFg"
          slice={30}
          tint={active ? "var(--cp-cyan)" : "var(--cp-yellow)"}
          className={ms.slice}
        />
        <Asset
          id="panel.glowLeft"
          height={34}
          tint={active ? "var(--cp-cyan)" : "var(--cp-yellow)"}
          className={ms.readyGlow}
        />
        <div className={ms.readyMain}>
          <div className={ms.readyTop}>
            <span className={ms.statusBadge} data-ready={active ? true : undefined}>
              {active ? "预设启用中" : "未启用预设"}
            </span>
            <strong className={ms.readyTitle}>{active ? active.name : "当前使用默认写法"}</strong>
          </div>
          <p className={ms.help}>
            {active
              ? `条目 ${active.entries.filter((e) => e.enabled).length}/${active.entries.length} 开启 · 采样参数${Object.keys(active.sampling).length > 0 ? "按预设覆盖" : "沿用模型连接"}`
              : "从左侧列表选择已导入的酒馆预设，或点击「导入 .json」新增"}
          </p>
        </div>
        {active && (
          <div className={ms.fix}>
            <Button onClick={() => choose.mutate(null)} disabled={choose.isPending}>
              停用，改回默认写法
            </Button>
          </div>
        )}
      </section>

      {choose.isError && (
        <p className={ms.error} role="alert">
          没切换：{choose.error.message}
        </p>
      )}
      {upload.isError && (
        <p className={ms.error} role="alert">
          没导入：{upload.error.message}
        </p>
      )}
      {upload.isSuccess && (
        <p className={ms.success} role="status">
          已导入「{upload.data.preset.name}」
        </p>
      )}

      <div className={ms.workspace}>
        <aside className={ms.sidebar} aria-label="预设列表">
          <NineSlice
            id="notify.itemCellBg"
            slice={30}
            tint="rgb(12 10 18 / 84%)"
            className={ms.slice}
          />
          <NineSlice
            id="notify.itemCellFg"
            slice={30}
            tint="var(--cp-red-dim)"
            className={ms.slice}
          />
          <div className={ms.listHead}>
            <h3>我的预设</h3>
            <label className={styles.fileButton}>
              <NineSlice id="tab.bg" tint="currentColor" slice={14} className={styles.fileBg} />
              <input type="file" accept=".json,application/json" onChange={onFile} />
              <span>{upload.isPending ? "导入中…" : "导入 .json"}</span>
            </label>
          </div>
          <div className={ms.listScroll}>
            {list.isPending && <p className={ms.help}>正在读取预设…</p>}
            {list.isError && (
              <div className={styles.sidebarState}>
                <p className={ms.error}>读取失败：{list.error.message}</p>
                <Button small onClick={() => void list.refetch()}>
                  重试
                </Button>
              </div>
            )}
            {list.isSuccess && presets.length === 0 && (
              <p className={ms.help}>还没有预设，点右上角导入酒馆 .json</p>
            )}
            {presets.length > 0 && (
              <ul className={ms.list}>
                {presets.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      className={ms.connection}
                      aria-pressed={selected?.id === p.id}
                      onClick={() => setPicked(p.id)}
                    >
                      <CellFrame />
                      <div className={ms.connTop}>
                        <strong>{p.name}</strong>
                        {p.active && <span className={ms.rolePill}>使用中</span>}
                      </div>
                      <span className={ms.modelName}>
                        条目 {p.entries.filter((e) => e.enabled).length}/{p.entries.length} · 正则{" "}
                        {p.regex.filter((r) => r.enabled).length}/{p.regex.length}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>

        <section className={ms.editor} aria-label="预设详情">
          <NineSlice
            id="notify.itemCellBg"
            slice={30}
            tint="rgb(12 10 18 / 84%)"
            className={ms.slice}
          />
          <NineSlice
            id="notify.itemCellFg"
            slice={30}
            tint="var(--cp-red-dim)"
            className={ms.slice}
          />
          {selected ? (
            <PresetDetail
              key={selected.id}
              preset={selected}
              busy={choose.isPending}
              onActivate={() => choose.mutate(selected.id)}
              onChanged={refresh}
              onDeleted={() => setPicked(null)}
            />
          ) : (
            <Panel line="var(--cp-red-dim)">
              <p className={ms.help}>未选择预设。导入或从左侧选择一份预设即可查看和调整条目。</p>
            </Panel>
          )}
        </section>
      </div>
    </div>
  );
}

function PresetDetail({
  preset,
  busy,
  onActivate,
  onChanged,
  onDeleted,
}: {
  readonly preset: PresetSummary;
  readonly busy: boolean;
  readonly onActivate: () => void;
  readonly onChanged: () => Promise<void>;
  readonly onDeleted: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const patch = useMutation({
    mutationFn: (body: Parameters<typeof api.updatePreset>[1]) => api.updatePreset(preset.id, body),
    onSuccess: onChanged,
  });
  const remove = useMutation({
    mutationFn: () => api.deletePreset(preset.id),
    onSuccess: async () => {
      await onChanged();
      onDeleted();
    },
  });
  const pending = busy || patch.isPending || remove.isPending;

  return (
    <div className={ms.form} aria-busy={pending}>
      <header className={styles.detailHead}>
        <div>
          <span className={ms.kicker}>预设详情</span>
          <h3>{preset.name}</h3>
          <p className={ms.help}>导入于 {formatDate(preset.importedAt)}</p>
        </div>
        <Button primary onClick={onActivate} disabled={pending || preset.active}>
          {preset.active ? "正在使用" : "启用这份预设"}
        </Button>
      </header>

      <span
        className={styles.thinLine}
        style={{ maskImage: cssUrl("tab.line"), WebkitMaskImage: cssUrl("tab.line") }}
        aria-hidden
      />

      <section className={ms.usage}>
        <span className={ms.kicker}>01 / 采样参数</span>
        <dl className={styles.samplingFacts}>
          {samplingRows(preset.sampling).map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd className="num">{v}</dd>
            </div>
          ))}
        </dl>
        {Object.keys(preset.sampling).length > 0 ? (
          <div className={ms.actions}>
            <Button onClick={() => patch.mutate({ useSampling: false })} disabled={pending}>
              不带采样参数，按模型连接
            </Button>
          </div>
        ) : (
          <p className={ms.help}>按模型连接</p>
        )}
      </section>

      {preset.warnings.length > 0 && (
        <div className={ms.notice}>
          {preset.warnings.map((w) => (
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
        <span className={ms.kicker}>
          02 / 提示词条目 · {preset.entries.filter((e) => e.enabled).length}/{preset.entries.length}{" "}
          开启
        </span>
        <ToggleList
          items={preset.entries.map((e) => ({
            id: e.id,
            name: e.name,
            enabled: e.enabled,
            meta: `${ROLE_LABELS[e.role]} · ${e.chars.toLocaleString()} 字${e.depth === null ? "" : ` · 深度 ${e.depth}`}`,
          }))}
          disabled={pending}
          onToggle={(id, on) => patch.mutate({ entries: { [id]: on } })}
          renderDetail={(id) => (
            <EntryEditor
              presetId={preset.id}
              entryId={id}
              disabled={pending}
              onSave={(content) => patch.mutateAsync({ contents: { [id]: content } })}
            />
          )}
        />
      </section>

      {preset.regex.length > 0 && (
        <>
          <span
            className={styles.thinLine}
            style={{ maskImage: cssUrl("tab.line"), WebkitMaskImage: cssUrl("tab.line") }}
            aria-hidden
          />
          <section className={ms.usage}>
            <span className={ms.kicker}>
              03 / 正则脚本 · {preset.regex.filter((r) => r.enabled).length}/{preset.regex.length}{" "}
              开启
            </span>
            <ToggleList
              items={preset.regex.map((r) => ({ id: r.id, name: r.name, enabled: r.enabled }))}
              disabled={pending}
              onToggle={(id, on) => patch.mutate({ regex: { [id]: on } })}
            />
          </section>
        </>
      )}
      {patch.isError && (
        <p className={ms.error} role="alert">
          没改上：{patch.error.message}
        </p>
      )}

      <details className={ms.advanced}>
        <summary>预设管理：删除</summary>
        <Button onClick={() => setConfirmDelete(true)} disabled={pending}>
          删除这份预设
        </Button>
        {remove.isError && (
          <p className={ms.error} role="alert">
            没删掉：{remove.error.message}
          </p>
        )}
      </details>

      {confirmDelete && (
        <Dialog
          title="删除这份预设？"
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
          <p>
            删除「{preset.name}」{preset.active ? "，改回默认写法" : ""}。原文件不受影响。
          </p>
        </Dialog>
      )}
    </div>
  );
}

const ROLE_LABELS = { system: "系统", user: "用户", assistant: "助手" } as const;

function samplingRows(s: PresetSummary["sampling"]): [string, string][] {
  const rows: [string, string][] = [];
  if (s.temperature !== undefined) rows.push(["温度", String(s.temperature)]);
  if (s.topP !== undefined) rows.push(["top_p", String(s.topP)]);
  if (s.topK !== undefined) rows.push(["top_k", `${s.topK}（不发送）`]);
  if (s.maxOutputTokens !== undefined)
    rows.push(["最大输出", `${s.maxOutputTokens.toLocaleString()} tokens`]);
  return rows.length > 0 ? rows : [["状态", "不带"]];
}

/** 开关列表：可以按名字筛，几十条也找得到；给了 renderDetail 的每行能展开 */
function ToggleList({
  items,
  disabled,
  onToggle,
  renderDetail,
}: {
  readonly items: readonly {
    readonly id: string;
    readonly name: string;
    readonly enabled: boolean;
    readonly meta?: string;
  }[];
  readonly disabled: boolean;
  readonly onToggle: (id: string, on: boolean) => void;
  readonly renderDetail?: (id: string) => ReactNode;
}) {
  const listId = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const shown = items.filter((i) => i.name.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <div className={styles.toggleBox}>
      {items.length > 8 && (
        <FrameBox className={styles.toggleFilter}>
          <input
            type="search"
            value={query}
            placeholder={`按名字筛选（共 ${items.length} 条）`}
            onChange={(e) => setQuery(e.target.value)}
          />
        </FrameBox>
      )}
      <ul className={styles.presetToggles} data-expandable={renderDetail ? true : undefined}>
        {shown.map((i, index) => {
          const isOpen = open === i.id;
          const controlId = `${listId}-${index}`;
          return (
            <li key={i.id} data-off={i.enabled ? undefined : true} data-open={isOpen || undefined}>
              <div className={styles.toggleRow}>
                <label htmlFor={controlId}>
                  <ToggleCheck
                    id={controlId}
                    variant="checkbox"
                    checked={i.enabled}
                    disabled={disabled}
                    onChange={(checked) => onToggle(i.id, checked)}
                  />
                  <span>{i.name}</span>
                  {i.meta && <small>{i.meta}</small>}
                </label>
                {renderDetail && (
                  <button
                    type="button"
                    className={styles.expand}
                    aria-expanded={isOpen}
                    onClick={() => setOpen(isOpen ? null : i.id)}
                  >
                    <span>{isOpen ? "收起" : "展开"}</span>
                    <Asset
                      id="menu.arrowFill"
                      width={9}
                      tint="currentColor"
                      className={styles.expandArrow}
                    />
                  </button>
                )}
              </div>
              {renderDetail && isOpen && (
                <div className={styles.entryDetail}>{renderDetail(i.id)}</div>
              )}
            </li>
          );
        })}
        {shown.length === 0 && <li className={ms.help}>没有名字里带「{query}」的</li>}
      </ul>
    </div>
  );
}

/** 一条提示词的正文：展开时才去取；改完点保存才写回，撤销回到取来的原样 */
function EntryEditor({
  presetId,
  entryId,
  disabled,
  onSave,
}: {
  readonly presetId: string;
  readonly entryId: string;
  readonly disabled: boolean;
  readonly onSave: (content: string) => Promise<unknown>;
}) {
  const entry = useQuery({
    queryKey: ["presetEntry", presetId, entryId],
    queryFn: () => api.presetEntry(presetId, entryId),
    gcTime: 0,
  });
  const [draft, setDraft] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const save = useMutation({
    mutationFn: (content: string) => onSave(content),
    onSuccess: async () => {
      setSaved(true);
      setDraft(null);
      await entry.refetch();
    },
  });

  if (entry.isPending) return <p className={ms.help}>正在读取正文…</p>;
  if (entry.isError) return <p className={ms.error}>没读到：{entry.error.message}</p>;
  const original = entry.data.content;
  const value = draft ?? original;
  const edited = draft !== null && draft !== original;
  return (
    <div className={styles.entryEditor}>
      <FrameBox>
        <textarea
          value={value}
          rows={Math.min(18, Math.max(6, value.split("\n").length + 1))}
          spellCheck={false}
          disabled={disabled || save.isPending}
          onChange={(e) => {
            setSaved(false);
            setDraft(e.target.value);
          }}
        />
      </FrameBox>
      <div className={ms.actions}>
        <Button
          primary
          disabled={!edited || disabled || save.isPending}
          onClick={() => save.mutate(value)}
        >
          {save.isPending ? "保存中…" : "保存正文"}
        </Button>
        <Button disabled={!edited || save.isPending} onClick={() => setDraft(null)}>
          撤销修改
        </Button>
        <small className={ms.help}>
          {value.length.toLocaleString()} 字{saved ? " · 已保存，下一回合起生效" : ""}
        </small>
      </div>
      {save.isError && (
        <p className={ms.error} role="alert">
          没保存：{save.error.message}
        </p>
      )}
    </div>
  );
}
