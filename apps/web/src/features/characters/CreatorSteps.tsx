import {
  type Board,
  type BoardModule,
  CASH_TIER_INFO,
  CASH_TIERS,
  type CashTier,
  type CharacterCard,
  cyberwareRules,
  FLAW_MAX,
  inventoryRules,
  PAST_MAX,
  SKILL_MAX,
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
import { CustomModuleForm } from "./CustomModuleForm";
import styles from "./characters.module.css";
import {
  inherentCyberware,
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
    readonly slot: CyberSlot;
  };

const isWorkshopEntry = (packId?: string): boolean => Boolean(packId && packId !== "local");
const isLocalModule = (m: BoardModule): boolean => Boolean(m.custom && m.packId === "local");

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
  const [writing, setWriting] = useState(false);
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
        {!writing && (
          <Button small onClick={() => setWriting(true)}>
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
      {writing && (
        <CustomModuleForm
          slot="origin"
          board={board}
          onCancel={() => setWriting(false)}
          onAccept={(m) => {
            const nextCard = { ...card, origin: m.label };
            commit(pruneKitForOrigin(nextCard, { ...board, origin: m }, data), m.label);
            setWriting(false);
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
              const deletable = isLocalModule(m);
              const preview = originPreview(m, data);
              const locName = startAnchor(preview.locationId)?.name ?? "沃森 H10";
              return (
                <li key={m.id} className={styles.pickItem}>
                  <button
                    type="button"
                    className={styles.pick}
                    aria-pressed={active}
                    onClick={() => {
                      const nextCard = { ...card, origin: m.label };
                      commit(pruneKitForOrigin(nextCard, { ...board, origin: m }, data), m.label);
                    }}
                  >
                    <CellFrame />
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
                  </button>
                  {deletable && (
                    <button
                      type="button"
                      className={styles.localDelBtn}
                      title="删除这条本地自定义出身"
                      aria-label={`删除本地自定义出身 ${m.label}`}
                      onClick={() => {
                        removeLocalCustomModule(m.id);
                        if (active) {
                          commit({ ...board, origin: null }, "");
                        }
                      }}
                    >
                      ×
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
  const [writing, setWriting] = useState(false);

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
        {!writing && (
          <Button
            small
            disabled={full}
            reason={`过往履历最多选 ${PAST_MAX} 项`}
            onClick={() => setWriting(true)}
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
      {writing && (
        <CustomModuleForm
          slot="past"
          board={board}
          onCancel={() => setWriting(false)}
          onAccept={(m) => {
            commit({ ...board, pasts: [...board.pasts, m] });
            setWriting(false);
          }}
        />
      )}
      {shown.length === 0 && <p className={styles.note}>没有匹配条件的过往履历。</p>}
      <ul className={styles.skillWall}>
        {shown.map((m) => {
          const pressed = onIds.has(m.id);
          const themeLabel = PAST_THEME_LABELS[pastTheme(m)];
          const deletable = isLocalModule(m);
          return (
            <li key={m.id} className={styles.pickItem}>
              <button
                type="button"
                className={styles.pick}
                aria-pressed={pressed}
                disabled={!pressed && full}
                title={!pressed && full ? `过往履历最多选 ${PAST_MAX} 项` : undefined}
                onClick={() => toggle(m)}
              >
                <CellFrame />
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
              </button>
              {deletable && (
                <button
                  type="button"
                  className={styles.localDelBtn}
                  title="删除这条本地自定义履历"
                  aria-label={`删除本地自定义履历 ${m.label}`}
                  onClick={() => {
                    removeLocalCustomModule(m.id);
                    if (pressed) {
                      commit({ ...board, pasts: board.pasts.filter((x) => x.id !== m.id) });
                    }
                  }}
                >
                  ×
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
  const [writing, setWriting] = useState(false);

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
        {!writing && (
          <Button
            small
            disabled={full}
            reason={`核心特质最多选 ${SKILL_MAX} 项`}
            onClick={() => setWriting(true)}
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
      {writing && (
        <CustomModuleForm
          slot="skill"
          board={board}
          onCancel={() => setWriting(false)}
          onAccept={(m) => {
            commit({ ...board, skills: [...board.skills, m] });
            setWriting(false);
          }}
        />
      )}
      {shown.length === 0 && <p className={styles.note}>没有匹配条件的核心特质。</p>}
      <ul className={styles.skillWall}>
        {shown.map((m) => {
          const pressed = onIds.has(m.id);
          const catLabel = SKILL_DOMAIN_LABELS[skillDomain(m)];
          const deletable = isLocalModule(m);
          return (
            <li key={m.id} className={styles.pickItem}>
              <button
                type="button"
                className={styles.pick}
                aria-pressed={pressed}
                disabled={!pressed && full}
                title={!pressed && full ? `核心特质最多选 ${SKILL_MAX} 项` : undefined}
                onClick={() => toggle(m)}
              >
                <CellFrame />
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
              </button>
              {deletable && (
                <button
                  type="button"
                  className={styles.localDelBtn}
                  title="删除这条本地自定义特质"
                  aria-label={`删除本地自定义特质 ${m.label}`}
                  onClick={() => {
                    removeLocalCustomModule(m.id);
                    if (pressed) {
                      commit({ ...board, skills: board.skills.filter((x) => x.id !== m.id) });
                    }
                  }}
                >
                  ×
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
  const [writing, setWriting] = useState(false);
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
        {!writing && (
          <Button
            small
            disabled={full}
            reason={`负面缺陷最多选 ${FLAW_MAX} 项`}
            onClick={() => setWriting(true)}
          >
            ＋ 自创缺陷
          </Button>
        )}
      </div>
      <p className={styles.note}>
        已选 {board.flaws.length} / {FLAW_MAX} 项 · 纯可选的处境压力、暗伤与个人底线，不扣点数。
      </p>
      {writing && (
        <CustomModuleForm
          slot="flaw"
          board={board}
          onCancel={() => setWriting(false)}
          onAccept={(m) => {
            commit({ ...board, flaws: [...board.flaws, m] });
            setWriting(false);
          }}
        />
      )}
      {shown.length === 0 && <p className={styles.note}>没有匹配的负面缺陷。</p>}
      <ul className={styles.skillWall}>
        {shown.map((m) => {
          const pressed = on.has(m.id);
          const deletable = isLocalModule(m);
          return (
            <li key={m.id} className={styles.pickItem}>
              <button
                type="button"
                className={styles.pick}
                data-tone="flaw"
                aria-pressed={pressed}
                disabled={!pressed && full}
                onClick={() =>
                  commit({
                    ...board,
                    flaws: pressed ? board.flaws.filter((x) => x.id !== m.id) : [...board.flaws, m],
                  })
                }
              >
                <CellFrame />
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
              </button>
              {deletable && (
                <button
                  type="button"
                  className={styles.localDelBtn}
                  title="删除这条本地自定义缺陷"
                  aria-label={`删除本地自定义缺陷 ${m.label}`}
                  onClick={() => {
                    removeLocalCustomModule(m.id);
                    if (pressed) {
                      commit({ ...board, flaws: board.flaws.filter((x) => x.id !== m.id) });
                    }
                  }}
                >
                  ×
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

const CASH_TIER_DELTA: Readonly<Record<CashTier, string>> = {
  broke: "0 €",
  standard: "出身基准",
  stash: "+2,500 €",
  windfall: "+6,000 €",
};

type WeaponGroup = "all" | "pistol" | "smg" | "rifle" | "shotgun" | "sniper" | "melee";
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

export function LoadoutPicker({ card, board, data, commit }: LoadoutPickerProps) {
  const [hoverWeaponId, setHoverWeaponId] = useState<string | null>(null);
  const [weaponGroup, setWeaponGroup] = useState<WeaponGroup>("all");
  const [weaponQuery, setWeaponQuery] = useState("");
  const [vehicleGroup, setVehicleGroup] = useState<VehicleGroup>("all");
  const base = originDefaultLoadout(card, data);
  const kit = board.kit;
  const ownedGear = new Set(pickedLoadouts(card, data).flatMap((l) => l.gear.map((g) => g.id)));
  const setKit = (patch: Partial<Board["kit"]>) => commit({ ...board, kit: { ...kit, ...patch } });
  const weapons = data.weapons ?? [];
  const activeWeaponCats = WEAPON_GROUPS.find((g) => g.id === weaponGroup)?.cats;
  const normalizedWeaponQuery = weaponQuery.trim().toLowerCase();
  const shownWeapons = weapons.filter((w) => {
    if (activeWeaponCats && (w.category === undefined || !activeWeaponCats.includes(w.category))) {
      return false;
    }
    if (!normalizedWeaponQuery) return true;
    return `${w.name} ${w.ability}`.toLowerCase().includes(normalizedWeaponQuery);
  });
  const vehicles = data.vehicles ?? [];
  const activeVehicleClasses = VEHICLE_GROUPS.find((g) => g.id === vehicleGroup)?.classes;
  const shownVehicles = activeVehicleClasses
    ? vehicles.filter((v) => activeVehicleClasses.includes(v.class))
    : vehicles;
  const customVehicle = kit.vehicle ? vehicles.find((v) => v.id === kit.vehicle) : undefined;
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

  return (
    <div className={styles.pickerBody}>
      <section className={styles.loadoutBase} aria-label="出身默认行装">
        <CellFrame />
        <strong className={styles.pickName}>
          出身默认行装{base.labels.length > 0 ? ` · ${base.labels.join(" + ")}` : ""}
        </strong>
        <Line k="启动资金">
          基准 {base.baseEddies} € → 实际进场 <b>{base.finalEddies} €</b>
        </Line>
        {base.gearNames.length > 0 && <Line k="随身装备">{base.gearNames.join("、")}</Line>}
        {customVehicle ? (
          <Line k="开局座驾">
            <b>{customVehicle.name}</b>（专属座驾
            {base.freeVehicleNames.length > 0
              ? `，已替换出身自带的 ${base.freeVehicleNames.join("、")}`
              : ""}
            ）
          </Line>
        ) : base.freeVehicleNames.length > 0 ? (
          <Line k="开局座驾">{base.freeVehicleNames.join("、")}（出身自带）</Line>
        ) : null}
      </section>

      <h4 className={styles.subTitle}>启动资金档位</h4>
      <fieldset className={styles.shelfFilter} aria-label="启动资金档位">
        {CASH_TIERS.map((t) => (
          <Button
            key={t}
            small
            pressed={kit.cashTier === t}
            onClick={() => setKit({ cashTier: t })}
          >
            {CASH_TIER_INFO[t].label} · {CASH_TIER_DELTA[t]}
          </Button>
        ))}
      </fieldset>
      <p className={styles.note}>{CASH_TIER_INFO[kit.cashTier].desc}</p>

      {weapons.length > 0 && (
        <>
          <h4 className={styles.subTitle}>
            额外随身武器{" "}
            <small className={styles.stepNote}>
              {kit.weapons.length} / 2 · 共 {weapons.length} 款
            </small>
          </h4>
          <div className={styles.slotTools}>
            <FrameBox className={styles.searchBox}>
              <input
                type="search"
                value={weaponQuery}
                placeholder="搜索武器名称或特性…"
                aria-label="搜索额外随身武器"
                onChange={(e) => setWeaponQuery(e.target.value)}
              />
            </FrameBox>
          </div>
          <fieldset className={styles.shelfFilter} aria-label="按武器类别筛选">
            {WEAPON_GROUPS.map((g) => {
              const count = g.cats
                ? weapons.filter((w) => w.category !== undefined && g.cats?.includes(w.category))
                    .length
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
          <div className={styles.weaponPreview} aria-live="polite">
            <CellFrame />
            {previewWeapon ? (
              <>
                <div className={styles.weaponPreviewHead}>
                  <span className={styles.weaponPreviewMeta}>
                    <strong className={styles.pickName}>{previewWeapon.name}</strong>
                    <span className={styles.shelfRarity} data-rarity={previewWeapon.rarity}>
                      · {RARITY_LABELS[previewWeapon.rarity] ?? previewWeapon.rarity}
                    </span>
                    {previewCategory && (
                      <span className={styles.shelfMeta}>· {previewCategory}</span>
                    )}
                    {(previewWeapon.custom || isWorkshopEntry(previewWeapon.packId)) && (
                      <span className={styles.moduleBadge} data-tone="workshop">
                        工坊
                      </span>
                    )}
                  </span>
                  {(ownedGear.has(previewWeapon.id) || kit.weapons.includes(previewWeapon.id)) && (
                    <span className={styles.moduleBadge} data-tone="active">
                      {ownedGear.has(previewWeapon.id) ? "出身自带" : "已选配"}
                    </span>
                  )}
                </div>
                <p className={styles.weaponPreviewDesc}>{previewWeapon.ability}</p>
              </>
            ) : (
              <p className={styles.weaponPreviewDesc}>
                把鼠标悬停在任意武器上即可查看详细说明，点击选配（最多 2 把）。
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
                const full = !on && kit.weapons.length >= 2;
                const isCustomWeapon = Boolean(w.custom || isWorkshopEntry(w.packId));
                return (
                  <li
                    key={w.id}
                    onMouseEnter={() => setHoverWeaponId(w.id)}
                    onFocus={() => setHoverWeaponId(w.id)}
                  >
                    <button
                      type="button"
                      className={styles.weaponTile}
                      data-rarity={w.rarity}
                      aria-pressed={on}
                      disabled={!on && (owned || full)}
                      title={`${w.name}（${owned ? "出身自带" : (RARITY_LABELS[w.rarity] ?? w.rarity)}）：${w.ability}`}
                      onClick={() =>
                        setKit({
                          weapons: on
                            ? kit.weapons.filter((x) => x !== w.id)
                            : [...kit.weapons, w.id],
                        })
                      }
                    >
                      <CellFrame />
                      {isCustomWeapon && <span className={styles.weaponWorkshopTag}>工坊</span>}
                      {itemArtOf(w.id) ? (
                        <Asset id={itemArtOf(w.id) as AssetId} className={styles.weaponImg} />
                      ) : null}
                      <span className={styles.weaponName} data-rarity={w.rarity}>
                        {w.name}
                      </span>
                      <span className={styles.weaponAbility}>{w.ability}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      {vehicles.length > 0 && (
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

// ———— 义体货架：信息直出卡片，单击直接装卸/替换 ————

const RARITY_ORDER = ["common", "uncommon", "rare", "epic", "legendary"] as const;

export function CyberwareShelf({ card, board, data, commit, slot }: CyberwareShelfProps) {
  type Offer = BoardData["cyberware"][number];
  const [shelfState, setShelfState] = useState<{
    readonly slot: CyberSlot;
    readonly rarity: string | null;
    readonly query: string;
  }>({ slot, rarity: null, query: "" });
  const rarity = shelfState.slot === slot ? shelfState.rarity : null;
  const query = shelfState.slot === slot ? shelfState.query : "";
  const setRarity = (next: string | null) => setShelfState({ slot, rarity: next, query });
  const setQuery = (next: string) => setShelfState({ slot, rarity, query: next });

  const options = data.cyberware.filter((o) => o.slot === slot);
  const rarities = RARITY_ORDER.filter((r) => options.some((o) => o.rarity === r));
  const normalizedQuery = query.trim().toLowerCase();
  const shown = options.filter((o) => {
    if (rarity && o.rarity !== rarity) return false;
    if (!normalizedQuery) return true;
    const hay = [o.name, o.ability, o.deckProfile ?? "", ...(o.deckTraits ?? [])]
      .join(" ")
      .toLowerCase();
    return hay.includes(normalizedQuery);
  });
  const slotOf = new Map(data.cyberware.map((o) => [o.id, o.slot]));
  const mounted = board.cyberware.filter((c) => (slotOf.get(c.id) ?? c.slot) === slot);
  const inherentInSlot = inherentCyberware(card, data).filter((i) => i.slot === slot);
  const activeInherentCount = inherentInSlot.filter((i) => !i.replaced).length;
  const cap = cyberwareRules.SLOT_CAPACITY[slot];
  const occupiedCount = Math.min(cap, mounted.length + activeInherentCount);
  const slotFull = mounted.length >= cap;
  const isOn = (o: Offer) => mounted.some((p) => p.id === o.id);
  const canSwap = cap === 1 && slotFull;
  const blocked = (o: Offer) => !isOn(o) && slotFull && !canSwap;

  const actionLabel = (o: Offer) =>
    isOn(o) ? "已装 · 点击卸下" : canSwap ? "点击替换" : blocked(o) ? "槽位已满" : "点击装上";

  const nextCyberware = (o: Offer): Board["cyberware"] => {
    if (isOn(o)) return board.cyberware.filter((c) => c.id !== o.id);
    if (blocked(o)) return board.cyberware;
    const base = canSwap
      ? board.cyberware.filter((c) => (slotOf.get(c.id) ?? c.slot) !== slot)
      : board.cyberware;
    return [
      ...base,
      {
        id: o.id,
        name: o.name,
        humanityCost: o.humanityCost,
        slot: o.slot as CyberSlot,
        ...(o.custom ? { custom: true } : {}),
        ...(o.packId ? { packId: o.packId } : {}),
        ...(o.custom && o.ability ? { ability: o.ability } : {}),
        ...(o.custom && o.armor ? { armor: true } : {}),
        ...(o.custom && o.accelerator ? { accelerator: true } : {}),
        ...(o.custom && o.deckProfile ? { deckProfile: o.deckProfile } : {}),
      },
    ];
  };

  const toggle = (o: Offer) => {
    if (!blocked(o)) commit({ ...board, cyberware: nextCyberware(o) });
  };

  return (
    <div className={`${styles.pickerBody} ${styles.cyberShelfBody}`}>
      <div className={styles.slotTools}>
        <FrameBox className={styles.searchBox}>
          <input
            type="search"
            value={query}
            placeholder="搜索该部位义体名称或能力…"
            aria-label="搜索义体"
            onChange={(e) => setQuery(e.target.value)}
          />
        </FrameBox>
      </div>
      <div className={styles.shelfHead}>
        <span className={styles.shelfMeta}>
          可选 {shown.length} 款 · 已占用 {occupiedCount}/{cap}
          {activeInherentCount > 0 ? `（含标配 ${activeInherentCount} 件）` : ""}
        </span>
        {rarities.length > 1 && (
          <fieldset className={styles.shelfFilter} aria-label="按稀有度筛">
            <Button small pressed={rarity === null} onClick={() => setRarity(null)}>
              全部
            </Button>
            {rarities.map((r) => (
              <Button key={r} small pressed={rarity === r} onClick={() => setRarity(r)}>
                {RARITY_LABELS[r]}
              </Button>
            ))}
          </fieldset>
        )}
      </div>
      {inherentInSlot.length > 0 && (
        <p className={styles.note}>
          自带标配：
          {inherentInSlot
            .map((i) => `${i.name}（${i.source}${i.replaced ? "，已被自选件顶替" : "，免费预装"}）`)
            .join("、")}
        </p>
      )}
      {shown.length === 0 ? (
        <p className={styles.note}>当前筛选下没有可用义体。</p>
      ) : (
        <div className={styles.cyberListScroll}>
          <ul className={styles.cyberGrid}>
            {shown.map((o) => {
              const on = isOn(o);
              const isBlocked = blocked(o);
              const hwSpecs = [
                o.deckProfile ? `接入仓档位：${o.deckProfile}` : "",
                ...(o.deckTraits ?? []),
                o.armor ? "护甲增强" : "",
                o.accelerator ? "神经反应加速" : "",
              ].filter(Boolean);
              return (
                <li key={o.id}>
                  <button
                    type="button"
                    className={styles.cyberTile}
                    data-rarity={o.rarity}
                    aria-pressed={on}
                    disabled={isBlocked}
                    title={isBlocked ? `这个部位最多装 ${cap} 件，先卸一件` : actionLabel(o)}
                    onClick={() => toggle(o)}
                  >
                    <CellFrame />
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
                            {isWorkshopEntry(o.packId) && (
                              <span className={styles.moduleBadge} data-tone="workshop">
                                工坊
                              </span>
                            )}
                            <span
                              className={styles.moduleBadge}
                              data-tone={on ? "active" : undefined}
                            >
                              {on ? "已装" : canSwap ? "点击替换" : "点击装上"}
                            </span>
                          </span>
                        </div>
                        <div className={styles.cyberTileMeta}>
                          {o.rarity && (
                            <span className={styles.shelfRarity} data-rarity={o.rarity}>
                              {RARITY_LABELS[o.rarity]}
                            </span>
                          )}
                          <span className={styles.shelfTileCost}>−{o.humanityCost} 人性</span>
                        </div>
                      </div>
                    </div>
                    <p className={styles.cyberTileAbility}>{o.ability}</p>
                    {hwSpecs.length > 0 && (
                      <p className={styles.cyberTileSpecs}>{hwSpecs.join(" · ")}</p>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
