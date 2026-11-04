import {
  BOARD_SLOT_LABELS,
  type Board,
  type BoardModule,
  boardBudget,
  boardHumanityCost,
  type CharacterCard,
  cyberwareRules,
  diceRules,
  humanityRules,
  PROSE_BLOCK_INFO,
  SKILL_MAX,
  SKILL_MIN,
  TOLERANCE_LEVELS,
} from "@cp/core";
import { type ReactNode, useState } from "react";
import type { BoardData } from "../../api/client";
import { Button } from "../../ui/Button";
import { CellFrame } from "../../ui/FrameBox";
import {
  CYBER_LABELS,
  CyberDoll,
  CyberItemCell,
  type CyberSlot,
  type DollPart,
} from "../story/CyberDoll";
import { CustomModuleForm } from "./CustomModuleForm";
import styles from "./characters.module.css";
import {
  applyOriginPreset,
  type Check,
  comboHints,
  isAnyOriginPreset,
  isOriginPreset,
  ORIGIN_PRESETS,
  type OriginKey,
  type OriginPreset,
  originLean,
  originNever,
  type StepId,
} from "./creator";
import { ProseField } from "./ProseField";
import { StartMapPicker } from "./StartMapPicker";

/**
 * 分步捏人第一期的几步（docs/creator-plan.md 分期第 1 条）：1 出身、4 本事、5 义体、8 档案确认
 * （本事和义体原来同在第 4 步，用户 2026-10-31："本事和义体分开两块"）。
 * 规则、点数、服务端 normalizeBoard 都不改；这里只换排法
 */

export interface StepProps {
  readonly card: CharacterCard;
  readonly board: Board;
  readonly data: BoardData;
  /** 改主板：联动由外壳重算；origin 是换了出身时名片上跟着变的字 */
  readonly commit: (board: Board, origin?: string) => void;
  readonly change: (patch: Partial<CharacterCard>) => void;
  readonly onJump?: (step: StepId) => void;
}

type Attribute = keyof CharacterCard["attributes"];
const ATTR = diceRules.ATTRIBUTE_LABELS as Readonly<Record<Attribute, string>>;

const people = (m: BoardModule) =>
  m.people.map((p) => (p.role ? `${p.name}（${p.role}）` : p.name)).join("、");

/** 卡片上一行带小标题的说明；第 2、3、5 步（CreatorLife.tsx）也用 */
export function Line({ k, children }: { readonly k: string; readonly children: ReactNode }) {
  return (
    <span className={styles.pickLine}>
      <b className={styles.pickKey}>{k}</b>
      <span>{children}</span>
    </span>
  );
}

// ———— 第 1 步：出身 ————

