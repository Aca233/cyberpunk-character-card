import { characterRules, cyberwareRules } from "@cp/core";
import { type CSSProperties, Fragment, type ReactNode, useState } from "react";
import type { AssetId } from "../../assets";
import { DIFFICULTY_LABELS } from "../../labels";
import { ActionButton } from "../../ui/ActionButton";
import { Asset, NineSlice } from "../../ui/Asset";
import { Button } from "../../ui/Button";
import { Panel } from "../../ui/Panel";
import { itemArtOf } from "./art";
import { ChronicleBody, type StoryEnd } from "./ChroniclePanel";
import { CyberDoll, type CyberSlot } from "./CyberDoll";
import { FactionsBody } from "./FactionsPanel";
import { GigsPanel } from "./GigsPanel";
import { type HabitAction, Habits } from "./Habits";
import { countdown, JournalBody } from "./Journal";
import { MemoryBody, type MemoryEdit } from "./MemoryPanel";
import { NewsBody } from "./NewsPanel";
import neural from "./neural.module.css";
import { Avatar, PhoneBody, UnreadBadge } from "./Phone";
import { Profile } from "./Profile";
import { type SquadAction, SquadPanel } from "./SquadPanel";
import styles from "./story.module.css";
import type { View } from "./view";

/**
 * 神经界面里由旧左侧栏拆出来的几页（2077-interface-plan.md 第五节第 4 条）：
 * 人物、义体、物品栏、制作、联系人。写法照旧侧栏，按页分开；商店、义体医生、存放、买公寓的入口
 * 暂时挂在物品栏和义体页，U3 改走 F 交互
 */

type Attribute = keyof View["character"]["attributes"];

/** 物品格九宫格切法，同四角在场的人用的 map.filterCell*（计划第九节） */
const CELL_SLICE = [20, 30, 30, 20] as const;
/** 背包图标格（计划第十二节第 9 条）：dialog.iconSlot 四边保留 16 原图像素，中间拉伸，保留切角 */
const ICON_SLOT_SLICE = 16;

const ATTRS: readonly (readonly [Attribute, string, AssetId])[] = [
  ["body", "肉体", "attr.body"],
  ["reflexes", "反应", "attr.reflexes"],
  ["tech", "技术", "attr.tech"],
  ["intelligence", "智力", "attr.intelligence"],
  ["cool", "镇定", "attr.cool"],
];

/** 单项属性的上限 */
const ATTRIBUTE_MAX = 20;

/** 武器格的编号，和数字键 1–3 对应 */
const WEAPON_SLOTS = [1, 2, 3] as const;

/** 武器格编号用原作 icons_keyboard 的数字键图标，和剧情选项的数字键一样 */
const SLOT_KEYS: Record<(typeof WEAPON_SLOTS)[number], AssetId> = {
  1: "key.1",
  2: "key.2",
  3: "key.3",
};

