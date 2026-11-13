import {
  type Board,
  CASH_TIER_INFO,
  type CharacterCard,
  CharacterCardSchema,
  humanityRules,
  pruneAcquaintances,
  TOLERANCE_LEVELS,
} from "@cp/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { api, type BoardData, type CharacterEntry, type Difficulty } from "../../api/client";
import { DIFFICULTY_LABELS, DIFFICULTY_NOTES } from "../../labels";
import { cssUrl, NineSlice } from "../../ui/Asset";
import { Button } from "../../ui/Button";
import { CellFrame, FrameBox } from "../../ui/FrameBox";
import { CYBER_LABELS, CyberDoll, type CyberSlot, type DollPart } from "../story/CyberDoll";
import neural from "../story/neural.module.css";
import { PeoplePicker } from "./CreatorLife";
import {
  CyberwareShelf,
  FlawPicker,
  LoadoutPicker,
  OriginPicker,
  TraitPicker,
} from "./CreatorSteps";
import styles from "./characters.module.css";
import {
  clearDraft,
  creatorChecks,
  DIFFICULTY_BUDGET,
  defaultStartLocationFor,
  inherentCyberware,
  kitPoints,
  loadLocalCustomModules,
  mergeCreatorCatalog,
  originDefaultLoadout,
  rollTraits,
  type StepId,
  saveDraft,
  totalStartHumanityCost,
  unifiedBudget,
} from "./creator";
import { DraftAll } from "./DraftAll";
import { ProseField } from "./ProseField";
import { anchorLabel, DEFAULT_START, StartMapPicker, startAnchor } from "./StartMapPicker";
import wb from "./workbench.module.css";

/**
 * CK3「自定义统治者」× 2077 原作控件工作台：
 * 左栏身份与出身摘要、中栏宽阔对称 2077 义体全息人像、
 * 右栏 map.panel 定制控制表（定制点数 + tab.bg 页签 + 2×3 能力格 + 独立 AI 人设）、
 * 底栏单行存档与开局控制。只使用游戏原作切图框架，不堆叠手画细框。
 */

const BRIEF_BLOCKS = ["look", "past", "personality", "voice"] as const;
const TOLERANCES: readonly Board["tolerance"][] = ["low", "normal", "high"];
const DIFFICULTIES = Object.keys(DIFFICULTY_BUDGET) as Difficulty[];
const CYBER_SLOTS = Object.keys(CYBER_LABELS) as CyberSlot[];
const SHEET_SLICE = 24;

export interface CreatorStart {
  readonly step: StepId;
  readonly reached: number;
  readonly startLocation: string;
  /** 旧草稿字段，保留兼容 */
  readonly rerolls: number;
}

type Drawer =
  | { readonly kind: "build" }
  | { readonly kind: "origin" }
  | { readonly kind: "traits" }
  | { readonly kind: "flaws" }
  | { readonly kind: "loadout" }
  | { readonly kind: "people" }
  | { readonly kind: "map" }
  | { readonly kind: "cyber"; readonly slot: CyberSlot }
  | { readonly kind: "person" };

type SubKind = "origin" | "traits" | "flaws" | "loadout" | "people" | "map";

const SUB_TITLES: Readonly<Record<SubKind, string>> = {
  origin: "选择出身背景",
  traits: "挑选角色特质",
  flaws: "挑选负面缺陷",
  loadout: "调整开局行装",
  people: "建立夜之城人脉",
  map: "选择开局地点",
};

