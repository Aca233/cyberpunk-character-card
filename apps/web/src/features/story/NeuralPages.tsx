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

/**
 * 物品栏（O）：武器格、穿着、背包、这里；商店、存放、买公寓的入口暂挂在这里，U3 走 F。
 * 物品栏精简（用户定的方案 A）：快捷栏不单列，治疗品和手雷带次数排进背包；整套外观和升级档不再显示
 */
export function InventoryPage({
  view,
  onEquip,
  onUnequip,
  onMod,
  onShop,
  onBuyHome,
}: {
  readonly view: View;
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
  // 方案 A：仅合并显示，保留存档中的快捷栏与剩余次数；同款物品合并数量。
  const quickItems = [inventory.healing, inventory.grenade].flatMap((item) => (item ? [item] : []));
  const carried = { ...inventory.backpack };
  for (const item of quickItems) carried[item.id] = (carried[item.id] ?? 0) + 1;
  const backpack = Object.entries(carried);
  const itemName = (id: string) => view.names.items[id] ?? id;
  // 存放挪到右上角地点块（用户定的），这里只剩商店和买公寓
  const places = view.shops.length > 0 || view.safehouse.forSale.length > 0;

  return (
    <div className={neural.stack}>
      {/* 计划第八节第 1 条：照原作物品栏，武器格在页顶横排占满宽，快捷栏、穿着、背包、这里在下面分两栏 */}
      <Panel as="section" title="武器" line="var(--cp-red)">
        <ol className={styles.gear} aria-label="武器格">
          {WEAPON_SLOTS.map((n) => {
            const id = inventory.weapons[n - 1] ?? null;
            const active = inventory.active === n - 1;
            const art = itemArtOf(id);
            const rarity = id === null ? undefined : inventory.rarity[id];
            return (
              <li
                key={n}
                data-active={active || undefined}
                data-empty={id === null || undefined}
                data-rarity={rarity}
                style={{ "--i": n - 1 } as CSSProperties}
              >
                {/* 计划第八节第 1 条：武器格照原作物品格做成大卡片，底和框用筛选格素材，手持的那把框亮成黄 */}
                <NineSlice id="map.filterCellBg" tint="rgb(14 14 23 / 72%)" slice={CELL_SLICE} />
                {/* 手持的那把：卡片底下铺原作 shapes_bg_glow 的底光（计划第八节第 1 条） */}
                {active && (
                  <NineSlice
                    id="panel.glowBottom"
                    tint="var(--cp-yellow)"
                    slice={0}
                    className={styles.gearGlow}
                  />
                )}
                <NineSlice id="map.filterCellFg" tint="var(--gear-line)" slice={CELL_SLICE} />
                {/* 左边一道原作 inventory4 的稀有度竖条，颜色按稀有度给 */}
                {rarity && (
                  <NineSlice
                    id="cyber.cellRarity"
                    tint="var(--rarity)"
                    slice={0}
                    className={styles.gearRarity}
                  />
                )}
                {active && (
                  <span className={styles.gearHeld}>
                    <NineSlice id="cyber.gaugeLabel" tint="var(--cp-yellow)" slice={4} />
                    <b>手持</b>
                  </span>
                )}
                <span className={styles.slotNum}>
                  <Asset id={SLOT_KEYS[n]} tint="currentColor" height={20} alt={String(n)} />
                </span>
                <span className={styles.gearArt} aria-hidden>
                  {art && <Asset id={art} className={styles.weaponArt} />}
                </span>
                <span className={styles.gearName}>
                  {id === null ? "空" : itemName(id)}
                  {id !== null &&
                    (inventory.mods[id] ?? []).map((m) => (
                      <small key={m.slot} className={styles.dim}>
                        {" · "}
                        {itemName(m.id)}
                        {onMod && (
                          <ActionButton
                            label={`从${itemName(id)}上拆下${itemName(m.id)}`}
                            onClick={() => onMod("detach", id, m.id)}
                          >
                            ×
                          </ActionButton>
                        )}
                      </small>
                    ))}
                </span>
                <span className={styles.gearTools}>
                  {id !== null && !active && onEquip && (
                    <ActionButton onClick={() => onEquip(id)}>拿上</ActionButton>
                  )}
                  {id !== null && onUnequip && (
                    <ActionButton onClick={() => onUnequip(id)}>收起</ActionButton>
                  )}
                </span>
              </li>
            );
          })}
        </ol>
      </Panel>
      <div className={neural.split}>
        <div className={neural.stack}>
          {inventory.clothing.length > 0 && (
            <Panel as="section" title="穿着" line="var(--cp-cyan)">
              <ul className={styles.backpack}>
                {inventory.clothing.map((c) => (
                  <li key={c.slot}>
                    <span>
                      <small className={styles.dim}>{c.label}</small> {itemName(c.id)}
                    </span>
                    {onUnequip && <ActionButton onClick={() => onUnequip(c.id)}>脱下</ActionButton>}
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
        <div className={neural.stack}>
          <Panel as="section" title="背包" line="var(--cp-yellow)">
            {backpack.length === 0 ? (
              <p className={styles.dim}>空的。</p>
            ) : (
              <ul className={styles.backpack}>
                {backpack.map(([id, count]) => {
                  const to = inventory.equipTo[id];
                  const art = itemArtOf(id);
                  const rarity = inventory.rarity[id];
                  // 治疗品和手雷在名字旁写剩几次（物品栏精简，方案 A）
                  const quick = quickItems.find((q) => q.id === id);
                  return (
                    <li key={id} data-art={art ? true : undefined} data-rarity={rarity}>
                      {/*
                       * 计划第八节第 1 条：有原作图的物品做成卡片，图在上、名字在下。
                       * 框换成原作对话图标格 dialog.iconSlot（72×72，左下、右上切角），和武器格的筛选格区分开
                       * （用户定的换框对照表，计划第十二节第 9 条）；它是实心一块、没有描边层，
                       * 铺一层深色底，再叠一层淡金色同形，透出物品格的颜色
                       */}
                      {art && (
                        <>
                          <NineSlice
                            id="dialog.iconSlot"
                            tint="rgb(14 14 23 / 80%)"
                            slice={ICON_SLOT_SLICE}
                            className={styles.cardFrame}
                          />
                          <NineSlice
                            id="dialog.iconSlot"
                            tint="rgb(255 190 40 / 12%)"
                            slice={ICON_SLOT_SLICE}
                            className={styles.cardFrame}
                          />
                          {/* 背包里的武器也贴原作稀有度竖条，和武器格一样（计划第八节第 1 条） */}
                          {rarity && (
                            <NineSlice
                              id="cyber.cellRarity"
                              tint="var(--rarity)"
                              slice={0}
                              className={styles.packRarity}
                            />
                          )}
                          <span className={styles.packArt} aria-hidden>
                            <Asset id={art} className={styles.weaponArt} />
                          </span>
                        </>
                      )}
                      <span className={styles.packName}>
                        {itemName(id)}
                        {count > 1 && <b> ×{count}</b>}
                        {quick && (
                          <small className={styles.dim}>
                            {" "}
                            · {quick.charges}/{quick.max} 次
                          </small>
                        )}
                      </span>
                      {to && to !== "quick" && onEquip && (
                        <ActionButton onClick={() => onEquip(id)}>
                          {to === "clothing" ? "穿上" : "装上"}
                        </ActionButton>
                      )}
                      {onMod &&
                        (inventory.modTargets[id] ?? []).map((w) => (
                          <ActionButton key={w} onClick={() => onMod("attach", w, id)}>
                            装到{itemName(w)}
                          </ActionButton>
                        ))}
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
          {places && (
            <Panel as="section" title="这里" line="var(--cp-cyan)">
              {view.shops.map((shop) => (
                <div className={styles.docLink} key={shop.id}>
                  <Button onClick={() => onShop(shop.id)}>进{shop.name}</Button>
                </div>
              ))}
              {view.safehouse.forSale.map((home) => (
                <div className={styles.docLink} key={home.id}>
                  <p className={styles.dim}>{home.locked ?? home.note}</p>
                  {onBuyHome && !home.locked && (
                    <Button
                      disabled={home.price > view.money.eddies}
                      onClick={() => onBuyHome(home.id)}
                    >
                      买下{home.name}（{home.price.toLocaleString("en-US")} 欧元）
                    </Button>
                  )}
                </div>
              ))}
            </Panel>
          )}
        </div>
      </div>
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
