import {
  type Board,
  type CharacterCard,
  cyberwareRules,
  economyRules,
  npcRules,
  type StartCyberware,
} from "@cp/core";
import { useMemo, useState } from "react";
import type { BoardData } from "../../api/client";
import { ActionButton } from "../../ui/ActionButton";
import { cssUrl } from "../../ui/Asset";
import { CellFrame } from "../../ui/FrameBox";
import {
  type BodyFocusKey,
  CyberBodySilhouette,
  type CyberSlot,
  NeuralLoadBar,
} from "../story/CyberDoll";
import { CyberwareShelf, LoadoutPicker } from "./CreatorSteps";
import { boardLoadProfile, emptyBoard } from "./creator";
import wb from "./workbench.module.css";

const { NPC_CHROME_MAX, NPC_GEAR_MAX } = npcRules;

const CORE_CYBER_CATEGORIES = [
  "chassis",
  "cyberdeck",
  "spineDrive",
  "optics",
  "arms",
  "legDrive",
  "skinArmor",
] as const;

export type NpcLoadoutTab = "topology" | "weapons" | "items";

export interface NpcGearPanelProps {
  readonly data: BoardData;
  readonly gear: readonly string[];
  readonly cyberware: readonly string[];
  readonly onChangeGear: (next: string[]) => void;
  readonly onChangeCyberware: (next: string[]) => void;
  readonly subTab?: NpcLoadoutTab | undefined;
  readonly onSubTabChange?: ((tab: NpcLoadoutTab) => void) | undefined;
}

/**
 * NPC 装备与义体装配面板：
 * 直接复用角色创建 Step 03 的同一套组件（NeuralLoadBar / CyberBodySilhouette / CyberwareShelf / LoadoutPicker），
 * 保持完全一致的人体剪影、部位分区、三段承载、不朽/传说全量目录与武器/物品大图预览交互。
 */
