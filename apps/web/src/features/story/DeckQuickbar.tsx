import { useEffect } from "react";
import { Asset, cssUrl, NineSlice } from "../../ui/Asset";
import { ITEM_CELL_SLICE } from "../../ui/Panel";
import styles from "./deck-quickbar.module.css";
import type { View } from "./view";

export type HackingView = NonNullable<View["hacking"]>;
export type HackProgram = HackingView["programs"][number];

const QH_SLICE = [18, 22, 22, 18] as const;

/** 接入仓快捷栏里可点选的在场目标 */
export interface HackTarget {
  readonly key: string;
  readonly npcId?: string | undefined;
  readonly kind: "person" | "env";
  readonly name: string;
  readonly role?: string | undefined;
  readonly tone: "hostile" | "companion" | "present" | "env";
  readonly breached: boolean;
  readonly breachedVia?: string | null | undefined;
  readonly activeEffects?: readonly string[] | undefined;
  readonly netStatus?: "unchromed" | "open" | "selfIce" | "netrunner" | null | undefined;
  readonly netLabel?: string | null | undefined;
  readonly chromeSummary?: string | null | undefined;
}

const PERSON_ONLY_PROGRAM_IDS = new Set([
  "sonic-shock",
  "memory-wipe",
  "reboot-optics",
  "cripple-movement",
  "weapon-glitch",
  "overheat",
  "contagion",
  "cyberpsychosis",
  "suicide",
  "system-collapse",
]);

const ENV_COMPATIBLE_PROGRAM_IDS = new Set(["ping", "short-circuit"]);
const ENV_TEXT_HINT = /局域网|子网|终端|监控|摄像头|无人机|炮塔|门禁|设备|网络节点/;

function isProgramUsableOnEnv(prog: HackProgram): boolean {
  if (prog.requiresFoothold || prog.category === "ultimate") return false;
  if (PERSON_ONLY_PROGRAM_IDS.has(prog.id)) return false;
  if (ENV_COMPATIBLE_PROGRAM_IDS.has(prog.id)) return true;
  const text = `${prog.targetRequirement ?? ""} ${prog.effect ?? ""}`;
  return ENV_TEXT_HINT.test(text);
}

/** 仅当目标确实存在黑冰/局域内网防火墙且尚未破冰时，才显示「破冰入侵」 */
function canShowBreachAction(target: HackTarget): boolean {
  if (target.breached) return false;
  if (target.kind === "env") return true;
  return target.netStatus === "selfIce" || target.netStatus === "netrunner";
}

function buildEnvControlDraft(deckName: string, target: HackTarget): string {
  return `利用${deckName}已攻破的${target.name}内网权限，接管现场监控视野并尝试干扰安防炮塔或解锁门禁`;
}

const TARGET_TONE_LABEL: Readonly<Record<HackTarget["tone"], string>> = {
  hostile: "敌对",
  companion: "同伴",
  present: "在场",
  env: "环境",
};

function buildQuickhackDraft(deckName: string, target: HackTarget, program: HackProgram): string {
  return `启动${deckName}，对${target.name}上传「${program.name}」`;
}

