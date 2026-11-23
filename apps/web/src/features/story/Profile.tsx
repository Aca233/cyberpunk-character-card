import { worldRules } from "@cp/core";
import { type CSSProperties, type ReactNode, useState } from "react";
import type { AssetId } from "../../assets";
import { ActionButton } from "../../ui/ActionButton";
import { Asset, cssUrl, NineSlice } from "../../ui/Asset";
import { CellFrame } from "../../ui/FrameBox";
import { GeneratedImage } from "../images/GeneratedImage";
import { useSaveImages } from "../images/SaveImagesContext";
import { baseWeaponIdOf, itemArtOf, portraitOf, weaponHudIconOf } from "./art";
import neural from "./neural.module.css";
import styles from "./profile.module.css";
import { npcWoundSummary, type View } from "./view";

type Npc = View["npcs"][number];
/** 中间人的派单信息（委托系统按好感、声望和势力算）；人物档案里同 id 的中间人才有 */
type Fixer = View["jobs"]["fixers"][number];
export type CombatFoe = NonNullable<View["combat"]["active"]>["foes"][number];

/** 在场目标当前的电子战破冰与生效快速破解态势 */
export interface ProfileHackStatus {
  readonly breached: boolean;
  readonly breachedVia?: string | null | undefined;
  readonly activeEffects: readonly string[];
}

type NpcGearItem = NonNullable<Npc["body"]>["gear"][number];
type NpcChromeItem = NonNullable<NonNullable<Npc["body"]>["scan"]>["chrome"][number];

const CELL_SLICE = [20, 30, 30, 20] as const;
const HEAD_SLICE = [4, 20, 20, 4] as const;
const QH_SLICE = [18, 22, 22, 18] as const;
/** 好感的范围，同 core 的 AFFINITY_MAX */
const AFFINITY_MAX = 100;

/** 2077 原生切角插槽底框（qh.cellBg / qh.cellFg，无左侧竖色条） */
function TacticalCellFrame({
  tone = "default",
}: {
  readonly tone?: "default" | "warn" | "danger";
}) {
  const fill =
    tone === "danger"
      ? "rgb(34 10 16 / 82%)"
      : tone === "warn"
        ? "rgb(28 22 12 / 76%)"
        : "rgb(14 16 26 / 74%)";
  const line =
    tone === "danger"
      ? "rgb(255 97 88 / 44%)"
      : tone === "warn"
        ? "rgb(252 238 10 / 38%)"
        : "rgb(94 246 255 / 26%)";
  return (
    <>
      <NineSlice id="qh.cellBg" tint={fill} slice={QH_SLICE} className={styles.qhFrame} />
      <NineSlice id="qh.cellFg" tint={line} slice={QH_SLICE} className={styles.qhFrame} />
    </>
  );
}

const CLOTHING_SLOT_INDEX: Readonly<Record<string, number>> = {
  head: 0,
  face: 1,
  outer: 2,
  inner: 3,
  legs: 4,
  feet: 5,
};

/** 义体中文部位名 → 2077 原作部位回退图标 */
const CHROME_SLOT_ICON: Readonly<Record<string, AssetId>> = {
  额叶皮质: "cyber.frontalCortex",
  眼部: "cyber.eyes",
  神经系统: "cyber.nervous",
  操作系统: "cyber.os",
  循环系统: "cyber.circulatory",
  皮肤: "cyber.integumentary",
  骨骼: "cyber.skeleton",
  手部: "cyber.hands",
  手臂: "cyber.arms",
  腿部: "cyber.legs",
};

/** 物品/义体/衣着统一缩略图槽：切角细框 + 专图或按部位/类型回退原作图标 */
function SlotThumb({
  art,
  fallback,
  alt,
  size = "md",
  tint = "var(--slot-accent, var(--cp-cyan))",
}: {
  readonly art: AssetId | null | undefined;
  readonly fallback: AssetId;
  readonly alt: string;
  readonly size?: "sm" | "md" | "wide";
  readonly tint?: string;
}) {
  const fallbackHeight = size === "sm" ? 18 : 24;
  return (
    <span className={styles.slotThumb} data-size={size} aria-hidden>
      <span className={styles.slotThumbGrid} style={{ backgroundImage: cssUrl("fx.grid") }} />
      {art ? (
        <Asset id={art} alt={alt} className={styles.slotThumbArt} />
      ) : (
        <Asset id={fallback} tint={tint} height={fallbackHeight} className={styles.slotThumbIcon} />
      )}
    </span>
  );
}

/** 扫描出的人性阶段转威胁档位 */
export function threatOfHumanity(stage: string): "high" | "even" | "low" {
  if (stage === "边缘" || stage === "临界" || stage === "危机") return "high";
  if (stage === "不稳定" || stage === "疏离") return "even";
  return "low";
}

/** 好感度语气档位 */
export function affinityTone(affinity: number): "pos" | "neg" | "neutral" {
  if (affinity >= 20) return "pos";
  if (affinity <= -10) return "neg";
  return "neutral";
}

/** 带符号的好感度文本 */
export function formatAffinity(affinity: number): string {
  return affinity > 0 ? `+${affinity}` : `${affinity}`;
}

/** 人物关系/战斗态势的统一边框语气 */
export function profileTone(
  npc: Pick<Npc, "met" | "affinity" | "nemesis" | "following">,
  foe?: CombatFoe,
): "hostile" | "nemesis" | "ally" | undefined {
  if (foe) return "hostile";
  if (npc.nemesis && !npc.nemesis.ended) return "nemesis";
  if (npc.following || (npc.met && npc.affinity >= 50)) return "ally";
  return undefined;
}

/** 共用双向好感刻度条（原作 cyber.gaugeBar，0 为中线，正黄负红） */
export function AffinityMeter({
  affinity,
  className,
}: {
  readonly affinity: number;
  readonly className?: string | undefined;
}) {
  const fill = Math.min(1, Math.abs(affinity) / AFFINITY_MAX);
  return (
    <span
      className={className ? `${styles.affinity} ${className}` : styles.affinity}
      data-neg={affinity < 0 || undefined}
      style={{ "--fill": fill } as CSSProperties}
      aria-hidden
    >
      <NineSlice
        id="cyber.gaugeBar"
        tint={affinity < 0 ? "rgb(255 97 88 / 32%)" : "rgb(94 246 255 / 32%)"}
        slice={0}
      />
      <span className={styles.affinityFill}>
        <NineSlice
          id="cyber.gaugeBar"
          tint={affinity < 0 ? "var(--cp-red)" : "var(--cp-yellow)"}
          slice={0}
        />
      </span>
    </span>
  );
}

