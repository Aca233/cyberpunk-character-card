import type { PlayerAction } from "@cp/core";
import { useRef, useState } from "react";
import { Asset, cssUrl, NineSlice } from "../../ui/Asset";
import { Button } from "../../ui/Button";
import { CellFrame } from "../../ui/FrameBox";
import { itemArtOf } from "./art";
import { CYBER_SLOT_ICON } from "./cyberwareMeta";
import styles from "./deck-page.module.css";
import type { View } from "./view";

export type DeckLoadAction = Extract<PlayerAction, { readonly type: "deckLoad" }>;

const QH_SLICE = [18, 22, 22, 18] as const;

function loadTone(load: string | null): "bad" | "warn" | undefined {
  if (load === "extreme") return "bad";
  if (load === "heavy") return "warn";
  return undefined;
}

function thermalCellTone(
  step: number,
  heat: number,
  level: string,
): "warm" | "hot" | "critical" | "empty" {
  if (step > heat) return "empty";
  if (level === "critical" || step >= 5) return "critical";
  if (step >= 3) return "hot";
  return "warm";
}

/** 2077 接入仓插槽/芯片卡原生双层切角底框（qh.cellBg / qh.cellFg） */
function QuickhackCellFrame({
  tone = "default",
}: {
  readonly tone?: "default" | "ultimate" | "empty";
}) {
  const fill =
    tone === "ultimate"
      ? "rgb(36 9 16 / 84%)"
      : tone === "empty"
        ? "rgb(14 14 23 / 30%)"
        : "rgb(14 16 26 / 74%)";
  const line =
    tone === "ultimate"
      ? "rgb(255 0 60 / 50%)"
      : tone === "empty"
        ? "rgb(255 97 88 / 24%)"
        : "rgb(94 246 255 / 26%)";
  return (
    <>
      <NineSlice id="qh.cellBg" tint={fill} slice={QH_SLICE} className={styles.cellFrame} />
      <NineSlice id="qh.cellFg" tint={line} slice={QH_SLICE} className={styles.cellFrame} />
    </>
  );
}

