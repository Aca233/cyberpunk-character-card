import {
  type Board,
  type BoardModule,
  type BoardSlot,
  CASH_TIER_INFO,
  CASH_TIERS,
  type CashTier,
  type CharacterCard,
  cyberwareRules,
  FLAW_MAX,
  PAST_MAX,
  SKILL_MAX,
} from "@cp/core";
import { type ReactNode, useEffect, useState } from "react";
import type { BoardData } from "../../api/client";
import type { AssetId } from "../../assets";
import { ActionButton } from "../../ui/ActionButton";
import { Asset } from "../../ui/Asset";
import { Button } from "../../ui/Button";
import { CellFrame, FrameBox } from "../../ui/FrameBox";
import { itemArtOf } from "../story/art";
import { CyberItemCell, type CyberSlot } from "../story/CyberDoll";
import { CYBER_SLOT_ICON } from "../story/cyberwareMeta";
import { CustomModuleForm } from "./CustomModuleForm";
import styles from "./characters.module.css";
import {
  inherentCyberware,
  ORIGIN_ECOSYSTEM_LABELS,
  type OriginEcosystem,
  originDefaultLoadout,
  originEcosystem,
  pickedLoadouts,
  pruneKitForOrigin,
  rollTraits,
  TRAIT_FILTER_LABELS,
  type TraitFilter,
  totalStartHumanityCost,
  traitCategory,
} from "./creator";

/**
 * 创角步骤面板内的上下文选择器：出身、特质与履历、负面缺陷、开局行装、义体货架。
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
type TraitPickerProps = Omit<PickerProps, "card" | "change"> &
  Partial<Pick<PickerProps, "card" | "change">> & {
    readonly initialFilter?: TraitFilter;
  };
type FlawPickerProps = Omit<PickerProps, "card" | "change"> &
  Partial<Pick<PickerProps, "card" | "change">>;
type LoadoutPickerProps = Omit<PickerProps, "change"> & Partial<Pick<PickerProps, "change">>;
type CyberwareShelfProps = Omit<PickerProps, "change"> &
  Partial<Pick<PickerProps, "change">> & {
    readonly slot: CyberSlot;
  };

const people = (m: BoardModule) =>
  m.people.map((p) => (p.role ? `${p.name}（${p.role}）` : p.name)).join("、");

/** 卡片上一行带小标题的说明 */
export function Line({ k, children }: { readonly k: string; readonly children: ReactNode }) {
  return (
    <span className={styles.pickLine}>
      <b className={styles.pickKey}>{k}</b>
      <span>{children}</span>
    </span>
  );
}

// ———— 出身背景（单层直接选，带分类筛选与搜索） ————

const ECOSYSTEM_ORDER: readonly OriginEcosystem[] = [
  "corpo",
  "street",
  "net",
  "badlands",
  "custom",
];

