import type { PlayerAction } from "@cp/core";
import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "../../ui/Button";
import { CellFrame } from "../../ui/FrameBox";
import { useLayer } from "../../ui/layers";
import { Panel } from "../../ui/Panel";
import styles from "./deck-slots.module.css";
import type { View } from "./view";

export type DeckLoadAction = Extract<PlayerAction, { readonly type: "deckLoad" }>;

function loadTone(load: string | null): "bad" | "warn" | undefined {
  if (load === "extreme") return "bad";
  if (load === "heavy") return "warn";
  return undefined;
}

/** 网络接入仓存储插槽管理器：脱战且未潜网时，直接点选拔插热待命程序芯片与随身芯片盒。 */
export function DeckSlotsModal({
  view,
  onDeckLoad,
  busy = false,
  onClose,
}: {
  readonly view: View;
  readonly onDeckLoad?: ((action: DeckLoadAction) => Promise<void>) | undefined;
  readonly busy?: boolean | undefined;
  readonly onClose: () => void;
}) {
  const { hacking, combat } = view;
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [replacingId, setReplacingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);
  const dialog = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  const close = () => {
    if (!running.current) onClose();
  };

  useLayer(() => {
    if (running.current) return;
    if (replacingId !== null) {
      setReplacingId(null);
      return;
    }
    onClose();
  });

  useEffect(() => {
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButton.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);

  if (!hacking) return null;

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
  const emptySlotNumbers = Array.from(
    { length: Math.max(0, hacking.slots - hacking.programs.length) },
    (_, offset) => hacking.programs.length + offset + 1,
  );
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

  const keepFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab") return;
    const controls = Array.from(
      dialog.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), summary, [href], [tabindex="0"]',
      ) ?? [],
    ).filter((element) => element.getClientRects().length > 0);
    const first = controls[0];
    const last = controls.at(-1);
    if (!first || !last) {
      event.preventDefault();
      dialog.current?.focus();
      return;
    }
    if (
      event.shiftKey &&
      (document.activeElement === first ||
        !controls.includes(document.activeElement as HTMLElement))
    ) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div className={styles.backdrop}>
      <button
        type="button"
        className={styles.scrim}
        aria-label="关闭存储插槽管理"
        disabled={pendingId !== null}
        onClick={close}
      />
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={styles.dialog}
        onKeyDown={keepFocus}
      >
        <Panel className={styles.frame} line="var(--cp-cyan)" as="div" frame>
          <div className={styles.shell}>
            <header className={styles.header}>
              <div className={styles.brand}>
                <span className={styles.eyebrow}>CYBERDECK {"//"} STORAGE SLOTS</span>
                <h2 id={titleId} className={styles.title}>
                  <span>{hacking.deckName}</span>
                  <span className={styles.slotCounter}>
                    存储插槽 {hacking.programs.length}/{hacking.slots}
                  </span>
                </h2>
                {hacking.profile && <p className={styles.profile}>{hacking.profile}</p>}
              </div>
              <button
                ref={closeButton}
                type="button"
                className={styles.close}
                disabled={pendingId !== null}
                onClick={close}
              >
                关闭
              </button>
            </header>

            <div className={styles.body}>
              <div className={styles.statusStrip}>
                <span className={styles.statusItem}>
                  <span className={styles.statusKey}>神经热负荷</span>
                  <span
                    className={styles.statusVal}
                    data-tone={
                      hacking.thermal.level === "critical"
                        ? "bad"
                        : hacking.thermal.level === "hot"
                          ? "warn"
                          : undefined
                    }
                  >
                    {hacking.thermal.label}（{hacking.thermal.heat}/{hacking.thermal.maxHeat}）
                  </span>
                </span>
                <span className={styles.statusItem}>
                  <span className={styles.statusKey}>硬件特化</span>
                  <span className={styles.statusVal}>
                    {[...hacking.traitLabels, ...(hacking.selfIce ? ["自我 ICE"] : [])].join(
                      " · ",
                    ) || "标准民用总线"}
                  </span>
                </span>
                <span className={styles.statusItem}>
                  <span className={styles.statusKey}>随身芯片盒</span>
                  <span className={styles.statusVal}>{hacking.sparePrograms.length} 张备用</span>
                </span>
              </div>

              {lockReason && <div className={styles.lockBanner}>{lockReason}</div>}
              {error && (
                <div className={styles.errorBanner} role="alert">
                  {error}
                </div>
              )}

              <section className={styles.section} aria-label="热待命存储插槽">
                <div className={styles.sectionHead}>
                  <h3 className={styles.sectionTitle}>
                    热待命存储插槽（{hacking.programs.length}/{hacking.slots}）
                  </h3>
                  <span className={styles.sectionHint}>
                    接入仓硬件编译容量上限；实战仅可直接调用当前插在槽位里的程序
                  </span>
                </div>
                <div className={styles.grid}>
                  {hacking.programs.map((prog) => (
                    <article key={prog.id} className={styles.card}>
                      <CellFrame />
                      <div className={styles.cardHead}>
                        <strong className={styles.cardName}>{prog.name}</strong>
                        <div className={styles.tags}>
                          {prog.categoryLabel && (
                            <span className={styles.tag}>{prog.categoryLabel}</span>
                          )}
                          {prog.loadLabel && (
                            <span className={styles.tag} data-tone={loadTone(prog.load)}>
                              {prog.loadLabel}
                            </span>
                          )}
                          {prog.requiresFoothold && (
                            <span className={styles.tag} data-tone="bad">
                              需先破冰
                            </span>
                          )}
                        </div>
                      </div>
                      {prog.effect && <p className={styles.effect}>{prog.effect}</p>}
                      {prog.targetRequirement && (
                        <p className={styles.req}>接口前提：{prog.targetRequirement}</p>
                      )}
                      <div className={styles.cardFoot}>
                        <Button
                          small
                          disabled={locked}
                          reason={lockReason ?? "正在同步芯片槽位"}
                          onClick={() =>
                            void runAction({
                              type: "deckLoad",
                              action: "unslot",
                              program: prog.id,
                            })
                          }
                        >
                          {pendingId === prog.id ? "拔出中…" : "拔下"}
                        </Button>
                      </div>
                    </article>
                  ))}
                  {emptySlotNumbers.map((slotNum) => (
                    <div key={`empty-slot-${slotNum}`} className={styles.cardEmpty}>
                      空闲存储插槽 #{slotNum}
                    </div>
                  ))}
                </div>
              </section>

              <section className={styles.section} aria-label="随身芯片盒">
                <div className={styles.sectionHead}>
                  <h3 className={styles.sectionTitle}>
                    随身芯片盒（{hacking.sparePrograms.length} 张备用）
                  </h3>
                  <span className={styles.sectionHint}>
                    可在黑客铺子、歌舞伎芯片小铺或扭扭街暗巷黑市购入更多非终极程序芯片
                  </span>
                </div>
                {hacking.sparePrograms.length === 0 ? (
                  <div className={styles.emptyBox}>
                    芯片盒里暂时没有备用芯片。从上方拔下的芯片会收进这里，在黑客铺子或暗巷黑市购入、或战场搜刮拷贝的新芯片也会先存进此处。
                  </div>
                ) : (
                  <div className={styles.grid}>
                    {hacking.sparePrograms.map((prog) => {
                      const pickingReplace = replacingId === prog.id;
                      return (
                        <article key={prog.id} className={styles.card}>
                          <CellFrame />
                          <div className={styles.cardHead}>
                            <strong className={styles.cardName}>{prog.name}</strong>
                            <div className={styles.tags}>
                              {prog.categoryLabel && (
                                <span className={styles.tag}>{prog.categoryLabel}</span>
                              )}
                              {prog.loadLabel && (
                                <span className={styles.tag} data-tone={loadTone(prog.load)}>
                                  {prog.loadLabel}
                                </span>
                              )}
                              {prog.requiresFoothold && (
                                <span className={styles.tag} data-tone="bad">
                                  需先破冰
                                </span>
                              )}
                            </div>
                          </div>
                          {prog.effect && <p className={styles.effect}>{prog.effect}</p>}
                          {prog.targetRequirement && (
                            <p className={styles.req}>接口前提：{prog.targetRequirement}</p>
                          )}
                          <div className={styles.cardFoot}>
                            {slotsFull ? (
                              <Button
                                small
                                primary={pickingReplace}
                                disabled={locked}
                                reason={lockReason ?? "正在同步芯片槽位"}
                                onClick={() => setReplacingId(pickingReplace ? null : prog.id)}
                              >
                                {pickingReplace ? "取消替换" : "替换插槽…"}
                              </Button>
                            ) : (
                              <Button
                                small
                                primary
                                disabled={locked}
                                reason={lockReason ?? "正在同步芯片槽位"}
                                onClick={() =>
                                  void runAction({
                                    type: "deckLoad",
                                    action: "slot",
                                    program: prog.id,
                                  })
                                }
                              >
                                {pendingId === prog.id ? "插装中…" : "插装进槽"}
                              </Button>
                            )}
                          </div>
                          {pickingReplace && slotsFull && (
                            <div className={styles.replacePanel}>
                              <span className={styles.replaceLabel}>
                                选择要拔下退回芯片盒的已插装程序：
                              </span>
                              <div className={styles.replaceOptions}>
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
                                    换下「{loaded.name}」
                                  </Button>
                                ))}
                              </div>
                            </div>
                          )}
                        </article>
                      );
                    })}
                  </div>
                )}
              </section>
            </div>

            <footer className={styles.footer}>
              <span>更换更低槽位接入仓时，多出的芯片会自动安全退回随身芯片盒。</span>
              <span>终极神经接管芯片不在常规市面公开零售。</span>
            </footer>
          </div>
        </Panel>
      </div>
    </div>,
    document.body,
  );
}
