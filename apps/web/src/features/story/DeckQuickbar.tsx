import { NineSlice } from "../../ui/Asset";
import { CellFrame } from "../../ui/FrameBox";
import styles from "./deck-quickbar.module.css";
import type { View } from "./view";

export type HackingView = NonNullable<View["hacking"]>;
export type HackProgram = HackingView["programs"][number];

/** 接入仓快捷栏里可点选的在场目标 */
export interface HackTarget {
  readonly key: string;
  readonly kind: "person" | "env";
  readonly name: string;
  readonly role?: string | undefined;
  readonly tone: "hostile" | "companion" | "present" | "env";
  readonly breached: boolean;
  readonly breachedVia?: string | null | undefined;
  readonly activeEffects?: readonly string[] | undefined;
  readonly netLabel?: string | null | undefined;
  readonly chromeSummary?: string | null | undefined;
}

function buildQuickhackDraft(deckName: string, target: HackTarget, program: HackProgram): string {
  return `启动${deckName}，对${target.name}上传「${program.name}」`;
}

function buildBreachDraft(deckName: string, target: HackTarget): string {
  if (target.kind === "env") {
    return `启动${deckName}，尝试破冰入侵${target.name}的局域内网`;
  }
  return `启动${deckName}，先对${target.name}发起破冰入侵，尝试捅穿其个人黑冰建立立足点`;
}

/**
 * 展开在输入框正下方的轻量切角栏：
 * 1. 点开接入仓按钮 → 仅列出在场目标；
 * 2. 点击角色/节点 → 再在下方显示该目标可用的快速破解与破冰入侵。
 */
export function DeckQuickbar({
  hacking,
  targets,
  selectedKey,
  onSelectTarget,
  onPickDraft,
  onOpenDeckTab,
  onClose,
}: {
  readonly hacking: HackingView;
  readonly targets: readonly HackTarget[];
  readonly selectedKey: string | null;
  readonly onSelectTarget: (key: string | null) => void;
  readonly onPickDraft: (text: string) => void;
  readonly onOpenDeckTab?: (() => void) | undefined;
  readonly onClose: () => void;
}) {
  const isBlackwall = hacking.blackwallCapable;
  const selected = targets.find((t) => t.key === selectedKey) ?? null;

  return (
    <section
      className={styles.popover}
      data-blackwall={isBlackwall || undefined}
      aria-label="网络接入仓快捷破解"
    >
      <CellFrame />

      <div className={styles.row}>
        <span className={styles.rowLabel}>目标</span>
        <div className={styles.list} role="listbox" aria-label="在场目标">
          {targets.map((target) => {
            const active = selected?.key === target.key;
            return (
              <button
                key={target.key}
                type="button"
                role="option"
                aria-selected={active}
                className={styles.btn}
                data-tone={target.tone}
                data-active={active || undefined}
                title={[
                  target.role,
                  target.netLabel ? `链路：${target.netLabel}` : null,
                  target.chromeSummary ? `义体：${target.chromeSummary}` : null,
                  target.breached ? "已破冰" : null,
                  target.activeEffects?.length
                    ? `生效中：${target.activeEffects.join("、")}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
                onClick={() => onSelectTarget(active ? null : target.key)}
              >
                <NineSlice id="tab.bg" tint="currentColor" slice={14} className={styles.btnBg} />
                <span className={styles.btnText}>{target.name}</span>
                {target.breached && <span className={styles.hint}>已破冰</span>}
              </button>
            );
          })}
        </div>

        <div className={styles.meta}>
          {hacking.traceAlert && (
            <span
              className={styles.traceAlert}
              title={`检测到反向追踪信号（${hacking.traceAlert.at}）：继续高调入侵可能暴露坐标或招致敌方黑客反制`}
            >
              反追踪 · {hacking.traceAlert.target}
            </span>
          )}
          <span
            className={styles.thermal}
            data-level={hacking.thermal.level}
            title={`神经热负荷：${hacking.thermal.label}（${hacking.thermal.heat}/${hacking.thermal.maxHeat}）`}
          >
            热 {hacking.thermal.heat}/{hacking.thermal.maxHeat}
          </span>
          {onOpenDeckTab && (
            <button
              type="button"
              className={styles.link}
              onClick={() => {
                onClose();
                onOpenDeckTab();
              }}
            >
              插槽 {hacking.programs.length}/{hacking.slots}
            </button>
          )}
          <button
            type="button"
            className={styles.closeBtn}
            aria-label="关闭接入仓快捷栏"
            title="关闭（Esc）"
            onClick={onClose}
          >
            ×
          </button>
        </div>
      </div>

      {selected && (
        <div className={styles.row} data-sub="">
          <span className={styles.rowLabel}>破解</span>
          {hacking.programs.length === 0 ? (
            <div className={styles.empty}>
              <span>热待命插槽为空</span>
              {onOpenDeckTab && (
                <button
                  type="button"
                  className={styles.link}
                  onClick={() => {
                    onClose();
                    onOpenDeckTab();
                  }}
                >
                  去接入仓插装芯片
                </button>
              )}
            </div>
          ) : (
            <div className={styles.list}>
              {!selected.breached && (
                <button
                  type="button"
                  className={styles.btn}
                  data-hack=""
                  data-breach=""
                  title={
                    selected.kind === "env"
                      ? "攻破现场局域网与监控节点"
                      : "捅穿个人黑冰建立立足点，解锁终极神经接管"
                  }
                  onClick={() => onPickDraft(buildBreachDraft(hacking.deckName, selected))}
                >
                  <NineSlice id="tab.bg" tint="currentColor" slice={14} className={styles.btnBg} />
                  <span className={styles.btnText}>破冰入侵</span>
                </button>
              )}

              {hacking.programs.map((prog) => {
                const envMismatch = selected.kind === "env" && prog.requiresFoothold;
                const needBreach = prog.requiresFoothold && !selected.breached;
                const unavailable = envMismatch || needBreach;
                const tooltip = envMismatch
                  ? "终极神经接管仅可对带神经总线的义体人目标发动"
                  : needBreach
                    ? "需先对该目标破冰建立立足点后才能发动"
                    : [
                        prog.effect,
                        prog.loadLabel ? `热负荷：${prog.loadLabel}` : null,
                        prog.targetRequirement ? `接口前提：${prog.targetRequirement}` : null,
                      ]
                        .filter(Boolean)
                        .join("\n");

                return (
                  <button
                    key={prog.id}
                    type="button"
                    className={styles.btn}
                    data-hack=""
                    data-ultimate={prog.requiresFoothold || undefined}
                    data-heavy={prog.load === "heavy" || undefined}
                    disabled={unavailable}
                    title={tooltip}
                    onClick={() =>
                      onPickDraft(buildQuickhackDraft(hacking.deckName, selected, prog))
                    }
                  >
                    <NineSlice
                      id="tab.bg"
                      tint="currentColor"
                      slice={14}
                      className={styles.btnBg}
                    />
                    <span className={styles.btnText}>{prog.name}</span>
                    {needBreach && <span className={styles.hint}>需破冰</span>}
                    {!needBreach && prog.load === "extreme" && (
                      <span className={styles.hint}>极热</span>
                    )}
                    {!needBreach && prog.load === "heavy" && (
                      <span className={styles.hint}>高热</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
