import { Fragment } from "react";
import type { AssetId } from "../../assets";
import { DIFFICULTY_LABELS } from "../../labels";
import { Asset } from "../../ui/Asset";
import { Bar } from "../../ui/Bar";
import { Panel } from "../../ui/Panel";
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

const WOUND_LABELS = { none: "", light: "轻伤", severe: "重伤", zero: "失去意识" } as const;

/** 顶部 HUD：左上生命和声望，右上地区、时间，正中是战斗进度 */
export function Hud({ view }: { readonly view: View }) {
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
        </div>
        <div className={styles.weapon} title={weapon ?? "空手"}>
          {weapon === null ? (
            <Asset id="weapon.fists" tint="var(--cp-cyan)" height={28} alt="空手" />
          ) : (
            <span className={styles.weaponName}>{weapon}</span>
          )}
        </div>
      </div>

      {combat.active && (
        <div className={styles.combat} role="status">
          <span className={styles.combatTitle}>
            交锋 {combat.active.moment}/{combat.active.moments}
          </span>
          <span className={styles.combatResults}>
            {Array.from({ length: combat.active.moments }, (_, i) => (
              <i
                // biome-ignore lint/suspicious/noArrayIndexKey: 第几次交锋就是格子的身份
                key={i}
                data-result={
                  combat.active?.results[i] ?? (i + 1 === combat.active?.moment ? "now" : "todo")
                }
              />
            ))}
          </span>
          <span className={styles.combatDefeat}>败局：{combat.active.defeat}</span>
          <span className={styles.combatEnemies}>
            {combat.active.enemies.map((e) => `${e.group}×${e.count}`).join("、")}
          </span>
          {combat.active.dyingMomentsLeft !== null && (
            <span className={styles.dying}>
              濒死：{combat.active.dyingMomentsLeft} 次交锋内要被救回
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
            {view.time.text} · {view.time.periodLabel}
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
}: {
  readonly view: View;
  /** 分配一个属性点；正在生成时不传，按钮不显示 */
  readonly onSpend?: ((attribute: Attribute) => void) | undefined;
}) {
  const { character, humanity, inventory } = view;
  const backpack = Object.entries(inventory.backpack);
  const itemName = (id: string) => view.names.items[id] ?? id;
  const openJobs = view.jobs.list.filter((job) => job.open);
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
        <dl className={styles.facts}>
          <dt>街头声望</dt>
          <dd title={character.credHalf ? "再得半级声望就升级" : undefined}>
            {character.streetCred} 级{character.credHalf && <small> · 半级</small>}
          </dd>
          <dt>人性</dt>
          <dd data-stage={humanity.stage}>
            {humanity.current}/{humanity.cap}
            <small> · {humanity.stageLabel}</small>
          </dd>
          <dt>欧元</dt>
          <dd>{view.money.eddies.toLocaleString("en-US")}</dd>
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
                <span className={styles.slotNum}>{n}</span>
                <span>{id === null ? "空" : itemName(id)}</span>
                {active && <small>手持</small>}
              </li>
            );
          })}
        </ol>
        <p className={styles.gearTitle}>背包</p>
        {backpack.length === 0 ? (
          <p className={styles.dim}>空的。</p>
        ) : (
          <ul className={styles.backpack}>
            {backpack.map(([id, count]) => (
              <li key={id}>
                <span>{itemName(id)}</span>
                {count > 1 && <b>×{count}</b>}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel as="div" title="义体" line="var(--cp-cyan)">
        {view.cyberware.length === 0 ? (
          <p className={styles.dim}>没装义体。</p>
        ) : (
          <ul className={styles.cyberList}>
            {view.cyberware.map((c) => (
              <li key={c.id} className={styles.cyberItem}>
                <span>{c.name}</span>
                <small className={styles.cyberSlot}>
                  {c.slotLabel}
                  {c.rarityLabel ? ` · ${c.rarityLabel}` : ""}
                </small>
                {c.ability && <p className={styles.cyberAbility}>{c.ability}</p>}
              </li>
            ))}
          </ul>
        )}
      </Panel>

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
                    <span className={styles.npcAffinity}>
                      好感 {npc.affinity > 0 ? "+" : ""}
                      {npc.affinity}
                    </span>
                  </summary>
                  <div className={styles.npcDetail}>
                    {npc.alias && <p>外号：{npc.alias}</p>}
                    <p>{npc.look}</p>
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
        {openJobs.length === 0 ? (
          <p className={styles.dim}>眼下没有接下的委托。</p>
        ) : (
          <ul className={styles.jobs}>
            {openJobs.map((job) => (
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
        {view.jobs.fixers.length > 0 && (
          <dl className={styles.facts}>
            {view.jobs.fixers.map((f) => (
              <Fragment key={f.id}>
                <dt>{f.name}</dt>
                <dd>
                  信任 {f.trust} · 最多 {f.maxRisk} 星
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
