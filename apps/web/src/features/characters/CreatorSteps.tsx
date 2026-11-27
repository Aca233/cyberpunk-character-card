import {
  type Board,
  type BoardModule,
  type CharacterCard,
  cyberwareRules,
  economyRules,
  FLAW_MAX,
  inventoryRules,
  PAST_MAX,
  SKILL_MAX,
  type StartCyberware,
} from "@cp/core";
import { type ReactNode, useEffect, useState } from "react";
import type { BoardData } from "../../api/client";
import type { AssetId } from "../../assets";
import { Asset } from "../../ui/Asset";
import { Button } from "../../ui/Button";
import { CellFrame, FrameBox } from "../../ui/FrameBox";
import { itemArtOf } from "../story/art";
import { CyberItemCell, type CyberSlot } from "../story/CyberDoll";
import { vehicleArtOf } from "../story/vehicle-art";
import { CustomCyberwareForm } from "./CustomCyberwareForm";
import { CustomItemForm } from "./CustomItemForm";
import { CustomModuleForm } from "./CustomModuleForm";
import styles from "./characters.module.css";
import {
  inherentCyberware,
  loadLocalCustomItems,
  ORIGIN_ECOSYSTEM_LABELS,
  type OriginEcosystem,
  originDefaultLoadout,
  originEcosystem,
  originPreview,
  PAST_THEME_LABELS,
  type PastTheme,
  pastTheme,
  pickedLoadouts,
  pruneKitForOrigin,
  removeLocalCustomCyberware,
  removeLocalCustomItem,
  removeLocalCustomModule,
  rollPasts,
  rollTraits,
  SKILL_DOMAIN_LABELS,
  type SkillDomain,
  skillDomain,
} from "./creator";
import { startAnchor } from "./StartMapPicker";

/**
 * 创角步骤面板内的上下文选择器：出身、过往履历、核心特质、负面缺陷、开局行装、义体货架。
 * 无点数上限束缚，仅受槽位容量与义体神经负荷（人性值 × 耐受档位）约束。
 */

export interface PickerProps {
  readonly card: CharacterCard;
  readonly board: Board;
  readonly data: BoardData;
  /** origin：换了出身时名片上的出身文字跟着改 */
  readonly commit: (board: Board, origin?: string) => void;
  readonly change: (patch: Partial<CharacterCard>) => void;
}

type OriginPickerProps = Omit<PickerProps, "change"> & Partial<Pick<PickerProps, "change">>;
type PastPickerProps = Omit<PickerProps, "card" | "change"> &
  Partial<Pick<PickerProps, "card" | "change">>;
type TraitPickerProps = Omit<PickerProps, "card" | "change"> &
  Partial<Pick<PickerProps, "card" | "change">> & {
    readonly initialFilter?: SkillDomain;
  };
type FlawPickerProps = Omit<PickerProps, "card" | "change"> &
  Partial<Pick<PickerProps, "card" | "change">>;
type LoadoutPickerProps = Omit<PickerProps, "change"> & Partial<Pick<PickerProps, "change">>;
type CyberwareShelfProps = Omit<PickerProps, "change"> &
  Partial<Pick<PickerProps, "change">> & {
    readonly category: cyberwareRules.CyberwareCategoryId;
    readonly armTarget?: cyberwareRules.ArmSide;
    readonly onArmTargetChange?: (side: cyberwareRules.ArmSide) => void;
    readonly onCategoryChange?: (category: cyberwareRules.CyberwareCategoryId) => void;
    /** 可选总装入件数上限（用于 NPC 人物卡上限校验） */
    readonly maxCount?: number;
  };

const isWorkshopEntry = (packId?: string): boolean => Boolean(packId && packId !== "local");
const isEditableLocalModule = (m: BoardModule): boolean =>
  Boolean(m.custom && (!m.packId || m.packId === "local"));

type ModuleEditorState =
  | null
  | { readonly mode: "create" }
  | { readonly mode: "edit"; readonly module: BoardModule };

/** 本地自创模块卡：主体选择区与集成底栏（编辑 · 删除）统一包在同一 CellFrame 内 */
function EditableModuleCard({
  pressed,
  disabled,
  tone,
  title,
  editLabel,
  deleteLabel,
  onSelect,
  onEdit,
  onDelete,
  children,
}: {
  readonly pressed: boolean;
  readonly disabled?: boolean;
  readonly tone?: "flaw";
  readonly title?: string | undefined;
  readonly editLabel: string;
  readonly deleteLabel: string;
  readonly onSelect: () => void;
  readonly onEdit: () => void;
  readonly onDelete: () => void;
  readonly children: ReactNode;
}) {
  return (
    <div
      className={styles.pickCard}
      data-on={pressed || undefined}
      data-tone={tone}
      data-disabled={disabled || undefined}
    >
      <CellFrame />
      <button
        type="button"
        className={styles.pickCardMain}
        aria-pressed={pressed}
        disabled={disabled}
        title={title}
        onClick={onSelect}
      >
        {children}
      </button>
      <div className={styles.pickCardFoot}>
        <button
          type="button"
          className={styles.pickCardAct}
          aria-label={editLabel}
          onClick={onEdit}
        >
          编辑
        </button>
        <span className={styles.pickCardSep} aria-hidden />
        <button
          type="button"
          className={`${styles.pickCardAct} ${styles.pickCardDanger}`}
          aria-label={deleteLabel}
          onClick={onDelete}
        >
          删除
        </button>
      </div>
    </div>
  );
}

/** 卡片上一行带小标题的说明（用于行装/载具等明细） */
export function Line({ k, children }: { readonly k: string; readonly children: ReactNode }) {
  return (
    <span className={styles.pickLine}>
      <b className={styles.pickKey}>{k}</b>
      <span>{children}</span>
    </span>
  );
}

// ———— 出身背景（单层直接选，带生态筛选、搜索与开局实机家底直显） ————

const ECOSYSTEM_ORDER: readonly OriginEcosystem[] = [
  "street",
  "corpo",
  "badlands",
  "net",
  "custom",
];

function matchesModuleQuery(m: BoardModule, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = [m.label, m.ability, ...m.tags].join(" ").toLowerCase();
  return hay.includes(q);
}

