import { buildVCharacterCard, RADAR_ANCHORS, type VGender, type VOriginKey } from "@cp/content";
import {
  type Board,
  CASH_TIER_INFO,
  CASH_TIERS,
  type CharacterCard,
  CUSTOM_EDDIES_MAX,
  cyberwareRules,
  FLAW_MAX,
  type ImagePromptRequest,
  PAST_MAX,
  RELATION_INFO,
  replacedNpcIdOf,
  SKILL_MAX,
  TAROT_CARDS,
  TAROT_INFO,
  type TarotCard,
} from "@cp/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, type BoardData } from "../../api/client";
import type { AssetId } from "../../assets";
import { ActionButton } from "../../ui/ActionButton";
import { Asset, cssUrl } from "../../ui/Asset";
import { Button } from "../../ui/Button";
import { CellFrame, FrameBox } from "../../ui/FrameBox";
import { useCardTilt } from "../../ui/useCardTilt";
import { GeneratedImage, ImageLightbox } from "../images/GeneratedImage";
import { ImageGenModal } from "../images/ImageGenModal";
import {
  type BodyFocusKey,
  CyberBodySilhouette,
  type CyberSlot,
  NeuralLoadBar,
} from "../story/CyberDoll";
import { PeoplePicker } from "./CreatorLife";
import {
  CyberwareShelf,
  FlawPicker,
  LoadoutPicker,
  OriginPicker,
  PastPicker,
  type PickerProps,
  TraitPicker,
} from "./CreatorSteps";
import {
  boardLoadProfile,
  type CheckTarget,
  CREATOR_STEPS,
  type CreatorStepId,
  clearDraft,
  creatorChecks,
  defaultStartLocationFor,
  emptyBoard,
  inherentCyberware,
  LOCAL_CYBERWARE_EVENT,
  LOCAL_ITEMS_EVENT,
  LOCAL_MODULES_EVENT,
  loadLocalCustomCyberware,
  loadLocalCustomItems,
  loadLocalCustomModules,
  loadLocalCustomNpcs,
  loadLocalNpcOverrides,
  mergeCreatorCatalog,
  ORIGIN_ECOSYSTEM_LABELS,
  originDefaultLoadout,
  originEcosystem,
  stepForCheckTarget,
  stepProgress,
} from "./creator";
import { DossierAppearancePanel } from "./DossierAppearancePanel";
import { anchorLabel, StartMapPicker, startAnchor } from "./StartMapPicker";
import wb from "./workbench.module.css";

const PRONOUN_PRESETS: readonly string[] = ["他", "她", "TA"];
const V_GENDER_OPTIONS: readonly { readonly id: VGender; readonly label: string }[] = [
  { id: "female", label: "女 V · 瓦莱丽" },
  { id: "male", label: "男 V · 文森特" },
];
const V_ORIGIN_OPTIONS: readonly { readonly id: VOriginKey; readonly label: string }[] = [
  { id: "street-kid", label: "街头小子" },
  { id: "nomad", label: "流浪者" },
  { id: "corpo", label: "公司员工" },
];

type TraitsTab = "past" | "skill" | "flaw";
type CyberTab = "topology" | "weapons" | "items" | "kit";
type ConnectionsTab = "people" | "map";

/** 塔罗命牌卡：带光标跟随 3D 按压倾斜与全息镜面反光 */
function TarotCardButton({
  id,
  active,
  onPick,
}: {
  readonly id: TarotCard;
  readonly active: boolean;
  readonly onPick: () => void;
}) {
  const info = TAROT_INFO[id];
  const tilt = useCardTilt<HTMLButtonElement>({
    maxRotate: 6.5,
    shadowShift: 5,
  });
  return (
    <button
      type="button"
      className={wb.tarotCard}
      aria-pressed={active}
      title={`${info.roman} ${info.label}（${info.english}）— ${info.vibe}`}
      onClick={onPick}
      {...tilt}
    >
      <span className={wb.tarotSheen} aria-hidden />
      <span className={wb.tarotArtWrap}>
        <Asset
          id={`tarot.${id}` as AssetId}
          alt={`${info.label}（${info.english}）`}
          className={wb.tarotArt}
        />
        <span className={wb.tarotRoman}>{info.roman}</span>
      </span>
      <span className={wb.tarotMeta}>
        <strong className={wb.tarotLabel}>{info.label}</strong>
        <span className={wb.tarotEn}>{info.english}</span>
        <span className={wb.tarotVibe}>{info.vibe}</span>
      </span>
    </button>
  );
}

/**
 * 2077 开放式四步角色创建工作台：
 * - 顶部四步进度轨（01 身份与出身 / 02 履历与特质 / 03 义体与行装 / 04 旧识与落脚点）
 * - 左侧开放主编辑舞台（所有定制器直出内嵌，子标签避免拥挤）
 * - 右侧常驻 NC LIVE DOSSIER 档案栏（3:4 立绘、上传图片反推外貌描述、命牌、人性仪表、摘要、核验清单与唯一保存/入城发射台）
 * - 底部纯净步骤导航条（上一步 / 下一步 + 草稿保存状态）
 */