export function NpcGearPanel({
  data,
  gear,
  cyberware,
  onChangeGear,
  onChangeCyberware,
  subTab: controlledSubTab,
  onSubTabChange,
}: NpcGearPanelProps) {
  const [innerSubTab, setInnerSubTab] = useState<NpcLoadoutTab>("topology");
  const subTab = controlledSubTab ?? innerSubTab;
  const setSubTab = (next: NpcLoadoutTab) => {
    setInnerSubTab(next);
    onSubTabChange?.(next);
  };
  const [activeCategory, setActiveCategory] =
    useState<cyberwareRules.CyberwareCategoryId>("optics");
  const [armTarget, setArmTarget] = useState<cyberwareRules.ArmSide>("both");
  const [hoveredBodyFocus, setHoveredBodyFocus] = useState<BodyFocusKey | null>(null);
  // 保留编辑会话中的手臂侧别选择，避免切回后再装同款时丢失左右侧别
  const [armSides, setArmSides] = useState<Readonly<Record<string, cyberwareRules.ArmSide>>>({});

  // NPC 可选全量义体（包含传说与不朽以及本地自创/工坊），直接喂给角色创建同一套货架组件
  const npcData = useMemo<BoardData>(() => {
    const baseChrome = data.npcCyberware ?? data.cyberware;
    return {
      ...data,
      cyberware: baseChrome,
      loadouts: [],
    };
  }, [data]);

  const offerMap = useMemo(
    () => new Map(npcData.cyberware.map((o) => [o.id, o])),
    [npcData.cyberware],
  );

  const weaponIdSet = useMemo(
    () => new Set((npcData.weapons ?? []).map((w) => w.id)),
    [npcData.weapons],
  );

  const syntheticBoard = useMemo<Board>(() => {
    const base = emptyBoard();
    const mappedChrome: StartCyberware[] = cyberware.map((id) => {
      const def = offerMap.get(id);
      if (!def) {
        return {
          id,
          name: npcData.names?.[id] ?? id,
          humanityCost: 0,
        };
      }
      const parsedRarity = def.rarity ? economyRules.RaritySchema.safeParse(def.rarity) : null;
      const side = armSides[id];
      return {
        id: def.id,
        name: def.name,
        humanityCost: def.category === "lifestyle" ? 0 : def.humanityCost,
        slot: def.slot as CyberSlot,
        ...(def.category ? { category: def.category } : {}),
        ...(parsedRarity?.success ? { rarity: parsedRarity.data } : {}),
        ...(def.custom ? { custom: true } : {}),
        ...(def.packId ? { packId: def.packId } : {}),
        ...(def.ability ? { ability: def.ability } : {}),
        ...(def.armor ? { armor: true } : {}),
        ...(def.accelerator ? { accelerator: true } : {}),
        ...(def.deckProfile ? { deckProfile: def.deckProfile } : {}),
        ...(def.exclusiveGroup ? { exclusiveGroup: def.exclusiveGroup } : {}),
        ...(def.defaultArmSide ? { defaultArmSide: def.defaultArmSide } : {}),
        ...(def.capacityBonus !== undefined ? { capacityBonus: def.capacityBonus } : {}),
        ...(def.safeLineBonus !== undefined ? { safeLineBonus: def.safeLineBonus } : {}),
        ...(def.chassisProfile ? { chassisProfile: def.chassisProfile } : {}),
        ...(side ? { armSide: side } : {}),
      };
    });

    const weapons: string[] = [];
    const items: { readonly id: string; readonly count: number }[] = [];
    for (const id of gear) {
      if (weaponIdSet.has(id)) {
        weapons.push(id);
      } else {
        items.push({ id, count: 1 });
      }
    }

    return {
      ...base,
      cyberware: mappedChrome,
      kit: {
        ...base.kit,
        weapons,
        items,
      },
    };
  }, [cyberware, gear, offerMap, weaponIdSet, npcData.names, armSides]);

  const syntheticCard = useMemo<CharacterCard>(
    () => ({
      name: "",
      alias: "",
      pronoun: "TA",
      origin: "",
      look: "",
      past: "",
      personality: "",
      voice: "",
      locked: [],
      skills: "",
      board: syntheticBoard,
    }),
    [syntheticBoard],
  );

  const loadInfo = useMemo(
    () => boardLoadProfile(syntheticCard, npcData),
    [syntheticCard, npcData],
  );

  const mountedByCore = useMemo(() => {
    const allProbes: cyberwareRules.ExclusiveProbe[] = [];
    for (const c of syntheticBoard.cyberware) {
      const def = offerMap.get(c.id);
      const slot = (def?.slot ?? c.slot) as CyberSlot | undefined;
      if (!slot) continue;
      allProbes.push({
        id: c.id,
        name: c.name,
        slot,
        ...(def?.category || c.category ? { category: def?.category ?? c.category } : {}),
        ...(c.armSide ? { armSide: c.armSide } : {}),
        ...(def?.defaultArmSide || c.defaultArmSide
          ? { defaultArmSide: def?.defaultArmSide ?? c.defaultArmSide }
          : {}),
        ...(def?.armor || c.armor ? { armor: true } : {}),
        ...(def?.accelerator || c.accelerator ? { accelerator: true } : {}),
        ...(def?.deckProfile || c.deckProfile
          ? { deckProfile: def?.deckProfile ?? c.deckProfile }
          : {}),
        ...(def?.deckTraits ? { deckTraits: def.deckTraits } : {}),
        ...(def?.exclusiveGroup || c.exclusiveGroup
          ? { exclusiveGroup: def?.exclusiveGroup ?? c.exclusiveGroup }
          : {}),
      });
    }
    const resolvedArms = cyberwareRules.resolveArmSides(allProbes);
    const out: Record<cyberwareRules.CoreSlotId, string | null> = {
      chassis: null,
      cyberdeck: null,
      spineDrive: null,
      optics: null,
      leftArm: null,
      rightArm: null,
      legDrive: null,
      skinArmor: null,
    };
    for (const p of allProbes) {
      const cat = cyberwareRules.cyberwareCategoryOf(p);
      if (cat === "chassis") out.chassis = p.name;
      else if (cat === "cyberdeck") out.cyberdeck = p.name;
      else if (cat === "spineDrive") out.spineDrive = p.name;
      else if (cat === "optics") out.optics = p.name;
      else if (cat === "legDrive") out.legDrive = p.name;
      else if (cat === "skinArmor") out.skinArmor = p.name;
      else if (cat === "arms") {
        const side = resolvedArms.get(p.id) ?? cyberwareRules.defaultArmSideFor(p);
        if (side === "both") {
          out.leftArm = p.name;
          out.rightArm = `${p.name}（同款）`;
        } else if (side === "left") {
          out.leftArm = p.name;
        } else {
          out.rightArm = p.name;
        }
      }
    }
    return out;
  }, [syntheticBoard.cyberware, offerMap]);

  const silhouetteFocus: BodyFocusKey =
    hoveredBodyFocus ??
    (activeCategory === "arms"
      ? armTarget === "left"
        ? "leftArm"
        : armTarget === "right"
          ? "rightArm"
          : "arms"
      : activeCategory);

  const handleCommit = (nextBoard: Board) => {
    const nextSides: Record<string, cyberwareRules.ArmSide> = {};
    const nextChromeIds: string[] = [];
    for (const c of nextBoard.cyberware) {
      if (!nextChromeIds.includes(c.id)) {
        nextChromeIds.push(c.id);
      }
      if (c.armSide) {
        nextSides[c.id] = c.armSide;
      }
    }
    setArmSides(nextSides);
    const clampedChrome = nextChromeIds.slice(0, NPC_CHROME_MAX);
    if (
      clampedChrome.length !== cyberware.length ||
      clampedChrome.some((id, idx) => id !== cyberware[idx])
    ) {
      onChangeCyberware(clampedChrome);
    }

    const nextGearIds: string[] = [];
    for (const w of nextBoard.kit.weapons) {
      if (!nextGearIds.includes(w)) nextGearIds.push(w);
    }
    for (const item of nextBoard.kit.items ?? []) {
      if (item.count > 0 && !nextGearIds.includes(item.id)) {
        nextGearIds.push(item.id);
      }
    }
    const clampedGear = nextGearIds.slice(0, NPC_GEAR_MAX);
    if (clampedGear.length !== gear.length || clampedGear.some((id, idx) => id !== gear[idx])) {
      onChangeGear(clampedGear);
    }
  };

  const tabLineMask = cssUrl("tab.line");
  const weaponCount = syntheticBoard.kit.weapons.length;
  const itemCount = syntheticBoard.kit.items?.length ?? 0;

  return (
    <div className={wb.stepBody}>
      <div className={wb.subTabs} role="tablist" aria-label="NPC 义体与行装分区">
        <button
          type="button"
          role="tab"
          className={wb.subTab}
          aria-selected={subTab === "topology"}
          onClick={() => setSubTab("topology")}
        >
          <span>
            义体装配 ({cyberware.length}/{NPC_CHROME_MAX} 件 · {loadInfo.label})
          </span>
          <span
            className={wb.subTabLine}
            style={{
              maskImage: tabLineMask,
              WebkitMaskImage: tabLineMask,
            }}
            aria-hidden
          />
        </button>
        <button
          type="button"
          role="tab"
          className={wb.subTab}
          aria-selected={subTab === "weapons"}
          onClick={() => setSubTab("weapons")}
        >
          <span>随身武器 ({weaponCount} 把)</span>
          <span
            className={wb.subTabLine}
            style={{
              maskImage: tabLineMask,
              WebkitMaskImage: tabLineMask,
            }}
            aria-hidden
          />
        </button>
        <button
          type="button"
          role="tab"
          className={wb.subTab}
          aria-selected={subTab === "items"}
          onClick={() => setSubTab("items")}
        >
          <span>随身物品 ({itemCount} 件)</span>
          <span
            className={wb.subTabLine}
            style={{
              maskImage: tabLineMask,
              WebkitMaskImage: tabLineMask,
            }}
            aria-hidden
          />
        </button>
      </div>

      {subTab === "topology" && (
        <div className={wb.v2ChromeStack}>
          <NeuralLoadBar
            load={loadInfo}
            extra={
              cyberware.length > 0 ? (
                <ActionButton onClick={() => onChangeCyberware([])}>卸除全部义体</ActionButton>
              ) : undefined
            }
          />
          <div className={wb.chromeWorkspace}>
            <div className={wb.chromeLeft}>
              <CyberBodySilhouette
                focus={silhouetteFocus}
                chassisLabel={loadInfo.chassisLabel}
                hasFbc={loadInfo.fullBorg !== null}
                installedCount={cyberware.length}
                tone={loadInfo.tone}
              />
            </div>

            <div className={wb.chromeRight}>
              <div className={wb.shelfPanel}>
                <CellFrame />
                <nav className={wb.catNav} aria-label="义体分类切换">
                  <div className={wb.catGroup}>
                    <span className={wb.catGroupLabel}>核心主位</span>
                    <div className={wb.catRow}>
                      {CORE_CYBER_CATEGORIES.map((cat) => {
                        const mounted =
                          cat === "arms"
                            ? Boolean(mountedByCore.leftArm || mountedByCore.rightArm)
                            : Boolean(mountedByCore[cat]);
                        return (
                          <button
                            key={cat}
                            type="button"
                            className={wb.catTab}
                            data-filled={mounted || undefined}
                            aria-pressed={activeCategory === cat}
                            onMouseEnter={() => setHoveredBodyFocus(cat)}
                            onMouseLeave={() => setHoveredBodyFocus(null)}
                            onClick={() => setActiveCategory(cat)}
                          >
                            <span>{cyberwareRules.CYBERWARE_CATEGORY_LABELS[cat]}</span>
                            {mounted && <i className={wb.catDot} aria-hidden />}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div className={wb.catGroup}>
                    <span className={wb.catGroupLabel}>扩展与外观</span>
                    <div className={wb.catRow}>
                      {cyberwareRules.EXTENSION_ZONE_IDS.map((zone) => {
                        const count = loadInfo.zoneCounts[zone];
                        const limit = loadInfo.zoneLimits[zone];
                        return (
                          <button
                            key={zone}
                            type="button"
                            className={wb.catTab}
                            data-filled={count > 0 || undefined}
                            aria-pressed={activeCategory === zone}
                            onMouseEnter={() => setHoveredBodyFocus(zone)}
                            onMouseLeave={() => setHoveredBodyFocus(null)}
                            onClick={() => setActiveCategory(zone)}
                          >
                            <span>{cyberwareRules.EXTENSION_ZONE_LABELS[zone]}</span>
                            <span className={wb.catCount}>
                              {limit === null ? count : `${count}/${limit}`}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </nav>

                <CyberwareShelf
                  card={syntheticCard}
                  board={syntheticBoard}
                  data={npcData}
                  commit={handleCommit}
                  category={activeCategory}
                  armTarget={armTarget}
                  onArmTargetChange={setArmTarget}
                  onCategoryChange={setActiveCategory}
                  maxCount={NPC_CHROME_MAX}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {subTab !== "topology" && (
        <div key={`npc-loadout-${subTab}`} className={wb.embeddedPanel}>
          <LoadoutPicker
            card={syntheticCard}
            board={syntheticBoard}
            data={npcData}
            commit={handleCommit}
            section={subTab}
            onSwitchSection={(next) => {
              if (next === "weapons" || next === "items") setSubTab(next);
            }}
            maxTotalGear={NPC_GEAR_MAX}
            singleItemCount
          />
        </div>
      )}
    </div>
  );
}
