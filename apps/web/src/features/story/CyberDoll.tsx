import { cyberwareRules } from "@cp/core";
import type { CSSProperties, ReactNode } from "react";
import type { AssetId } from "../../assets";
import { Asset, cssUrl, NineSlice } from "../../ui/Asset";
import { CellFrame } from "../../ui/FrameBox";
import { ITEM_ELEMENT_META, itemArtOf, itemElementOf } from "./art";
import { CYBER_BODY_ART, CYBER_BODY_FRAME, CYBER_SLOT_ICON } from "./cyberwareMeta";
import neural from "./neural.module.css";
import type { View } from "./view";

export type CyberSlot = View["cyberware"][number]["slot"];

export const CYBER_LABELS: Readonly<Record<CyberSlot, string>> = cyberwareRules.SLOT_LABELS;

/** 供纯净人体剪影精准联动高亮的区域键 */
export type BodyFocusKey =
  | cyberwareRules.CoreSlotId
  | cyberwareRules.ExtensionZoneId
  | "arms"
  | null;

const BODY_BASE_ASSETS = [...new Set(Object.values(CYBER_BODY_ART).map(({ base }) => base))];

interface SilhouetteLayer {
  readonly base: AssetId;
  readonly detailSlot?: CyberSlot | undefined;
  readonly clip?: "left" | "right" | undefined;
  readonly ring?: "skin" | "head" | "chassis" | "lifestyle" | undefined;
}

function silhouetteLayerOf(focus: BodyFocusKey, hasFbc: boolean): SilhouetteLayer {
  switch (focus) {
    case "chassis":
      return { base: "cyber.bodySkeleton", ring: "chassis" };
    case "cyberdeck":
      return { base: "cyber.bodySkin", detailSlot: "frontalCortex" };
    case "spineDrive":
      return { base: "cyber.bodySkin", detailSlot: "os" };
    case "optics":
      return { base: "cyber.bodySkin", detailSlot: "eyes" };
    case "leftArm":
      return { base: "cyber.bodySkin", detailSlot: "arms", clip: "left" };
    case "rightArm":
      return { base: "cyber.bodySkin", detailSlot: "arms", clip: "right" };
    case "arms":
      return { base: "cyber.bodySkin", detailSlot: "arms" };
    case "legDrive":
      return { base: "cyber.bodySkin", detailSlot: "legs" };
    case "skinArmor":
      return { base: "cyber.bodySkin", ring: "skin" };
    case "neural":
      return { base: "cyber.bodyNervous" };
    case "sensory":
      return { base: "cyber.bodySkin", detailSlot: "eyes", ring: "head" };
    case "torso":
      return { base: "cyber.bodyCirculatory" };
    case "extremities":
      return { base: "cyber.bodySkin", detailSlot: "hands" };
    case "lifestyle":
      return { base: "cyber.bodySkin", ring: "lifestyle" };
    default:
      return { base: hasFbc ? "cyber.bodySkeleton" : "cyber.bodySkin" };
  }
}

const FOCUS_LABELS: Readonly<Record<Exclude<BodyFocusKey, null>, string>> = {
  ...cyberwareRules.CORE_SLOT_LABELS,
  ...cyberwareRules.EXTENSION_ZONE_LABELS,
  arms: "手臂义肢/武装",
};

/** 一格的底子：原作切角底、金色电路纹、外框和稀有度竖条 */
function CyberCellFace() {
  return (
    <>
      <NineSlice
        id="cyber.cellShape"
        tint="var(--cp-surface-raised)"
        slice={0}
        className={neural.cellSquare}
      />
      <NineSlice
        id="cyber.cellTexture"
        tint="var(--cell-texture)"
        slice={0}
        className={neural.cellSquare}
      />
      <NineSlice
        id="cyber.cellFrame"
        tint="var(--cell-line)"
        slice={0}
        className={neural.cellSquare}
      />
      <NineSlice
        id="cyber.cellRarity"
        tint="var(--cell-strip)"
        slice={0}
        className={neural.cellStrip}
      />
    </>
  );
}

/** 列表/主位/诊所里单件义体的缩略方格 */
export function CyberItemCell({
  id,
  name,
  slot,
  on = false,
  rarity,
  iconic = false,
  broken = false,
  size,
}: {
  readonly id: string;
  readonly name: string;
  readonly slot?: CyberSlot | undefined;
  readonly on?: boolean;
  readonly rarity?: string | undefined;
  readonly iconic?: boolean | undefined;
  readonly broken?: boolean | undefined;
  readonly size?: number | undefined;
}) {
  const art = itemArtOf(id);
  const element = itemElementOf(id);
  const style = size !== undefined ? ({ "--cell": `${size}px` } as CSSProperties) : undefined;
  return (
    <span
      className={neural.cyberCell}
      data-item
      data-on={on || undefined}
      data-broken={broken || undefined}
      data-rarity={rarity}
      data-iconic={iconic || undefined}
      data-element={element}
      style={style}
      aria-hidden
    >
      <CyberCellFace />
      {art ? (
        <Asset id={art as AssetId} alt={name} className={neural.cyberArt} />
      ) : slot ? (
        <span
          aria-hidden
          className={neural.cellFallbackIcon}
          style={{
            maskImage: cssUrl(CYBER_SLOT_ICON[slot]),
            WebkitMaskImage: cssUrl(CYBER_SLOT_ICON[slot]),
          }}
        />
      ) : (
        <span className={neural.cyberCellName}>{name}</span>
      )}
      {element && (
        <span className={neural.cyberElementBadge}>{ITEM_ELEMENT_META[element].badge}</span>
      )}
      {broken && (
        <Asset
          id="cyber.disabled"
          tint="var(--cp-danger)"
          height={14}
          alt="已损坏"
          className={neural.cyberBroken}
        />
      )}
    </span>
  );
}