/** 人物（P）：属性和属性点、角色主板、习惯、街头声望、人性和身上挂着的状态 */
export function CharacterPage({
  view,
  onSpend,
  onHabit,
}: {
  readonly view: View;
  /** 分配一个属性点；正在生成时不传，按钮不显示 */
  readonly onSpend?: ((attribute: Attribute) => void) | undefined;
  readonly onHabit?: ((action: HabitAction, text: string) => void) | undefined;
}) {
  const { character, humanity, inventory } = view;
  return (
    <div className={neural.split}>
      <Panel as="section" title={character.name ?? "未建档"} line="var(--cp-red)">
        {character.name === null && (
          <p className={styles.dim}>这是未绑定角色的旧存档。新建存档时可以选择自己的角色。</p>
        )}
        <ul className={styles.attrs}>
          {ATTRS.map(([key, label, icon]) => (
            <li key={key}>
              <Asset id={icon} tint="var(--cp-cyan)" height={22} />
              <span>{label}</span>
              <b>{character.attributes[key] ?? "—"}</b>
              {(character.bonuses[key] ?? 0) > 0 && (
                <small className={styles.attrBonus}>+{character.bonuses[key]}</small>
              )}
              {character.attributePoints > 0 && onSpend && (
                <button
                  type="button"
                  className={styles.spend}
                  disabled={(character.attributes[key] ?? 0) >= ATTRIBUTE_MAX}
                  aria-label={`用 1 个属性点提升${label}`}
                  onClick={() => onSpend(key)}
                >
                  +
                </button>
              )}
            </li>
          ))}
        </ul>
        {character.attributePoints > 0 && (
          <p className={styles.points}>可分配属性点 {character.attributePoints}</p>
        )}
        {character.traits.length > 0 && (
          <ul className={styles.traits} aria-label="角色主板">
            {character.traits.map((t) => (
              <li
                key={`${t.slot}-${t.label}`}
                className={styles.trait}
                data-slot={t.slot}
                title={t.ability || undefined}
              >
                <small className={styles.traitKind}>{characterRules.TRAIT_LABELS[t.slot]}</small>
                {t.label}
              </li>
            ))}
          </ul>
        )}
        <Habits
          perceived={view.perceived}
          habits={character.habits}
          offers={character.habitOffers}
          onHabit={onHabit}
        />
      </Panel>
      <Panel as="section" title="状态" line="var(--cp-yellow)">
        <dl className={styles.facts}>
          <dt>街头声望</dt>
          <dd title={`${character.credWorld}${character.credHalf ? "；再得半级声望就升级" : ""}`}>
            {character.streetCred} 级 · {character.credTier}
            {character.credHalf && <small> · 半级</small>}
          </dd>
          <dt>人性</dt>
          <dd data-stage={humanity.stage}>
            {humanity.current}/{humanity.cap}
            <small> · {humanity.stageLabel}</small>
          </dd>
          {view.psychosis.crisis && (
            <>
              <dt>危机</dt>
              <dd data-tone={view.psychosis.crisis.status === "recovering" ? undefined : "bad"}>
                {view.psychosis.crisis.label}
                {view.psychosis.crisis.until && <small> · 到 {view.psychosis.crisis.until}</small>}
                {view.psychosis.crisis.status === "open" && <small> · 普通委托暂停</small>}
              </dd>
            </>
          )}
          {(view.psychosis.suppressant.until || view.psychosis.suppressant.dependent) && (
            <>
              <dt>压制剂</dt>
              <dd data-tone={view.psychosis.suppressant.withdrawal ? "bad" : undefined}>
                {view.psychosis.suppressant.until
                  ? `起效到 ${view.psychosis.suppressant.until}`
                  : view.psychosis.suppressant.withdrawal
                    ? "戒断中"
                    : "依赖"}
                {view.psychosis.suppressant.until && view.psychosis.suppressant.dependent && (
                  <small> · 依赖</small>
                )}
              </dd>
            </>
          )}
          <dt>生命</dt>
          <dd data-tone={view.health.wound === "none" ? undefined : "bad"}>
            {view.health.hp}/{view.health.max}
            {view.health.condition !== "up" && <small> · {view.health.conditionLabel}</small>}
          </dd>
          <dt>警方热度</dt>
          <dd
            data-tone={view.heat.stars >= 3 ? "bad" : undefined}
            title={
              view.heat.decayIn === null
                ? undefined
                : `再过 ${countdown(view.heat.decayIn).replace("还剩 ", "")}不犯事就降一星`
            }
          >
            {view.heat.stars} 星{view.heat.half && <small> · 多半星</small>}
          </dd>
          {view.heat.bounties.map((b) => (
            <Fragment key={b.id}>
              <dt>悬赏</dt>
              <dd data-tone="bad" title={`${b.since} 起：${b.reasons.join("；")}`}>
                {b.reward.toLocaleString("en-US")} 欧元
                {b.hunterName && <small> · {b.hunterName}在追你</small>}
              </dd>
            </Fragment>
          ))}
          {(view.trauma.active || view.trauma.lapsed) && (
            <>
              <dt>创伤小组</dt>
              <dd
                data-tone={view.trauma.active ? undefined : "bad"}
                title={view.trauma.dispatch.ok ? "倒下时会来" : view.trauma.dispatch.why}
              >
                {view.trauma.active
                  ? `${view.trauma.tierLabel}，到 ${view.trauma.until}`
                  : `${view.trauma.lapsed} 过期了`}
              </dd>
            </>
          )}
          {inventory.healing && (
            <>
              <dt>治疗</dt>
              <dd>
                {view.names.items[inventory.healing.id] ?? inventory.healing.id}{" "}
                {inventory.healing.charges}/{inventory.healing.max}
              </dd>
            </>
          )}
          {inventory.grenade && (
            <>
              <dt>手雷</dt>
              <dd>
                {view.names.items[inventory.grenade.id] ?? inventory.grenade.id}{" "}
                {inventory.grenade.charges}/{inventory.grenade.max}
              </dd>
            </>
          )}
          <dt>难度</dt>
          <dd>{DIFFICULTY_LABELS[view.difficulty]}</dd>
        </dl>
      </Panel>
    </div>
  );
}

type CyberPart = View["cyberware"][number];

