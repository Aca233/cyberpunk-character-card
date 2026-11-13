import {
  type Board,
  type BoardModule,
  CASH_TIER_INFO,
  CASH_TIERS,
  type CharacterCard,
  cyberwareRules,
  FLAW_MAX,
  PAST_MAX,
  REFUND_MAX,
  SKILL_MAX,
} from "@cp/core";
import { type ReactNode, useState } from "react";
import type { BoardData } from "../../api/client";
import { Button } from "../../ui/Button";
import { CellFrame, FrameBox } from "../../ui/FrameBox";
import { CYBER_LABELS, CyberItemCell, type CyberSlot } from "../story/CyberDoll";
import { CustomModuleForm } from "./CustomModuleForm";
import styles from "./characters.module.css";
import {
  applyOriginPreset,
  isAnyOriginPreset,
  isOriginPreset,
  ORIGIN_ECOSYSTEM_LABELS,
  ORIGIN_PRESETS,
  type OriginEcosystem,
  type OriginKey,
  originDefaultLoadout,
  originEcosystem,
  pickedLoadouts,
  pruneKitForOrigin,
  TRAIT_FILTER_LABELS,
  type TraitFilter,
  totalStartHumanityCost,
  traitCategory,
} from "./creator";
import wb from "./workbench.module.css";

/**
 * CK3 工作台右栏的上下文选择器：出身、特质、负面缺陷、开局行装、义体货架。
 * 点数只提示、不拦截：超出难度预算时底栏标成传奇沙盒开局，仍然可以保存和开局
 */

export interface PickerProps {
  readonly card: CharacterCard;
  readonly board: Board;
  readonly data: BoardData;
  /** origin：换了出身时名片上的出身文字跟着改 */
  readonly commit: (board: Board, origin?: string) => void;
  readonly change: (patch: Partial<CharacterCard>) => void;
}

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

