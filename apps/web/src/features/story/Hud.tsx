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

const WOUND_LABELS = { none: "", light: "轻伤", severe: "重伤", zero: "失去意识" } as const;

/** 顶部 HUD：左上生命和声望，右上地区、时间，正中是战斗进度 */
export function Hud({ view }: { readonly view: View }) {
  const { health, character, combat } = view;
  const low = health.wound === "severe" || health.wound === "zero";
  const wound = WOUND_LABELS[health.wound];
  const weapon =
    view.inventory.active === null ? null : (view.inventory.weapons[view.inventory.active] ?? null);

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
          <span className={styles.zoneName}>{locationLabel(view.location)}</span>
          <span className={styles.zoneTime}>
            {view.time.text} · {view.time.periodLabel}
          </span>
        </div>
        <Asset id={districtIcon(view.location)} tint="var(--cp-yellow)" height={40} />
      </div>
    </header>
  );
}

/** 左侧角色栏：建档前显示“未建档” */
export function SidePanel({ view }: { readonly view: View }) {
  const { character, humanity, inventory } = view;
  return (
    <aside className={styles.side}>
      <Panel as="div" title={character.name ?? "未建档"}>
        {character.name === null && (
          <p className={styles.dim}>下一阶段加入角色卡；现在用的是占位角色。</p>
        )}
        <ul className={styles.attrs}>
          {ATTRS.map(([key, label, icon]) => (
            <li key={key}>
              <Asset id={icon} tint="var(--cp-cyan)" height={22} />
              <span>{label}</span>
              <b>{character.attributes[key] ?? "—"}</b>
            </li>
          ))}
        </ul>
        <dl className={styles.facts}>
          <dt>街头声望</dt>
          <dd>{character.streetCred} 级</dd>
          <dt>人性</dt>
          <dd data-stage={humanity.stage}>
            {humanity.current}/{humanity.cap}
            <small> · {humanity.stageLabel}</small>
          </dd>
          <dt>难度</dt>
          <dd>{DIFFICULTY_LABELS[view.difficulty]}</dd>
          {inventory.healing && (
            <>
              <dt>治疗</dt>
              <dd>
                {inventory.healing.id} {inventory.healing.charges}/{inventory.healing.max}
              </dd>
            </>
          )}
          {inventory.grenade && (
            <>
              <dt>手雷</dt>
              <dd>
                {inventory.grenade.id} {inventory.grenade.charges}/{inventory.grenade.max}
              </dd>
            </>
          )}
        </dl>
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
