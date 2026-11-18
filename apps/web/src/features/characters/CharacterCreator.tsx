import {
  type Board,
  CASH_TIER_INFO,
  type CharacterCard,
  cyberwareRules,
  FLAW_MAX,
  humanityRules,
  PAST_MAX,
  PROSE_BLOCK_INFO,
  PROSE_BLOCKS,
  type ProseBlock,
  RELATION_INFO,
  SKILL_MAX,
  TOLERANCE_LEVELS,
} from "@cp/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useRef, useState } from "react";
import { api, type BoardData } from "../../api/client";
import { ActionButton } from "../../ui/ActionButton";
import { cssUrl, NineSlice } from "../../ui/Asset";
import { Button } from "../../ui/Button";
import { CellFrame, FrameBox } from "../../ui/FrameBox";
import { CYBER_LABELS, CyberDoll, type CyberSlot, type DollPart } from "../story/CyberDoll";
import { PeoplePicker } from "./CreatorLife";
import {
  CyberwareShelf,
  FlawPicker,
  LoadoutPicker,
  OriginPicker,
  type PickerProps,
  TraitPicker,
} from "./CreatorSteps";
import styles from "./characters.module.css";
import {
  type CheckTarget,
  CREATOR_STEPS,
  type CreatorStepId,
  clearDraft,
  creatorChecks,
  defaultStartLocationFor,
  emptyBoard,
  humanityStageInfo,
  inherentCyberware,
  loadLocalCustomModules,
  mergeCreatorCatalog,
  ORIGIN_ECOSYSTEM_LABELS,
  originDefaultLoadout,
  originEcosystem,
  stepForCheckTarget,
  stepProgress,
  totalStartHumanityCost,
} from "./creator";
import { DraftAll } from "./DraftAll";
import { ProseField } from "./ProseField";
import { anchorLabel, StartMapPicker, startAnchor } from "./StartMapPicker";
import { downloadCard } from "./tavernFile";
import wb from "./workbench.module.css";

const { TOLERANCE_FACTOR } = humanityRules;
type Tolerance = Board["tolerance"];
const TOLERANCES: readonly Tolerance[] = ["low", "normal", "high"];
const PRONOUN_PRESETS: readonly string[] = ["他", "她", "TA"];

const CORE_PROSE_BLOCKS: readonly ProseBlock[] = ["look", "past", "personality", "voice"];
const EXTRA_PROSE_BLOCKS: readonly ProseBlock[] = ["scene", "greeting", "examples"];

const CYBER_SLOT_LIST: readonly CyberSlot[] = [
  "frontalCortex",
  "eyes",
  "nervous",
  "os",
  "circulatory",
  "integumentary",
  "skeleton",
  "hands",
  "arms",
  "legs",
];

type TraitsTab = "build" | "flaw";
type ChromeKitTab = "chrome" | "kit";

function DossierBlock({
  title,
  onEdit,
  children,
}: {
  readonly title: string;
  readonly onEdit: () => void;
  readonly children: ReactNode;
}) {
  return (
    <section className={wb.dossierBlock}>
      <CellFrame />
      <header className={wb.dossierHead}>
        <h3 className={wb.dossierHeading}>{title}</h3>
        <ActionButton onClick={onEdit}>修改 ▸</ActionButton>
      </header>
      {children}
    </section>
  );
}

function ChipList({
  items,
  empty,
  warn = false,
}: {
  readonly items: readonly { readonly k: string; readonly t: string; readonly tip?: string }[];
  readonly empty: string;
  readonly warn?: boolean;
}) {
  if (items.length === 0) return <p className={wb.dossierDim}>{empty}</p>;
  return (
    <ul className={wb.dossierChips}>
      {items.map((i) => (
        <li key={i.k} className={wb.dossierChip} data-warn={warn || undefined} title={i.tip}>
          {i.t}
        </li>
      ))}
    </ul>
  );
}