export function OriginPicker({ card, board, data, commit, change }: PickerProps) {
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
  const preset = board.origin ? (ORIGIN_PRESETS[board.origin.id as OriginKey] ?? null) : null;

  return (
    <div className={styles.pickerBody}>
      <div className={styles.slotTools}>
        <FrameBox className={wb.searchBox}>
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
            ＋ 自定义
          </Button>
        )}
      </div>
      <fieldset className={styles.shelfFilter} aria-label="出身生态分类">
        <button
          type="button"
          className={styles.shelfChip}
          aria-pressed={ecoFilter === "all"}
          onClick={() => setEcoFilter("all")}
        >
          全部 ({origins.length})
        </button>
        {ecoOptions.map((eco) => (
          <button
            key={eco}
            type="button"
            className={styles.shelfChip}
            aria-pressed={ecoFilter === eco}
            onClick={() => setEcoFilter(eco)}
          >
            {ORIGIN_ECOSYSTEM_LABELS[eco]}
          </button>
        ))}
      </fieldset>
      {preset && board.origin && (
        <div className={styles.slotTools}>
          <Button
            small
            disabled={isOriginPreset(board.origin.id, board)}
            onClick={() => {
              if (!board.origin) return;
              const updated = applyOriginPreset(board.origin.id, card, data.modules);
              const nextBoard = pruneKitForOrigin(updated, updated.board ?? board, data);
              change({
                origin: board.origin.label,
                board: nextBoard,
              });
            }}
          >
            {isAnyOriginPreset(board) ? "已套用预设构筑" : `一键套用预设：${preset.name}`}
          </Button>
        </div>
      )}
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
            {g.list.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  className={styles.pick}
                  aria-pressed={board.origin?.id === m.id}
                  onClick={() => {
                    const nextCard = { ...card, origin: m.label };
                    commit(pruneKitForOrigin(nextCard, { ...board, origin: m }, data), m.label);
                  }}
                >
                  <CellFrame />
                  <span className={styles.pickHead}>
                    <strong className={styles.pickName}>{m.label}</strong>
                    {m.points > 0 && <span className={styles.modulePoints}>{m.points} 点</span>}
                  </span>
                  {m.ability && <Line k="出身底子">{m.ability}</Line>}
                  {m.hook && <Line k="身世钩子">{m.hook}</Line>}
                  {m.people.length > 0 && <Line k="自带故人">{people(m)}</Line>}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

// ———— 角色特质（身心禀赋 + 专长技艺 + 自定义，支持关键词检索） ————

const FILTERS: readonly TraitFilter[] = ["all", "innate", "craft", "custom"];

export function TraitPicker({ board, data, commit }: Omit<PickerProps, "card" | "change">) {
  const [filter, setFilter] = useState<TraitFilter>("all");
  const [query, setQuery] = useState("");
  const [writing, setWriting] = useState(false);
  const onIds = new Set([...board.pasts, ...board.skills].map((m) => m.id));
  const legacyOn = [...board.pasts].filter((m) => !data.modules.some((l) => l.id === m.id));
  const library = [
    ...data.modules.filter((m) => m.slot === "skill" || (m.slot === "past" && onIds.has(m.id))),
    ...legacyOn,
    ...board.skills.filter((m) => !data.modules.some((l) => l.id === m.id)),
  ];
  const seen = new Set<string>();
  const unique = library.filter((m) => !seen.has(m.id) && seen.add(m.id));
  const shown = unique.filter(
    (m) => (filter === "all" || traitCategory(m) === filter) && matchesModuleQuery(m, query),
  );
  const filters = board.pasts.length > 0 ? [...FILTERS, "past" as const] : FILTERS;
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
        <FrameBox className={wb.searchBox}>
          <input
            type="search"
            value={query}
            placeholder="搜索特质（如：黑客、潜入、肉体、枪…）"
            aria-label="搜索角色特质"
            onChange={(e) => setQuery(e.target.value)}
          />
        </FrameBox>
        {!writing && (
          <Button small disabled={skillFull} onClick={() => setWriting(true)}>
            ＋ 自定义
          </Button>
        )}
      </div>
      <fieldset className={styles.shelfFilter} aria-label="特质分类">
        {filters.map((f) => (
          <button
            key={f}
            type="button"
            className={styles.shelfChip}
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
          >
            {TRAIT_FILTER_LABELS[f]}
          </button>
        ))}
      </fieldset>
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
      {shown.length === 0 && <p className={styles.note}>没有匹配条件的特质。</p>}
      <ul className={styles.skillWall}>
        {shown.map((m) => {
          const pressed = onIds.has(m.id);
          const full = m.slot === "past" ? pastFull : skillFull;
          return (
            <li key={m.id}>
              <button
                type="button"
                className={styles.pick}
                aria-pressed={pressed}
                disabled={!pressed && full}
                title={!pressed && full ? "这一类特质已经插满" : undefined}
                onClick={() => toggle(m)}
              >
                <CellFrame />
                <span className={styles.pickHead}>
                  <strong className={styles.pickName}>{m.label}</strong>
                  <span className={styles.modulePoints}>{m.points} 点</span>
                </span>
                {m.ability && <span>{m.ability}</span>}
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

// ———— 负面缺陷（返还点数，支持搜索） ————

export function FlawPicker({ board, data, commit }: Omit<PickerProps, "card" | "change">) {
  const [query, setQuery] = useState("");
  const [writing, setWriting] = useState(false);
  const flawPoints = board.flaws.reduce((sum, m) => sum + m.points, 0);
  const on = new Set(board.flaws.map((m) => m.id));
  const library = data.modules.filter((m) => m.slot === "flaw");
  const own = board.flaws.filter((m) => !library.some((l) => l.id === m.id));
  const full = board.flaws.length >= FLAW_MAX;
  const shown = [...library, ...own].filter((m) => matchesModuleQuery(m, query));

  return (
    <div className={styles.pickerBody}>
      <div className={styles.slotTools}>
        <FrameBox className={wb.searchBox}>
          <input
            type="search"
            value={query}
            placeholder="搜索负面缺陷或钩子…"
            aria-label="搜索负面缺陷"
            onChange={(e) => setQuery(e.target.value)}
          />
        </FrameBox>
        {!writing && (
          <Button small disabled={full} onClick={() => setWriting(true)}>
            ＋ 自定义
          </Button>
        )}
      </div>
      <p className={styles.note}>
        已接受 {board.flaws.length} / {FLAW_MAX} 项 · 最多返还 {REFUND_MAX} 点
        {flawPoints > REFUND_MAX && `（超出 ${flawPoints - REFUND_MAX} 点不算）`}
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
          const extra = Math.max(0, Math.min(m.points, REFUND_MAX - flawPoints));
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
                  <span className={styles.modulePoints}>
                    {pressed ? "已接受" : extra > 0 ? `返还 +${extra} 点` : "已到返还上限"}
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

export function LoadoutPicker({ card, board, data, commit }: PickerProps) {
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
          {base.baseEddies} 欧元
          {base.finalEddies !== base.baseEddies && ` → 实际 ${base.finalEddies} 欧元`}
        </Line>
        {base.gearNames.length > 0 && <Line k="随身装备">{base.gearNames.join("、")}</Line>}
        {base.freeVehicleNames.length > 0 && (
          <Line k="名下载具">{base.freeVehicleNames.join("、")}（出身自带 · 0 点）</Line>
        )}
        {base.freePrograms.length > 0 && (
          <Line k="自带程序">{base.freePrograms.join("、")}（黑客履历）</Line>
        )}
      </section>

      <h4 className={styles.subTitle}>启动资金档位</h4>
      <fieldset className={styles.shelfFilter} aria-label="启动资金档位">
        {CASH_TIERS.map((t) => (
          <button
            key={t}
            type="button"
            className={styles.shelfChip}
            aria-pressed={kit.cashTier === t}
            title={CASH_TIER_INFO[t].desc}
            onClick={() => setKit({ cashTier: t })}
          >
            {CASH_TIER_INFO[t].label}
            {CASH_TIER_INFO[t].points !== 0 &&
              (CASH_TIER_INFO[t].points > 0
                ? ` · ${CASH_TIER_INFO[t].points}点`
                : ` · 返${-CASH_TIER_INFO[t].points}点`)}
          </button>
        ))}
      </fieldset>
      <p className={styles.note}>{CASH_TIER_INFO[kit.cashTier].desc}</p>

      {data.weapons && data.weapons.length > 0 && (
        <>
          <h4 className={styles.subTitle}>
            额外随身武器 <small className={styles.stepNote}>{kit.weapons.length} / 2</small>
          </h4>
          <ul className={styles.skillWall}>
            {data.weapons.map((w) => {
              const on = kit.weapons.includes(w.id);
              const owned = ownedGear.has(w.id);
              const full = !on && kit.weapons.length >= 2;
              return (
                <li key={w.id}>
                  <button
                    type="button"
                    className={styles.pick}
                    aria-pressed={on}
                    disabled={!on && (owned || full)}
                    title={owned ? "出身已经自带" : full ? "最多额外携带 2 把" : undefined}
                    onClick={() =>
                      setKit({
                        weapons: on
                          ? kit.weapons.filter((x) => x !== w.id)
                          : [...kit.weapons, w.id],
                      })
                    }
                  >
                    <CellFrame />
                    <span className={styles.pickHead}>
                      <strong className={styles.pickName}>{w.name}</strong>
                      <span className={styles.modulePoints}>
                        {owned
                          ? "出身自带"
                          : `${RARITY_LABELS[w.rarity] ?? w.rarity} · ${w.points} 点`}
                      </span>
                    </span>
                    <span>{w.ability}</span>
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
                      <span className={styles.modulePoints}>
                        {free
                          ? "出身自带 · 0 点"
                          : `${CLASS_LABELS[v.class] ?? v.class} · ${v.points} 点`}
                      </span>
                    </span>
                    <span>
                      {v.maker} · {v.seats} 座 · 后备箱 {v.trunk} 格{v.note ? ` · ${v.note}` : ""}
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

// ———— 义体货架：点中栏人体部位后在右栏出该部位的货 ————

const RARITY_ORDER = ["common", "uncommon", "rare", "epic", "legendary"] as const;

export function CyberwareShelf({
  card,
  board,
  data,
  commit,
  slot,
}: PickerProps & { readonly slot: CyberSlot }) {
  type Offer = BoardData["cyberware"][number];
  const [rarity, setRarity] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const options = data.cyberware.filter((o) => o.slot === slot);
  const rarities = RARITY_ORDER.filter((r) => options.some((o) => o.rarity === r));
  const shown = rarity ? options.filter((o) => o.rarity === rarity) : options;
  const slotOf = new Map(data.cyberware.map((o) => [o.id, o.slot]));
  const mounted = board.cyberware.filter((c) => (slotOf.get(c.id) ?? c.slot) === slot);
  const cap = cyberwareRules.SLOT_CAPACITY[slot];
  const slotFull = mounted.length >= cap;
  const isOn = (o: Offer) => mounted.some((p) => p.id === o.id);
  const canSwap = cap === 1 && slotFull;
  const blocked = (o: Offer) => !isOn(o) && slotFull && !canSwap;

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
        points: o.points,
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
  const humanityNow = 100 - totalStartHumanityCost(card, data);
  const toggled = item ? nextCyberware(item) : board.cyberware;
  const humanityNext =
    100 - totalStartHumanityCost({ ...card, board: { ...board, cyberware: toggled } }, data);

  return (
    <div className={styles.pickerBody}>
      <h4 className={styles.subTitle}>
        {CYBER_LABELS[slot]}{" "}
        <small className={styles.stepNote}>
          已装 {mounted.length} / {cap} · 单击查看，双击快速装卸
        </small>
      </h4>
      {rarities.length > 1 && (
        <fieldset className={styles.shelfFilter} aria-label="按稀有度筛">
          <button
            type="button"
            className={styles.shelfChip}
            aria-pressed={rarity === null}
            onClick={() => setRarity(null)}
          >
            全部
          </button>
          {rarities.map((r) => (
            <button
              key={r}
              type="button"
              className={styles.shelfChip}
              data-rarity={r}
              aria-pressed={rarity === r}
              onClick={() => setRarity(r)}
            >
              {RARITY_LABELS[r]}
            </button>
          ))}
        </fieldset>
      )}
      {options.length === 0 ? (
        <p className={styles.note}>开局没有能装在这个部位的义体。</p>
      ) : (
        <ul className={styles.shelfGrid}>
          {shown.map((o) => (
            <li key={o.id}>
              <button
                type="button"
                className={styles.shelfItem}
                aria-pressed={o.id === item?.id}
                aria-label={`${o.name}${isOn(o) ? "（已装）" : ""}`}
                title={o.name}
                data-short={blocked(o) || undefined}
                onClick={() => setPicked(o.id)}
                onDoubleClick={() => toggle(o)}
              >
                <CyberItemCell id={o.id} name={o.name} on={isOn(o)} rarity={o.rarity} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {item && (
        <article className={styles.shelfDetail}>
          <CellFrame />
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
              disabled={blocked(item)}
              reason={`这个部位最多装 ${cap} 件，先卸一件`}
              onClick={() => toggle(item)}
            >
              {itemOn ? "卸下" : canSwap ? "替换装上" : "装上"}
            </Button>
          </span>
          <p>{item.ability}</p>
          <span className={styles.shelfDelta}>
            <span>{itemOn ? `返还 ${item.points} 点` : `消耗 ${item.points} 点`}</span>
            <span>
              人性 {humanityNow} → <b className={styles.shelfNum}>{humanityNext}</b>
            </span>
          </span>
        </article>
      )}
    </div>
  );
}