/**
 * 极简三段式神经承载顶栏（局内义体页、创角与义体医生诊所共用）：
 * - 青色安全区 + 琥珀超载红线刻度 + 满载拦截提示；
 * - 零多余药丸与套话，仅在进入超载红线时点明简短原因。
 */
export function NeuralLoadBar({
  load,
  extra,
  subline,
}: {
  readonly load: cyberwareRules.CyberwareLoadProfile;
  readonly extra?: ReactNode;
  readonly subline?: ReactNode;
}) {
  const fillPct = Math.min(
    100,
    Math.round((load.activeLoadScore / Math.max(1, load.hardCap)) * 100),
  );
  const safePct = Math.min(100, Math.round((load.safeCap / Math.max(1, load.hardCap)) * 100));
  return (
    <section
      className={neural.loadBarShell}
      data-tone={load.tone}
      aria-label={`神经承载 ${load.activeLoadScore}/${load.hardCap}`}
    >
      <CellFrame />
      <div className={neural.loadBarMain}>
        <div className={neural.loadBarRow}>
          <span className={neural.loadBarLabel}>
            <span className={neural.loadBarCode}>NEURAL LOAD</span>
            神经承载
          </span>
          <div
            className={neural.loadTrack}
            role="progressbar"
            aria-valuenow={load.activeLoadScore}
            aria-valuemin={0}
            aria-valuemax={load.hardCap}
          >
            <span className={neural.loadSafeZone} style={{ width: `${safePct}%` }} aria-hidden />
            <span
              className={neural.loadFill}
              data-tone={load.tone}
              style={{ width: `${fillPct}%` }}
            />
            <span className={neural.loadTicks} aria-hidden />
            <span
              className={neural.loadSafeTick}
              style={{ left: `${safePct}%` }}
              title={`安全线 ${load.safeCap}`}
              aria-hidden
            />
          </div>
          <span className={neural.loadReadout} data-tone={load.tone}>
            <span className={neural.loadReadoutVal}>
              {load.activeLoadScore}
              <span className={neural.loadReadoutCap}>/{load.hardCap}</span>
            </span>
            <span className={neural.loadReadoutState}>{load.label}</span>
          </span>
          {load.alertReason && (
            <span className={neural.loadReason} data-tone={load.tone}>
              {load.alertReason}
            </span>
          )}
        </div>
        {subline}
      </div>
      {extra && <div className={neural.loadBarExtra}>{extra}</div>}
    </section>
  );
}

/**
 * 纯净联动人体剪影（2077 全息扫描舞台，彻底移除四周杂乱小方格）：
 * - 悬停或点选右侧任意核心主位/扩展区时，精准高亮对应身体位置；
 * - 左臂/右臂独立裁切发光，FBC 躯壳自动切骨骼轮廓。
 */
export function CyberBodySilhouette({
  focus = null,
  chassisLabel,
  hasFbc = false,
  installedCount,
  tone = "ok",
}: {
  readonly focus?: BodyFocusKey;
  readonly chassisLabel: string;
  readonly hasFbc?: boolean;
  readonly installedCount: number;
  readonly tone?: "ok" | "warn" | "bad";
}) {
  const layer = silhouetteLayerOf(focus, hasFbc);
  const activeDetail = layer.detailSlot ? CYBER_BODY_ART[layer.detailSlot].detail : undefined;
  const focusLabel = focus ? FOCUS_LABELS[focus] : null;

  return (
    <div className={neural.silhouettePane} data-tone={tone} data-ring={layer.ring}>
      <CellFrame />
      <span className={neural.silhouetteGrid} aria-hidden />
      <div className={neural.silhouetteHeader}>
        <span className={neural.silhouetteKicker}>{"BIO-SCAN // 02"}</span>
        <span className={neural.silhouetteFocusTag} data-active={focusLabel ? true : undefined}>
          {focusLabel ?? "全身轮廓"}
        </span>
      </div>

      <div className={neural.silhouetteStage} aria-hidden>
        <div
          className={neural.silhouetteFrame}
          style={{ aspectRatio: `${CYBER_BODY_FRAME.width} / ${CYBER_BODY_FRAME.height}` }}
        >
          {BODY_BASE_ASSETS.map((asset) => (
            <Asset
              key={asset}
              id={asset}
              alt=""
              className={neural.silhouetteBase}
              data-active={layer.base === asset || undefined}
            />
          ))}
          {activeDetail && (
            <span
              className={neural.silhouetteDetailWrap}
              style={{
                left: `${(activeDetail.left / CYBER_BODY_FRAME.width) * 100}%`,
                top: `${(activeDetail.top / CYBER_BODY_FRAME.height) * 100}%`,
                width: `${(activeDetail.width / CYBER_BODY_FRAME.width) * 100}%`,
                height: `${(activeDetail.height / CYBER_BODY_FRAME.height) * 100}%`,
              }}
            >
              <span className={neural.silhouetteDetailClip} data-clip={layer.clip}>
                <Asset id={activeDetail.id} alt="" className={neural.silhouetteDetail} />
              </span>
            </span>
          )}
        </div>
      </div>

      <footer className={neural.silhouetteFooter}>
        <span className={neural.silhouetteChassis}>{chassisLabel}</span>
        <span className={neural.silhouetteCount}>{installedCount} 件</span>
      </footer>
    </div>
  );
}