/** 左上角生物监测「接入仓」页签：严格沿用 BiomonitorPanel 的红框诊断卡语言与 620px 宽度 */
export function CyberdeckPage({
  view,
  onDeckLoad,
  busy = false,
}: {
  readonly view: View;
  readonly onDeckLoad?: ((action: DeckLoadAction) => Promise<void>) | undefined;
  readonly onActionDraft?: ((text: string) => void) | undefined;
  readonly busy?: boolean | undefined;
}) {
  const { hacking, combat } = view;
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [replacingId, setReplacingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);

  if (!hacking) {
    return (
      <div className={styles.emptyDeck}>
        <p>当前未安装完好的网络接入仓。可前往义体医生处加装，或在义体页检查是否已损毁。</p>
      </div>
    );
  }

  const isBlackwall = hacking.blackwallCapable;
  const installedDeck = view.cyberware.find((c) => c.id === hacking.deck);
  const deckArt = itemArtOf(hacking.deck);
  const lockReason = combat.active
    ? "交火中无法腾手拆换接入仓程序芯片，脱战后再插拔。"
    : hacking.dive !== null
      ? "潜网连接维持中禁止热插拔存储插槽，先退回肉身再换槽。"
      : view.death || view.ended
        ? "这份存档已结束，仅可查看芯片配置。"
        : !onDeckLoad
          ? "当前无法执行插拔操作。"
          : null;

  const slotsFull = hacking.programs.length >= hacking.slots;
  const emptySlots = Math.max(0, hacking.slots - hacking.programs.length);
  const thermalSteps = Array.from({ length: hacking.thermal.maxHeat }, (_, idx) => idx + 1);
  const locked = lockReason !== null || busy || pendingId !== null;

  const runAction = async (action: DeckLoadAction) => {
    if (!onDeckLoad || locked || running.current) return;
    running.current = true;
    setPendingId(action.program);
    setError(null);
    try {
      await onDeckLoad(action);
      setReplacingId(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "芯片插拔未生效，请稍后重试");
    } finally {
      running.current = false;
      setPendingId(null);
    }
  };

  const breachedTargetSet = new Set(hacking.breachedTargets.map((b) => b.target));
  const visibleEffects = hacking.activeEffects.filter(
    (e) =>
      !(
        breachedTargetSet.has(e.target) &&
        e.categoryLabel === null &&
        /破冰|breach/i.test(e.label)
      ),
  );
  const traceClock = hacking.traceAlert
    ? (hacking.traceAlert.at.split(" ").pop() ?? hacking.traceAlert.at)
    : null;
  const hasFieldIntel =
    Boolean(hacking.traceAlert) ||
    hacking.breachedTargets.length > 0 ||
    visibleEffects.length > 0 ||
    hacking.breaches.length > 0;

  return (
    <div className={styles.root} data-blackwall={isBlackwall || undefined}>
      {/* 顶栏：硬件型号、义体实图、特性与 6 格神经热负荷 */}
      <header className={styles.hero}>
        <CellFrame />
        <div
          className={styles.heroGridBg}
          style={{ backgroundImage: cssUrl("fx.grid") }}
          aria-hidden="true"
        />
        <div className={styles.heroTop}>
          <div className={styles.deckVisual} aria-hidden="true">
            <NineSlice
              id="map.filterCellBg"
              tint={isBlackwall ? "rgb(30 8 15 / 92%)" : "rgb(14 16 26 / 90%)"}
              slice={[20, 30, 30, 20]}
              className={styles.deckFrame}
            />
            <NineSlice
              id="cyber.cellTexture"
              tint={isBlackwall ? "rgb(255 0 60 / 34%)" : "rgb(214 160 40 / 40%)"}
              slice={0}
              className={styles.deckFrame}
            />
            <NineSlice
              id="map.filterCellFg"
              tint={isBlackwall ? "var(--cp-danger)" : "rgb(94 246 255 / 58%)"}
              slice={[20, 30, 30, 20]}
              className={styles.deckFrame}
            />
            {deckArt ? (
              <Asset id={deckArt} alt={hacking.deckName} className={styles.deckArt} />
            ) : (
              <Asset
                id={CYBER_SLOT_ICON[installedDeck?.slot ?? "os"]}
                height={50}
                tint={isBlackwall ? "var(--cp-danger)" : "var(--cp-cyan)"}
              />
            )}
          </div>
          <div className={styles.heroBody}>
            <div className={styles.heroKicker}>
              <span className={styles.kickerCode}>CYBERDECK {"//"} 神经接入仓</span>
              {isBlackwall && <span className={styles.blackwallPill}>BLACKWALL</span>}
            </div>
            <div className={styles.titleRow}>
              <h2 className={styles.title}>{hacking.deckName}</h2>
              <span className={styles.slotBadge}>
                {hacking.programs.length}/{hacking.slots} 槽
              </span>
            </div>
            {hacking.profile && <p className={styles.profile}>{hacking.profile}</p>}
            <div className={styles.traits}>
              {hacking.traitLabels.map((label) => (
                <span key={label} className={styles.traitChip}>
                  {label}
                </span>
              ))}
              {hacking.selfIce && <span className={styles.traitChip}>自我 ICE</span>}
              {hacking.traitLabels.length === 0 && !hacking.selfIce && (
                <span className={styles.traitChip}>标准总线</span>
              )}
            </div>
          </div>
        </div>

        <div className={styles.thermalPanel}>
          <div className={styles.thermalHead}>
            <span className={styles.thermalLabel}>THERMAL {"//"} 神经热负荷</span>
            <span className={styles.thermalValue} data-level={hacking.thermal.level}>
              {hacking.thermal.label} · {hacking.thermal.heat}/{hacking.thermal.maxHeat}
            </span>
          </div>
          <div className={styles.thermalCells} aria-hidden="true">
            {thermalSteps.map((step) => (
              <span
                key={`heat-${step}`}
                className={styles.thermalCell}
                data-state={thermalCellTone(step, hacking.thermal.heat, hacking.thermal.level)}
              />
            ))}
          </div>
          <p className={styles.thermalHint}>
            {hacking.thermal.level === "critical"
              ? "过载临界：继续硬发破解会直接反烧大脑与义体，须立刻停手散热或接入冷却椅。"
              : hacking.thermal.level === "hot"
                ? "芯片发烫：硬塞高负载或终极程序会冲进过载临界；随时间流逝或冷却椅自动降温。"
                : "散热正常：终极神经接管须先对目标破冰建立立足点，且会瞬间飙升热负荷。"}
          </p>
        </div>
      </header>

      {lockReason && <div className={styles.lockBanner}>{lockReason}</div>}
      {error && (
        <div className={styles.errorBanner} role="alert">
          {error}
        </div>
      )}

      {/* 当前场景电子战态势 */}
      {hasFieldIntel && (
        <section className={styles.card} aria-label="当前场景电子战态势">
          <CellFrame />
          <div className={styles.cardHead}>
            <span className={styles.cardLabel}>FIELD {"//"} 场景电子战态势</span>
          </div>
          <div className={styles.subRows}>
            {hacking.traceAlert && (
              <div className={styles.subRow}>
                <span className={styles.subKey}>反向追踪警报</span>
                <span
                  className={styles.subVal}
                  data-tone="bad"
                  title={`检测时间：${hacking.traceAlert.at}`}
                >
                  {hacking.traceAlert.target}
                  {traceClock ? ` · ${traceClock}` : ""}
                </span>
              </div>
            )}
            {hacking.breachedTargets.length > 0 && (
              <div className={styles.subRow}>
                <span className={styles.subKey}>已破个人黑冰</span>
                <span className={styles.subVal} data-tone="cyan">
                  {hacking.breachedTargets
                    .map((b) => `${b.target}${b.via ? `（经${b.via}）` : ""}`)
                    .join(" · ")}
                </span>
              </div>
            )}
            {visibleEffects.length > 0 && (
              <div className={styles.subRow}>
                <span className={styles.subKey}>生效中的破解</span>
                <span className={styles.subVal} data-tone="cyan">
                  {visibleEffects
                    .slice(-4)
                    .map((e) => `${e.label}→${e.target}`)
                    .join(" / ")}
                </span>
              </div>
            )}
            {hacking.breaches.length > 0 && (
              <div className={styles.subRow}>
                <span className={styles.subKey}>已攻破局域内网</span>
                <span className={styles.subVal} data-tone="cyan">
                  {hacking.breaches.map((b) => `${b.name}（${b.gains.join("/")}）`).join(" · ")}
                </span>
              </div>
            )}
          </div>
        </section>
      )}

      {/* 热待命存储插槽（双列） */}
      <section className={styles.card} aria-label="热待命存储插槽">
        <CellFrame />
        <div className={styles.cardHead}>
          <span className={styles.cardLabel}>SLOTS {"//"} 热待命存储插槽</span>
          <span className={styles.cardValue}>
            {hacking.programs.length}/{hacking.slots}
          </span>
        </div>
        <div className={styles.progGrid}>
          {hacking.programs.map((prog, index) => (
            <div
              key={prog.id}
              className={styles.progCell}
              data-ultimate={prog.requiresFoothold || undefined}
              title={
                [prog.effect, prog.targetRequirement ? `接口前提：${prog.targetRequirement}` : null]
                  .filter(Boolean)
                  .join("\n") || undefined
              }
            >
              <QuickhackCellFrame tone={prog.requiresFoothold ? "ultimate" : "default"} />
              <div className={styles.progTop}>
                <span className={styles.progIdent}>
                  <span className={styles.slotIndex}>0{index + 1}</span>
                  <strong className={styles.progName}>{prog.name}</strong>
                </span>
                <button
                  type="button"
                  className={styles.slotAction}
                  disabled={locked}
                  title={lockReason ?? `拔下「${prog.name}」放回芯片盒`}
                  onClick={() =>
                    void runAction({
                      type: "deckLoad",
                      action: "unslot",
                      program: prog.id,
                    })
                  }
                >
                  <NineSlice
                    id="tab.bg"
                    tint="currentColor"
                    slice={14}
                    className={styles.actionBg}
                  />
                  <span>{pendingId === prog.id ? "…" : "拔下"}</span>
                </button>
              </div>
              <div className={styles.progMeta}>
                {prog.categoryLabel && (
                  <span className={styles.metaItem}>{prog.categoryLabel}</span>
                )}
                {prog.loadLabel && (
                  <span className={styles.metaItem} data-tone={loadTone(prog.load)}>
                    {prog.loadLabel}
                  </span>
                )}
                {prog.requiresFoothold && (
                  <span className={styles.metaItem} data-tone="bad">
                    需破冰
                  </span>
                )}
              </div>
              {prog.effect && <p className={styles.progDesc}>{prog.effect}</p>}
              {prog.targetRequirement && (
                <p className={styles.progReq}>接口：{prog.targetRequirement}</p>
              )}
            </div>
          ))}
          {Array.from({ length: emptySlots }, (_, idx) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: 空插槽按序号占位
              key={`empty-${idx}`}
              className={styles.emptySlotCell}
            >
              <QuickhackCellFrame tone="empty" />
              <span className={styles.slotIndex}>0{hacking.programs.length + idx + 1}</span>
              <span>空闲插槽</span>
            </div>
          ))}
        </div>
      </section>

      {/* 随身芯片盒（双列） */}
      <section className={styles.card} aria-label="随身芯片盒">
        <CellFrame />
        <div className={styles.cardHead}>
          <span className={styles.cardLabel}>CASE {"//"} 随身芯片盒</span>
          <span className={styles.cardValue}>{hacking.sparePrograms.length} 张备用</span>
        </div>
        {hacking.sparePrograms.length === 0 ? (
          <p className={styles.emptyCopy}>
            芯片盒暂无备用芯片。拔下的芯片会存进此处；黑客铺子、歌舞伎芯片小铺与暗巷黑市有售非终极芯片，终极芯片须靠搜刮或秘渠获取。
          </p>
        ) : (
          <div className={styles.progGrid}>
            {hacking.sparePrograms.map((prog) => {
              const pickingReplace = replacingId === prog.id;
              return (
                <div
                  key={prog.id}
                  className={styles.progCell}
                  data-ultimate={prog.requiresFoothold || undefined}
                  data-wide={pickingReplace ? "" : undefined}
                  title={
                    [
                      prog.effect,
                      prog.targetRequirement ? `接口前提：${prog.targetRequirement}` : null,
                    ]
                      .filter(Boolean)
                      .join("\n") || undefined
                  }
                >
                  <QuickhackCellFrame tone={prog.requiresFoothold ? "ultimate" : "default"} />
                  <div className={styles.progTop}>
                    <span className={styles.progIdent}>
                      <strong className={styles.progName}>{prog.name}</strong>
                    </span>
                    {slotsFull ? (
                      <button
                        type="button"
                        className={styles.slotAction}
                        data-primary={pickingReplace || undefined}
                        disabled={locked}
                        title={lockReason ?? "替换已插装的程序芯片"}
                        onClick={() => setReplacingId(pickingReplace ? null : prog.id)}
                      >
                        <NineSlice
                          id="tab.bg"
                          tint="currentColor"
                          slice={14}
                          className={styles.actionBg}
                        />
                        <span>{pickingReplace ? "取消" : "替换"}</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        className={styles.slotAction}
                        data-primary=""
                        disabled={locked}
                        title={lockReason ?? `将「${prog.name}」插装进空闲槽位`}
                        onClick={() =>
                          void runAction({
                            type: "deckLoad",
                            action: "slot",
                            program: prog.id,
                          })
                        }
                      >
                        <NineSlice
                          id="tab.bg"
                          tint="currentColor"
                          slice={14}
                          className={styles.actionBg}
                        />
                        <span>{pendingId === prog.id ? "…" : "插装"}</span>
                      </button>
                    )}
                  </div>
                  <div className={styles.progMeta}>
                    {prog.categoryLabel && (
                      <span className={styles.metaItem}>{prog.categoryLabel}</span>
                    )}
                    {prog.loadLabel && (
                      <span className={styles.metaItem} data-tone={loadTone(prog.load)}>
                        {prog.loadLabel}
                      </span>
                    )}
                    {prog.requiresFoothold && (
                      <span className={styles.metaItem} data-tone="bad">
                        需破冰
                      </span>
                    )}
                  </div>
                  {prog.effect && <p className={styles.progDesc}>{prog.effect}</p>}
                  {prog.targetRequirement && (
                    <p className={styles.progReq}>接口：{prog.targetRequirement}</p>
                  )}
                  {pickingReplace && slotsFull && (
                    <div className={styles.replaceBar}>
                      <span className={styles.replaceLabel}>换下：</span>
                      {hacking.programs.map((loaded) => (
                        <Button
                          key={loaded.id}
                          small
                          disabled={locked}
                          reason={lockReason ?? "正在同步芯片槽位"}
                          onClick={() =>
                            void runAction({
                              type: "deckLoad",
                              action: "slot",
                              program: prog.id,
                              replace: loaded.id,
                            })
                          }
                        >
                          {loaded.name}
                        </Button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