/** 三张出身大卡加"自己写"：能力、钩子、带出的人，以及按生命路径权重更容易掷到哪些过往 */
export function StepOrigin({ card, board, data, commit, change, onJump }: StepProps) {
  const [writing, setWriting] = useState(false);
  const origins = data.modules.filter((m) => m.slot === "origin");
  const custom = board.origin?.custom ? board.origin : null;

  const handleSelectOrigin = (m: BoardModule) => {
    if (ORIGIN_PRESETS[m.id as OriginKey]) {
      if ((board.pasts.length === 0 && board.skills.length === 0) || isAnyOriginPreset(board)) {
        const updated = applyOriginPreset(m.id, card, data.modules, data.combos);
        change({
          origin: m.label,
          attributes: updated.attributes,
          board: updated.board,
        });
        return;
      }
    }
    commit({ ...board, origin: m }, m.label);
  };

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
            placeholder="例如：文森特 / 瓦莱丽"
            onChange={(e) => change({ name: e.target.value })}
          />
        </label>
        <label className={styles.field}>
          <span>外号</span>
          <input
            maxLength={20}
            value={card.alias}
            placeholder="江湖代号 / 街头称呼"
            onChange={(e) => change({ alias: e.target.value })}
          />
        </label>
        <label className={styles.field}>
          <span>代词 *</span>
          <input
            required
            maxLength={4}
            value={card.pronoun}
            placeholder="他 / 她 / TA"
            onChange={(e) => change({ pronoun: e.target.value })}
          />
        </label>
      </div>

      <ul className={styles.originGrid}>
        {origins.map((m) => {
          const lean = originLean(m.id, data.lifepath, data.modules);
          const never = originNever(m.id, data.lifepath, data.modules);
          const preset = ORIGIN_PRESETS[m.id as OriginKey] as OriginPreset | undefined;
          return (
            <li key={m.id}>
              <button
                type="button"
                className={styles.pick}
                data-big=""
                aria-pressed={board.origin?.id === m.id}
                onClick={() => handleSelectOrigin(m)}
              >
                {/* 原作 map.filterCell 框（用户 2026-10-30 嫌"没有排版"），框色走 .pick 上的 --box-line */}
                <CellFrame />
                <span className={styles.pickHead}>
                  <strong className={styles.pickName}>{m.label}</strong>
                  {m.points > 0 && <span className={styles.modulePoints}>{m.points} 点</span>}
                </span>
                {m.tags.length > 0 && (
                  <span className={styles.moduleTags}>{m.tags.join(" · ")}</span>
                )}
                {m.ability && <Line k="专长能力">{m.ability}</Line>}
                {m.hook && <Line k="剧情钩子">{m.hook}</Line>}
                {m.people.length > 0 && <Line k="关联人脉">{people(m)}</Line>}
                {lean.length > 0 && (
                  <Line k="高契合过往">{lean.map((l) => `「${l.label}」`).join("")}</Line>
                )}
                {never.length > 0 && (
                  <Line k="不相容经历">{never.map((l) => `「${l.label}」`).join("")}</Line>
                )}
                {preset && (
                  <div className={styles.presetBox}>
                    <span className={styles.presetTitle}>流派构筑：{preset.name}</span>
                    {board.origin?.id === m.id && (
                      <span className={styles.presetStatus}>
                        {isOriginPreset(m.id, board) ? (
                          <span className={styles.presetActive}>✓ 已装配此流派构筑</span>
                        ) : (
                          <span>（已自定义微调）</span>
                        )}
                      </span>
                    )}
                  </div>
                )}
              </button>
            </li>
          );
        })}
        <li>
          {custom ? (
            <div className={styles.pick} data-big="" data-on="">
              <CellFrame />
              <span className={styles.pickHead}>
                <strong className={styles.pickName}>{custom.label}</strong>
                <span className={styles.modulePoints}>自定义 · {custom.points} 点</span>
              </span>
              {custom.ability && <Line k="专长能力">{custom.ability}</Line>}
              {custom.hook && <Line k="剧情钩子">{custom.hook}</Line>}
              {custom.people.length > 0 && <Line k="关联人脉">{people(custom)}</Line>}
              <span className={styles.pickTools}>
                <Button small disabled={writing} onClick={() => setWriting(true)}>
                  重新编辑
                </Button>
              </span>
            </div>
          ) : (
            <button
              type="button"
              className={styles.pick}
              data-big=""
              data-blank=""
              aria-pressed={writing}
              onClick={() => setWriting(true)}
            >
              <CellFrame />
              <span className={styles.pickHead}>
                <strong className={styles.pickName}>自定义出身</strong>
              </span>
              <span>自由撰写设定背景，交由模型智能解析为专属模块</span>
            </button>
          )}
        </li>
      </ul>
      {writing && (
        <CustomModuleForm
          slot="origin"
          board={board}
          onCancel={() => setWriting(false)}
          onAccept={(m) => {
            commit({ ...board, origin: m }, m.label);
            setWriting(false);
          }}
        />
      )}
      {board.origin && (
        <aside className={styles.quickStartBar} aria-label="构筑状态">
          <div className={styles.quickStartInfo}>
            <strong className={styles.quickReadyBadge}>
              {card.name.trim() ? `【${card.name}】基础构筑就绪` : "构筑合规就绪（请填入姓名）"}
            </strong>
            <p>
              已搭载完整的出身背景、过往履历、特长技能与属性点。你可以随时点击上方页签深度微调，或直接前往确认档案开启战局。
            </p>
          </div>
          <div className={styles.quickStartActions}>
            {board.origin &&
              ORIGIN_PRESETS[board.origin.id as OriginKey] &&
              !isOriginPreset(board.origin.id, board) && (
                <Button
                  type="button"
                  onClick={() => {
                    if (!board.origin) return;
                    const updated = applyOriginPreset(
                      board.origin.id,
                      card,
                      data.modules,
                      data.combos,
                    );
                    change({
                      origin: board.origin.label,
                      attributes: updated.attributes,
                      board: updated.board,
                    });
                  }}
                >
                  载入【{ORIGIN_PRESETS[board.origin.id as OriginKey]?.name}】预设构筑
                </Button>
              )}
            <Button
              type="button"
              primary
              disabled={!card.name.trim()}
              onClick={() => onJump?.("review")}
            >
              直接前往【档案确认】启程
            </Button>
            <Button type="button" onClick={() => onJump?.("skills")}>
              微调特长与属性
            </Button>
          </div>
        </aside>
      )}
    </>
  );
}