/**
 * 切角头像格：有原作头像用原作图，未照面且无原作头像时显示 portrait.unknown 全息轮廓，
 * 认识但无原作头像的显示名字首字；框用原作 map.filterCell*
 */
export function NpcPortrait({
  npc,
  className,
  artClassName,
  line = "var(--cp-cyan)",
  tint = "var(--cp-surface)",
}: {
  readonly npc: Pick<Npc, "id" | "name" | "met" | "alive">;
  readonly className?: string | undefined;
  readonly artClassName?: string | undefined;
  readonly line?: string;
  readonly tint?: string;
}) {
  const saveImages = useSaveImages();
  const customId = saveImages?.bindings.npcs[npc.id] ?? null;
  const portrait = portraitOf(npc.id);
  return (
    <span className={className} data-dead={!npc.alive || undefined} aria-hidden>
      <NineSlice id="map.filterCellBg" tint={tint} slice={CELL_SLICE} />
      {customId ? (
        <GeneratedImage
          imageId={customId}
          alt={npc.name}
          className={artClassName}
          fallback={
            portrait ? (
              <Asset id={portrait} className={artClassName} />
            ) : !npc.met ? (
              <Asset id="portrait.unknown" className={artClassName} />
            ) : (
              <b className={artClassName}>{[...npc.name][0] ?? "?"}</b>
            )
          }
        />
      ) : portrait ? (
        <Asset id={portrait} className={artClassName} />
      ) : !npc.met ? (
        <Asset id="portrait.unknown" className={artClassName} />
      ) : (
        <b className={artClassName}>{[...npc.name][0] ?? "?"}</b>
      )}
      <NineSlice id="map.filterCellFg" tint={line} slice={CELL_SLICE} />
    </span>
  );
}

function whereabouts(npc: Npc): string {
  if (!npc.alive) return "已故";
  if (!npc.met) return npc.nemesis ? "交过手" : "只听说过";
  if (npc.here) return "在场";
  return npc.lastSeen ? `最后见面 ${npc.lastSeen}` : "不在场";
}

function Tag({
  tone = "cyan",
  solid,
  title,
  children,
}: {
  readonly tone?: "cyan" | "yellow" | "red" | "danger" | "dim";
  readonly solid?: boolean | undefined;
  readonly title?: string | undefined;
  readonly children: string;
}) {
  return (
    <li className={styles.tag} data-tone={tone} data-solid={solid || undefined} title={title}>
      <b>{children}</b>
    </li>
  );
}

function openPortraitGenerator(
  saveImages: NonNullable<ReturnType<typeof useSaveImages>>,
  npc: Npc,
  woundDetail: string | null,
  customPortraitId: string | null,
) {
  saveImages.openImageModal({
    title: customPortraitId ? `重绘 ${npc.name} 肖像` : `AI 生成 ${npc.name} 肖像`,
    subtitle: [npc.role, npc.faction && npc.faction !== "无" ? npc.faction : ""]
      .filter(Boolean)
      .join(" · "),
    defaultAspectRatio: "3:4",
    bind: { kind: "npc", npcId: npc.id },
    promptRequest: {
      kind: "npc",
      name: npc.name,
      alias: npc.alias,
      pronoun: npc.pronoun,
      role: npc.role,
      faction: npc.faction,
      look: npc.look,
      outfit: [
        npc.outfit,
        (
          npc.body?.gear.filter((item) => item.kind === "clothing").map((item) => item.name) ?? []
        ).join("、"),
      ]
        .filter(Boolean)
        .join("；"),
      wounds: woundDetail,
      cyberware: npc.body?.scan?.chrome.map((item) => item.name) ?? [],
      gear:
        npc.body?.gear.filter((item) => item.kind !== "clothing").map((item) => item.name) ?? [],
      instruction: "",
    },
  });
}

/**
 * 独立紧凑身份卡：供手机联系人悬停卡复用（embedded = false）。
 */
