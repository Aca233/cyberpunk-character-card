import {
  ATTRIBUTE_BASE,
  ATTRIBUTE_CREATE_MAX,
  ATTRIBUTE_POINTS,
  type Board,
  type BoardModule,
  boardBudget,
  boardPeople,
  type CharacterCard,
  diceRules,
  FLAW_MAX,
  fillPasts,
  lifepathCosts,
  PAST_MAX,
  PAST_MIN,
  pointsSpent,
  REFUND_MAX,
  RELATION_INFO,
  RELATIONS,
  type RelationKind,
  rollLifepath,
} from "@cp/core";
import { useState } from "react";
import { Asset } from "../../ui/Asset";
import { Button } from "../../ui/Button";
import { CellFrame } from "../../ui/FrameBox";
import { portraitOf } from "../story/art";
import { Line, type StepProps } from "./CreatorSteps";
import styles from "./characters.module.css";
import { attributeReliance, REROLLS, recommendAttributes } from "./creator";

/**
 * 捏人第 2、3、5 步（docs/creator-plan.md 分期第 2 条，用户 2026-10-31 说"全部做完"）：
 * 过往掷骰翻卡和重掷、旧识选人定关系、属性标出靠它的本事和一键推荐。规则和点数照旧用 core 的
 */

type Attribute = keyof CharacterCard["attributes"];
const ATTR = diceRules.ATTRIBUTE_LABELS as Readonly<Record<Attribute, string>>;

const peopleText = (m: BoardModule) =>
  m.people.map((p) => (p.role ? `${p.name}（${p.role}）` : p.name)).join("、");

// ———— 第 2 步：过往 ————

/**
 * 掷生命路径翻出一张卡（reduced-motion 下不翻，直接显示，见 .flip），共 REROLLS 次重掷，
 * 用完也能从卡片墙手挑（用户定的，2026-10-30）；负面经历做成"接受，换 N 点"
 */
