import {
  BOARD_SLOT_LABELS,
  type Board,
  type BoardModule,
  BoardSchema,
  type BoardSlot,
  boardBudget,
  boardCombos,
  boardHumanityCost,
  FLAW_MAX,
  fillPasts,
  humanityRules,
  PAST_MAX,
  PAST_MIN,
  REFUND_MAX,
  rollLifepath,
  SKILL_MAX,
  SKILL_MIN,
  TOLERANCE_LEVELS,
} from "@cp/core";
import { useState } from "react";
import type { BoardData } from "../../api/client";
import { CustomModuleForm } from "./CustomModuleForm";
import styles from "./characters.module.css";

type ListKey = "pasts" | "skills" | "flaws";
type Tolerance = Board["tolerance"];

const LISTS: readonly {
  readonly key: ListKey;
  readonly slot: BoardSlot;
  readonly min: number;
  readonly max: number;
  readonly hint: string;
}[] = [
  { key: "pasts", slot: "past", min: PAST_MIN, max: PAST_MAX, hint: "几段经历：前 3 段必填" },
  {
    key: "skills",
    slot: "skill",
    min: SKILL_MIN,
    max: SKILL_MAX,
    hint: "已经会的本事，不是想学的",
  },
  {
    key: "flaws",
    slot: "flaw",
    min: 0,
    max: FLAW_MAX,
    hint: `欠债、仇家、旧伤……每项返还点数，合计最多返还 ${REFUND_MAX} 点，也会带来期限和仇家`,
  },
];

const TOLERANCES: readonly Tolerance[] = ["low", "normal", "high"];

export function emptyBoard(): Board {
  return BoardSchema.parse({});
}

function ModuleCard({ module, onRemove }: { module: BoardModule; onRemove: () => void }) {
  const refund = module.slot === "flaw";
  return (
    <li className={styles.module} data-flaw={refund || undefined}>
      <div className={styles.moduleHead}>
        <strong>{module.label}</strong>
        <span className={styles.modulePoints}>
          {refund ? `返还 ${module.points}` : `${module.points}`} 点
        </span>
        <button type="button" aria-label={`拔下${module.label}`} onClick={onRemove}>
          ×
        </button>
      </div>
      {module.tags.length > 0 && <p className={styles.moduleTags}>{module.tags.join(" · ")}</p>}
      {module.ability && <p>{module.ability}</p>}
      {module.hook && <p className={styles.moduleHook}>钩子：{module.hook}</p>}
      {module.people.length > 0 && (
        <p className={styles.moduleHook}>
          人物：{module.people.map((p) => (p.role ? `${p.name}（${p.role}）` : p.name)).join("、")}
        </p>
      )}
    </li>
  );
}