function matchesModuleQuery(m: BoardModule, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = [m.label, m.ability, m.hook, ...m.tags, ...m.people.map((p) => `${p.name} ${p.role}`)]
    .join(" ")
    .toLowerCase();
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
            placeholder="搜索出身、标签或自带人物…"
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
        {ecoOptions.map((eco) => (
          <Button key={eco} small pressed={ecoFilter === eco} onClick={() => setEcoFilter(eco)}>
            {ORIGIN_ECOSYSTEM_LABELS[eco]}
          </Button>
        ))}
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
          <h4 className={styles.subTitle}>{ORIGIN_ECOSYSTEM_LABELS[g.eco]}</h4>
          <ul className={styles.originGrid}>
            {g.list.map((m) => {
              const active = board.origin?.id === m.id;
              return (
                <li key={m.id}>
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
                      <span
                        className={styles.moduleBadge}
                        data-tone={active ? "active" : undefined}
                      >
                        {active ? "当前出身" : ORIGIN_ECOSYSTEM_LABELS[g.eco]}
                      </span>
                    </span>
                    {m.ability && <Line k="出身底子">{m.ability}</Line>}
                    {m.hook && <Line k="身世钩子">{m.hook}</Line>}
                    {m.people.length > 0 && <Line k="自带故人">{people(m)}</Line>}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

// ———— 角色特质与过往履历（身心禀赋 + 专长技艺 + 过往经历 + 自定义，支持关键词检索） ————

const FILTERS: readonly TraitFilter[] = ["all", "innate", "craft", "past", "custom"];

export function TraitPicker({ board, data, commit, initialFilter = "all" }: TraitPickerProps) {
  const [filter, setFilter] = useState<TraitFilter>(initialFilter);
  const [query, setQuery] = useState("");
  const [writingSlot, setWritingSlot] = useState<Extract<BoardSlot, "skill" | "past"> | null>(null);

  useEffect(() => {
    setFilter(initialFilter);
  }, [initialFilter]);

  const onIds = new Set([...board.pasts, ...board.skills].map((m) => m.id));
  const legacyOn = [...board.pasts].filter((m) => !data.modules.some((l) => l.id === m.id));
  const library = [
    ...data.modules.filter((m) => m.slot === "skill" || m.slot === "past"),
    ...legacyOn,
    ...board.skills.filter((m) => !data.modules.some((l) => l.id === m.id)),
  ];
  const seen = new Set<string>();
  const unique = library.filter((m) => !seen.has(m.id) && seen.add(m.id));
  const shown = unique.filter(
    (m) => (filter === "all" || traitCategory(m) === filter) && matchesModuleQuery(m, query),
  );
  const skillFull = board.skills.length >= SKILL_MAX;
  const pastFull = board.pasts.length >= PAST_MAX;

  const toggle = (m: BoardModule) => {
    const key = m.slot === "past" ? "pasts" : "skills";
    commit(
      onIds.has(m.id)
        ? { ...board, [key]: board[key].filter((x) => x.id !== m.id) }
        : { ...board, [key]: [...board[key], m] },
    );
  };

  return (
    <div className={styles.pickerBody}>
      <div className={styles.slotTools}>
        <FrameBox className={styles.searchBox}>
          <input
            type="search"
            value={query}
            placeholder="搜索特质与履历（如：黑客、潜入、肉搏、恶土…）"
            aria-label="搜索角色特质"
            onChange={(e) => setQuery(e.target.value)}
          />
        </FrameBox>
        {writingSlot === null && (
          <>
            <Button
              small
              disabled={skillFull}
              reason={`核心特质最多选 ${SKILL_MAX} 项`}
              onClick={() => setWritingSlot("skill")}
            >
              ＋ 自创特质
            </Button>
            <Button
              small
              disabled={pastFull}
              reason={`过往履历最多选 ${PAST_MAX} 项`}
              onClick={() => setWritingSlot("past")}
            >
              ＋ 自创经历
            </Button>
          </>
        )}
      </div>
      <fieldset className={styles.shelfFilter} aria-label="特质分类">
        {FILTERS.map((f) => (
          <Button key={f} small pressed={filter === f} onClick={() => setFilter(f)}>
            {TRAIT_FILTER_LABELS[f]}
          </Button>
        ))}
      </fieldset>
      <div className={styles.slotTools}>
        <span className={styles.note}>
          核心特质 {board.skills.length}/{SKILL_MAX} · 过往履历 {board.pasts.length}/{PAST_MAX}
        </span>
        <Button
          small
          disabled={skillFull}
          reason={`核心特质最多选 ${SKILL_MAX} 项`}
          onClick={() => commit(rollTraits(board, data.modules, Math.random, 3))}
        >
          ✦ 随机补齐特质
        </Button>
      </div>
      {writingSlot !== null && (
        <CustomModuleForm
          slot={writingSlot}
          board={board}
          onCancel={() => setWritingSlot(null)}
          onAccept={(m) => {
            const key = m.slot === "past" ? "pasts" : "skills";
            commit({ ...board, [key]: [...board[key], m] });
            setWritingSlot(null);
          }}
        />
      )}
      {shown.length === 0 && <p className={styles.note}>没有匹配条件的特质或履历。</p>}
      <ul className={styles.skillWall}>
        {shown.map((m) => {
          const pressed = onIds.has(m.id);
          const full = m.slot === "past" ? pastFull : skillFull;
          const catLabel = TRAIT_FILTER_LABELS[traitCategory(m)];
          return (
            <li key={m.id}>
              <button
                type="button"
                className={styles.pick}
                aria-pressed={pressed}
                disabled={!pressed && full}
                title={!pressed && full ? "这一类槽位已经插满" : undefined}
                onClick={() => toggle(m)}
              >
                <CellFrame />
                <span className={styles.pickHead}>
                  <strong className={styles.pickName}>{m.label}</strong>
                  <span className={styles.moduleBadges}>
                    <span className={styles.moduleBadge} data-tone={pressed ? "active" : undefined}>
                      {pressed ? "已装备" : catLabel}
                    </span>
                  </span>
                </span>
                {m.ability && <span>{m.ability}</span>}
                {m.hook && <Line k="经历钩子">{m.hook}</Line>}
                {m.people.length > 0 && <Line k="带出故人">{people(m)}</Line>}
                {m.tags.length > 0 && (
                  <span className={styles.moduleTags}>{m.tags.join(" · ")}</span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ———— 负面缺陷（带来剧情钩子、债主与宿敌，支持搜索） ————

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
            placeholder="搜索负面缺陷或钩子…"
            aria-label="搜索负面缺陷"
            onChange={(e) => setQuery(e.target.value)}
          />
        </FrameBox>
        {!writing && (
          <Button
            small
            disabled={full}
            reason={`负面缺陷最多挂载 ${FLAW_MAX} 项`}
            onClick={() => setWriting(true)}
          >
            ＋ 自定义缺陷
          </Button>
        )}
      </div>
      <p className={styles.note}>
        已挂载 {board.flaws.length} / {FLAW_MAX} 项 · 负面缺陷会向战局注入债主、通缉、宿敌或生理隐患
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
          return (
            <li key={m.id}>
              <button
                type="button"
                className={styles.pick}
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
                    <span className={styles.moduleBadge} data-tone={pressed ? "active" : undefined}>
                      {pressed ? "已挂载" : (m.tags[0] ?? "负面钩子")}
                    </span>
                  </span>
                </span>
                {m.ability && <Line k="处境">{m.ability}</Line>}
                {m.hook && <Line k="钩子">{m.hook}</Line>}
                {m.people.length > 0 && <Line k="找上门的人">{people(m)}</Line>}
              </button>
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

export function LoadoutPicker({ card, board, data, commit }: LoadoutPickerProps) {
  const base = originDefaultLoadout(card, data);
  const kit = board.kit;
  const ownedGear = new Set(pickedLoadouts(card, data).flatMap((l) => l.gear.map((g) => g.id)));
  const setKit = (patch: Partial<Board["kit"]>) => commit({ ...board, kit: { ...kit, ...patch } });

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
        {base.freeVehicleNames.length > 0 && (
          <Line k="名下载具">{base.freeVehicleNames.join("、")}（出身自带）</Line>
        )}
        {base.freePrograms.length > 0 && (
          <Line k="自带程序">{base.freePrograms.join("、")}（黑客履历）</Line>
        )}
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

      {data.weapons && data.weapons.length > 0 && (
        <>
          <h4 className={styles.subTitle}>
            额外随身武器 <small className={styles.stepNote}>{kit.weapons.length} / 2</small>
          </h4>
          <ul className={styles.weaponGrid}>
            {data.weapons.map((w) => {
              const on = kit.weapons.includes(w.id);
              const owned = ownedGear.has(w.id);
              const full = !on && kit.weapons.length >= 2;
              return (
                <li key={w.id}>
                  <button
                    type="button"
                    className={styles.weaponTile}
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
                    {itemArtOf(w.id) ? (
                      <Asset id={itemArtOf(w.id) as AssetId} className={styles.weaponImg} />
                    ) : null}
                    <span className={styles.weaponName}>{w.name}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {data.vehicles && data.vehicles.length > 0 && (
        <>
          <h4 className={styles.subTitle}>专属载具</h4>
          <ul className={styles.skillWall}>
            {data.vehicles.map((v) => {
              const free = base.freeVehicleIds.includes(v.id);
              const on = free || kit.vehicle === v.id;
              return (
                <li key={v.id}>
                  <button
                    type="button"
                    className={styles.pick}
                    aria-pressed={on}
                    disabled={free && kit.vehicle !== v.id}
                    onClick={() => setKit({ vehicle: kit.vehicle === v.id ? null : v.id })}
                  >
                    <CellFrame />
                    <span className={styles.pickHead}>
                      <strong className={styles.pickName}>{v.name}</strong>
                      <span className={styles.moduleBadge} data-tone={on ? "active" : undefined}>
                        {free ? "出身自带" : (CLASS_LABELS[v.class] ?? v.class)}
                      </span>
                    </span>
                    <span>
                      {[`${v.maker} · ${v.seats} 座`, v.note].filter(Boolean).join(" · ")}
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

// ———— 义体货架：嵌入式预览与装配（支持单击预览、按钮装卸/替换、双击快速装卸） ————

const RARITY_ORDER = ["common", "uncommon", "rare", "epic", "legendary"] as const;

export function CyberwareShelf({ card, board, data, commit, slot }: CyberwareShelfProps) {
  type Offer = BoardData["cyberware"][number];
  const [shelfState, setShelfState] = useState<{
    readonly slot: CyberSlot;
    readonly rarity: string | null;
    readonly picked: string | null;
  }>({ slot, rarity: null, picked: null });
  const rarity = shelfState.slot === slot ? shelfState.rarity : null;
  const picked = shelfState.slot === slot ? shelfState.picked : null;
  const setRarity = (next: string | null) =>
    setShelfState((s) => ({ slot, rarity: next, picked: s.slot === slot ? s.picked : null }));
  const setPicked = (next: string | null) =>
    setShelfState((s) => ({ slot, rarity: s.slot === slot ? s.rarity : null, picked: next }));

  const options = data.cyberware.filter((o) => o.slot === slot);
  const rarities = RARITY_ORDER.filter((r) => options.some((o) => o.rarity === r));
  const shown = rarity ? options.filter((o) => o.rarity === rarity) : options;
  const slotOf = new Map(data.cyberware.map((o) => [o.id, o.slot]));
  const mounted = board.cyberware.filter((c) => (slotOf.get(c.id) ?? c.slot) === slot);
  const inherentInSlot = inherentCyberware(card, data).filter((i) => i.slot === slot);
  const cap = cyberwareRules.SLOT_CAPACITY[slot];
  const slotFull = mounted.length >= cap;
  const isOn = (o: Offer) => mounted.some((p) => p.id === o.id);
  const canSwap = cap === 1 && slotFull;
  const blocked = (o: Offer) => !isOn(o) && slotFull && !canSwap;

  const actionLabel = (o: Offer) => (isOn(o) ? "卸下" : canSwap ? "替换装上" : "装上");

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
      },
    ];
  };

  const toggle = (o: Offer) => {
    if (!blocked(o)) commit({ ...board, cyberware: nextCyberware(o) });
  };

  const item =
    options.find((o) => o.id === picked) ??
    mounted.map((c) => options.find((o) => o.id === c.id)).find(Boolean) ??
    shown[0];
  const itemOn = item ? isOn(item) : false;
  const humanityNow = Math.max(0, 100 - totalStartHumanityCost(card, data));
  const toggled = item ? nextCyberware(item) : board.cyberware;
  const humanityNext = Math.max(
    0,
    100 - totalStartHumanityCost({ ...card, board: { ...board, cyberware: toggled } }, data),
  );
  const itemArt = item ? itemArtOf(item.id) : null;

  const hwSpecs = item
    ? [
        item.ram ? `RAM +${item.ram}` : "",
        item.programSlots ? `程序槽 ${item.programSlots} 格` : "",
        item.armor ? "护甲增强" : "",
        item.accelerator ? "神经反应加速" : "",
      ].filter(Boolean)
    : [];

  return (
    <div className={styles.pickerBody}>
      <div className={styles.shelfHead}>
        <span className={styles.shelfMeta}>
          可选义体 {shown.length} 款 · 已装 {mounted.length}/{cap} · 单击预览 / 双击装卸
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
      {options.length === 0 ? (
        <p className={styles.note}>开局没有能装在这个部位的义体。</p>
      ) : (
        <ul className={styles.shelfGrid}>
          {shown.map((o) => {
            const on = isOn(o);
            const isBlocked = blocked(o);
            return (
              <li key={o.id} className={styles.shelfRow}>
                <button
                  type="button"
                  className={styles.shelfItem}
                  aria-pressed={o.id === item?.id}
                  aria-label={`${o.name}${on ? "（已装）" : ""}`}
                  data-installed={on || undefined}
                  data-short={isBlocked || undefined}
                  title="单击预览详情，双击快速装卸"
                  onClick={() => setPicked(o.id)}
                  onDoubleClick={() => toggle(o)}
                >
                  <CyberItemCell
                    id={o.id}
                    name={o.name}
                    slot={o.slot as CyberSlot}
                    on={on}
                    rarity={o.rarity}
                    size={38}
                  />
                  <span className={styles.shelfTileName}>{o.name}</span>
                  <span className={styles.shelfTileRight}>
                    {on && <span className={styles.shelfTileOn}>已装</span>}
                    <span className={styles.shelfTileCost}>−{o.humanityCost} 人性</span>
                  </span>
                </button>
                <ActionButton
                  disabled={isBlocked}
                  title={isBlocked ? `这个部位最多装 ${cap} 件，先卸一件` : actionLabel(o)}
                  onClick={() => toggle(o)}
                >
                  {actionLabel(o)}
                </ActionButton>
              </li>
            );
          })}
        </ul>
      )}
      {item && (
        <article className={styles.shelfDetail}>
          <CellFrame />
          <div className={styles.shelfDetailHero}>
            {itemArt ? (
              <Asset id={itemArt} alt={item.name} className={styles.shelfArtImg} />
            ) : (
              <Asset id={CYBER_SLOT_ICON[slot]} height={34} tint="var(--cp-cyan)" />
            )}
            <div className={styles.shelfDetailTitleWrap}>
              <span className={styles.pickHead}>
                <span>
                  <strong className={styles.pickName}>{item.name}</strong>
                  {item.rarity && (
                    <span className={styles.shelfRarity} data-rarity={item.rarity}>
                      {" "}
                      · {RARITY_LABELS[item.rarity]}
                    </span>
                  )}
                </span>
                <Button
                  small
                  primary={!itemOn}
                  disabled={blocked(item)}
                  reason={`这个部位最多装 ${cap} 件，先卸一件`}
                  onClick={() => toggle(item)}
                >
                  {actionLabel(item)}
                </Button>
              </span>
            </div>
          </div>
          <p>{item.ability}</p>
          {hwSpecs.length > 0 && (
            <p className={styles.moduleTags}>硬件参数：{hwSpecs.join(" · ")}</p>
          )}
          <span className={styles.shelfDelta}>
            <span>神经占用：人性 −{item.humanityCost}</span>
            <span>
              术后人性：{humanityNow} → <b className={styles.shelfNum}>{humanityNext}</b>
            </span>
          </span>
        </article>
      )}
    </div>
  );
}