function buildBreachDraft(deckName: string, target: HackTarget): string {
  if (target.kind === "env") {
    return `启动${deckName}，尝试破冰入侵${target.name}的局域内网`;
  }
  return `启动${deckName}，先对${target.name}发起破冰入侵，尝试捅穿其个人黑冰建立立足点`;
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

function programCardTone(
  prog: HackProgram,
  unavailable: boolean,
): "ultimate" | "damage" | "covert" | "control" | "disabled" {
  if (unavailable) return "disabled";
  if (prog.requiresFoothold || prog.category === "ultimate") return "ultimate";
  if (prog.category === "damage") return "damage";
  if (prog.category === "covert") return "covert";
  return "control";
}

function QuickhackCardFrame({
  tone,
}: {
  readonly tone: "breach" | "ultimate" | "damage" | "covert" | "control" | "disabled";
}) {
  const fill =
    tone === "disabled"
      ? "rgb(14 14 22 / 42%)"
      : tone === "ultimate"
        ? "rgb(42 9 18 / 86%)"
        : tone === "breach"
          ? "rgb(36 31 10 / 82%)"
          : tone === "damage"
            ? "rgb(36 20 12 / 80%)"
            : "rgb(13 20 30 / 82%)";
  const line =
    tone === "disabled"
      ? "rgb(168 163 160 / 22%)"
      : tone === "ultimate"
        ? "rgb(255 0 60 / 56%)"
        : tone === "breach"
          ? "rgb(252 238 10 / 58%)"
          : tone === "damage"
            ? "rgb(255 156 66 / 46%)"
            : "rgb(94 246 255 / 38%)";
  return (
    <>
      <NineSlice id="qh.cellBg" tint={fill} slice={QH_SLICE} className={styles.cardFrame} />
      <NineSlice id="qh.cellFg" tint={line} slice={QH_SLICE} className={styles.cardFrame} />
    </>
  );
}

/**
 * 浮升在输入终端正上方的 2077 网络接入仓快捷破解面板：
 * - 顶部 HUD：硬件型号、分段神经热负荷槽、反追踪预警、插槽管理入口与关闭；
 * - 中段：在场目标切换 + Kiroshi 目标扫描情报条（身份、破冰状态、网络链路、义体与已生效破解）；
 * - 主区：2077 原生切角快速破解战术卡片网格，点击即填入输入框草稿。
 */
export function DeckQuickbar({
  hacking,
  targets,
  selectedKey,
  hasOptics = false,
  onSelectTarget,
  onPickDraft,
  onScanTarget,
  onScanAllTargets,
  onOpenDeckTab,
  onClose,
}: {
  readonly hacking: HackingView;
  readonly targets: readonly HackTarget[];
  readonly selectedKey: string | null;
  readonly hasOptics?: boolean | undefined;
  readonly onSelectTarget: (key: string | null) => void;
  readonly onPickDraft: (text: string) => void;
  readonly onScanTarget?: ((npcId: string) => void) | undefined;
  readonly onScanAllTargets?: (() => void) | undefined;
  readonly onOpenDeckTab?: (() => void) | undefined;
  readonly onClose: () => void;
}) {
  const isBlackwall = hacking.blackwallCapable;
  const selected = targets.find((t) => t.key === selectedKey) ?? targets[0] ?? null;
  const thermalSteps = Array.from(
    { length: Math.max(1, hacking.thermal.maxHeat) },
    (_, i) => i + 1,
  );
  const scanUrl = cssUrl("fx.scanlines");
  const overheatedRisk = hacking.thermal.level === "hot" || hacking.thermal.level === "critical";
  const unscannedNpcCount = targets.filter(
    (t) => t.kind === "person" && Boolean(t.npcId) && t.netStatus == null,
  ).length;

  // 焦点不在输入框时按 Esc 也能直接收起快捷栏，不误触暂停菜单
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  return (
    <section
      className={styles.popover}
      data-blackwall={isBlackwall || undefined}
      aria-label="网络接入仓快捷破解"
    >
      <NineSlice
        id="notify.itemCellBg"
        slice={ITEM_CELL_SLICE}
        tint="var(--deck-shell-fill)"
        className={styles.shellLayer}
      />
      {scanUrl && (
        <NineSlice
          id="notify.itemCellBg"
          slice={ITEM_CELL_SLICE}
          tint="transparent"
          className={styles.shellScan}
          style={{ backgroundImage: scanUrl }}
        />
      )}
      <NineSlice
        id="notify.itemCellFg"
        slice={ITEM_CELL_SLICE}
        tint="var(--deck-shell-line)"
        className={styles.shellLayer}
      />

      <div className={styles.inner}>
        {/* 顶部战术 HUD 状态栏 */}
        <header className={styles.header}>
          <div className={styles.brand}>
            <span className={styles.brandIcon}>
              <Asset id="cyber.os" height={14} tint="currentColor" />
            </span>
            <strong className={styles.deckName}>{hacking.deckName}</strong>
            <span className={styles.kicker}>
              {isBlackwall ? "BLACKWALL // 越界协议" : "CYBERDECK // 快捷破解"}
            </span>
          </div>

          <div className={styles.headerMeta}>
            {hacking.traceAlert && (
              <span
                className={styles.traceBadge}
                title={`检测到反向追踪信号（${hacking.traceAlert.at}）：继续高调入侵可能暴露坐标或招致敌方黑客反制`}
              >
                反追踪 · {hacking.traceAlert.target}
              </span>
            )}

            <div
              className={styles.thermalMeter}
              data-level={hacking.thermal.level}
              title={`神经热负荷：${hacking.thermal.label}（${hacking.thermal.heat}/${hacking.thermal.maxHeat}）`}
            >
              <span className={styles.thermalLabel}>热负荷</span>
              <span className={styles.thermalCells} aria-hidden="true">
                {thermalSteps.map((step) => (
                  <i
                    key={step}
                    className={styles.thermalCell}
                    data-tone={thermalCellTone(step, hacking.thermal.heat, hacking.thermal.level)}
                  />
                ))}
              </span>
              <span className={styles.thermalVal}>
                {hacking.thermal.heat}/{hacking.thermal.maxHeat}
              </span>
            </div>

            {onOpenDeckTab && (
              <button
                type="button"
                className={styles.slotLink}
                title="打开接入仓界面管理热待命芯片"
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
        </header>

        {/* 目标切换行 */}
        <div className={styles.targetSection}>
          <span className={styles.sectionTag}>锁定目标</span>
          {targets.length === 0 ? (
            <span className={styles.emptyHint}>当前视野内未扫描到可接入目标</span>
          ) : (
            <div className={styles.targetList} role="listbox" aria-label="在场可扫描目标">
              {targets.map((target) => {
                const active = selected?.key === target.key;
                const effectCount = target.activeEffects?.length ?? 0;
                return (
                  <button
                    key={target.key}
                    type="button"
                    role="option"
                    aria-selected={active}
                    className={styles.targetBtn}
                    data-tone={target.tone}
                    data-active={active || undefined}
                    onClick={() => onSelectTarget(target.key)}
                  >
                    <span className={styles.targetDot} aria-hidden="true" />
                    <span className={styles.targetName}>{target.name}</span>
                    {target.tone === "hostile" && (
                      <span className={styles.targetTag} data-kind="hostile">
                        敌对
                      </span>
                    )}
                    {target.netStatus === "unchromed" && (
                      <span className={styles.targetTag} data-kind="muted">
                        无义体
                      </span>
                    )}
                    {!target.breached &&
                      (target.netStatus === "selfIce" || target.netStatus === "netrunner") && (
                        <span className={styles.targetTag} data-kind="ice">
                          {target.netStatus === "netrunner" ? "黑客" : "有 ICE"}
                        </span>
                      )}
                    {target.breached && (
                      <span className={styles.targetTag} data-kind="breached">
                        已破冰
                      </span>
                    )}
                    {effectCount > 0 && (
                      <span className={styles.targetTag} data-kind="effect">
                        {effectCount} 生效
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
          {hasOptics && unscannedNpcCount > 0 && onScanAllTargets && (
            <button
              type="button"
              className={styles.scanActionBtn}
              title="立即用义眼扫描所有在场未扫目标（不消耗回合）"
              onClick={onScanAllTargets}
            >
              <Asset id="interaction.scan" tint="currentColor" height={11} />
              <span>全扫 ({unscannedNpcCount})</span>
            </button>
          )}
        </div>

        {/* Kiroshi 扫描情报条 */}
        {selected && (
          <div className={styles.scanStrip} data-tone={selected.tone}>
            <div className={styles.scanPrimary}>
              <span className={styles.scanKind}>{TARGET_TONE_LABEL[selected.tone]}</span>
              <strong className={styles.scanTargetName}>{selected.name}</strong>
              {selected.role && <span className={styles.scanDetail}>{selected.role}</span>}
              <span
                className={styles.scanBreach}
                data-breached={selected.breached || selected.netStatus === "open" ? "" : undefined}
                data-blocked={selected.netStatus === "unchromed" || undefined}
              >
                {selected.netStatus === "unchromed"
                  ? "纯肉体 · 无植入体与个人 ICE"
                  : selected.breached
                    ? selected.breachedVia
                      ? `已破冰 · ${selected.breachedVia}`
                      : "已建立入侵立足点"
                    : selected.kind === "env"
                      ? "局域内网未破冰"
                      : selected.netStatus === "open"
                        ? "无自我 ICE · 可直接无线破解义体"
                        : selected.netStatus === "selfIce"
                          ? "装有自我 ICE · 建议先破冰"
                          : selected.netStatus === "netrunner"
                            ? "敌方网络黑客 · 警惕反制"
                            : hasOptics
                              ? "尚未义眼扫描 · 未知是否有自我 ICE"
                              : "未装完好义眼 · 无法扫描 ICE"}
              </span>
              {selected.kind === "person" &&
                selected.netStatus == null &&
                hasOptics &&
                selected.npcId &&
                onScanTarget && (
                  <button
                    type="button"
                    className={styles.scanActionBtn}
                    title={`立即用义眼扫描 ${selected.name}（不消耗回合）`}
                    onClick={() => {
                      if (selected.npcId) onScanTarget(selected.npcId);
                    }}
                  >
                    <Asset id="interaction.scan" tint="currentColor" height={11} />
                    <span>义眼扫描</span>
                  </button>
                )}
            </div>
            {(selected.netLabel ||
              selected.chromeSummary ||
              (selected.activeEffects?.length ?? 0) > 0) && (
              <div className={styles.scanFacts}>
                {selected.netLabel && (
                  <span className={styles.scanFact}>链路：{selected.netLabel}</span>
                )}
                {selected.chromeSummary && (
                  <span className={styles.scanFact}>义体：{selected.chromeSummary}</span>
                )}
                {selected.activeEffects?.map((eff) => (
                  <span key={eff} className={styles.effectPill}>
                    {eff}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 过载预警条 */}
        {overheatedRisk && (
          <div className={styles.overloadWarn} data-level={hacking.thermal.level} role="status">
            {hacking.thermal.level === "critical"
              ? "神经热负荷已达过载临界！继续硬发破解极易触发反烧与神经灼伤。"
              : "接入仓温度偏高（高热），连续上传高热/极热芯片可能触发过载。"}
          </div>
        )}

        {/* 快速破解战术卡片区 */}
        {selected &&
          (() => {
            const isUnchromed = selected.kind === "person" && selected.netStatus === "unchromed";
            const showBreach = canShowBreachAction(selected);
            const visiblePrograms =
              selected.kind === "env"
                ? hacking.programs.filter(isProgramUsableOnEnv)
                : hacking.programs;
            const hiddenEnvCount =
              selected.kind === "env" ? hacking.programs.length - visiblePrograms.length : 0;

            return (
              <div className={styles.programsArea}>
                {isUnchromed ? (
                  <div className={styles.emptyPrograms}>
                    <span>
                      扫描显示「{selected.name}
                      」未安装电子义体（纯肉体），不存在个人 ICE
                      或可锁定的无线接口，无法发起破冰与义体破解。
                    </span>
                  </div>
                ) : hacking.programs.length === 0 && !showBreach && selected.kind !== "env" ? (
                  <div className={styles.emptyPrograms}>
                    <span>热待命插槽当前为空，无法直接上传快速破解芯片。</span>
                    {onOpenDeckTab && (
                      <button
                        type="button"
                        className={styles.slotLink}
                        onClick={() => {
                          onClose();
                          onOpenDeckTab();
                        }}
                      >
                        去接入仓插装芯片 →
                      </button>
                    )}
                  </div>
                ) : (
                  <>
                    <div className={styles.cardGrid}>
                      {showBreach && (
                        <button
                          type="button"
                          className={styles.card}
                          data-tone="breach"
                          title={
                            selected.kind === "env"
                              ? "攻破现场局域网与监控节点"
                              : "捅穿个人黑冰建立立足点，解锁终极神经接管"
                          }
                          onClick={() => onPickDraft(buildBreachDraft(hacking.deckName, selected))}
                        >
                          <QuickhackCardFrame tone="breach" />
                          <div className={styles.cardHead}>
                            <strong className={styles.cardTitle}>破冰入侵</strong>
                            <span className={styles.cardBadge} data-kind="breach">
                              {selected.kind === "env" ? "渗入局域网" : "突破自我 ICE"}
                            </span>
                          </div>
                          <p className={styles.cardDesc}>
                            {selected.kind === "env"
                              ? "攻破现场局域网与安防监控节点，接管周边设备。"
                              : "捅穿对方自我 ICE / 个人黑冰建立立足点，解锁终极神经接管。"}
                          </p>
                        </button>
                      )}

                      {selected.kind === "env" && selected.breached && (
                        <button
                          type="button"
                          className={styles.card}
                          data-tone="control"
                          onClick={() =>
                            onPickDraft(buildEnvControlDraft(hacking.deckName, selected))
                          }
                        >
                          <QuickhackCardFrame tone="control" />
                          <div className={styles.cardHead}>
                            <strong className={styles.cardTitle}>接管安防与门禁</strong>
                            <span className={styles.cardCat} data-cat="control">
                              内网权限
                            </span>
                          </div>
                          <p className={styles.cardDesc}>
                            利用已攻破的局域内网权限，调取摄像头视野、关闭或干扰炮塔、解锁电子门禁。
                          </p>
                        </button>
                      )}

                      {visiblePrograms.map((prog) => {
                        const needBreach = prog.requiresFoothold && !selected.breached;
                        const unavailable = needBreach;
                        const tone = programCardTone(prog, unavailable);
                        const lockHint = needBreach
                          ? selected.netStatus === "selfIce" || selected.netStatus === "netrunner"
                            ? "需先对该目标破冰建立立足点"
                            : "需先上传任意常规破解建立立足点"
                          : null;
                        const tooltip = [
                          prog.effect,
                          prog.loadLabel ? `热负荷：${prog.loadLabel}` : null,
                          prog.targetRequirement ? `接口前提：${prog.targetRequirement}` : null,
                          lockHint ? `暂不可用：${lockHint}` : null,
                        ]
                          .filter(Boolean)
                          .join("\n");

                        return (
                          <button
                            key={prog.id}
                            type="button"
                            className={styles.card}
                            data-tone={tone}
                            disabled={unavailable}
                            title={tooltip}
                            onClick={() =>
                              onPickDraft(buildQuickhackDraft(hacking.deckName, selected, prog))
                            }
                          >
                            <QuickhackCardFrame tone={tone} />
                            <div className={styles.cardHead}>
                              <strong className={styles.cardTitle}>{prog.name}</strong>
                              <span className={styles.cardBadges}>
                                {prog.categoryLabel && (
                                  <span
                                    className={styles.cardCat}
                                    data-cat={prog.category ?? undefined}
                                  >
                                    {prog.categoryLabel}
                                  </span>
                                )}
                                {prog.loadLabel && (
                                  <span
                                    className={styles.cardLoad}
                                    data-load={prog.load ?? undefined}
                                  >
                                    {prog.loadLabel}
                                  </span>
                                )}
                              </span>
                            </div>
                            {prog.effect && <p className={styles.cardDesc}>{prog.effect}</p>}
                            {(lockHint || prog.targetRequirement) && (
                              <span
                                className={styles.cardFoot}
                                data-locked={Boolean(lockHint) || undefined}
                              >
                                {lockHint ?? `前提：${prog.targetRequirement}`}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                    {hiddenEnvCount > 0 && (
                      <p className={styles.filterNote}>
                        已自动过滤 {hiddenEnvCount}{" "}
                        个仅适用于义体人目标的芯片（如重启义眼、过热、记忆擦除、终极破解等）。
                      </p>
                    )}
                  </>
                )}
              </div>
            );
          })()}

        <footer className={styles.footerHint}>
          <span>点击卡片将快捷指令填入下方输入框（不会自动发送，可继续补充细节）</span>
          <span className={styles.footerKey}>ESC 关闭</span>
        </footer>
      </div>
    </section>
  );
}
