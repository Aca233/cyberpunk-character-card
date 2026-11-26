import { characterRules, cyberwareRules, type PlayerAction } from "@cp/core";
import { type CSSProperties, type ReactNode, useMemo, useState } from "react";
import { Button } from "../../ui/Button";
import { CellFrame } from "../../ui/FrameBox";
import { Panel } from "../../ui/Panel";
import { BiomonitorPanel } from "./BiomonitorPanel";
import { ContentMediaList, InlineContentText } from "./ContentMedia";
import { type BodyFocusKey, CyberBodySilhouette, CyberItemCell, NeuralLoadBar } from "./CyberDoll";
import mediaStyles from "./content-media.module.css";
import { rarityLabelOf, rarityTintOf } from "./cyberwareMeta";
import { type HabitAction, Habits } from "./Habits";
import { NewsBody } from "./NewsPanel";
import neural from "./neural.module.css";
import { type PhoneActions, PhoneBody, UnreadBadge } from "./Phone";
import styles from "./story.module.css";
import type { View } from "./view";

/**
 * 神经界面里由旧左侧栏拆出来的几页（2077-interface-plan.md 第五节第 4 条）：
 * 人物、义体、消息、联系人、资料与超梦档案；物品栏与追踪面板已迁至独立模块 InventoryPage / TrackerPanel。
 */

