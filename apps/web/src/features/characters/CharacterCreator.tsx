import {
  ATTRIBUTE_BASE,
  ATTRIBUTE_CREATE_MAX,
  ATTRIBUTE_POINTS,
  type Board,
  boardBudget,
  boardCombos,
  type CharacterCard,
  CharacterCardSchema,
  pointsSpent,
  pruneAcquaintances,
} from "@cp/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { api, type BoardData, type CharacterEntry, type Difficulty } from "../../api/client";
import { DIFFICULTY_LABELS, DIFFICULTY_NOTES } from "../../labels";
import { cssUrl, NineSlice } from "../../ui/Asset";
import { Button } from "../../ui/Button";
import neural from "../story/neural.module.css";
import { StepAttributes, StepPast, StepPeople } from "./CreatorLife";
import { StepCyberware, StepOrigin, StepReview, StepSkills } from "./CreatorSteps";
import styles from "./characters.module.css";
import {
  budgetKind,
  clearDraft,
  creatorChecks,
  STEPS,
  type StepId,
  saveDraft,
  stepIndex,
} from "./creator";
import { DraftAll } from "./DraftAll";
import { ProseField } from "./ProseField";
import { DEFAULT_START, startAnchor } from "./StartMapPicker";

/**
 * 分步捏人的外壳（docs/creator-plan.md "界面形式"）：左边进度栏能点回走过的步，底部固定上一步、下一步，
 * 点数条只在用到点数的步骤顶上显示，新角色的草稿存在本地。
 * 1 出身、4 本事、5 义体、8 档案确认在 CreatorSteps.tsx（本事和义体拆成两步，用户 2026-10-31："本事和义体分开两块"）；
 * 2 过往、3 旧识、6 属性在 CreatorLife.tsx（第二期）；
 * 6 这个人在本文件，一键成稿是第三期
 */

const BRIEF_BLOCKS = ["look", "past", "personality", "voice"] as const;

export interface CreatorStart {
  readonly step: StepId;
  readonly reached: number;
  readonly startLocation: string;
  /** 生命路径已经用掉的重掷次数 */
  readonly rerolls: number;
}