export function ProfileHead({
  npc,
  fixer,
  foe,
  embedded = false,
}: {
  readonly npc: Npc;
  readonly fixer?: Fixer | undefined;
  readonly foe?: CombatFoe | undefined;
  readonly embedded?: boolean | undefined;
}) {
  const tone = profileTone(npc, foe);
  const wound = npcWoundSummary(npc.body);
  const hasFaction = Boolean(npc.faction && npc.faction !== "无");
  const showLastPlace = !npc.here && Boolean(npc.lastPlace);
  const showBlocked = Boolean(fixer?.blocked && fixer.blockReason);
  const metaRows: readonly (readonly [string, string])[] = [
    ...(hasFaction && npc.faction ? ([["势力", npc.faction]] as const) : []),
    ...(showLastPlace && npc.lastPlace ? ([["最后出现", npc.lastPlace]] as const) : []),
    ...(npc.homePlace ? ([["常在地点", npc.homePlace]] as const) : []),
    ...(npc.doing ? ([["近期动向", npc.doing]] as const) : []),
    ...(showBlocked && fixer?.blockReason ? ([["中间人渠道", fixer.blockReason]] as const) : []),
  ];
  const hasStructuredClothes = Boolean(npc.body?.gear.some((item) => item.kind === "clothing"));
  const showOutfitText = Boolean(npc.outfit && !hasStructuredClothes);
  const hasAppearance = npc.met && Boolean(npc.look || showOutfitText);
  const saveImages = useSaveImages();
  const customPortraitId = saveImages?.bindings.npcs[npc.id] ?? null;
  const hasBuiltinPortrait = Boolean(portraitOf(npc.id));

  return (
    <header
      className={embedded ? styles.head : `${styles.head} ${styles.headStandalone}`}
      data-tone={tone}
      data-dead={!npc.alive || undefined}
    >
      <NineSlice
        id="dialog.lineSelect"
        tint="var(--head-bg, var(--cp-surface))"
        slice={HEAD_SLICE}
      />
      <NineSlice
        id="panel.glowLeft"
        tint="var(--head-glow, rgb(94 246 255 / 12%))"
        slice={[16, 20, 16, 20]}
        className={styles.headGlow}
      />
      <NineSlice
        id="cyber.cellRarity"
        tint="var(--portrait-line, var(--cp-cyan))"
        slice={0}
        className={styles.headRail}
      />
      <span
        className={styles.headGrid}
        style={{ backgroundImage: cssUrl("fx.grid") }}
        aria-hidden
      />

      <div className={styles.headTop}>
        <div className={styles.portraitCol}>
          {customPortraitId && saveImages ? (
            <button
              type="button"
              className={styles.portraitBtn}
              title={`查看大图：${npc.name}`}
              onClick={() => saveImages.openLightbox(customPortraitId, `${npc.name} · 肖像`)}
            >
              <NpcPortrait
                npc={npc}
                className={styles.portrait}
                artClassName={styles.portraitArt}
                line="var(--portrait-line, var(--cp-cyan))"
              />
            </button>
          ) : (
            <NpcPortrait
              npc={npc}
              className={styles.portrait}
              artClassName={styles.portraitArt}
              line="var(--portrait-line, var(--cp-cyan))"
            />
          )}
        </div>
        <div className={styles.identity}>
          <div className={styles.nameBlock}>
            <h3 className={styles.name}>
              <span>{npc.name}</span>
              {npc.pronoun && <small className={styles.pronoun}>{npc.pronoun}</small>}
            </h3>
            {npc.alias && <span className={styles.aliasLine}>{`// ${npc.alias}`}</span>}
          </div>
          <ul className={styles.tags}>
            <Tag tone={npc.alive ? "cyan" : "dim"}>{whereabouts(npc)}</Tag>
            {foe && (
              <Tag tone="danger" solid>
                {foe.stateLabel}
              </Tag>
            )}
            {npc.nemesis && (
              <Tag tone="red" solid={!npc.nemesis.ended}>
                {npc.nemesis.ended ? "旧宿敌" : "宿敌"}
              </Tag>
            )}
            {npc.following && <Tag tone="yellow">同行中</Tag>}
            {fixer && <Tag tone="yellow">中间人</Tag>}
            {wound.badge && (
              <Tag
                tone={wound.threat === "high" ? "danger" : "yellow"}
                solid={wound.threat === "high"}
                title={wound.detail ?? undefined}
              >
                {wound.badge}
              </Tag>
            )}
          </ul>
        </div>
      </div>

      {npc.met ? (
        <div className={styles.brief}>
          <p className={styles.briefRole}>{npc.role}</p>
          {metaRows.length > 0 && (
            <dl className={styles.briefFacts}>
              {metaRows.map(([label, value]) => (
                <div key={label} className={styles.briefRow}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          )}
          <div className={styles.affinityBlock} data-tone={affinityTone(npc.affinity)}>
            <div className={styles.affinityTop}>
              <span>关系好感</span>
              <b className={styles.affinityVal} data-tone={affinityTone(npc.affinity)}>
                {formatAffinity(npc.affinity)}
              </b>
            </div>
            <AffinityMeter affinity={npc.affinity} className={styles.affinity} />
          </div>
        </div>
      ) : (
        <p className={styles.note}>
          {npc.nemesis ? "只在交手时照过面，底细还不清楚。" : "还没见过面，下面是听来的。"}
        </p>
      )}

      {hasAppearance && (
        <>
          <span
            className={styles.headRule}
            style={{ maskImage: cssUrl("tab.line"), WebkitMaskImage: cssUrl("tab.line") }}
            aria-hidden
          />
          <div className={styles.lookStrip}>
            {npc.look && (
              <p className={styles.look}>
                <em className={styles.lookKey}>外貌</em>
                <span>{npc.look}</span>
              </p>
            )}
            {showOutfitText && npc.outfit && (
              <p className={styles.look}>
                <em className={styles.lookKey}>衣着</em>
                <span>{npc.outfit}</span>
              </p>
            )}
          </div>
        </>
      )}

      {saveImages && npc.met && (
        <div className={styles.portraitTools}>
          <ActionButton
            onClick={() => openPortraitGenerator(saveImages, npc, wound.detail, customPortraitId)}
          >
            {customPortraitId ? "重绘肖像" : hasBuiltinPortrait ? "AI 定制肖像" : "AI 生成肖像"}
          </ActionButton>
          {customPortraitId && (
            <>
              <ActionButton
                onClick={() => saveImages.openLightbox(customPortraitId, `${npc.name} · 肖像`)}
              >
                查看大图
              </ActionButton>
              <ActionButton
                onClick={() => void saveImages.unbindImage({ kind: "npc", npcId: npc.id })}
              >
                恢复默认
              </ActionButton>
            </>
          )}
        </div>
      )}
    </header>
  );
}

/** 档案顶部通栏身份横幅：紧凑肖像 + 名称与关键状态 + 好感与克制细边指令组 */
function ProfileBanner({
  npc,
  fixer,
  foe,
  hackStatus,
  embedded = false,
  onScan,
  onCompanion,
  onDraftAction,
}: {
  readonly npc: Npc;
  readonly fixer?: Fixer | undefined;
  readonly foe?: CombatFoe | undefined;
  readonly hackStatus?: ProfileHackStatus | undefined;
  readonly embedded?: boolean | undefined;
  readonly onScan?: (() => void) | undefined;
  readonly onCompanion?: ((id: string, following: boolean) => void) | undefined;
  readonly onDraftAction?: ((text: string) => void) | undefined;
}) {
  const tone = profileTone(npc, foe);
  const wound = npcWoundSummary(npc.body);
  const scan = npc.body?.scan ?? null;
  const saveImages = useSaveImages();
  const customPortraitId = saveImages?.bindings.npcs[npc.id] ?? null;

  const hasFaction = Boolean(npc.faction && npc.faction !== "无");
  const subtitleBits = npc.met
    ? [
        npc.role,
        hasFaction ? npc.faction : null,
        !npc.here && npc.lastPlace ? `最后出现：${npc.lastPlace}` : null,
      ].filter(Boolean)
    : [npc.nemesis ? "只在交手时照过面，底细尚未建档" : "尚未照面的目标"];

  const canCompanionDirect =
    !npc.following && npc.alive && npc.met && npc.here && !foe && npc.affinity >= 15 && onCompanion;
  const canCompanionAsk =
    !npc.following &&
    npc.alive &&
    npc.met &&
    npc.here &&
    !foe &&
    npc.affinity < 15 &&
    onDraftAction;

  const draftPrompt = foe
    ? `盯紧 ${npc.name}，`
    : npc.following
      ? `向同行的 ${npc.name} 示意配合：`
      : `转向 ${npc.name}，`;
  const draftLabel = foe ? "针对行动" : npc.following ? "现场配合" : "互动";

  const scanTime =
    scan && scan.at > 0 ? worldRules.formatGameTime(scan.at) : scan ? "已建档" : null;
  const hasActions = Boolean(
    (onScan && npc.body) ||
      onDraftAction ||
      (npc.following && npc.alive && onCompanion) ||
      canCompanionDirect ||
      canCompanionAsk,
  );
  const humanityThreat = scan ? threatOfHumanity(scan.humanityStage) : undefined;

  return (
    <header
      className={embedded ? `${styles.banner} ${styles.bannerEmbedded}` : styles.banner}
      data-tone={tone}
      data-dead={!npc.alive || undefined}
    >
      {!embedded && (
        <>
          <NineSlice id="dialog.lineSelect" tint="var(--banner-bg)" slice={HEAD_SLICE} />
          <NineSlice
            id="panel.glowLeft"
            tint="var(--banner-glow)"
            slice={[16, 20, 16, 20]}
            className={styles.headGlow}
          />
          <NineSlice
            id="cyber.cellRarity"
            tint="var(--banner-line)"
            slice={0}
            className={styles.headRail}
          />
        </>
      )}

      <div className={styles.bannerMain}>
        <div className={styles.bannerPortraitWrap}>
          {customPortraitId && saveImages ? (
            <button
              type="button"
              className={styles.portraitBtn}
              title={`查看大图：${npc.name}`}
              onClick={() => saveImages.openLightbox(customPortraitId, `${npc.name} · 肖像`)}
            >
              <NpcPortrait
                npc={npc}
                className={styles.bannerPortrait}
                artClassName={styles.portraitArt}
                line="var(--banner-line)"
              />
            </button>
          ) : (
            <NpcPortrait
              npc={npc}
              className={styles.bannerPortrait}
              artClassName={styles.portraitArt}
              line="var(--banner-line)"
            />
          )}
          {saveImages && npc.met && (
            <span className={styles.portraitMicroTools}>
              <button
                type="button"
                className={styles.microToolBtn}
                title={customPortraitId ? `AI 重绘 ${npc.name} 肖像` : `AI 生成 ${npc.name} 肖像`}
                onClick={() =>
                  openPortraitGenerator(saveImages, npc, wound.detail, customPortraitId)
                }
              >
                {customPortraitId ? "重绘" : "AI 像"}
              </button>
              {customPortraitId && (
                <button
                  type="button"
                  className={styles.microToolBtn}
                  title="恢复默认肖像"
                  onClick={() => void saveImages.unbindImage({ kind: "npc", npcId: npc.id })}
                >
                  重置
                </button>
              )}
            </span>
          )}
        </div>

        <div className={styles.bannerIdentity}>
          <div className={styles.bannerNameLine}>
            <h3 className={styles.bannerName}>
              <span>{npc.name}</span>
              {npc.pronoun && <small className={styles.pronoun}>{npc.pronoun}</small>}
            </h3>
            {npc.alias && <span className={styles.aliasLine}>{`// ${npc.alias}`}</span>}
            <ul className={styles.tags}>
              {foe && (
                <Tag tone="danger" solid>
                  {foe.stateLabel}
                </Tag>
              )}
              {npc.nemesis && (
                <Tag tone="red" solid={!npc.nemesis.ended}>
                  {npc.nemesis.ended ? "旧宿敌" : "宿敌"}
                </Tag>
              )}
              {hackStatus?.breached && (
                <Tag
                  tone="cyan"
                  title={
                    hackStatus.breachedVia
                      ? `已捅穿个人黑冰（经${hackStatus.breachedVia}），可上传终极神经接管`
                      : "已捅穿个人黑冰建立立足点"
                  }
                >
                  已破冰
                </Tag>
              )}
              {hackStatus?.activeEffects.map((eff) => (
                <Tag key={eff} tone="yellow" title={`当前正在该目标身上生效的快速破解：${eff}`}>
                  {eff}
                </Tag>
              ))}
              {npc.following && <Tag tone="yellow">同行中</Tag>}
              {fixer && <Tag tone="yellow">中间人</Tag>}
              {!npc.alive && <Tag tone="dim">已故</Tag>}
              {npc.behaviorChip && npc.alive && (
                <Tag
                  tone={
                    npc.behaviorChip.mode === "glitch"
                      ? "danger"
                      : npc.behaviorChip.mode === "doll" || npc.behaviorChip.mode === "protocol"
                        ? "yellow"
                        : "cyan"
                  }
                  solid={npc.behaviorChip.mode === "glitch"}
                  title={[
                    `行为芯片：${npc.behaviorChip.name}`,
                    `当前状态：${npc.behaviorChip.label}`,
                    npc.behaviorChip.protocol ? `运行协议：${npc.behaviorChip.protocol}` : null,
                    npc.behaviorChip.memoryGap ? "存在托管时段记忆断层" : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                >
                  {npc.behaviorChip.protocol
                    ? `${npc.behaviorChip.label} · ${npc.behaviorChip.protocol}`
                    : `芯片 · ${npc.behaviorChip.label}`}
                </Tag>
              )}
              {wound.badge && (
                <Tag
                  tone={wound.threat === "high" ? "danger" : "yellow"}
                  solid={wound.threat === "high"}
                  title={wound.detail ?? undefined}
                >
                  {wound.badge}
                </Tag>
              )}
            </ul>
            {npc.met && (
              <div
                className={styles.bannerAffinity}
                title={`关系好感 ${formatAffinity(npc.affinity)}`}
              >
                <span className={styles.bannerAffinityLabel}>好感</span>
                <AffinityMeter affinity={npc.affinity} className={styles.bannerMeter} />
                <b className={styles.affinityVal} data-tone={affinityTone(npc.affinity)}>
                  {formatAffinity(npc.affinity)}
                </b>
              </div>
            )}
          </div>

          <p className={styles.bannerSubtitle}>{subtitleBits.join(" · ")}</p>

          {(npc.body || hasActions) && (
            <div className={styles.bannerFootRow}>
              {npc.body && (
                <div className={styles.inlineTelemetry}>
                  <span className={styles.teleItem}>
                    <em>体征</em>
                    <b data-threat={wound.threat}>{wound.headline}</b>
                  </span>
                  {scan && (
                    <>
                      <span className={styles.teleSep} aria-hidden>
                        ·
                      </span>
                      <span className={styles.teleItem}>
                        <em>威胁</em>
                        <b data-threat={scan.threat}>{scan.threatLabel}</b>
                      </span>
                      <span className={styles.teleSep} aria-hidden>
                        ·
                      </span>
                      <span className={styles.teleItem}>
                        <em>神经</em>
                        <b data-threat={humanityThreat}>{scan.humanityStage}</b>
                      </span>
                    </>
                  )}
                </div>
              )}

              {hasActions && (
                <div className={styles.bannerActions}>
                  {onScan && npc.body && (
                    <button
                      type="button"
                      className={styles.cmdBtn}
                      data-highlight={!scan || undefined}
                      title={
                        scanTime
                          ? `上次扫描：${scanTime}，点击重新扫描（不消耗回合）`
                          : "启动 Kiroshi 义眼扫描，即时透视义体与弱点（不消耗回合）"
                      }
                      onClick={onScan}
                    >
                      <Asset id="interaction.scan" tint="currentColor" height={12} />
                      <span>{scan ? "复扫" : "义眼扫描"}</span>
                    </button>
                  )}
                  {onDraftAction && (
                    <button
                      type="button"
                      className={styles.cmdBtn}
                      data-tone="yellow"
                      onClick={() => onDraftAction(draftPrompt)}
                    >
                      <span>{draftLabel}</span>
                    </button>
                  )}
                  {npc.following && npc.alive && onCompanion && (
                    <button
                      type="button"
                      className={styles.cmdBtn}
                      data-tone="dim"
                      onClick={() => onCompanion(npc.id, false)}
                    >
                      <span>暂别留守</span>
                    </button>
                  )}
                  {canCompanionDirect && (
                    <button
                      type="button"
                      className={styles.cmdBtn}
                      onClick={() => onCompanion(npc.id, true)}
                    >
                      <span>结伴同行</span>
                    </button>
                  )}
                  {canCompanionAsk && (
                    <button
                      type="button"
                      className={styles.cmdBtn}
                      data-tone="dim"
                      title="好感尚浅，需在剧情中谈妥条件后同行"
                      onClick={() => onDraftAction(`开口约 ${npc.name} 一起同行：`)}
                    >
                      <span>邀其同行</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

/**
 * 现场透视：沿用 BiomonitorPanel / CyberdeckPage 原生 2077 语言——
 * 外层红框 CellFrame 诊断卡 + subRows 键值表 + 双列 qh.cell 切角插槽（无左侧竖色条、无假图标框、不拉长）。
 */
function ScanTacticalView({
  npc,
  body,
  foe,
  hackStatus,
  onDraftAction,
}: {
  readonly npc: Npc;
  readonly body: NonNullable<Npc["body"]>;
  readonly foe?: CombatFoe | undefined;
  readonly hackStatus?: ProfileHackStatus | undefined;
  readonly onDraftAction?: ((text: string) => void) | undefined;
}) {
  const { scan } = body;
  const injuries = body.injuries ?? [];
  const chrome = scan?.chrome ?? [];
  const weapons = body.gear.filter((item) => item.kind === "weapon");
  const carried = body.gear.filter((item) => item.kind !== "clothing" && item.kind !== "weapon");
  const arsenal: readonly {
    readonly item: NpcGearItem;
    readonly tone: "weapon" | "item";
  }[] = [
    ...weapons.map((item) => ({ item, tone: "weapon" as const })),
    ...carried.map((item) => ({ item, tone: "item" as const })),
  ];
  const clothes = [...body.gear]
    .filter((item) => item.kind === "clothing")
    .sort(
      (a, b) =>
        (CLOTHING_SLOT_INDEX[a.clothingSlot ?? ""] ?? 99) -
        (CLOTHING_SLOT_INDEX[b.clothingSlot ?? ""] ?? 99),
    );

  const netTone =
    hackStatus?.breached || scan?.netStatus === "open"
      ? "good"
      : scan?.netStatus === "selfIce" || scan?.netStatus === "netrunner"
        ? "bad"
        : "cyan";

  const scanClock =
    scan && scan.at > 0
      ? (worldRules.formatGameTime(scan.at).split(" ").pop() ?? worldRules.formatGameTime(scan.at))
      : null;

  return (
    <section className={styles.tacticalRoot} aria-label="现场透视">
      {/* 卡 1：光学链路、创口与表观装备汇总（subRows 紧凑行，零竖色条） */}
      <section className={styles.card} aria-label="光学与表观态势">
        <CellFrame />
        <div className={styles.cardHead}>
          <span className={styles.cardLabel}>OPTICS {"//"} 链路 · 创口 · 表观</span>
          <span className={styles.cardValue} data-tone={scan ? "cyan" : undefined}>
            {scan ? (scanClock ? `SCAN ${scanClock}` : "OPTICS ONLINE") : "STANDBY"}
          </span>
        </div>
        <div className={styles.subRows}>
          <div className={styles.subRow}>
            <span className={styles.subKey}>骇入防线</span>
            <span className={styles.subVal} data-tone={scan ? netTone : undefined}>
              {scan ? scan.netLabel : "待扫描 · 点击上方「义眼扫描」即时透视防线、植入体与弱点"}
            </span>
          </div>
          {hackStatus && (
            <div className={styles.subRow}>
              <span className={styles.subKey}>电子战态势</span>
              <span className={styles.subVal} data-tone="cyan">
                {[
                  hackStatus.breached
                    ? hackStatus.breachedVia
                      ? `已破冰（经${hackStatus.breachedVia}）`
                      : "已破冰（立足点）"
                    : null,
                  ...hackStatus.activeEffects.map((eff) => `生效中：${eff}`),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </div>
          )}
          {injuries.length > 0 && (
            <div className={styles.subRow}>
              <span className={styles.subKey}>具体创口</span>
              <span className={styles.subVal} data-tone="warn">
                {injuries
                  .map(
                    (inj) =>
                      `${inj.partLabel}·${inj.cause}（${inj.tierLabel}${inj.treated ? "/已处理" : ""}）`,
                  )
                  .join(" ｜ ")}
              </span>
            </div>
          )}
          {foe && foe.carry.length > 0 && (
            <div className={styles.subRow} data-block>
              <span className={styles.subKey}>可见掉落</span>
              <div className={styles.inlineVisualList}>
                {foe.carry.map((carryItem) => {
                  const baseId = carryItem.baseId ?? carryItem.id;
                  const art = itemArtOf(baseId);
                  return (
                    <span key={carryItem.id} className={styles.inlineVisualChip} data-tone="warn">
                      <SlotThumb
                        art={art}
                        fallback="notify.inventory"
                        alt={carryItem.name}
                        size="sm"
                        tint="var(--cp-yellow)"
                      />
                      <span className={styles.inlineChipText}>{carryItem.name}</span>
                    </span>
                  );
                })}
              </div>
            </div>
          )}
          {clothes.length > 0 && (
            <div className={styles.subRow} data-block>
              <span className={styles.subKey}>穿戴衣着</span>
              <div className={styles.inlineVisualList}>
                {clothes.map((item) => {
                  const baseId = item.baseId ?? item.id;
                  const art = itemArtOf(baseId);
                  const tooltip = [item.subLabel, item.name, item.rarityLabel, item.ability]
                    .filter(Boolean)
                    .join("\n");
                  return (
                    <span
                      key={item.id}
                      className={styles.inlineVisualChip}
                      data-rarity={item.rarity ?? undefined}
                      title={tooltip}
                    >
                      <SlotThumb
                        art={art}
                        fallback="map.poi.clothes"
                        alt={item.name}
                        size="sm"
                        tint="var(--rarity, var(--cp-cyan))"
                      />
                      <span className={styles.inlineChipCopy}>
                        {item.subLabel && (
                          <em className={styles.inlineChipSlot}>{item.subLabel}</em>
                        )}
                        <span className={styles.inlineChipText}>{item.name}</span>
                      </span>
                    </span>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* 卡 2：战术弱点（双列 qh.cell 切角插槽） */}
      {scan && scan.tips.length > 0 && (
        <section className={styles.card} aria-label="战术弱点">
          <CellFrame />
          <div className={styles.cardHead}>
            <span className={styles.cardLabel}>WEAKNESS {"//"} 战术突破口</span>
            <span className={styles.cardValue} data-tone="warn">
              {scan.tips.length} 处弱点
            </span>
          </div>
          <div className={styles.progGrid}>
            {scan.tips.map((tip, idx) => {
              const indexCode = String(idx + 1).padStart(2, "0");
              return (
                <div key={tip} className={styles.progCell} data-tone="warn" title={tip}>
                  <TacticalCellFrame tone="warn" />
                  <div className={styles.progTop}>
                    <span className={styles.progIdent}>
                      <span className={styles.slotIndex}>{indexCode}</span>
                      <strong className={styles.progName}>战术弱点</strong>
                    </span>
                    {onDraftAction && (
                      <button
                        type="button"
                        className={styles.slotAction}
                        data-tone="warn"
                        onClick={() => onDraftAction(`针对 ${npc.name} 的弱点（${tip}），`)}
                      >
                        <NineSlice
                          id="tab.bg"
                          tint="currentColor"
                          slice={14}
                          className={styles.actionBg}
                        />
                        <span>采用</span>
                      </button>
                    )}
                  </div>
                  <p className={styles.progDesc}>{tip}</p>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* 卡 3：已检出义体（双列 qh.cell 切角插槽 + 2077 义体实图） */}
      {scan && (
        <section className={styles.card} aria-label="已检出义体">
          <CellFrame />
          <div className={styles.cardHead}>
            <span className={styles.cardLabel}>CYBERWARE {"//"} 已检出植入体</span>
            <span className={styles.cardValue}>{chrome.length} 件</span>
          </div>
          {chrome.length > 0 ? (
            <div className={styles.progGrid}>
              {chrome.map((c: NpcChromeItem, idx) => {
                const indexCode = String(idx + 1).padStart(2, "0");
                const art = itemArtOf(c.id);
                const fallbackIcon: AssetId = CHROME_SLOT_ICON[c.slot] ?? "cyber.os";
                const tooltip = [c.name, c.slot, c.ability].filter(Boolean).join("\n");
                return (
                  <div
                    key={c.id}
                    className={styles.progCell}
                    data-has-thumb
                    data-tone={c.netTag === "selfIce" ? "warn" : undefined}
                    title={tooltip}
                  >
                    <TacticalCellFrame tone={c.netTag === "selfIce" ? "warn" : "default"} />
                    <SlotThumb
                      art={art}
                      fallback={fallbackIcon}
                      alt={c.name}
                      tint={c.netTag === "selfIce" ? "var(--cp-yellow)" : "var(--cp-cyan)"}
                    />
                    <div className={styles.progBody}>
                      <div className={styles.progTop}>
                        <span className={styles.progIdent}>
                          <span className={styles.slotIndex}>{indexCode}</span>
                          <strong className={styles.progName}>{c.name}</strong>
                        </span>
                        {onDraftAction && (
                          <button
                            type="button"
                            className={styles.slotAction}
                            onClick={() =>
                              onDraftAction(`针对 ${npc.name} 的植入体「${c.name}」，`)
                            }
                          >
                            <NineSlice
                              id="tab.bg"
                              tint="currentColor"
                              slice={14}
                              className={styles.actionBg}
                            />
                            <span>针对</span>
                          </button>
                        )}
                      </div>
                      {(c.slot || c.netTag) && (
                        <div className={styles.progMeta}>
                          {c.slot && <span className={styles.metaItem}>{c.slot}</span>}
                          {c.netTag === "deck" && <span className={styles.metaItem}>接入仓</span>}
                          {c.netTag === "selfIce" && (
                            <span className={styles.metaItem} data-tone="warn">
                              自我 ICE
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                    {c.ability && <p className={styles.progDesc}>{c.ability}</p>}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className={styles.emptyNote}>未检出可识别义体，属低改或纯肉身目标。</p>
          )}
        </section>
      )}

      {/* 卡 4：随身武装与物品合并双列切角插槽（附 2077 武器/物品实图） */}
      {arsenal.length > 0 && (
        <section className={styles.card} aria-label="随身武装与物品">
          <CellFrame />
          <div className={styles.cardHead}>
            <span className={styles.cardLabel}>ARSENAL {"//"} 随身武装与物品</span>
            <span className={styles.cardValue}>{arsenal.length} 件</span>
          </div>
          <div className={styles.progGrid}>
            {arsenal.map(({ item, tone }, idx) => {
              const indexCode = String(idx + 1).padStart(2, "0");
              const baseId = item.baseId ?? item.id;
              const art = itemArtOf(baseId);
              const fallbackIcon: AssetId =
                tone === "weapon" ? weaponHudIconOf(baseId, item.subLabel) : "notify.inventory";
              const label = item.name.startsWith("wpn:") ? baseWeaponIdOf(item.name) : item.name;
              const draftPrompt =
                tone === "weapon"
                  ? `盯着 ${npc.name} 身上的「${label}」，`
                  : `留意 ${npc.name} 随身带着的「${label}」，`;
              const tooltip = [label, item.subLabel, item.rarityLabel, item.ability]
                .filter(Boolean)
                .join("\n");
              return (
                <div
                  key={item.id}
                  className={styles.progCell}
                  data-has-thumb
                  data-tone={item.iconic ? "warn" : tone === "weapon" ? "danger" : undefined}
                  data-rarity={item.rarity ?? undefined}
                  title={tooltip}
                >
                  <TacticalCellFrame
                    tone={item.iconic ? "warn" : tone === "weapon" ? "danger" : "default"}
                  />
                  <SlotThumb
                    art={art}
                    fallback={fallbackIcon}
                    alt={label}
                    size={tone === "weapon" ? "wide" : "md"}
                    tint={
                      item.iconic
                        ? "var(--rar-iconic, var(--cp-yellow))"
                        : "var(--rarity, var(--slot-accent, var(--cp-cyan)))"
                    }
                  />
                  <div className={styles.progBody}>
                    <div className={styles.progTop}>
                      <span className={styles.progIdent}>
                        <span className={styles.slotIndex}>{indexCode}</span>
                        <strong className={styles.progName}>{label}</strong>
                      </span>
                      {onDraftAction && (
                        <button
                          type="button"
                          className={styles.slotAction}
                          data-tone={tone === "weapon" ? "danger" : "warn"}
                          onClick={() => onDraftAction(draftPrompt)}
                        >
                          <NineSlice
                            id="tab.bg"
                            tint="currentColor"
                            slice={14}
                            className={styles.actionBg}
                          />
                          <span>{tone === "weapon" ? "盯防" : "留意"}</span>
                        </button>
                      )}
                    </div>
                    {(item.subLabel || item.rarityLabel || item.iconic) && (
                      <div className={styles.progMeta}>
                        {item.subLabel && <span className={styles.metaItem}>{item.subLabel}</span>}
                        {item.rarityLabel && (
                          <span className={styles.metaItem} data-rarity>
                            {item.rarityLabel}
                          </span>
                        )}
                        {item.iconic && (
                          <span className={styles.metaItem} data-tone="warn">
                            不朽
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  {item.ability && <p className={styles.progDesc}>{item.ability}</p>}
                </div>
              );
            })}
          </div>
        </section>
      )}
    </section>
  );
}

/** 档案与关系页：统一使用 2077 CellFrame 诊断卡 + subRows 键值与时间轴行 */
function DossierSection({
  npc,
  fixer,
  foe,
}: {
  readonly npc: Npc;
  readonly fixer?: Fixer | undefined;
  readonly foe?: CombatFoe | undefined;
}) {
  const unsettledLedger = npc.ledger.filter((e) => e.settled === null);
  const settledLedger = npc.ledger.filter((e) => e.settled !== null);
  const concerns = npc.arc?.concerns ?? [];
  const hasMemories = npc.ledger.length > 0 || npc.memories.length > 0;
  const hasKnownInfo = npc.known.length > 0 || concerns.length > 0;
  const hasTies = npc.ties.length > 0;

  const tone = profileTone(npc, foe);
  const relationTone =
    tone === "hostile" || tone === "nemesis"
      ? "bad"
      : tone === "ally" || npc.affinity >= 20
        ? "warn"
        : "cyan";

  const showBlocked = Boolean(fixer?.blocked && fixer.blockReason);
  const hasStructuredClothes = Boolean(npc.body?.gear.some((item) => item.kind === "clothing"));
  const showOutfitText = Boolean(npc.outfit && !hasStructuredClothes);
  const facts: readonly (readonly [string, string, ("bad" | "warn" | "cyan")?])[] = [
    ...(npc.nemesis
      ? ([
          [
            npc.nemesis.ended ? "旧宿敌恩怨" : "宿敌恩怨",
            `${npc.nemesis.since}：${npc.nemesis.how}${npc.nemesis.ended ? `（结局：${npc.nemesis.ended}）` : npc.nemesis.prep ? `（动向：${npc.nemesis.prep}）` : ""}`,
            "bad",
          ],
        ] as const)
      : []),
    ...(npc.homePlace ? ([["常在地点", npc.homePlace]] as const) : []),
    ...(npc.doing ? ([["近期动向", npc.doing, "cyan"]] as const) : []),
    ...(!npc.here && npc.lastPlace ? ([["最后出现", npc.lastPlace]] as const) : []),
    ...(showBlocked && fixer?.blockReason
      ? ([["中间人渠道", fixer.blockReason, "warn"]] as const)
      : []),
    ...(npc.met && npc.look ? ([["外貌特征", npc.look]] as const) : []),
    ...(npc.met && showOutfitText && npc.outfit ? ([["日常衣着", npc.outfit]] as const) : []),
  ];

  const totalRecords =
    npc.ledger.length + npc.memories.length + npc.known.length + concerns.length + npc.ties.length;

  return (
    <section className={styles.dossierStack} aria-label="档案与关系">
      {/* 卡 1：关系定性与背景档案 */}
      <section className={styles.card} aria-label="关系与背景">
        <CellFrame />
        <div className={styles.cardHead}>
          <span className={styles.cardLabel}>RELATION {"//"} 关系与背景档案</span>
          <span className={styles.cardValue} data-tone={relationTone}>
            {npc.met ? `好感 ${formatAffinity(npc.affinity)}` : "未正式照面"}
          </span>
        </div>
        <p className={styles.relationCopy} data-tone={relationTone}>
          {npc.relation ?? "还说不上什么关系。"}
        </p>
        {facts.length > 0 && (
          <div className={styles.subRows}>
            {facts.map(([label, value, rowTone]) => (
              <div key={label} className={styles.subRow}>
                <span className={styles.subKey}>{label}</span>
                <span className={styles.subVal} data-tone={rowTone}>
                  {value}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 卡 2：共同记忆、已知情报与人际脉络 */}
      {(hasMemories || hasKnownInfo || hasTies) && (
        <section className={styles.card} aria-label="记忆与情报记录">
          <CellFrame />
          <div className={styles.cardHead}>
            <span className={styles.cardLabel}>CHRONICLE {"//"} 记忆 · 情报 · 人脉</span>
            <span className={styles.cardValue}>{totalRecords} 条记录</span>
          </div>
          <div className={styles.subRows}>
            {unsettledLedger.map((e) => (
              <div key={`${e.at}|${e.kind}|${e.text}`} className={styles.dossierRow}>
                <span className={styles.kind} data-tone={e.kind === "grudge" ? "danger" : "accent"}>
                  {e.label}
                </span>
                <span className={styles.listBody}>{e.text}</span>
                <small>{e.at} · 未了结</small>
              </div>
            ))}
            {npc.memories.map((m) => (
              <div key={m} className={styles.dossierRow}>
                <span className={styles.kind} data-tone="memory">
                  记忆
                </span>
                <span className={styles.listBody}>{m}</span>
              </div>
            ))}
            {settledLedger.map((e) => (
              <div key={`${e.at}|${e.kind}|${e.text}`} className={styles.dossierRow} data-settled>
                <span className={styles.kind} data-tone={e.kind === "grudge" ? "danger" : "accent"}>
                  {e.label}
                </span>
                <span className={styles.listBody}>{e.text}</span>
                <small>
                  {e.at} · {e.settled}了结{e.how ? `：${e.how}` : ""}
                </small>
              </div>
            ))}
            {npc.known.map((k) => (
              <div key={k.text} className={styles.dossierRow}>
                <span className={styles.kind}>{k.sourceLabel}</span>
                <span className={styles.listBody}>{k.text}</span>
                <small>{k.at}</small>
              </div>
            ))}
            {concerns.map((c) => (
              <div key={c.id} className={styles.dossierRow}>
                <span className={styles.kind} data-tone="warn">
                  心事 · {c.statusLabel}
                </span>
                <span className={styles.listBody}>{c.title}</span>
                {c.outcome && <small>{c.outcome}</small>}
              </div>
            ))}
            {npc.ties.map((t) => (
              <div key={t.id} className={styles.dossierRow} data-settled={!t.alive || undefined}>
                <span className={styles.kind} data-tone="tie">
                  人脉 · {t.name}
                </span>
                <span className={styles.listBody}>{t.text}</span>
                {!t.alive && <small>已故</small>}
              </div>
            ))}
          </div>
        </section>
      )}
    </section>
  );
}

type TabId = "tactical" | "dossier";
type Tab = readonly [TabId, string, number];

function profileTabs(npc: Npc): Tab[] {
  const tabs: Tab[] = [];
  if (npc.body) {
    const scan = npc.body.scan;
    const tacticalCount = (scan?.chrome.length ?? 0) + npc.body.injuries.length;
    tabs.push(["tactical", "现场透视", tacticalCount]);
  }
  const dossierAlerts =
    npc.ledger.filter((e) => e.settled === null).length +
    (npc.nemesis && !npc.nemesis.ended ? 1 : 0);
  tabs.push(["dossier", "档案与关系", dossierAlerts]);
  return tabs;
}

/**
 * 人物档案：
 * 顶行合并单层双页签（现场透视 / 档案与关系）+ 可选右侧工具插槽（目标快切 / 关闭），
 * 下接紧凑通栏身份条与通透内容区，零厚黑卡片、零多层叠头。
 */
export function Profile({
  npc,
  fixer,
  foe,
  hackStatus,
  embedded = false,
  headerSlot,
  topSlot,
  onScan,
  onCompanion,
  onDraftAction,
}: {
  readonly npc: Npc;
  readonly fixer?: Fixer | undefined;
  readonly foe?: CombatFoe | undefined;
  readonly hackStatus?: ProfileHackStatus | undefined;
  /** 嵌入外层人物展开框时去掉内层重复的九宫格边框 */
  readonly embedded?: boolean | undefined;
  /** 位于分栏页签上方的顶行控制条（如在场目标切换 + 收起按钮） */
  readonly headerSlot?: ReactNode;
  /** 嵌入页签栏右侧的附属控件（如人物面板里的连线状态与定位操作） */
  readonly topSlot?: ReactNode;
  readonly onScan?: ((id: string) => void) | undefined;
  readonly onCompanion?: ((id: string, following: boolean) => void) | undefined;
  readonly onDraftAction?: ((text: string) => void) | undefined;
}) {
  const tabs = profileTabs(npc);
  const [pickedByNpc, setPickedByNpc] = useState<{
    readonly npcId: string;
    readonly tab: TabId;
  } | null>(null);
  const fallback: TabId =
    npc.body && (npc.here || Boolean(foe) || !npc.met) ? "tactical" : "dossier";
  const wanted = pickedByNpc?.npcId === npc.id ? pickedByNpc.tab : fallback;
  const tab = tabs.some(([id]) => id === wanted) ? wanted : (tabs[0]?.[0] ?? "dossier");

  return (
    <article className={styles.profile} aria-label={`${npc.name}的档案`}>
      {(headerSlot || tabs.length > 1 || topSlot) && (
        <div className={styles.topStack}>
          {headerSlot && <div className={styles.headerRow}>{headerSlot}</div>}
          {(tabs.length > 1 || topSlot) && (
            <div className={styles.topBar}>
              {tabs.length > 1 && (
                <nav className={styles.tabs} aria-label="档案分栏">
                  {tabs.map(([id, name, count]) => (
                    <button
                      key={id}
                      type="button"
                      className={neural.tab}
                      aria-pressed={id === tab}
                      data-danger={
                        (id === "dossier" &&
                          (Boolean(foe) || Boolean(npc.nemesis && !npc.nemesis.ended))) ||
                        (id === "tactical" && npcWoundSummary(npc.body).threat === "high") ||
                        undefined
                      }
                      onClick={() => setPickedByNpc({ npcId: npc.id, tab: id })}
                    >
                      <NineSlice
                        id="tab.bg"
                        tint="currentColor"
                        slice={14}
                        className={neural.tabBg}
                      />
                      <span className={neural.inner}>
                        {name}
                        {count > 0 && <b className={neural.badge}>{count}</b>}
                      </span>
                      {id === tab && (
                        <span
                          className={styles.tabActiveLine}
                          style={{
                            maskImage: cssUrl("tab.line"),
                            WebkitMaskImage: cssUrl("tab.line"),
                          }}
                          aria-hidden
                        />
                      )}
                    </button>
                  ))}
                </nav>
              )}
              {topSlot && <div className={styles.topSlot}>{topSlot}</div>}
            </div>
          )}
        </div>
      )}

      <ProfileBanner
        npc={npc}
        fixer={fixer}
        foe={foe}
        hackStatus={hackStatus}
        embedded={embedded}
        onScan={onScan && (() => onScan(npc.id))}
        onCompanion={onCompanion}
        onDraftAction={onDraftAction}
      />

      <div className={styles.pane} key={tab}>
        {tab === "tactical" && npc.body && (
          <ScanTacticalView
            npc={npc}
            body={npc.body}
            foe={foe}
            hackStatus={hackStatus}
            onDraftAction={onDraftAction}
          />
        )}
        {tab === "dossier" && <DossierSection npc={npc} fixer={fixer} foe={foe} />}
      </div>
    </article>
  );
}