/** 人物（P）：3.0 生物检测读数、角色主板与习惯（无桌面端数值属性栏） */
export function CharacterPage({
  view,
  onHabit,
  onTrauma,
  onOpenNeuralChip,
  onActionDraft,
  busy,
}: {
  readonly view: View;
  readonly onHabit?: ((action: HabitAction, text: string) => void) | undefined;
  readonly onTrauma?:
    | ((action: Extract<PlayerAction, { type: "trauma" }>) => Promise<void>)
    | undefined;
  readonly onOpenNeuralChip?: ((carrierId?: string) => void) | undefined;
  readonly onActionDraft?: ((text: string) => void) | undefined;
  readonly busy?: boolean | undefined;
}) {
  const { character } = view;
  const firstWithAbility = character.traits.find((t) => Boolean(t.ability));
  const [activeTraitKey, setActiveTraitKey] = useState<string | null>(
    firstWithAbility ? `${firstWithAbility.slot}-${firstWithAbility.label}` : null,
  );
  const activeTrait =
    character.traits.find((t) => `${t.slot}-${t.label}` === activeTraitKey) ??
    firstWithAbility ??
    null;

  const origins = character.traits.filter((t) => t.slot === "origin");
  const modules = character.traits.filter((t) => t.slot !== "origin");

  const bindTrait = (t: View["character"]["traits"][number]) => {
    const key = `${t.slot}-${t.label}`;
    return {
      key,
      selected: activeTrait ? `${activeTrait.slot}-${activeTrait.label}` === key : false,
      title: t.ability || undefined,
      onClick: () => setActiveTraitKey(key),
      onMouseEnter: () => {
        if (t.ability) setActiveTraitKey(key);
      },
      onFocus: () => {
        if (t.ability) setActiveTraitKey(key);
      },
    };
  };

  return (
    <div className={styles.characterRoot}>
      {character.name === null && (
        <p className={styles.dim}>这是未绑定角色的旧存档。新建存档时可以选择自己的角色。</p>
      )}
      <BiomonitorPanel
        view={view}
        onTrauma={onTrauma}
        onOpenNeuralChip={onOpenNeuralChip}
        onActionDraft={onActionDraft}
        busy={busy}
      />

      {character.traits.length > 0 && (
        <section className={styles.traitSection} aria-label="角色主板">
          <div className={styles.traitBoard}>
            {origins.map((t) => {
              const { key, selected, ...interactive } = bindTrait(t);
              return (
                <button
                  key={key}
                  type="button"
                  className={styles.originPlaque}
                  aria-pressed={selected}
                  {...interactive}
                >
                  <small className={styles.originStamp}>
                    {characterRules.TRAIT_LABELS[t.slot]}
                  </small>
                  <span className={styles.originLabel}>{t.label}</span>
                </button>
              );
            })}
            {origins.length > 0 && modules.length > 0 && (
              <span className={styles.traitSep} aria-hidden />
            )}
            {modules.length > 0 && (
              <ul className={styles.traits}>
                {modules.map((t) => {
                  const { key, selected, ...interactive } = bindTrait(t);
                  return (
                    <li key={key}>
                      <button
                        type="button"
                        className={styles.traitChip}
                        data-slot={t.slot}
                        aria-pressed={selected}
                        {...interactive}
                      >
                        <i className={styles.traitDot} aria-hidden />
                        <small className={styles.traitKind}>
                          {characterRules.TRAIT_LABELS[t.slot]}
                        </small>
                        <span className={styles.traitLabel}>{t.label}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          {activeTrait?.ability && (
            <div className={styles.traitDetail} data-slot={activeTrait.slot} role="status">
              <div className={styles.traitDetailHead}>
                <small
                  className={activeTrait.slot === "origin" ? styles.originStamp : styles.traitKind}
                >
                  {characterRules.TRAIT_LABELS[activeTrait.slot]}
                </small>
                <b>{activeTrait.label}</b>
              </div>
              <p className={styles.traitDetailText}>{activeTrait.ability}</p>
            </div>
          )}
        </section>
      )}
      {character.deeds.length > 0 && (
        <section className={styles.habits} aria-label="外界知道的事">
          <h4 className={styles.habitsTitle}>外界知道的事 · {character.reputationLabel}</h4>
          <ul className={styles.habitList}>
            {[...character.deeds].reverse().map((deed) => {
              const scope =
                deed.reach === "city"
                  ? deed.reachLabel
                  : deed.district
                    ? `${deed.district}·${deed.reachLabel}`
                    : deed.reachLabel;
              const meta =
                deed.knownBy.length > 0 ? `${scope} · ${deed.knownBy.join("、")}` : scope;
              return (
                <li key={deed.id} className={styles.habitItem}>
                  <span className={styles.habitText}>{deed.summary}</span>
                  <small>{meta}</small>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      <Habits habits={character.habits} offers={character.habitOffers} onHabit={onHabit} />
    </div>
  );
}

type CyberPart = View["cyberware"][number];

interface CoreSlotEntry {
  readonly id: cyberwareRules.CoreSlotId;
  readonly label: string;
  readonly ripperCategory: cyberwareRules.CyberwareCategoryId;
  readonly part: CyberPart | null;
  readonly mirrorOf?: CyberPart | null;
  readonly emptyHint: string;
  readonly lockedNote?: string | null;
}

/** 义体 v2：顶部极简三段神经承载条 + 左 30% 纯净联动人体剪影 + 右 70%（上 4×2 核心主位 + 下 5 标签扩展区） */
export function CyberwarePage({
  view,
  busy = false,
  onRipperdoc,
  onOpenDeck,
  onActionDraft,
  onUseSuppressant,
}: {
  readonly view: View;
  readonly busy?: boolean | undefined;
  readonly onRipperdoc: (focus?: {
    readonly category?: cyberwareRules.CyberwareCategoryId | "installed";
    readonly installedId?: string;
  }) => void;
  readonly onOpenDeck?: (() => void) | undefined;
  readonly onActionDraft?: ((text: string) => void) | undefined;
  readonly onUseSuppressant?: (() => Promise<void>) | undefined;
}) {
  const [activeZone, setActiveZone] = useState<cyberwareRules.ExtensionZoneId>("neural");
  const [expandedCore, setExpandedCore] = useState<cyberwareRules.CoreSlotId | null>(null);
  const [hoveredFocus, setHoveredFocus] = useState<BodyFocusKey>(null);
  const [dosing, setDosing] = useState(false);

  const brokenItems = useMemo(() => view.cyberware.filter((c) => c.broken), [view.cyberware]);
  const firstBroken = brokenItems[0];
  const suppressantCount = view.inventory.suppressantCount;

  const load = useMemo(
    () =>
      cyberwareRules.cyberwareLoadProfile(
        view.cyberware
          .filter((c) => !c.broken)
          .map((c) => ({
            id: c.id,
            name: c.name,
            slot: c.slot,
            category: c.category,
            humanityCost: c.humanityCost,
            iconic: c.iconic,
            armor: c.armor,
            accelerator: c.accelerator,
            ...(c.armSide ? { armSide: c.armSide } : {}),
            ...(c.defaultArmSide ? { defaultArmSide: c.defaultArmSide } : {}),
            ...(c.capacityBonus !== undefined ? { capacityBonus: c.capacityBonus } : {}),
            ...(c.safeLineBonus !== undefined ? { safeLineBonus: c.safeLineBonus } : {}),
            ...(c.chassisProfile ? { chassisProfile: c.chassisProfile } : {}),
            ...(c.deckProfile ? { deckProfile: c.deckProfile } : {}),
            ...(c.deckTraits ? { deckTraits: c.deckTraits } : {}),
            ...(c.exclusiveGroup ? { exclusiveGroup: c.exclusiveGroup } : {}),
          })),
      ),
    [view.cyberware],
  );

  const { coreSlots, byZone } = useMemo(() => {
    const zones: Record<cyberwareRules.ExtensionZoneId, CyberPart[]> = {
      neural: [],
      sensory: [],
      torso: [],
      extremities: [],
      lifestyle: [],
    };
    let chassis: CyberPart | null = null;
    let cyberdeck: CyberPart | null = null;
    let spineDrive: CyberPart | null = null;
    let capacityCore: CyberPart | null = null;
    let optics: CyberPart | null = null;
    let leftArm: CyberPart | null = null;
    let rightArm: CyberPart | null = null;
    let rightMirror: CyberPart | null = null;
    let legDrive: CyberPart | null = null;
    let skinArmor: CyberPart | null = null;

    for (const part of view.cyberware) {
      const cat = part.category;
      if (cat === "chassis") {
        chassis = part;
      } else if (cat === "cyberdeck") {
        cyberdeck = part;
      } else if (cat === "spineDrive") {
        if (part.exclusiveGroup === "capacityCore") capacityCore = part;
        else spineDrive = part;
      } else if (cat === "optics") {
        optics = part;
      } else if (cat === "arms") {
        const side = part.armSide ?? cyberwareRules.defaultArmSideFor(part);
        if (side === "both") {
          leftArm = part;
          rightMirror = part;
        } else if (side === "left") {
          leftArm = part;
        } else {
          rightArm = part;
        }
      } else if (cat === "legDrive") {
        legDrive = part;
      } else if (cat === "skinArmor") {
        skinArmor = part;
      } else {
        zones[cat].push(part);
      }
    }

    const slots: readonly CoreSlotEntry[] = [
      {
        id: "chassis",
        label: cyberwareRules.CORE_SLOT_LABELS.chassis,
        ripperCategory: "chassis",
        part: chassis,
        emptyHint: "原生血肉",
      },
      {
        id: "cyberdeck",
        label: cyberwareRules.CORE_SLOT_LABELS.cyberdeck,
        ripperCategory: "cyberdeck",
        part: cyberdeck,
        emptyHint: "未安装",
        lockedNote: capacityCore ? `由「${capacityCore.name}」接管` : null,
      },
      {
        id: "spineDrive",
        label: cyberwareRules.CORE_SLOT_LABELS.spineDrive,
        ripperCategory: "spineDrive",
        part: spineDrive ?? capacityCore,
        emptyHint: "未安装",
      },
      {
        id: "optics",
        label: cyberwareRules.CORE_SLOT_LABELS.optics,
        ripperCategory: "optics",
        part: optics,
        emptyHint: "原生双眼",
      },
      {
        id: "leftArm",
        label: cyberwareRules.CORE_SLOT_LABELS.leftArm,
        ripperCategory: "arms",
        part: leftArm,
        emptyHint: "原生左臂",
      },
      {
        id: "rightArm",
        label: cyberwareRules.CORE_SLOT_LABELS.rightArm,
        ripperCategory: "arms",
        part: rightArm,
        mirrorOf: rightArm ? null : rightMirror,
        emptyHint: "原生右臂",
      },
      {
        id: "legDrive",
        label: cyberwareRules.CORE_SLOT_LABELS.legDrive,
        ripperCategory: "legDrive",
        part: legDrive,
        emptyHint: "原生双腿",
      },
      {
        id: "skinArmor",
        label: cyberwareRules.CORE_SLOT_LABELS.skinArmor,
        ripperCategory: "skinArmor",
        part: skinArmor,
        emptyHint: "无表皮主甲",
      },
    ];
    return { coreSlots: slots, byZone: zones };
  }, [view.cyberware]);

  const neuralBad = !view.humanity.suppressed && view.humanity.stage !== "stable";
  const zoneItems = byZone[activeZone];
  const expandedSlot = expandedCore ? (coreSlots.find((s) => s.id === expandedCore) ?? null) : null;
  const expandedPart = expandedSlot ? (expandedSlot.part ?? expandedSlot.mirrorOf ?? null) : null;

  const handleSuppressant = async () => {
    if (!onUseSuppressant || busy || dosing) return;
    setDosing(true);
    try {
      await onUseSuppressant();
    } finally {
      setDosing(false);
    }
  };

  const quickUseLabel = (
    part: CyberPart,
  ): { readonly label: string; readonly draft: string } | null => {
    if (part.broken) return null;
    if (part.accelerator) {
      return {
        label: "开启加速",
        draft: `启动${part.name}进入神经加速时间，抢占先手观察周围局势并采取行动。`,
      };
    }
    if (part.exclusiveGroup === "optics") {
      return {
        label: "光学扫描",
        draft: `启动${part.name}扫描周围环境与目标，排查义体配置、弱点、监控探头与潜在埋伏。`,
      };
    }
    if (part.exclusiveGroup === "skinStealth") {
      return {
        label: "开启迷彩",
        draft: `启动${part.name}隐去身形轮廓，借掩体与视线死角悄然移动。`,
      };
    }
    if (part.slot === "arms") {
      const sidePrefix = part.armSideLabel ? `${part.armSideLabel}` : "";
      return {
        label: "展开武装",
        draft: `亮出${sidePrefix}${part.name}做好近身压制与破防准备。`,
      };
    }
    return null;
  };

  const silhouetteFocus: BodyFocusKey = hoveredFocus ?? expandedCore ?? activeZone;

  const subline =
    view.humanity.symptoms.length > 0 || firstBroken || view.health.lostLimbs.length > 0 ? (
      <div className={neural.loadAlertStrip}>
        {firstBroken && (
          <button
            type="button"
            className={neural.cyberPillBtn}
            data-tone="bad"
            onClick={() => onRipperdoc({ category: "installed", installedId: firstBroken.id })}
          >
            损毁待修 {brokenItems.length} 件 →
          </button>
        )}
        {view.health.lostLimbs.length > 0 && (
          <span className={neural.cyberStatusFlag} data-tone="bad">
            断肢：{view.health.lostLimbs.map((l) => l.label).join("、")}
          </span>
        )}
        {view.humanity.symptoms.length > 0 && (
          <span className={neural.loadSymptomText}>
            活跃症状：
            {view.humanity.symptoms.map((s) => `${s.description}（${s.cause}）`).join("；")}
          </span>
        )}
      </div>
    ) : null;

  return (
    <div className={neural.cyberPage} data-tone={load.tone}>
      <NeuralLoadBar
        load={load}
        subline={subline}
        extra={
          <>
            {suppressantCount > 0 && (load.overloaded || neuralBad) && onUseSuppressant && (
              <Button
                small
                disabled={busy || dosing || view.humanity.suppressed}
                reason={view.humanity.suppressed ? "神经压制剂正在起效中" : undefined}
                onClick={() => void handleSuppressant()}
              >
                {view.humanity.suppressed
                  ? "压制剂生效中"
                  : dosing
                    ? "注射中…"
                    : `压制剂 (${suppressantCount})`}
              </Button>
            )}
            {view.ripperdoc && (
              <Button small primary onClick={() => onRipperdoc({ category: activeZone })}>
                诊所 · {view.ripperdoc.name}
              </Button>
            )}
          </>
        }
      />

      <div className={neural.v2Split}>
        <section className={neural.v2Left} aria-label="人体改造联动剪影">
          <CyberBodySilhouette
            focus={silhouetteFocus}
            chassisLabel={load.chassisLabel}
            hasFbc={load.fullBorg !== null}
            installedCount={view.cyberware.length}
            tone={load.tone}
          />
        </section>

        <section className={neural.v2Right} aria-label="核心主位与扩展插件">
          <CellFrame />
          {/* 上区：2×4 宽裕核心主位网格（全名完整展示，绝不截断） */}
          <div className={neural.v2Block}>
            <div className={neural.v2BlockHead}>
              <div className={neural.v2BlockTitleWrap}>
                <span className={neural.v2BlockCode}>{"CORE // 08"}</span>
                <span className={neural.v2BlockTitle}>核心主位</span>
              </div>
              {load.dualCore && (
                <span className={neural.v2HeadWarn}>
                  双中枢并行 · 额外 +{load.dualCorePenalty} 承载
                </span>
              )}
            </div>
            <div className={neural.coreGrid}>
              {coreSlots.map((entry) => {
                const shown = entry.part ?? entry.mirrorOf ?? null;
                const isMirror = entry.part === null && entry.mirrorOf != null;
                const tint = shown
                  ? shown.broken
                    ? "var(--cp-danger)"
                    : rarityTintOf(shown.rarity, shown.iconic)
                  : undefined;
                const rarityLabel = shown ? rarityLabelOf(shown.rarity, shown.iconic) : null;
                const active = expandedCore === entry.id;
                return (
                  <button
                    key={entry.id}
                    type="button"
                    className={neural.coreCard}
                    data-filled={shown ? true : undefined}
                    data-mirror={isMirror || undefined}
                    data-broken={shown?.broken || undefined}
                    data-active={active || undefined}
                    style={tint ? ({ "--card-tint": tint } as CSSProperties) : undefined}
                    onMouseEnter={() => setHoveredFocus(entry.id)}
                    onMouseLeave={() => setHoveredFocus(null)}
                    onFocus={() => setHoveredFocus(entry.id)}
                    onBlur={() => setHoveredFocus(null)}
                    onClick={() => {
                      if (shown) {
                        setExpandedCore((prev) => (prev === entry.id ? null : entry.id));
                      } else if (view.ripperdoc) {
                        onRipperdoc({ category: entry.ripperCategory });
                      }
                    }}
                  >
                    <div className={neural.coreCardBody}>
                      {shown ? (
                        <CyberItemCell
                          id={shown.id}
                          name={shown.name}
                          slot={shown.slot}
                          rarity={shown.rarity ?? undefined}
                          iconic={shown.iconic}
                          broken={shown.broken}
                          on={!shown.broken}
                          size={40}
                        />
                      ) : (
                        <span className={neural.coreEmptyIcon} aria-hidden />
                      )}
                      <div className={neural.coreInfo}>
                        <div className={neural.coreCardHead}>
                          <span className={neural.coreSlotLabel}>{entry.label}</span>
                          {shown && !isMirror && shown.effectiveLoad > 0 && (
                            <span className={neural.loadNum} title="神经承载">
                              {shown.effectiveLoad}
                            </span>
                          )}
                          {isMirror && <span className={neural.coreMirrorTag}>双臂同款</span>}
                        </div>
                        {shown ? (
                          <div className={neural.coreNameRow}>
                            <strong className={neural.coreItemName}>{shown.name}</strong>
                            {shown.broken ? (
                              <span className={neural.coreBrokenTag}>受损</span>
                            ) : (
                              rarityLabel && (
                                <span className={neural.coreRarityDot} style={{ color: tint }}>
                                  {rarityLabel}
                                </span>
                              )
                            )}
                          </div>
                        ) : (
                          <span className={neural.coreEmpty}>
                            {entry.lockedNote ?? entry.emptyHint}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            {expandedSlot && expandedPart && (
              <div
                className={neural.coreDrawer}
                data-broken={expandedPart.broken || undefined}
                style={
                  {
                    "--card-tint": expandedPart.broken
                      ? "var(--cp-danger)"
                      : rarityTintOf(expandedPart.rarity, expandedPart.iconic),
                  } as CSSProperties
                }
              >
                <div className={neural.coreDrawerHead}>
                  <div className={neural.coreDrawerTitle}>
                    <span className={neural.coreDrawerSlot}>{expandedSlot.label}</span>
                    <strong>{expandedPart.name}</strong>
                    {rarityLabelOf(expandedPart.rarity, expandedPart.iconic) && (
                      <span
                        className={neural.coreDrawerRarity}
                        style={{
                          color: rarityTintOf(expandedPart.rarity, expandedPart.iconic),
                        }}
                      >
                        {rarityLabelOf(expandedPart.rarity, expandedPart.iconic)}
                      </span>
                    )}
                    {expandedPart.armSideLabel && (
                      <span className={neural.coreDrawerRarity}>{expandedPart.armSideLabel}</span>
                    )}
                  </div>
                  <button
                    type="button"
                    className={neural.coreDrawerClose}
                    aria-label="收起详情"
                    onClick={() => setExpandedCore(null)}
                  >
                    ×
                  </button>
                </div>
                {expandedPart.ability && (
                  <p className={neural.coreDrawerDesc}>{expandedPart.ability}</p>
                )}
                {!expandedPart.broken &&
                  (expandedPart.deckProfile ||
                    (expandedPart.deckTraits && expandedPart.deckTraits.length > 0)) && (
                    <p className={neural.cyberDetailSub}>
                      接入仓特化：
                      {[expandedPart.deckTraits?.join(" · "), expandedPart.deckProfile]
                        .filter(Boolean)
                        .join(" — ")}
                    </p>
                  )}
                <div className={neural.cyberCardActions}>
                  {!expandedPart.broken &&
                    (expandedPart.deckProfile || expandedPart.exclusiveGroup === "cyberdeck") &&
                    onOpenDeck && (
                      <button
                        type="button"
                        className={neural.cyberActBtn}
                        data-tone="cyan"
                        onClick={onOpenDeck}
                      >
                        管理接入仓插槽
                      </button>
                    )}
                  {quickUseLabel(expandedPart) && onActionDraft && (
                    <button
                      type="button"
                      className={neural.cyberActBtn}
                      data-tone="warn"
                      disabled={busy}
                      onClick={() => {
                        const q = quickUseLabel(expandedPart);
                        if (q) onActionDraft(q.draft);
                      }}
                    >
                      {quickUseLabel(expandedPart)?.label}
                    </button>
                  )}
                  {view.ripperdoc && (
                    <button
                      type="button"
                      className={neural.cyberActBtn}
                      data-tone={expandedPart.broken ? "bad" : undefined}
                      onClick={() =>
                        onRipperdoc({ category: "installed", installedId: expandedPart.id })
                      }
                    >
                      {expandedPart.broken ? "去诊所维修" : "诊所拆换"}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* 下区：5 标签扩展与外观区 */}
          <div className={neural.v2ZoneBlock}>
            <nav className={neural.zoneTabs} aria-label="扩展与外观分区">
              {cyberwareRules.EXTENSION_ZONE_IDS.map((zone) => {
                const count = byZone[zone].length;
                const limit = load.zoneLimits[zone];
                const active = activeZone === zone;
                return (
                  <button
                    key={zone}
                    type="button"
                    className={neural.zoneTab}
                    aria-pressed={active}
                    onMouseEnter={() => setHoveredFocus(zone)}
                    onMouseLeave={() => setHoveredFocus(null)}
                    onClick={() => setActiveZone(zone)}
                  >
                    <span>{cyberwareRules.EXTENSION_ZONE_LABELS[zone]}</span>
                    <span className={neural.zoneTabCount}>
                      {limit === null ? count : `${count}/${limit}`}
                    </span>
                  </button>
                );
              })}
            </nav>

            <div className={neural.zoneScroll}>
              {zoneItems.length === 0 ? (
                <div className={neural.cyberEmptyBox}>
                  <strong>尚未装配{cyberwareRules.EXTENSION_ZONE_LABELS[activeZone]}</strong>
                  <p>
                    {activeZone === "lifestyle"
                      ? "变色皮肤、光纹纹身、变色虹膜与日常外观改造不占神经承载，也不占功能空间。"
                      : view.ripperdoc
                        ? `可在「${view.ripperdoc.name}」的诊所挑选加装。`
                        : "前往任意义体医生诊所即可挑选加装。"}
                  </p>
                  {view.ripperdoc && (
                    <Button small primary onClick={() => onRipperdoc({ category: activeZone })}>
                      前往 {view.ripperdoc.name} 诊所
                    </Button>
                  )}
                </div>
              ) : (
                <ul className={neural.v2List}>
                  {zoneItems.map((part) => {
                    const tint = part.broken
                      ? "var(--cp-danger)"
                      : rarityTintOf(part.rarity, part.iconic);
                    const rarityLabel = rarityLabelOf(part.rarity, part.iconic);
                    const quickUse = quickUseLabel(part);
                    return (
                      <li
                        key={part.id}
                        className={neural.v2Row}
                        data-broken={part.broken || undefined}
                        style={{ "--card-tint": tint } as CSSProperties}
                        onMouseEnter={() => setHoveredFocus(activeZone)}
                        onMouseLeave={() => setHoveredFocus(null)}
                      >
                        <CyberItemCell
                          id={part.id}
                          name={part.name}
                          slot={part.slot}
                          rarity={part.rarity ?? undefined}
                          iconic={part.iconic}
                          broken={part.broken}
                          on={!part.broken}
                          size={38}
                        />
                        <div className={neural.v2RowMain}>
                          <div className={neural.v2RowTop}>
                            <strong className={neural.v2RowName}>{part.name}</strong>
                            {rarityLabel && (
                              <span className={neural.v2RowRarity} style={{ color: tint }}>
                                {rarityLabel}
                              </span>
                            )}
                            {part.broken && <span className={neural.coreBrokenTag}>受损</span>}
                            {part.effectiveLoad > 0 && (
                              <span className={neural.v2RowLoad} title="神经承载">
                                {part.effectiveLoad}
                              </span>
                            )}
                          </div>
                          {part.ability && <p className={neural.v2RowDesc}>{part.ability}</p>}
                          {part.behaviorChip && (
                            <p className={neural.cyberDetailSub}>
                              {[
                                `行为芯片：${part.behaviorChip.label}`,
                                part.behaviorChip.protocol
                                  ? `协议：${part.behaviorChip.protocol}`
                                  : null,
                                part.behaviorChip.memoryGap ? "存在托管记忆断层" : null,
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </p>
                          )}
                          {(quickUse || view.ripperdoc) && (
                            <div className={neural.cyberCardActions}>
                              {quickUse && onActionDraft && (
                                <button
                                  type="button"
                                  className={neural.cyberActBtn}
                                  data-tone="warn"
                                  disabled={busy}
                                  onClick={() => onActionDraft(quickUse.draft)}
                                >
                                  {quickUse.label}
                                </button>
                              )}
                              {view.ripperdoc && (
                                <button
                                  type="button"
                                  className={neural.cyberActBtn}
                                  data-tone={part.broken ? "bad" : undefined}
                                  onClick={() =>
                                    onRipperdoc({ category: "installed", installedId: part.id })
                                  }
                                >
                                  {part.broken ? "去诊所维修" : "诊所拆换"}
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

/** 页内分栏：原作按钮素材，按下的那一栏 pressed */
function SubTabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  readonly tabs: readonly (readonly [T, ReactNode])[];
  readonly value: T;
  readonly onChange: (tab: T) => void;
}) {
  return (
    <nav className={neural.sub}>
      {tabs.map(([id, label]) => (
        <Button key={id} small pressed={id === value} onClick={() => onChange(id)}>
          {label}
        </Button>
      ))}
    </nav>
  );
}

type MessagesTab = "dm" | "news";

/** 消息（T）：私信和新闻；四个频道的完整版在 U4 */
export function MessagesPage({
  view,
  onReply,
  onMessageNpc,
  onSendChat,
  onReadThread,
  onReadCall,
  onAnswerCall,
  onAcceptJob,
  chatSending,
  pendingChat,
  busy,
  onLocatePlace,
  onOpenRipperdoc,
  onOpenPeople,
  focusContact,
  onConsumeFocus,
  onNews,
  initialTab = "dm",
  hideTabs = false,
}: {
  readonly view: View;
  /** 切到新闻栏：把新闻记成已读 */
  readonly onNews: () => void;
  readonly initialTab?: MessagesTab;
  /** 外面已经有页签（钉住的未读块）时不再出页内分栏 */
  readonly hideTabs?: boolean;
} & PhoneActions) {
  const [tab, setTab] = useState<MessagesTab>(initialTab);
  const actions: PhoneActions = {
    onReply,
    onMessageNpc,
    onSendChat,
    onReadThread,
    onReadCall,
    onAnswerCall,
    onAcceptJob,
    chatSending,
    pendingChat,
    busy,
    onLocatePlace,
    onOpenRipperdoc,
    onOpenPeople,
    focusContact,
    onConsumeFocus,
  };
  return (
    <>
      {!hideTabs && (
        <SubTabs<MessagesTab>
          tabs={[
            ["dm", view.phone.unread > 0 ? `私信 ${view.phone.unread}` : "私信"],
            ["news", "新闻"],
          ]}
          value={tab}
          onChange={(t) => {
            setTab(t);
            if (t === "news") onNews();
          }}
        />
      )}
      {hideTabs ? (
        tab === "dm" ? (
          <PhoneBody view={view} {...actions} />
        ) : (
          <NewsBody view={view} />
        )
      ) : (
        <Panel as="section" title={tab === "dm" ? "私信" : "新闻"} line="var(--cp-cyan)" frame>
          {tab === "dm" ? <PhoneBody view={view} {...actions} /> : <NewsBody view={view} />}
        </Panel>
      )}
    </>
  );
}

/** 资料与超梦回看档案：只保留「情报」与「超梦」两栏；随身实体芯片与 2 个神经插槽归属物品栏。 */
export function ShardsPanel({
  view,
  onReadShard,
}: {
  readonly view: View;
  /** 打开已归档原文：仅标记界面已浏览 */
  readonly onReadShard: (id: number) => void;
}) {
  const [tab, setTab] = useState<"archive" | "braindance">("archive");
  const archiveCount = view.shards.list.length;
  const bdCount = view.braindance.works.length;
  return (
    <div className={mediaStyles.archive}>
      <nav className={mediaStyles.tabs} aria-label="资料分区">
        <Button small pressed={tab === "archive"} onClick={() => setTab("archive")}>
          情报 · {archiveCount}
          {view.shards.unread > 0 ? `（${view.shards.unread} 新）` : ""}
        </Button>
        <Button small pressed={tab === "braindance"} onClick={() => setTab("braindance")}>
          超梦 · {bdCount}
          {view.braindance.active ? " · 进行中" : ""}
        </Button>
      </nav>
      {tab === "archive" ? (
        <ChipArchive view={view} onReadShard={onReadShard} />
      ) : (
        <BraindanceArchive view={view} />
      )}
    </div>
  );
}

const ARCHIVE_SEARCH_THRESHOLD = 6;

/** 情报归档：保留读过的芯片原文与多媒体，条目达到阈值后显示轻量筛选框。 */
function ChipArchive({
  view,
  onReadShard,
}: {
  readonly view: View;
  readonly onReadShard: (id: number) => void;
}) {
  const shards = view.shards.list;
  const [query, setQuery] = useState("");
  const [pickedId, setPickedId] = useState<number | null>(null);

  const showSearch = shards.length >= ARCHIVE_SEARCH_THRESHOLD;
  const keyword = showSearch ? query.trim().toLocaleLowerCase() : "";
  const filteredShards = keyword
    ? shards.filter((s) =>
        `${s.title}\n${s.from ?? ""}\n${s.kindLabel}\n${s.text}`
          .toLocaleLowerCase()
          .includes(keyword),
      )
    : shards;
  const selectedShard =
    (pickedId !== null ? filteredShards.find((s) => s.id === pickedId) : undefined) ??
    filteredShards[0] ??
    null;

  const openShard = (id: number, read: boolean) => {
    setPickedId(id);
    if (!read) onReadShard(id);
  };

  if (shards.length === 0) {
    return (
      <div className={styles.phoneEmpty}>
        <p className={styles.dim}>
          还没有已读情报。随身实体芯片与神经插槽请在「物品栏」查看；读过的芯片原文会永久留档在这里，哪怕把实体芯片交给别人也能回看。
        </p>
      </div>
    );
  }

  const listItems = (
    <ul className={`${styles.contactList} ${styles.dbList}`} aria-label="情报目录">
      {filteredShards.map((s) => (
        <li key={s.id}>
          <button
            type="button"
            className={styles.contact}
            aria-pressed={selectedShard?.id === s.id}
            onClick={() => openShard(s.id, s.read)}
          >
            <span className={styles.contactName}>
              <b>{s.title}</b>
              <small className={styles.dim}>
                {s.kindLabel}
                {s.from ? ` · ${s.from}` : ` · ${s.at}`}
              </small>
            </span>
            {!s.read && <UnreadBadge>新</UnreadBadge>}
          </button>
        </li>
      ))}
    </ul>
  );

  return (
    <div className={styles.dbSplit}>
      {showSearch ? (
        <div className={mediaStyles.archiveSide}>
          <div className={mediaStyles.archiveSearch}>
            <CellFrame />
            <input
              type="search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPickedId(null);
              }}
              placeholder="筛选标题、来源或正文…"
              aria-label="筛选情报"
              className={mediaStyles.archiveSearchInput}
            />
            {query && (
              <button
                type="button"
                className={mediaStyles.archiveSearchClear}
                aria-label="清空筛选"
                onClick={() => {
                  setQuery("");
                  setPickedId(null);
                }}
              >
                ×
              </button>
            )}
          </div>
          {filteredShards.length > 0 ? (
            listItems
          ) : (
            <p className={mediaStyles.archiveNoMatch}>没有匹配「{query.trim()}」的情报。</p>
          )}
        </div>
      ) : (
        listItems
      )}

      <article className={styles.dbReader}>
        {selectedShard ? (
          <>
            <h3 className={styles.dbReaderTitle}>{selectedShard.title}</h3>
            <p className={styles.dim}>
              {selectedShard.kindLabel}
              {selectedShard.from && ` · 来源：${selectedShard.from}`} · {selectedShard.at}
            </p>
            <p className={styles.factionReason}>
              <InlineContentText text={selectedShard.text} />
            </p>
            <ContentMediaList media={selectedShard.media ?? []} />
          </>
        ) : (
          <p className={styles.dim}>
            {keyword ? "没有匹配当前关键词的情报。" : "从左侧选择一条情报查看原文。"}
          </p>
        )}
      </article>
    </div>
  );
}

function tierBadgeClass(tier: string): string {
  const base = mediaStyles.badge ?? "";
  if (tier === "xbd") return `${base} ${mediaStyles.badgeDanger ?? ""}`.trim();
  if (tier === "raw" || tier === "sensory") return `${base} ${mediaStyles.badgeWarn ?? ""}`.trim();
  return base;
}

/** 超梦台：展示当前活跃超梦会话、分级徽章、三层感官轨道扫描状态、已揭示线索卡与片段回看。 */
function BraindanceArchive({ view }: { readonly view: View }) {
  const { active, works, discoveries } = view.braindance;
  const [pickedWork, setPickedWork] = useState<string | null>(active?.work ?? null);
  const currentWork = works.find((w) => w.id === pickedWork) ?? works[0] ?? null;
  const workDiscoveries = currentWork ? discoveries.filter((d) => d.work === currentWork.id) : [];

  return (
    <div
      style={{
        display: "grid",
        gridTemplateRows: active ? "auto minmax(0, 1fr)" : "minmax(0, 1fr)",
        minHeight: 0,
        height: "100%",
      }}
    >
      {active && (
        <section className={mediaStyles.slotStrip} aria-label="当前播放超梦">
          <div className={mediaStyles.slotHeader}>
            <strong>
              正在体验：《{active.title}》 · {active.modeLabel}
            </strong>
            <span className={tierBadgeClass(active.tier)}>{active.tierLabel}</span>
          </div>
          <p className={styles.dim}>
            录制者：{active.recorder} · 进度 {active.watchedMinutes}/{active.durationMinutes} 分钟 ·
            开始于 {active.startedAt}
          </p>
          <div className={mediaStyles.layerGrid}>
            {active.layers.map((layer) => (
              <div
                key={layer.layer}
                className={`${mediaStyles.layerCell} ${
                  layer.total > 0 && layer.found >= layer.total ? mediaStyles.layerCellDone : ""
                }`}
              >
                <strong>{layer.label}</strong>
                <span className={styles.dim}>
                  {layer.total > 0 ? `已扫描线索 ${layer.found}/${layer.total}` : "无隐藏线索"}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {!currentWork ? (
        <div className={styles.phoneEmpty}>
          <p className={styles.dim}>
            还没有体验或扫描过的超梦卷轴。前往丽姿酒吧、洋子芯片铺或佩戴超梦花环播放后，定稿片段与三层轨道线索会留在这里。
          </p>
        </div>
      ) : (
        <div className={styles.dbSplit}>
          <ul className={`${styles.contactList} ${styles.dbList}`} aria-label="超梦卷轴目录">
            {works.map((work) => {
              const foundTotal = work.layers.reduce((sum, l) => sum + l.found, 0);
              const clueTotal = work.layers.reduce((sum, l) => sum + l.total, 0);
              return (
                <li key={work.id}>
                  <button
                    type="button"
                    className={styles.contact}
                    aria-pressed={work.id === currentWork.id}
                    onClick={() => setPickedWork(work.id)}
                  >
                    <span className={styles.contactName}>
                      <b>{work.title}</b>
                      <span className={mediaStyles.badgeRow}>
                        <span className={tierBadgeClass(work.tier)}>{work.tierLabel}</span>
                        {clueTotal > 0 && (
                          <span className={mediaStyles.badge}>
                            线索 {foundTotal}/{clueTotal}
                          </span>
                        )}
                        {work.passages.length > 0 && (
                          <span className={mediaStyles.badge}>
                            已回看 {work.passages.length} 段
                          </span>
                        )}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          <article className={styles.dbReader} key={currentWork.id}>
            <h3 className={styles.dbReaderTitle}>{currentWork.title}</h3>
            <div className={mediaStyles.badgeRow}>
              <span className={tierBadgeClass(currentWork.tier)}>{currentWork.tierLabel}</span>
              <span className={styles.dim}>
                录制者：{currentWork.recorder} · 时长 {currentWork.durationMinutes} 分钟
              </span>
            </div>
            <p className={styles.factionReason}>{currentWork.synopsis}</p>
            {currentWork.xbdRisk && (
              <p className={mediaStyles.error}>神经警示：{currentWork.xbdRisk}</p>
            )}

            {currentWork.layers.some((l) => l.total > 0) && (
              <section className={mediaStyles.group}>
                <h4 className={mediaStyles.groupTitle}>三层感官轨道扫描状态</h4>
                <div className={mediaStyles.layerGrid}>
                  {currentWork.layers.map((layer) => (
                    <div
                      key={layer.layer}
                      className={`${mediaStyles.layerCell} ${
                        layer.total > 0 && layer.found >= layer.total
                          ? mediaStyles.layerCellDone
                          : ""
                      }`}
                    >
                      <strong>{layer.label}</strong>
                      <span className={styles.dim}>
                        {layer.total > 0 ? `${layer.found}/${layer.total}` : "—"}
                      </span>
                    </div>
                  ))}
                </div>
                {workDiscoveries.length > 0 ? (
                  <ul className={mediaStyles.clueList} aria-label="已揭示线索">
                    {workDiscoveries.map((clue) => (
                      <li key={`${clue.work}:${clue.detail}`} className={mediaStyles.clueItem}>
                        <div className={mediaStyles.badgeRow}>
                          <span className={mediaStyles.badge}>{clue.layerLabel}</span>
                          <span className={styles.dim}>{clue.at}</span>
                        </div>
                        <p style={{ margin: "4px 0 0" }}>{clue.finding}</p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className={styles.dim}>尚未在编辑模式下扫描出轨道线索。</p>
                )}
              </section>
            )}

            {currentWork.passages.length > 0 && (
              <section className={mediaStyles.group}>
                <h4 className={mediaStyles.groupTitle}>已体验片段回看</h4>
                {currentWork.passages.map((passage) => (
                  <div key={passage.id} className={mediaStyles.group}>
                    <p className={styles.dim}>{passage.label}</p>
                    <p className={styles.factionReason}>
                      <InlineContentText text={passage.text} />
                    </p>
                    <ContentMediaList media={passage.media ?? []} />
                  </div>
                ))}
              </section>
            )}
          </article>
        </div>
      )}
    </div>
  );
}
