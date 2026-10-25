import { characterRules } from "@cp/core";
import { Fragment } from "react";
import type { AssetId } from "../../assets";
import { DIFFICULTY_LABELS } from "../../labels";
import { ActionButton } from "../../ui/ActionButton";
import { Asset, NineSlice } from "../../ui/Asset";
import { Bar } from "../../ui/Bar";
import { Button } from "../../ui/Button";
import { Panel } from "../../ui/Panel";
import { GigsPanel } from "./GigsPanel";
import { type HabitAction, Habits } from "./Habits";
import { countdown } from "./Journal";
import { QuickhackWheel } from "./QuickhackWheel";
import { type SquadAction, SquadPanel } from "./SquadPanel";
import styles from "./story.module.css";
import { districtIcon, locationLabel, type View } from "./view";

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

const WOUND_LABELS = { none: "", light: "轻伤", severe: "重伤", zero: "失去意识" } as const;

/** 顶部 HUD：左上生命和声望，右上地区、时间，正中是战斗进度 */
export function Hud({
  view,
  onQuickhack,
}: {
  readonly view: View;
  /** 快速破解轮盘选了一个程序：把它写进输入框；生成中为 undefined */
  readonly onQuickhack?: ((name: string) => void) | undefined;
}) {
  const { health, character, combat } = view;
  const low = health.wound === "severe" || health.wound === "zero";
  const wound = WOUND_LABELS[health.wound];
  const weaponId =
    view.inventory.active === null ? null : (view.inventory.weapons[view.inventory.active] ?? null);
  const weapon = weaponId === null ? null : (view.names.items[weaponId] ?? weaponId);

  return (
    <header className={styles.hud}>
      <div className={styles.vitals}>
        <div className={styles.level} title="街头声望">
          <Asset id="hud.levelFrame" tint="var(--cp-red)" height={44} />
          <span>{character.streetCred}</span>
        </div>
        <div className={styles.hp}>
          <Bar
            id="hud.healthbar"
            value={health.hp}
            max={health.max}
            color={low ? "var(--cp-hp-low)" : "var(--cp-hp)"}
            width={260}
            label={`生命 ${health.hp}/${health.max}`}
          />
          <span className={styles.hpText} data-low={low || undefined}>
            HP {health.hp}/{health.max}
            {wound && ` · ${wound}`}
            {health.condition !== "up" && ` · ${health.conditionLabel}`}
          </span>
          {view.hacking && view.hacking.ramMax > 0 && (
            <div
              className={styles.ram}
              role="img"
              aria-label={`RAM ${view.hacking.ram}/${view.hacking.ramMax}`}
              title={`${view.hacking.deckName}：RAM ${view.hacking.ram}/${view.hacking.ramMax} 格；已装 ${
                view.hacking.programs.length > 0
                  ? view.hacking.programs.map((p) => `${p.name}（${p.ram} 格）`).join("、")
                  : "没有快速破解"
              }`}
            >
              {Array.from({ length: view.hacking.ramMax }, (_, i) => (
                <span
                  // biome-ignore lint/suspicious/noArrayIndexKey: 格子按位置排，没有别的 id
                  key={i}
                  className={styles.ramCell}
                  data-on={(view.hacking && i < view.hacking.ram) || undefined}
                >
                  {/* 原作 playerhealthbar 的 quickhackBar：memorybar 竖格染 Blue */}
                  <Asset id="hud.ramBar" tint="var(--cp-cyan)" height={12} />
                </span>
              ))}
            </div>
          )}
        </div>
        {view.hacking && view.hacking.programs.length > 0 && onQuickhack && (
          <QuickhackWheel
            ram={view.hacking.ram}
            ramMax={view.hacking.ramMax}
            programs={view.hacking.programs}
            onPick={onQuickhack}
          />
        )}
        {view.heat.stars > 0 && (
          <div
            className={styles.wanted}
            role="status"
            title={`警方热度 ${view.heat.stars} 星${view.heat.lastSeen ? `，最后一次被看见：${view.heat.lastSeen}` : ""}`}
          >
            {"★".repeat(view.heat.stars)}
            <span className={styles.starsEmpty}>{"★".repeat(5 - view.heat.stars)}</span>
          </div>
        )}
        {view.heat.bounties.length > 0 && (
          <div
            className={styles.bounty}
            role="status"
            title={view.heat.bounties.map((b) => b.reasons.join("；")).join("；")}
          >
            悬赏 {view.heat.bounties.reduce((sum, b) => sum + b.reward, 0).toLocaleString("en-US")}{" "}
            欧元
          </div>
        )}
        {view.stealth.level > 0 && (
          <div
            className={styles.alert}
            data-level={view.stealth.level}
            role="status"
            title={`潜入警戒 ${view.stealth.level}/3${view.stealth.lowered ? "，这个场景已经降过一档" : ""}`}
          >
            ◆ {view.stealth.label}
          </div>
        )}
        {view.hacking?.dive && (
          <div
            className={styles.dive}
            role="status"
            title={`肉身躺在${view.hacking.dive.chair}，${view.hacking.dive.guard}守着`}
          >
            潜网 · 第 {view.hacking.dive.layer}/{view.hacking.dive.layers} 层 ·{" "}
            {view.hacking.dive.label}
          </div>
        )}
        <div className={styles.weapon} title={weapon ?? "空手"}>
          <NineSlice id="hud.slotBg" tint="rgb(14 14 23 / 85%)" slice={[20, 38, 50, 38]} />
          <NineSlice id="hud.slotFg" tint="rgb(94 246 255 / 80%)" slice={[20, 38, 50, 38]} />
          {weapon === null ? (
            <Asset id="weapon.fists" tint="var(--cp-cyan)" height={28} alt="空手" />
          ) : (
            <span className={styles.weaponName}>{weapon}</span>
          )}
        </div>
      </div>

      {combat.standoff && (
        <div className={styles.combat} role="status">
          <span className={styles.combatTitle}>对峙</span>
          <span className={styles.combatEnemies}>和{combat.standoff.opponent}</span>
          <span className={styles.standoffClock} data-out={combat.standoff.left === 0 || undefined}>
            {combat.standoff.left > 0 ? `还剩 ${combat.standoff.left} 轮` : "时间到了，对方要动手"}
          </span>
        </div>
      )}
      {character.flashback && (
        <div className={styles.flashback} role="status">
          闪回 · {character.flashback.past} · 第 {character.flashback.turn}/
          {character.flashback.turns} 轮 · 不掷骰、不推进时间
        </div>
      )}
      {combat.active && (
        <div className={styles.combat} role="status">
          <span className={styles.combatTitle}>
            第 {combat.active.moment}/{combat.active.moments} 段
          </span>
          <span className={styles.combatResults}>
            {Array.from({ length: combat.active.moments }, (_, i) => (
              <i
                // biome-ignore lint/suspicious/noArrayIndexKey: 第几段就是格子的身份
                key={i}
                data-result={
                  i + 1 < (combat.active?.moment ?? 0)
                    ? "done"
                    : i + 1 === combat.active?.moment
                      ? "now"
                      : "todo"
                }
              />
            ))}
          </span>
          {combat.active.objective && (
            <span className={styles.combatEnemies}>目标：{combat.active.objective}</span>
          )}
          <span className={styles.combatDefeat}>败局：{combat.active.defeat}</span>
          <span className={styles.combatEnemies}>
            快捷动作 {combat.active.quick}/{combat.active.quickMax}
          </span>
          <span className={styles.combatEnemies}>
            {[
              ...combat.active.enemies.map((e) => `${e.group}×${e.count}`),
              ...combat.active.foes.map((f) =>
                f.scanned || f.state !== "up"
                  ? `${f.name}（${f.stateLabel}）`
                  : `${f.name}（未扫描）`,
              ),
            ].join("、")}
          </span>
          {combat.active.edgeLabel && (
            <span className={styles.combatEnemies}>{combat.active.edgeLabel}</span>
          )}
          {combat.active.dyingMomentsLeft !== null && (
            <span className={styles.dying}>
              濒死：{combat.active.dyingMomentsLeft} 段内要被救回
            </span>
          )}
        </div>
      )}

      <div className={styles.zone}>
        <div className={styles.zoneText}>
          <span className={styles.zoneName}>
            {view.names.location ?? locationLabel(view.location)}
          </span>
          <span className={styles.zoneTime}>
            {view.time.text} · {view.time.periodLabel} ·{" "}
            <span title={view.weather.note}>{view.weather.label}</span>
          </span>
        </div>
        <Asset
          id={districtIcon(view.names.district ?? view.location)}
          tint="var(--cp-yellow)"
          height={40}
        />
      </div>
    </header>
  );
}

