import { worldRules } from "@cp/core";
import { type CSSProperties, type ReactNode, useState } from "react";
import type { AssetId } from "../../assets";
import { ActionButton } from "../../ui/ActionButton";
import { Asset, cssUrl, NineSlice } from "../../ui/Asset";
import { CellFrame } from "../../ui/FrameBox";
import { GeneratedImage } from "../images/GeneratedImage";
import { useSaveImages } from "../images/SaveImagesContext";
import { baseWeaponIdOf, itemArtOf, portraitOf } from "./art";
import neural from "./neural.module.css";
import styles from "./profile.module.css";
import { npcWoundSummary, type View } from "./view";

type Npc = View["npcs"][number];
/** 中间人的派单信息（委托系统按好感、声望和势力算）；人物档案里同 id 的中间人才有 */
type Fixer = View["jobs"]["fixers"][number];
export type CombatFoe = NonNullable<View["combat"]["active"]>["foes"][number];

type NpcGearItem = NonNullable<Npc["body"]>["gear"][number];
type NpcChromeItem = NonNullable<NonNullable<Npc["body"]>["scan"]>["chrome"][number];

const CELL_SLICE = [20, 30, 30, 20] as const;
const HEAD_SLICE = [4, 20, 20, 4] as const;
/** 好感的范围，同 core 的 AFFINITY_MAX */
const AFFINITY_MAX = 100;

