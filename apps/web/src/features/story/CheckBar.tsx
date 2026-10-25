import { useState } from "react";
import { Asset, NineSlice } from "../../ui/Asset";
import { Button } from "../../ui/Button";
import { HoldButton } from "../../ui/HoldButton";
import { BreachMatrix } from "./BreachMatrix";
import styles from "./story.module.css";
import { type CheckOffer, DAMAGE, signed } from "./view";

type Capped = CheckOffer["bonuses"];

function Sources({
  title,
  total,
  sign,
}: {
  readonly title: string;
  readonly total: Capped;
  readonly sign: 1 | -1;
}) {
  if (total.items.length === 0) return null;
  const capped = total.raw !== total.total;
  return (
    <div className={styles.sources}>
      <span className={styles.sourcesTitle}>
        {title} {signed(sign * total.total)}
        {capped && <em className={styles.capped}>已封顶（原 {signed(sign * total.raw)}）</em>}
      </span>
      <ul>
        {total.items.map((m, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: 修正来源可能同名，按叙事模型给的顺序排
          <li key={`${m.source}-${i}`}>
            <b>{signed(sign * m.value)}</b> {m.source}：{m.reason}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 检定确认栏：掷骰前把数字和后果都摆出来，长按才掷 */
export function CheckBar({
  check,
  busy,
  closable,
  matrix = false,
  onConfirm,
  onRewrite,
  onClose,
}: {
  readonly check: CheckOffer;
  readonly busy: boolean;
  readonly closable: boolean;
  /** 设置里开了矩阵小游戏、装着接入仓、又是智力检定时为 true */
  readonly matrix?: boolean;
  /** 玩过矩阵小游戏时带上解开了几段 */
  readonly onConfirm: (matrix?: number) => void;
  readonly onRewrite: () => void;
  readonly onClose: () => void;
}) {
  const [solved, setSolved] = useState<number | null>(null);
  const damage = check.damage ? DAMAGE[check.damage] : null;
  const dvParts = [
    `基础 ${check.baseDv}`,
    check.dvMods.total !== 0 ? `修正 ${signed(check.dvMods.total)}` : null,
    check.modeDv !== 0 ? `难度模式 ${signed(check.modeDv)}` : null,
  ].filter((p) => p !== null);

  return (
    <section className={styles.check} aria-label={`检定：${check.label}`}>
      <NineSlice id="notify.itemCellBg" tint="var(--cp-panel)" slice={30} />
      <NineSlice id="notify.itemCellFg" tint="var(--cp-yellow)" slice={30} />
      <header className={styles.checkHead}>
        <Asset id="skillcheck.default" tint="var(--cp-yellow)" height={28} />
        <h2>{check.label}</h2>
        <span className={styles.chance} title="按当前属性和修正算出的成功率">
          {check.chance}%
        </span>
      </header>

      <div className={styles.checkNumbers}>
        <div>
          <small>检定值</small>
          <b>{check.modifier}</b>
          <span>
            {check.attributeLabel} {check.attributeValue}
            {check.bonuses.total !== 0 && ` ${signed(check.bonuses.total)}`}
            {check.penalties.total !== 0 && ` ${signed(-check.penalties.total)}`}
          </span>
        </div>
        <div className={styles.vs}>对</div>
        <div>
          <small>难度值</small>
          <b>{check.dv}</b>
          <span>
            {check.tierLabel} · {dvParts.join(" ")}
          </span>
        </div>
      </div>

      <Sources title="加成" total={check.bonuses} sign={1} />
      <Sources title="减值" total={check.penalties} sign={-1} />
      <Sources title="难度修正" total={check.dvMods} sign={1} />

      {matrix && !check.rolled && <BreachMatrix onDone={setSolved} />}

      <div className={styles.stakes}>
        <p data-tone="good">
          <small>成功</small>
          {check.success}
        </p>
        <p data-tone="bad">
          <small>失败</small>
          {check.failure}
          {damage && (
            <span className={styles.damage}>
              <Asset id={damage.icon} tint="var(--cp-danger)" height={18} />
              最多{damage.label}
            </span>
          )}
        </p>
      </div>

      <footer className={styles.checkActions}>
        <HoldButton
          rolled={check.rolled}
          disabled={busy}
          {...(busy ? { reason: "正在生成" } : {})}
          onConfirm={() => onConfirm(solved ?? undefined)}
        />
        {!check.rolled && (
          <Button onClick={onRewrite} disabled={busy}>
            改写
          </Button>
        )}
        {closable && (
          <Button keyId="key.esc" onClick={onClose} disabled={busy}>
            放弃
          </Button>
        )}
      </footer>
      {check.rolled && (
        <p className={styles.dim}>骰子已经掷过并记下了，继续只会写出结果，不会重掷。</p>
      )}
    </section>
  );
}