// ———— 第 4 步：本事（义体拆到第 5 步，用户 2026-10-31："本事和义体分开两块"） ————

/** 耐受写成人话（计划第 4 步："装义体掉的人性 ×0.5，代价：公司研究员盯上你"） */
function toleranceText(t: Board["tolerance"]) {
  const level = TOLERANCE_LEVELS[t];
  const f = humanityRules.TOLERANCE_FACTOR[t];
  const loss =
    f === 1
      ? "装义体掉的人性照常算"
      : `装义体掉的人性 ×${f}，${f < 1 ? "少掉" : "多掉"} ${Math.round(Math.abs(1 - f) * 100)}%`;
  const price =
    level.points > 0
      ? `花 ${level.points} 点`
      : level.points < 0
        ? `返还 ${-level.points} 点`
        : "不花点数";
  return { label: level.label, loss, price, hook: level.hook };
}

const TOLERANCES: readonly Board["tolerance"][] = ["low", "normal", "high"];

export function StepSkills({ board, data, commit }: StepProps) {
  const [writing, setWriting] = useState(false);
  const left = boardBudget(board).remaining;
  const library = data.modules.filter((m) => m.slot === "skill");
  const ownWritten = board.skills.filter((m) => !library.some((l) => l.id === m.id));
  const on = new Set(board.skills.map((m) => m.id));
  const full = board.skills.length >= SKILL_MAX;
  const hints = comboHints(board, data.combos, data.modules);

  const toggle = (m: BoardModule) =>
    commit(
      on.has(m.id)
        ? { ...board, skills: board.skills.filter((x) => x.id !== m.id) }
        : { ...board, skills: [...board.skills, m] },
    );

  return (
    <>
      <h3 className={styles.stepTitle}>
        特长{" "}
        <small className={styles.stepNote}>
          {board.skills.length} / {SKILL_MAX}
          {board.skills.length < SKILL_MIN && ` · 至少选择 ${SKILL_MIN} 项`}
        </small>
      </h3>
      {hints.length > 0 && (
        <ul className={styles.hints} aria-label="待激活的联动组合">
          {hints.map((h) => (
            <li key={h.combo.id}>
              再配置{h.candidates.map((c) => `「${c.label}」`).join("或")} → 解锁「{h.combo.label}
              」：{h.combo.ability}
            </li>
          ))}
        </ul>
      )}
      <ul className={styles.skillWall}>
        {[...library, ...ownWritten].map((m) => {
          const pressed = on.has(m.id);
          const short = !pressed && m.points > left;
          return (
            <li key={m.id}>
              <button
                type="button"
                className={styles.pick}
                aria-pressed={pressed}
                disabled={!pressed && (full || short)}
                title={
                  !pressed && full
                    ? `特长最多选择 ${SKILL_MAX} 项`
                    : short
                      ? "背景点不足"
                      : undefined
                }
                onClick={() => toggle(m)}
              >
                <CellFrame />
                <span className={styles.pickHead}>
                  <strong className={styles.pickName}>{m.label}</strong>
                  <span className={styles.modulePoints}>{m.points} 点</span>
                </span>
                {m.ability && <span>{m.ability}</span>}
                {m.checks.length > 0 && (
                  <Line k="检定优势">{m.checks.map((c) => ATTR[c]).join("、")}</Line>
                )}
                {m.tags.length > 0 && (
                  <span className={styles.moduleTags}>{m.tags.join(" · ")}</span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      <div className={styles.slotTools}>
        {!writing && (
          <Button small disabled={full} onClick={() => setWriting(true)}>
            自定义特长
          </Button>
        )}
      </div>
      {writing && (
        <CustomModuleForm
          slot="skill"
          board={board}
          onCancel={() => setWriting(false)}
          onAccept={(m) => {
            commit({ ...board, skills: [...board.skills, m] });
            setWriting(false);
          }}
        />
      )}
      {board.combos.length > 0 && (
        <ul className={styles.modules} aria-label="已经凑成的联动">
          {board.combos.map((c) => (
            <li className={styles.module} data-combo key={c.id}>
              <div className={styles.moduleHead}>
                <strong>联动 · {c.label}</strong>
              </div>
              <p>{c.ability}</p>
              {c.hook && <p className={styles.moduleHook}>钩子：{c.hook}</p>}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

// ———— 第 5 步：义体（用户 2026-10-31："本事和义体分开两块"，从原第 4 步拆出来） ————

export function StepCyberware({ board, data, commit }: StepProps) {
  const left = boardBudget(board).remaining;
  // ———— 开局义体：人体图（用户定的，2026-10-30："选择义体的界面要改成新的那个"） ————
  const slotOf = new Map(data.cyberware.map((o) => [o.id, o.slot as CyberSlot]));
  // 稀有度给格子左边竖条染色（用户 2026-10-31："怎么没有稀有度颜色区分"）
  const rarityOf = new Map(data.cyberware.map((o) => [o.id, o.rarity]));
  // 每个部位按原作格数装（用户 2026-10-31："为什么每个地方的义体只能选一个"），按装上的先后排
  const parts = new Map<CyberSlot, DollPart[]>();
  for (const c of board.cyberware) {
    const slot = slotOf.get(c.id);
    if (slot) {
      const rarity = rarityOf.get(c.id);
      parts.set(slot, [
        ...(parts.get(slot) ?? []),
        { id: c.id, name: c.name, ...(rarity ? { rarity } : {}) },
      ]);
    }
  }
  const cost = boardHumanityCost(board);
  // 人性条：开局人性上限 100 减去主板义体按耐受折算后的消耗（计划第 4 步），跟着耐受档位变
  const now = humanityRules.HUMANITY_MAX - cost;
  const humanity = {
    current: now,
    cap: humanityRules.HUMANITY_MAX,
    stageLabel: humanityRules.STAGE_LABELS[humanityRules.humanityStage(now)],
  };
  // 装上是往这个部位加一件；部位装满了要先卸一件（格数照原作，core 的 SLOT_CAPACITY），不再自动换下
  const install = (o: BoardData["cyberware"][number]) =>
    commit({
      ...board,
      cyberware: [
        ...board.cyberware,
        { id: o.id, name: o.name, points: o.points, humanityCost: o.humanityCost },
      ],
    });
  const uninstall = (id: string) =>
    commit({ ...board, cyberware: board.cyberware.filter((c) => c.id !== id) });

  /*
   * 用户 2026-10-31："这套创建角色UIUX还是太难看太难用了"，选了「照原作义体医生重做」：
   * 右边改成原作义体医生的货架，一格一格的义体图按稀有度筛；点一格在下面看详情，
   * 装上或卸下前后的背景点和人性写在一起对比；已装件数、人性、背景点收进货架顶上一行；
   * 耐受也收进货架，整步一屏放下，不再有第二条滚动条
   */
  const RARITY_ORDER = ["common", "uncommon", "rare", "epic", "legendary"] as const;
  const RARITY_LABELS: Readonly<Record<string, string>> = {
    common: "普通",
    uncommon: "罕见",
    rare: "稀有",
    epic: "史诗",
    legendary: "传说",
  };
  type Offer = BoardData["cyberware"][number];
  const [slot, setSlot] = useState<CyberSlot>("frontalCortex");
  const [rarity, setRarity] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const options = data.cyberware.filter((o) => o.slot === slot);
  const rarities = RARITY_ORDER.filter((r) => options.some((o) => o.rarity === r));
  const shown = rarity ? options.filter((o) => o.rarity === rarity) : options;
  const mounted = parts.get(slot) ?? [];
  const cap = cyberwareRules.SLOT_CAPACITY[slot];
  const slotFull = mounted.length >= cap;
  // 不再限总数（用户 2026-10-31："怎么装的义体数量有限制的"）：只看部位格数和背景点
  const isOn = (o: Offer) => mounted.some((p) => p.id === o.id);
  const blocked = (o: Offer) => !isOn(o) && (slotFull || o.points > left);
  const toggle = (o: Offer) => {
    if (isOn(o)) uninstall(o.id);
    else if (!blocked(o)) install(o);
  };
  const pickSlot = (s: CyberSlot) => {
    setSlot(s);
    setRarity(null);
    setPicked(null);
  };

  // 详情看的那件：悬停的、点过的、这个部位装着的第一件、列表第一件
  const focusId = hover ?? picked ?? mounted[0]?.id ?? shown[0]?.id;
  const item = options.find((o) => o.id === focusId) ?? shown[0];
  const itemOn = item ? isOn(item) : false;
  const toggled = item
    ? itemOn
      ? board.cyberware.filter((c) => c.id !== item.id)
      : [
          ...board.cyberware,
          { id: item.id, name: item.name, points: item.points, humanityCost: item.humanityCost },
        ]
    : board.cyberware;
  const nextHumanity =
    humanityRules.HUMANITY_MAX - boardHumanityCost({ ...board, cyberware: toggled });
  const nextLeft = item ? left + (itemOn ? item.points : -item.points) : left;
  const reason = slotFull ? `这个部位最多装 ${cap} 件，先卸一件` : "背景点不够";
  const tol = toleranceText(board.tolerance);

  return (
    <>
      <div className={styles.stepTip}>
        可选辅助模块：开局可利用背景点加装基础义体，也可肉身开局，后续可在夜之城义体医生处逐步升级改装。
      </div>
      <div className={styles.cyberStep}>
        {/* 套一层 pin 容器：人体图照剧情页加宽块的排法按这一栏的宽度缩放，不按全屏尺寸排（浏览器走查时发现被裁掉） */}
        <div className={styles.dollFrame}>
          <CyberDoll
            parts={parts}
            humanity={humanity}
            selected={slot}
            // 点空格选部位，点装着的格直接卸下（用户 2026-10-31："格子不能直接装卸"）
            onCell={(s, part) => {
              if (s !== slot) pickSlot(s);
              if (part) uninstall(part.id);
            }}
          />
        </div>
        <section className={styles.shelf} aria-label={`${CYBER_LABELS[slot]}能装的义体`}>
          <header className={styles.shelfHead}>
            <h3 className={styles.shelfTitle}>
              {CYBER_LABELS[slot]}{" "}
              <small className={styles.stepNote}>
                {mounted.length} / {cap}
              </small>
            </h3>
            <span className={styles.shelfStats}>
              <span>
                已装 <b className={styles.shelfNum}>{board.cyberware.length}</b> 件
              </span>
              <span>
                人性 <b className={styles.shelfNum}>{now}</b> / {humanityRules.HUMANITY_MAX}
              </span>
              <span>
                背景点 <b className={styles.shelfNum}>{left}</b>
              </span>
            </span>
          </header>
          {rarities.length > 1 && (
            <fieldset className={styles.shelfFilter} aria-label="按稀有度筛">
              <button
                type="button"
                className={styles.shelfChip}
                aria-pressed={rarity === null}
                onClick={() => setRarity(null)}
              >
                全部
              </button>
              {rarities.map((r) => (
                <button
                  key={r}
                  type="button"
                  className={styles.shelfChip}
                  data-rarity={r}
                  aria-pressed={rarity === r}
                  onClick={() => setRarity(r)}
                >
                  {RARITY_LABELS[r]}
                </button>
              ))}
            </fieldset>
          )}
          {options.length === 0 ? (
            <p className={styles.note}>开局没有能装的。</p>
          ) : (
            <ul className={styles.shelfGrid}>
              {shown.map((o) => (
                <li key={o.id}>
                  {/* 单击看详情，双击直接装上或卸下 */}
                  <button
                    type="button"
                    className={styles.shelfItem}
                    aria-pressed={o.id === item?.id}
                    aria-label={`${o.name}${isOn(o) ? "（已装）" : ""}`}
                    title={o.name}
                    data-short={blocked(o) || undefined}
                    onMouseEnter={() => setHover(o.id)}
                    onMouseLeave={() => setHover(null)}
                    onFocus={() => setHover(o.id)}
                    onBlur={() => setHover(null)}
                    onClick={() => setPicked(o.id)}
                    onDoubleClick={() => toggle(o)}
                  >
                    <CyberItemCell id={o.id} name={o.name} on={isOn(o)} rarity={o.rarity} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {item && (
            <article className={styles.shelfDetail}>
              <CellFrame />
              <span className={styles.pickHead}>
                <strong className={styles.pickName}>{item.name}</strong>
                {item.rarity && (
                  <span className={styles.shelfRarity} data-rarity={item.rarity}>
                    {RARITY_LABELS[item.rarity]}
                  </span>
                )}
              </span>
              <p>{item.ability}</p>
              <span className={styles.shelfDelta}>
                <span>
                  背景点 {left} → <b className={styles.shelfNum}>{nextLeft}</b>
                </span>
                <span>
                  人性 {now} → <b className={styles.shelfNum}>{nextHumanity}</b>
                </span>
              </span>
              <span className={styles.pickTools}>
                <Button small disabled={blocked(item)} reason={reason} onClick={() => toggle(item)}>
                  {itemOn ? "卸下" : "装上"}
                </Button>
              </span>
            </article>
          )}
          <fieldset className={styles.shelfFilter} aria-label="义体耐受">
            <span className={styles.pickKey}>耐受</span>
            {TOLERANCES.map((t) => (
              <button
                key={t}
                type="button"
                className={styles.shelfChip}
                aria-pressed={board.tolerance === t}
                onClick={() => commit({ ...board, tolerance: t })}
              >
                {TOLERANCE_LEVELS[t].label}
              </button>
            ))}
          </fieldset>
          <p className={styles.shelfNote}>
            {tol.loss} · {tol.price}
            {tol.hook ? ` · 代价：${tol.hook}` : ""}
          </p>
        </section>
      </div>
    </>
  );
}

// ———— 第 8 步：档案确认（本事和义体拆开后顺延一步，用户 2026-10-31） ————

/** 场景、开场白、对话示例只留在卡上，不交给 AI（characterBrief 不带它们） */
const CARD_BLOCKS = ["scene", "greeting", "examples"] as const;
/** 交给 AI 的四块正文，档案里只读预览 */
const BRIEF_BLOCKS = ["look", "past", "personality", "voice"] as const;

export function StepReview({
  card,
  board,
  change,
  checks,
  onJump,
  startLocation,
  onStartLocation,
  actions,
}: {
  readonly card: CharacterCard;
  readonly board: Board | undefined;
  readonly change: (patch: Partial<CharacterCard>) => void;
  readonly checks: readonly Check[];
  readonly onJump: (step: StepId) => void;
  readonly startLocation: string;
  readonly onStartLocation: (id: string) => void;
  readonly actions: ReactNode;
}) {
  const cost = board ? boardHumanityCost(board) : 0;
  const slots: [string, readonly BoardModule[], StepId][] = board
    ? [
        [BOARD_SLOT_LABELS.origin, board.origin ? [board.origin] : [], "origin"],
        [BOARD_SLOT_LABELS.past, board.pasts, "past"],
        [BOARD_SLOT_LABELS.flaw, board.flaws, "past"],
        [BOARD_SLOT_LABELS.skill, board.skills, "skills"],
      ]
    : [];
  return (
    <>
      <article className={styles.dossier} aria-label="身份档案">
        <header className={styles.dossierHead}>
          <span className={styles.eyebrow}>NIGHT CITY / 身份档案</span>
          <h3>{card.name.trim() || "尚未命名"}</h3>
          <span className={styles.note}>
            {[card.alias && `外号「${card.alias}」`, card.pronoun, card.origin]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </header>
        <dl className={styles.dossierAttrs}>
          {(Object.keys(ATTR) as Attribute[]).map((k) => (
            <div key={k}>
              <dt>{ATTR[k]}</dt>
              <dd>{card.attributes[k]}</dd>
            </div>
          ))}
        </dl>
        {slots.map(([label, list, step]) =>
          list.length > 0 ? (
            <section key={label} className={styles.dossierRow}>
              <h4>
                <button type="button" className={styles.linkButton} onClick={() => onJump(step)}>
                  {label}
                </button>
              </h4>
              <p>{list.map((m) => m.label).join("、")}</p>
            </section>
          ) : null,
        )}
        {board && board.combos.length > 0 && (
          <section className={styles.dossierRow}>
            <h4>联动</h4>
            <p>{board.combos.map((c) => c.label).join("、")}</p>
          </section>
        )}
        {board && (
          <section className={styles.dossierRow}>
            <h4>
              <button
                type="button"
                className={styles.linkButton}
                onClick={() => onJump("cyberware")}
              >
                义体
              </button>
            </h4>
            <p>
              {board.cyberware.length > 0 ? board.cyberware.map((c) => c.name).join("、") : "没装"}
              {` · 义体耐受：${TOLERANCE_LEVELS[board.tolerance].label} · 开局人性上限 ${humanityRules.HUMANITY_MAX - cost}`}
            </p>
          </section>
        )}
        {/* 四块正文是交给 AI 的人物描述（characterBrief 带它们），档案里也要看得到，点标题回第 6 步改 */}
        {BRIEF_BLOCKS.map((block) => (
          <section key={block} className={styles.dossierRow}>
            <h4>
              <button type="button" className={styles.linkButton} onClick={() => onJump("person")}>
                {PROSE_BLOCK_INFO[block].label}
              </button>
            </h4>
            <p>{card[block].trim() || "还没写"}</p>
          </section>
        ))}
      </article>

      <h3 className={styles.stepTitle}>档案校验</h3>
      {checks.length === 0 ? (
        <p className={styles.success}>所有关键设定已齐备，可建立档案。</p>
      ) : (
        <ul className={styles.checks}>
          {checks.map((c) => (
            <li key={c.text} data-soft={c.soft || undefined}>
              <button type="button" className={styles.linkButton} onClick={() => onJump(c.step)}>
                {c.text}
              </button>
              {c.soft && <span className={styles.note}>（建议调整，不影响建档）</span>}
            </li>
          ))}
        </ul>
      )}

      <details className={styles.tavern}>
        <summary>酒馆角色卡扩展设定（场景与台词范例）</summary>
        <div className={styles.proseBlocks}>
          {CARD_BLOCKS.map((block) => (
            <ProseField key={block} block={block} card={card} onChange={change} />
          ))}
        </div>
      </details>

      {/* 说明删掉（用户 2026-10-31："解释性说明一大堆"） */}
      <h3 className={styles.stepTitle}>开局地点</h3>
      <StartMapPicker value={startLocation} onChange={onStartLocation} />

      {actions}
    </>
  );
}