const CLOTHING_SLOT_INDEX: Readonly<Record<string, number>> = {
  head: 0,
  face: 1,
  outer: 2,
  inner: 3,
  legs: 4,
  feet: 5,
};

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
      className={className}
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
  embedded = false,
  onScan,
  onCompanion,
  onDraftAction,
}: {
  readonly npc: Npc;
  readonly fixer?: Fixer | undefined;
  readonly foe?: CombatFoe | undefined;
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
          </div>

          <p className={styles.bannerSubtitle}>{subtitleBits.join(" · ")}</p>

          {(npc.met || hasActions) && (
            <div className={styles.bannerFootRow}>
              {npc.met && (
                <div className={styles.bannerAffinity}>
                  <span className={styles.bannerAffinityLabel}>好感</span>
                  <AffinityMeter affinity={npc.affinity} className={styles.bannerMeter} />
                  <b className={styles.affinityVal} data-tone={affinityTone(npc.affinity)}>
                    {formatAffinity(npc.affinity)}
                  </b>
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

/** 原作物品缩略格：固定底框 + 细网格 + 专图或按类型回退矢量图标 */
function ItemThumb({
  art,
  fallback,
  alt,
  compact = false,
}: {
  readonly art: AssetId | null | undefined;
  readonly fallback: AssetId;
  readonly alt: string;
  readonly compact?: boolean | undefined;
}) {
  return (
    <span className={compact ? styles.clothThumb : styles.entryThumb} aria-hidden>
      <span className={styles.entryThumbGrid} style={{ backgroundImage: cssUrl("fx.grid") }} />
      {art ? (
        <Asset id={art} alt={alt} className={compact ? styles.clothArt : styles.entryArt} />
      ) : (
        <Asset
          id={fallback}
          tint="var(--entry-accent, var(--cp-cyan))"
          height={compact ? 14 : 16}
          className={styles.entryFallbackIcon}
        />
      )}
    </span>
  );
}

/**
 * 现场透视：顶部无套盒通透 Kiroshi 读数带（体征 / 威胁 / 神经 + 完整骇入防线），
 * 下方左右两列自然平铺（左：已检出义体 + 创伤明细 + 穿戴衣物；右：战术弱点 + 随身武装/物品）。
 */
function ScanTacticalView({
  npc,
  body,
  foe,
  onDraftAction,
}: {
  readonly npc: Npc;
  readonly body: NonNullable<Npc["body"]>;
  readonly foe?: CombatFoe | undefined;
  readonly onDraftAction?: ((text: string) => void) | undefined;
}) {
  const { scan } = body;
  const wound = npcWoundSummary(body);
  const injuries = body.injuries ?? [];
  const chrome = scan?.chrome ?? [];
  const weapons = body.gear.filter((item) => item.kind === "weapon");
  const carried = body.gear.filter((item) => item.kind !== "clothing" && item.kind !== "weapon");
  const clothes = [...body.gear]
    .filter((item) => item.kind === "clothing")
    .sort(
      (a, b) =>
        (CLOTHING_SLOT_INDEX[a.clothingSlot ?? ""] ?? 99) -
        (CLOTHING_SLOT_INDEX[b.clothingSlot ?? ""] ?? 99),
    );

  const humanityThreat = scan ? threatOfHumanity(scan.humanityStage) : undefined;
  const netThreat =
    scan?.netStatus === "open"
      ? "low"
      : scan?.netStatus === "selfIce" || scan?.netStatus === "netrunner"
        ? "high"
        : undefined;
  const scanTimeText = scan
    ? scan.at > 0
      ? `扫于 ${worldRules.formatGameTime(scan.at)}`
      : "已建档"
    : null;

  const hasRightContent =
    (scan && scan.tips.length > 0) ||
    Boolean(foe && foe.carry.length > 0) ||
    weapons.length > 0 ||
    carried.length > 0;

  return (
    <section className={styles.tacticalRoot} aria-label="现场透视">
      {/* 顶部通透 Kiroshi 遥测带：用细分割线取代厚黑卡片，零截断读全骇入防线 */}
      <div className={styles.telemetryRibbon} data-scanned={Boolean(scan) || undefined}>
        <dl className={styles.statStrip}>
          <div className={styles.statCell}>
            <dt>体征</dt>
            <dd data-threat={wound.threat}>{wound.headline}</dd>
          </div>
          <div className={styles.statCell}>
            <dt>威胁评级</dt>
            <dd data-threat={scan?.threat}>{scan ? scan.threatLabel : "未扫描"}</dd>
          </div>
          <div className={styles.statCell}>
            <dt>神经稳态</dt>
            <dd data-threat={humanityThreat}>{scan ? scan.humanityStage : "未扫描"}</dd>
          </div>
          {scanTimeText && (
            <div className={styles.statStamp}>
              <dt>扫描</dt>
              <dd>{scanTimeText}</dd>
            </div>
          )}
        </dl>

        {scan ? (
          <div className={styles.netRow} data-threat={netThreat}>
            <span className={styles.netRowKey}>骇入防线</span>
            <span className={styles.netRowVal}>{scan.netLabel}</span>
          </div>
        ) : (
          <p className={styles.unscannedNote}>
            尚未扫描 · 点击上方「义眼扫描」可即时透视骇入防线、全部植入体与战术弱点（不消耗回合）。
          </p>
        )}
      </div>

      {/* 下方双栏：左列义体、创伤与穿戴衣物，右列战术弱点与随身武装/物品 */}
      <div className={styles.tacticalColumns}>
        <div className={styles.tacticalCol}>
          <div className={styles.subSection}>
            <header className={styles.subHead}>
              <h4 className={styles.subTitle}>已检出义体</h4>
              <span className={styles.subCount}>{scan ? chrome.length : "—"}</span>
            </header>
            {!scan ? (
              <p className={styles.emptyNote}>扫描后显示植入体结构与无线骇入节点。</p>
            ) : chrome.length > 0 ? (
              <ul className={styles.entryList} aria-label="已检出义体">
                {chrome.map((c: NpcChromeItem) => {
                  const art = itemArtOf(c.id);
                  const inner = (
                    <>
                      <CellFrame />
                      <NineSlice
                        id="cyber.cellRarity"
                        tint="var(--entry-accent, var(--cp-cyan))"
                        slice={0}
                        className={styles.entryRarityBar}
                      />
                      <ItemThumb art={art} fallback="cyber.os" alt={c.name} />
                      <span className={styles.entryCopy}>
                        <span className={styles.entryHead}>
                          <b>{c.name}</b>
                          {c.slot && <span className={styles.chromeSlot}>{c.slot}</span>}
                          {c.netTag === "deck" && <span className={styles.chromeTag}>接入仓</span>}
                          {c.netTag === "selfIce" && (
                            <span className={styles.chromeTag} data-tone="warn">
                              自我 ICE
                            </span>
                          )}
                        </span>
                        {c.ability && <span className={styles.entryDesc}>{c.ability}</span>}
                      </span>
                      {onDraftAction && (
                        <em className={styles.entryCue} aria-hidden>
                          针对 ▸
                        </em>
                      )}
                    </>
                  );
                  return (
                    <li key={c.id} className={styles.entryItem}>
                      {onDraftAction ? (
                        <button
                          type="button"
                          className={styles.entryRowBtn}
                          data-tone="chrome"
                          title={`针对「${c.name}」填入行动草稿`}
                          onClick={() => onDraftAction(`针对 ${npc.name} 的植入体「${c.name}」，`)}
                        >
                          {inner}
                        </button>
                      ) : (
                        <div className={styles.entryRow} data-tone="chrome">
                          {inner}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className={styles.emptyNote}>未检出可识别义体，属低改或纯肉身目标。</p>
            )}
          </div>

          {injuries.length > 0 ? (
            <div className={styles.subSection}>
              <header className={styles.subHead}>
                <h4 className={styles.subTitle}>创伤明细</h4>
                <span className={styles.subCount}>{injuries.length}</span>
              </header>
              <ul className={styles.woundList} aria-label="具体伤势">
                {injuries.map((inj) => (
                  <li key={inj.id} className={styles.woundItem} data-tier={inj.tier}>
                    <CellFrame />
                    <NineSlice
                      id="cyber.cellRarity"
                      tint="var(--wound-accent, var(--cp-yellow))"
                      slice={0}
                      className={styles.entryRarityBar}
                    />
                    <span className={styles.woundPart}>{inj.partLabel}</span>
                    <span className={styles.woundInfo}>
                      <span className={styles.woundTop}>
                        <b>{inj.cause}</b>
                        <span className={styles.woundTier}>{inj.tierLabel}</span>
                      </span>
                      <small>{worldRules.formatGameTime(inj.at)}</small>
                    </span>
                    <span className={styles.woundTag} data-treated={inj.treated || undefined}>
                      {inj.treated ? "已处理" : "未处理"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            body.wound !== "没受伤" && (
              <p className={styles.emptyNote}>当前呈{body.wound}状态，暂无具体部位创口记录。</p>
            )
          )}

          {clothes.length > 0 && (
            <div className={styles.subSection}>
              <header className={styles.subHead}>
                <h4 className={styles.subTitle}>穿戴衣物</h4>
                <span className={styles.subCount}>{clothes.length}</span>
              </header>
              <ul className={styles.clothGrid} aria-label="穿戴衣物">
                {clothes.map((item) => {
                  const baseId =
                    "baseId" in item && typeof item.baseId === "string" ? item.baseId : item.id;
                  const art = itemArtOf(baseId);
                  return (
                    <li
                      key={item.id}
                      className={styles.clothRow}
                      data-rarity={item.rarity ?? undefined}
                      title={item.ability ?? undefined}
                    >
                      <CellFrame />
                      <NineSlice
                        id="cyber.cellRarity"
                        tint="var(--rarity, rgb(94 246 255 / 55%))"
                        slice={0}
                        className={styles.clothRarityBar}
                      />
                      <ItemThumb art={art} fallback="map.poi.clothes" alt={item.name} compact />
                      <span className={styles.clothCopy}>
                        {item.subLabel && <em className={styles.clothSlot}>{item.subLabel}</em>}
                        <b>{item.name}</b>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>

        <div className={styles.tacticalCol}>
          {scan && scan.tips.length > 0 && (
            <div className={styles.subSection}>
              <header className={styles.subHead}>
                <h4 className={styles.subTitle}>战术弱点</h4>
                <span className={styles.subHint}>
                  {onDraftAction ? "点选填入行动" : `${scan.tips.length} 条`}
                </span>
              </header>
              <ul className={styles.tacticalList}>
                {scan.tips.map((tip, idx) => {
                  const indexCode = String(idx + 1).padStart(2, "0");
                  const inner = (
                    <>
                      <CellFrame />
                      <NineSlice
                        id="cyber.cellRarity"
                        tint="var(--cp-yellow)"
                        slice={0}
                        className={styles.entryRarityBar}
                      />
                      <span className={styles.tacticalBadge} aria-hidden>
                        {indexCode}
                      </span>
                      <span className={styles.tacticalText}>{tip}</span>
                      {onDraftAction && (
                        <em className={styles.tacticalCue} aria-hidden>
                          采用 ▸
                        </em>
                      )}
                    </>
                  );
                  return (
                    <li key={tip}>
                      {onDraftAction ? (
                        <button
                          type="button"
                          className={styles.tacticalBtn}
                          onClick={() => onDraftAction(`针对 ${npc.name} 的弱点（${tip}），`)}
                        >
                          {inner}
                        </button>
                      ) : (
                        <div className={styles.tacticalItem}>{inner}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {foe && foe.carry.length > 0 && (
            <div className={styles.contextCallout} data-tone="danger">
              <p className={styles.contextMeta}>
                <strong>战利品可见：</strong>
                {foe.carry.map((i) => i.name).join("、")}
              </p>
            </div>
          )}

          {weapons.length > 0 && (
            <GearGroup
              title="随身武装"
              npcName={npc.name}
              items={weapons}
              tone="weapon"
              onDraftAction={onDraftAction}
            />
          )}

          {carried.length > 0 && (
            <GearGroup
              title="随身物品"
              npcName={npc.name}
              items={carried}
              tone="item"
              onDraftAction={onDraftAction}
            />
          )}

          {!hasRightContent && (
            <p className={styles.emptyNote}>
              {scan ? "暂未发现明显弱点或登记随身武装。" : "暂未发现肉眼可见明面装备。"}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function GearGroup({
  title,
  npcName,
  items,
  tone,
  onDraftAction,
}: {
  readonly title: string;
  readonly npcName: string;
  readonly items: readonly NpcGearItem[];
  readonly tone: "weapon" | "item";
  readonly onDraftAction?: ((text: string) => void) | undefined;
}) {
  return (
    <div className={styles.subSection}>
      <header className={styles.subHead}>
        <h4 className={styles.subTitle}>{title}</h4>
        <span className={styles.subCount}>{items.length}</span>
      </header>
      <ul className={styles.entryList} aria-label={title}>
        {items.map((item) => {
          const baseId =
            "baseId" in item && typeof item.baseId === "string" ? item.baseId : item.id;
          const art = itemArtOf(baseId);
          const label = item.name.startsWith("wpn:") ? baseWeaponIdOf(item.name) : item.name;
          const draftPrompt =
            tone === "weapon"
              ? `盯着 ${npcName} 身上的「${label}」，`
              : `留意 ${npcName} 随身带着的「${label}」，`;
          const fallbackIcon: AssetId = tone === "weapon" ? "weapon.pistol" : "notify.inventory";
          const inner = (
            <>
              <CellFrame />
              <NineSlice
                id="cyber.cellRarity"
                tint="var(--rarity, var(--entry-accent, var(--cp-cyan)))"
                slice={0}
                className={styles.entryRarityBar}
              />
              <ItemThumb art={art} fallback={fallbackIcon} alt={label} />
              <span className={styles.entryCopy}>
                <span className={styles.entryHead}>
                  <b>{label}</b>
                  {item.subLabel && <span className={styles.entryMeta}>{item.subLabel}</span>}
                  {item.rarityLabel && (
                    <span className={styles.entryRarity}>{item.rarityLabel}</span>
                  )}
                  {item.iconic && <span className={styles.gearIconic}>不朽</span>}
                </span>
                {item.ability && <span className={styles.entryDesc}>{item.ability}</span>}
              </span>
              {onDraftAction && (
                <em className={styles.entryCue} aria-hidden>
                  留意 ▸
                </em>
              )}
            </>
          );
          return (
            <li key={item.id} className={styles.entryItem}>
              {onDraftAction ? (
                <button
                  type="button"
                  className={styles.entryRowBtn}
                  data-tone={tone}
                  data-rarity={item.rarity ?? undefined}
                  data-iconic={item.iconic || undefined}
                  title={item.ability ?? `针对「${label}」填入行动草稿`}
                  onClick={() => onDraftAction(draftPrompt)}
                >
                  {inner}
                </button>
              ) : (
                <div
                  className={styles.entryRow}
                  data-tone={tone}
                  data-rarity={item.rarity ?? undefined}
                  data-iconic={item.iconic || undefined}
                  title={item.ability ?? undefined}
                >
                  {inner}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** 档案与关系页：关系定性、宿敌恩怨、外貌与背景资料、共同记忆、已知情报与人际关系 */
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
  const hasOther = hasKnownInfo || hasTies;

  const tone = profileTone(npc, foe);
  const relationTone =
    tone === "hostile" || tone === "nemesis"
      ? "danger"
      : tone === "ally" || npc.affinity >= 20
        ? "ally"
        : "neutral";

  const showBlocked = Boolean(fixer?.blocked && fixer.blockReason);
  const facts: readonly (readonly [string, string])[] = [
    ...(npc.homePlace ? ([["常在地点", npc.homePlace]] as const) : []),
    ...(npc.doing ? ([["近期动向", npc.doing]] as const) : []),
    ...(!npc.here && npc.lastPlace ? ([["最后出现", npc.lastPlace]] as const) : []),
    ...(showBlocked && fixer?.blockReason ? ([["中间人渠道", fixer.blockReason]] as const) : []),
  ];
  const hasStructuredClothes = Boolean(npc.body?.gear.some((item) => item.kind === "clothing"));
  const showOutfitText = Boolean(npc.outfit && !hasStructuredClothes);
  const hasProfileNotes = npc.met && (Boolean(npc.look) || showOutfitText || facts.length > 0);
  const memoryCount = npc.ledger.length + npc.memories.length;
  const knownCount = npc.known.length + concerns.length;

  const memoryBlock = hasMemories && (
    <div className={styles.subSection}>
      <header className={styles.subHead}>
        <h4 className={styles.subTitle}>共同记忆</h4>
        <span className={styles.subCount}>{memoryCount}</span>
      </header>
      <ul className={styles.list}>
        {unsettledLedger.map((e) => (
          <li key={`${e.at}|${e.kind}|${e.text}`}>
            <span className={styles.kind} data-tone={e.kind === "grudge" ? "danger" : "accent"}>
              {e.label}
            </span>
            {e.text}
            <small>{e.at} · 未了结</small>
          </li>
        ))}
        {npc.memories.map((m) => (
          <li key={m}>
            <span className={styles.kind} data-tone="memory">
              记忆
            </span>
            {m}
          </li>
        ))}
        {settledLedger.map((e) => (
          <li key={`${e.at}|${e.kind}|${e.text}`} data-settled>
            <span className={styles.kind} data-tone={e.kind === "grudge" ? "danger" : "accent"}>
              {e.label}
            </span>
            {e.text}
            <small>
              {e.at}，{e.settled} 了结{e.how ? `：${e.how}` : ""}
            </small>
          </li>
        ))}
      </ul>
    </div>
  );

  const knownBlock = hasKnownInfo && (
    <div className={styles.subSection}>
      <header className={styles.subHead}>
        <h4 className={styles.subTitle}>已知情报</h4>
        <span className={styles.subCount}>{knownCount}</span>
      </header>
      <ul className={styles.list}>
        {npc.known.map((k) => (
          <li key={k.text}>
            <span className={styles.kind}>{k.sourceLabel}</span>
            {k.text}
            <small>{k.at}</small>
          </li>
        ))}
        {concerns.map((c) => (
          <li key={c.id}>
            <span className={styles.kind} data-tone="warn">
              心事 · {c.statusLabel}
            </span>
            {c.title}
            {c.outcome && <small>{c.outcome}</small>}
          </li>
        ))}
      </ul>
    </div>
  );

  const tiesBlock = hasTies && (
    <div className={styles.subSection}>
      <header className={styles.subHead}>
        <h4 className={styles.subTitle}>认识的人</h4>
        <span className={styles.subCount}>{npc.ties.length}</span>
      </header>
      <ul className={styles.list}>
        {npc.ties.map((t) => (
          <li key={t.id} data-settled={!t.alive || undefined}>
            <span className={styles.kind} data-tone="tie">
              {t.name}
            </span>
            {t.text}
            {!t.alive && <small>已故</small>}
          </li>
        ))}
      </ul>
    </div>
  );

  return (
    <section className={styles.dossierStack} aria-label="档案与关系">
      <div
        className={styles.relationCallout}
        data-tone={relationTone}
        data-empty={!npc.relation || undefined}
      >
        <p className={styles.relationText}>{npc.relation ?? "还说不上什么关系。"}</p>
      </div>

      {npc.nemesis && (
        <div className={styles.contextCallout} data-tone="danger">
          <p className={styles.contextMeta}>
            <strong>{npc.nemesis.ended ? "旧宿敌恩怨" : "宿敌恩怨"}</strong> · {npc.nemesis.since}：
            {npc.nemesis.how}
          </p>
          {npc.nemesis.ended ? (
            <p className={styles.contextMeta}>结局：{npc.nemesis.ended}</p>
          ) : (
            npc.nemesis.prep && <p className={styles.contextWarn}>动向：{npc.nemesis.prep}</p>
          )}
        </div>
      )}

      {hasProfileNotes && (
        <div className={styles.appearancePanel}>
          {facts.length > 0 && (
            <dl className={styles.factStrip}>
              {facts.map(([label, value]) => (
                <div key={label} className={styles.factCell}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          )}
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
      )}

      {hasMemories && hasOther ? (
        <div className={styles.duoGrid}>
          {memoryBlock}
          <div className={styles.subStack}>
            {knownBlock}
            {tiesBlock}
          </div>
        </div>
      ) : (
        <>
          {memoryBlock}
          {knownBlock}
          {tiesBlock}
        </>
      )}

      {!hasMemories && !hasOther && !hasProfileNotes && (
        <p className={styles.emptyNote}>还没攒下共同记忆，也还没打听到更多底细。</p>
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
  embedded = false,
  topSlot,
  onScan,
  onCompanion,
  onDraftAction,
}: {
  readonly npc: Npc;
  readonly fixer?: Fixer | undefined;
  readonly foe?: CombatFoe | undefined;
  /** 嵌入外层人物展开框时去掉内层重复的九宫格边框 */
  readonly embedded?: boolean | undefined;
  /** 嵌入页签栏右侧的附属控件（如在场目标快切 + 关闭按钮），把顶栏和页签合成一行 */
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
                  <NineSlice id="tab.bg" tint="currentColor" slice={14} className={neural.tabBg} />
                  <span className={neural.inner}>
                    {name}
                    {count > 0 && <b className={neural.badge}>{count}</b>}
                  </span>
                  {id === tab && (
                    <span
                      className={styles.tabActiveLine}
                      style={{ maskImage: cssUrl("tab.line"), WebkitMaskImage: cssUrl("tab.line") }}
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

      <ProfileBanner
        npc={npc}
        fixer={fixer}
        foe={foe}
        embedded={embedded}
        onScan={onScan && (() => onScan(npc.id))}
        onCompanion={onCompanion}
        onDraftAction={onDraftAction}
      />

      <div className={styles.pane} key={`${npc.id}:${tab}`}>
        {tab === "tactical" && npc.body && (
          <ScanTacticalView npc={npc} body={npc.body} foe={foe} onDraftAction={onDraftAction} />
        )}
        {tab === "dossier" && <DossierSection npc={npc} fixer={fixer} foe={foe} />}
      </div>
    </article>
  );
}
