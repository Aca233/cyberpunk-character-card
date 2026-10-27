import { type CSSProperties, useEffect, useState } from "react";
import { ActionButton } from "../../ui/ActionButton";
import { NineSlice } from "../../ui/Asset";
import styles from "./story.module.css";

/** 原作 quickhacks.inkwidget 程序格 qh_cell_bg/fg 的切线（atlas_shapes_sync 2160p：左上右下 25/60/25/15） */
const QH_CUT = [60, 25, 15, 25] as const;

interface Program {
  readonly id: string;
  readonly name: string;
  readonly categoryLabel: string;
  readonly ram: number;
  readonly effect: string;
}

/** 快速破解轮盘：装着的程序围成一圈，选一个写进输入框，目标和做法玩家自己补；RAM 不够的灰掉 */
export function QuickhackWheel({
  ram,
  ramMax,
  programs,
  onPick,
}: {
  readonly ram: number;
  readonly ramMax: number;
  readonly programs: readonly Program[];
  readonly onPick: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className={styles.quickhack}>
      <ActionButton expanded={open} onClick={() => setOpen((o) => !o)}>
        快速破解
      </ActionButton>
      {open && (
        <div className={styles.wheel} role="menu" aria-label="快速破解">
          <div className={styles.wheelCenter}>
            RAM
            <b>
              {ram}/{ramMax}
            </b>
          </div>
          {programs.map((p, i) => (
            <button
              key={p.id}
              type="button"
              role="menuitem"
              className={styles.wheelItem}
              style={{ "--a": `${(360 / programs.length) * i - 90}deg` } as CSSProperties}
              disabled={p.ram > ram}
              title={`${p.categoryLabel}：${p.effect}${p.ram > ram ? "（RAM 不够）" : ""}`}
              onClick={() => {
                setOpen(false);
                onPick(p.name);
              }}
            >
              <NineSlice id="qh.cellBg" tint="rgb(14 14 23 / 61%)" slice={QH_CUT} />
              <NineSlice
                id="qh.cellBg"
                tint="rgb(94 246 255)"
                slice={QH_CUT}
                className={styles.wheelHi}
              />
              <NineSlice id="qh.cellFg" tint="rgb(40 255 255)" slice={QH_CUT} />
              {p.name}
              <small>{p.ram} 格</small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