export function CharacterCreator({
  card,
  data,
  onChange,
  start,
  draftable,
  saving,
  saveError,
  saved,
  onSave,
}: {
  readonly card: CharacterCard & { readonly board: Board };
  readonly data: BoardData;
  readonly onChange: (patch: Partial<CharacterCard>) => void;
  /** 打开时停在哪一步：新角色从出身开始，已保存的角色停在档案确认，草稿接着上次 */
  readonly start: CreatorStart;
  /** 还没进角色库的新角色：改动存成本地草稿 */
  readonly draftable: boolean;
  readonly saving: boolean;
  readonly saveError: string | null;
  readonly saved: boolean;
  /** 存进角色库；失败时抛错 */
  readonly onSave: (card: CharacterCard) => Promise<CharacterEntry>;
}) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const [step, setStep] = useState<StepId>(start.step);
  const [reached, setReached] = useState(start.reached);
  const [startLocation, setStartLocation] = useState(
    startAnchor(start.startLocation) ? start.startLocation : DEFAULT_START,
  );
  const [rerolls, setRerolls] = useState(start.rerolls);
  const [title, setTitle] = useState("");
  const [difficulty, setDifficulty] = useState<Difficulty>("nightCity");
  const root = useRef<HTMLDivElement>(null);
  const board = card.board;
  const index = stepIndex(step);
  const parsed = CharacterCardSchema.safeParse(card);
  const checks = creatorChecks(card);

  // 草稿有没有存上：存不下（隐私模式、空间满）时页脚不能再写"草稿自动存在本机"
  const [draftStored, setDraftStored] = useState(true);
  useEffect(() => {
    if (draftable) setDraftStored(saveDraft({ card, step, reached, startLocation, rerolls }));
  }, [draftable, card, step, reached, startLocation, rerolls]);

  const goTo = (next: StepId) => {
    const i = stepIndex(next);
    setStep(next);
    setReached((r) => Math.max(r, i));
    // 换步后回到这一步的开头；不做平滑滚动，免得和 reduced-motion 冲突
    root.current?.scrollIntoView({ block: "start" });
  };

  /**
   * 改主板：联动按联动表重算（存卡时服务端还会再算一次）；拔掉模块后它带出的人从旧识里去掉，
   * 免得留着已经不存在的人还占着背景点
   */
  const commit = (next: Board, origin?: string) => {
    const pruned = pruneAcquaintances(next, data.npcs);
    const combos = boardCombos(pruned, data.combos).map(({ requires: _, ...combo }) => combo);
    onChange({ board: { ...pruned, combos }, ...(origin ? { origin } : {}) });
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

  const props = { card, board, data, commit, change: onChange, onJump: goTo };
  const kind = budgetKind(step);
  const budget = boardBudget(board);
  const attrLeft = ATTRIBUTE_POINTS - pointsSpent(card.attributes);

  return (
    <div className={styles.creator} ref={root}>
      {/* 步骤页签：自由切换，无强制顺序限制 */}
      <nav className={styles.rail} aria-label="捏人步骤">
        <ol>
          {STEPS.map((s, i) => (
            <li key={s.id}>
              <button
                type="button"
                className={`${neural.tab} ${styles.railStep}`}
                aria-pressed={s.id === step}
                aria-current={s.id === step ? "step" : undefined}
                data-done={i < reached || undefined}
                disabled={busy}
                onClick={() => goTo(s.id)}
              >
                <NineSlice id="tab.bg" tint="currentColor" slice={14} className={neural.tabBg} />
                <span className={neural.inner}>
                  <span className={styles.railNum}>{String(i + 1).padStart(2, "0")}</span>
                  {s.label}
                </span>
              </button>
            </li>
          ))}
        </ol>
        <span
          className={neural.tabLine}
          style={{ maskImage: cssUrl("tab.line"), WebkitMaskImage: cssUrl("tab.line") }}
          aria-hidden
        />
      </nav>

      <div className={styles.stepBody}>
        {kind === "background" && (
          <div className={styles.budget} role="status">
            <span data-tone={budget.remaining < 0 ? "bad" : undefined}>
              背景点剩余 <b>{budget.remaining}</b> / {budget.total}
            </span>
            <span>
              花了 {budget.spent} · 返还 {budget.refund}
              {budget.wasted > 0 && `（负面经历超出上限的 ${budget.wasted} 点不算）`}
            </span>
          </div>
        )}
        {kind === "attributes" && (
          <div className={styles.budget} role="status">
            <span data-tone={attrLeft < 0 ? "bad" : undefined}>
              属性点剩余 <b>{attrLeft}</b> / {ATTRIBUTE_POINTS}
            </span>
            <span>
              各项从 {ATTRIBUTE_BASE} 起步，创建时单项最高 {ATTRIBUTE_CREATE_MAX}
            </span>
          </div>
        )}

        <h2 className={styles.stepHeading}>
          <span className={styles.railNum}>{String(index + 1).padStart(2, "0")}</span>
          {STEPS[index]?.label}
        </h2>

        <fieldset className={styles.fields} disabled={busy}>
          {step === "origin" && <StepOrigin {...props} />}
          {step === "past" && (
            <StepPast {...props} rerolls={rerolls} onReroll={() => setRerolls((r) => r + 1)} />
          )}
          {step === "people" && <StepPeople {...props} />}
          {step === "skills" && <StepSkills {...props} />}
          {/* 义体单独一步（用户 2026-10-31："本事和义体分开两块"） */}
          {step === "cyberware" && <StepCyberware {...props} />}
          {step === "attributes" && <StepAttributes card={card} board={board} change={onChange} />}
          {step === "person" && <StepPerson card={card} change={onChange} />}
          {step === "review" && (
            <StepReview
              card={card}
              board={board}
              change={onChange}
              checks={checks}
              onJump={goTo}
              startLocation={startLocation}
              onStartLocation={setStartLocation}
              actions={
                <section className={styles.actions} aria-label="保存">
                  <div className={styles.launch}>
                    <label className={styles.field}>
                      <span>战局代号 / 存档标题</span>
                      <input
                        maxLength={40}
                        value={title}
                        placeholder={`${card.name.trim() || "夜之城游民"}的档案`}
                        onChange={(e) => setTitle(e.target.value)}
                      />
                    </label>
                    {/* 原生单选框（biome useSemanticElements）；难度说明照主菜单开新档用的 DIFFICULTY_NOTES */}
                    <fieldset className={styles.difficultyRow}>
                      <legend>难度</legend>
                      {(Object.keys(DIFFICULTY_LABELS) as Difficulty[]).map((d) => (
                        <label
                          key={d}
                          title={DIFFICULTY_NOTES[d]}
                          data-checked={difficulty === d || undefined}
                        >
                          <input
                            type="radio"
                            className={styles.radio}
                            name="creator-difficulty"
                            checked={difficulty === d}
                            onChange={() => setDifficulty(d)}
                          />
                          {DIFFICULTY_LABELS[d]}
                        </label>
                      ))}
                    </fieldset>
                  </div>
                  <p className={styles.note}>修改或删除角色卡不会改写已有战局存档中的角色数据。</p>
                  {saveError && (
                    <p className={styles.error} role="alert">
                      {saveError}
                    </p>
                  )}
                  {launch.isError && (
                    <p className={styles.error} role="alert">
                      {launch.error.message}
                    </p>
                  )}
                  {saved && !launch.isPending && (
                    <p className={styles.success} role="status">
                      角色档案已保存，可随时用于开启新战局。
                    </p>
                  )}
                  <div className={styles.buttons}>
                    <Button
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
                      {saving && !launch.isPending ? "正在写入数据…" : "保存档案"}
                    </Button>
                    <Button
                      disabled={busy || !parsed.success}
                      reason={reason}
                      onClick={() => launch.mutate()}
                    >
                      {launch.isPending ? "正在初始化战局…" : "保存并开启新战局"}
                    </Button>
                  </div>
                </section>
              }
            />
          )}
        </fieldset>

        <footer className={styles.stepNav}>
          <Button
            disabled={index === 0 || busy}
            onClick={() => {
              const prev = STEPS[index - 1];
              if (prev) goTo(prev.id);
            }}
          >
            上一步
          </Button>
          <span className={styles.note}>
            {index + 1} / {STEPS.length}
            {draftable &&
              (draftStored ? " · 草稿自动存在本机" : " · 本机存不下草稿，关掉页面就没了")}
          </span>
          {index < STEPS.length - 1 && (
            <Button
              primary
              disabled={busy}
              onClick={() => {
                const next = STEPS[index + 1];
                if (next) goTo(next.id);
              }}
            >
              下一步：{STEPS[index + 1]?.label}
            </Button>
          )}
        </footer>
      </div>
    </div>
  );
}