/** 义体（原作义体医生那一页的排法，人体、部位格、人性条在 CyberDoll 里，和捏人共用）：已装义体、损坏、断肢；义体医生的入口暂挂在这里，U3 走 F */
export function CyberwarePage({
  view,
  onRipperdoc,
}: {
  readonly view: View;
  readonly onRipperdoc: () => void;
}) {
  // 一个部位按原作格数能装几件（用户 2026-10-31："为什么每个地方的义体只能选一个"），按装上的先后排
  const bySlot = new Map<CyberSlot, CyberPart[]>();
  for (const c of view.cyberware) bySlot.set(c.slot, [...(bySlot.get(c.slot) ?? []), c]);
  const tip = (slot: CyberSlot) => {
    const list = bySlot.get(slot) ?? [];
    if (list.length === 0) return <p className={styles.dim}>这个部位没装义体。</p>;
    return list.map((part) => (
      <Fragment key={part.id}>
        <h3 className={neural.cyberName} data-broken={part.broken || undefined}>
          {part.name}
        </h3>
        <dl className={styles.facts}>
          {part.rarityLabel && (
            <>
              <dt>稀有度</dt>
              <dd>{part.rarityLabel}</dd>
            </>
          )}
          <dt>状态</dt>
          <dd data-tone={part.broken ? "bad" : undefined}>
            {part.broken ? "打坏了，修好前用不了" : "正常"}
          </dd>
          {part.bonusText && (
            <>
              <dt>加成</dt>
              <dd>{part.bonusText}</dd>
            </>
          )}
        </dl>
        {part.ability && <p className={styles.cyberAbility}>{part.ability}</p>}
      </Fragment>
    ));
  };
  // 总格数照人体图上的格数（原作 2.0 义体医生那一页），不再按部位个数算
  const cells = Object.values(cyberwareRules.SLOT_CAPACITY).reduce((sum, n) => sum + n, 0);

  return (
    <CyberDoll
      parts={bySlot}
      humanity={view.humanity}
      tip={tip}
      corner={
        <>
          <small className={neural.cyberCount}>
            已装 {view.cyberware.length}/{cells}
          </small>
          {view.health.lostLimbs.length > 0 && (
            <Panel as="section" title="断肢" line="var(--cp-red)">
              <p className={styles.lostLimbs}>
                {view.health.lostLimbs.map((l) => l.label).join("、")}
              </p>
            </Panel>
          )}
          {view.ripperdoc && (
            <Panel as="section" title="义体医生" line="var(--cp-cyan)">
              <Button onClick={onRipperdoc}>找{view.ripperdoc.name}装义体</Button>
            </Panel>
          )}
        </>
      }
    />
  );
}

/** 页内分栏：原作按钮素材，按下的那一栏 pressed */
function SubTabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  readonly tabs: readonly (readonly [T, ReactNode])[];
  readonly value: T;
  readonly onChange: (tab: T) => void;
}) {
  return (
    <nav className={neural.sub}>
      {tabs.map(([id, label]) => (
        <Button key={id} small pressed={id === value} onClick={() => onChange(id)}>
          {label}
        </Button>
      ))}
    </nav>
  );
}

type InventoryFilter = "all" | "usable" | "weapon" | "clothing" | "mod" | "misc";

/**
 * 物品栏（O）：上方常驻三格随身武器、负荷与当前穿着，下方单行筛选与左列表右详情浏览；
 * 无需在「已装备」和「背包」之间来回切页即可直接换枪、装配件、穿脱衣服或使用消耗品。
 */