/** 角色主板：插槽、背景点预算、联动预览和开局义体；预算和联动最后由服务端按内容表重算 */
export function BoardEditor({
  board,
  data,
  onChange,
}: {
  readonly board: Board;
  readonly data: BoardData;
  /** origin：换了出身模块时，名片上的出身跟着改 */
  readonly onChange: (board: Board, origin?: string) => void;
}) {
  const commit = (next: Board, origin?: string) => {
    const combos = boardCombos(next, data.combos).map(({ requires: _, ...combo }) => combo);
    onChange({ ...next, combos }, origin);
  };
  const budget = boardBudget(board);
  const humanityCost = boardHumanityCost(board);
  const of = (slot: BoardSlot) => data.modules.filter((m) => m.slot === slot);
  const plugged = new Set(
    [board.origin, ...board.pasts, ...board.skills, ...board.flaws].map((m) => m?.id),
  );
  const takenSlots = new Set(
    board.cyberware.map((c) => data.cyberware.find((o) => o.id === c.id)?.slot),
  );
  const [writing, setWriting] = useState<BoardSlot | null>(null);
  const writeButton = (slot: BoardSlot, full: boolean) =>
    writing !== slot && (
      <button
        type="button"
        className={styles.toolButton}
        disabled={full}
        onClick={() => setWriting(slot)}
      >
        自己写一块
      </button>
    );
  const customForm = (slot: BoardSlot, accept: (module: BoardModule) => void) =>
    writing === slot && (
      <CustomModuleForm
        slot={slot}
        board={board}
        onCancel={() => setWriting(null)}
        onAccept={(module) => {
          accept(module);
          setWriting(null);
        }}
      />
    );
  const roll = () => {
    const rolled = rollLifepath(board, data.lifepath, data.modules, Math.random);
    if (rolled) commit({ ...board, pasts: [...board.pasts, rolled] });
  };

  return (
    <div className={styles.board}>
      <div className={styles.budget} role="status">
        <span data-tone={budget.remaining < 0 ? "bad" : undefined}>
          背景点剩余 <b>{budget.remaining}</b> / {budget.total}
        </span>
        <span>
          花了 {budget.spent} · 返还 {budget.refund}
          {budget.wasted > 0 && `（负面经历超出上限的 ${budget.wasted} 点不算）`}
        </span>
        <span>主板义体占人性上限 {humanityCost}（开局行装自带的义体另算）</span>
      </div>

      <section className={styles.slotGroup}>
        <h4>
          {BOARD_SLOT_LABELS.origin} <small>选一个；不收点数</small>
        </h4>
        <select
          className={styles.picker}
          value={board.origin?.id ?? ""}
          onChange={(event) => {
            const origin = of("origin").find((m) => m.id === event.target.value) ?? null;
            commit({ ...board, origin }, origin?.label);
          }}
        >
          <option value="">— 选择出身 —</option>
          {board.origin?.custom && (
            <option value={board.origin.id}>{board.origin.label}（自写）</option>
          )}
          {of("origin").map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
        {writeButton("origin", false)}
        {board.origin && (
          <ul className={styles.modules}>
            <ModuleCard module={board.origin} onRemove={() => commit({ ...board, origin: null })} />
          </ul>
        )}
        {customForm("origin", (origin) => commit({ ...board, origin }, origin.label))}
      </section>

      {LISTS.map(({ key, slot, min, max, hint }) => {
        const list = board[key];
        const available = of(slot).filter((m) => !plugged.has(m.id));
        return (
          <section className={styles.slotGroup} key={key}>
            <h4>
              {BOARD_SLOT_LABELS[slot]}{" "}
              <small>
                {list.length} / {max}
                {min > 0 && list.length < min && ` · 至少 ${min}`} · {hint}
              </small>
            </h4>
            {list.length > 0 && (
              <ul className={styles.modules}>
                {list.map((m) => (
                  <ModuleCard
                    key={m.id}
                    module={m}
                    onRemove={() => commit({ ...board, [key]: list.filter((x) => x.id !== m.id) })}
                  />
                ))}
              </ul>
            )}
            <div className={styles.slotTools}>
              {list.length < max && available.length > 0 && (
                <select
                  className={styles.picker}
                  value=""
                  onChange={(event) => {
                    const module = available.find((m) => m.id === event.target.value);
                    if (module) commit({ ...board, [key]: [...list, module] });
                  }}
                >
                  <option value="">＋ 插一块{BOARD_SLOT_LABELS[slot]}</option>
                  {available.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}（{slot === "flaw" ? "返还 " : ""}
                      {m.points} 点）
                    </option>
                  ))}
                </select>
              )}
              {key === "pasts" && (
                <>
                  <button
                    type="button"
                    className={styles.toolButton}
                    disabled={list.length >= max}
                    onClick={roll}
                    title="按生命路径表掷一段，出身影响概率"
                  >
                    掷一段生命路径
                  </button>
                  <button
                    type="button"
                    className={styles.toolButton}
                    disabled={list.length >= PAST_MIN}
                    onClick={() =>
                      commit(fillPasts(board, data.lifepath, data.modules, Math.random))
                    }
                  >
                    随机插满
                  </button>
                </>
              )}
              {writeButton(slot, list.length >= max)}
            </div>
            {customForm(slot, (module) => commit({ ...board, [key]: [...list, module] }))}
          </section>
        );
      })}

      <section className={styles.slotGroup}>
        <h4>
          开局义体 <small>普通 1 点、罕见 2 点；同一部位只装一件，会扣人性上限</small>
        </h4>
        {board.cyberware.length > 0 && (
          <ul className={styles.modules}>
            {board.cyberware.map((c) => {
              const option = data.cyberware.find((o) => o.id === c.id);
              return (
                <li className={styles.module} key={c.id}>
                  <div className={styles.moduleHead}>
                    <strong>{c.name}</strong>
                    <span className={styles.modulePoints}>
                      {c.points} 点 · 人性 −{c.humanityCost}
                    </span>
                    <button
                      type="button"
                      aria-label={`拔下${c.name}`}
                      onClick={() =>
                        commit({
                          ...board,
                          cyberware: board.cyberware.filter((x) => x.id !== c.id),
                        })
                      }
                    >
                      ×
                    </button>
                  </div>
                  {option && (
                    <p>
                      {option.slotLabel} · {option.ability}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <select
          className={styles.picker}
          value=""
          onChange={(event) => {
            const o = data.cyberware.find((x) => x.id === event.target.value);
            if (o) {
              commit({
                ...board,
                cyberware: [
                  ...board.cyberware,
                  { id: o.id, name: o.name, points: o.points, humanityCost: o.humanityCost },
                ],
              });
            }
          }}
        >
          <option value="">＋ 装一件开局义体</option>
          {data.cyberware
            .filter((o) => !takenSlots.has(o.slot))
            .map((o) => (
              <option key={o.id} value={o.id}>
                {o.slotLabel} · {o.name}（{o.points} 点，人性 −{o.humanityCost}）
              </option>
            ))}
        </select>
      </section>

      <section className={styles.slotGroup}>
        <h4>
          义体耐受 <small>乘在所有义体的人性消耗上，进剧情后也一直算</small>
        </h4>
        <div className={styles.tolerance}>
          {TOLERANCES.map((t) => {
            const level = TOLERANCE_LEVELS[t];
            return (
              <button
                type="button"
                key={t}
                aria-pressed={board.tolerance === t}
                onClick={() => commit({ ...board, tolerance: t })}
                title={level.hook || undefined}
              >
                <strong>{level.label}</strong>
                <span>
                  ×{humanityRules.TOLERANCE_FACTOR[t]} ·{" "}
                  {level.points > 0
                    ? `${level.points} 点`
                    : level.points < 0
                      ? `返还 ${-level.points} 点`
                      : "不花点数"}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {board.combos.length > 0 && (
        <section className={styles.slotGroup}>
          <h4>
            联动 <small>几块模块凑在一起触发的额外能力和麻烦</small>
          </h4>
          <ul className={styles.modules}>
            {board.combos.map((c) => (
              <li className={styles.module} data-combo key={c.id}>
                <div className={styles.moduleHead}>
                  <strong>{c.label}</strong>
                </div>
                <p>{c.ability}</p>
                {c.hook && <p className={styles.moduleHook}>钩子：{c.hook}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