/**
 * 2077 赛博角色创建工作台（单页五步引导工作台）：
 * - 顶部五步导航栏（identity / traits / chrome_kit / people_prose / review）
 * - 主编辑舞台（所有选择器直接内嵌在当前步骤，无全屏弹窗）
 * - 右侧常驻实时档案摘要栏（< 1180px 自动收拢为顶部摘要条 + 可切换抽屉）
 * - 底部常驻操作条（保存/导出/删除 · 上一步/下一步/战局接入）
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
  const [traitsTab, setTraitsTab] = useState<TraitsTab>("build");
  const [chromeKitTab, setChromeKitTab] = useState<ChromeKitTab>("chrome");
  const [activeSlot, setActiveSlot] = useState<CyberSlot>("os");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [saveTitle, setSaveTitle] = useState("");
  const [localSaveError, setLocalSaveError] = useState<string | null>(null);
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const stageRef = useRef<HTMLElement | null>(null);
  const queryClient = useQueryClient();

  const localModules = loadLocalCustomModules();
  const data = boardData ? mergeCreatorCatalog(boardData, localModules) : undefined;
  const fallbackLoc = defaultStartLocationFor(card, data);
  const startLoc = board.startLocation || fallbackLoc;

  const commit = (next: Board, origin?: string) => {
    setLocalSaveError(null);
    onChange({
      ...card,
      ...(origin !== undefined ? { origin } : {}),
      board: next,
    });
  };

  const change = (patch: Partial<CharacterCard>) => {
    setLocalSaveError(null);
    onChange((current) => ({ ...current, ...patch }));
  };

  const setLoc = (loc: string) => {
    setLocalSaveError(null);
    const { startLocation: _, ...rest } = board;
    onChange({ ...card, board: { ...rest, ...(loc ? { startLocation: loc } : {}) } });
  };

  const launchMutation = useMutation({
    mutationFn: async () => {
      const targetCard: CharacterCard = {
        ...card,
        board,
      };
      const savedEntry =
        isSample && !dirty && characterId ? { id: characterId } : await onSave(targetCard);
      const save = await api.createSave({
        characterId: savedEntry.id,
        title: saveTitle.trim() || `${card.name.trim()}的夜之城传奇`,
        ...(startLoc ? { startLocation: startLoc } : {}),
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

  const goToStep = (step: CreatorStepId, subTab?: ChromeKitTab) => {
    setActiveStep(step);
    if (subTab) setChromeKitTab(subTab);
    setSidebarOpen(false);
    stageRef.current?.scrollTo({ top: 0, behavior: "auto" });
  };

  const jumpToCheck = (target: CheckTarget) => {
    const step = stepForCheckTarget(target);
    if (target === "cyber") {
      goToStep(step, "chrome");
      return;
    }
    if (target === "kit") {
      goToStep(step, "kit");
      return;
    }
    goToStep(step);
    if (target === "identity") {
      requestAnimationFrame(() => nameInputRef.current?.focus());
    }
  };

  // ———— 义体、耐受与人性计算 ————
  const inherent = inherentCyberware(card, data);
  const activeInherentCount = inherent.filter((i) => !i.replaced).length;
  const humanityCost = totalStartHumanityCost(card, data);
  const humanityNow = Math.max(0, 100 - humanityCost);
  const stageInfo = humanityStageInfo(humanityNow);
  const slotOf = new Map(data?.cyberware.map((o) => [o.id, o.slot]) ?? []);
  const rarityOf = new Map(data?.cyberware.map((o) => [o.id, o.rarity]) ?? []);

  const dollParts = new Map<CyberSlot, DollPart[]>();
  for (const c of board.cyberware) {
    const slot = (slotOf.get(c.id) ?? c.slot) as CyberSlot | undefined;
    if (!slot) continue;
    const list = dollParts.get(slot) ?? [];
    list.push({ id: c.id, name: c.name, rarity: rarityOf.get(c.id) });
    dollParts.set(slot, list);
  }
  for (const i of inherent) {
    if (i.replaced) continue;
    const slot = i.slot as CyberSlot;
    const list = dollParts.get(slot) ?? [];
    list.push({ id: i.id, name: `${i.name}（标配）`, rarity: rarityOf.get(i.id) });
    dollParts.set(slot, list);
  }

  // 点击人体拓扑槽位仅聚焦切换对应部位，绝不在二次点击时误触卸载义体
  const handleDollCell = (slot: CyberSlot) => {
    setActiveSlot(slot);
  };

  // ———— 摘要数据 ————
  const anchor = startAnchor(startLoc);
  const fallbackAnchor = startAnchor(fallbackLoc);
  const loadoutSummary = originDefaultLoadout(card, data);
  const weaponNames = board.kit.weapons.map(
    (id) => data?.weapons?.find((w) => w.id === id)?.name ?? id,
  );
  const customVehicleName = board.kit.vehicle
    ? (data?.vehicles?.find((v) => v.id === board.kit.vehicle)?.name ?? board.kit.vehicle)
    : null;
  const allVehicles = [
    ...loadoutSummary.freeVehicleNames,
    ...(customVehicleName ? [customVehicleName] : []),
  ];
  const mountedChromeNames = [
    ...inherent.filter((i) => !i.replaced).map((i) => i.name),
    ...board.cyberware.map((c) => c.name),
  ];
  const selectedTraitNames = [
    ...board.pasts.map((m) => m.label),
    ...board.skills.map((m) => m.label),
  ];
  const filledProseCount = PROSE_BLOCKS.filter((b) => card[b].trim() !== "").length;

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
  const currentStep = CREATOR_STEPS.find((s) => s.id === activeStep) ?? {
    id: "identity" as const,
    index: 1,
    code: "01",
    label: "身份与出身",
    title: "身份铭牌与出身背景",
    lead: "确立夜之城档案的基本称谓，并挑选或自创出身背景，决定初始家底、自带义体与默认落脚点。",
  };
  const tabLineMask = cssUrl("tab.line");
  const displaySaveError = saveError ?? localSaveError;
  const isReview = activeStep === "review";

  return (
    <div className={wb.bench}>
      {/* —————— 顶部五步导航栏 —————— */}
      <div className={wb.railBar} inert={busy}>
        <nav className={wb.stepRail} aria-label="创角流程步骤">
          <CellFrame />
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
              </button>
            );
          })}
        </nav>

        {!isReview && (
          <div className={wb.mobileSummaryToggle}>
            <span className={wb.note}>
              {card.name.trim() || "未命名角色"} · 人性 {humanityNow}/100 ·{" "}
              {checks.length === 0 ? "✓ 已就绪" : `待完善 ${checks.length} 项`}
            </span>
            <Button small pressed={sidebarOpen} onClick={() => setSidebarOpen((open) => !open)}>
              {sidebarOpen ? "收起摘要" : "实时档案"}
            </Button>
          </div>
        )}
      </div>

      {/* —————— 中央双栏：当前步骤主舞台 + 右侧常驻实时档案栏（Step 05 全宽单栏） —————— */}
      <div className={wb.mainSplit} data-review={isReview || undefined} inert={busy}>
        <div className={wb.stageShell}>
          <NineSlice
            id="notify.itemCellBg"
            tint="rgb(8 8 14 / 82%)"
            slice={30}
            className={wb.panelLayer}
          />
          <NineSlice
            id="notify.itemCellFg"
            tint="var(--cp-cyan-dim)"
            slice={30}
            className={wb.panelLayer}
          />
          <section
            ref={stageRef}
            className={wb.stage}
            data-split={activeStep === "chrome_kit" && chromeKitTab === "kit" ? "kit" : undefined}
            aria-label={`第 ${currentStep.index} 步：${currentStep.title}`}
          >
            <header className={wb.stageHeader}>
              <div className={wb.stageTitleRow}>
                <h2 className={wb.stageTitle} title={currentStep.lead}>
                  {currentStep.title}
                </h2>
                <div className={wb.stageHeaderRight}>
                  {activeStep === "traits" && (
                    <div className={wb.subTabBar} role="tablist" aria-label="特质与缺陷子页签">
                      <Button
                        small
                        primary={traitsTab === "build"}
                        pressed={traitsTab === "build"}
                        onClick={() => setTraitsTab("build")}
                      >
                        过往与特质 ({board.pasts.length + board.skills.length})
                      </Button>
                      <Button
                        small
                        primary={traitsTab === "flaw"}
                        pressed={traitsTab === "flaw"}
                        onClick={() => setTraitsTab("flaw")}
                      >
                        负面缺陷 ({board.flaws.length}/{FLAW_MAX})
                      </Button>
                    </div>
                  )}
                  {activeStep === "chrome_kit" && (
                    <div className={wb.subTabBar} role="tablist" aria-label="义体与开局态势子页签">
                      <Button
                        small
                        primary={chromeKitTab === "chrome"}
                        pressed={chromeKitTab === "chrome"}
                        onClick={() => setChromeKitTab("chrome")}
                      >
                        义体拓扑与货架 ({board.cyberware.length + activeInherentCount})
                      </Button>
                      <Button
                        small
                        primary={chromeKitTab === "kit"}
                        pressed={chromeKitTab === "kit"}
                        onClick={() => setChromeKitTab("kit")}
                      >
                        行装、座驾与落脚点 ({loadoutSummary.finalEddies} €)
                      </Button>
                    </div>
                  )}
                  <span className={wb.stageEyebrow}>
                    {currentStep.code} / 0{CREATOR_STEPS.length}
                  </span>
                </div>
              </div>
              <span
                className={wb.hairline}
                style={{ maskImage: tabLineMask, WebkitMaskImage: tabLineMask }}
                aria-hidden="true"
              />
            </header>

            <div className={wb.stageBody}>
              {activeStep === "identity" && (
                <>
                  <div className={wb.identityTop}>
                    <section className={wb.sectionBox} aria-label="角色身份铭牌">
                      <CellFrame />
                      <header className={wb.sectionBoxHead}>
                        <h3 className={wb.sectionBoxTitle}>身份铭牌 · NC CITIZEN ID</h3>
                        {isSample && <span className={wb.sampleBadge}>官方预设</span>}
                      </header>
                      <div className={wb.idStack}>
                        <label className={wb.fieldLabel}>
                          <span>角色姓名 *</span>
                          <FrameBox className={wb.compactBox}>
                            <input
                              ref={nameInputRef}
                              maxLength={20}
                              value={card.name}
                              placeholder="例如：V、露西、大卫"
                              onChange={(e) => change({ name: e.target.value })}
                            />
                          </FrameBox>
                        </label>
                        <div className={wb.idSplit}>
                          <label className={wb.fieldLabel}>
                            <span>街头外号（可选）</span>
                            <FrameBox className={wb.compactBox}>
                              <input
                                maxLength={20}
                                value={card.alias}
                                placeholder="夜之城通行代号"
                                onChange={(e) => change({ alias: e.target.value })}
                              />
                            </FrameBox>
                          </label>
                          <label className={wb.fieldLabel}>
                            <span>人称代词 *</span>
                            <FrameBox className={wb.compactBox}>
                              <input
                                maxLength={4}
                                value={card.pronoun}
                                placeholder="他 / 她 / TA"
                                onChange={(e) => change({ pronoun: e.target.value })}
                              />
                            </FrameBox>
                          </label>
                        </div>
                        <fieldset className={wb.pronounRow} aria-label="快捷代词">
                          <span className={wb.sectionBoxSub}>快捷代词</span>
                          <div className={wb.pronounPills}>
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
                          </div>
                        </fieldset>
                      </div>
                    </section>

                    <section className={wb.sectionBox} aria-label="出身默认开局资助">
                      <CellFrame />
                      <header className={wb.sectionBoxHead}>
                        <h3 className={wb.sectionBoxTitle}>出身默认开局资助</h3>
                        <span className={wb.sectionBoxSub}>
                          {board.origin
                            ? ORIGIN_ECOSYSTEM_LABELS[originEcosystem(board.origin)]
                            : "尚未选定出身"}
                        </span>
                      </header>
                      <p className={wb.originSummaryTitle}>
                        {board.origin?.label ?? "请在下方挑选或自创出身背景"}
                      </p>
                      <p className={wb.note}>
                        {board.origin?.ability ||
                          board.origin?.hook ||
                          "出身将决定你的起始欧元、基础装备、自带义体与默认落脚点。"}
                      </p>
                      <div className={wb.loadoutFacts}>
                        <p className={wb.factLine}>
                          <span className={wb.factKey}>起始资金：</span>
                          <span>
                            基准 {loadoutSummary.baseEddies} €（当前档位进场{" "}
                            <b>{loadoutSummary.finalEddies} €</b>）
                          </span>
                        </p>
                        <p className={wb.factLine}>
                          <span className={wb.factKey}>基础装备：</span>
                          <span>
                            {loadoutSummary.gearNames.length > 0
                              ? loadoutSummary.gearNames.join("、")
                              : "无额外默认装备"}
                          </span>
                        </p>
                        <p className={wb.factLine}>
                          <span className={wb.factKey}>自带义体：</span>
                          <span>
                            {inherent.length > 0
                              ? inherent
                                  .map((i) => `${i.name}${i.replaced ? "（已被替换）" : ""}`)
                                  .join("、")
                              : "无标配义体"}
                          </span>
                        </p>
                        <p className={wb.factLine}>
                          <span className={wb.factKey}>默认落脚点：</span>
                          <span>{fallbackAnchor ? anchorLabel(fallbackAnchor) : fallbackLoc}</span>
                        </p>
                      </div>
                    </section>
                  </div>

                  <section className={wb.sectionBox} aria-label="挑选出身背景">
                    <CellFrame />
                    <header className={wb.sectionBoxHead}>
                      <h3 className={wb.sectionBoxTitle}>选择或自创出身背景</h3>
                      <span className={wb.sectionBoxSub}>点击卡片即选中，可按生态检索</span>
                    </header>
                    {pickerProps ? (
                      <OriginPicker {...pickerProps} />
                    ) : (
                      <p className={wb.note}>正在加载夜之城出身目录…</p>
                    )}
                  </section>
                </>
              )}

              {activeStep === "traits" &&
                (traitsTab === "build" ? (
                  <section className={wb.sectionBox} aria-label="过往经历与核心特质目录">
                    <CellFrame />
                    <header className={wb.sectionBoxHead}>
                      <h3 className={wb.sectionBoxTitle}>过往经历与核心特质</h3>
                      <span className={wb.sectionBoxSub}>支持按分类筛选、搜索或自创</span>
                    </header>
                    {data ? (
                      <TraitPicker board={board} data={data} commit={commit} />
                    ) : (
                      <p className={wb.note}>正在加载特质目录…</p>
                    )}
                  </section>
                ) : (
                  <section className={wb.sectionBox} aria-label="负面缺陷目录">
                    <CellFrame />
                    <header className={wb.sectionBoxHead}>
                      <h3 className={wb.sectionBoxTitle}>负面缺陷</h3>
                      <span className={wb.sectionBoxSub}>可选挂载：引入债主、宿敌或自定义冲突</span>
                    </header>
                    {data ? (
                      <FlawPicker board={board} data={data} commit={commit} />
                    ) : (
                      <p className={wb.note}>正在加载缺陷目录…</p>
                    )}
                  </section>
                ))}

              {activeStep === "chrome_kit" &&
                (chromeKitTab === "chrome" ? (
                  <div className={wb.chromeLayout}>
                    <div className={wb.chromeLeft}>
                      <div className={wb.dollFrame}>
                        <CyberDoll
                          parts={dollParts}
                          selected={activeSlot}
                          onCell={handleDollCell}
                          humanity={{
                            current: humanityNow,
                            cap: 100,
                            stageLabel: stageInfo.label,
                          }}
                        />
                      </div>

                      <section
                        className={wb.humanityConsole}
                        data-tone={stageInfo.tone}
                        aria-label="生理耐受与标配义体"
                      >
                        <CellFrame />
                        <fieldset className={wb.tolBar} aria-label="义体生理耐受档位">
                          {TOLERANCES.map((t) => {
                            const level = TOLERANCE_LEVELS[t];
                            const active = board.tolerance === t;
                            return (
                              <Button
                                key={t}
                                small
                                primary={active}
                                pressed={active}
                                onClick={() => commit({ ...board, tolerance: t })}
                              >
                                {level.label} ×{TOLERANCE_FACTOR[t]}
                              </Button>
                            );
                          })}
                        </fieldset>
                        <p className={wb.humanityNote}>
                          {stageInfo.note}
                          {TOLERANCE_LEVELS[board.tolerance].hook
                            ? ` · ${TOLERANCE_LEVELS[board.tolerance].hook}`
                            : ""}
                        </p>

                        {inherent.length > 0 && (
                          <div className={wb.inherentBox}>
                            <span className={wb.inherentTitle}>
                              出身 / 黑客标配免费义体（{inherent.length} 项）
                            </span>
                            <ul className={wb.inherentList}>
                              {inherent.map((item) => (
                                <li
                                  key={item.id}
                                  className={wb.inherentItem}
                                  data-replaced={item.replaced || undefined}
                                >
                                  <span>
                                    {item.name} · {item.source}（−{item.humanityCost} 人性）
                                  </span>
                                  <span className={wb.inherentStatus}>
                                    {item.replaced ? "已被同部位自选义体替换" : "免费标配 · 已装配"}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </section>
                    </div>

                    <section className={wb.sectionBox} aria-label="部位切换与义体货架">
                      <CellFrame />
                      <header className={wb.sectionBoxHead}>
                        <h3 className={wb.sectionBoxTitle}>义体部位与货架</h3>
                      </header>
                      <fieldset className={wb.slotRibbon} aria-label="十部位切换条">
                        {CYBER_SLOT_LIST.map((s) => {
                          const count = (dollParts.get(s) ?? []).length;
                          const cap = cyberwareRules.SLOT_CAPACITY[s];
                          return (
                            <Button
                              key={s}
                              small
                              pressed={activeSlot === s}
                              onClick={() => setActiveSlot(s)}
                            >
                              {CYBER_LABELS[s]} {count}/{cap}
                            </Button>
                          );
                        })}
                      </fieldset>
                      {pickerProps ? (
                        <CyberwareShelf {...pickerProps} slot={activeSlot} />
                      ) : (
                        <p className={wb.note}>正在加载义体货架…</p>
                      )}
                    </section>
                  </div>
                ) : (
                  <div className={wb.kitLayout}>
                    <section
                      className={`${wb.sectionBox} ${wb.kitLeftPane}`}
                      aria-label="开局行装与座驾"
                    >
                      <CellFrame />
                      <header className={wb.sectionBoxHead}>
                        <h3 className={wb.sectionBoxTitle}>启动资金、随身武器与载具</h3>
                        <span className={wb.sectionBoxSub}>最多 2 把额外武器 · 1 台专属载具</span>
                      </header>
                      <div className={wb.kitLeftScroll}>
                        {pickerProps ? (
                          <LoadoutPicker {...pickerProps} />
                        ) : (
                          <p className={wb.note}>正在加载开局行装目录…</p>
                        )}
                      </div>
                    </section>

                    <section
                      className={`${wb.sectionBox} ${wb.kitRightPane}`}
                      aria-label="开局出生落脚点"
                    >
                      <CellFrame />
                      <header className={wb.sectionBoxHead}>
                        <h3 className={wb.sectionBoxTitle}>夜之城出生落脚点</h3>
                        <span className={wb.sectionBoxSub}>
                          {anchor ? anchorLabel(anchor) : startLoc || "跟随出身"}
                        </span>
                      </header>
                      <StartMapPicker
                        value={startLoc}
                        defaultStart={fallbackLoc}
                        automatic={!board.startLocation}
                        onChange={setLoc}
                      />
                    </section>
                  </div>
                ))}

              {activeStep === "people_prose" && (
                <>
                  <section className={wb.sectionBox} aria-label="夜之城人脉网络">
                    <CellFrame />
                    <header className={wb.sectionBoxHead}>
                      <h3 className={wb.sectionBoxTitle}>夜之城人脉网络</h3>
                      <span className={wb.sectionBoxSub}>
                        已建立 {board.acquaintances.length} 位旧识交集
                      </span>
                    </header>
                    {data ? (
                      <PeoplePicker board={board} data={data} commit={commit} />
                    ) : (
                      <p className={wb.note}>正在加载夜之城人物档案…</p>
                    )}
                  </section>

                  <section className={wb.sectionBox} aria-label="AI 撰稿工坊与核心人设小传">
                    <CellFrame />
                    <header className={wb.sectionBoxHead}>
                      <h3 className={wb.sectionBoxTitle}>AI 撰稿工坊与核心人设小传</h3>
                      <span className={wb.sectionBoxSub}>
                        以下 4 项正剧区块将注入开局 AI 叙事上下文
                      </span>
                    </header>
                    <DraftAll card={card} onChange={change} />
                    <div className={wb.proseList}>
                      {CORE_PROSE_BLOCKS.map((b) => (
                        <ProseField key={b} block={b} card={card} onChange={change} />
                      ))}
                    </div>
                  </section>

                  <section className={wb.sectionBox} aria-label="角色卡与酒馆导出字段">
                    <CellFrame />
                    <details className={styles.exportFold}>
                      <summary className={styles.exportFoldSummary}>
                        <span>角色卡演出与酒馆导出字段（可选）</span>
                        <span className={wb.cardOnlyBadge}>
                          仅随角色卡/酒馆导出，不占正剧上下文
                        </span>
                      </summary>
                      <div className={styles.exportFoldBody}>
                        <p className={wb.note}>
                          开场场景、开场白与对话示例仅在导出为 SillyTavern /
                          角色卡分享时使用，正剧开启后不会强行塞入开局叙事。
                        </p>
                        <div className={wb.proseList}>
                          {EXTRA_PROSE_BLOCKS.map((b) => (
                            <ProseField key={b} block={b} card={card} onChange={change} />
                          ))}
                        </div>
                      </div>
                    </details>
                  </section>
                </>
              )}

              {activeStep === "review" && (
                <>
                  <div
                    className={wb.reviewBanner}
                    data-ready={checks.length === 0 ? "" : undefined}
                    role="status"
                  >
                    <CellFrame />
                    <p className={wb.reviewBannerText}>
                      {checks.length === 0
                        ? "✓ 档案所有必选项已就绪，可以直接保存并接入夜之城。"
                        : `尚有 ${checks.length} 项待完善，点击右侧任意条目可直达对应步骤修改：`}
                    </p>
                    {checks.length > 0 && (
                      <ul className={wb.checksList}>
                        {checks.map((c) => (
                          <li key={c.text}>
                            <ActionButton onClick={() => jumpToCheck(c.target)}>
                              ⚠ {c.text} ▸
                            </ActionButton>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div className={wb.reviewColumns}>
                    <div className={wb.reviewLeft}>
                      <DossierBlock
                        title="义体拓扑只读快照与术后人性"
                        onEdit={() => goToStep("chrome_kit", "chrome")}
                      >
                        <div className={wb.reviewDollFrame}>
                          <CyberDoll
                            parts={dollParts}
                            humanity={{
                              current: humanityNow,
                              cap: 100,
                              stageLabel: stageInfo.label,
                            }}
                          />
                        </div>
                        <strong className={wb.dossierBig} data-tone={stageInfo.tone}>
                          人性 {humanityNow}
                          <small>
                            {" "}
                            / 100 · {stageInfo.label} · {TOLERANCE_LEVELS[board.tolerance].label} ×
                            {TOLERANCE_FACTOR[board.tolerance]}
                          </small>
                        </strong>
                        <ChipList
                          empty="无义体改造"
                          items={[
                            ...inherent
                              .filter((i) => !i.replaced)
                              .map((i) => ({ k: i.id, t: `${i.name}（标配）` })),
                            ...board.cyberware.map((c) => ({ k: c.id, t: c.name })),
                          ]}
                        />
                      </DossierBlock>

                      <DossierBlock
                        title="行装、座驾与落脚点"
                        onEdit={() => goToStep("chrome_kit", "kit")}
                      >
                        <strong className={wb.dossierBig}>
                          {loadoutSummary.finalEddies} €
                          <small> · {CASH_TIER_INFO[board.kit.cashTier].label}</small>
                        </strong>
                        <p className={wb.dossierDim}>
                          落脚点：{anchor ? anchorLabel(anchor) : startLoc || "跟随出身"}
                        </p>
                        <ChipList
                          empty="无额外随身装备"
                          items={[...loadoutSummary.gearNames, ...weaponNames, ...allVehicles].map(
                            (t) => ({ k: t, t }),
                          )}
                        />
                      </DossierBlock>
                    </div>

                    <div className={wb.reviewRight}>
                      <DossierBlock title="身份铭牌与出身背景" onEdit={() => goToStep("identity")}>
                        <strong className={wb.dossierBig}>
                          {card.name.trim() || "未命名角色"}
                          {card.alias.trim() && <small> 「{card.alias.trim()}」</small>}
                        </strong>
                        <p className={wb.dossierDim}>
                          代词：{card.pronoun.trim() || "未设定"} · 出身：
                          {board.origin?.label ?? "尚未选择"}
                        </p>
                        <p className={wb.dossierText}>
                          {board.origin?.ability || "决定初始家底、自带义体与街头人脉"}
                        </p>
                        {board.origin?.hook && (
                          <p className={wb.dossierDim}>身世钩子：{board.origin.hook}</p>
                        )}
                      </DossierBlock>

                      <DossierBlock title="过往、特质与缺陷" onEdit={() => goToStep("traits")}>
                        <div className={wb.dossierTraitsGrid}>
                          <div className={wb.dossierTraitCol}>
                            <p className={wb.dossierLabel}>
                              核心特质 {board.skills.length}/{SKILL_MAX}
                            </p>
                            <ChipList
                              empty="未选"
                              items={board.skills.map((m) => ({
                                k: m.id,
                                t: m.label,
                                tip: m.ability,
                              }))}
                            />
                          </div>
                          <div className={wb.dossierTraitCol}>
                            <p className={wb.dossierLabel}>
                              过往经历 {board.pasts.length}/{PAST_MAX}
                            </p>
                            <ChipList
                              empty="未选"
                              items={board.pasts.map((m) => ({
                                k: m.id,
                                t: m.label,
                                tip: m.hook || m.ability,
                              }))}
                            />
                          </div>
                          <div className={wb.dossierTraitCol}>
                            <p className={wb.dossierLabel}>
                              负面缺陷 {board.flaws.length}/{FLAW_MAX}
                            </p>
                            <ChipList
                              warn
                              empty="无"
                              items={board.flaws.map((m) => ({
                                k: m.id,
                                t: m.label,
                                tip: m.hook || m.ability,
                              }))}
                            />
                          </div>
                        </div>
                      </DossierBlock>

                      <DossierBlock
                        title={`夜之城人脉 (${board.acquaintances.length})`}
                        onEdit={() => goToStep("people_prose")}
                      >
                        <ChipList
                          empty="暂无自选旧识"
                          items={board.acquaintances.map((a) => ({
                            k: a.id,
                            t: `${a.name} · ${RELATION_INFO[a.relation].label}`,
                            tip: a.note,
                          }))}
                        />
                      </DossierBlock>

                      <DossierBlock
                        title={`人设小传 (${filledProseCount}/7)`}
                        onEdit={() => goToStep("people_prose")}
                      >
                        {filledProseCount === 0 ? (
                          <p className={wb.dossierDim}>
                            尚未撰写小传，可回到第 4 步手写或使用 AI 一键成稿。
                          </p>
                        ) : (
                          <div className={wb.dossierProseList}>
                            {PROSE_BLOCKS.filter((b) => card[b].trim() !== "").map((b) => (
                              <div key={b} className={wb.dossierProseItem}>
                                <span className={wb.dossierProseKey}>
                                  {PROSE_BLOCK_INFO[b].label}
                                  {EXTRA_PROSE_BLOCKS.includes(b) ? "（仅随角色卡/酒馆导出）" : ""}
                                </span>
                                <p className={wb.dossierProseVal}>{card[b]}</p>
                              </div>
                            ))}
                          </div>
                        )}
                      </DossierBlock>
                    </div>
                  </div>
                </>
              )}
            </div>
          </section>
        </div>

        {/* —————— 右侧常驻实时档案摘要栏（Step 05 隐藏避免重复；< 1180px 切换为抽屉） —————— */}
        {!isReview && (
          <>
            {sidebarOpen && (
              <button
                type="button"
                aria-label="收起实时档案摘要"
                className={wb.sidebarBackdrop}
                data-open=""
                onClick={() => setSidebarOpen(false)}
              />
            )}
            <aside
              className={wb.sidebar}
              data-open={sidebarOpen || undefined}
              aria-label="实时档案摘要"
            >
              <NineSlice
                id="notify.itemCellBg"
                tint="rgb(8 8 14 / 92%)"
                slice={30}
                className={wb.panelLayer}
              />
              <NineSlice
                id="notify.itemCellFg"
                tint="var(--cp-red-dim)"
                slice={30}
                className={wb.panelLayer}
              />

              <div className={wb.sidebarScroll}>
                <div className={wb.sidebarTop}>
                  <div className={wb.sidebarHeadMobile}>
                    <span className={wb.sidebarEyebrow}>LIVE DOSSIER · 实时档案</span>
                    <Button small onClick={() => setSidebarOpen(false)}>
                      收起
                    </Button>
                  </div>

                  <header className={wb.sidebarHero}>
                    <div className={wb.sidebarTitleRow}>
                      <span className={wb.sidebarEyebrow}>NC LIVE DOSSIER</span>
                      {isSample && <span className={wb.sampleBadge}>官方预设</span>}
                    </div>
                    <h2 className={wb.heroName}>
                      {card.name.trim() || "未命名角色"}
                      {card.alias.trim() && (
                        <span className={wb.heroAlias}>「{card.alias.trim()}」</span>
                      )}
                    </h2>
                    <p className={wb.heroMeta}>
                      {[
                        card.pronoun.trim() || "未设代词",
                        board.origin?.label ?? "未选出身",
                        anchor ? anchorLabel(anchor) : startLoc || "未设落脚点",
                      ].join(" · ")}
                    </p>
                  </header>

                  <section
                    className={wb.humanityConsole}
                    data-tone={stageInfo.tone}
                    aria-label="术后人性摘要"
                  >
                    <CellFrame />
                    <div className={wb.humanityRow}>
                      <span className={wb.humanityStageBadge} data-tone={stageInfo.tone}>
                        {stageInfo.label}
                      </span>
                      <span className={wb.humanityNums}>
                        <b>{humanityNow}</b> / 100
                      </span>
                    </div>
                    <div className={wb.humanityTrack} aria-hidden="true">
                      <span
                        className={wb.humanityFill}
                        data-tone={stageInfo.tone}
                        style={{ width: `${Math.max(0, Math.min(100, humanityNow))}%` }}
                      />
                    </div>
                    <p className={wb.humanityNote}>
                      {TOLERANCE_LEVELS[board.tolerance].label} ×{TOLERANCE_FACTOR[board.tolerance]}
                    </p>
                  </section>

                  <div className={wb.sidebarStats}>
                    <div className={wb.sidebarStat}>
                      <span className={wb.sidebarStatKey}>过往 / 特质 / 缺陷</span>
                      <span className={wb.sidebarStatVal}>
                        {board.pasts.length} / {board.skills.length} / {board.flaws.length}
                      </span>
                    </div>
                    <div className={wb.sidebarStat}>
                      <span className={wb.sidebarStatKey}>开局义体</span>
                      <span className={wb.sidebarStatVal}>
                        {board.cyberware.length + activeInherentCount} 件
                      </span>
                    </div>
                    <div className={wb.sidebarStat}>
                      <span className={wb.sidebarStatKey}>启动资金</span>
                      <span className={wb.sidebarStatVal}>{loadoutSummary.finalEddies} €</span>
                    </div>
                    <div className={wb.sidebarStat}>
                      <span className={wb.sidebarStatKey}>人脉 / 小传</span>
                      <span className={wb.sidebarStatVal}>
                        {board.acquaintances.length} 人 · {filledProseCount}/7
                      </span>
                    </div>
                  </div>
                </div>

                <div className={wb.sidebarBottom}>
                  <section className={wb.sidebarBuild} aria-label="当前构筑摘要">
                    <div className={wb.telemetryHead}>
                      <span className={wb.telemetryTitle}>当前构筑摘要</span>
                      <span className={wb.sidebarBuildCount}>
                        {board.origin?.label ?? "未选出身"}
                      </span>
                    </div>
                    <dl className={wb.buildList}>
                      <div className={wb.buildRow}>
                        <dt>落脚点</dt>
                        <dd>{anchor ? anchorLabel(anchor) : startLoc || "跟随出身"}</dd>
                      </div>
                      <div className={wb.buildRow}>
                        <dt>已装义体</dt>
                        <dd>
                          {mountedChromeNames.length > 0
                            ? mountedChromeNames.join(" · ")
                            : "暂无自选义体"}
                        </dd>
                      </div>
                      <div className={wb.buildRow}>
                        <dt>特质履历</dt>
                        <dd>
                          {selectedTraitNames.length > 0
                            ? selectedTraitNames.join(" · ")
                            : "待补充"}
                        </dd>
                      </div>
                      <div className={wb.buildRow}>
                        <dt>武器载具</dt>
                        <dd>
                          {[...weaponNames, ...allVehicles].length > 0
                            ? [...weaponNames, ...allVehicles].join(" · ")
                            : "仅默认随身配置"}
                        </dd>
                      </div>
                    </dl>
                  </section>

                  <section className={wb.sidebarChecks} aria-label="档案就绪检查">
                    <div className={wb.telemetryHead}>
                      <span className={wb.telemetryTitle}>档案就绪状态</span>
                      <span
                        className={wb.readyBadge}
                        data-ready={checks.length === 0 ? "" : undefined}
                      >
                        {checks.length === 0 ? "✓ 档案就绪" : `待完善 ${checks.length} 项`}
                      </span>
                    </div>
                    {checks.length === 0 ? (
                      <p className={wb.note}>必选项已完成，可前往第 5 步总览或直接开局。</p>
                    ) : (
                      <ul className={wb.checksList} aria-label="待完善项">
                        {checks.map((c) => (
                          <li key={c.text}>
                            <ActionButton onClick={() => jumpToCheck(c.target)}>
                              ⚠ {c.text} ▸
                            </ActionButton>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                </div>
              </div>
            </aside>
          </>
        )}
      </div>

      {/* —————— 底部常驻操作条 —————— */}
      <footer className={wb.bar}>
        <CellFrame />
        <div className={wb.barActions}>
          <Button
            disabled={!canSave || busy}
            reason={checks[0]?.text}
            onClick={() => void handleSave()}
          >
            {busy ? "保存中…" : isSample ? "另存为自定义角色" : "保存角色"}
          </Button>
          <Button small onClick={() => downloadCard(card)}>
            导出角色卡
          </Button>
          {canDelete && (
            <Button small disabled={busy} onClick={onDelete}>
              删除
            </Button>
          )}
          {displaySaveError ? (
            <span className={wb.statusError} role="alert">
              {displaySaveError}
            </span>
          ) : (
            <span className={wb.statusHint}>
              {saved
                ? "✓ 角色已保存至本地角色库"
                : isSample && dirty
                  ? "已修改官方预设：保存或开局将另存为新的自定义角色"
                  : isSample
                    ? "官方预设角色：可直接开启战局，或修改后另存为自定义角色"
                    : draftSaved
                      ? "已自动暂存本地草稿"
                      : "本地草稿暂存失败"}
            </span>
          )}
        </div>

        <div className={wb.launchRow}>
          {launchMutation.isError && (
            <span className={wb.statusError} role="alert">
              {launchMutation.error.message}
            </span>
          )}
          <Button
            disabled={busy || currentStepIndex <= 0}
            onClick={() => {
              const prev = CREATOR_STEPS[currentStepIndex - 1];
              if (prev) goToStep(prev.id);
            }}
          >
            上一步
          </Button>
          {currentStepIndex < CREATOR_STEPS.length - 1 && (
            <Button
              disabled={busy}
              onClick={() => {
                const next = CREATOR_STEPS[currentStepIndex + 1];
                if (next) goToStep(next.id);
              }}
            >
              下一步
            </Button>
          )}
          <FrameBox className={wb.titleBox}>
            <input
              maxLength={80}
              value={saveTitle}
              aria-label="新战局代号"
              placeholder={`${card.name.trim() || "未命名"}的夜之城传奇`}
              onChange={(e) => setSaveTitle(e.target.value)}
            />
          </FrameBox>
          <Button
            primary
            disabled={!canLaunch}
            reason={!data ? "请等待创角目录读取完成" : (checks[0]?.text ?? "正在保存角色")}
            onClick={() => {
              onLaunchingChange(true);
              launchMutation.mutate();
            }}
          >
            {launchMutation.isPending
              ? "正在接入夜之城…"
              : isSample && !dirty
                ? "用此预设开启战局"
                : "保存并开启战局"}
          </Button>
        </div>
      </footer>
    </div>
  );
}