/** 左侧角色栏：建档前显示“未建档” */
export function SidePanel({
  view,
  onSpend,
  onJournal,
  onRipperdoc,
  onShop,
  onEquip,
  onUnequip,
  onOutfit,
  onMod,
  onHabit,
  onPhone,
  onMap,
  onFactions,
  onStash,
  onAnchor,
  onSquad,
  onCraft,
  onBuyHome,
}: {
  readonly view: View;
  /** 分配一个属性点；正在生成时不传，按钮不显示 */
  readonly onSpend?: ((attribute: Attribute) => void) | undefined;
  /** 打开日志，board 为 true 时直接到委托板 */
  readonly onJournal: (board: boolean) => void;
  /** 打开当前地点的义体医生 */
  readonly onRipperdoc: () => void;
  /** 打开当前地点的一家商店 */
  readonly onShop: (id: string) => void;
  /** 换装备；正在生成时不传，按钮不显示 */
  readonly onEquip?: ((id: string) => void) | undefined;
  readonly onUnequip?: ((id: string) => void) | undefined;
  /** 整套外观：save 存下身上穿着的，wear 照存下的换好 */
  readonly onOutfit?: ((action: "save" | "wear") => void) | undefined;
  /** 改装件：attach 从背包装到武器上，detach 拆下放回背包 */
  readonly onMod?: ((action: "attach" | "detach", weapon: string, mod: string) => void) | undefined;
  /** 改习惯；正在生成时不传，按钮不显示 */
  readonly onHabit?: ((action: HabitAction, text: string) => void) | undefined;
  /** 设锚点或取消；正在生成时不传，按钮不显示 */
  readonly onAnchor?: ((action: "add" | "remove", npc: string) => void) | undefined;
  /** 小队面板的动作；正在生成时不传，按钮不显示 */
  readonly onSquad?: ((action: SquadAction, npc: string) => void) | undefined;
  /** 工作台：dismantle 拆成零件，tune 给武器升一档稀有度；正在生成时不传，按钮不显示 */
  readonly onCraft?: ((action: "dismantle" | "tune", id: string) => void) | undefined;
  /** 打开消息 */
  readonly onPhone: () => void;
  /** 打开地图和路线面板 */
  readonly onMap: () => void;
  /** 打开势力页 */
  readonly onFactions: () => void;
  /** 打开存放箱和后备箱 */
  readonly onStash: () => void;
  /** 买下当前地点的一处公寓；正在生成时不传，按钮不显示 */
  readonly onBuyHome?: ((id: string) => void) | undefined;
}) {
  const { character, humanity, inventory } = view;
  const backpack = Object.entries(inventory.backpack);
  const itemName = (id: string) => view.names.items[id] ?? id;
  const activeJobs = view.jobs.list.filter((job) => job.status === "active");
  const offered = view.jobs.list.filter((job) => job.status === "offered").length;
  return (
    <aside className={styles.side}>
      <Panel as="div" title={character.name ?? "未建档"}>
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
                <small className={styles.attrBonus} title="义体加成，已经算进去了">
                  +{character.bonuses[key]}
                </small>
              )}
              {character.attributePoints > 0 && onSpend && (
                <button
                  type="button"
                  className={styles.spend}
                  disabled={(character.attributes[key] ?? 0) >= ATTRIBUTE_MAX}
                  title={`用 1 个属性点提升${label}`}
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
          {view.psychosis.anchors.length > 0 && (
            <>
              <dt>锚点</dt>
              <dd>{view.psychosis.anchors.map((a) => a.name).join("、")}</dd>
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
          <dt>欧元</dt>
          <dd>{view.money.eddies.toLocaleString("en-US")}</dd>
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
          <dt>难度</dt>
          <dd>{DIFFICULTY_LABELS[view.difficulty]}</dd>
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
        </dl>
      </Panel>

      <Panel as="div" title="随身物品" line="var(--cp-yellow)">
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
                            title="拆下放回背包"
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
                  {id !== null && onCraft && inventory.tune[id] && (
                    <ActionButton
                      disabled={inventory.parts < inventory.tune[id].parts}
                      title={`用 ${inventory.tune[id].parts} 个零件升到${inventory.tune[id].to}；要技术 ${inventory.tune[id].tech}`}
                      onClick={() => onCraft("tune", id)}
                    >
                      升级
                    </ActionButton>
                  )}
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
        {(inventory.healing || inventory.grenade) && (
          <>
            <p className={styles.gearTitle}>快捷栏</p>
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
          </>
        )}
        {(inventory.clothing.length > 0 || inventory.outfit.length > 0) && (
          <>
            <p className={styles.gearTitle}>穿着</p>
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
                  title="把身上穿着的记成一整套，之后一下换回来"
                  onClick={() => onOutfit("save")}
                >
                  存为整套外观
                </ActionButton>
                {inventory.outfit.length > 0 && (
                  <ActionButton
                    title="照存下的整套换好；外观里没有的格子脱下放回背包"
                    onClick={() => onOutfit("wear")}
                  >
                    换上整套外观
                  </ActionButton>
                )}
              </div>
            )}
          </>
        )}
        <p className={styles.gearTitle}>
          背包{inventory.parts > 0 && <small> · 零件 {inventory.parts}</small>}
        </p>
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
                  {onCraft && inventory.dismantle[id] !== undefined && (
                    <ActionButton
                      title={`拆掉一件，得 ${inventory.dismantle[id]} 个零件`}
                      onClick={() => onCraft("dismantle", id)}
                    >
                      拆解
                    </ActionButton>
                  )}
                  {onCraft && inventory.tune[id] && (
                    <ActionButton
                      disabled={inventory.parts < inventory.tune[id].parts}
                      title={`用 ${inventory.tune[id].parts} 个零件升到${inventory.tune[id].to}；要技术 ${inventory.tune[id].tech}`}
                      onClick={() => onCraft("tune", id)}
                    >
                      升级
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
        {view.shops.map((shop) => (
          <div className={styles.docLink} key={shop.id}>
            <Button onClick={() => onShop(shop.id)}>进{shop.name}</Button>
          </div>
        ))}
        {view.safehouse.forSale.map((home) => (
          <div className={styles.docLink} key={home.id}>
            <p className={styles.dim}>{home.locked ?? home.note}</p>
            {onBuyHome && !home.locked && (
              <Button disabled={home.price > view.money.eddies} onClick={() => onBuyHome(home.id)}>
                买下{home.name}（{home.price.toLocaleString("en-US")} 欧元）
              </Button>
            )}
          </div>
        ))}
      </Panel>

      <Panel as="div" title="义体" line="var(--cp-cyan)">
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
        {view.health.lostLimbs.length > 0 && (
          <p className={styles.lostLimbs}>
            断肢：{view.health.lostLimbs.map((l) => l.label).join("、")}
            （找义体医生装义肢能补上）
          </p>
        )}
        {view.ripperdoc && (
          <div className={styles.docLink}>
            <Button onClick={onRipperdoc}>找{view.ripperdoc.name}装义体</Button>
          </div>
        )}
      </Panel>

      <SquadPanel squad={view.squad} onSquad={onSquad} />
      <GigsPanel gigs={view.sidegigs} />

      <Panel as="div" title="认识的人" line="var(--cp-cyan)">
        {view.npcs.length === 0 ? (
          <p className={styles.dim}>还没有认识的人，人物档案会随着交谈和相处留下来。</p>
        ) : (
          <ul className={styles.npcList}>
            {view.npcs.map((npc) => (
              <li key={npc.id}>
                <details className={styles.npcCard} data-dead={!npc.alive || undefined}>
                  <summary>
                    <strong>{npc.name}</strong>
                    <span className={styles.npcStatus}>
                      {!npc.alive ? "已故" : npc.here ? "在场" : "不在场"}
                    </span>
                    <span className={styles.npcRole}>{npc.role}</span>
                    {view.psychosis.anchors.some((a) => a.npc === npc.id) && (
                      <span className={styles.npcStatus}>锚点</span>
                    )}
                    <span className={styles.npcAffinity}>
                      好感 {npc.affinity > 0 ? "+" : ""}
                      {npc.affinity}
                    </span>
                  </summary>
                  <div className={styles.npcDetail}>
                    {npc.alias && <p>外号：{npc.alias}</p>}
                    <p>{npc.look}</p>
                    {onAnchor &&
                      npc.alive &&
                      (view.psychosis.anchors.some((a) => a.npc === npc.id) ? (
                        <ActionButton onClick={() => onAnchor("remove", npc.id)}>
                          不再当锚点
                        </ActionButton>
                      ) : (
                        view.psychosis.anchors.length < view.psychosis.max && (
                          <ActionButton
                            title="过命交情的人：快撑不住的时候能把你拉回来；最多 3 个"
                            onClick={() => onAnchor("add", npc.id)}
                          >
                            设为锚点
                          </ActionButton>
                        )
                      ))}
                    <p className={styles.npcMemoryTitle}>共同记忆</p>
                    {npc.memories.length === 0 ? (
                      <p className={styles.dim}>还没有记录。</p>
                    ) : (
                      <ul>
                        {npc.memories.map((memory) => (
                          <li key={memory}>{memory}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel as="div" title="委托" line="var(--cp-red)">
        {activeJobs.length === 0 ? (
          <p className={styles.dim}>眼下没有接下的委托。</p>
        ) : (
          <ul className={styles.jobs}>
            {activeJobs.map((job) => (
              <li key={job.id} data-overdue={job.overdue || undefined}>
                <strong>{job.title}</strong>
                <span>
                  {"★".repeat(job.risk)} · {job.reward.toLocaleString("en-US")} 欧元 ·{" "}
                  {job.statusLabel}
                </span>
                <span>
                  {job.fixer ? `中间人 ${job.fixer}` : `雇主 ${job.client}`}
                  {job.due !== null && ` · ${job.overdue ? "已超期" : `${job.due} 前`}`}
                </span>
                {job.notes.length > 0 && <span className={styles.dim}>{job.notes.at(-1)}</span>}
              </li>
            ))}
          </ul>
        )}
        <div className={styles.jobLinks}>
          <button type="button" onClick={() => onJournal(false)}>
            日志 [J]
          </button>
          <button type="button" onClick={onPhone}>
            消息{view.phone.unread > 0 ? `（${view.phone.unread} 条未读）` : ""}
          </button>
          <button type="button" onClick={onMap}>
            地图 [M]
          </button>
          <button type="button" onClick={onFactions}>
            势力 [F]
          </button>
          {(view.safehouse.homes.length > 0 || view.safehouse.trunks.length > 0) && (
            <button type="button" onClick={onStash}>
              存放 [B]
            </button>
          )}
          {offered > 0 && (
            <button type="button" onClick={() => onJournal(true)}>
              委托板上有 {offered} 单可接
            </button>
          )}
        </div>
        {view.jobs.fixers.length > 0 && (
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
        )}
      </Panel>

      {view.deadlines.length > 0 && (
        <Panel as="div" title="期限" line="var(--cp-yellow)">
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
    </aside>
  );
}
