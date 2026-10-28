import { characterRules } from "@cp/core";
import { Fragment, type ReactNode, useState } from "react";
import type { AssetId } from "../../assets";
import { DIFFICULTY_LABELS } from "../../labels";
import { ActionButton } from "../../ui/ActionButton";
import { Asset } from "../../ui/Asset";
import { Button } from "../../ui/Button";
import { Panel } from "../../ui/Panel";
import { ChronicleBody, type StoryEnd } from "./ChroniclePanel";
import { FactionsBody } from "./FactionsPanel";
import { GigsPanel } from "./GigsPanel";
import { type HabitAction, Habits } from "./Habits";
import { countdown, JournalBody } from "./Journal";
import { MemoryBody, type MemoryEdit } from "./MemoryPanel";
import { NewsBody } from "./NewsPanel";
import neural from "./neural.module.css";
import { Avatar, PhoneBody, Profile } from "./Phone";
import { type SquadAction, SquadPanel } from "./SquadPanel";
import styles from "./story.module.css";
import type { View } from "./view";

/**
 * 神经界面里由旧左侧栏拆出来的几页（2077-interface-plan.md 第五节第 4 条）：
 * 人物、义体、物品栏、制作、联系人。写法照旧侧栏，按页分开；商店、义体医生、存放、买公寓的入口
 * 暂时挂在物品栏和义体页，U3 改走 F 交互
 */

type Attribute = keyof View["character"]["attributes"];

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