export function StepPast({
  board,
  data,
  commit,
  rerolls,
  onReroll,
}: StepProps & { readonly rerolls: number; readonly onReroll: () => void }) {
  const [fresh, setFresh] = useState<string | null>(null);
  const [wall, setWall] = useState(false);
  const left = REROLLS - rerolls;
  const origin = board.origin?.id ?? "";
  const weightOf = (id: string) => data.lifepath.find((e) => e.id === id)?.weights[origin] ?? 1;
  const plugged = new Set(board.pasts.map((m) => m.id));
  const full = board.pasts.length >= PAST_MAX;

  const roll = () => {
    const rolled = rollLifepath(board, data.lifepath, data.modules, Math.random);
    if (!rolled) return;
    commit({ ...board, pasts: [...board.pasts, rolled] });
    setFresh(rolled.id);
  };
  /** 重掷第 i 段：已经插着的（连同这一段）都不会再掷到 */
  const reroll = (i: number) => {
    const rolled = rollLifepath(board, data.lifepath, data.modules, Math.random);
    if (!rolled) return;
    commit({ ...board, pasts: board.pasts.map((m, j) => (j === i ? rolled : m)) });
    onReroll();
    setFresh(rolled.id);
  };
  const remove = (id: string) =>
    commit({ ...board, pasts: board.pasts.filter((m) => m.id !== id) });

  const flawPoints = board.flaws.reduce((sum, m) => sum + m.points, 0);
  const flawOn = new Set(board.flaws.map((m) => m.id));
  // 代价放在前面：跟插着的过往沾边的负面经历（计划第 2 步："而不是自己去另一个插槽里找"），其余的收在后面照样能挑
  const costs = lifepathCosts(board, data.lifepath, data.modules);
  const costIds = new Set(costs.map((c) => c.module.id));
  const others = data.modules.filter((m) => m.slot === "flaw" && !costIds.has(m.id));

  const flawCard = (m: BoardModule, from?: readonly BoardModule[]) => {
    const on = flawOn.has(m.id);
    const extra = Math.max(0, Math.min(m.points, REFUND_MAX - flawPoints));
    return (
      <li key={m.id}>
        <div className={styles.pick} data-on={on || undefined}>
          <CellFrame />
          <span className={styles.pickHead}>
            <strong className={styles.pickName}>{m.label}</strong>
            <span className={styles.modulePoints}>返还 {m.points} 点</span>
          </span>
          {from && <Line k="因为">{from.map((p) => `「${p.label}」`).join("")}</Line>}
          {m.ability && <Line k="处境">{m.ability}</Line>}
          {m.hook && <Line k="钩子">{m.hook}</Line>}
          {m.people.length > 0 && <Line k="找上门的人">{peopleText(m)}</Line>}
          <span className={styles.pickTools}>
            <Button
              small
              disabled={!on && board.flaws.length >= FLAW_MAX}
              reason={`负面经历最多 ${FLAW_MAX} 项`}
              onClick={() =>
                commit({
                  ...board,
                  flaws: on ? board.flaws.filter((x) => x.id !== m.id) : [...board.flaws, m],
                })
              }
            >
              {on ? "撤回" : extra > 0 ? `接受，换 ${extra} 点` : "接受（已到返还上限）"}
            </Button>
          </span>
        </div>
      </li>
    );
  };

  return (
    <>
      {/* 用户 2026-10-31 嫌页面"解释性说明一大堆"：引导段删掉，段数和重掷次数只留在标题小字里 */}
      <h3 className={styles.stepTitle}>
        过往经历{" "}
        <small className={styles.stepNote}>
          {board.pasts.length} / {PAST_MAX} · 重掷剩余 {left} 次
        </small>
      </h3>
      {board.pasts.length > 0 && (
        <ul className={styles.skillWall}>
          {board.pasts.map((m, i) => (
            <li key={m.id}>
              <div
                className={`${styles.pick} ${fresh === m.id ? styles.flip : ""}`}
                data-on=""
                onAnimationEnd={() => setFresh(null)}
              >
                <CellFrame />
                <span className={styles.pickHead}>
                  <strong className={styles.pickName}>{m.label}</strong>
                  <span className={styles.modulePoints}>{m.points} 点</span>
                </span>
                {m.ability && <Line k="专长能力">{m.ability}</Line>}
                {m.hook && <Line k="剧情钩子">{m.hook}</Line>}
                {m.people.length > 0 && <Line k="关联人脉">{peopleText(m)}</Line>}
                <span className={styles.pickTools}>
                  <Button
                    small
                    disabled={left <= 0}
                    reason={`${REROLLS} 次重掷已用尽，可卸下后从经历库中手选`}
                    onClick={() => reroll(i)}
                  >
                    重掷该段经历
                  </Button>
                  <Button small onClick={() => remove(m.id)}>
                    卸下
                  </Button>
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className={styles.slotTools}>
        <Button small primary={board.pasts.length < PAST_MIN} disabled={full} onClick={roll}>
          抽取生命路径
        </Button>
        <Button
          small
          disabled={board.pasts.length >= PAST_MIN}
          onClick={() => commit(fillPasts(board, data.lifepath, data.modules, Math.random))}
        >
          快速补齐 {PAST_MIN} 段
        </Button>
        <Button small aria-expanded={wall} onClick={() => setWall((w) => !w)}>
          {wall ? "收起经历库" : "从经历库手选"}
        </Button>
      </div>
      {wall && (
        <ul className={styles.skillWall} aria-label="全部经历库">
          {data.modules
            .filter((m) => m.slot === "past")
            .map((m) => {
              const pressed = plugged.has(m.id);
              const weight = weightOf(m.id);
              return (
                <li key={m.id}>
                  <button
                    type="button"
                    className={styles.pick}
                    aria-pressed={pressed}
                    disabled={!pressed && full}
                    title={!pressed && full ? `过往最多 ${PAST_MAX} 段` : undefined}
                    onClick={() =>
                      pressed ? remove(m.id) : commit({ ...board, pasts: [...board.pasts, m] })
                    }
                  >
                    <CellFrame />
                    <span className={styles.pickHead}>
                      <strong className={styles.pickName}>{m.label}</strong>
                      <span className={styles.modulePoints}>{m.points} 点</span>
                    </span>
                    {m.ability && <span>{m.ability}</span>}
                    {board.origin && weight !== 1 && (
                      <Line k="出身契合度">
                        {/* 权重小于 1 时不能写"更容易"（第四期走查发现，2026-10-31） */}
                        {weight === 0
                          ? "不相容，仅能手选"
                          : weight > 1
                            ? `高契合度抽取 ×${weight}`
                            : `低契合度抽取 ×${weight}`}
                      </Line>
                    )}
                  </button>
                </li>
              );
            })}
        </ul>
      )}

      <h3 className={styles.stepTitle}>
        负面经历与代价{" "}
        <small className={styles.stepNote}>
          {board.flaws.length} / {FLAW_MAX} · 最多换取 {REFUND_MAX} 点
          {flawPoints > REFUND_MAX && `（超出 ${flawPoints - REFUND_MAX} 点不算）`}
        </small>
      </h3>
      {costs.length === 0 ? (
        <p className={styles.note}>请先抽取过往经历。</p>
      ) : (
        <ul className={styles.skillWall} aria-label="与过往关联的代价">
          {costs.map((c) => flawCard(c.module, c.from))}
        </ul>
      )}
      {others.length > 0 && (
        <>
          <h3 className={styles.stepTitle}>其他负面经历</h3>
          <ul className={styles.skillWall}>{others.map((m) => flawCard(m))}</ul>
        </>
      )}
    </>
  );
}

// ———— 第 3 步：旧识 ————

/** 关系按钮上的小字：开局好感、花不花点（用户定的关系表，2026-10-30） */
function relationNote(r: RelationKind): string {
  const info = RELATION_INFO[r];
  const affinity = info.affinity > 0 ? `+${info.affinity}` : `${info.affinity}`;
  return `好感 ${affinity}${info.points > 0 ? ` · ${info.points} 点` : ""}`;
}

interface Person {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  /** 原作人物的 id，有原作头像就画头像 */
  readonly npc?: string;
  readonly fromModule: boolean;
}

/**
 * 旧识不限人数（用户 2026-10-30："无数个"）：15 个原作人物全部能选、没有预设关系，模块带出的人也列出来能改关系。
 * 每人可以写一句"是什么事"，不写由一键成稿补。
 * 用户 2026-10-31："旧识界面也不太好"，嫌下拉框难用、卡片太多太长、认不出人，选了「照原作联系人改」：
 * 左边照原作手机联系人排成带头像的紧凑列表，右边看选中的人，关系是一排按钮，好感和点数写在按钮上
 */
export function StepPeople({ board, data, commit }: StepProps) {
  const left = boardBudget(board).remaining;
  const modulePeople: Person[] = boardPeople(board).map((p) => ({
    id: p.id,
    name: p.name,
    role: p.role,
    fromModule: true,
  }));
  const canon: Person[] = data.npcs.map((n) => ({
    id: n.id,
    name: n.alias ? `${n.name}（${n.alias}）` : n.name,
    role: n.role,
    npc: n.id,
    fromModule: false,
  }));
  const byId = new Map(board.acquaintances.map((a) => [a.id, a]));
  const [picked, setPicked] = useState<string | null>(null);
  const current = [...modulePeople, ...canon].find((p) => p.id === picked) ?? canon[0];

  const setRelation = (p: Person, relation: RelationKind | "") => {
    const name = p.name.slice(0, 20);
    const had = byId.get(p.id);
    const next = relation
      ? had
        ? board.acquaintances.map((a) => (a.id === p.id ? { ...a, relation } : a))
        : [...board.acquaintances, { id: p.id, name, relation, note: "" }]
      : board.acquaintances.filter((a) => a.id !== p.id);
    commit({ ...board, acquaintances: next });
  };
  const setNote = (id: string, note: string) =>
    commit({
      ...board,
      acquaintances: board.acquaintances.map((a) => (a.id === id ? { ...a, note } : a)),
    });

  /** 左边一行：照原作联系人，头像、名字，下面一行小字是定下的关系或身份 */
  const contact = (p: Person) => {
    const a = byId.get(p.id);
    const face = portraitOf(p.npc);
    return (
      <li key={p.id}>
        <button
          type="button"
          className={styles.peopleRow}
          aria-pressed={p.id === current?.id}
          data-on={a ? "" : undefined}
          onClick={() => setPicked(p.id)}
        >
          <span className={styles.peopleFace} aria-hidden="true">
            {face ? <Asset id={face} className={styles.peopleFaceArt} /> : ([...p.name][0] ?? "?")}
          </span>
          <span className={styles.peopleName}>
            <b className={styles.peopleTitle}>{p.name}</b>
            <small className={styles.peopleSub}>
              {a ? RELATION_INFO[a.relation].label : p.role}
            </small>
          </span>
        </button>
      </li>
    );
  };

  const a = current ? byId.get(current.id) : undefined;
  const had = a ? RELATION_INFO[a.relation].points : 0;
  const face = portraitOf(current?.npc);
  const chosen = board.acquaintances.filter((x) => data.npcs.some((n) => n.id === x.id)).length;

  return (
    <>
      <div className={styles.stepTip}>
        可选辅助模块：可在此建立初始人脉网络，也可留空，在战局推进中自然结识夜之城各路豪杰。
      </div>
      <div className={styles.people}>
        <nav className={styles.peopleList} aria-label="联系人">
          {modulePeople.length > 0 && (
            <>
              <h3 className={styles.peopleGroup}>背景关联人脉</h3>
              <ul>{modulePeople.map(contact)}</ul>
            </>
          )}
          <h3 className={styles.peopleGroup}>
            {/* 只数原作人物，模块带出的人改了关系不算在这里（第四期走查发现，2026-10-31） */}
            夜之城人脉网络<small className={styles.peopleCount}>已建立联系 {chosen} 人</small>
          </h3>
          <ul>{canon.map(contact)}</ul>
        </nav>
        {current && (
          <section className={styles.peopleCard} aria-label={current.name}>
            <CellFrame />
            <header className={styles.peopleHead}>
              <span className={styles.peopleFace} data-big="" aria-hidden="true">
                {face ? (
                  <Asset id={face} className={styles.peopleFaceArt} />
                ) : (
                  ([...current.name][0] ?? "?")
                )}
              </span>
              <span className={styles.peopleName}>
                <b className={styles.peopleTitle}>{current.name}</b>
                <small className={styles.peopleSub}>{current.role}</small>
              </span>
            </header>
            <fieldset className={styles.relations} aria-label={`和${current.name}的关系`}>
              <button
                type="button"
                className={styles.relation}
                aria-pressed={!a}
                onClick={() => setRelation(current, "")}
              >
                <b className={styles.relationLabel}>
                  {current.fromModule ? "沿用默认关系" : "暂无交集"}
                </b>
              </button>
              {RELATIONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  className={styles.relation}
                  aria-pressed={a?.relation === r}
                  data-tone={RELATION_INFO[r].affinity < 0 ? "bad" : undefined}
                  disabled={a?.relation !== r && RELATION_INFO[r].points - had > left}
                  title={
                    a?.relation !== r && RELATION_INFO[r].points - had > left
                      ? "背景点不够"
                      : undefined
                  }
                  onClick={() => setRelation(current, r)}
                >
                  <b className={styles.relationLabel}>{RELATION_INFO[r].label}</b>
                  <small className={styles.relationNote}>{relationNote(r)}</small>
                </button>
              ))}
            </fieldset>
            {a && (
              <input
                className={styles.startInput}
                maxLength={60}
                value={a.note}
                aria-label={`和${current.name}是什么事`}
                placeholder="过往恩怨或交集契机（可留空交由AI推演）"
                onChange={(e) => setNote(current.id, e.target.value)}
              />
            )}
          </section>
        )}
      </div>
    </>
  );
}

// ———— 第 5 步：属性 ————

/** 每项属性标出"你插的特长里有几项靠它"，加一键推荐分配（计划第 5 步） */
export function StepAttributes({
  card,
  board,
  change,
}: {
  readonly card: CharacterCard;
  readonly board: Board;
  readonly change: (patch: Partial<CharacterCard>) => void;
}) {
  const left = ATTRIBUTE_POINTS - pointsSpent(card.attributes);
  const reliance = attributeReliance(board);
  const set = (key: Attribute, value: number) =>
    change({ attributes: { ...card.attributes, [key]: value } });
  return (
    <>
      <div className={styles.slotTools}>
        <Button small onClick={() => change({ attributes: recommendAttributes(board) })}>
          按特长偏好一键推荐
        </Button>
        <Button
          small
          disabled={left === ATTRIBUTE_POINTS}
          onClick={() =>
            change({
              attributes: {
                body: ATTRIBUTE_BASE,
                reflexes: ATTRIBUTE_BASE,
                tech: ATTRIBUTE_BASE,
                intelligence: ATTRIBUTE_BASE,
                cool: ATTRIBUTE_BASE,
              },
            })
          }
        >
          重置分配
        </Button>
      </div>
      <div className={styles.attributes}>
        {(Object.entries(ATTR) as [Attribute, string][]).map(([key, label]) => {
          const skills = reliance[key].filter((m) => m.slot === "skill");
          const pasts = reliance[key].filter((m) => m.slot === "past");
          return (
            <div className={styles.attribute} key={key}>
              <label htmlFor={`creator-${key}`}>{label}</label>
              <div className={styles.stepper}>
                <button
                  type="button"
                  aria-label={`减少${label}`}
                  disabled={card.attributes[key] <= ATTRIBUTE_BASE}
                  onClick={() => set(key, card.attributes[key] - 1)}
                >
                  −
                </button>
                <output id={`creator-${key}`}>{card.attributes[key]}</output>
                <button
                  type="button"
                  aria-label={`增加${label}`}
                  disabled={left <= 0 || card.attributes[key] >= ATTRIBUTE_CREATE_MAX}
                  onClick={() => set(key, card.attributes[key] + 1)}
                >
                  ＋
                </button>
              </div>
              {/* 没有模块靠它就不写（用户 2026-10-31："解释性说明一大堆"） */}
              {(skills.length > 0 || pasts.length > 0) && (
                <small className={styles.stepNote}>
                  {[...skills, ...pasts].map((m) => `「${m.label}」`).join("")}
                </small>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
