import { useRef, useState } from "react";
import { Asset, cssUrl, NineSlice } from "../../ui/Asset";
import { Button } from "../../ui/Button";
import { CellFrame } from "../../ui/FrameBox";
import { GeneratedImage } from "../images/GeneratedImage";
import { useSaveImages } from "../images/SaveImagesContext";
import styles from "./biomonitor.module.css";
import { type TraumaAction, TraumaMembership } from "./TraumaMembership";
import {
  type BodyPart,
  displayItemName,
  neuroTelemetry,
  type View,
  type WoundTelemetry,
  type WoundTone,
  woundTelemetry,
} from "./view";

const CELL_SLICE = [20, 30, 30, 20] as const;
const NEURO_CELL_COUNT = 20;

const BODY_ZONES: Readonly<
  Record<BodyPart, { readonly label: string; readonly top: string; readonly left: string }>
> = {
  head: { label: "头", top: "9%", left: "50%" },
  face: { label: "脸", top: "15%", left: "50%" },
  chest: { label: "胸口", top: "30%", left: "50%" },
  belly: { label: "肚子", top: "44%", left: "50%" },
  "right-arm": { label: "右臂", top: "39%", left: "34%" },
  "left-arm": { label: "左臂", top: "39%", left: "66%" },
  "right-leg": { label: "右腿", top: "71%", left: "43%" },
  "left-leg": { label: "左腿", top: "71%", left: "57%" },
};

const TONE_PRIORITY: Readonly<Record<WoundTone, number>> = {
  ok: 0,
  warn: 1,
  hurt: 2,
  bad: 3,
  dead: 4,
};

function isBodyPart(zone: string): zone is BodyPart {
  return zone in BODY_ZONES;
}

type SystemAlert = "ok" | "warn" | "bad";
type NeuroCellKind = "active" | "reserve" | "chrome";

interface HostDossier {
  readonly subtitle: string | null;
  readonly notes: readonly string[];
}

/** 从简介里剥掉「主板（…）」等模型提示词长块，只保留简明身份标头与手写档案注记 */
function parseHostDossier(brief: string | null): HostDossier {
  if (!brief) return { subtitle: null, notes: [] };
  const rawLines = brief
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const cutIndex = rawLines.findIndex((line) => line.startsWith("主板（"));
  const visibleLines = cutIndex === -1 ? rawLines : rawLines.slice(0, cutIndex);
  if (visibleLines.length === 0) return { subtitle: null, notes: [] };

  const [first = "", ...rest] = visibleLines;
  const subtitle = first
    .replace(/^(?:TA|他|她)[，,]\s*/, "")
    .replace(/[，,]\s*出身[:：]\s*/g, " · ")
    .replace(/^出身[:：]\s*/, "")
    .trim();
  return {
    subtitle: subtitle || null,
    notes: rest.filter((line) => !line.startsWith("说话方式：")),
  };
}

function bodyLayers(view: View, wound: WoundTelemetry) {
  const { health, humanity, psychosis, time, cyberware } = view;
  const brokenCount = cyberware.filter((c) => c.broken).length;
  const injured = wound.tone !== "ok";
  const severeWound = wound.tone === "bad" || wound.tone === "dead" || wound.tone === "hurt";

  const skeletalAlert: SystemAlert =
    health.lostLimbs.length > 0 ? "bad" : brokenCount > 0 ? "warn" : "ok";
  const vascularAlert: SystemAlert =
    severeWound || health.condition !== "up" || time.blackLaceWithdrawal
      ? "bad"
      : injured
        ? "warn"
        : "ok";
  const nervousAlert: SystemAlert =
    psychosis.blackoutOpen || humanity.current < 20 || psychosis.suppressant.withdrawal
      ? "bad"
      : humanity.glitchZone || time.fatigued
        ? "warn"
        : "ok";
  const immuneAlert: SystemAlert =
    psychosis.suppressant.withdrawal || wound.tone === "bad" || wound.tone === "dead"
      ? "bad"
      : time.fatigued || psychosis.suppressant.dependent
        ? "warn"
        : "ok";

  const alerts: readonly SystemAlert[] = [skeletalAlert, vascularAlert, nervousAlert, immuneAlert];
  const scanAlert: SystemAlert = alerts.includes("bad")
    ? "bad"
    : alerts.includes("warn")
      ? "warn"
      : "ok";

  return {
    skeletalAlert,
    vascularAlert,
    nervousAlert,
    immuneAlert,
    scanAlert,
    skinOpacity: 0.45,
    immuneOpacity: humanity.suppressed || immuneAlert !== "ok" ? 0.85 : 0.36,
    skeletonOpacity: skeletalAlert === "ok" ? 0.6 : 0.96,
    nervousOpacity: nervousAlert === "ok" ? 0.65 : 1,
    circulatoryOpacity: vascularAlert === "ok" ? 0.58 : 1,
  };
}