export function CharacterCreator({
  card,
  data: rawData,
  onChange,
  start,
  draftable,
  saving,
  saveError,
  saved,
  onSave,
  onExport,
  onDelete,
}: {
  readonly card: CharacterCard & { readonly board: Board };
  readonly data: BoardData;
  readonly onChange: (patch: Partial<CharacterCard>) => void;
  readonly start: CreatorStart;
  /** 还没进角色库的新角色：改动存成本地草稿 */
  readonly draftable: boolean;
  readonly saving: boolean;
  readonly saveError: string | null;
  readonly saved: boolean;
  /** 存进角色库；失败时抛错 */
  readonly onSave: (card: CharacterCard) => Promise<CharacterEntry>;
  readonly onExport?: (() => void) | undefined;
  readonly onDelete?: (() => void) | undefined;
}) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const board = card.board;
  const [drawer, setDrawer] = useState<Drawer>({ kind: "build" });
  const [lastCyberSlot, setLastCyberSlot] = useState<CyberSlot>("os");
  const [title, setTitle] = useState("");
  // 官方模块库 + 本地创意库（玩家自己写过的特质、出身和缺陷）
  const data = mergeCreatorCatalog(rawData, loadLocalCustomModules());
  const originDefault = defaultStartLocationFor(card, data, DEFAULT_START);
  const [customStart, setCustomStart] = useState<string>(() => {
    const saved = start.startLocation || board.startLocation || "";
    return saved && startAnchor(saved) && saved !== originDefault ? saved : "";
  });
  const startLocation = customStart && startAnchor(customStart) ? customStart : originDefault;
  const difficulty: Difficulty = board.difficulty ?? "nightCity";
  const parsed = CharacterCardSchema.safeParse(card);
  const checks = creatorChecks(card);

  // 草稿有没有存上：存不下（隐私模式、空间满）时页脚不能再写"草稿自动存在本机"
  const [draftStored, setDraftStored] = useState(true);
  useEffect(() => {
    if (draftable) {
      setDraftStored(
        saveDraft({
          card,
          step: start.step,
          reached: start.reached,
          startLocation: customStart,
          rerolls: start.rerolls,
        }),
      );
    }
  }, [draftable, card, customStart, start.step, start.reached, start.rerolls]);

  /** 改主板：拔掉模块后它带出的人从旧识里去掉；联动不再生成 */
  const commit = (next: Board, origin?: string) => {
    const pruned = pruneAcquaintances(next, data.npcs);
    onChange({ board: { ...pruned, combos: [] }, ...(origin ? { origin } : {}) });
  };
  const setDifficulty = (d: Difficulty) => commit({ ...board, difficulty: d });
  const pickLocation = (id: string) => {
    if (id === originDefault) {
      setCustomStart("");
      commit({ ...board, startLocation: undefined });
    } else {
      setCustomStart(id);
      commit({ ...board, startLocation: id });
    }
  };

  const launch = useMutation({
    mutationFn: async () => {
      if (!parsed.success) throw new Error("角色卡还没填完整");
      const entry = await onSave(parsed.data);
      clearDraft();
      return api.createSave({
        title: title.trim() || `${entry.card.name}的夜之城`,
        characterId: entry.id,
        difficulty,
        startLocation,
      });
    },
    onSuccess: async (save) => {
      await client.invalidateQueries({ queryKey: ["saves"] });
      navigate(`/play/${save.id}`);
    },
  });
  const busy = saving || launch.isPending;
  const reason = parsed.success ? undefined : parsed.error.issues[0]?.message;

  const budget = unifiedBudget(card, difficulty, data);
  const humanityCost = totalStartHumanityCost(card, data);
  const humanityNow = humanityRules.HUMANITY_MAX - humanityCost;
  const loadout = originDefaultLoadout(card, data);
  const kit = kitPoints(card, data);
  const props = { card, board, data, commit, change: onChange };

  // ———— 中栏：义体界面（自选义体 + 出身自带义体） ————
  const slotOf = new Map(data.cyberware.map((o) => [o.id, o.slot as CyberSlot]));
  const rarityOf = new Map(data.cyberware.map((o) => [o.id, o.rarity]));
  const inherent = inherentCyberware(card, data);
  const inherentIds = new Set(inherent.map((c) => c.id));
  const parts = new Map<CyberSlot, DollPart[]>();
  const addPart = (slot: CyberSlot | undefined, part: DollPart) => {
    if (slot) parts.set(slot, [...(parts.get(slot) ?? []), part]);
  };
  for (const c of inherent) {
    if (c.replaced) continue;
    const rarity = rarityOf.get(c.id);
    addPart(c.slot as CyberSlot, {
      id: c.id,
      name: `${c.name} · 自带`,
      ...(rarity ? { rarity } : {}),
    });
  }
  for (const c of board.cyberware) {
    const rarity = rarityOf.get(c.id);
    addPart(slotOf.get(c.id) ?? (c.slot as CyberSlot | undefined), {
      id: c.id,
      name: c.name,
      ...(rarity ? { rarity } : {}),
    });
  }
  const gauge = {
    current: humanityNow,
    cap: humanityRules.HUMANITY_MAX,
    stageLabel: humanityRules.STAGE_LABELS[humanityRules.humanityStage(humanityNow)],
  };

  const traits = [...board.pasts, ...board.skills];
  const anchor = startAnchor(startLocation);
  const locationName = anchor ? anchorLabel(anchor) : "超级摩天楼 H10";
  const filledBrief = BRIEF_BLOCKS.filter((b) => card[b].trim().length > 0).length;
  const briefSnippet =
    card.look.trim() || card.past.trim() || card.personality.trim() || card.voice.trim();

  const open = (next: Drawer) => {
    if (next.kind === "cyber") setLastCyberSlot(next.slot);
    setDrawer(next);
  };

  const primaryTab =
    drawer.kind === "cyber" ? "cyber" : drawer.kind === "person" ? "person" : "build";
  const subTitle =
    drawer.kind !== "build" && drawer.kind !== "cyber" && drawer.kind !== "person"
      ? SUB_TITLES[drawer.kind]
      : null;

  const hairlineStyle = {
    maskImage: cssUrl("tab.line"),
    WebkitMaskImage: cssUrl("tab.line"),
  };

  return (
    <div className={wb.bench}>
      {/* ———— 左栏：平静身份与出身摘要 ———— */}
      <aside className={wb.left} aria-label="身份与开局摘要">
        <div className={wb.idStack}>
          <div>
            <span className={wb.groupLabel}>姓名 *</span>
            <FrameBox className={wb.compactBox}>
              <input
                required
                aria-label="姓名"
                maxLength={20}
                value={card.name}
                autoComplete="off"
                placeholder="文森特 / 瓦莱丽"
                onChange={(e) => onChange({ name: e.target.value })}
              />
            </FrameBox>
          </div>
          <div className={wb.idSplit}>
            <div>
              <span className={wb.groupLabel}>外号</span>
              <FrameBox className={wb.compactBox}>
                <input
                  aria-label="外号"
                  maxLength={20}
                  value={card.alias}
                  placeholder="街头代号"
                  onChange={(e) => onChange({ alias: e.target.value })}
                />
              </FrameBox>
            </div>
            <div>
              <span className={wb.groupLabel}>代词 *</span>
              <FrameBox className={wb.compactBox}>
                <input
                  required
                  aria-label="代词"
                  maxLength={4}
                  value={card.pronoun}
                  placeholder="TA"
                  onChange={(e) => onChange({ pronoun: e.target.value })}
                />
              </FrameBox>
            </div>
          </div>
        </div>

        <div>
          <span className={wb.groupLabel}>战局难度 · 决定定制点数上限</span>
          <fieldset className={wb.btnStrip} aria-label="战局难度">
            {DIFFICULTIES.map((d) => (
              <Button
                key={d}
                small
                pressed={difficulty === d}
                reason={DIFFICULTY_NOTES[d]}
                onClick={() => setDifficulty(d)}
              >
                {DIFFICULTY_LABELS[d]} {DIFFICULTY_BUDGET[d]}点
              </Button>
            ))}
          </fieldset>
        </div>

        <span className={wb.hairline} style={hairlineStyle} aria-hidden />

        <button
          type="button"
          className={wb.navCard}
          data-empty={board.origin ? undefined : ""}
          aria-pressed={drawer.kind === "origin"}
          onClick={() => open({ kind: "origin" })}
        >
          <CellFrame />
          <span className={wb.navCardHead}>
            <span className={wb.cardEyebrow}>出身背景</span>
            <span className={wb.cardAction}>{board.origin ? "更换 →" : "必选 →"}</span>
          </span>
          <span className={wb.cardTitle}>{board.origin?.label ?? "尚未选择出身"}</span>
          <span className={wb.cardSub}>
            {board.origin
              ? board.origin.people.length > 0
                ? `故人：${board.origin.people.map((p) => p.name).join("、")}`
                : board.origin.ability
              : "决定开局自带义体、起步预算与人脉"}
          </span>
        </button>

        <button
          type="button"
          className={wb.navCard}
          aria-pressed={drawer.kind === "map"}
          onClick={() => open({ kind: "map" })}
        >
          <CellFrame />
          <span className={wb.navCardHead}>
            <span className={wb.cardEyebrow}>开局地点</span>
            <span className={wb.cardAction}>切换 →</span>
          </span>
          <span className={wb.cardTitle}>{locationName}</span>
          <span className={wb.cardSub}>{anchor?.kind ?? "在夜之城地图上选定开局位置"}</span>
        </button>

        <span className={wb.hairline} style={hairlineStyle} aria-hidden />

        <button
          type="button"
          className={wb.navCard}
          aria-pressed={drawer.kind === "loadout"}
          onClick={() => open({ kind: "loadout" })}
        >
          <CellFrame />
          <span className={wb.navCardHead}>
            <span className={wb.cardEyebrow}>开局行装</span>
            <span className={wb.cardAction}>调整 →</span>
          </span>
          <span className={wb.cardTitle}>
            {loadout.finalEddies} 欧元 · {CASH_TIER_INFO[board.kit.cashTier].label}
          </span>
          <span className={wb.cardSub}>
            {loadout.gearNames.length > 0 ? loadout.gearNames.slice(0, 3).join("、") : "标准行装"}
            {kit.spent + kit.refund > 0 &&
              ` · ${kit.spent - kit.refund >= 0 ? "花" : "返"} ${Math.abs(kit.spent - kit.refund)} 点`}
          </span>
        </button>

        <button
          type="button"
          className={wb.navCard}
          aria-pressed={drawer.kind === "people"}
          onClick={() => open({ kind: "people" })}
        >
          <CellFrame />
          <span className={wb.navCardHead}>
            <span className={wb.cardEyebrow}>夜之城人脉</span>
            <span className={wb.cardAction}>挑选 →</span>
          </span>
          <span className={wb.cardTitle}>
            {board.acquaintances.length > 0
              ? `已建立 ${board.acquaintances.length} 位旧识`
              : "暂无预设旧识"}
          </span>
          <span className={wb.cardSub}>
            {board.acquaintances.length > 0
              ? board.acquaintances
                  .slice(0, 4)
                  .map((a) => a.name)
                  .join("、")
              : "可选添加，否则在战局中自然结识"}
          </span>
        </button>
      </aside>

      {/* ———— 中栏：宽阔对称 2077 CyberDoll 主舞台 ———— */}
      <section className={wb.center} aria-label="角色与义体拓扑">
        <header className={wb.heroPlate}>
          <h2 className={wb.heroName}>
            {card.name.trim() || "未命名新秀"}
            {card.alias.trim() && <span className={wb.heroAlias}>「{card.alias.trim()}」</span>}
          </h2>
          <p className={wb.heroMeta}>
            {board.origin?.label ?? "尚未选择出身"} · {locationName}
          </p>
          <span className={wb.heroLine} style={hairlineStyle} aria-hidden />
        </header>

        <div className={wb.dollFrame}>
          <CyberDoll
            parts={parts}
            humanity={gauge}
            selected={drawer.kind === "cyber" ? drawer.slot : null}
            onCell={(slot, part) => {
              if (part && !inherentIds.has(part.id)) {
                commit({ ...board, cyberware: board.cyberware.filter((c) => c.id !== part.id) });
              }
              open({ kind: "cyber", slot });
            }}
          />
        </div>

        <div className={wb.centerFoot}>
          <fieldset className={wb.tolBar} aria-label="义体耐受">
            <span className={wb.cardEyebrow}>义体耐受</span>
            {TOLERANCES.map((t) => {
              const level = TOLERANCE_LEVELS[t];
              const pts = level.points;
              const tag = pts > 0 ? `-${pts}点` : pts < 0 ? `+${-pts}点` : "0点";
              return (
                <Button
                  key={t}
                  small
                  pressed={board.tolerance === t}
                  onClick={() => commit({ ...board, tolerance: t })}
                >
                  {level.label} {tag}
                </Button>
              );
            })}
          </fieldset>

          {(inherent.length > 0 || board.cyberware.length > 0) && (
            <ul className={wb.installedList} aria-label="已装义体">
              {inherent.map((c) => {
                const slot = c.slot as CyberSlot;
                return (
                  <li
                    key={`inh-${c.id}`}
                    className={wb.installedChip}
                    data-inherent=""
                    title={`${c.source}自带 · 0 点${c.replaced ? "（已被自选件顶替）" : ""}`}
                  >
                    <CellFrame />
                    <button
                      type="button"
                      className={wb.installedLink}
                      onClick={() => open({ kind: "cyber", slot })}
                    >
                      <span className={wb.chipMuted}>{CYBER_LABELS[slot]}</span>
                      <span>{c.name}</span>
                      <span className={wb.chipMuted}>{c.replaced ? "已顶替" : "自带"}</span>
                    </button>
                  </li>
                );
              })}
              {board.cyberware.map((c) => {
                const slot = slotOf.get(c.id) ?? (c.slot as CyberSlot | undefined) ?? "os";
                return (
                  <li key={c.id} className={wb.installedChip}>
                    <CellFrame />
                    <button
                      type="button"
                      className={wb.installedLink}
                      onClick={() => open({ kind: "cyber", slot })}
                    >
                      <span className={wb.chipMuted}>{CYBER_LABELS[slot]}</span>
                      <span>{c.name}</span>
                      <span className={wb.chipMuted}>{c.points}点</span>
                    </button>
                    <button
                      type="button"
                      className={wb.chipDrop}
                      aria-label={`卸下${c.name}`}
                      onClick={() =>
                        commit({
                          ...board,
                          cyberware: board.cyberware.filter((x) => x.id !== c.id),
                        })
                      }
                    >
                      ×
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      {/* ———— 右栏：map.panel 原作斜切工作卡 ———— */}
      <aside className={wb.right} aria-label="角色定制工作表">
        <NineSlice
          id="map.panelBg"
          tint="rgb(10 10 18 / 86%)"
          slice={SHEET_SLICE}
          className={wb.sheetLayer}
        />
        <NineSlice
          id="map.panelFg"
          tint="var(--cp-red-dim)"
          slice={SHEET_SLICE}
          className={wb.sheetLayer}
        />

        {/* CK3 定制点数池 */}
        <div className={wb.meter} role="status">
          <div className={wb.meterHead}>
            <span>
              定制点数{" "}
              <span className={wb.meterVal} data-over={budget.overLimit || undefined}>
                {budget.netSpent}
              </span>{" "}
              / {budget.limit}
            </span>
            <span className={wb.badge} data-over={budget.overLimit || undefined}>
              {budget.overLimit ? `超出 ${-budget.remaining} 点 · 传奇沙盒` : "标准合规构筑"}
            </span>
            <span>
              人性 <strong>{humanityNow}</strong>/{humanityRules.HUMANITY_MAX}
            </span>
          </div>
          <div className={wb.meterTrack} aria-hidden="true">
            <span
              className={wb.meterFill}
              data-over={budget.overLimit || undefined}
              style={{ width: `${Math.min(100, (budget.netSpent / budget.limit) * 100)}%` }}
            />
          </div>
          <div className={wb.meterFoot}>
            <p className={wb.meterNote}>
              特质{budget.traitSpent} · 义体{budget.cyberwareSpent} · 人脉{budget.peopleSpent} ·
              行装{budget.kitSpent}
              {budget.refund > 0 && ` · 返+${budget.refund}`}
              {budget.remaining >= 0 && ` · 余${budget.remaining}点`}
            </p>
            {checks.length > 0 && (
              <ul className={wb.checks}>
                {checks.map((c) => (
                  <li key={c.text}>{c.text}</li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* 原作 tab.bg 顶栏 + tab.line 分割线 */}
        <div className={wb.sheetNav}>
          <nav className={neural.tabs} aria-label="定制板块">
            <button
              type="button"
              className={neural.tab}
              aria-pressed={primaryTab === "build"}
              onClick={() => open({ kind: "build" })}
            >
              <NineSlice id="tab.bg" tint="currentColor" slice={14} className={neural.tabBg} />
              <span className={neural.inner}>能力与特质</span>
            </button>
            <button
              type="button"
              className={neural.tab}
              aria-pressed={primaryTab === "cyber"}
              onClick={() => open({ kind: "cyber", slot: lastCyberSlot })}
            >
              <NineSlice id="tab.bg" tint="currentColor" slice={14} className={neural.tabBg} />
              <span className={neural.inner}>义体货架</span>
            </button>
            <button
              type="button"
              className={neural.tab}
              aria-pressed={primaryTab === "person"}
              onClick={() => open({ kind: "person" })}
            >
              <NineSlice id="tab.bg" tint="currentColor" slice={14} className={neural.tabBg} />
              <span className={neural.inner}>AI 人设</span>
            </button>
          </nav>
          <span className={neural.tabLine} style={hairlineStyle} aria-hidden />
        </div>

        <div className={wb.drawerBody}>
          <fieldset className={styles.fields} disabled={busy}>
            {subTitle && (
              <div className={wb.subHead}>
                <span className={wb.subTitle}>{subTitle}</span>
                <Button small onClick={() => open({ kind: "build" })}>
                  ← 返回总览
                </Button>
              </div>
            )}

            {drawer.kind === "build" && (
              <div className={wb.buildStack}>
                <div className={wb.slotBlock}>
                  <div className={wb.slotHead}>
                    <h3 className={wb.slotTitle}>角色特质</h3>
                    <span className={wb.slotTools}>
                      <Button
                        small
                        onClick={() => commit(rollTraits(board, data.modules, Math.random))}
                      >
                        随机
                      </Button>
                      <Button small onClick={() => open({ kind: "traits" })}>
                        ＋ 挑选
                      </Button>
                    </span>
                  </div>
                  <ul className={wb.chips}>
                    {traits.length === 0 && (
                      <li className={wb.empty}>未装备特质（0 项也可开局）</li>
                    )}
                    {traits.map((m) => (
                      <li key={m.id} className={wb.chip} title={m.ability}>
                        <CellFrame />
                        <span>{m.label}</span>
                        <span className={wb.chipMuted}>{m.points}点</span>
                        <button
                          type="button"
                          className={wb.chipDrop}
                          aria-label={`拔下${m.label}`}
                          onClick={() =>
                            commit({
                              ...board,
                              pasts: board.pasts.filter((x) => x.id !== m.id),
                              skills: board.skills.filter((x) => x.id !== m.id),
                            })
                          }
                        >
                          ×
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className={wb.slotBlock}>
                  <div className={wb.slotHead}>
                    <h3 className={wb.slotTitle}>
                      负面缺陷 <span className={wb.slotSub}>返还定制点数</span>
                    </h3>
                    <Button small onClick={() => open({ kind: "flaws" })}>
                      ＋ 挑选
                    </Button>
                  </div>
                  <ul className={wb.chips}>
                    {board.flaws.length === 0 && <li className={wb.empty}>无负面缺陷</li>}
                    {board.flaws.map((m) => (
                      <li key={m.id} className={wb.chip} data-flaw="" title={m.ability}>
                        <CellFrame />
                        <span>{m.label}</span>
                        <span className={wb.chipMuted}>+{m.points}点</span>
                        <button
                          type="button"
                          className={wb.chipDrop}
                          aria-label={`撤回${m.label}`}
                          onClick={() =>
                            commit({ ...board, flaws: board.flaws.filter((x) => x.id !== m.id) })
                          }
                        >
                          ×
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>

                <span className={wb.hairline} style={hairlineStyle} aria-hidden />

                <button
                  type="button"
                  className={wb.navCard}
                  onClick={() => open({ kind: "person" })}
                >
                  <CellFrame />
                  <span className={wb.navCardHead}>
                    <span className={wb.cardEyebrow}>角色传记 · 外貌 · 性格 · 语态</span>
                    <span className={wb.cardAction}>撰写 / AI 生成 →</span>
                  </span>
                  <span className={wb.cardTitle}>AI 人设（已填 {filledBrief} / 4 项）</span>
                  <span className={wb.cardSub}>
                    {briefSnippet || "点击打开独立编辑页填写或由 AI 一键生成人物生平"}
                  </span>
                </button>
              </div>
            )}

            {drawer.kind === "origin" && <OriginPicker {...props} />}
            {drawer.kind === "traits" && <TraitPicker board={board} data={data} commit={commit} />}
            {drawer.kind === "flaws" && <FlawPicker board={board} data={data} commit={commit} />}
            {drawer.kind === "loadout" && <LoadoutPicker {...props} />}
            {drawer.kind === "people" && <PeoplePicker board={board} data={data} commit={commit} />}
            {drawer.kind === "map" && (
              <StartMapPicker
                value={startLocation}
                defaultStart={originDefault}
                onChange={pickLocation}
              />
            )}
            {drawer.kind === "cyber" && (
              <>
                <fieldset className={wb.slotRibbon} aria-label="选择义体部位">
                  {CYBER_SLOTS.map((slot) => (
                    <button
                      key={slot}
                      type="button"
                      className={styles.shelfChip}
                      aria-pressed={drawer.slot === slot}
                      onClick={() => open({ kind: "cyber", slot })}
                    >
                      {CYBER_LABELS[slot]}
                    </button>
                  ))}
                </fieldset>
                <CyberwareShelf {...props} slot={drawer.slot} />
              </>
            )}
            {drawer.kind === "person" && (
              <>
                <DraftAll card={card} onChange={onChange} />
                <div className={styles.proseBlocks}>
                  {BRIEF_BLOCKS.map((block) => (
                    <ProseField key={block} block={block} card={card} onChange={onChange} />
                  ))}
                </div>
              </>
            )}
          </fieldset>
        </div>
      </aside>

      {/* ———— 底栏：极简一字工具条 ———— */}
      <footer className={wb.bar}>
        <div className={wb.barActions}>
          <Button
            small
            primary
            disabled={busy || !parsed.success}
            reason={reason}
            onClick={() => {
              if (parsed.success) {
                void onSave(parsed.data).then(
                  () => clearDraft(),
                  () => undefined,
                );
              }
            }}
          >
            {saving && !launch.isPending ? "正在写入…" : "保存档案"}
          </Button>
          {onExport && (
            <Button small disabled={busy} onClick={onExport}>
              导出角色卡
            </Button>
          )}
          {onDelete && (
            <Button small disabled={busy} onClick={onDelete}>
              删除
            </Button>
          )}
          {saveError ? (
            <span className={styles.error} role="alert">
              {saveError}
            </span>
          ) : launch.isError ? (
            <span className={styles.error} role="alert">
              {launch.error.message}
            </span>
          ) : saved && !launch.isPending ? (
            <span className={styles.success} role="status">
              角色档案已保存
            </span>
          ) : draftable ? (
            <span className={wb.statusHint}>
              {draftStored ? "改动已自动暂存在本机草稿" : "本机无法存草稿"}
            </span>
          ) : null}
        </div>

        <div className={wb.launchRow}>
          <FrameBox className={wb.titleBox}>
            <input
              aria-label="战局代号"
              maxLength={40}
              value={title}
              placeholder={`${card.name.trim() || "夜之城游民"}的档案`}
              onChange={(e) => setTitle(e.target.value)}
            />
          </FrameBox>
          <Button
            primary
            disabled={busy || !parsed.success}
            reason={reason}
            onClick={() => launch.mutate()}
          >
            {launch.isPending ? "正在初始化…" : "保存并开启战局"}
          </Button>
        </div>
      </footer>
    </div>
  );
}