export function OriginPicker({ card, board, data, commit }: OriginPickerProps) {
  const [ecoFilter, setEcoFilter] = useState<OriginEcosystem | "all">("all");
  const [query, setQuery] = useState("");
  const [editor, setEditor] = useState<ModuleEditorState>(null);
  const library = data.modules.filter((m) => m.slot === "origin");
  const extra =
    board.origin && !library.some((m) => m.id === board.origin?.id) ? [board.origin] : [];
  const origins = [...library, ...extra];
  const ecoOptions = ECOSYSTEM_ORDER.filter((eco) =>
    origins.some((m) => originEcosystem(m) === eco),
  );
  const filtered = origins.filter((m) => matchesModuleQuery(m, query));
  const groups = ECOSYSTEM_ORDER.filter((eco) => ecoFilter === "all" || eco === ecoFilter)
    .map((eco) => ({
      eco,
      list: filtered.filter((m) => originEcosystem(m) === eco),
    }))
    .filter((g) => g.list.length > 0);

  return (
    <div className={styles.pickerBody}>
      <div className={styles.slotTools}>
        <FrameBox className={styles.searchBox}>
          <input
            type="search"
            value={query}
            placeholder="搜索出身、标签或专长（如：公司、恶土、黑客、夜场、反情报…）"
            aria-label="搜索出身背景"
            onChange={(e) => setQuery(e.target.value)}
          />
        </FrameBox>
        {!editor && (
          <Button small onClick={() => setEditor({ mode: "create" })}>
            ＋ 自定义出身
          </Button>
        )}
      </div>
      <fieldset className={styles.shelfFilter} aria-label="出身生态分类">
        <Button small pressed={ecoFilter === "all"} onClick={() => setEcoFilter("all")}>
          全部 ({origins.length})
        </Button>
        {ecoOptions.map((eco) => {
          const count = origins.filter((m) => originEcosystem(m) === eco).length;
          return (
            <Button key={eco} small pressed={ecoFilter === eco} onClick={() => setEcoFilter(eco)}>
              {ORIGIN_ECOSYSTEM_LABELS[eco]} ({count})
            </Button>
          );
        })}
      </fieldset>
      {editor && (
        <CustomModuleForm
          key={editor.mode === "edit" ? editor.module.id : "new"}
          slot="origin"
          board={board}
          {...(editor.mode === "edit" ? { initial: editor.module } : {})}
          onCancel={() => setEditor(null)}
          onAccept={(m) => {
            if (editor.mode === "create" || board.origin?.id === m.id) {
              const nextCard = { ...card, origin: m.label };
              commit(pruneKitForOrigin(nextCard, { ...board, origin: m }, data), m.label);
            }
            setEditor(null);
          }}
        />
      )}
      {groups.length === 0 && <p className={styles.note}>没有匹配「{query}」的出身。</p>}
      {groups.map((g) => (
        <section key={g.eco} aria-label={ORIGIN_ECOSYSTEM_LABELS[g.eco]}>
          <h4 className={styles.subTitle}>
            {ORIGIN_ECOSYSTEM_LABELS[g.eco]}
            <span className={styles.stepNote}>{g.list.length} 项</span>
          </h4>
          <ul className={styles.originGrid}>
            {g.list.map((m) => {
              const active = board.origin?.id === m.id;
              const editable = isEditableLocalModule(m);
              const preview = originPreview(m, data);
              const locName = startAnchor(preview.locationId)?.name ?? "沃森 H10";
              const selectOrigin = () => {
                const nextCard = { ...card, origin: m.label };
                commit(pruneKitForOrigin(nextCard, { ...board, origin: m }, data), m.label);
              };
              const body = (
                <>
                  <span className={styles.pickHead}>
                    <strong className={styles.pickName}>{m.label}</strong>
                    <span className={styles.moduleBadges}>
                      {isWorkshopEntry(m.packId) && (
                        <span className={styles.moduleBadge} data-tone="workshop">
                          工坊
                        </span>
                      )}
                      {active && (
                        <span className={styles.moduleBadge} data-tone="active">
                          已选
                        </span>
                      )}
                    </span>
                  </span>
                  {m.ability && <span className={styles.pickDesc}>{m.ability}</span>}
                  <span className={styles.pickMetaRow}>
                    <span className={styles.metaChip} data-tone="eddies">
                      €{preview.eddies.toLocaleString("en-US")}
                    </span>
                    <span className={styles.metaChip}>{locName}</span>
                    {preview.extras.map((extraLabel) => (
                      <span key={extraLabel} className={styles.metaChip} data-tone="perk">
                        {extraLabel}
                      </span>
                    ))}
                  </span>
                </>
              );
              return (
                <li key={m.id} className={styles.pickItem}>
                  {editable ? (
                    <EditableModuleCard
                      pressed={active}
                      editLabel={`编辑本地自定义出身 ${m.label}`}
                      deleteLabel={`删除本地自定义出身 ${m.label}`}
                      onSelect={selectOrigin}
                      onEdit={() => setEditor({ mode: "edit", module: m })}
                      onDelete={() => {
                        removeLocalCustomModule(m.id);
                        if (editor?.mode === "edit" && editor.module.id === m.id) setEditor(null);
                        if (active) commit({ ...board, origin: null }, "");
                      }}
                    >
                      {body}
                    </EditableModuleCard>
                  ) : (
                    <button
                      type="button"
                      className={styles.pick}
                      aria-pressed={active}
                      onClick={selectOrigin}
                    >
                      <CellFrame />
                      {body}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

// ———— 过往履历（独立页签：入城前亲历的独立章节，4 大主题可筛选，与出身零重叠） ————

const PAST_THEMES: readonly PastTheme[] = ["all", "street", "corpo", "badlands", "net", "custom"];

function ModuleTags({ tags }: { readonly tags: readonly string[] }) {
  const visible = tags.filter((t) => t !== "禀赋").slice(0, 4);
  if (visible.length === 0) return null;
  return (
    <span className={styles.pickMetaRow}>
      {visible.map((tag) => (
        <span key={tag} className={styles.metaChip}>
          {tag}
        </span>
      ))}
    </span>
  );
}

export function PastPicker({ board, data, commit }: PastPickerProps) {
  const [theme, setTheme] = useState<PastTheme>("all");
  const [query, setQuery] = useState("");
  const [editor, setEditor] = useState<ModuleEditorState>(null);

  const onIds = new Set(board.pasts.map((m) => m.id));
  const library = data.modules.filter((m) => m.slot === "past");
  const own = board.pasts.filter((m) => !library.some((l) => l.id === m.id));
  const unique = [...library, ...own];
  const shown = unique.filter(
    (m) => (theme === "all" || pastTheme(m) === theme) && matchesModuleQuery(m, query),
  );
  const full = board.pasts.length >= PAST_MAX;

  const toggle = (m: BoardModule) => {
    commit(
      onIds.has(m.id)
        ? { ...board, pasts: board.pasts.filter((x) => x.id !== m.id) }
        : { ...board, pasts: [...board.pasts, m] },
    );
  };

  return (
    <div className={styles.pickerBody}>
      <div className={styles.slotTools}>
        <FrameBox className={styles.searchBox}>
          <input
            type="search"
            value={query}
            placeholder="搜索过往履历或标签（如：劫案、黑墙、飙车、太平洲…）"
            aria-label="搜索过往履历"
            onChange={(e) => setQuery(e.target.value)}
          />
        </FrameBox>
        <Button
          small
          disabled={full}
          reason={`过往履历最多选 ${PAST_MAX} 项`}
          onClick={() => commit(rollPasts(board, data.modules, Math.random, 2))}
        >
          ✦ 随机抽履历
        </Button>
        {!editor && (
          <Button
            small
            disabled={full}
            reason={`过往履历最多选 ${PAST_MAX} 项`}
            onClick={() => setEditor({ mode: "create" })}
          >
            ＋ 自创履历
          </Button>
        )}
      </div>
      <div className={styles.slotTools}>
        <fieldset className={styles.shelfFilter} aria-label="过往履历主题分类">
          {PAST_THEMES.map((t) => {
            const count =
              t === "all" ? unique.length : unique.filter((m) => pastTheme(m) === t).length;
            if (t === "custom" && count === 0) return null;
            return (
              <Button key={t} small pressed={theme === t} onClick={() => setTheme(t)}>
                {PAST_THEME_LABELS[t]} ({count})
              </Button>
            );
          })}
        </fieldset>
        <span className={styles.note}>
          已选 {board.pasts.length} / {PAST_MAX} 项
        </span>
      </div>
      {editor && (
        <CustomModuleForm
          key={editor.mode === "edit" ? editor.module.id : "new"}
          slot="past"
          board={board}
          {...(editor.mode === "edit" ? { initial: editor.module } : {})}
          onCancel={() => setEditor(null)}
          onAccept={(m) => {
            if (editor.mode === "create") {
              commit({ ...board, pasts: [...board.pasts, m] });
            } else if (onIds.has(m.id)) {
              commit({ ...board, pasts: board.pasts.map((x) => (x.id === m.id ? m : x)) });
            }
            setEditor(null);
          }}
        />
      )}
      {shown.length === 0 && <p className={styles.note}>没有匹配条件的过往履历。</p>}
      <ul className={styles.skillWall}>
        {shown.map((m) => {
          const pressed = onIds.has(m.id);
          const themeLabel = PAST_THEME_LABELS[pastTheme(m)];
          const editable = isEditableLocalModule(m);
          const body = (
            <>
              <span className={styles.pickHead}>
                <strong className={styles.pickName}>{m.label}</strong>
                <span className={styles.moduleBadges}>
                  {isWorkshopEntry(m.packId) && (
                    <span className={styles.moduleBadge} data-tone="workshop">
                      工坊
                    </span>
                  )}
                  <span className={styles.moduleBadge} data-tone={pressed ? "active" : undefined}>
                    {pressed ? "已选" : themeLabel}
                  </span>
                </span>
              </span>
              {m.ability && <span className={styles.pickDesc}>{m.ability}</span>}
              <ModuleTags tags={m.tags} />
            </>
          );
          return (
            <li key={m.id} className={styles.pickItem}>
              {editable ? (
                <EditableModuleCard
                  pressed={pressed}
                  disabled={!pressed && full}
                  title={!pressed && full ? `过往履历最多选 ${PAST_MAX} 项` : undefined}
                  editLabel={`编辑本地自定义履历 ${m.label}`}
                  deleteLabel={`删除本地自定义履历 ${m.label}`}
                  onSelect={() => toggle(m)}
                  onEdit={() => setEditor({ mode: "edit", module: m })}
                  onDelete={() => {
                    removeLocalCustomModule(m.id);
                    if (editor?.mode === "edit" && editor.module.id === m.id) setEditor(null);
                    if (pressed) {
                      commit({ ...board, pasts: board.pasts.filter((x) => x.id !== m.id) });
                    }
                  }}
                >
                  {body}
                </EditableModuleCard>
              ) : (
                <button
                  type="button"
                  className={styles.pick}
                  aria-pressed={pressed}
                  disabled={!pressed && full}
                  title={!pressed && full ? `过往履历最多选 ${PAST_MAX} 项` : undefined}
                  onClick={() => toggle(m)}
                >
                  <CellFrame />
                  {body}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ———— 核心特质（独立页签：按性格禀赋 / 战斗技法 / 潜入与技术 / 交涉与生存 细分筛选） ————

const SKILL_DOMAINS: readonly SkillDomain[] = [
  "all",
  "innate",
  "combat",
  "tech",
  "social",
  "custom",
];

export function TraitPicker({ board, data, commit, initialFilter = "all" }: TraitPickerProps) {
  const [filter, setFilter] = useState<SkillDomain>(initialFilter);
  const [query, setQuery] = useState("");
  const [editor, setEditor] = useState<ModuleEditorState>(null);

  useEffect(() => {
    setFilter(initialFilter);
  }, [initialFilter]);

  const onIds = new Set(board.skills.map((m) => m.id));
  const library = data.modules.filter((m) => m.slot === "skill");
  const own = board.skills.filter((m) => !library.some((l) => l.id === m.id));
  const unique = [...library, ...own];
  const shown = unique.filter(
    (m) => (filter === "all" || skillDomain(m) === filter) && matchesModuleQuery(m, query),
  );
  const full = board.skills.length >= SKILL_MAX;

  const toggle = (m: BoardModule) => {
    commit(
      onIds.has(m.id)
        ? { ...board, skills: board.skills.filter((x) => x.id !== m.id) }
        : { ...board, skills: [...board.skills, m] },
    );
  };

  return (
    <div className={styles.pickerBody}>
      <div className={styles.slotTools}>
        <FrameBox className={styles.searchBox}>
          <input
            type="search"
            value={query}
            placeholder="搜索特质、本事或标签（如：黑客、爆破、伪装、读心、狙击…）"
            aria-label="搜索核心特质"
            onChange={(e) => setQuery(e.target.value)}
          />
        </FrameBox>
        <Button
          small
          disabled={full}
          reason={`核心特质最多选 ${SKILL_MAX} 项`}
          onClick={() => commit(rollTraits(board, data.modules, Math.random, 3))}
        >
          ✦ 随机抽特质
        </Button>
        {!editor && (
          <Button
            small
            disabled={full}
            reason={`核心特质最多选 ${SKILL_MAX} 项`}
            onClick={() => setEditor({ mode: "create" })}
          >
            ＋ 自创特质
          </Button>
        )}
      </div>
      <div className={styles.slotTools}>
        <fieldset className={styles.shelfFilter} aria-label="核心特质领域分类">
          {SKILL_DOMAINS.map((f) => {
            const count =
              f === "all" ? unique.length : unique.filter((m) => skillDomain(m) === f).length;
            if (f === "custom" && count === 0) return null;
            return (
              <Button key={f} small pressed={filter === f} onClick={() => setFilter(f)}>
                {SKILL_DOMAIN_LABELS[f]} ({count})
              </Button>
            );
          })}
        </fieldset>
        <span className={styles.note}>
          已选 {board.skills.length} / {SKILL_MAX} 项
        </span>
      </div>
      {editor && (
        <CustomModuleForm
          key={editor.mode === "edit" ? editor.module.id : "new"}
          slot="skill"
          board={board}
          {...(editor.mode === "edit" ? { initial: editor.module } : {})}
          onCancel={() => setEditor(null)}
          onAccept={(m) => {
            if (editor.mode === "create") {
              commit({ ...board, skills: [...board.skills, m] });
            } else if (onIds.has(m.id)) {
              commit({ ...board, skills: board.skills.map((x) => (x.id === m.id ? m : x)) });
            }
            setEditor(null);
          }}
        />
      )}
      {shown.length === 0 && <p className={styles.note}>没有匹配条件的核心特质。</p>}
      <ul className={styles.skillWall}>
        {shown.map((m) => {
          const pressed = onIds.has(m.id);
          const catLabel = SKILL_DOMAIN_LABELS[skillDomain(m)];
          const editable = isEditableLocalModule(m);
          const body = (
            <>
              <span className={styles.pickHead}>
                <strong className={styles.pickName}>{m.label}</strong>
                <span className={styles.moduleBadges}>
                  {isWorkshopEntry(m.packId) && (
                    <span className={styles.moduleBadge} data-tone="workshop">
                      工坊
                    </span>
                  )}
                  <span className={styles.moduleBadge} data-tone={pressed ? "active" : undefined}>
                    {pressed ? "已选" : catLabel}
                  </span>
                </span>
              </span>
              {m.ability && <span className={styles.pickDesc}>{m.ability}</span>}
              <ModuleTags tags={m.tags} />
            </>
          );
          return (
            <li key={m.id} className={styles.pickItem}>
              {editable ? (
                <EditableModuleCard
                  pressed={pressed}
                  disabled={!pressed && full}
                  title={!pressed && full ? `核心特质最多选 ${SKILL_MAX} 项` : undefined}
                  editLabel={`编辑本地自定义特质 ${m.label}`}
                  deleteLabel={`删除本地自定义特质 ${m.label}`}
                  onSelect={() => toggle(m)}
                  onEdit={() => setEditor({ mode: "edit", module: m })}
                  onDelete={() => {
                    removeLocalCustomModule(m.id);
                    if (editor?.mode === "edit" && editor.module.id === m.id) setEditor(null);
                    if (pressed) {
                      commit({ ...board, skills: board.skills.filter((x) => x.id !== m.id) });
                    }
                  }}
                >
                  {body}
                </EditableModuleCard>
              ) : (
                <button
                  type="button"
                  className={styles.pick}
                  aria-pressed={pressed}
                  disabled={!pressed && full}
                  title={!pressed && full ? `核心特质最多选 ${SKILL_MAX} 项` : undefined}
                  onClick={() => toggle(m)}
                >
                  <CellFrame />
                  {body}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ———— 负面缺陷（独立页签：纯处境短板与压力，不扣属性点） ————

export function FlawPicker({ board, data, commit }: FlawPickerProps) {
  const [query, setQuery] = useState("");
  const [editor, setEditor] = useState<ModuleEditorState>(null);
  const on = new Set(board.flaws.map((m) => m.id));
  const library = data.modules.filter((m) => m.slot === "flaw");
  const own = board.flaws.filter((m) => !library.some((l) => l.id === m.id));
  const full = board.flaws.length >= FLAW_MAX;
  const shown = [...library, ...own].filter((m) => matchesModuleQuery(m, query));

  return (
    <div className={styles.pickerBody}>
      <div className={styles.slotTools}>
        <FrameBox className={styles.searchBox}>
          <input
            type="search"
            value={query}
            placeholder="搜索负面缺陷（如：债务、通缉、伤病、黑名单…）"
            aria-label="搜索负面缺陷"
            onChange={(e) => setQuery(e.target.value)}
          />
        </FrameBox>
        {!editor && (
          <Button
            small
            disabled={full}
            reason={`负面缺陷最多选 ${FLAW_MAX} 项`}
            onClick={() => setEditor({ mode: "create" })}
          >
            ＋ 自创缺陷
          </Button>
        )}
      </div>
      <p className={styles.note}>
        已选 {board.flaws.length} / {FLAW_MAX} 项 · 纯可选的处境压力、暗伤与个人底线，不扣点数。
      </p>
      {editor && (
        <CustomModuleForm
          key={editor.mode === "edit" ? editor.module.id : "new"}
          slot="flaw"
          board={board}
          {...(editor.mode === "edit" ? { initial: editor.module } : {})}
          onCancel={() => setEditor(null)}
          onAccept={(m) => {
            if (editor.mode === "create") {
              commit({ ...board, flaws: [...board.flaws, m] });
            } else if (on.has(m.id)) {
              commit({ ...board, flaws: board.flaws.map((x) => (x.id === m.id ? m : x)) });
            }
            setEditor(null);
          }}
        />
      )}
      {shown.length === 0 && <p className={styles.note}>没有匹配的负面缺陷。</p>}
      <ul className={styles.skillWall}>
        {shown.map((m) => {
          const pressed = on.has(m.id);
          const editable = isEditableLocalModule(m);
          const toggleFlaw = () =>
            commit({
              ...board,
              flaws: pressed ? board.flaws.filter((x) => x.id !== m.id) : [...board.flaws, m],
            });
          const body = (
            <>
              <span className={styles.pickHead}>
                <strong className={styles.pickName}>{m.label}</strong>
                <span className={styles.moduleBadges}>
                  {isWorkshopEntry(m.packId) && (
                    <span className={styles.moduleBadge} data-tone="workshop">
                      工坊
                    </span>
                  )}
                  {pressed && (
                    <span className={styles.moduleBadge} data-tone="flaw">
                      已选
                    </span>
                  )}
                </span>
              </span>
              {m.ability && <span className={styles.pickDesc}>{m.ability}</span>}
              <ModuleTags tags={m.tags} />
            </>
          );
          return (
            <li key={m.id} className={styles.pickItem}>
              {editable ? (
                <EditableModuleCard
                  pressed={pressed}
                  disabled={!pressed && full}
                  tone="flaw"
                  editLabel={`编辑本地自定义缺陷 ${m.label}`}
                  deleteLabel={`删除本地自定义缺陷 ${m.label}`}
                  onSelect={toggleFlaw}
                  onEdit={() => setEditor({ mode: "edit", module: m })}
                  onDelete={() => {
                    removeLocalCustomModule(m.id);
                    if (editor?.mode === "edit" && editor.module.id === m.id) setEditor(null);
                    if (pressed) {
                      commit({ ...board, flaws: board.flaws.filter((x) => x.id !== m.id) });
                    }
                  }}
                >
                  {body}
                </EditableModuleCard>
              ) : (
                <button
                  type="button"
                  className={styles.pick}
                  data-tone="flaw"
                  aria-pressed={pressed}
                  disabled={!pressed && full}
                  onClick={toggleFlaw}
                >
                  <CellFrame />
                  {body}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ———— 开局行装：出身默认家底 + 资金档位 + 额外武器 + 专属载具 ————

const RARITY_LABELS: Readonly<Record<string, string>> = {
  common: "普通",
  uncommon: "罕见",
  rare: "稀有",
  epic: "史诗",
  legendary: "传说",
};
const CLASS_LABELS: Readonly<Record<string, string>> = {
  economy: "经济型",
  offroad: "越野",
  executive: "行政",
  sport: "跑车",
  hyper: "超跑",
  moto: "摩托",
};

type WeaponGroup =
  | "all"
  | "pistol"
  | "smg"
  | "rifle"
  | "shotgun"
  | "sniper"
  | "melee"
  | "iconic"
  | "custom";
const WEAPON_GROUPS: readonly {
  readonly id: WeaponGroup;
  readonly label: string;
  readonly cats?: readonly string[];
}[] = [
  { id: "all", label: "全部" },
  { id: "pistol", label: "手枪/左轮", cats: ["pistol", "revolver"] },
  { id: "smg", label: "冲锋枪", cats: ["smg"] },
  { id: "rifle", label: "步枪/机枪", cats: ["assaultRifle", "lmg"] },
  { id: "shotgun", label: "霰弹枪", cats: ["shotgun"] },
  { id: "sniper", label: "狙击/精准", cats: ["sniperRifle", "precisionRifle"] },
  { id: "melee", label: "近战", cats: ["blade", "blunt"] },
  { id: "iconic", label: "不朽" },
  { id: "custom", label: "自建与工坊" },
];

type ItemGroup =
  | "all"
  | "healing"
  | "grenade"
  | "clothing"
  | "mod"
  | "consumable"
  | "misc"
  | "custom";
const ITEM_GROUPS: readonly { readonly id: ItemGroup; readonly label: string }[] = [
  { id: "all", label: "全部" },
  { id: "healing", label: "治疗品" },
  { id: "grenade", label: "手雷" },
  { id: "clothing", label: "服装" },
  { id: "mod", label: "改装件" },
  { id: "consumable", label: "消耗品" },
  { id: "misc", label: "杂物" },
  { id: "custom", label: "自建与工坊" },
];

type VehicleGroup = "all" | "daily" | "sport" | "offroad" | "moto";
const VEHICLE_GROUPS: readonly {
  readonly id: VehicleGroup;
  readonly label: string;
  readonly classes?: readonly string[];
}[] = [
  { id: "all", label: "全部" },
  { id: "daily", label: "经济/行政", classes: ["economy", "executive"] },
  { id: "sport", label: "跑车/超跑", classes: ["sport", "hyper"] },
  { id: "offroad", label: "越野", classes: ["offroad"] },
  { id: "moto", label: "摩托", classes: ["moto"] },
];

type ItemEditorState =
  | null
  | { readonly mode: "create"; readonly kind: inventoryRules.ItemKind }
  | { readonly mode: "edit"; readonly item: inventoryRules.ItemDef };

export type LoadoutSection = "weapons" | "items" | "kit" | "all";

export function LoadoutPicker({
  card,
  board,
  data,
  commit,
  section = "all",
  onSwitchSection,
  maxTotalGear,
  singleItemCount = false,
}: LoadoutPickerProps & {
  readonly section?: LoadoutSection;
  readonly onSwitchSection?: (next: Exclude<LoadoutSection, "all">) => void;
  /** 可选随身装备总件数上限（武器 + 物品合计，用于 NPC 人物卡） */
  readonly maxTotalGear?: number;
  /** 是否每件随身物品固定为单选（数量恒为 1，隐藏 +/- 计数，用于 NPC 人物卡） */
  readonly singleItemCount?: boolean;
}) {
  const showWeapons = section === "all" || section === "weapons";
  const showItems = section === "all" || section === "items";
  const showKit = section === "all" || section === "kit";
  const [hoverWeaponId, setHoverWeaponId] = useState<string | null>(null);
  const [weaponGroup, setWeaponGroup] = useState<WeaponGroup>("all");
  const [weaponQuery, setWeaponQuery] = useState("");
  const [hoverItemId, setHoverItemId] = useState<string | null>(null);
  const [itemGroup, setItemGroup] = useState<ItemGroup>("all");
  const [itemQuery, setItemQuery] = useState("");
  const [itemEditor, setItemEditor] = useState<ItemEditorState>(null);
  const [vehicleGroup, setVehicleGroup] = useState<VehicleGroup>("all");
  const base = originDefaultLoadout(card, data);
  const kit = board.kit;
  const kitItems = kit.items ?? [];
  const kitCustomItems = kit.customItems ?? [];
  const ownedGear = new Set(pickedLoadouts(card, data).flatMap((l) => l.gear.map((g) => g.id)));

  const localCustomDefs = new Map<string, inventoryRules.ItemDef>();
  for (const def of loadLocalCustomItems()) localCustomDefs.set(def.id, def);
  for (const def of kitCustomItems) {
    if (!localCustomDefs.has(def.id)) localCustomDefs.set(def.id, def);
  }

  const syncKit = (patch: Partial<Board["kit"]>) => {
    const nextWeapons = patch.weapons ?? kit.weapons;
    const nextItems = patch.items ?? kitItems;
    const baseCustom = patch.customItems ?? kitCustomItems;
    const activeIds = new Set([...nextWeapons, ...nextItems.map((entry) => entry.id)]);
    const customMap = new Map<string, inventoryRules.ItemDef>();
    for (const def of baseCustom) {
      if (activeIds.has(def.id)) customMap.set(def.id, def);
    }
    for (const id of activeIds) {
      if (!customMap.has(id)) {
        const localDef = localCustomDefs.get(id);
        if (localDef) customMap.set(id, localDef);
      }
    }
    commit({
      ...board,
      kit: {
        ...kit,
        ...patch,
        weapons: nextWeapons,
        items: nextItems,
        customItems: [...customMap.values()],
      },
    });
  };
  const setKit = syncKit;

  const totalGearCount = kit.weapons.length + kitItems.length;
  const gearCapReached = maxTotalGear !== undefined && totalGearCount >= maxTotalGear;

  const toggleWeapon = (weaponId: string) => {
    const on = kit.weapons.includes(weaponId);
    if (!on && gearCapReached) return;
    syncKit({
      weapons: on ? kit.weapons.filter((x) => x !== weaponId) : [...kit.weapons, weaponId],
    });
  };

  const setItemCount = (itemId: string, nextCount: number) => {
    const maxPerItem = singleItemCount ? 1 : 20;
    const clamped = Math.max(0, Math.min(maxPerItem, Math.floor(nextCount)));
    if (clamped <= 0) {
      syncKit({ items: kitItems.filter((entry) => entry.id !== itemId) });
      return;
    }
    const exists = kitItems.some((entry) => entry.id === itemId);
    if (!exists && gearCapReached) return;
    syncKit({
      items: exists
        ? kitItems.map((entry) => (entry.id === itemId ? { ...entry, count: clamped } : entry))
        : [...kitItems, { id: itemId, count: clamped }],
    });
  };

  const handleCustomItemAccepted = (def: inventoryRules.ItemDef, equipToKit: boolean) => {
    const updatedCustom = [...kitCustomItems.filter((entry) => entry.id !== def.id), def];
    if (equipToKit) {
      if (def.kind === "weapon") {
        const nextWeapons = kit.weapons.includes(def.id) ? kit.weapons : [...kit.weapons, def.id];
        syncKit({
          weapons: nextWeapons,
          items: kitItems.filter((entry) => entry.id !== def.id),
          customItems: updatedCustom,
        });
      } else {
        const exists = kitItems.some((entry) => entry.id === def.id);
        syncKit({
          weapons: kit.weapons.filter((id) => id !== def.id),
          items: exists ? kitItems : [...kitItems, { id: def.id, count: 1 }],
          customItems: updatedCustom,
        });
      }
    } else if (kit.weapons.includes(def.id) || kitItems.some((entry) => entry.id === def.id)) {
      // 仅更新已带在行装里的自建定义快照
      syncKit({ customItems: updatedCustom });
    }
    setItemEditor(null);
    const targetSection = def.kind === "weapon" ? "weapons" : "items";
    if (section !== "all" && section !== targetSection) {
      onSwitchSection?.(targetSection);
    }
  };

  const handleDeleteLocalItem = (id: string) => {
    removeLocalCustomItem(id);
    if (itemEditor?.mode === "edit" && itemEditor.item.id === id) setItemEditor(null);
    if (kit.weapons.includes(id) || kitItems.some((entry) => entry.id === id)) {
      syncKit({
        weapons: kit.weapons.filter((w) => w !== id),
        items: kitItems.filter((entry) => entry.id !== id),
        customItems: kitCustomItems.filter((entry) => entry.id !== id),
      });
    }
  };

  const weapons = data.weapons ?? [];
  const activeWeaponCats = WEAPON_GROUPS.find((g) => g.id === weaponGroup)?.cats;
  const normalizedWeaponQuery = weaponQuery.trim().toLowerCase();
  const shownWeapons = weapons.filter((w) => {
    if (weaponGroup === "iconic" && !w.iconic) return false;
    if (weaponGroup === "custom" && !w.custom && !isWorkshopEntry(w.packId)) return false;
    if (activeWeaponCats && (w.category === undefined || !activeWeaponCats.includes(w.category))) {
      return false;
    }
    if (!normalizedWeaponQuery) return true;
    return `${w.name} ${w.ability}`.toLowerCase().includes(normalizedWeaponQuery);
  });

  const items = data.items ?? [];
  const normalizedItemQuery = itemQuery.trim().toLowerCase();
  const shownItems = items.filter((item) => {
    if (itemGroup === "custom") {
      if (!item.custom && !isWorkshopEntry(item.packId)) return false;
    } else if (itemGroup !== "all" && item.kind !== itemGroup) {
      return false;
    }
    if (!normalizedItemQuery) return true;
    return `${item.name} ${item.ability}`.toLowerCase().includes(normalizedItemQuery);
  });

  const vehicles = data.vehicles ?? [];
  const activeVehicleClasses = VEHICLE_GROUPS.find((g) => g.id === vehicleGroup)?.classes;
  const shownVehicles = activeVehicleClasses
    ? vehicles.filter((v) => activeVehicleClasses.includes(v.class))
    : vehicles;
  const previewWeapon =
    weapons.find((w) => w.id === hoverWeaponId) ??
    weapons.find((w) => kit.weapons.includes(w.id)) ??
    null;
  const previewCategory =
    previewWeapon?.category && previewWeapon.category in inventoryRules.WEAPON_CATEGORY_LABELS
      ? inventoryRules.WEAPON_CATEGORY_LABELS[
          previewWeapon.category as keyof typeof inventoryRules.WEAPON_CATEGORY_LABELS
        ]
      : undefined;
  const previewWeaponType =
    previewWeapon?.weaponType && previewWeapon.weaponType in inventoryRules.WEAPON_TYPE_LABELS
      ? inventoryRules.WEAPON_TYPE_LABELS[
          previewWeapon.weaponType as keyof typeof inventoryRules.WEAPON_TYPE_LABELS
        ]
      : undefined;

  const previewItem =
    items.find((i) => i.id === hoverItemId) ??
    items.find((i) => kitItems.some((entry) => entry.id === i.id)) ??
    null;
  const totalKitItemUnits = kitItems.reduce((sum, entry) => sum + entry.count, 0);
  const nameOf = (id: string) =>
    data.names?.[id] ??
    weapons.find((w) => w.id === id)?.name ??
    items.find((i) => i.id === id)?.name ??
    localCustomDefs.get(id)?.name ??
    id;

  return (
    <div className={styles.pickerBody}>
      {/* ———— 原地自建武器 / 物品表单 ———— */}
      {(showWeapons || showItems) && itemEditor && (
        <CustomItemForm
          key={itemEditor.mode === "edit" ? itemEditor.item.id : `new-${itemEditor.kind}`}
          initialKind={itemEditor.mode === "create" ? itemEditor.kind : itemEditor.item.kind}
          {...(itemEditor.mode === "edit" ? { initial: itemEditor.item } : {})}
          onCancel={() => setItemEditor(null)}
          onAccept={handleCustomItemAccepted}
        />
      )}

      {/* ———— 随身武器（无数量限制，含全稀有度、不朽与自建武器） ———— */}
      {showWeapons && (
        <>
          <div className={styles.slotTools}>
            <h4 className={styles.subTitle}>
              随身武器{" "}
              <small className={styles.stepNote}>
                {maxTotalGear !== undefined
                  ? `已选 ${kit.weapons.length} 把（装备总计 ${totalGearCount}/${maxTotalGear}）· 共 ${weapons.length} 款`
                  : `已选 ${kit.weapons.length} 把（无数量限制，前 3 把进快捷栏，其余入背包）· 共 ${weapons.length} 款`}
              </small>
            </h4>
            {!itemEditor && (
              <Button small onClick={() => setItemEditor({ mode: "create", kind: "weapon" })}>
                ＋ 自建武器
              </Button>
            )}
          </div>
          {kit.weapons.length > 0 && (
            <section className={styles.itemSelectedBar} aria-label="已选随身武器清单">
              {kit.weapons.map((weaponId) => (
                <span key={weaponId} className={styles.itemSelectedChip}>
                  <strong>{nameOf(weaponId)}</strong>
                  <button
                    type="button"
                    className={styles.qtyBtn}
                    aria-label={`移除 ${nameOf(weaponId)}`}
                    onClick={() => toggleWeapon(weaponId)}
                  >
                    ×
                  </button>
                </span>
              ))}
            </section>
          )}
          <div className={styles.slotTools}>
            <FrameBox className={styles.searchBox}>
              <input
                type="search"
                value={weaponQuery}
                placeholder="搜索任意武器（含不朽、传说、自建武器）…"
                aria-label="搜索随身武器"
                onChange={(e) => setWeaponQuery(e.target.value)}
              />
            </FrameBox>
          </div>
          <fieldset className={styles.shelfFilter} aria-label="按武器类别筛选">
            {WEAPON_GROUPS.map((g) => {
              const count =
                g.id === "iconic"
                  ? weapons.filter((w) => w.iconic).length
                  : g.id === "custom"
                    ? weapons.filter((w) => w.custom || isWorkshopEntry(w.packId)).length
                    : g.cats
                      ? weapons.filter(
                          (w) => w.category !== undefined && g.cats?.includes(w.category),
                        ).length
                      : weapons.length;
              return (
                <Button
                  key={g.id}
                  small
                  pressed={weaponGroup === g.id}
                  onClick={() => setWeaponGroup(g.id)}
                >
                  {g.label} ({count})
                </Button>
              );
            })}
          </fieldset>
          <div
            className={styles.weaponPreview}
            data-rarity={previewWeapon?.rarity}
            data-empty={previewWeapon ? undefined : ""}
            aria-live="polite"
          >
            <CellFrame />
            {previewWeapon ? (
              <>
                <span className={styles.previewArtBox}>
                  {itemArtOf(previewWeapon.id) ? (
                    <Asset
                      id={itemArtOf(previewWeapon.id) as AssetId}
                      className={styles.previewArtImg}
                    />
                  ) : (
                    <span className={styles.previewArtFallback}>
                      {previewCategory?.slice(0, 2) ?? "武装"}
                    </span>
                  )}
                </span>
                <div className={styles.previewBody}>
                  <div className={styles.weaponPreviewHead}>
                    <span className={styles.weaponPreviewMeta}>
                      <strong className={styles.previewTitle}>{previewWeapon.name}</strong>
                      {previewWeapon.iconic && (
                        <span className={styles.moduleBadge} data-tone="iconic">
                          不朽
                        </span>
                      )}
                      {(previewWeapon.custom || isWorkshopEntry(previewWeapon.packId)) && (
                        <span className={styles.moduleBadge} data-tone="workshop">
                          {previewWeapon.packId === "local" ? "自建" : "工坊"}
                        </span>
                      )}
                    </span>
                    {(ownedGear.has(previewWeapon.id) ||
                      kit.weapons.includes(previewWeapon.id)) && (
                      <span className={styles.moduleBadge} data-tone="active">
                        {ownedGear.has(previewWeapon.id) ? "出身自带" : "已选配"}
                      </span>
                    )}
                  </div>
                  <div className={styles.previewSpecs}>
                    <span className={styles.previewSpecChip}>
                      {RARITY_LABELS[previewWeapon.rarity] ?? previewWeapon.rarity}
                    </span>
                    {previewCategory && (
                      <span className={styles.previewSpecChip} data-tone="accent">
                        {previewCategory}
                        {previewWeaponType ? ` · ${previewWeaponType}` : ""}
                      </span>
                    )}
                    {previewWeapon.price !== undefined && previewWeapon.price > 0 && (
                      <span className={styles.previewSpecChip} data-tone="price">
                        {previewWeapon.price.toLocaleString("en-US")} €
                      </span>
                    )}
                  </div>
                  <p className={styles.weaponPreviewDesc}>
                    {previewWeapon.ability || "暂无详细特性说明。"}
                  </p>
                </div>
              </>
            ) : (
              <p className={styles.weaponPreviewDesc}>
                将光标移至任意武器卡片即可检视大图与属性，点击自由选配（不限把数、支持不朽与自建武器）。
              </p>
            )}
          </div>
          {shownWeapons.length === 0 ? (
            <p className={styles.note}>没有匹配当前搜索条件的武器。</p>
          ) : (
            <ul className={styles.weaponGrid}>
              {shownWeapons.map((w) => {
                const on = kit.weapons.includes(w.id);
                const owned = ownedGear.has(w.id);
                const isLocalCustom = w.packId === "local" && localCustomDefs.has(w.id);
                const isWorkshop = isWorkshopEntry(w.packId);
                const catLabel =
                  w.category && w.category in inventoryRules.WEAPON_CATEGORY_LABELS
                    ? inventoryRules.WEAPON_CATEGORY_LABELS[
                        w.category as keyof typeof inventoryRules.WEAPON_CATEGORY_LABELS
                      ]
                    : undefined;
                const typeLabel =
                  w.weaponType && w.weaponType in inventoryRules.WEAPON_TYPE_LABELS
                    ? inventoryRules.WEAPON_TYPE_LABELS[
                        w.weaponType as keyof typeof inventoryRules.WEAPON_TYPE_LABELS
                      ]
                    : undefined;
                return (
                  <li
                    key={w.id}
                    onMouseEnter={() => setHoverWeaponId(w.id)}
                    onFocus={() => setHoverWeaponId(w.id)}
                  >
                    <div
                      className={styles.gearCard}
                      data-rarity={w.rarity}
                      data-on={on || undefined}
                      data-disabled={(!on && owned) || undefined}
                      data-hovered={hoverWeaponId === w.id || undefined}
                    >
                      <CellFrame />
                      <button
                        type="button"
                        className={styles.gearCardMain}
                        aria-pressed={on}
                        disabled={!on && owned}
                        onClick={() => toggleWeapon(w.id)}
                      >
                        <span className={styles.gearArtBox}>
                          {itemArtOf(w.id) ? (
                            <Asset id={itemArtOf(w.id) as AssetId} className={styles.weaponImg} />
                          ) : (
                            <span className={styles.gearArtFallback}>
                              {catLabel?.slice(0, 2) ?? "武装"}
                            </span>
                          )}
                        </span>
                        <span className={styles.gearCardBody}>
                          <span className={styles.gearCardHead}>
                            <span className={styles.weaponName} data-rarity={w.rarity}>
                              {w.name}
                            </span>
                            <span
                              className={styles.gearStatusTag}
                              data-state={owned ? "owned" : on ? "on" : undefined}
                            >
                              {owned ? "自带" : on ? "已选" : "选用"}
                            </span>
                          </span>
                          <span className={styles.gearMetaRow}>
                            <span>{RARITY_LABELS[w.rarity] ?? w.rarity}</span>
                            {catLabel && (
                              <span>
                                · {catLabel}
                                {typeLabel ? `/${typeLabel}` : ""}
                              </span>
                            )}
                            {w.iconic && (
                              <span className={styles.moduleBadge} data-tone="iconic">
                                不朽
                              </span>
                            )}
                            {(isLocalCustom || isWorkshop) && (
                              <span className={styles.moduleBadge} data-tone="workshop">
                                {isLocalCustom ? "自建" : "工坊"}
                              </span>
                            )}
                            {w.price !== undefined && w.price > 0 && (
                              <span className={styles.gearPrice}>
                                {w.price.toLocaleString("en-US")} €
                              </span>
                            )}
                          </span>
                          <span className={styles.weaponAbility}>{w.ability || "自定义武器"}</span>
                        </span>
                      </button>
                      {isLocalCustom && (
                        <div className={styles.gearCardFoot}>
                          <span className={styles.gearFootGroup}>本地自建武器</span>
                          <span className={styles.gearFootGroup}>
                            <button
                              type="button"
                              className={styles.qtyBtn}
                              onClick={() => {
                                const def = localCustomDefs.get(w.id);
                                if (def) setItemEditor({ mode: "edit", item: def });
                              }}
                            >
                              编辑
                            </button>
                            <button
                              type="button"
                              className={styles.qtyBtn}
                              onClick={() => handleDeleteLocalItem(w.id)}
                            >
                              删除
                            </button>
                          </span>
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      {/* ———— 开局随身物品（治疗品、手雷、服装、改装件、消耗品、杂物与自建物品） ———— */}
      {showItems && (
        <>
          <div className={styles.slotTools}>
            <h4 className={styles.subTitle}>
              {singleItemCount ? "随身物品" : "开局随身物品"}{" "}
              <small className={styles.stepNote}>
                {maxTotalGear !== undefined
                  ? `已选 ${kitItems.length} 件（装备总计 ${totalGearCount}/${maxTotalGear}）· 目录 ${items.length} 款`
                  : `已选 ${kitItems.length} 种（共 ${totalKitItemUnits} 件）· 目录 ${items.length} 款`}
              </small>
            </h4>
            {!itemEditor && (
              <Button small onClick={() => setItemEditor({ mode: "create", kind: "healing" })}>
                ＋ 自建物品
              </Button>
            )}
          </div>

          {kitItems.length > 0 && (
            <section className={styles.itemSelectedBar} aria-label="已选随身物品清单">
              {kitItems.map((entry) => (
                <span key={entry.id} className={styles.itemSelectedChip}>
                  <strong>{nameOf(entry.id)}</strong>
                  {singleItemCount ? (
                    <button
                      type="button"
                      className={styles.qtyBtn}
                      aria-label={`移除 ${nameOf(entry.id)}`}
                      onClick={() => setItemCount(entry.id, 0)}
                    >
                      ×
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        className={styles.qtyBtn}
                        aria-label={`减少 ${nameOf(entry.id)} 数量`}
                        onClick={() => setItemCount(entry.id, entry.count - 1)}
                      >
                        −
                      </button>
                      <span className="num">{entry.count}</span>
                      <button
                        type="button"
                        className={styles.qtyBtn}
                        disabled={entry.count >= 20}
                        aria-label={`增加 ${nameOf(entry.id)} 数量`}
                        onClick={() => setItemCount(entry.id, entry.count + 1)}
                      >
                        ＋
                      </button>
                    </>
                  )}
                </span>
              ))}
            </section>
          )}

          <div className={styles.slotTools}>
            <FrameBox className={styles.searchBox}>
              <input
                type="search"
                value={itemQuery}
                placeholder="搜索治疗针、压制剂、手雷、服装、改装件、超梦设备或杂物…"
                aria-label="搜索开局随身物品"
                onChange={(e) => setItemQuery(e.target.value)}
              />
            </FrameBox>
          </div>

          <fieldset className={styles.shelfFilter} aria-label="按物品类别筛选">
            {ITEM_GROUPS.map((g) => {
              const count =
                g.id === "all"
                  ? items.length
                  : g.id === "custom"
                    ? items.filter((i) => i.custom || isWorkshopEntry(i.packId)).length
                    : items.filter((i) => i.kind === g.id).length;
              return (
                <Button
                  key={g.id}
                  small
                  pressed={itemGroup === g.id}
                  onClick={() => setItemGroup(g.id)}
                >
                  {g.label} ({count})
                </Button>
              );
            })}
          </fieldset>

          <div
            className={styles.weaponPreview}
            data-rarity={previewItem?.rarity}
            data-empty={previewItem ? undefined : ""}
            aria-live="polite"
          >
            <CellFrame />
            {previewItem ? (
              <>
                <span className={styles.previewArtBox}>
                  {itemArtOf(previewItem.id) ? (
                    <Asset
                      id={itemArtOf(previewItem.id) as AssetId}
                      className={styles.previewArtImg}
                    />
                  ) : (
                    <span className={styles.previewArtFallback}>
                      {(
                        inventoryRules.ITEM_KIND_LABELS[
                          previewItem.kind as inventoryRules.ItemKind
                        ] ?? previewItem.kind
                      ).slice(0, 2)}
                    </span>
                  )}
                </span>
                <div className={styles.previewBody}>
                  <div className={styles.weaponPreviewHead}>
                    <span className={styles.weaponPreviewMeta}>
                      <strong className={styles.previewTitle}>{previewItem.name}</strong>
                      {previewItem.iconic && (
                        <span className={styles.moduleBadge} data-tone="iconic">
                          不朽
                        </span>
                      )}
                      {previewItem.suppressant && (
                        <span className={styles.moduleBadge} data-tone="active">
                          压制剂
                        </span>
                      )}
                      {(previewItem.custom || isWorkshopEntry(previewItem.packId)) && (
                        <span className={styles.moduleBadge} data-tone="workshop">
                          {previewItem.packId === "local" ? "自建" : "工坊"}
                        </span>
                      )}
                    </span>
                    {(() => {
                      const chosen = kitItems.find((entry) => entry.id === previewItem.id);
                      return chosen ? (
                        <span className={styles.moduleBadge} data-tone="active">
                          已选 ×{chosen.count}
                        </span>
                      ) : null;
                    })()}
                  </div>
                  <div className={styles.previewSpecs}>
                    <span className={styles.previewSpecChip}>
                      {RARITY_LABELS[previewItem.rarity] ?? previewItem.rarity}
                    </span>
                    <span className={styles.previewSpecChip} data-tone="accent">
                      {inventoryRules.ITEM_KIND_LABELS[
                        previewItem.kind as inventoryRules.ItemKind
                      ] ?? previewItem.kind}
                    </span>
                    {previewItem.charges ? (
                      <span className={styles.previewSpecChip}>{previewItem.charges} 次充能</span>
                    ) : null}
                    {previewItem.healPercent ? (
                      <span className={styles.previewSpecChip}>
                        回血 {previewItem.healPercent}%
                      </span>
                    ) : null}
                    {previewItem.price !== undefined && previewItem.price > 0 && (
                      <span className={styles.previewSpecChip} data-tone="price">
                        {previewItem.price.toLocaleString("en-US")} €
                      </span>
                    )}
                  </div>
                  <p className={styles.weaponPreviewDesc}>
                    {previewItem.ability || "实用随身物品，点击加入开局背包。"}
                  </p>
                </div>
              </>
            ) : (
              <p className={styles.weaponPreviewDesc}>
                将光标移至任意物品卡片即可检视详情，点击加入开局背包（支持治疗品、手雷、服装、改装件、消耗品、杂物与自建物品）。
              </p>
            )}
          </div>

          {shownItems.length === 0 ? (
            <p className={styles.note}>没有匹配当前筛选条件的物品。</p>
          ) : (
            <ul className={styles.weaponGrid}>
              {shownItems.map((item) => {
                const chosen = kitItems.find((entry) => entry.id === item.id);
                const count = chosen?.count ?? 0;
                const isLocalCustom = item.packId === "local" && localCustomDefs.has(item.id);
                const isWorkshop = isWorkshopEntry(item.packId);
                const kindLabel =
                  inventoryRules.ITEM_KIND_LABELS[item.kind as inventoryRules.ItemKind] ??
                  item.kind;
                return (
                  <li
                    key={item.id}
                    onMouseEnter={() => setHoverItemId(item.id)}
                    onFocus={() => setHoverItemId(item.id)}
                  >
                    <div
                      className={styles.gearCard}
                      data-rarity={item.rarity}
                      data-on={count > 0 || undefined}
                      data-hovered={hoverItemId === item.id || undefined}
                    >
                      <CellFrame />
                      <button
                        type="button"
                        className={styles.gearCardMain}
                        aria-pressed={count > 0}
                        onClick={() => setItemCount(item.id, count > 0 ? 0 : 1)}
                      >
                        <span className={styles.gearArtBox}>
                          {itemArtOf(item.id) ? (
                            <Asset
                              id={itemArtOf(item.id) as AssetId}
                              className={styles.weaponImg}
                            />
                          ) : (
                            <span className={styles.gearArtFallback}>{kindLabel.slice(0, 2)}</span>
                          )}
                        </span>
                        <span className={styles.gearCardBody}>
                          <span className={styles.gearCardHead}>
                            <span className={styles.weaponName} data-rarity={item.rarity}>
                              {item.name}
                            </span>
                            <span
                              className={styles.gearStatusTag}
                              data-state={count > 0 ? "on" : undefined}
                            >
                              {count > 0 ? (singleItemCount ? "已选" : `×${count}`) : "携带"}
                            </span>
                          </span>
                          <span className={styles.gearMetaRow}>
                            <span>{RARITY_LABELS[item.rarity] ?? item.rarity}</span>
                            <span>· {kindLabel}</span>
                            {item.charges ? <span>· {item.charges}次</span> : null}
                            {item.suppressant && (
                              <span className={styles.moduleBadge} data-tone="active">
                                压制
                              </span>
                            )}
                            {(isLocalCustom || isWorkshop) && (
                              <span className={styles.moduleBadge} data-tone="workshop">
                                {isLocalCustom ? "自建" : "工坊"}
                              </span>
                            )}
                            {item.price !== undefined && item.price > 0 && (
                              <span className={styles.gearPrice}>
                                {item.price.toLocaleString("en-US")} €
                              </span>
                            )}
                          </span>
                          <span className={styles.weaponAbility}>{item.ability || kindLabel}</span>
                        </span>
                      </button>
                      {(count > 0 || isLocalCustom) && (
                        <div className={styles.gearCardFoot}>
                          <span className={styles.gearFootGroup}>
                            {count > 0 ? (
                              <>
                                <span>数量</span>
                                <button
                                  type="button"
                                  className={styles.qtyBtn}
                                  aria-label={`减少 ${item.name} 数量`}
                                  onClick={() => setItemCount(item.id, count - 1)}
                                >
                                  −
                                </button>
                                <span className={styles.gearFootCount}>{count}</span>
                                <button
                                  type="button"
                                  className={styles.qtyBtn}
                                  disabled={count >= 20}
                                  aria-label={`增加 ${item.name} 数量`}
                                  onClick={() => setItemCount(item.id, count + 1)}
                                >
                                  ＋
                                </button>
                              </>
                            ) : (
                              <span>本地自建物品</span>
                            )}
                          </span>
                          {isLocalCustom && (
                            <span className={styles.gearFootGroup}>
                              <button
                                type="button"
                                className={styles.qtyBtn}
                                onClick={() => {
                                  const def = localCustomDefs.get(item.id);
                                  if (def) setItemEditor({ mode: "edit", item: def });
                                }}
                              >
                                编辑
                              </button>
                              <button
                                type="button"
                                className={styles.qtyBtn}
                                onClick={() => handleDeleteLocalItem(item.id)}
                              >
                                删除
                              </button>
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      {showKit && vehicles.length > 0 && (
        <>
          <h4 className={styles.subTitle}>
            专属载具{" "}
            <small className={styles.stepNote}>
              共 {vehicles.length} 款 · 选定后将替换出身默认座驾
            </small>
          </h4>
          <fieldset className={styles.shelfFilter} aria-label="按载具类别筛选">
            {VEHICLE_GROUPS.map((g) => {
              const count = g.classes
                ? vehicles.filter((v) => g.classes?.includes(v.class)).length
                : vehicles.length;
              return (
                <Button
                  key={g.id}
                  small
                  pressed={vehicleGroup === g.id}
                  onClick={() => setVehicleGroup(g.id)}
                >
                  {g.label} ({count})
                </Button>
              );
            })}
          </fieldset>
          <ul className={styles.vehicleGrid}>
            {shownVehicles.map((v) => {
              const free = base.freeVehicleIds.includes(v.id);
              const replacedByCustom = free && kit.vehicle !== null && kit.vehicle !== v.id;
              const active = (free && kit.vehicle === null) || kit.vehicle === v.id;
              const art = vehicleArtOf(v.id);
              const badgeText = replacedByCustom
                ? "将被替换"
                : free
                  ? "出身自带"
                  : active
                    ? "已选专属"
                    : (CLASS_LABELS[v.class] ?? v.class);
              return (
                <li key={v.id}>
                  <button
                    type="button"
                    className={`${styles.pick} ${styles.vehiclePick}`}
                    aria-pressed={active}
                    disabled={free && kit.vehicle === null}
                    onClick={() =>
                      setKit({
                        vehicle: free ? null : kit.vehicle === v.id ? null : v.id,
                      })
                    }
                  >
                    <CellFrame />
                    <span className={styles.vehicleArt}>
                      {art ? (
                        <Asset id={art} alt={v.name} className={styles.vehicleImg} />
                      ) : (
                        <span className={styles.shelfMeta}>无图</span>
                      )}
                    </span>
                    <span className={styles.vehicleInfo}>
                      <span className={styles.pickHead}>
                        <strong className={styles.pickName}>{v.name}</strong>
                        <span
                          className={styles.moduleBadge}
                          data-tone={active ? "active" : undefined}
                        >
                          {badgeText}
                        </span>
                      </span>
                      <span>
                        {[`${v.maker} · ${v.seats} 座`, v.note].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

// ———— 义体货架：按统一直觉分区自由装配 + 支持本地自创义体 ————

const RARITY_ORDER = ["common", "uncommon", "rare", "epic", "legendary"] as const;

type CyberEditorState =
  | null
  | { readonly mode: "create" }
  | { readonly mode: "edit"; readonly item: StartCyberware };

type KindFilter = "all" | "custom";

export function CyberwareShelf({
  card,
  board,
  data,
  commit,
  category,
  armTarget = "both",
  onArmTargetChange,
  onCategoryChange,
  maxCount,
}: CyberwareShelfProps) {
  type Offer = BoardData["cyberware"][number];
  const [shelfState, setShelfState] = useState<{
    readonly category: cyberwareRules.CyberwareCategoryId;
    readonly rarity: string | null;
    readonly kind: KindFilter;
    readonly query: string;
  }>({ category, rarity: null, kind: "all", query: "" });
  const [editor, setEditor] = useState<{
    readonly category: cyberwareRules.CyberwareCategoryId;
    readonly state: CyberEditorState;
  }>({
    category,
    state: null,
  });
  const [customScope, setCustomScope] = useState<"section" | "all">("all");
  const [editorNotice, setEditorNotice] = useState<string | null>(null);
  const [variantChoice, setVariantChoice] = useState<
    Readonly<Record<string, cyberwareRules.ElementVariantKey>>
  >({});

  const rarity = shelfState.category === category ? shelfState.rarity : null;
  const kind = shelfState.category === category ? shelfState.kind : "all";
  const query = shelfState.category === category ? shelfState.query : "";
  const activeEditor = editor.category === category ? editor.state : null;
  const setRarity = (next: string | null) => setShelfState({ category, rarity: next, kind, query });
  const setKind = (next: KindFilter) => {
    setEditorNotice(null);
    setShelfState({ category, rarity, kind: next, query });
  };
  const setQuery = (next: string) => setShelfState({ category, rarity, kind, query: next });
  const setActiveEditor = (next: CyberEditorState) => {
    setEditorNotice(null);
    setEditor({ category, state: next });
  };

  const offerMap = new Map(data.cyberware.map((o) => [o.id, o]));
  const slotOf = (c: Board["cyberware"][number]) =>
    (offerMap.get(c.id)?.slot ?? c.slot) as CyberSlot | undefined;

  const probeOfOffer = (o: Offer, side?: cyberwareRules.ArmSide): cyberwareRules.LoadProbe => ({
    id: o.id,
    name: o.name,
    slot: o.slot as CyberSlot,
    humanityCost: o.humanityCost,
    ...(o.category ? { category: o.category } : {}),
    ...(side ? { armSide: side } : {}),
    ...(o.defaultArmSide ? { defaultArmSide: o.defaultArmSide } : {}),
    ...(o.capacityBonus !== undefined ? { capacityBonus: o.capacityBonus } : {}),
    ...(o.safeLineBonus !== undefined ? { safeLineBonus: o.safeLineBonus } : {}),
    ...(o.chassisProfile ? { chassisProfile: o.chassisProfile } : {}),
    ...(o.armor ? { armor: true } : {}),
    ...(o.accelerator ? { accelerator: true } : {}),
    ...(o.deckProfile ? { deckProfile: o.deckProfile } : {}),
    ...(o.deckTraits ? { deckTraits: o.deckTraits } : {}),
    ...(o.exclusiveGroup ? { exclusiveGroup: o.exclusiveGroup } : {}),
  });

  const categoryOfOffer = (o: Offer): cyberwareRules.CyberwareCategoryId =>
    o.category ?? cyberwareRules.cyberwareCategoryOf(probeOfOffer(o));

  const chosenProbes: cyberwareRules.LoadProbe[] = board.cyberware.flatMap((c) => {
    const def = offerMap.get(c.id);
    const resolvedSlot = slotOf(c);
    if (!resolvedSlot) return [];
    return [
      {
        id: c.id,
        name: c.name,
        slot: resolvedSlot,
        humanityCost: def?.humanityCost ?? c.humanityCost,
        ...(def?.category || c.category ? { category: def?.category ?? c.category } : {}),
        ...(c.armSide ? { armSide: c.armSide } : {}),
        ...(def?.defaultArmSide || c.defaultArmSide
          ? { defaultArmSide: def?.defaultArmSide ?? c.defaultArmSide }
          : {}),
        ...(def?.capacityBonus !== undefined || c.capacityBonus !== undefined
          ? { capacityBonus: def?.capacityBonus ?? c.capacityBonus }
          : {}),
        ...(def?.safeLineBonus !== undefined || c.safeLineBonus !== undefined
          ? { safeLineBonus: def?.safeLineBonus ?? c.safeLineBonus }
          : {}),
        ...(def?.chassisProfile || c.chassisProfile
          ? { chassisProfile: def?.chassisProfile ?? c.chassisProfile }
          : {}),
        ...(def?.armor || c.armor ? { armor: true } : {}),
        ...(def?.accelerator || c.accelerator ? { accelerator: true } : {}),
        ...(def?.deckProfile || c.deckProfile
          ? { deckProfile: def?.deckProfile ?? c.deckProfile }
          : {}),
        ...(def?.deckTraits ? { deckTraits: def.deckTraits } : {}),
        ...(def?.exclusiveGroup || c.exclusiveGroup
          ? { exclusiveGroup: def?.exclusiveGroup ?? c.exclusiveGroup }
          : {}),
      },
    ];
  });

  const inherentActiveProbes: cyberwareRules.LoadProbe[] = inherentCyberware(card, data)
    .filter((i) => !i.replaced)
    .flatMap((i) => {
      const def = offerMap.get(i.id);
      return [
        {
          id: i.id,
          name: i.name,
          slot: i.slot as CyberSlot,
          humanityCost: i.humanityCost,
          ...(def?.category ? { category: def.category } : {}),
          ...(def?.defaultArmSide ? { defaultArmSide: def.defaultArmSide } : {}),
          ...(def?.capacityBonus !== undefined ? { capacityBonus: def.capacityBonus } : {}),
          ...(def?.safeLineBonus !== undefined ? { safeLineBonus: def.safeLineBonus } : {}),
          ...(def?.chassisProfile ? { chassisProfile: def.chassisProfile } : {}),
          ...(def?.armor ? { armor: true } : {}),
          ...(def?.accelerator ? { accelerator: true } : {}),
          ...(def?.deckProfile ? { deckProfile: def.deckProfile } : {}),
          ...(def?.deckTraits ? { deckTraits: def.deckTraits } : {}),
          ...(def?.exclusiveGroup ? { exclusiveGroup: def.exclusiveGroup } : {}),
        },
      ];
    });

  const allActiveProbes: cyberwareRules.LoadProbe[] = [...chosenProbes, ...inherentActiveProbes];
  const armSidesMap = cyberwareRules.resolveArmSides(chosenProbes);

  const options = data.cyberware.filter((o) => categoryOfOffer(o) === category);
  const allCustomOptions = data.cyberware.filter((o) => o.custom || isWorkshopEntry(o.packId));
  const sectionCustomCount = options.filter((o) => o.custom || isWorkshopEntry(o.packId)).length;
  const sourceOptions =
    kind === "custom"
      ? customScope === "all"
        ? allCustomOptions
        : options.filter((o) => o.custom || isWorkshopEntry(o.packId))
      : options;
  const rarities = RARITY_ORDER.filter((r) => sourceOptions.some((o) => o.rarity === r));
  const normalizedQuery = query.trim().toLowerCase();
  const filteredOffers = sourceOptions.filter((o) => {
    if (rarity && o.rarity !== rarity) return false;
    if (!normalizedQuery) return true;
    const hay = [o.name, o.slotLabel, o.ability, o.deckProfile ?? "", ...(o.deckTraits ?? [])]
      .join(" ")
      .toLowerCase();
    return hay.includes(normalizedQuery);
  });

  /** 将同款手臂武器元素变体按 variantGroup + variantKey 收拢为 1 张主卡（常规/热能/电磁/化学卡内切换） */
  const displayEntries = cyberwareRules.foldCyberwareVariants(filteredOffers, {
    disabled: normalizedQuery.length > 0,
    chosen: variantChoice,
    isPreferred: (offer) => board.cyberware.some((c) => c.id === offer.id),
  });

  const mountedInCategory = board.cyberware.filter((c) => {
    const def = offerMap.get(c.id);
    const resolvedSlot = slotOf(c);
    if (!resolvedSlot) return false;
    return (
      cyberwareRules.cyberwareCategoryOf({
        id: c.id,
        name: c.name,
        slot: resolvedSlot,
        ...(def?.category || c.category ? { category: def?.category ?? c.category } : {}),
        ...(def?.armor || c.armor ? { armor: true } : {}),
        ...(def?.accelerator || c.accelerator ? { accelerator: true } : {}),
        ...(def?.deckProfile || c.deckProfile
          ? { deckProfile: def?.deckProfile ?? c.deckProfile }
          : {}),
        ...(def?.deckTraits ? { deckTraits: def.deckTraits } : {}),
        ...(def?.exclusiveGroup || c.exclusiveGroup
          ? { exclusiveGroup: def?.exclusiveGroup ?? c.exclusiveGroup }
          : {}),
      }) === category
    );
  });

  const inherentInCategory = inherentCyberware(card, data).filter((i) => {
    const def = offerMap.get(i.id);
    return (
      cyberwareRules.cyberwareCategoryOf({
        id: i.id,
        name: i.name,
        slot: i.slot as CyberSlot,
        ...(def?.category ? { category: def.category } : {}),
        ...(def?.armor ? { armor: true } : {}),
        ...(def?.accelerator ? { accelerator: true } : {}),
        ...(def?.deckProfile ? { deckProfile: def.deckProfile } : {}),
        ...(def?.deckTraits ? { deckTraits: def.deckTraits } : {}),
        ...(def?.exclusiveGroup ? { exclusiveGroup: def.exclusiveGroup } : {}),
      }) === category
    );
  });

  const isOn = (o: Offer) => board.cyberware.some((p) => p.id === o.id);

  /** 评估把 o（以可选 side）装入后的三道校验（自动换下互斥旧件后校验承载与空间） */
  const evaluateInstall = (o: Offer, side?: cyberwareRules.ArmSide) => {
    const probe = probeOfOffer(o, side);
    const conflict = cyberwareRules.cyberwareConflicts(probe, chosenProbes);
    const replaceIds = !conflict.ok ? conflict.blockers.map((b) => b.id) : [];
    const check = cyberwareRules.checkCyberwareInstall(probe, allActiveProbes, {
      ignoreIds: [o.id, ...replaceIds],
    });
    return {
      conflict,
      replaceIds,
      replaceNames: !conflict.ok ? conflict.blockers.map((b) => b.name) : [],
      check,
    };
  };

  const toStartEntry = (o: Offer, side?: cyberwareRules.ArmSide): StartCyberware => {
    const probe = probeOfOffer(o, side);
    const group = cyberwareRules.cyberwareExclusiveGroup(probe);
    const cat = categoryOfOffer(o);
    const parsedRarity = economyRules.RaritySchema.safeParse(o.rarity);
    return {
      id: o.id,
      name: o.name,
      humanityCost: cat === "lifestyle" ? 0 : o.humanityCost,
      slot: o.slot as CyberSlot,
      category: cat,
      ...(parsedRarity.success ? { rarity: parsedRarity.data } : {}),
      ...(o.custom ? { custom: true } : {}),
      ...(o.packId ? { packId: o.packId } : {}),
      ...(o.custom && o.ability ? { ability: o.ability } : {}),
      ...(o.custom && o.armor ? { armor: true } : {}),
      ...(o.custom && o.accelerator ? { accelerator: true } : {}),
      ...(o.custom && o.deckProfile ? { deckProfile: o.deckProfile } : {}),
      ...(group ? { exclusiveGroup: group } : {}),
      ...(side && group === "armMount" ? { armSide: side } : {}),
    };
  };

  const equipOffer = (o: Offer, side?: cyberwareRules.ArmSide) => {
    const effectiveSide = categoryOfOffer(o) === "arms" ? (side ?? armTarget) : undefined;
    const currentlyOn = board.cyberware.find((c) => c.id === o.id);
    if (currentlyOn && (!effectiveSide || armSidesMap.get(o.id) === effectiveSide)) {
      commit({ ...board, cyberware: board.cyberware.filter((c) => c.id !== o.id) });
      setEditorNotice(null);
      return;
    }
    const { replaceIds, check } = evaluateInstall(o, effectiveSide);
    if (!check.ok) {
      setEditorNotice(check.reason);
      return;
    }
    const replaceSet = new Set([o.id, ...replaceIds]);
    const nextList = [
      ...board.cyberware.filter((c) => !replaceSet.has(c.id)),
      toStartEntry(o, effectiveSide),
    ];
    if (maxCount !== undefined && nextList.length > maxCount) {
      setEditorNotice(`最多可装配 ${maxCount} 件义体，请先卸下其他义体再装入。`);
      return;
    }
    commit({ ...board, cyberware: nextList });
    setEditorNotice(null);
  };

  const toEditableStartChrome = (o: Offer): StartCyberware => {
    const parsedRarity = economyRules.RaritySchema.safeParse(o.rarity);
    return {
      id: o.id,
      name: o.name,
      slot: o.slot as CyberSlot,
      category: categoryOfOffer(o),
      rarity: parsedRarity.success ? parsedRarity.data : "rare",
      humanityCost: o.humanityCost,
      ability: o.ability,
      ...(o.armor ? { armor: true } : {}),
      ...(o.accelerator ? { accelerator: true } : {}),
      ...(o.deckProfile ? { deckProfile: o.deckProfile } : {}),
      ...(o.exclusiveGroup ? { exclusiveGroup: o.exclusiveGroup } : {}),
      custom: true,
      packId: o.packId ?? "local",
    };
  };

  const handleCustomSave = (saved: StartCyberware, options: { readonly equip: boolean }) => {
    const savedSlot = (saved.slot ?? "frontalCortex") as CyberSlot;
    const savedCat =
      saved.category ??
      cyberwareRules.cyberwareCategoryOf({
        id: saved.id,
        name: saved.name,
        slot: savedSlot,
        ...(saved.armor ? { armor: true } : {}),
        ...(saved.accelerator ? { accelerator: true } : {}),
        ...(saved.deckProfile ? { deckProfile: saved.deckProfile } : {}),
        ...(saved.exclusiveGroup ? { exclusiveGroup: saved.exclusiveGroup } : {}),
      });
    const exists = board.cyberware.some((c) => c.id === saved.id);
    const savedProbe: cyberwareRules.LoadProbe = {
      id: saved.id,
      name: saved.name,
      slot: savedSlot,
      category: savedCat,
      humanityCost: saved.humanityCost,
      ...(saved.armSide ? { armSide: saved.armSide } : {}),
      ...(saved.armor ? { armor: true } : {}),
      ...(saved.accelerator ? { accelerator: true } : {}),
      ...(saved.deckProfile ? { deckProfile: saved.deckProfile } : {}),
      ...(saved.exclusiveGroup ? { exclusiveGroup: saved.exclusiveGroup } : {}),
    };

    let notice: string | null = null;
    if (activeEditor?.mode === "edit" && exists) {
      const conflict = cyberwareRules.cyberwareConflicts(
        savedProbe,
        chosenProbes.filter((p) => p.id !== saved.id),
      );
      const replaceIds = !conflict.ok ? conflict.blockers.map((b) => b.id) : [];
      const check = cyberwareRules.checkCyberwareInstall(savedProbe, allActiveProbes, {
        ignoreIds: [saved.id, ...replaceIds],
      });
      if (check.ok) {
        const drop = new Set(replaceIds);
        commit({
          ...board,
          cyberware: board.cyberware
            .filter((c) => !drop.has(c.id))
            .map((c) => (c.id === saved.id ? saved : c)),
        });
        if (replaceIds.length > 0 && !conflict.ok) {
          notice = `已更新「${saved.name}」，并换下 ${conflict.blockers.map((b) => b.name).join("、")}`;
        }
      } else {
        commit({
          ...board,
          cyberware: board.cyberware.filter((c) => c.id !== saved.id),
        });
        notice = `已更新「${saved.name}」，但因「${check.reason}」暂已卸下`;
      }
    } else if (options.equip) {
      const conflict = cyberwareRules.cyberwareConflicts(
        savedProbe,
        chosenProbes.filter((p) => p.id !== saved.id),
      );
      const replaceIds = !conflict.ok ? conflict.blockers.map((b) => b.id) : [];
      const check = cyberwareRules.checkCyberwareInstall(savedProbe, allActiveProbes, {
        ignoreIds: [saved.id, ...replaceIds],
      });
      if (check.ok) {
        const drop = new Set([saved.id, ...replaceIds]);
        commit({
          ...board,
          cyberware: [...board.cyberware.filter((c) => !drop.has(c.id)), saved],
        });
        if (replaceIds.length > 0 && !conflict.ok) {
          notice = `已保存并装上「${saved.name}」，同时换下 ${conflict.blockers.map((b) => b.name).join("、")}`;
        }
      } else {
        notice = `已存入自创库，但未能直接装上：${check.reason}`;
      }
    } else {
      notice = `已将「${saved.name}」存入自创义体库（${cyberwareRules.CYBERWARE_CATEGORY_LABELS[savedCat]}）`;
    }

    if (savedCat !== category) {
      onCategoryChange?.(savedCat);
    }
    setActiveEditor(null);
    setEditorNotice(notice);
  };

  if (activeEditor) {
    return (
      <div className={`${styles.pickerBody} ${styles.cyberShelfBody}`}>
        <div className={styles.cyberEditorScroll}>
          <CustomCyberwareForm
            key={activeEditor.mode === "edit" ? activeEditor.item.id : `new-${category}`}
            category={category}
            {...(activeEditor.mode === "edit" ? { initial: activeEditor.item } : {})}
            onCancel={() => setActiveEditor(null)}
            onAccept={handleCustomSave}
          />
        </div>
      </div>
    );
  }

  return (
    <div className={`${styles.pickerBody} ${styles.cyberShelfBody}`}>
      <div className={styles.slotTools}>
        <FrameBox className={styles.searchBox}>
          <input
            type="search"
            value={query}
            placeholder={
              kind === "custom" && customScope === "all"
                ? "搜索全部自创/工坊义体…"
                : `搜索「${cyberwareRules.CYBERWARE_CATEGORY_LABELS[category]}」…`
            }
            aria-label="搜索义体"
            onChange={(e) => setQuery(e.target.value)}
          />
        </FrameBox>
        <Button small onClick={() => setActiveEditor({ mode: "create" })}>
          ＋ 自创义体
        </Button>
      </div>

      {category === "arms" && (
        <fieldset className={styles.armSideBar} aria-label="默认手臂装配侧别">
          <span className={styles.equippedLabel}>装配侧别</span>
          {(["left", "right", "both"] as const).map((side) => (
            <Button
              key={side}
              small
              pressed={armTarget === side}
              onClick={() => onArmTargetChange?.(side)}
            >
              {cyberwareRules.ARM_SIDE_LABELS[side]}
              {side === "both" ? " (100%)" : " (60%)"}
            </Button>
          ))}
        </fieldset>
      )}

      {editorNotice && <p className={styles.editorNotice}>{editorNotice}</p>}

      {mountedInCategory.length > 0 && (
        <section className={styles.equippedStrip} aria-label="该分区已装自选义体">
          <span className={styles.equippedLabel}>已装 ({mountedInCategory.length})</span>
          <div className={styles.equippedChips}>
            {mountedInCategory.map((item) => {
              const side =
                category === "arms"
                  ? (armSidesMap.get(item.id) ??
                    cyberwareRules.defaultArmSideFor(offerMap.get(item.id) ?? item))
                  : null;
              return (
                <span key={item.id} className={styles.equippedChip}>
                  <span>
                    {item.name}
                    {side ? ` · ${cyberwareRules.ARM_SIDE_LABELS[side]}` : ""}
                  </span>
                  {side && side !== "both" && (
                    <button
                      type="button"
                      className={styles.equippedSyncBtn}
                      title="改为左右双臂同款（按 100% 承载计）"
                      onClick={() => {
                        const def = offerMap.get(item.id);
                        if (def) equipOffer(def, "both");
                      }}
                    >
                      双臂同款
                    </button>
                  )}
                  <button
                    type="button"
                    className={styles.equippedChipDel}
                    title={`卸下 ${item.name}`}
                    aria-label={`卸下 ${item.name}`}
                    onClick={() =>
                      commit({
                        ...board,
                        cyberware: board.cyberware.filter((c) => c.id !== item.id),
                      })
                    }
                  >
                    ×
                  </button>
                </span>
              );
            })}
          </div>
        </section>
      )}

      <div className={styles.shelfHead}>
        <fieldset className={styles.shelfFilter} aria-label="按来源筛选">
          <Button small pressed={kind === "all"} onClick={() => setKind("all")}>
            全部 ({options.length})
          </Button>
          <Button small pressed={kind === "custom"} onClick={() => setKind("custom")}>
            自创/工坊 ({allCustomOptions.length})
          </Button>
        </fieldset>
        {kind === "custom" && allCustomOptions.length > 0 && (
          <fieldset className={styles.shelfFilter} aria-label="自创义体查看范围">
            <Button small pressed={customScope === "all"} onClick={() => setCustomScope("all")}>
              全部分区 ({allCustomOptions.length})
            </Button>
            <Button
              small
              pressed={customScope === "section"}
              onClick={() => setCustomScope("section")}
            >
              仅当前分区 ({sectionCustomCount})
            </Button>
          </fieldset>
        )}
        {rarities.length > 1 && (
          <fieldset className={styles.shelfFilter} aria-label="按稀有度筛">
            <Button small pressed={rarity === null} onClick={() => setRarity(null)}>
              全稀有度
            </Button>
            {rarities.map((r) => (
              <Button key={r} small pressed={rarity === r} onClick={() => setRarity(r)}>
                {RARITY_LABELS[r]}
              </Button>
            ))}
          </fieldset>
        )}
      </div>

      {inherentInCategory.length > 0 && (
        <p className={styles.note}>
          自带标配：
          {inherentInCategory
            .map(
              (i) => `${i.name}（${i.source}${i.replaced ? "，已被同类主件顶替" : "，免费预装"}）`,
            )
            .join("、")}
        </p>
      )}

      {displayEntries.length === 0 ? (
        <div className={styles.emptyShelfNote}>
          <p className={styles.note}>
            {kind === "custom"
              ? customScope === "section" && allCustomOptions.length > 0
                ? `「${cyberwareRules.CYBERWARE_CATEGORY_LABELS[category]}」暂无自创义体，可切换查看「全部分区」或新建。`
                : "还没有自创或工坊义体，点上方「＋ 自创义体」即可创建。"
              : "当前筛选下没有可用义体。"}
          </p>
        </div>
      ) : (
        <div className={styles.cyberListScroll}>
          <ul className={styles.cyberGrid}>
            {displayEntries.map(({ active: o, groupId, variants }) => {
              const isArmOffer = categoryOfOffer(o) === "arms";
              const on = isOn(o);
              const currentSide = on ? armSidesMap.get(o.id) : undefined;
              const targetSide = isArmOffer ? armTarget : undefined;
              const { replaceNames, check } = evaluateInstall(o, targetSide);
              const blocked = !on && !check.ok;
              const blockedLabel = !check.ok
                ? check.kind === "capacityFull"
                  ? `承载不足（差 ${check.shortfall ?? 1}）`
                  : check.kind === "zoneFull"
                    ? "本区空间已满"
                    : "冲突"
                : null;
              const entersOverload = !on && check.ok && check.entersOverload;
              const effectiveLoad = cyberwareRules.effectiveCyberwareLoad(
                probeOfOffer(o, currentSide ?? targetSide),
                currentSide ?? targetSide,
              );
              const editable = Boolean(o.custom && (!o.packId || o.packId === "local"));

              const actionLabel = on
                ? currentSide
                  ? `已装 · ${cyberwareRules.ARM_SIDE_LABELS[currentSide]}`
                  : "已装"
                : blockedLabel
                  ? blockedLabel
                  : replaceNames.length > 0
                    ? `替换 ${replaceNames[0]}`
                    : entersOverload
                      ? "装上（进红线）"
                      : isArmOffer
                        ? `装${cyberwareRules.ARM_SIDE_LABELS[armTarget]}`
                        : "装上";

              return (
                <li key={groupId ?? o.id}>
                  <div
                    className={styles.cyberCard}
                    data-rarity={o.rarity}
                    data-on={on || undefined}
                    data-disabled={blocked || undefined}
                  >
                    <CellFrame />
                    <button
                      type="button"
                      className={styles.cyberCardMain}
                      aria-pressed={on}
                      disabled={blocked}
                      title={!check.ok ? check.reason : undefined}
                      onClick={() => equipOffer(o, targetSide)}
                    >
                      <div className={styles.cyberTileTop}>
                        <CyberItemCell
                          id={o.id}
                          name={o.name}
                          slot={o.slot as CyberSlot}
                          on={on}
                          rarity={o.rarity}
                          size={42}
                        />
                        <div className={styles.cyberTileBody}>
                          <div className={styles.cyberTileHead}>
                            <span className={styles.cyberTileName} data-rarity={o.rarity}>
                              {o.name}
                            </span>
                            <span className={styles.moduleBadges}>
                              {o.iconic && (
                                <span className={styles.moduleBadge} data-tone="iconic">
                                  不朽
                                </span>
                              )}
                              {isWorkshopEntry(o.packId) && (
                                <span className={styles.moduleBadge} data-tone="workshop">
                                  工坊
                                </span>
                              )}
                              {editable && <span className={styles.moduleBadge}>自创</span>}
                              <span
                                className={styles.moduleBadge}
                                data-tone={on ? "active" : entersOverload ? "warn" : undefined}
                              >
                                {actionLabel}
                              </span>
                            </span>
                          </div>
                          <div className={styles.cyberTileMeta}>
                            {kind === "custom" && customScope === "all" && (
                              <span className={styles.metaChip}>
                                {cyberwareRules.CYBERWARE_CATEGORY_LABELS[categoryOfOffer(o)]}
                              </span>
                            )}
                            {o.rarity && (
                              <span className={styles.shelfRarity} data-rarity={o.rarity}>
                                {RARITY_LABELS[o.rarity]}
                              </span>
                            )}
                            {effectiveLoad > 0 && (
                              <span className={styles.shelfTileCost}>承载 {effectiveLoad}</span>
                            )}
                          </div>
                        </div>
                      </div>
                      <p className={styles.cyberTileAbility}>{o.ability}</p>
                    </button>

                    {groupId && variants && (
                      <fieldset className={styles.variantBar} aria-label="元素变体切换">
                        {variants.map((v) => {
                          const vMounted = board.cyberware.some((c) => c.id === v.item.id);
                          return (
                            <button
                              key={v.key}
                              type="button"
                              className={styles.variantPill}
                              data-active={v.item.id === o.id || undefined}
                              data-mounted={vMounted || undefined}
                              onClick={() =>
                                setVariantChoice((prev) => ({
                                  ...prev,
                                  [groupId]: v.key,
                                }))
                              }
                            >
                              {cyberwareRules.ELEMENT_VARIANT_LABELS[v.key]}
                            </button>
                          );
                        })}
                      </fieldset>
                    )}

                    {editable && (
                      <div className={styles.pickCardFoot}>
                        <button
                          type="button"
                          className={styles.pickCardAct}
                          aria-label={`编辑自创义体 ${o.name}`}
                          onClick={() =>
                            setActiveEditor({ mode: "edit", item: toEditableStartChrome(o) })
                          }
                        >
                          编辑
                        </button>
                        <span className={styles.pickCardSep} aria-hidden />
                        <button
                          type="button"
                          className={`${styles.pickCardAct} ${styles.pickCardDanger}`}
                          aria-label={`删除自创义体 ${o.name}`}
                          onClick={() => {
                            removeLocalCustomCyberware(o.id);
                            if (on) {
                              commit({
                                ...board,
                                cyberware: board.cyberware.filter((c) => c.id !== o.id),
                              });
                            }
                          }}
                        >
                          删除
                        </button>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