export function CharacterCreator({
  card,
  boardData,
  busy,
  canDelete,
  canSave,
  isSample = false,
  dirty = false,
  characterId,
  saveError = null,
  saved = false,
  draftSaved,
  onLaunchingChange,
  onChange,
  onSave,
  onDelete,
  onLaunch,
}: {
  readonly card: CharacterCard;
  readonly boardData: BoardData | undefined;
  readonly busy: boolean;
  readonly canDelete: boolean;
  readonly canSave: boolean;
  readonly isSample?: boolean;
  readonly dirty?: boolean;
  readonly characterId: string | null;
  readonly saveError?: string | null;
  readonly saved?: boolean;
  readonly draftSaved: boolean;
  readonly onLaunchingChange: (launching: boolean) => void;
  readonly onChange: (next: CharacterCard | ((current: CharacterCard) => CharacterCard)) => void;
  readonly onSave: (card: CharacterCard) => Promise<{ readonly id: string }>;
  readonly onDelete: () => void;
  readonly onLaunch: (saveId: string) => void;
}) {
  const board = card.board ?? emptyBoard();
  const [activeStep, setActiveStep] = useState<CreatorStepId>("identity");
  const [traitsTab, setTraitsTab] = useState<TraitsTab>("past");
  const [cyberTab, setCyberTab] = useState<CyberTab>("topology");
  const [connectionsTab, setConnectionsTab] = useState<ConnectionsTab>("people");
  const [activeCategory, setActiveCategory] =
    useState<cyberwareRules.CyberwareCategoryId>("cyberdeck");
  const [armTarget, setArmTarget] = useState<cyberwareRules.ArmSide>("both");
  const [hoveredBodyFocus, setHoveredBodyFocus] = useState<BodyFocusKey>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [tarotExpanded, setTarotExpanded] = useState(false);
  const [saveTitle, setSaveTitle] = useState("");
  const [localSaveError, setLocalSaveError] = useState<string | null>(null);
  const [portraitModalOpen, setPortraitModalOpen] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [localModules, setLocalModules] = useState(() => loadLocalCustomModules());
  const [localCyberware, setLocalCyberware] = useState(() => loadLocalCustomCyberware());
  const [localItems, setLocalItems] = useState(() => loadLocalCustomItems());
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const stageRef = useRef<HTMLElement | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    const syncModules = () => setLocalModules(loadLocalCustomModules());
    const syncChrome = () => setLocalCyberware(loadLocalCustomCyberware());
    const syncItems = () => setLocalItems(loadLocalCustomItems());
    window.addEventListener(LOCAL_MODULES_EVENT, syncModules);
    window.addEventListener(LOCAL_CYBERWARE_EVENT, syncChrome);
    window.addEventListener(LOCAL_ITEMS_EVENT, syncItems);
    return () => {
      window.removeEventListener(LOCAL_MODULES_EVENT, syncModules);
      window.removeEventListener(LOCAL_CYBERWARE_EVENT, syncChrome);
      window.removeEventListener(LOCAL_ITEMS_EVENT, syncItems);
    };
  }, []);

  const boardCustomCyberware = useMemo(
    () => board.cyberware.filter((c) => Boolean(c.custom && c.slot)),
    [board.cyberware],
  );
  const boardCustomItems = useMemo(() => board.kit.customItems ?? [], [board.kit.customItems]);
  const data = useMemo(
    () =>
      boardData
        ? mergeCreatorCatalog(
            boardData,
            localModules,
            [],
            [...localCyberware, ...boardCustomCyberware],
            [...localItems, ...boardCustomItems],
          )
        : undefined,
    [boardData, localModules, localCyberware, boardCustomCyberware, localItems, boardCustomItems],
  );
  const fallbackLoc = defaultStartLocationFor(card, data);
  const validBoardLoc =
    board.startLocation && RADAR_ANCHORS.some((anchor) => anchor.id === board.startLocation)
      ? board.startLocation
      : undefined;
  const startLoc = validBoardLoc || fallbackLoc;

  const commit = (next: Board, origin?: string) => {
    setLocalSaveError(null);
    onChange((current) => ({
      ...current,
      ...(origin !== undefined ? { origin } : {}),
      board: next,
    }));
  };

  const change = (patch: Partial<CharacterCard>) => {
    setLocalSaveError(null);
    onChange((current) => ({ ...current, ...patch }));
  };

  const setLoc = (loc: string) => {
    setLocalSaveError(null);
    onChange((current) => {
      const currentBoard = current.board ?? emptyBoard();
      const { startLocation: _, ...rest } = currentBoard;
      return {
        ...current,
        board: { ...rest, ...(loc ? { startLocation: loc } : {}) },
      };
    });
  };

  const setTarot = (tarot: TarotCard) => {
    setLocalSaveError(null);
    onChange((current) => {
      const currentBoard = current.board ?? emptyBoard();
      const nextTarot = currentBoard.tarot === tarot ? undefined : tarot;
      const { tarot: _, ...rest } = currentBoard;
      return {
        ...current,
        board: { ...rest, ...(nextTarot ? { tarot: nextTarot } : {}) },
      };
    });
  };

  const drawRandomTarot = () => {
    const candidates = TAROT_CARDS.filter((id) => id !== board.tarot);
    const picked = candidates[Math.floor(Math.random() * candidates.length)] ?? TAROT_CARDS[0];
    setLocalSaveError(null);
    onChange((current) => {
      const currentBoard = current.board ?? emptyBoard();
      return {
        ...current,
        board: { ...currentBoard, tarot: picked },
      };
    });
  };

  const launchMutation = useMutation({
    mutationFn: async () => {
      const targetCard: CharacterCard = {
        ...card,
        board,
      };
      const savedEntry =
        isSample && !dirty && characterId ? { id: characterId } : await onSave(targetCard);
      const globalOverrides = loadLocalNpcOverrides();
      const globalCustomNpcs = loadLocalCustomNpcs();
      const save = await api.createSave({
        characterId: savedEntry.id,
        title: saveTitle.trim() || `${card.name.trim()}的夜之城传奇`,
        ...(startLoc ? { startLocation: startLoc } : {}),
        ...(globalOverrides.length > 0 ? { npcOverrides: globalOverrides } : {}),
        ...(globalCustomNpcs.length > 0 ? { customNpcs: globalCustomNpcs } : {}),
      });
      await queryClient.invalidateQueries({ queryKey: ["saves"] });
      clearDraft();
      return save.id;
    },
    onSuccess: (saveId) => onLaunch(saveId),
    onSettled: () => onLaunchingChange(false),
  });

  const checks = creatorChecks(card);
  const progress = stepProgress(card, data);
  const canLaunch =
    Boolean(data) && canSave && checks.length === 0 && !busy && !launchMutation.isPending;

  const goToStep = (step: CreatorStepId) => {
    setActiveStep(step);
    setSidebarOpen(false);
    stageRef.current?.scrollTo({ top: 0, behavior: "auto" });
  };

  const jumpToCheck = (target: CheckTarget) => {
    const step = stepForCheckTarget(target);
    goToStep(step);
    if (target === "kit") setCyberTab("kit");
    if (target === "cyber") setCyberTab("topology");
    if (target === "people") setConnectionsTab("people");
    if (target === "identity") {
      requestAnimationFrame(() => nameInputRef.current?.focus());
    }
  };

  // ———— 义体与三段式神经承载 ————
  const inherent = inherentCyberware(card, data);
  const activeInherentCount = inherent.filter((i) => !i.replaced).length;
  const loadInfo = boardLoadProfile(card, data);

  const mountedByCore = useMemo(() => {
    const defOfChrome = (id: string) => data?.cyberware.find((o) => o.id === id);
    const allProbes: (cyberwareRules.ExclusiveProbe & { readonly isInherent?: boolean })[] = [];
    for (const c of board.cyberware) {
      const def = defOfChrome(c.id);
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
    for (const i of inherent) {
      if (i.replaced) continue;
      const def = defOfChrome(i.id);
      allProbes.push({
        id: i.id,
        name: `${i.name}（标配）`,
        slot: i.slot as CyberSlot,
        isInherent: true,
        ...(def?.category ? { category: def.category } : {}),
        ...(def?.defaultArmSide ? { defaultArmSide: def.defaultArmSide } : {}),
        ...(def?.armor ? { armor: true } : {}),
        ...(def?.accelerator ? { accelerator: true } : {}),
        ...(def?.deckProfile ? { deckProfile: def.deckProfile } : {}),
        ...(def?.deckTraits ? { deckTraits: def.deckTraits } : {}),
        ...(def?.exclusiveGroup ? { exclusiveGroup: def.exclusiveGroup } : {}),
      });
    }
    const armSides = cyberwareRules.resolveArmSides(allProbes);
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
        const side = armSides.get(p.id) ?? cyberwareRules.defaultArmSideFor(p);
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
  }, [board.cyberware, inherent, data]);

  const silhouetteFocus: BodyFocusKey =
    hoveredBodyFocus ??
    (activeCategory === "arms"
      ? armTarget === "left"
        ? "leftArm"
        : armTarget === "right"
          ? "rightArm"
          : "arms"
      : activeCategory);

  // ———— 摘要数据 ————
  const anchor = startAnchor(startLoc);
  const fallbackAnchor = startAnchor(fallbackLoc);
  const loadoutSummary = originDefaultLoadout(card, data);
  const weaponNames = board.kit.weapons.map(
    (id) => data?.weapons?.find((w) => w.id === id)?.name ?? data?.names?.[id] ?? id,
  );
  const itemSummary = (board.kit.items ?? []).map((entry) => {
    const label =
      data?.items?.find((i) => i.id === entry.id)?.name ?? data?.names?.[entry.id] ?? entry.id;
    return entry.count > 1 ? `${label}×${entry.count}` : label;
  });
  const customVehicleName = board.kit.vehicle
    ? (data?.vehicles?.find((v) => v.id === board.kit.vehicle)?.name ?? board.kit.vehicle)
    : null;
  // 专属载具会直接替换出身自带载具，档案栏与实际开局保持一致
  const effectiveVehicles = customVehicleName
    ? [customVehicleName]
    : [...loadoutSummary.freeVehicleNames];
  const mountedChromeNames = [
    ...inherent.filter((i) => !i.replaced).map((i) => i.name),
    ...board.cyberware.map((c) => c.name),
  ];
  const selectedTraitNames = [
    ...board.pasts.map((m) => m.label),
    ...board.skills.map((m) => m.label),
  ];
  const activeTarot = board.tarot ? TAROT_INFO[board.tarot] : null;

  // 立绘提示词仅传入随身武器与义体，不将载具塞进随身装备
  const characterPromptRequest: ImagePromptRequest = {
    kind: "character",
    name: card.name.trim() || "Merc",
    alias: card.alias.trim(),
    pronoun: card.pronoun.trim() || "TA",
    origin: board.origin?.label ?? card.origin.trim(),
    look: card.look.trim(),
    personality: activeTarot
      ? [activeTarot.vibe, card.personality.trim()].filter(Boolean).join("；")
      : card.personality.trim(),
    skills: selectedTraitNames.join("、") || card.skills.trim(),
    cyberware: mountedChromeNames,
    gear: weaponNames,
    instruction: "",
  };

  const clearPortrait = () => {
    setLocalSaveError(null);
    onChange((current) => {
      const { portrait: _, ...rest } = current;
      return rest;
    });
  };

  const handleSave = async () => {
    setLocalSaveError(null);
    try {
      await onSave({ ...card, board });
    } catch (err) {
      setLocalSaveError(err instanceof Error ? err.message : "保存角色失败，请重试");
    }
  };

  const pickerProps: PickerProps | null = data ? { card, board, data, commit, change } : null;
  const currentStepIndex = CREATOR_STEPS.findIndex((s) => s.id === activeStep);
  const currentStep = CREATOR_STEPS[currentStepIndex] ?? CREATOR_STEPS[0];
  const tabLineMask = cssUrl("tab.line");
  const gridUrl = cssUrl("fx.grid");
  const displaySaveError = saveError ?? localSaveError;

  return (
    <div className={wb.bench}>
      {/* —————— 顶部四步进度轨 —————— */}
      <div className={wb.railBar} inert={busy}>
        <nav className={wb.stepRail} aria-label="创角流程步骤">
          {CREATOR_STEPS.map((step) => {
            const item = progress[step.id];
            const active = activeStep === step.id;
            const statusIcon = item.issueCount > 0 ? "⚠ " : item.ready && item.filled ? "✓ " : "";
            return (
              <button
                key={step.id}
                type="button"
                className={wb.stepBtn}
                aria-current={active ? "step" : undefined}
                data-warn={item.issueCount > 0 ? "" : undefined}
                data-ready={item.ready && item.filled ? "" : undefined}
                onClick={() => goToStep(step.id)}
              >
                <span className={wb.stepTopRow}>
                  <span className={wb.stepCode}>{step.code}</span>
                  <span className={wb.stepLabel}>{step.label}</span>
                  <span
                    className={wb.stepBadge}
                    data-warn={item.issueCount > 0 ? "" : undefined}
                    data-ready={item.ready && item.filled ? "" : undefined}
                  >
                    {statusIcon}
                    {item.badge}
                  </span>
                </span>
                <span
                  className={wb.stepUnderline}
                  style={{
                    maskImage: tabLineMask,
                    WebkitMaskImage: tabLineMask,
                  }}
                  aria-hidden
                />
              </button>
            );
          })}
        </nav>

        <div className={wb.mobileSummaryToggle}>
          <span className={wb.note}>
            {card.name.trim() || "未命名角色"} · {loadInfo.label} ·{" "}
            {checks.length === 0 ? "✓ 已就绪" : `待完善 ${checks.length} 项`}
          </span>
          <Button small pressed={sidebarOpen} onClick={() => setSidebarOpen((open) => !open)}>
            {sidebarOpen ? "收起档案" : "档案 / 外貌与开局"}
          </Button>
        </div>
      </div>

      {/* —————— 中央双栏：开放主编辑舞台 + 常驻右侧 NC LIVE DOSSIER —————— */}
      <div className={wb.mainSplit} inert={busy}>
        <div className={wb.stageShell}>
          <section
            ref={stageRef}
            className={wb.stageScroll}
            data-locked-scroll={
              activeStep === "cyberware" && cyberTab === "topology" ? "" : undefined
            }
            aria-label={currentStep?.title}
          >
            <header className={wb.stageHead}>
              <div className={wb.stageHeadRow}>
                <span className={wb.stageCode}>STEP {currentStep?.code}</span>
                <h2 className={wb.stageTitle}>{currentStep?.title}</h2>
                {isSample && !dirty && <span className={wb.tag}>官方预设模板</span>}
              </div>
              <p className={wb.stageLead}>{currentStep?.lead}</p>
            </header>

            {/* ———— Step 01：身份与出身（公民铭牌 + 2077 命牌 + 出身背景） ———— */}
            {activeStep === "identity" && (
              <div key="step-identity" className={wb.stepBody}>
                {replacedNpcIdOf(card) === "v" && (
                  <section className={wb.vPresetBar} aria-label="V 预设快速调配">
                    <div className={wb.vPresetHead}>
                      <span className={wb.vPresetTitle}>V 预设快速调配 · 性别 × 三出身</span>
                      <span className={wb.note}>
                        一键切换性别与出身，自动同步背景、装备、义体与旧识；切完后仍可自由微调，开新档自动去重城内
                        NPC 版 V。
                      </span>
                    </div>
                    <div className={wb.vPresetGroups}>
                      <div className={wb.vPresetGroup}>
                        <span className={wb.vPresetLabel}>性别</span>
                        {V_GENDER_OPTIONS.map((opt) => {
                          const curGender: VGender =
                            card.pronoun === "他" || card.name.trim() === "文森特"
                              ? "male"
                              : "female";
                          const curOrigin: VOriginKey =
                            board.origin?.id === "nomad"
                              ? "nomad"
                              : board.origin?.id === "corpo"
                                ? "corpo"
                                : "street-kid";
                          return (
                            <Button
                              key={opt.id}
                              small
                              primary={curGender === opt.id}
                              pressed={curGender === opt.id}
                              onClick={() => {
                                const next = buildVCharacterCard(opt.id, curOrigin);
                                onChange({
                                  ...next,
                                  ...(card.portrait ? { portrait: card.portrait } : {}),
                                });
                              }}
                            >
                              {opt.label}
                            </Button>
                          );
                        })}
                      </div>
                      <div className={wb.vPresetGroup}>
                        <span className={wb.vPresetLabel}>出身</span>
                        {V_ORIGIN_OPTIONS.map((opt) => {
                          const curGender: VGender =
                            card.pronoun === "他" || card.name.trim() === "文森特"
                              ? "male"
                              : "female";
                          const curOrigin: VOriginKey =
                            board.origin?.id === "nomad"
                              ? "nomad"
                              : board.origin?.id === "corpo"
                                ? "corpo"
                                : "street-kid";
                          return (
                            <Button
                              key={opt.id}
                              small
                              primary={curOrigin === opt.id}
                              pressed={curOrigin === opt.id}
                              onClick={() => {
                                const next = buildVCharacterCard(curGender, opt.id);
                                onChange({
                                  ...next,
                                  ...(card.portrait ? { portrait: card.portrait } : {}),
                                });
                              }}
                            >
                              {opt.label}
                            </Button>
                          );
                        })}
                      </div>
                    </div>
                  </section>
                )}

                <section className={wb.formCard} aria-label="公民身份信息">
                  <h3 className={wb.cardTitle}>身份铭牌 · CITIZEN ID</h3>
                  <div className={wb.nameGrid}>
                    <label className={wb.field}>
                      <span>
                        姓名 <b className={wb.req}>*</b>
                        <small>{card.name.length} / 30</small>
                      </span>
                      <FrameBox className={wb.compactBox}>
                        <input
                          ref={nameInputRef}
                          value={card.name}
                          maxLength={30}
                          placeholder="例如：V、林烬、阿九"
                          onChange={(e) => change({ name: e.target.value })}
                        />
                      </FrameBox>
                    </label>
                    <label className={wb.field}>
                      <span>
                        街头代号 / 绰号 <small>{card.alias.length} / 30</small>
                      </span>
                      <FrameBox className={wb.compactBox}>
                        <input
                          value={card.alias}
                          maxLength={30}
                          placeholder="选填，例如：幽灵、断线人"
                          onChange={(e) => change({ alias: e.target.value })}
                        />
                      </FrameBox>
                    </label>
                    <div className={wb.field}>
                      <span>
                        人称代词 <b className={wb.req}>*</b>
                      </span>
                      <div className={wb.pronounRow}>
                        <fieldset className={wb.pronounPills} aria-label="常用人称代词">
                          {PRONOUN_PRESETS.map((p) => (
                            <Button
                              key={p}
                              small
                              pressed={card.pronoun === p}
                              onClick={() => change({ pronoun: p })}
                            >
                              {p}
                            </Button>
                          ))}
                        </fieldset>
                        <FrameBox className={`${wb.compactBox} ${wb.pronounInput}`}>
                          <input
                            value={card.pronoun}
                            maxLength={10}
                            aria-label="自定义人称代词"
                            placeholder="自填"
                            onChange={(e) => change({ pronoun: e.target.value })}
                          />
                        </FrameBox>
                      </div>
                    </div>
                  </div>
                </section>

                <section className={wb.formCard} aria-label="2077 塔罗命牌">
                  <div className={wb.subHeaderRow}>
                    <h3 className={wb.cardTitle}>
                      夜之城命牌 · TAROT ARCHETYPE（{TAROT_CARDS.length} 张大阿卡那）
                      {activeTarot ? ` · ${activeTarot.roman} ${activeTarot.label}` : " · 选填"}
                    </h3>
                    <div className={wb.tarotToolbar}>
                      <ActionButton onClick={drawRandomTarot}>随机抽牌</ActionButton>
                      {board.tarot && (
                        <ActionButton
                          onClick={() => {
                            if (board.tarot) setTarot(board.tarot);
                          }}
                        >
                          清除命牌
                        </ActionButton>
                      )}
                      <ActionButton onClick={() => setTarotExpanded((open) => !open)}>
                        {tarotExpanded ? "收起牌阵" : `展开全部 ${TAROT_CARDS.length} 张`}
                      </ActionButton>
                    </div>
                  </div>
                  {activeTarot ? (
                    <div key={board.tarot} className={wb.tarotSelectedBar}>
                      <span className={wb.tarotSelectedArtWrap}>
                        <Asset
                          id={`tarot.${board.tarot}` as AssetId}
                          alt={`${activeTarot.label}（${activeTarot.english}）`}
                          className={wb.tarotArt}
                        />
                        <span className={wb.tarotRoman}>{activeTarot.roman}</span>
                      </span>
                      <div className={wb.tarotSelectedCopy}>
                        <div className={wb.tarotSelectedHead}>
                          <strong className={wb.tarotSelectedName}>
                            {activeTarot.roman} · {activeTarot.label}
                          </strong>
                          <span className={wb.tarotEn}>{activeTarot.english}</span>
                        </div>
                        <p className={wb.tarotSelectedVibe}>{activeTarot.vibe}</p>
                      </div>
                    </div>
                  ) : (
                    <span className={wb.note}>
                      从 22 张 2077
                      原作大阿卡那塔罗中抽选一张命牌，定调角色在街头与叙事中的气质偏向（可随时切换或取消）。
                    </span>
                  )}
                  <fieldset
                    className={wb.tarotGrid}
                    data-expanded={tarotExpanded || undefined}
                    aria-label="选择 2077 塔罗命牌"
                  >
                    {TAROT_CARDS.map((id) => (
                      <TarotCardButton
                        key={id}
                        id={id}
                        active={board.tarot === id}
                        onPick={() => setTarot(id)}
                      />
                    ))}
                  </fieldset>
                </section>

                {board.origin && (
                  <section className={wb.originSummary} aria-label="当前出身开局配置">
                    <div className={wb.originSummaryHead}>
                      <div className={wb.originSummaryTitle}>
                        <span className={wb.tag}>
                          {ORIGIN_ECOSYSTEM_LABELS[originEcosystem(board.origin)]}
                        </span>
                        <strong>{board.origin.label}</strong>
                      </div>
                      <span className={wb.originMetrics}>
                        启动资金 <b>{loadoutSummary.finalEddies.toLocaleString("en-US")} €</b> ·
                        标配义体 <b>{activeInherentCount}</b> 件 · 默认起点{" "}
                        <b>{fallbackAnchor?.name ?? "沃森 H10"}</b>
                      </span>
                    </div>
                    {board.origin.ability && (
                      <p className={wb.originLine}>{board.origin.ability}</p>
                    )}
                  </section>
                )}

                <section className={wb.embeddedPanel} aria-label="出身背景选择">
                  <div className={wb.subHeaderRow}>
                    <h3 className={wb.cardTitle}>
                      出身背景 <b className={wb.req}>*</b>
                    </h3>
                    <span className={wb.note}>
                      决定初始资金、默认落脚点与标配行装，支持按生态筛选、搜索与自定义。
                    </span>
                  </div>
                  {pickerProps ? (
                    <OriginPicker {...pickerProps} />
                  ) : (
                    <p className={wb.note}>正在加载出身背景目录…</p>
                  )}
                </section>
              </div>
            )}

            {/* ———— Step 02：履历与特质（三层分栏：过往履历 / 核心特质 / 负面缺陷） ———— */}
            {activeStep === "traits" && (
              <div key="step-traits" className={wb.stepBody}>
                <div className={wb.subTabs} role="tablist" aria-label="履历与特质分区">
                  <button
                    type="button"
                    role="tab"
                    className={wb.subTab}
                    aria-selected={traitsTab === "past"}
                    onClick={() => setTraitsTab("past")}
                  >
                    <span>
                      过往履历 ({board.pasts.length}/{PAST_MAX})
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
                    aria-selected={traitsTab === "skill"}
                    onClick={() => setTraitsTab("skill")}
                  >
                    <span>
                      核心特质 ({board.skills.length}/{SKILL_MAX})
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
                    aria-selected={traitsTab === "flaw"}
                    onClick={() => setTraitsTab("flaw")}
                  >
                    <span>
                      负面缺陷 ({board.flaws.length}/{FLAW_MAX})
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
                </div>

                {(board.pasts.length > 0 || board.skills.length > 0 || board.flaws.length > 0) && (
                  <section className={wb.equippedTray} aria-label="已装配履历与特质">
                    <span className={wb.equippedTrayLabel}>已选</span>
                    <div className={wb.equippedChips}>
                      {board.pasts.map((m) => (
                        <span key={`p:${m.id}`} className={wb.equippedChip} data-kind="past">
                          <button
                            type="button"
                            className={wb.equippedChipMain}
                            onClick={() => setTraitsTab("past")}
                          >
                            <span className={wb.equippedChipKind}>履历</span>
                            {m.label}
                          </button>
                          <button
                            type="button"
                            className={wb.equippedChipRemove}
                            aria-label={`移除履历 ${m.label}`}
                            onClick={() =>
                              commit({ ...board, pasts: board.pasts.filter((x) => x.id !== m.id) })
                            }
                          >
                            ×
                          </button>
                        </span>
                      ))}
                      {board.skills.map((m) => (
                        <span key={`s:${m.id}`} className={wb.equippedChip} data-kind="skill">
                          <button
                            type="button"
                            className={wb.equippedChipMain}
                            onClick={() => setTraitsTab("skill")}
                          >
                            <span className={wb.equippedChipKind}>特质</span>
                            {m.label}
                          </button>
                          <button
                            type="button"
                            className={wb.equippedChipRemove}
                            aria-label={`移除特质 ${m.label}`}
                            onClick={() =>
                              commit({
                                ...board,
                                skills: board.skills.filter((x) => x.id !== m.id),
                              })
                            }
                          >
                            ×
                          </button>
                        </span>
                      ))}
                      {board.flaws.map((m) => (
                        <span key={`f:${m.id}`} className={wb.equippedChip} data-kind="flaw">
                          <button
                            type="button"
                            className={wb.equippedChipMain}
                            onClick={() => setTraitsTab("flaw")}
                          >
                            <span className={wb.equippedChipKind}>缺陷</span>
                            {m.label}
                          </button>
                          <button
                            type="button"
                            className={wb.equippedChipRemove}
                            aria-label={`移除缺陷 ${m.label}`}
                            onClick={() =>
                              commit({ ...board, flaws: board.flaws.filter((x) => x.id !== m.id) })
                            }
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  </section>
                )}

                {traitsTab === "past" && (
                  <div key="tab-past" className={wb.embeddedPanel}>
                    {pickerProps ? (
                      <PastPicker {...pickerProps} />
                    ) : (
                      <p className={wb.note}>正在加载过往履历目录…</p>
                    )}
                  </div>
                )}

                {traitsTab === "skill" && (
                  <div key="tab-skill" className={wb.embeddedPanel}>
                    {pickerProps ? (
                      <TraitPicker {...pickerProps} />
                    ) : (
                      <p className={wb.note}>正在加载核心特质目录…</p>
                    )}
                  </div>
                )}

                {traitsTab === "flaw" && (
                  <div key="tab-flaw" className={wb.embeddedPanel}>
                    {pickerProps ? (
                      <FlawPicker {...pickerProps} />
                    ) : (
                      <p className={wb.note}>正在加载负面缺陷目录…</p>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ———— Step 03：义体与行装（四分区直达：义体装配 / 随身武器 / 随身物品 / 资金与座驾） ———— */}
            {activeStep === "cyberware" && (
              <div key="step-cyberware" className={wb.stepBody}>
                <div className={wb.subTabs} role="tablist" aria-label="义体与行装分区">
                  <button
                    type="button"
                    role="tab"
                    className={wb.subTab}
                    aria-selected={cyberTab === "topology"}
                    onClick={() => setCyberTab("topology")}
                  >
                    <span>
                      义体装配 ({board.cyberware.length + activeInherentCount} 件 · {loadInfo.label}
                      )
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
                    aria-selected={cyberTab === "weapons"}
                    onClick={() => setCyberTab("weapons")}
                  >
                    <span>随身武器 ({board.kit.weapons.length} 把)</span>
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
                    aria-selected={cyberTab === "items"}
                    onClick={() => setCyberTab("items")}
                  >
                    <span>随身物品 ({board.kit.items?.length ?? 0} 种)</span>
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
                    aria-selected={cyberTab === "kit"}
                    onClick={() => setCyberTab("kit")}
                  >
                    <span>专属座驾 ({effectiveVehicles[0] ?? "步行"})</span>
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

                {cyberTab === "topology" && (
                  <div className={wb.v2ChromeStack}>
                    <NeuralLoadBar
                      load={loadInfo}
                      extra={
                        board.cyberware.length > 0 ? (
                          <ActionButton onClick={() => commit({ ...board, cyberware: [] })}>
                            卸除全部自选
                          </ActionButton>
                        ) : undefined
                      }
                    />
                    <div className={wb.chromeWorkspace}>
                      <div className={wb.chromeLeft}>
                        <CyberBodySilhouette
                          focus={silhouetteFocus}
                          chassisLabel={loadInfo.chassisLabel}
                          hasFbc={loadInfo.fullBorg !== null}
                          installedCount={mountedChromeNames.length}
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
                                {(
                                  [
                                    "chassis",
                                    "cyberdeck",
                                    "spineDrive",
                                    "optics",
                                    "arms",
                                    "legDrive",
                                    "skinArmor",
                                  ] as const
                                ).map((cat) => {
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

                          {pickerProps ? (
                            <CyberwareShelf
                              {...pickerProps}
                              category={activeCategory}
                              armTarget={armTarget}
                              onArmTargetChange={setArmTarget}
                              onCategoryChange={setActiveCategory}
                            />
                          ) : (
                            <p className={wb.note}>正在加载义体货架…</p>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {cyberTab !== "topology" && (
                  <div key={`loadout-${cyberTab}`} className={wb.embeddedPanel}>
                    {pickerProps ? (
                      <LoadoutPicker
                        {...pickerProps}
                        section={cyberTab}
                        onSwitchSection={(next) => setCyberTab(next)}
                      />
                    ) : (
                      <p className={wb.note}>正在加载开局行装目录…</p>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ———— Step 04：旧识与落脚点（子标签隔离：夜之城旧识 / 开局落脚点） ———— */}
            {activeStep === "connections" && (
              <div className={wb.stepBody}>
                <div className={wb.subTabs} role="tablist" aria-label="旧识与落脚点分区">
                  <button
                    type="button"
                    role="tab"
                    className={wb.subTab}
                    aria-selected={connectionsTab === "people"}
                    onClick={() => setConnectionsTab("people")}
                  >
                    <span>夜之城旧识 ({board.acquaintances.length} 人)</span>
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
                    aria-selected={connectionsTab === "map"}
                    onClick={() => setConnectionsTab("map")}
                  >
                    <span>
                      开局落脚点 ·{" "}
                      {anchor
                        ? anchor.name
                        : board.startLocation
                          ? board.startLocation
                          : "跟随出身"}
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
                </div>

                {connectionsTab === "people" && (
                  <div className={wb.embeddedPanel}>
                    {data ? (
                      <PeoplePicker
                        board={board}
                        data={data}
                        commit={commit}
                        replacesNpcId={replacedNpcIdOf(card)}
                      />
                    ) : (
                      <p className={wb.note}>正在加载夜之城人物目录…</p>
                    )}
                  </div>
                )}

                {connectionsTab === "map" && (
                  <section className={wb.embeddedPanel} aria-label="开局落脚点">
                    <div className={wb.subHeaderRow}>
                      <h3 className={wb.cardTitle}>
                        开局落脚点：
                        {anchor
                          ? anchorLabel(anchor)
                          : fallbackAnchor
                            ? `${anchorLabel(fallbackAnchor)}（出身默认）`
                            : "超级摩天楼 H10"}
                      </h3>
                      <span className={wb.note}>
                        点击夜之城地图锚点或在搜索框输入街区/地标名，即可指定入城第一站。
                      </span>
                    </div>
                    <StartMapPicker
                      value={startLoc}
                      defaultStart={fallbackLoc}
                      automatic={!board.startLocation}
                      onChange={setLoc}
                    />
                  </section>
                )}
              </div>
            )}
          </section>
        </div>

        {/* —————— 右侧常驻实时档案栏（NC LIVE DOSSIER，跨全部 4 步常驻） —————— */}
        <aside
          className={wb.dossierAside}
          data-open={sidebarOpen || undefined}
          aria-label="实时角色档案与入城发射台"
        >
          <span className={wb.hudGridBg} style={{ backgroundImage: gridUrl }} aria-hidden />
          <div className={wb.asideScroll}>
            <div className={wb.asideHead}>
              <span className={wb.asideCode}>{"NC // LIVE DOSSIER"}</span>
              <span className={wb.asideStatus} data-ready={checks.length === 0 ? "" : undefined}>
                {checks.length === 0 ? "✓ READY" : `待完善 ${checks.length} 项`}
              </span>
            </div>

            {/* 顶部视觉焦点：3:4 切角立绘展示窗 + 右侧身份铭牌、人性条与操作 */}
            <div className={wb.dossierHero}>
              <div className={wb.dossierPortraitFrame}>
                {card.portrait ? (
                  <button
                    type="button"
                    className={wb.portraitBtn}
                    onClick={() => setLightboxOpen(true)}
                  >
                    <GeneratedImage
                      imageId={card.portrait}
                      alt={card.name.trim() || "角色立绘"}
                      className={wb.portraitImg}
                    />
                  </button>
                ) : (
                  <button
                    type="button"
                    className={wb.dossierPortraitEmpty}
                    onClick={() => setPortraitModalOpen(true)}
                  >
                    <span className={wb.portraitCornerTL} aria-hidden />
                    <span className={wb.portraitCornerBR} aria-hidden />
                    <span className={wb.portraitEmptyCode}>3:4</span>
                    <span className={wb.portraitEmptyHint}>AI 生成立绘</span>
                  </button>
                )}
                {activeTarot && (
                  <span
                    className={wb.dossierTarotBadge}
                    title={`${activeTarot.roman} ${activeTarot.label} · ${activeTarot.vibe}`}
                  >
                    {activeTarot.roman}
                  </span>
                )}
              </div>

              <div className={wb.dossierHeroMeta}>
                <div className={wb.asideIdentity}>
                  <strong className={wb.asideName}>
                    {card.name.trim() || "未命名雇佣兵"}
                    {card.alias.trim() && <small>「{card.alias.trim()}」</small>}
                  </strong>
                  <span className={wb.asideSub}>
                    {board.origin?.label || "待选出身"} · {card.pronoun.trim() || "未填代词"}
                    {activeTarot ? ` · ${activeTarot.label}` : ""}
                  </span>
                </div>

                <div className={wb.asideMeter}>
                  <div className={wb.asideMeterHead}>
                    <span>义体负荷</span>
                    <b data-tone={loadInfo.tone}>{loadInfo.label}</b>
                  </div>
                  <p className={wb.humanityNote} data-tone={loadInfo.tone}>
                    {loadInfo.summary}
                  </p>
                </div>

                <div className={wb.portraitActions}>
                  <Button small primary onClick={() => setPortraitModalOpen(true)}>
                    {card.portrait ? "✦ AI 重绘" : "✦ AI 生成立绘"}
                  </Button>
                  {card.portrait && (
                    <ActionButton onClick={() => setLightboxOpen(true)}>大图</ActionButton>
                  )}
                  {card.portrait && <ActionButton onClick={clearPortrait}>清除</ActionButton>}
                </div>
              </div>
            </div>

            {/* 外貌反推（上传参考图自动设为立绘并反推物理外貌描述） */}
            <DossierAppearancePanel
              portrait={card.portrait}
              look={card.look}
              pronoun={card.pronoun}
              busy={busy}
              onPortraitChange={(imageId) => change({ portrait: imageId })}
              onLookChange={(look) => change({ look })}
            />

            {/* 启动资金（右侧栏常驻直调）+ 核心遥测快览 */}
            <section className={wb.asideCashCard} aria-label="启动资金调节">
              <div className={wb.asideCashHead}>
                <div className={wb.asideCashValWrap}>
                  <span className={wb.teleKey}>启动资金</span>
                  <strong className={wb.teleValAccent}>
                    {loadoutSummary.finalEddies.toLocaleString("en-US")} €
                  </strong>
                </div>
                <div className={wb.asideCashInputWrap}>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={CUSTOM_EDDIES_MAX}
                    step={1000}
                    className={wb.asideCashInput}
                    value={board.kit.customEddies ?? ""}
                    placeholder="自填金额"
                    aria-label="自定义开局启动资金（欧元）"
                    onChange={(e) => {
                      const raw = e.target.value.trim();
                      if (raw === "") {
                        commit({ ...board, kit: { ...board.kit, customEddies: null } });
                        return;
                      }
                      const parsed = Math.floor(Number(raw));
                      if (!Number.isFinite(parsed)) return;
                      commit({
                        ...board,
                        kit: {
                          ...board.kit,
                          customEddies: Math.max(0, Math.min(CUSTOM_EDDIES_MAX, parsed)),
                        },
                      });
                    }}
                  />
                  {board.kit.customEddies !== null && (
                    <button
                      type="button"
                      className={wb.asideCashReset}
                      onClick={() =>
                        commit({ ...board, kit: { ...board.kit, customEddies: null } })
                      }
                    >
                      档位
                    </button>
                  )}
                </div>
              </div>
              <fieldset className={wb.asideCashTiers} aria-label="启动资金档位">
                {CASH_TIERS.map((tier) => {
                  const active = board.kit.customEddies === null && board.kit.cashTier === tier;
                  return (
                    <button
                      key={tier}
                      type="button"
                      className={wb.asideCashTierBtn}
                      aria-pressed={active}
                      title={`${CASH_TIER_INFO[tier].label}：${CASH_TIER_INFO[tier].desc}`}
                      onClick={() =>
                        commit({
                          ...board,
                          kit: { ...board.kit, cashTier: tier, customEddies: null },
                        })
                      }
                    >
                      {CASH_TIER_INFO[tier].label}
                    </button>
                  );
                })}
              </fieldset>
            </section>

            <div className={wb.dossierTelemetry}>
              <div className={wb.teleCell}>
                <span className={wb.teleKey}>装配义体</span>
                <strong className={wb.teleVal}>{mountedChromeNames.length} 件</strong>
                <span className={wb.teleSub}>{loadInfo.label}</span>
              </div>
              <div className={wb.teleCell}>
                <span className={wb.teleKey}>履历特质</span>
                <strong className={wb.teleVal}>
                  {board.pasts.length + board.skills.length + board.flaws.length} 项
                </strong>
                <span className={wb.teleSub}>
                  {board.flaws.length > 0 ? `含缺陷 ${board.flaws.length} 项` : "无负面缺陷"}
                </span>
              </div>
              <div className={wb.teleCell}>
                <span className={wb.teleKey}>入城起点</span>
                <strong className={wb.teleVal}>
                  {anchor?.name ?? fallbackAnchor?.name ?? "沃森 H10"}
                </strong>
                <span className={wb.teleSub}>
                  {board.acquaintances.length > 0
                    ? `旧识 ${board.acquaintances.length} 人`
                    : "孤狼"}
                </span>
              </div>
            </div>

            {/* 精简构筑总览 */}
            <dl className={wb.asideList}>
              <div>
                <dt>履历</dt>
                <dd>
                  {board.pasts.length > 0 ? board.pasts.map((m) => m.label).join(" / ") : "未选"}
                </dd>
              </div>
              <div>
                <dt>特质</dt>
                <dd>
                  {board.skills.length > 0 ? board.skills.map((m) => m.label).join(" / ") : "未选"}
                </dd>
              </div>
              {board.flaws.length > 0 && (
                <div>
                  <dt>缺陷</dt>
                  <dd>{board.flaws.map((m) => m.label).join(" / ")}</dd>
                </div>
              )}
              <div>
                <dt>行装</dt>
                <dd>
                  {[
                    weaponNames.length > 0 ? `武器：${weaponNames.join(" / ")}` : "出身标配武器",
                    itemSummary.length > 0 ? `物品：${itemSummary.join(" / ")}` : "",
                    effectiveVehicles.length > 0
                      ? `座驾：${effectiveVehicles.join(" / ")}`
                      : "步行",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </dd>
              </div>
              {board.acquaintances.length > 0 && (
                <div>
                  <dt>旧识</dt>
                  <dd>
                    {board.acquaintances
                      .slice(0, 3)
                      .map((a) => `${a.name}（${RELATION_INFO[a.relation].label}）`)
                      .join("、") + (board.acquaintances.length > 3 ? "…" : "")}
                  </dd>
                </div>
              )}
            </dl>

            {/* 档案就绪核验清单 */}
            {checks.length > 0 && (
              <section className={wb.asideChecks} aria-label="待完善项">
                <span className={wb.asideCheckTitle}>需完善后方可保存与入城</span>
                <ul>
                  {checks.map((c) => (
                    <li key={`${c.target}:${c.text}`}>
                      <button
                        type="button"
                        className={wb.checkJump}
                        onClick={() => jumpToCheck(c.target)}
                      >
                        ⚠ {c.text} →
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>

          {/* 固定底部唯一保存与入城发射台（永不滚出视野） */}
          <section className={wb.launchDock} aria-label="保存与接入夜之城">
            <label className={wb.field}>
              <span>
                存档名 <small>留空默认「{card.name.trim() || "角色"}的夜之城传奇」</small>
              </span>
              <FrameBox className={wb.compactBox}>
                <input
                  value={saveTitle}
                  maxLength={80}
                  placeholder={`${card.name.trim() || "V"}的夜之城传奇`}
                  onChange={(e) => setSaveTitle(e.target.value)}
                />
              </FrameBox>
            </label>

            {displaySaveError && (
              <p className={wb.error} role="alert">
                {displaySaveError}
              </p>
            )}
            {launchMutation.isError && (
              <p className={wb.error} role="alert">
                {launchMutation.error.message}
              </p>
            )}

            <div className={wb.launchActionsRow}>
              <Button
                primary
                disabled={!canLaunch}
                reason={
                  !data
                    ? "目录尚未加载完成"
                    : checks.length > 0
                      ? checks[0]?.text
                      : !canSave
                        ? "请先补齐角色必填项"
                        : undefined
                }
                onClick={() => {
                  onLaunchingChange(true);
                  launchMutation.mutate();
                }}
              >
                {launchMutation.isPending
                  ? "正在接入夜之城…"
                  : isSample && !dirty
                    ? "✦ 直接接入夜之城"
                    : "✦ 保存并接入夜之城"}
              </Button>
            </div>

            <div className={wb.launchSubActions}>
              <Button
                small
                disabled={!canSave || busy || (!dirty && !isSample && saved)}
                reason={!canSave ? (checks[0]?.text ?? "请先补齐必填项") : undefined}
                onClick={() => void handleSave()}
              >
                {isSample ? "另存为我的角色" : saved ? "已入库" : "仅保存角色"}
              </Button>
              {canDelete && (
                <ActionButton disabled={busy} onClick={onDelete}>
                  删除角色
                </ActionButton>
              )}
            </div>
          </section>
        </aside>
      </div>

      {/* —————— 底部纯净步骤导航条 —————— */}
      <footer className={wb.footerBar}>
        <div className={wb.footerLeft}>
          <span className={wb.footerMeta}>
            第 {currentStepIndex + 1} / {CREATOR_STEPS.length} 步 · {currentStep?.label}
          </span>
          {dirty && (
            <span className={wb.footerHint}>
              {draftSaved ? "本地草稿已自动暂存" : "本地草稿暂存失败，请及时保存"}
            </span>
          )}
          {!dirty && saved && <span className={wb.footerSaved}>✓ 角色档案已保存至本地角色库</span>}
        </div>
        <div className={wb.footerRight}>
          {currentStepIndex > 0 && (
            <Button
              small
              disabled={busy}
              onClick={() => {
                const prev = CREATOR_STEPS[currentStepIndex - 1];
                if (prev) goToStep(prev.id);
              }}
            >
              ◂ 上一步：{CREATOR_STEPS[currentStepIndex - 1]?.label}
            </Button>
          )}
          {currentStepIndex < CREATOR_STEPS.length - 1 ? (
            <Button
              small
              primary
              disabled={busy}
              onClick={() => {
                const next = CREATOR_STEPS[currentStepIndex + 1];
                if (next) goToStep(next.id);
              }}
            >
              下一步：{CREATOR_STEPS[currentStepIndex + 1]?.label} ▸
            </Button>
          ) : (
            <span className={wb.footerReadyHint}>
              {checks.length === 0
                ? "✓ 全部配置完成，可随时在右侧档案栏接入夜之城"
                : `⚠ 仍有 ${checks.length} 项必填未完成`}
            </span>
          )}
        </div>
      </footer>

      <ImageGenModal
        open={portraitModalOpen}
        title="生成角色立绘"
        subtitle={
          card.name.trim()
            ? `${card.name.trim()}${board.origin?.label ? ` · ${board.origin.label}` : ""}`
            : "夜之城角色立绘"
        }
        promptRequest={characterPromptRequest}
        defaultAspectRatio="3:4"
        draftKey={`character-portrait:${characterId ?? "draft"}`}
        onClose={() => setPortraitModalOpen(false)}
        onApplied={(image) => change({ portrait: image.id })}
      />

      {lightboxOpen && card.portrait && (
        <ImageLightbox
          imageId={card.portrait}
          title={card.name.trim() || "角色立绘"}
          onReplace={() => setPortraitModalOpen(true)}
          replaceLabel="重绘 / 更换立绘"
          onClose={() => setLightboxOpen(false)}
        />
      )}
    </div>
  );
}
