import { playSfx } from "../audio";
import { Asset, NineSlice } from "./Asset";
import { CellFrame } from "./FrameBox";
import styles from "./togglecheck.module.css";

interface ToggleCheckProps {
  readonly id?: string | undefined;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly disabled?: boolean | undefined;
  readonly variant?: "checkbox" | "switch";
  readonly "aria-label"?: string | undefined;
  readonly className?: string | undefined;
}

/**
 * 原作贴图实现的复选框 / 开关：替代 Chromium 默认白底蓝勾原生方框，
 * 底层保留原生 <input type="checkbox"> 保证 label[for] 与键盘焦点语义不变
 */
export function ToggleCheck({
  id,
  checked,
  onChange,
  disabled,
  variant = "checkbox",
  "aria-label": ariaLabel,
  className,
}: ToggleCheckProps) {
  if (variant === "switch") {
    return (
      <span
        className={[styles.switch, className].filter(Boolean).join(" ")}
        data-checked={checked || undefined}
        data-disabled={disabled || undefined}
      >
        <CellFrame />
        <input
          id={id}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          aria-label={ariaLabel}
          className={styles.input}
          onChange={(e) => {
            const next = e.target.checked;
            playSfx(next ? "toggleOn" : "toggleOff");
            onChange(next);
          }}
        />
        <span className={styles.switchState} aria-hidden>
          {checked ? "开" : "关"}
        </span>
        <span className={styles.thumb} aria-hidden>
          <NineSlice
            id="panel.cellBg"
            slice={8}
            tint={checked ? "rgb(94 246 255 / 32%)" : "rgb(143 53 48 / 26%)"}
          />
          <NineSlice
            id="panel.cellFg"
            slice={8}
            tint={checked ? "var(--cp-cyan)" : "var(--cp-red)"}
          />
        </span>
      </span>
    );
  }

  return (
    <span
      className={[styles.checkbox, className].filter(Boolean).join(" ")}
      data-checked={checked || undefined}
      data-disabled={disabled || undefined}
    >
      <NineSlice id="panel.cellBg" slice={10} tint="var(--chk-fill)" className={styles.slice} />
      <NineSlice id="panel.cellFg" slice={10} tint="var(--chk-line)" className={styles.slice} />
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-label={ariaLabel}
        className={styles.input}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className={styles.tick} aria-hidden>
        <Asset id="menu.cellFill" height={10} tint="var(--cp-cyan)" />
      </span>
    </span>
  );
}