export function InventoryPage({
  view,
  onEquip,
  onUnequip,
  onMod,
  onShop,
  onBuyHome,
  onHeal,
  onUse,
  disabledReason,
}: {
  readonly view: View;
  /** 非战斗治疗直接结算；情境性使用交给行动输入，由玩家确认。 */
  readonly onHeal?: ((id: string) => Promise<void>) | undefined;
  readonly onUse?: ((id: string) => void) | undefined;
  readonly disabledReason?: string | undefined;
  /** 换装备；正在生成时不传，按钮不显示 */
  readonly onEquip?: ((id: string) => void) | undefined;
  readonly onUnequip?: ((id: string) => void) | undefined;
  /** 改装件：attach 从背包装到武器上，detach 拆下放回背包 */
  readonly onMod?: ((action: "attach" | "detach", weapon: string, mod: string) => void) | undefined;
  readonly onShop: (id: string) => void;
  /** 买下当前地点的一处公寓；正在生成时不传，按钮不显示 */
  readonly onBuyHome?: ((id: string) => void) | undefined;
}) {
  const { inventory } = view;
  const quickItems = [inventory.healing, inventory.grenade].flatMap((item) => (item ? [item] : []));
  const carried = { ...inventory.backpack };
  for (const item of quickItems) carried[item.id] = (carried[item.id] ?? 0) + 1;

  const [filter, setFilter] = useState<InventoryFilter>("all");
  const [search, setSearch] = useState("");
  const [pickedItem, setPickedItem] = useState<string | null>(null);
  const [healing, setHealing] = useState(false);
  const [useError, setUseError] = useState("");

  const isUsable = (id: string) => {
    const kind = inventory.details?.[id]?.kind;
    return (
      quickItems.some((item) => item.id === id) ||
      kind === "healing" ||
      kind === "grenade" ||
      kind === "consumable"
    );
  };

  const itemName = (id: string) => view.names.items[id] ?? id;
  const allCarried = Object.entries(carried).filter(([, count]) => count > 0);
  const backpack = allCarried.filter(([id]) => {
    const kind = inventory.details?.[id]?.kind;
    const matches = filter === "all" || (filter === "usable" ? isUsable(id) : kind === filter);
    return matches && itemName(id).toLocaleLowerCase().includes(search.trim().toLocaleLowerCase());
  });
  const selectedEntry = backpack.find(([id]) => id === pickedItem) ?? backpack[0] ?? null;
  const selectedItem = selectedEntry?.[0] ?? null;

  const selectItem = (id: string) => {
    setPickedItem(id);
    setUseError("");
  };

  const heal = async (id: string) => {
    if (!onHeal || healing || disabledReason) return;
    setHealing(true);
    setUseError("");
    try {
      await onHeal(id);
    } catch (error) {
      setUseError(error instanceof Error ? error.message : "使用失败，请重试");
    } finally {
      setHealing(false);
    }
  };

  // 存放挪到右上角地点块（用户定的），这里只剩商店和买公寓
  const places = view.shops.length > 0 || view.safehouse.forSale.length > 0;

  return (
    <div className={styles.inventoryRoot}>
      <section className={styles.loadoutSection} aria-label="随身装备">
        <header className={styles.loadoutBar}>
          <span className={styles.loadoutTitle}>武器槽（1–3）</span>
          <span className={styles.loadoutMeta}>
            <span className={styles.loadoutBadge}>{inventory.loadout.styleLabel}</span>
            <span
              className={styles.loadoutMeter}
              data-over={inventory.loadout.overloaded || undefined}
            >
              随身负荷{" "}
              <b>
                {inventory.loadout.usedSlots}/{inventory.loadout.maxSlots}
              </b>{" "}
              格
            </span>
          </span>
        </header>

        <ol className={styles.gear} aria-label="武器格">
          {WEAPON_SLOTS.map((n) => {
            const id = inventory.weapons[n - 1] ?? null;
            const active = inventory.active === n - 1;
            const art = itemArtOf(id);
            const wDetail = id === null ? undefined : inventory.details?.[id];
            const rarity = id === null ? undefined : (wDetail?.rarity ?? inventory.rarity[id]);
            const mods = id === null ? [] : (inventory.mods[id] ?? []);
            return (
              <li
                key={n}
                className={styles.gearCard}
                data-active={active || undefined}
                data-empty={id === null || undefined}
                data-rarity={rarity ?? undefined}
                data-iconic={wDetail?.iconic || undefined}
                style={{ "--i": n - 1 } as CSSProperties}
              >
                <NineSlice id="map.filterCellBg" tint="rgb(14 14 23 / 82%)" slice={CELL_SLICE} />
                {active && (
                  <NineSlice
                    id="panel.glowBottom"
                    tint="var(--cp-yellow)"
                    slice={0}
                    className={styles.gearGlow}
                  />
                )}
                <NineSlice id="map.filterCellFg" tint="var(--gear-line)" slice={CELL_SLICE} />
                {rarity && (
                  <NineSlice
                    id="cyber.cellRarity"
                    tint="var(--rarity)"
                    slice={0}
                    className={styles.gearRarity}
                  />
                )}

                <div className={styles.gearHead}>
                  <span className={styles.slotNum}>
                    <Asset id={SLOT_KEYS[n]} tint="currentColor" height={18} alt={String(n)} />
                  </span>
                  <small className={styles.gearSub}>
                    {id === null ? "空槽位" : (wDetail?.subLabel ?? "武器")}
                  </small>
                  {active && (
                    <span className={styles.gearHeld}>
                      <NineSlice id="cyber.gaugeLabel" tint="var(--cp-yellow)" slice={4} />
                      <b>手持</b>
                    </span>
                  )}
                </div>

                <span className={styles.gearArt} aria-hidden>
                  {art ? (
                    <Asset id={art} className={styles.weaponArt} />
                  ) : (
                    <span className={styles.gearEmptyHint}>{id === null ? "未装备" : ""}</span>
                  )}
                </span>

                <div className={styles.gearFoot}>
                  <span className={styles.gearName}>{id === null ? "空" : itemName(id)}</span>
                  {mods.length > 0 && id !== null && (
                    <div className={styles.gearMods}>
                      {mods.map((m) => (
                        <span key={m.slot} className={styles.gearModTag}>
                          {itemName(m.id)}
                          {onMod && (
                            <button
                              type="button"
                              className={styles.modDetach}
                              aria-label={`从${itemName(id)}上拆下${itemName(m.id)}`}
                              title={`拆下${itemName(m.id)}`}
                              onClick={() => onMod("detach", id, m.id)}
                            >
                              ×
                            </button>
                          )}
                        </span>
                      ))}
                    </div>
                  )}
                  {id !== null && ((!active && onEquip) || onUnequip) && (
                    <span className={styles.gearTools}>
                      {!active && onEquip && (
                        <ActionButton onClick={() => onEquip(id)}>拿上</ActionButton>
                      )}
                      {onUnequip && <ActionButton onClick={() => onUnequip(id)}>收起</ActionButton>}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ol>

        {inventory.clothing.length > 0 && (
          <ul className={styles.clothingStrip} aria-label="当前穿着">
            {inventory.clothing.map((c) => (
              <li key={c.slot} className={styles.clothingChip}>
                <small className={styles.dim}>{c.label}</small>
                <b>{itemName(c.id)}</b>
                {onUnequip && <ActionButton onClick={() => onUnequip(c.id)}>脱下</ActionButton>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={styles.packSection} aria-label="随身背包">
        <div className={styles.inventoryToolbar}>
          <SubTabs<InventoryFilter>
            tabs={[
              ["all", "全部"],
              ["usable", "可使用"],
              ["weapon", "武器"],
              ["clothing", "服装"],
              ["mod", "改装件"],
              ["misc", "杂物"],
            ]}
            value={filter}
            onChange={(next) => {
              setFilter(next);
              setPickedItem(null);
              setUseError("");
            }}
          />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索物品…"
            aria-label="搜索物品"
            className={styles.inventorySearch}
          />
        </div>

        {disabledReason && (
          <p role="status" className={styles.inventoryNotice}>
            {disabledReason}
          </p>
        )}
        {useError && (
          <p role="alert" className={styles.warn}>
            {useError}
          </p>
        )}

        {backpack.length === 0 ? (
          <p className={styles.inventoryEmpty}>
            {allCarried.length === 0 ? "随身背包是空的。" : "没有符合筛选条件的物品。"}
          </p>
        ) : (
          <div className={styles.inventoryBrowser}>
            <ul className={styles.inventoryGrid} aria-label="选择背包物品">
              {backpack.map(([id, count]) => {
                const quick = quickItems.find((item) => item.id === id);
                const art = itemArtOf(id);
                const detail = inventory.details?.[id];
                const rarity = detail?.rarity ?? inventory.rarity[id];
                const isSelected = selectedItem === id;
                return (
                  <li key={id}>
                    <button
                      type="button"
                      className={styles.gridItem}
                      aria-pressed={isSelected}
                      data-rarity={rarity ?? undefined}
                      data-iconic={detail?.iconic || undefined}
                      onClick={() => selectItem(id)}
                    >
                      <NineSlice
                        id="map.filterCellBg"
                        tint="rgb(14 14 23 / 78%)"
                        slice={CELL_SLICE}
                      />
                      <NineSlice id="map.filterCellFg" tint="var(--item-line)" slice={CELL_SLICE} />
                      {rarity && (
                        <NineSlice
                          id="cyber.cellRarity"
                          tint="var(--rarity)"
                          slice={0}
                          className={styles.gridRarity}
                        />
                      )}
                      <span className={styles.gridThumb} aria-hidden>
                        {art ? (
                          <Asset id={art} className={styles.weaponArt} />
                        ) : (
                          <Asset id="notify.inventory" tint="var(--cp-cyan)" height={20} />
                        )}
                      </span>
                      <span className={styles.gridInfo}>
                        <strong className={styles.gridName}>{itemName(id)}</strong>
                        <small className={styles.gridSub}>
                          {detail?.subLabel ?? "物品"}
                          {detail?.rarityLabel ? ` · ${detail.rarityLabel}` : ""}
                        </small>
                      </span>
                      <span className={styles.gridMeta}>
                        {quick ? (
                          <em className={styles.quickBadge}>
                            {quick.charges}/{quick.max} 次
                          </em>
                        ) : count > 1 ? (
                          <b>×{count}</b>
                        ) : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>

            {selectedEntry &&
              (() => {
                const [id, count] = selectedEntry;
                const to = inventory.equipTo[id];
                const art = itemArtOf(id);
                const detail = inventory.details?.[id];
                const rarity = detail?.rarity ?? inventory.rarity[id];
                const quick = quickItems.find((q) => q.id === id);
                const kind = detail?.kind;
                const usable = kind === "healing" || kind === "grenade" || kind === "consumable";
                const remaining = quick?.charges ?? detail?.remaining;
                const ceiling =
                  view.health.wound === "severe"
                    ? Math.floor(view.health.max * 0.29)
                    : view.health.max;
                const useBlocked =
                  disabledReason ||
                  (healing
                    ? "正在使用治疗品…"
                    : view.health.condition !== "up"
                      ? "当前无法自行使用物品"
                      : (kind === "healing" || kind === "grenade") && remaining === 0
                        ? "次数已用完，休整或场景结束后恢复"
                        : kind === "healing" && view.health.hp >= ceiling
                          ? "已达到当前治疗上限"
                          : !quick &&
                              (kind === "grenade" ||
                                (kind === "healing" && Boolean(view.combat.active)))
                            ? "先设为当前使用的物品"
                            : undefined);
                const directHeal = kind === "healing" && !view.combat.active;
                const modTargets = inventory.modTargets[id] ?? [];

                return (
                  <article
                    key={id}
                    className={styles.inventoryDetail}
                    data-rarity={rarity ?? undefined}
                    data-iconic={detail?.iconic || undefined}
                    aria-label="选中物品详情"
                  >
                    <NineSlice id="notify.itemCellBg" tint="rgb(12 8 14 / 90%)" slice={30} />
                    <NineSlice
                      id="notify.itemCellFg"
                      tint="var(--detail-line, rgb(94 246 255 / 55%))"
                      slice={30}
                    />
                    {rarity && (
                      <NineSlice
                        id="cyber.cellRarity"
                        tint="var(--rarity)"
                        slice={0}
                        className={styles.detailRarity}
                      />
                    )}

                    <header className={styles.detailHead}>
                      <div className={styles.detailTitleRow}>
                        <strong className={styles.detailTitle}>{itemName(id)}</strong>
                        {count > 1 && <b className={styles.detailCount}>×{count}</b>}
                      </div>
                      <div className={styles.detailTags}>
                        {detail?.rarityLabel && (
                          <span className={styles.detailRarityTag}>{detail.rarityLabel}</span>
                        )}
                        {detail?.subLabel && (
                          <span className={styles.detailTag}>{detail.subLabel}</span>
                        )}
                        {detail?.slotCost && (
                          <span className={styles.detailTag}>占 {detail.slotCost} 格负荷</span>
                        )}
                        {quick ? (
                          <span className={styles.detailTagActive}>
                            快捷栏 · {quick.charges}/{quick.max} 次
                          </span>
                        ) : remaining !== null && remaining !== undefined && detail?.charges ? (
                          <span className={styles.detailTag}>
                            剩余 {remaining}/{detail.charges} 次
                          </span>
                        ) : null}
                      </div>
                    </header>

                    {art && (
                      <div className={styles.detailShowcase} aria-hidden>
                        <NineSlice
                          id="dialog.iconSlot"
                          tint="rgb(8 8 14 / 88%)"
                          slice={ICON_SLOT_SLICE}
                          className={styles.cardFrame}
                        />
                        <NineSlice
                          id="dialog.iconSlot"
                          tint="rgb(94 246 255 / 10%)"
                          slice={ICON_SLOT_SLICE}
                          className={styles.cardFrame}
                        />
                        <Asset id={art} className={styles.detailArt} />
                      </div>
                    )}

                    {detail?.ability && <p className={styles.detailDesc}>{detail.ability}</p>}

                    {kind === "healing" && detail?.healPercent && (
                      <p className={styles.detailStat}>
                        每次恢复生命上限的 {detail.healPercent}%（当前生命 {view.health.hp}/
                        {view.health.max}）
                      </p>
                    )}

                    <div className={styles.detailActions}>
                      {usable && (
                        <div className={styles.detailActionGroup}>
                          <Button
                            small
                            primary={!useBlocked}
                            disabled={Boolean(useBlocked) || (directHeal ? !onHeal : !onUse)}
                            onClick={() => {
                              if (useBlocked) return;
                              if (directHeal) void heal(id);
                              else onUse?.(id);
                            }}
                          >
                            {directHeal
                              ? "使用治疗品"
                              : kind === "grenade"
                                ? "准备投掷"
                                : "准备使用"}
                          </Button>
                          {useBlocked ? (
                            <small className={styles.dim}>{useBlocked}</small>
                          ) : (
                            !directHeal && (
                              <small className={styles.dim}>填入行动框，确认后执行。</small>
                            )
                          )}
                        </div>
                      )}

                      {to === "quick" && !quick && (
                        <div className={styles.detailActionGroup}>
                          <Button
                            small
                            disabled={
                              !onEquip ||
                              Boolean(disabledReason) ||
                              healing ||
                              Boolean(view.combat.active)
                            }
                            onClick={() => onEquip?.(id)}
                          >
                            {kind === "healing" ? "设为当前治疗品" : "设为当前手雷"}
                          </Button>
                          {view.combat.active && (
                            <small className={styles.dim}>战斗中更换物品需要在行动中进行。</small>
                          )}
                        </div>
                      )}

                      {to && to !== "quick" && onEquip && (
                        <Button small primary onClick={() => onEquip(id)}>
                          {to === "clothing" ? "穿上" : "装上武器"}
                        </Button>
                      )}

                      {onMod && modTargets.length > 0 && (
                        <div className={styles.modTargetList}>
                          {modTargets.map((w) => (
                            <ActionButton key={w} onClick={() => onMod("attach", w, id)}>
                              装到{itemName(w)}
                            </ActionButton>
                          ))}
                        </div>
                      )}
                    </div>
                  </article>
                );
              })()}
          </div>
        )}
      </section>

      {places && (
        <section className={styles.placesBar} aria-label="当前地点服务">
          <span className={styles.loadoutTitle}>这里</span>
          <div className={styles.placesActions}>
            {view.shops.map((shop) => (
              <Button key={shop.id} small onClick={() => onShop(shop.id)}>
                进{shop.name}
              </Button>
            ))}
            {view.safehouse.forSale.map((home) => (
              <div className={styles.docLink} key={home.id}>
                <small className={styles.dim}>{home.locked ?? home.note}</small>
                {onBuyHome && !home.locked && (
                  <Button
                    small
                    disabled={home.price > view.money.eddies}
                    onClick={() => onBuyHome(home.id)}
                  >
                    买下{home.name}（{home.price.toLocaleString("en-US")} 欧元）
                  </Button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// 物品栏精简（用户定的方案 A）：制作页（拆解、升级）去掉；后台的 craft 动作和零件规则留着，以后想加回来再接界面

/** 日志（J）：左边待办、期限、拳赛和赛车、超梦；右边委托（进行中、委托板、已结束）；中间人的派单上限在人物档案里 */
export function JournalPage({
  view,
  onAccept,
  onBraindance,
  part,
}: {
  readonly view: View;
  /** 接下一单；正在生成时不传，按钮不能点 */
  readonly onAccept?: ((id: string) => Promise<void>) | undefined;
  /** 打开超梦体验编辑器；有在查的超梦时才有按钮 */
  readonly onBraindance: () => void;
  /** 钉住的追踪块分页签时只放一半：todo 左边待办那一栏，jobs 右边委托；不传两栏都放 */
  readonly part?: "todo" | "jobs";
}) {
  const tracked = view.objectives.filter((o) => o.status !== "offered");
  const offered = view.jobs.list.some((job) => job.status === "offered");

  return (
    <div className={neural.split}>
      {part !== "jobs" && (
        <div className={neural.stack}>
          <Panel as="section" title="待办" line="var(--cp-red)">
            {tracked.length === 0 ? (
              <p className={styles.dim}>眼下没有在办的事。</p>
            ) : (
              <ul className={styles.jobs}>
                {tracked.map((o) => (
                  <li key={o.id} data-overdue={o.status === "overdue" || undefined}>
                    <strong>{o.title}</strong>
                    <span>
                      {o.sourceLabel}
                      {o.due !== null && ` · ${o.status === "overdue" ? "已超期" : `${o.due} 前`}`}
                    </span>
                    {o.progress && <span className={styles.dim}>{o.progress}</span>}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          {view.deadlines.length > 0 && (
            <Panel as="section" title="期限" line="var(--cp-yellow)">
              <ul className={styles.deadlines}>
                {view.deadlines.map((d) => (
                  <li key={d.id} data-overdue={d.overdue || undefined}>
                    <Asset
                      id="status.timeCircle"
                      tint={d.overdue ? "var(--cp-danger)" : "var(--cp-yellow)"}
                      height={16}
                    />
                    <span>{d.label}</span>
                    <time>{d.overdue ? "已到期" : d.due}</time>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
          {/* 中间人并进人物档案（用户定的，2026-11-02）：派单上限在联系人→人物里，这里不再单列 */}
          <GigsPanel gigs={view.sidegigs} />
          {view.braindance.active && (
            <Panel as="section" title="超梦" line="var(--cp-cyan)">
              <Button onClick={onBraindance}>
                超梦体验编辑器 · 关键线索 {view.braindance.active.keys.found}/
                {view.braindance.active.keys.total}
              </Button>
            </Panel>
          )}
        </div>
      )}
      {part !== "todo" && (
        <Panel as="section" title="委托" line="var(--cp-red)">
          <JournalBody
            view={view}
            initialTab={offered && tracked.length === 0 ? "board" : "active"}
            onAccept={onAccept}
          />
        </Panel>
      )}
    </div>
  );
}

type MessagesTab = "dm" | "news";

/** 消息（T）：私信和新闻；四个频道的完整版在 U4 */
export function MessagesPage({
  view,
  onReply,
  onNews,
  initialTab = "dm",
  hideTabs = false,
}: {
  readonly view: View;
  /** 回复一条：输入框进入回复状态；正在生成时不传，按钮不显示 */
  readonly onReply?: ((id: number) => void) | undefined;
  /** 切到新闻栏：把新闻记成已读 */
  readonly onNews: () => void;
  readonly initialTab?: MessagesTab;
  /** 外面已经有页签（钉住的未读块）时不再出页内分栏 */
  readonly hideTabs?: boolean;
}) {
  const [tab, setTab] = useState<MessagesTab>(initialTab);
  return (
    <>
      {!hideTabs && (
        <SubTabs<MessagesTab>
          tabs={[
            ["dm", view.phone.unread > 0 ? `私信 ${view.phone.unread}` : "私信"],
            ["news", "新闻"],
          ]}
          value={tab}
          onChange={(t) => {
            setTab(t);
            if (t === "news") onNews();
          }}
        />
      )}
      <Panel as="section" title={tab === "dm" ? "私信" : "新闻"} line="var(--cp-cyan)">
        {tab === "dm" ? <PhoneBody view={view} onReply={onReply} /> : <NewsBody view={view} />}
      </Panel>
    </>
  );
}

type ContactsTab = "people" | "squad" | "factions";

/** 联系人：人物档案（含宿敌）、小队、势力 */
export function ContactsPage({
  view,
  onSquad,
}: {
  readonly view: View;
  /** 小队的动作；正在生成时不传，按钮不显示 */
  readonly onSquad?: ((action: SquadAction, npc: string) => void) | undefined;
}) {
  const [tab, setTab] = useState<ContactsTab>("people");
  const people = view.npcs.filter((n) => n.met || n.nemesis || n.known.length > 0);
  const [picked, setPicked] = useState<string | null>(null);
  const current = people.find((n) => n.id === picked) ?? people[0];

  return (
    <>
      <SubTabs<ContactsTab>
        tabs={[
          ["people", "人物"],
          ["squad", `小队 ${view.squad.members.length}/${view.squad.max}`],
          ["factions", "势力"],
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === "people" &&
        (people.length === 0 || !current ? (
          <p className={styles.dim}>还没有认识的人。</p>
        ) : (
          <div className={neural.split}>
            <Panel as="section" title="人物" line="var(--cp-cyan)">
              <ul className={styles.contactList} aria-label="人物">
                {people.map((n) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      className={styles.contact}
                      aria-pressed={n.id === current.id}
                      onClick={() => setPicked(n.id)}
                    >
                      <Avatar npc={n.id} name={n.name} dead={!n.alive} />
                      <span className={styles.contactName}>
                        <b>{n.name}</b>
                        <small className={styles.dim}>
                          {!n.alive
                            ? "已故"
                            : n.met
                              ? `${n.role} · 好感 ${n.affinity > 0 ? "+" : ""}${n.affinity}`
                              : n.nemesis
                                ? "交过手"
                                : "只听说过"}
                        </small>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </Panel>
            <Profile npc={current} fixer={view.jobs.fixers.find((f) => f.id === current.id)} />
          </div>
        ))}
      {tab === "squad" && <SquadPanel squad={view.squad} onSquad={onSquad} />}
      {tab === "factions" && (
        <Panel as="section" title="势力" line="var(--cp-yellow)">
          <FactionsBody view={view} />
        </Panel>
      )}
    </>
  );
}

type DatabaseTab = "shards" | "memory" | "chronicle";

/** 数据库：读过的芯片、记忆（场景摘要和共同记忆）、履历和收尾 */
export function DatabasePage({
  view,
  onReadShard,
  onEdit,
  onEnd,
}: {
  readonly view: View;
  /** 打开一张没读过的芯片：记成已读 */
  readonly onReadShard: (id: number) => void;
  /** 正在生成时是 undefined：只能看 */
  readonly onEdit?: ((edit: MemoryEdit) => Promise<void>) | undefined;
  readonly onEnd?: ((how: StoryEnd, epitaph: string | undefined) => Promise<void>) | undefined;
}) {
  const [tab, setTab] = useState<DatabaseTab>("shards");
  const shards = view.shards.list;
  const [picked, setPicked] = useState<number | null>(null);
  const current = shards.find((s) => s.id === picked) ?? null;

  const open = (id: number, read: boolean) => {
    setPicked(id);
    if (!read) onReadShard(id);
  };

  return (
    <>
      <SubTabs<DatabaseTab>
        tabs={[
          ["shards", view.shards.unread > 0 ? `芯片 ${view.shards.unread}` : "芯片"],
          ["memory", "记忆"],
          ["chronicle", "履历"],
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === "shards" &&
        (shards.length === 0 ? (
          <p className={styles.dim}>还没读过芯片。</p>
        ) : (
          <div className={neural.split}>
            <Panel as="section" title="芯片" line="var(--cp-yellow)">
              <ul className={styles.contactList} aria-label="芯片">
                {shards.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      className={styles.contact}
                      aria-pressed={s.id === current?.id}
                      onClick={() => open(s.id, s.read)}
                    >
                      <span className={styles.contactName}>
                        <b>{s.title}</b>
                        <small className={styles.dim}>
                          {s.kindLabel} · {s.at}
                        </small>
                      </span>
                      {!s.read && <UnreadBadge>新</UnreadBadge>}
                    </button>
                  </li>
                ))}
              </ul>
            </Panel>
            {current && (
              <Panel as="section" title={current.title} line="var(--cp-yellow)">
                <p className={styles.dim}>
                  {current.kindLabel}
                  {current.from && ` · ${current.from}`} · {current.at}
                </p>
                <p className={styles.factionReason}>{current.text}</p>
              </Panel>
            )}
          </div>
        ))}
      {tab === "memory" && (
        <Panel as="section" title="记忆" line="var(--cp-yellow)">
          <MemoryBody view={view} onEdit={onEdit} />
        </Panel>
      )}
      {tab === "chronicle" && (
        <Panel as="section" title="履历" line="var(--cp-yellow)">
          <ChronicleBody view={view} onEnd={onEnd} />
        </Panel>
      )}
    </>
  );
}
