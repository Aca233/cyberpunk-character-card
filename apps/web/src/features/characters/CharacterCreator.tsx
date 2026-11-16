import {
  type Board,
  type BoardModule,
  BoardSchema,
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
  rollLifepath,
  SKILL_MAX,
  TOLERANCE_LEVELS,
} from "@cp/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useRef, useState } from "react";
import { api, type BoardData } from "../../api/client";
import { cssUrl, NineSlice } from "../../ui/Asset";
import { Button } from "../../ui/Button";
import { CellFrame, FrameBox } from "../../ui/FrameBox";
import { CYBER_LABELS, CyberDoll, type CyberSlot, type DollPart } from "../story/CyberDoll";
import { PeoplePicker } from "./CreatorLife";
import { CreatorModal } from "./CreatorModal";
import {
  CyberwareShelf,
  FlawPicker,
  LoadoutPicker,
  OriginPicker,
  type PickerProps,
  TraitPicker,
} from "./CreatorSteps";
import {
  type CheckTarget,
  clearDraft,
  comboHints,
  creatorChecks,
  defaultStartLocationFor,
  exportLocalWorkshopPack,
  humanityStageInfo,
  inherentCyberware,
  loadLocalCustomModules,
  mergeCreatorCatalog,
  ORIGIN_ECOSYSTEM_LABELS,
  originDefaultLoadout,
  originEcosystem,
  rollTraits,
  type TraitFilter,
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

type RightTab = "build" | "cyber" | "person";
type SubDrawer = "origin" | "traits" | "flaws" | "loadout" | "people" | "map" | null;
type CenterMode = "doll" | "dossier";

const SUB_TITLES: Readonly<Record<Exclude<SubDrawer, null>, string>> = {
  origin: "选择出身背景",
  traits: "挑选特质与过往履历",
  flaws: "挂载负面缺陷",
  loadout: "定制开局行装与座驾",
  people: "夜之城人脉网络",
  map: "选择开局出生锚点",
};

const SUB_HINTS: Readonly<Record<Exclude<SubDrawer, null>, string>> = {
  origin: "出身决定初始家底、自带标配义体与街头人脉；也可以自己写一个。",
  traits: "身心禀赋、专长技艺与过往履历都在这里；点卡片选中/取消，悬停看详情。",
  flaws: "缺陷不扣任何资源，只会带来债主、通缉、宿敌之类的剧情钩子。",
  loadout: "出身有默认家底；这里可调资金档位、额外武器与专属载具。",
  people: "把夜之城的人物设为旧识，或新建自己的故人。",
  map: "拖动、缩放地图，点一个锚点作为开局位置。",
};

function DossierBlock({
  title,
  onEdit,
  wide = false,
  children,
}: {
  readonly title: string;
  readonly onEdit: () => void;
  readonly wide?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <section className={wb.dossierBlock} data-wide={wide || undefined}>
      <CellFrame />
      <header className={wb.dossierHead}>
        <h3 className={wb.dossierHeading}>{title}</h3>
        <button type="button" className={wb.dossierEdit} onClick={onEdit}>
          修改 ▸
        </button>
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

function downloadJson(name: string, payload: unknown): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name.trim() || "character"}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * 2077 赛博角色创建工作台：
 * 左栏（身份铭牌 + 出身背景 + 开局态势导航）
 * 中栏（主角级对称 2077 CyberDoll / 档案总览切换 + 生理耐受 × 术后人性实时控制台）
 * 右栏（map.panel 原作斜切工作表：构筑槽位与就绪状态栏 + 能力与特质 / 义体货架 / 人设小传）
 * 底栏（左保存/导出/删除 · 右战局代号与一键开局）
 */
export function CharacterCreator({
  card,
  boardData,
  busy,
  canDelete,
  canSave,
  isSample = false,
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
  const board = card.board ?? BoardSchema.parse({});
  const [tab, setTab] = useState<RightTab>("build");
  const [sub, setSub] = useState<SubDrawer>(null);
  const [traitFilter, setTraitFilter] = useState<TraitFilter>("all");
  const [centerMode, setCenterMode] = useState<CenterMode>("doll");
  const [activeSlot, setActiveSlot] = useState<CyberSlot>("os");
  const [saveTitle, setSaveTitle] = useState("");
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const queryClient = useQueryClient();

  const localModules = loadLocalCustomModules();
  const data = boardData ? mergeCreatorCatalog(boardData, localModules) : undefined;
  const fallbackLoc = defaultStartLocationFor(card, data);
  const startLoc = board.startLocation || fallbackLoc;

  const commit = (next: Board, origin?: string) => {
    const nextBoard: Board = {
      ...next,
      combos: [],
    };
    onChange({
      ...card,
      ...(origin !== undefined ? { origin } : {}),
      board: nextBoard,
    });
  };

  const change = (patch: Partial<CharacterCard>) =>
    onChange((current) => ({ ...current, ...patch }));

  const setLoc = (loc: string) => {
    const { startLocation: _, ...rest } = board;
    onChange({ ...card, board: { ...rest, ...(loc ? { startLocation: loc } : {}) } });
  };

  const launchMutation = useMutation({
    mutationFn: async () => {
      const targetCard: CharacterCard = {
        ...card,
        board,
      };
      const savedEntry = isSample && characterId ? { id: characterId } : await onSave(targetCard);
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
  const canLaunch =
    Boolean(data) && canSave && checks.length === 0 && !busy && !launchMutation.isPending;

  const jumpToCheck = (target: CheckTarget) => {
    if (target === "identity") {
      nameInputRef.current?.focus();
      return;
    }
    if (target === "origin") {
      setSub("origin");
      return;
    }
    if (target === "people") {
      setSub("people");
      return;
    }
    if (target === "cyber") {
      setSub(null);
      setTab("cyber");
      return;
    }
    if (target === "person") {
      setSub(null);
      setTab("person");
      return;
    }
    setSub(null);
    setTab("build");
  };

  // ———— 义体、耐受与人性计算 ————
  const inherent = inherentCyberware(card, data);
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

  const selectCyberSlot = (s: CyberSlot) => {
    setActiveSlot(s);
    setSub(null);
    setTab("cyber");
  };

  const handleDollCell = (slot: CyberSlot, part: DollPart | undefined) => {
    if (part && activeSlot === slot && board.cyberware.some((c) => c.id === part.id)) {
      commit({
        ...board,
        cyberware: board.cyberware.filter((c) => c.id !== part.id),
      });
      return;
    }
    selectCyberSlot(slot);
  };

  const openSub = (target: Exclude<SubDrawer, null>, initialTraitFilter?: TraitFilter) => {
    if (initialTraitFilter) setTraitFilter(initialTraitFilter);
    setSub((curr) => (curr === target && !initialTraitFilter ? null : target));
  };

  // ———— 摘要数据 ————
  const anchor = startAnchor(startLoc);
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
  const filledProseCount = PROSE_BLOCKS.filter((b) => card[b].trim() !== "").length;
  const hasExtraProse = EXTRA_PROSE_BLOCKS.some((b) => card[b].trim() !== "");
  const hints = data ? comboHints(board, data.combos, data.modules) : [];

  const rollPast = () => {
    if (!data) return;
    const rolled = rollLifepath(board, data.lifepath, data.modules, Math.random);
    if (rolled) commit({ ...board, pasts: [...board.pasts, rolled] });
  };

  const pickerProps: PickerProps | null = data ? { card, board, data, commit, change } : null;
  const tabLineMask = cssUrl("tab.line");
  const tabBgUrl = cssUrl("tab.bg");

  return (
    <div className={wb.bench}>
      {/* —————— 左栏：身份铭牌、出身流派中枢与开局态势 —————— */}
      <aside className={wb.left} aria-label="身份与开局配置" inert={busy}>
        <section className={wb.idCard} aria-label="角色身份铭牌">
          <CellFrame />
          <div className={wb.idCardHead}>
            <span className={wb.groupLabel}>身份铭牌 · NC CITIZEN ID</span>
            {isSample && <span className={wb.sampleBadge}>官方预设</span>}
          </div>
          <div className={wb.idStack}>
            <FrameBox className={wb.compactBox}>
              <input
                ref={nameInputRef}
                maxLength={20}
                value={card.name}
                aria-label="姓名"
                placeholder="角色姓名 *"
                onChange={(e) => change({ name: e.target.value })}
              />
            </FrameBox>
            <div className={wb.idSplit}>
              <FrameBox className={wb.compactBox}>
                <input
                  maxLength={20}
                  value={card.alias}
                  aria-label="外号"
                  placeholder="街头外号（可选）"
                  onChange={(e) => change({ alias: e.target.value })}
                />
              </FrameBox>
              <FrameBox className={wb.compactBox}>
                <input
                  maxLength={4}
                  value={card.pronoun}
                  aria-label="代词"
                  placeholder="代词 *"
                  onChange={(e) => change({ pronoun: e.target.value })}
                />
              </FrameBox>
            </div>
            <fieldset className={wb.pronounRow} aria-label="快捷代词">
              <span className={wb.pronounLabel}>快捷代词</span>
              <div className={wb.pronounPills}>
                {PRONOUN_PRESETS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    className={wb.pronounPill}
                    aria-pressed={card.pronoun === p}
                    onClick={() => change({ pronoun: p })}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </fieldset>
          </div>
        </section>

        <span className={wb.hairline} style={{ maskImage: tabLineMask }} aria-hidden="true" />

        {/* 出身背景卡 */}
        <section className={wb.originHub} aria-label="出身背景">
          <button
            type="button"
            className={wb.navCard}
            aria-pressed={sub === "origin"}
            data-empty={!board.origin ? "" : undefined}
            onClick={() => openSub("origin")}
          >
            <CellFrame />
            <span className={wb.navCardHead}>
              <span className={wb.cardEyebrow}>
                出身背景
                {board.origin
                  ? ` · ${ORIGIN_ECOSYSTEM_LABELS[originEcosystem(board.origin)]}`
                  : " · 必选"}
              </span>
              <span className={wb.cardAction}>{sub === "origin" ? "收起" : "更换 / 自创 ▸"}</span>
            </span>
            <strong className={wb.cardTitle}>{board.origin?.label ?? "点击选择出身背景"}</strong>
            <span className={wb.cardSub}>
              {board.origin?.ability ||
                board.origin?.hook ||
                "决定初始家底、街头人脉与专属叙事钩子"}
            </span>
          </button>
        </section>

        <span className={wb.hairline} style={{ maskImage: tabLineMask }} aria-hidden="true" />

        {/* 开局态势导航卡 */}
        <span className={wb.groupLabel}>开局态势与社会关系</span>
        <button
          type="button"
          className={wb.navCard}
          aria-pressed={sub === "map"}
          onClick={() => openSub("map")}
        >
          <CellFrame />
          <span className={wb.navCardHead}>
            <span className={wb.cardEyebrow}>开局地点</span>
            <span className={wb.cardAction}>{sub === "map" ? "收起" : "地图选点 ▸"}</span>
          </span>
          <strong className={wb.cardTitle}>
            {anchor ? anchorLabel(anchor) : startLoc || "按出身自动落位"}
          </strong>
          <span className={wb.cardSub}>
            {anchor?.kind ? `地标类别：${anchor.kind}` : "点击在夜之城地图上自选出生锚点"}
          </span>
        </button>

        <button
          type="button"
          className={wb.navCard}
          aria-pressed={sub === "loadout"}
          onClick={() => openSub("loadout")}
        >
          <CellFrame />
          <span className={wb.navCardHead}>
            <span className={wb.cardEyebrow}>开局行装与座驾</span>
            <span className={wb.cardAction}>{sub === "loadout" ? "收起" : "定制 ▸"}</span>
          </span>
          <strong className={wb.cardTitle}>
            {loadoutSummary.finalEddies} € · {CASH_TIER_INFO[board.kit.cashTier].label}
          </strong>
          <span className={wb.cardSub}>
            {[...weaponNames, ...allVehicles].join(" · ") ||
              loadoutSummary.gearNames.slice(0, 2).join(" · ") ||
              "随身家底、武器与专属载具"}
          </span>
        </button>

        <button
          type="button"
          className={wb.navCard}
          aria-pressed={sub === "people"}
          onClick={() => openSub("people")}
        >
          <CellFrame />
          <span className={wb.navCardHead}>
            <span className={wb.cardEyebrow}>夜之城人脉</span>
            <span className={wb.cardAction}>{sub === "people" ? "收起" : "人脉网 ▸"}</span>
          </span>
          <strong className={wb.cardTitle}>
            {board.acquaintances.length > 0
              ? `已建立 ${board.acquaintances.length} 人交集`
              : "尚无自选旧识"}
          </strong>
          <span className={wb.cardSub}>
            {board.acquaintances.length > 0
              ? board.acquaintances.map((a) => a.name).join("、")
              : "结交挚友、点头之交或宿敌"}
          </span>
        </button>
      </aside>

      {/* —————— 中栏：2077 赛博解剖台 & 完整档案总览 —————— */}
      <section className={wb.center} aria-label="角色义体拓扑与档案预览" inert={busy}>
        <header className={wb.heroPlate}>
          <div className={wb.heroTopRow}>
            <div>
              <h2 className={wb.heroName}>
                {card.name.trim() || "未命名角色"}
                {card.alias.trim() && <span className={wb.heroAlias}>「{card.alias.trim()}」</span>}
              </h2>
              <p className={wb.heroMeta}>
                {[
                  card.pronoun.trim() || "未设代词",
                  board.origin?.label ?? "未选出身",
                  anchor ? anchorLabel(anchor) : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
            <div className={wb.centerSwitch} role="tablist" aria-label="中栏视图切换">
              <button
                type="button"
                role="tab"
                aria-selected={centerMode === "doll"}
                className={wb.centerSwitchBtn}
                onClick={() => setCenterMode("doll")}
              >
                义体拓扑
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={centerMode === "dossier"}
                className={wb.centerSwitchBtn}
                onClick={() => setCenterMode("dossier")}
              >
                档案总览
              </button>
            </div>
          </div>
          <span className={wb.heroLine} style={{ maskImage: tabLineMask }} aria-hidden="true" />
        </header>

        {centerMode === "doll" ? (
          <>
            <div className={wb.dollFrame}>
              <CyberDoll
                parts={dollParts}
                selected={activeSlot}
                onCell={handleDollCell}
                humanity={{ current: humanityNow, cap: 100, stageLabel: stageInfo.label }}
              />
            </div>

            <div className={wb.humanityConsole} data-tone={stageInfo.tone}>
              <CellFrame />
              <div className={wb.humanityRow}>
                <span className={wb.humanityStageBadge} data-tone={stageInfo.tone}>
                  {stageInfo.label}
                </span>
                <span className={wb.humanityNums}>
                  人性 <b>{humanityNow}</b> / 100
                </span>
                <div className={wb.humanityTrack} aria-hidden="true">
                  <span
                    className={wb.humanityFill}
                    data-tone={stageInfo.tone}
                    style={{ width: `${Math.max(0, Math.min(100, humanityNow))}%` }}
                  />
                </div>
                <fieldset className={wb.tolBar} aria-label="义体生理耐受">
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
              </div>
              <p className={wb.humanityNote}>{stageInfo.note}</p>
            </div>
          </>
        ) : (
          /* ———— 档案总览模式（Dossier Preview） ———— */
          <div className={wb.dossierWrap}>
            <div className={wb.dossierGrid}>
              <DossierBlock title="出身背景" onEdit={() => openSub("origin")}>
                <strong className={wb.dossierBig}>{board.origin?.label ?? "尚未选择"}</strong>
                <p className={wb.dossierText}>
                  {board.origin?.ability || "决定初始家底与街头人脉"}
                </p>
                {board.origin?.hook && <p className={wb.dossierDim}>钩子：{board.origin.hook}</p>}
              </DossierBlock>

              <DossierBlock title="义体与人性" onEdit={() => setCenterMode("doll")}>
                <strong className={wb.dossierBig} data-tone={stageInfo.tone}>
                  {humanityNow}
                  <small> / 100 · {stageInfo.label}</small>
                </strong>
                <p className={wb.dossierDim}>
                  {TOLERANCE_LEVELS[board.tolerance].label} ×{TOLERANCE_FACTOR[board.tolerance]}
                </p>
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
                title={`核心特质 ${board.skills.length}/${SKILL_MAX}`}
                onEdit={() => openSub("traits", "all")}
              >
                <ChipList
                  empty="尚未选择"
                  items={board.skills.map((m) => ({ k: m.id, t: m.label, tip: m.ability }))}
                />
                <p className={wb.dossierLabel}>
                  过往经历 {board.pasts.length}/{PAST_MAX}
                </p>
                <ChipList
                  empty="无"
                  items={board.pasts.map((m) => ({
                    k: m.id,
                    t: m.label,
                    tip: m.hook || m.ability,
                  }))}
                />
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
              </DossierBlock>

              <DossierBlock title="行装与人脉" onEdit={() => openSub("loadout")}>
                <strong className={wb.dossierBig}>
                  {loadoutSummary.finalEddies} €
                  <small> · {CASH_TIER_INFO[board.kit.cashTier].label}</small>
                </strong>
                <ChipList
                  empty="无随身装备"
                  items={[...loadoutSummary.gearNames, ...weaponNames, ...allVehicles].map((t) => ({
                    k: t,
                    t,
                  }))}
                />
                <p className={wb.dossierLabel}>人脉 {board.acquaintances.length}</p>
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
                wide
                title={`人设小传 ${filledProseCount}/7`}
                onEdit={() => {
                  setTab("person");
                }}
              >
                {filledProseCount === 0 ? (
                  <p className={wb.dossierDim}>
                    还没写：在右侧「人设小传」手写，或让 AI 一键成稿。
                  </p>
                ) : (
                  PROSE_BLOCKS.filter((b) => card[b].trim() !== "").map((b) => (
                    <p key={b} className={wb.dossierText}>
                      <span className={wb.dossierLabel}>{PROSE_BLOCK_INFO[b].label} </span>
                      {card[b]}
                    </p>
                  ))
                )}
              </DossierBlock>
            </div>
          </div>
        )}
      </section>

      {/* —————— 右栏：map.panel 构筑槽位与人设工作表 —————— */}
      <aside className={wb.right} aria-label="角色构筑与人设工作表" inert={busy}>
        <NineSlice
          id="map.panelBg"
          tint="rgb(5 5 10 / 92%)"
          slice={[110, 85, 75, 85]}
          className={wb.sheetLayer}
        />
        <NineSlice
          id="map.panelFg"
          tint="var(--cp-red)"
          slice={[110, 85, 75, 85]}
          className={wb.sheetLayer}
        />

        {/* 构筑槽位与就绪状态栏（无点数限制） */}
        <div className={wb.telemetry} role="status">
          <div className={wb.telemetryHead}>
            <span className={wb.telemetryTitle}>构筑槽位与档案状态 · 自由配装</span>
            <span className={wb.readyBadge} data-ready={checks.length === 0 ? "" : undefined}>
              {checks.length === 0 ? "✓ 档案就绪" : `待完善 ${checks.length} 项`}
            </span>
          </div>

          {checks.length > 0 && (
            <ul className={wb.checks} aria-label="待完善项">
              {checks.map((c) => (
                <li key={c.text}>
                  <button
                    type="button"
                    className={wb.checkJumpBtn}
                    onClick={() => jumpToCheck(c.target)}
                  >
                    ⚠ {c.text} ▸
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* 顶层导航页签（tab.bg + tab.line） */}
        <nav className={wb.sheetNav} aria-label="工作表页签">
          <div className="cp-tabs">
            <button
              type="button"
              aria-current={tab === "build" ? "page" : undefined}
              style={{ ["--tab-bg" as string]: tabBgUrl }}
              onClick={() => {
                setSub(null);
                setTab("build");
              }}
            >
              能力与特质
            </button>
            <button
              type="button"
              aria-current={tab === "cyber" ? "page" : undefined}
              style={{ ["--tab-bg" as string]: tabBgUrl }}
              onClick={() => {
                setSub(null);
                setTab("cyber");
              }}
            >
              义体货架 ({board.cyberware.length})
            </button>
            <button
              type="button"
              aria-current={tab === "person" ? "page" : undefined}
              style={{ ["--tab-bg" as string]: tabBgUrl }}
              onClick={() => {
                setSub(null);
                setTab("person");
              }}
            >
              人设小传 ({filledProseCount}/7)
            </button>
          </div>
          <span className="cp-tab-line" style={{ maskImage: tabLineMask }} aria-hidden="true" />
        </nav>

        {/* 抽屉内容区 */}
        <div className={wb.drawerBody}>
          {!data || !pickerProps ? (
            <p className={wb.empty}>正在加载夜之城内容库…</p>
          ) : tab === "build" ? (
            <div className={wb.buildStack}>
              {/* 1. 核心特质 */}
              <section className={wb.slotBlock} aria-label="角色核心特质">
                <header className={wb.slotHead}>
                  <h3 className={wb.slotTitle}>
                    核心特质
                    <small className={wb.slotSub}>
                      {board.skills.length} / {SKILL_MAX} · 身心禀赋与专长技艺
                    </small>
                  </h3>
                  <div className={wb.slotTools}>
                    <Button
                      small
                      disabled={board.skills.length >= SKILL_MAX}
                      onClick={() => commit(rollTraits(board, data.modules, Math.random, 3))}
                    >
                      随机搭配
                    </Button>
                    <Button small onClick={() => openSub("traits", "all")}>
                      ＋ 挑选特质
                    </Button>
                  </div>
                </header>
                {board.skills.length === 0 ? (
                  <p className={wb.empty}>尚未选择特质。可点击「挑选特质」、或随机搭配。</p>
                ) : (
                  <ul className={wb.chips}>
                    {board.skills.map((m: BoardModule) => (
                      <li key={m.id} className={wb.chip} title={m.ability}>
                        <CellFrame />
                        <span>{m.label}</span>
                        <button
                          type="button"
                          className={wb.chipDrop}
                          aria-label={`移除${m.label}`}
                          onClick={() =>
                            commit({
                              ...board,
                              skills: board.skills.filter((x) => x.id !== m.id),
                            })
                          }
                        >
                          ×
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {/* 2. 过往经历（生命路径） */}
              <section className={wb.slotBlock} aria-label="过往经历">
                <header className={wb.slotHead}>
                  <h3 className={wb.slotTitle}>
                    过往经历
                    <small className={wb.slotSub}>
                      {board.pasts.length} / {PAST_MAX} · 街头履历与故人恩怨
                    </small>
                  </h3>
                  <div className={wb.slotTools}>
                    <Button small disabled={board.pasts.length >= PAST_MAX} onClick={rollPast}>
                      🎲 掷生命路径
                    </Button>
                    <Button small onClick={() => openSub("traits", "past")}>
                      ＋ 挑选过往
                    </Button>
                  </div>
                </header>
                {board.pasts.length === 0 ? (
                  <p className={wb.empty}>
                    可选：掷一段契合出身的生命路径，或手动挑选过往履历带出故人。
                  </p>
                ) : (
                  <ul className={wb.chips}>
                    {board.pasts.map((m: BoardModule) => (
                      <li key={m.id} className={wb.chip} title={m.hook || m.ability}>
                        <CellFrame />
                        <span>{m.label}</span>
                        <button
                          type="button"
                          className={wb.chipDrop}
                          aria-label={`移除${m.label}`}
                          onClick={() =>
                            commit({
                              ...board,
                              pasts: board.pasts.filter((x) => x.id !== m.id),
                            })
                          }
                        >
                          ×
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {/* 3. 负面缺陷 */}
              <section className={wb.slotBlock} aria-label="负面缺陷">
                <header className={wb.slotHead}>
                  <h3 className={wb.slotTitle}>
                    负面缺陷
                    <small className={wb.slotSub}>
                      {board.flaws.length} / {FLAW_MAX} · 带来剧情钩子、债主与宿敌
                    </small>
                  </h3>
                  <Button small onClick={() => openSub("flaws")}>
                    ＋ 挑选缺陷
                  </Button>
                </header>
                {board.flaws.length === 0 ? (
                  <p className={wb.empty}>
                    未挂载负面缺陷。想要更刺激的开局可挂载债主、通缉或旧伤。
                  </p>
                ) : (
                  <ul className={wb.chips}>
                    {board.flaws.map((m: BoardModule) => (
                      <li key={m.id} className={wb.chip} data-flaw="" title={m.hook || m.ability}>
                        <CellFrame />
                        <span>{m.label}</span>
                        <button
                          type="button"
                          className={wb.chipDrop}
                          aria-label={`移除${m.label}`}
                          onClick={() =>
                            commit({
                              ...board,
                              flaws: board.flaws.filter((x) => x.id !== m.id),
                            })
                          }
                        >
                          ×
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {/* 4. 联动提示（差 1 项可触发组合时提示） */}
              {hints.length > 0 && (
                <section className={wb.comboHintBox} aria-label="流派联动提示">
                  <CellFrame />
                  <span className={wb.groupLabel}>流派特质共鸣推荐</span>
                  {hints.slice(0, 2).map((h) => (
                    <div key={h.combo.id} className={wb.comboHintRow}>
                      <span className={wb.comboHintText}>
                        <strong className={wb.comboHintName}>{h.combo.label}</strong>（
                        {h.combo.ability}）— 差 1 项：
                      </span>
                      <div className={wb.slotTools}>
                        {h.candidates.slice(0, 2).map((cand) => (
                          <Button
                            key={cand.id}
                            small
                            disabled={board.skills.length >= SKILL_MAX}
                            onClick={() => commit({ ...board, skills: [...board.skills, cand] })}
                          >
                            ＋ {cand.label}
                          </Button>
                        ))}
                      </div>
                    </div>
                  ))}
                </section>
              )}
            </div>
          ) : tab === "cyber" ? (
            <>
              <fieldset className={wb.slotRibbon} aria-label="义体部位切换">
                {CYBER_SLOT_LIST.map((s) => {
                  const count = (dollParts.get(s) ?? []).length;
                  const cap = cyberwareRules.SLOT_CAPACITY[s];
                  return (
                    <button
                      key={s}
                      type="button"
                      className={wb.slotRibbonBtn}
                      aria-pressed={activeSlot === s}
                      onClick={() => setActiveSlot(s)}
                    >
                      <span>{CYBER_LABELS[s]}</span>
                      <small className={wb.chipMuted}>
                        {count}/{cap}
                      </small>
                    </button>
                  );
                })}
              </fieldset>
              <CyberwareShelf {...pickerProps} slot={activeSlot} />
            </>
          ) : (
            <div className={wb.personStack}>
              <DraftAll card={card} onChange={change} />

              <section className={wb.proseSection} aria-label="核心人设区块">
                <header className={wb.slotHead}>
                  <h3 className={wb.slotTitle}>
                    核心人设小传
                    <small className={wb.slotSub}>
                      注入开局 AI 叙事上下文 · 可手写或交由上方 AI 协同成稿
                    </small>
                  </h3>
                </header>
                <div className={wb.proseList}>
                  {CORE_PROSE_BLOCKS.map((b) => (
                    <ProseField key={b} block={b} card={card} onChange={change} />
                  ))}
                </div>
              </section>

              <details className={wb.extraProse} open={hasExtraProse || undefined}>
                <summary className={wb.extraProseSummary}>
                  <span>卡面演出与补充设定（开场场景、开场白、对话示例）</span>
                  <small className={wb.chipMuted}>可选展开</small>
                </summary>
                <div className={wb.proseList}>
                  {EXTRA_PROSE_BLOCKS.map((b) => (
                    <ProseField key={b} block={b} card={card} onChange={change} />
                  ))}
                </div>
              </details>
            </div>
          )}
        </div>
      </aside>

      {/* —————— 底栏：保存/导出/删除 与 战局启动 —————— */}
      <footer className={wb.bar}>
        <div className={wb.barActions}>
          <Button
            small
            disabled={!canSave || busy}
            reason={checks[0]?.text}
            onClick={() => {
              // 保存错误由父级 mutation 展示，避免产生未处理的 Promise rejection。
              void onSave({ ...card, board }).catch(() => {});
            }}
          >
            {busy ? "保存中…" : isSample ? "另存为自定义角色" : "保存角色"}
          </Button>
          <Button small onClick={() => downloadCard(card)}>
            导出角色卡
          </Button>
          {localModules.length > 0 && (
            <Button small onClick={() => downloadJson("workshop-pack", exportLocalWorkshopPack())}>
              导出扩展包 ({localModules.length})
            </Button>
          )}
          {canDelete && (
            <Button small disabled={busy} onClick={onDelete}>
              删除
            </Button>
          )}
          <span className={wb.statusHint}>
            {saveError
              ? saveError
              : saved
                ? "✓ 角色已保存至本地角色库"
                : isSample
                  ? "官方预设角色：可直接开启战局，或修改后另存为自定义角色"
                  : draftSaved
                    ? "已自动暂存本地草稿"
                    : "本地草稿暂存失败"}
          </span>
        </div>

        <div className={wb.launchRow}>
          {launchMutation.isError && (
            <span className={wb.statusHint} role="alert">
              {launchMutation.error.message}
            </span>
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
              : isSample
                ? "用此预设开启战局"
                : "保存并开启战局"}
          </Button>
        </div>
      </footer>

      {sub !== null && data && pickerProps && (
        <CreatorModal title={SUB_TITLES[sub]} hint={SUB_HINTS[sub]} onClose={() => setSub(null)}>
          {sub === "origin" && <OriginPicker {...pickerProps} />}
          {sub === "traits" && (
            <TraitPicker
              key={traitFilter}
              board={board}
              data={data}
              commit={commit}
              initialFilter={traitFilter}
            />
          )}
          {sub === "flaws" && <FlawPicker board={board} data={data} commit={commit} />}
          {sub === "loadout" && <LoadoutPicker {...pickerProps} />}
          {sub === "people" && <PeoplePicker board={board} data={data} commit={commit} />}
          {sub === "map" && (
            <StartMapPicker
              value={startLoc}
              defaultStart={fallbackLoc}
              automatic={!board.startLocation}
              onChange={setLoc}
            />
          )}
        </CreatorModal>
      )}
    </div>
  );
}
