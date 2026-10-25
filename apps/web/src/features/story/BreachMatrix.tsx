import { useMemo, useState } from "react";
import { ActionButton } from "../../ui/ActionButton";
import styles from "./story.module.css";

/** 原作入侵协议矩阵的代码 */
const CODES = ["1C", "55", "BD", "E9", "7A"] as const;
const SIZE = 5;
/** 缓冲区能放几个代码 */
const BUFFER = 6;
/** 三段序列都取自同一条走得通的路线，保证能全部解开：[起, 止) */
const SEQUENCES: readonly (readonly [number, number])[] = [
  [0, 2],
  [1, 4],
  [2, 6],
];
const REWARDS = ["加成 +2", "加成 +2", "难度 −2"];

type Cell = readonly [row: number, col: number];

interface Puzzle {
  readonly grid: readonly (readonly string[])[];
  readonly sequences: readonly (readonly string[])[];
}

const pickOne = <T,>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)] as T;

/** 照原作规则先走一条路线：第一下在第一行，之后列、行交替，走过的格子不能再选 */
function makePuzzle(): Puzzle {
  const grid = Array.from({ length: SIZE }, () =>
    Array.from({ length: SIZE }, () => pickOne(CODES)),
  );
  const path: Cell[] = [];
  let line = 0;
  for (let i = 0; i < BUFFER; i++) {
    const byRow = i % 2 === 0;
    const options: Cell[] = [];
    for (let k = 0; k < SIZE; k++) {
      const cell: Cell = byRow ? [line, k] : [k, line];
      if (!path.some(([r, c]) => r === cell[0] && c === cell[1])) options.push(cell);
    }
    const cell = pickOne(options);
    path.push(cell);
    line = byRow ? cell[1] : cell[0];
  }
  const codes = path.map(([r, c]) => grid[r]?.[c] ?? "");
  return { grid, sequences: SEQUENCES.map(([from, to]) => codes.slice(from, to)) };
}

function contains(buffer: readonly string[], seq: readonly string[]): boolean {
  return ` ${buffer.join(" ")} `.includes(` ${seq.join(" ")} `);
}

/** 入侵协议矩阵小游戏（设置里打开才出现）：解开的序列数在确认检定时一起交给后端换算成修正 */
export function BreachMatrix({ onDone }: { readonly onDone: (solved: number) => void }) {
  const puzzle = useMemo(makePuzzle, []);
  const [picks, setPicks] = useState<readonly Cell[]>([]);
  const [done, setDone] = useState(false);
  const buffer = picks.map(([r, c]) => puzzle.grid[r]?.[c] ?? "");
  const solved = puzzle.sequences.map((seq) => contains(buffer, seq));
  const count = solved.filter(Boolean).length;
  const last = picks[picks.length - 1];
  const byRow = picks.length % 2 === 0;
  const line = last ? (byRow ? last[0] : last[1]) : 0;
  const onLine = (r: number, c: number) => (byRow ? r === line : c === line);
  const taken = (r: number, c: number) => picks.some(([pr, pc]) => pr === r && pc === c);

  const finish = (n: number) => {
    setDone(true);
    onDone(n);
  };
  const pick = (r: number, c: number) => {
    const next = [...picks, [r, c] as const];
    setPicks(next);
    const codes = next.map(([pr, pc]) => puzzle.grid[pr]?.[pc] ?? "");
    const n = puzzle.sequences.filter((seq) => contains(codes, seq)).length;
    if (next.length >= BUFFER || n === puzzle.sequences.length) finish(n);
  };

  return (
    <section className={styles.matrix} aria-label="入侵协议矩阵">
      <div className={styles.matrixHead}>
        <b>入侵协议</b>
        <span className={styles.matrixBuffer} title="缓冲区">
          {Array.from({ length: BUFFER }, (_, i) => buffer[i] ?? "··").join(" ")}
        </span>
      </div>
      <div className={styles.matrixBody}>
        <div className={styles.matrixGrid}>
          {puzzle.grid.flatMap((row, r) =>
            row.map((code, c) => (
              <button
                // biome-ignore lint/suspicious/noArrayIndexKey: 矩阵格子按行列定位，不会重排
                key={`${r}-${c}`}
                type="button"
                className={styles.matrixCell}
                data-picked={taken(r, c) || undefined}
                data-line={(!done && onLine(r, c)) || undefined}
                disabled={done || taken(r, c) || !onLine(r, c)}
                onClick={() => pick(r, c)}
              >
                {code}
              </button>
            )),
          )}
        </div>
        <ol className={styles.matrixSeqs}>
          {puzzle.sequences.map((seq, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: 三段序列顺序固定
            <li key={i} data-solved={solved[i] || undefined}>
              <span>{seq.join(" ")}</span>
              <small>{REWARDS[i]}</small>
            </li>
          ))}
        </ol>
      </div>
      <p className={styles.matrixNote}>
        {done
          ? `断开连接：解开 ${count} 段，掷骰时一起算`
          : "第一下选第一行，之后按列、按行交替；序列要在缓冲区里连着出现"}
        {!done && <ActionButton onClick={() => finish(count)}>断开</ActionButton>}
      </p>
    </section>
  );
}