/** 义体（原作「操作系统」那一页）：已装义体、损坏、断肢；义体医生的入口暂挂在这里，U3 走 F */
export function CyberwarePage({
  view,
  onRipperdoc,
}: {
  readonly view: View;
  readonly onRipperdoc: () => void;
}) {
  return (
    <div className={neural.split}>
      <Panel as="section" title="已装义体" line="var(--cp-cyan)">
        {view.cyberware.length === 0 ? (
          <p className={styles.dim}>没装义体。</p>
        ) : (
          <ul className={styles.cyberList}>
            {view.cyberware.map((c) => (
              <li key={c.id} className={styles.cyberItem} data-broken={c.broken || undefined}>
                <span>{c.name}</span>
                <small className={styles.cyberSlot}>
                  {c.slotLabel}
                  {c.rarityLabel ? ` · ${c.rarityLabel}` : ""}
                  {c.broken && " · 打坏了，修好前用不了"}
                </small>
                {c.ability && (
                  <p className={styles.cyberAbility}>
                    {c.ability}
                    {c.bonusText && `（${c.bonusText}）`}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <div className={neural.stack}>
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
      </div>
    </div>
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

/** 物品栏（O）：武器格、快捷栏、穿着和整套外观、背包；商店、存放、买公寓的入口暂挂在这里，U3 走 F */
export function InventoryPage({
  view,
  onEquip,
  onUnequip,
  onOutfit,
  onMod,
  onShop,
  onStash,
  onBuyHome,
}: {
  readonly view: View;
  /** 换装备；正在生成时不传，按钮不显示 */
  readonly onEquip?: ((id: string) => void) | undefined;
  readonly onUnequip?: ((id: string) => void) | undefined;
  /** 整套外观：save 存下身上穿着的，wear 照存下的换好 */
  readonly onOutfit?: ((action: "save" | "wear") => void) | undefined;
  /** 改装件：attach 从背包装到武器上，detach 拆下放回背包 */
  readonly onMod?: ((action: "attach" | "detach", weapon: string, mod: string) => void) | undefined;
  readonly onShop: (id: string) => void;
  readonly onStash: () => void;
  /** 买下当前地点的一处公寓；正在生成时不传，按钮不显示 */
  readonly onBuyHome?: ((id: string) => void) | undefined;
}) {
  const { inventory } = view;
  const backpack = Object.entries(inventory.backpack);
  const itemName = (id: string) => view.names.items[id] ?? id;
  const hasStash = view.safehouse.homes.length > 0 || view.safehouse.trunks.length > 0;
  const places = view.shops.length > 0 || view.safehouse.forSale.length > 0 || hasStash;

  return (
    <div className={neural.split}>
      <div className={neural.stack}>
        <Panel as="section" title="武器" line="var(--cp-red)">
          <ol className={styles.gear} aria-label="武器格">
            {WEAPON_SLOTS.map((n) => {
              const id = inventory.weapons[n - 1] ?? null;
              const active = inventory.active === n - 1;
              return (
                <li key={n} data-active={active || undefined} data-empty={id === null || undefined}>
                  <span className={styles.slotNum}>
                    <Asset id={SLOT_KEYS[n]} tint="currentColor" height={20} alt={String(n)} />
                  </span>
                  <span>
                    {id === null ? "空" : itemName(id)}
                    {id !== null && inventory.tuned[id] && (
                      <small className={styles.dim}> · {inventory.tuned[id]}</small>
                    )}
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
                    {active && <small>手持</small>}
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
        {(inventory.healing || inventory.grenade) && (
          <Panel as="section" title="快捷栏" line="var(--cp-yellow)">
            <ul className={styles.backpack}>
              {[inventory.healing, inventory.grenade].map(
                (q) =>
                  q && (
                    <li key={q.id}>
                      <span>
                        {itemName(q.id)} {q.charges}/{q.max}
                      </span>
                      {onUnequip && (
                        <ActionButton onClick={() => onUnequip(q.id)}>放回背包</ActionButton>
                      )}
                    </li>
                  ),
              )}
            </ul>
          </Panel>
        )}
        {(inventory.clothing.length > 0 || inventory.outfit.length > 0) && (
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
            {inventory.outfit.length > 0 && (
              <p className={styles.dim}>
                整套外观：
                {inventory.outfit.map((o) => `${o.label} ${itemName(o.id)}`).join("、")}
              </p>
            )}
            {onOutfit && (
              <div className={styles.gearTools}>
                <ActionButton
                  disabled={inventory.clothing.length === 0}
                  onClick={() => onOutfit("save")}
                >
                  存为整套外观
                </ActionButton>
                {inventory.outfit.length > 0 && (
                  <ActionButton onClick={() => onOutfit("wear")}>换上整套外观</ActionButton>
                )}
              </div>
            )}
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
                return (
                  <li key={id}>
                    <span>
                      {itemName(id)}
                      {count > 1 && <b> ×{count}</b>}
                    </span>
                    {to && onEquip && (
                      <ActionButton onClick={() => onEquip(id)}>
                        {to === "clothing" ? "穿上" : to === "quick" ? "放进快捷栏" : "装上"}
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
            {hasStash && (
              <div className={styles.docLink}>
                <Button onClick={onStash}>存放</Button>
              </div>
            )}
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
  );
}

/** 制作（K）：零件数、能拆的东西、能升级的武器；结算都由代码按规则做，不调用模型 */
export function CraftingPage({
  view,
  onCraft,
}: {
  readonly view: View;
  /** dismantle 拆成零件，tune 给武器升一档稀有度；正在生成时不传，按钮不显示 */
  readonly onCraft?: ((action: "dismantle" | "tune", id: string) => void) | undefined;
}) {
  const { inventory } = view;
  const itemName = (id: string) => view.names.items[id] ?? id;
  const dismantle = Object.entries(inventory.dismantle);
  const tune = Object.entries(inventory.tune);

  return (
    <div className={neural.split}>
      <Panel as="section" title={`拆解 · 零件 ${inventory.parts}`} line="var(--cp-yellow)">
        {dismantle.length === 0 ? (
          <p className={styles.dim}>没有能拆的东西。</p>
        ) : (
          <ul className={styles.backpack}>
            {dismantle.map(([id, parts]) => (
              <li key={id}>
                <span>
                  {itemName(id)}
                  {(inventory.backpack[id] ?? 0) > 1 && <b> ×{inventory.backpack[id]}</b>}
                  <small className={styles.dim}> · 得 {parts} 个零件</small>
                </span>
                {onCraft && (
                  <ActionButton onClick={() => onCraft("dismantle", id)}>拆解</ActionButton>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel as="section" title="升级" line="var(--cp-cyan)">
        {tune.length === 0 ? (
          <p className={styles.dim}>没有能升级的武器。</p>
        ) : (
          <ul className={styles.backpack}>
            {tune.map(([id, t]) => (
              <li key={id}>
                <span>
                  {itemName(id)}
                  {inventory.tuned[id] && (
                    <small className={styles.dim}> · {inventory.tuned[id]}</small>
                  )}
                  <small className={styles.dim}>
                    {" "}
                    → {t.to} · {t.parts} 个零件 · 技术 {t.tech}
                  </small>
                </span>
                {onCraft && (
                  <ActionButton
                    disabled={inventory.parts < t.parts}
                    onClick={() => onCraft("tune", id)}
                  >
                    升级
                  </ActionButton>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

/** 日志（J）：左边待办、期限、中间人、拳赛和赛车、超梦；右边委托（进行中、委托板、已结束） */
export function JournalPage({
  view,
  onAccept,
  onBraindance,
}: {
  readonly view: View;
  /** 接下一单；正在生成时不传，按钮不能点 */
  readonly onAccept?: ((id: string) => Promise<void>) | undefined;
  /** 打开超梦体验编辑器；有在查的超梦时才有按钮 */
  readonly onBraindance: () => void;
}) {
  const tracked = view.objectives.filter((o) => o.status !== "offered");
  const offered = view.jobs.list.some((job) => job.status === "offered");

  return (
    <div className={neural.split}>
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
        {view.jobs.fixers.length > 0 && (
          <Panel as="section" title="中间人" line="var(--cp-cyan)">
            <dl className={styles.facts}>
              {view.jobs.fixers.map((f) => (
                <Fragment key={f.id}>
                  <dt>{f.name}</dt>
                  <dd>
                    好感 {f.affinity} · 最多 {f.maxRisk} 星
                    {f.capHint && <small> · {f.capHint}</small>}
                  </dd>
                </Fragment>
              ))}
            </dl>
          </Panel>
        )}
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
      <Panel as="section" title="委托" line="var(--cp-red)">
        <JournalBody
          view={view}
          initialTab={offered && tracked.length === 0 ? "board" : "active"}
          onAccept={onAccept}
        />
      </Panel>
    </div>
  );
}

type MessagesTab = "dm" | "news";

/** 消息（T）：私信和新闻；四个频道的完整版在 U4 */
export function MessagesPage({
  view,
  onReply,
  onNews,
}: {
  readonly view: View;
  /** 回复一条：输入框进入回复状态；正在生成时不传，按钮不显示 */
  readonly onReply?: ((id: number) => void) | undefined;
  /** 切到新闻栏：把新闻记成已读 */
  readonly onNews: () => void;
}) {
  const [tab, setTab] = useState<MessagesTab>("dm");
  return (
    <>
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
                      <Avatar name={n.name} dead={!n.alive} />
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
            <Profile npc={current} />
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
                      {!s.read && <span className={styles.contactUnread}>新</span>}
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