// ———— 第 7 步（本事和义体拆开后顺延一步，用户 2026-10-31） ————

/** 第 7 步：名字、外号、代词和四块正文；可以一键成稿，也能逐块写（不做问答："不要搞回答"） */
function StepPerson({
  card,
  change,
}: {
  readonly card: CharacterCard;
  readonly change: (patch: Partial<CharacterCard>) => void;
}) {
  return (
    <>
      <div className={styles.identity}>
        <label className={styles.field}>
          <span>姓名 *</span>
          <input
            required
            maxLength={20}
            value={card.name}
            autoComplete="off"
            onChange={(e) => change({ name: e.target.value })}
          />
        </label>
        <label className={styles.field}>
          <span>外号</span>
          <input
            maxLength={20}
            value={card.alias}
            onChange={(e) => change({ alias: e.target.value })}
          />
        </label>
        <label className={styles.field}>
          <span>代词</span>
          <input
            required
            maxLength={4}
            value={card.pronoun}
            placeholder="他 / 她 / TA"
            onChange={(e) => change({ pronoun: e.target.value })}
          />
        </label>
        <div className={styles.field}>
          <span>出身</span>
          <span className={styles.points}>{card.origin}</span>
        </div>
      </div>
      {/* 一键成稿（第三期，用户定的 2026-10-30）：玩家点了才调模型 */}
      <DraftAll card={card} onChange={change} />
      {/* 逐块写的说明删掉（用户 2026-10-31："解释性说明一大堆"）；每块的按钮自己会说明 */}
      <div className={styles.proseBlocks}>
        {BRIEF_BLOCKS.map((block) => (
          <ProseField key={block} block={block} card={card} onChange={change} />
        ))}
        <label className={styles.field}>
          <span>
            特长补充说明（可选）
            <small>{card.skills.length} / 400</small>
          </span>
          <textarea
            rows={3}
            maxLength={400}
            value={card.skills}
            placeholder="除核心特长外想要补充的实战习惯与技能底子（如专精武器、黑客流派、实战短板等）。"
            onChange={(e) => change({ skills: e.target.value })}
          />
        </label>
      </div>
    </>
  );
}