interface NeuroCell {
  readonly step: number;
  readonly kind: NeuroCellKind;
}

function buildNeuroCells(humanity: View["humanity"]): readonly NeuroCell[] {
  const step = 100 / NEURO_CELL_COUNT;
  return Array.from({ length: NEURO_CELL_COUNT }, (_, idx) => {
    const upper = (idx + 1) * step;
    const midpoint = idx * step + step / 2;
    const kind: NeuroCellKind =
      humanity.current > 0 && midpoint <= humanity.current
        ? "active"
        : humanity.cap > 0 && upper <= humanity.cap
          ? "reserve"
          : "chrome";
    return { step: upper, kind };
  });
}

/**
 * 3.0 生物检测核心终端面板：
 * 左栏叠加全息生理图层与街头名声；右栏呈现创伤监测、20 格神经稳态阵列、外设与代谢调度
 */
export function BiomonitorPanel({
  view,
  onTrauma,
  busy,
}: {
  readonly view: View;
  readonly onTrauma?: ((action: TraumaAction) => Promise<void>) | undefined;
  readonly busy?: boolean | undefined;
}) {
  const {
    health,
    combat,
    character,
    humanity,
    psychosis,
    trauma,
    hacking,
    sandevistan,
    time,
    inventory,
  } = view;
  const [membershipOpen, setMembershipOpen] = useState(false);
  const [rescuePending, setRescuePending] = useState(false);
  const [rescueError, setRescueError] = useState<string | null>(null);
  const rescueRunning = useRef(false);
  const callRescue = async () => {
    if (!onTrauma || busy || rescueRunning.current || !trauma.rescue.ok) return;
    rescueRunning.current = true;
    setRescuePending(true);
    setRescueError(null);
    try {
      await onTrauma({ type: "trauma", action: "rescue" });
    } catch (cause) {
      setRescueError(cause instanceof Error ? cause.message : "救援呼叫未完成，请稍后重试");
    } finally {
      rescueRunning.current = false;
      setRescuePending(false);
    }
  };
  const wound = woundTelemetry(health, combat, view.cyberware);
  const neuro = neuroTelemetry(humanity, psychosis);
  const layers = bodyLayers(view, wound);
  const cells = buildNeuroCells(humanity);
  const dossier = parseHostDossier(character.brief);
  const saveImages = useSaveImages();
  const portraitId = saveImages?.bindings.playerPortrait ?? character.portrait ?? null;
  const origins = character.traits.filter((t) => t.slot === "origin");
  const modules = character.traits.filter((t) => t.slot !== "origin");
  const openPortraitModal = () => {
    if (!saveImages) return;
    saveImages.openImageModal({
      title: portraitId ? "AI 重绘主角立绘" : "AI 生成主角立绘",
      ...(character.name ? { subtitle: character.name } : {}),
      defaultAspectRatio: "3:4",
      bind: { kind: "character" },
      promptRequest: {
        kind: "character",
        name: character.name ?? "Merc",
        alias: "",
        pronoun: "TA",
        origin: origins[0]?.label ?? "",
        look: character.brief.slice(0, 480),
        personality: "",
        skills: modules.map((m) => m.label).join("、"),
        cyberware: view.cyberware.map((c) => c.name),
        gear: inventory.carriedWeapons
          .map((w) => displayItemName(view.names.items, w.id))
          .slice(0, 6),
        instruction: "",
      },
    });
  };

  const activePins = new Map<BodyPart, { tone: WoundTone; labels: string[] }>();
  for (const item of wound.items) {
    if (!isBodyPart(item.zone)) continue;
    const prev = activePins.get(item.zone);
    if (!prev) {
      activePins.set(item.zone, { tone: item.tone, labels: [`${item.headline}（${item.cause}）`] });
    } else {
      if (TONE_PRIORITY[item.tone] > TONE_PRIORITY[prev.tone]) prev.tone = item.tone;
      prev.labels.push(`${item.headline}（${item.cause}）`);
    }
  }
  const scarPins = [...new Set(wound.scars.map((s) => s.part))].filter((p) => !activePins.has(p));

  const hasStress = time.fatigued || time.blackLaceWithdrawal || inventory.bulky.overloaded;

  return (
    <section className={styles.root} aria-label="生物检测">
      {/* 顶部总控状态条：头像 + 身份信息 + 立绘操作 + 创伤/救援状态 */}
      <header className={styles.banner} data-tone={wound.tone}>
        <CellFrame />
        <div className={styles.bannerBrand}>
          {character.name !== null && (portraitId || saveImages) ? (
            <button
              type="button"
              className={styles.bannerAvatar}
              disabled={!portraitId && !saveImages}
              title={
                portraitId
                  ? "点击查看大图"
                  : saveImages
                    ? "点击生成角色立绘"
                    : `街头名声 · ${character.credTier}：${character.credWorld}`
              }
              onClick={() => {
                if (portraitId) {
                  saveImages?.openLightbox(portraitId, `${character.name ?? "主角"} · 人物立绘`);
                } else {
                  openPortraitModal();
                }
              }}
            >
              <NineSlice id="map.filterCellBg" tint="rgb(10 12 20 / 92%)" slice={CELL_SLICE} />
              {portraitId ? (
                <GeneratedImage
                  imageId={portraitId}
                  alt={`${character.name}立绘`}
                  className={styles.bannerAvatarImg}
                  fallback={<Asset id="portrait.unknown" className={styles.bannerAvatarImg} />}
                />
              ) : (
                <Asset id="portrait.unknown" className={styles.bannerAvatarImg} />
              )}
              <NineSlice id="map.filterCellFg" tint="var(--cp-red-dim)" slice={CELL_SLICE} />
            </button>
          ) : (
            <span
              className={styles.bannerCrest}
              title={`街头名声 · ${character.credTier}：${character.credWorld}`}
            >
              <Asset id="hud.levelFrame" tint="var(--cp-red)" height={34} />
              <Asset
                id="notify.streetCred"
                tint="var(--cp-red)"
                height={16}
                className={styles.bannerCrestIcon}
              />
            </span>
          )}
          <div className={styles.bannerTitle}>
            <span className={styles.bannerCode}>KIROSHI OPTICS {"//"} BIOMONITOR</span>
            <div className={styles.bannerHostRow}>
              <strong className={styles.bannerName}>{character.name ?? "未建档宿主"}</strong>
              {dossier.subtitle && <span className={styles.bannerSub}>{dossier.subtitle}</span>}
            </div>
            {character.name !== null && saveImages && (
              <div className={styles.bannerActions}>
                <Button small onClick={openPortraitModal}>
                  {portraitId ? "AI 重绘" : "AI 生成立绘"}
                </Button>
                {saveImages.bindings.playerPortrait && (
                  <Button small onClick={() => void saveImages.unbindImage({ kind: "character" })}>
                    恢复建档
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
        <div className={styles.bannerPills}>
          <span className={styles.statusPill} data-tone={wound.tone}>
            <NineSlice
              id="cyber.gaugeLabel"
              tint={
                wound.tone === "bad" || wound.tone === "dead"
                  ? "rgb(255 0 60 / 22%)"
                  : wound.tone === "warn" || wound.tone === "hurt"
                    ? "rgb(252 238 10 / 16%)"
                    : "rgb(94 246 255 / 15%)"
              }
              slice={4}
            />
            {wound.code}
          </span>
          {trauma.active && (
            <span
              className={styles.ttPill}
              data-ok={trauma.coverage.ok || undefined}
              data-blocked={!trauma.coverage.ok || undefined}
              title={trauma.coverage.ok ? "创伤小组救援保障待命" : trauma.coverage.why}
            >
              <NineSlice id="cyber.gaugeLabel" tint="rgb(255 255 255 / 8%)" slice={4} />
              TT {trauma.tierLabel}
              {trauma.coverage.ok ? "" : " · 受限"}
            </span>
          )}
          {trauma.rescue.ok && (
            <Button
              small
              primary
              disabled={busy || rescuePending || !onTrauma}
              reason="正在处理行动，请稍候"
              onClick={() => void callRescue()}
            >
              {rescuePending ? "救援呼叫中…" : "呼叫紧急救援"}
            </Button>
          )}
        </div>
      </header>

      {rescueError && (
        <p className={styles.rescueError} role="alert">
          {rescueError}
        </p>
      )}

      {/* 主体：左生理解剖扫描图 + 右三组遥测诊断 */}
      <div className={styles.workspace}>
        <aside className={styles.scanCol} data-tone={wound.tone}>
          <CellFrame />
          <span
            className={styles.scanGridBg}
            style={{ backgroundImage: cssUrl("fx.grid") }}
            aria-hidden
          />
          <div className={styles.scanHead}>
            <span>VITAL-MAP</span>
            <span className={styles.scanLive} data-alert={layers.scanAlert}>
              <i aria-hidden />
              {layers.scanAlert === "bad"
                ? "ALERT"
                : layers.scanAlert === "warn"
                  ? "STRAIN"
                  : "SCAN OK"}
            </span>
          </div>

          <div className={styles.bodyStage} aria-hidden>
            <span className={styles.bodyReticle} />
            {(wound.tone === "bad" || wound.tone === "dead" || layers.nervousAlert === "bad") && (
              <Asset
                id="hud.damageGlow"
                tint="var(--cp-danger)"
                height={116}
                className={styles.bodyGlow}
              />
            )}
            <Asset
              id="cyber.bodySkin"
              height={104}
              className={styles.bodyLayer}
              style={{ opacity: layers.skinOpacity }}
            />
            <Asset
              id="cyber.bodyImmune"
              height={104}
              className={styles.bodyLayer}
              style={{ opacity: layers.immuneOpacity }}
            />
            <Asset
              id="cyber.bodySkeleton"
              height={104}
              className={styles.bodyLayer}
              style={{ opacity: layers.skeletonOpacity }}
            />
            <Asset
              id="cyber.bodyNervous"
              height={104}
              className={styles.bodyLayer}
              style={{
                opacity: layers.nervousOpacity,
                filter:
                  layers.nervousAlert === "bad"
                    ? "drop-shadow(0 0 5px rgb(255 0 60 / 80%))"
                    : layers.nervousAlert === "warn"
                      ? "drop-shadow(0 0 4px rgb(252 238 10 / 60%))"
                      : undefined,
              }}
            />
            <Asset
              id="cyber.bodyCirculatory"
              height={104}
              className={styles.bodyLayer}
              style={{
                opacity: layers.circulatoryOpacity,
                filter:
                  layers.vascularAlert === "bad"
                    ? "drop-shadow(0 0 5px rgb(255 0 60 / 80%))"
                    : undefined,
              }}
            />
            {scarPins.map((part) => {
              const pos = BODY_ZONES[part];
              return (
                <span
                  key={`scar-${part}`}
                  className={styles.scarPin}
                  style={{ top: pos.top, left: pos.left }}
                  title={`${pos.label} · 永久留疤`}
                />
              );
            })}
            {[...activePins.entries()].map(([part, info]) => {
              const pos = BODY_ZONES[part];
              return (
                <span
                  key={`pin-${part}`}
                  className={styles.zonePin}
                  data-tone={info.tone}
                  style={{ top: pos.top, left: pos.left }}
                  title={`${pos.label}：${info.labels.join("；")}`}
                />
              );
            })}
            <span className={styles.scanBeam} />
          </div>

          <div className={styles.systemLegend}>
            <span className={styles.sysDot} data-alert={layers.vascularAlert}>
              循环/体征
            </span>
            <span className={styles.sysDot} data-alert={layers.nervousAlert}>
              中枢神经
            </span>
            <span className={styles.sysDot} data-alert={layers.skeletalAlert}>
              骨骼/义肢
            </span>
            <span className={styles.sysDot} data-alert={layers.immuneAlert}>
              免疫代谢
            </span>
          </div>

          <div className={styles.credLine} title={character.credWorld}>
            <small>街头名声</small>
            <span>{character.credTier}</span>
          </div>
        </aside>

        <div className={styles.telemetryCol}>
          {/* 卡 1：具体创伤档案 */}
          <article className={styles.card} data-tone={wound.tone}>
            <CellFrame />
            <div className={styles.cardHead}>
              <span className={styles.cardLabel}>TRAUMA {"//"} 具体创伤档案</span>
              <span className={styles.cardValue} data-tone={wound.tone}>
                {wound.title}
                {health.painSuppressed && wound.level === 2 ? " · 镇痛阻断" : ""}
              </span>
            </div>
            {wound.items.length > 0 ? (
              <>
                <ul className={styles.traumaList}>
                  {wound.items.map((item) => (
                    <li key={item.id} className={styles.traumaItem} data-tone={item.tone}>
                      <span className={styles.traumaPart}>{item.partLabel}</span>
                      <div className={styles.traumaInfo}>
                        <strong className={styles.traumaHeadline}>
                          {item.tierLabel} · {item.cause}
                        </strong>
                        <span className={styles.traumaCare}>{item.careNote}</span>
                      </div>
                      <span className={styles.traumaTag} data-treated={item.treated || undefined}>
                        {item.careTag}
                      </span>
                    </li>
                  ))}
                </ul>
                {wound.level >= 2 && <p className={styles.cardNote}>{wound.impact}</p>}
              </>
            ) : (
              <p className={styles.traumaClear}>{wound.impact}</p>
            )}
            {health.painSuppressed && (
              <div className={styles.chipRow}>
                <span className={styles.alertChip} data-kind="suppress">
                  {wound.level >= 3
                    ? "镇痛药效难以压住当前重创"
                    : "医疗针镇痛生效 · 暂蔽创痛，仍须清创缝合"}
                </span>
              </div>
            )}
            {wound.scars.length > 0 && (
              <div className={styles.scarBox}>
                <small className={styles.scarHead}>创疤档案</small>
                <div className={styles.scarList}>
                  {wound.scars.map((s) => (
                    <span key={s.id} className={styles.scarChip}>
                      {s.summary}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </article>

          {/* 卡 2：神经稳态感知 */}
          <article className={styles.card} data-tone={neuro.tone}>
            <CellFrame />
            <div className={styles.cardHead}>
              <span className={styles.cardLabel}>NEURAL {"//"} 神经稳态感知</span>
              <span className={styles.cardValue} data-tone={neuro.tone}>
                {humanity.stageLabel} · {neuro.alertCode}
              </span>
            </div>
            <div
              className={styles.neuroGaugeWrap}
              title={`${humanity.stageLabel} · ${neuro.summary}`}
            >
              <div
                className={styles.neuroMatrix}
                role="img"
                aria-label={`神经稳态：${humanity.stageLabel}`}
              >
                {cells.map((cell) => (
                  <span
                    key={cell.step}
                    className={styles.neuroCell}
                    data-kind={cell.kind}
                    data-tone={neuro.tone}
                    data-suppress={humanity.suppressed || undefined}
                  />
                ))}
              </div>
              <span className={styles.neuroThreshold} title="感官失真临界阈值" aria-hidden />
            </div>
            <div className={styles.neuroMeta}>
              <b>{neuro.summary}</b>
              <span>{neuro.loadNote}</span>
            </div>
            {(psychosis.suppressant.until ||
              psychosis.suppressant.dependent ||
              psychosis.blackoutOpen ||
              psychosis.blackouts.length > 0 ||
              psychosis.lostControl > 0) && (
              <div className={styles.chipRow}>
                {psychosis.suppressant.until && (
                  <span className={styles.alertChip} data-kind="suppress">
                    免疫抑剂至 {psychosis.suppressant.until}
                    {psychosis.suppressant.tolerant ? "（耐药半衰）" : ""}
                  </span>
                )}
                {!psychosis.suppressant.until && psychosis.suppressant.withdrawal && (
                  <span className={styles.alertChip}>抑剂停药戒断 · 焦躁手颤</span>
                )}
                {!psychosis.suppressant.until &&
                  !psychosis.suppressant.withdrawal &&
                  psychosis.suppressant.dependent && (
                    <span className={styles.alertChip} data-kind="warn">
                      免疫抑剂已成瘾依赖
                    </span>
                  )}
                {psychosis.blackoutOpen && (
                  <span className={styles.alertChip}>当前时段存在记忆盲区</span>
                )}
                {psychosis.blackouts.length > 0 && (
                  <span className={styles.alertChip} data-kind="warn">
                    近期曾出现记忆断片
                  </span>
                )}
                {psychosis.lostControl > 0 && (
                  <span className={styles.alertChip} data-kind="warn">
                    曾出现短暂意识失控
                  </span>
                )}
              </div>
            )}
          </article>

          {/* 卡 3：外设硬件、创伤小组与代谢负重 */}
          <article className={styles.card}>
            <CellFrame />
            <div className={styles.cardHead}>
              <span className={styles.cardLabel}>LINK {"//"} 神经外设 · 救援 · 代谢</span>
              <span className={styles.cardValue}>
                {hacking ? "DECK ONLINE" : sandevistan ? "SANDY READY" : "BASELINE"}
              </span>
            </div>
            <div className={styles.subRows}>
              {hacking && (
                <div className={styles.subRow} title={hacking.profile ?? undefined}>
                  <span className={styles.subKey}>{hacking.deckName}</span>
                  <span className={styles.subVal} data-tone="cyan">
                    {[...hacking.traitLabels, hacking.selfIce ? "自我 ICE" : null]
                      .filter(Boolean)
                      .join(" · ") || "硬件在线"}
                  </span>
                </div>
              )}
              {sandevistan && (
                <div className={styles.subRow}>
                  <span className={styles.subKey}>{sandevistan.name}</span>
                  <span className={styles.subVal} data-tone="cyan">
                    加速就绪 · 连启加剧震荡
                  </span>
                </div>
              )}
              <button
                type="button"
                className={`${styles.subRow} ${styles.ttManage}`}
                aria-haspopup="dialog"
                aria-expanded={membershipOpen}
                aria-label="创伤小组会籍服务"
                disabled={rescuePending}
                onClick={() => setMembershipOpen(true)}
              >
                <span className={styles.subKey}>创伤小组</span>
                <span
                  className={styles.subVal}
                  data-tone={
                    trauma.active
                      ? trauma.coverage.ok
                        ? "ok"
                        : "warn"
                      : trauma.lapsed
                        ? "bad"
                        : undefined
                  }
                >
                  {trauma.active
                    ? `${trauma.tierLabel} · ${trauma.coverage.ok ? "保障有效" : "当前受限"}`
                    : trauma.lapsed
                      ? "会籍已到期"
                      : "未开通"}
                </span>
                <span className={styles.ttAction}>会籍服务</span>
              </button>
              <div className={styles.subRow}>
                <span className={styles.subKey}>生理负荷</span>
                <span className={styles.subVal} data-tone={hasStress ? "warn" : undefined}>
                  {[
                    time.fatigued ? "连续未眠 · 动作与反应发滞" : null,
                    time.blackLaceWithdrawal ? "黑蕾丝停药戒断" : null,
                    inventory.bulky.overloaded
                      ? "重型装备超载 · 翻墙/潜行/闪避受阻"
                      : inventory.bulky.count > 0
                        ? "携带显眼长件 · 节律正常"
                        : "行装轻便 · 节律正常",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </div>
            </div>
          </article>
        </div>
      </div>

      {membershipOpen && (
        <TraumaMembership
          view={view}
          onTrauma={onTrauma}
          busy={busy || rescuePending}
          onClose={() => setMembershipOpen(false)}
        />
      )}

      {dossier.notes.length > 0 && (
        <div className={styles.dossierBox}>
          {dossier.notes.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      )}
    </section>
  );
}
