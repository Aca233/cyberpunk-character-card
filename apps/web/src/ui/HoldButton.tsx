import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ASSET_IDS } from "../assets/ids.gen";
import { Asset } from "./Asset";
import { Button } from "./Button";

/** 帧号按数值排序；原图集没有第 3 帧，不补画，也不请求不存在的素材 */
const HOLD_FRAMES = ASSET_IDS.filter((id) => id.startsWith("check.hold.")).sort(
  (a, b) => Number(a.split(".").at(-1)) - Number(b.split(".").at(-1)),
);
const HOLD_MS = 800;

interface HoldButtonProps {
  readonly label?: string;
  readonly disabled?: boolean;
  readonly reason?: string;
  /** 已经落盘的骰子只续写结果，不需要重新长按，也绝不重掷 */
  readonly rolled?: boolean;
  readonly onConfirm: () => void;
}

function isEditing(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || target.closest("input, textarea, select") !== null)
  );
}

/** 鼠标、触屏或 F 长按确认；松开、移出、失焦、切后台时全部取消，不能累计多次短按 */
export function HoldButton({
  label = "掷骰",
  disabled = false,
  reason,
  rolled = false,
  onConfirm,
}: HoldButtonProps) {
  const button = useRef<HTMLButtonElement>(null);
  const frame = useRef<number | null>(null);
  const startedAt = useRef<number | null>(null);
  const active = useRef<"pointer" | "keyboard" | null>(null);
  const activeKey = useRef<string | null>(null);
  const activePointer = useRef<number | null>(null);
  const confirm = useRef(onConfirm);
  const [progress, setProgress] = useState(0);
  const [holding, setHolding] = useState(false);
  const hintId = useId();

  useEffect(() => {
    confirm.current = onConfirm;
  }, [onConfirm]);

  const cancel = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    startedAt.current = null;
    active.current = null;
    activeKey.current = null;
    activePointer.current = null;
    setProgress(0);
    setHolding(false);
  }, []);

  const begin = useCallback(
    (source: "pointer" | "keyboard") => {
      if (disabled || rolled || active.current !== null) return;
      active.current = source;
      startedAt.current = performance.now();
      setHolding(true);
      setProgress(0);
      const tick = (now: number) => {
        if (startedAt.current === null || active.current === null) return;
        const next = Math.min(1, (now - startedAt.current) / HOLD_MS);
        setProgress(next);
        if (next >= 1) {
          frame.current = null;
          startedAt.current = null;
          active.current = null;
          setHolding(false);
          confirm.current();
          return;
        }
        frame.current = requestAnimationFrame(tick);
      };
      frame.current = requestAnimationFrame(tick);
    },
    [disabled, rolled],
  );

  useEffect(() => {
    cancel();
    if (disabled || rolled) return;
    const onDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.isComposing ||
        event.ctrlKey ||
        event.altKey ||
        event.metaKey ||
        event.shiftKey ||
        isEditing(event.target) ||
        active.current !== null
      )
        return;
      const focused = event.target === button.current;
      if (event.code !== "KeyF" && !(focused && (event.code === "Space" || event.code === "Enter")))
        return;
      event.preventDefault();
      activeKey.current = event.code;
      begin("keyboard");
    };
    const onUp = (event: KeyboardEvent) => {
      if (event.code !== activeKey.current) return;
      event.preventDefault();
      cancel();
    };
    const onHidden = () => {
      if (document.hidden) cancel();
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", cancel);
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", cancel);
      document.removeEventListener("visibilitychange", onHidden);
      cancel();
    };
  }, [begin, cancel, disabled, rolled]);

  if (rolled) {
    return (
      <Button primary disabled={disabled} reason={reason} onClick={onConfirm}>
        继续结算（沿用已掷骰子）
      </Button>
    );
  }

  const ring =
    HOLD_FRAMES[Math.min(HOLD_FRAMES.length - 1, Math.floor(progress * HOLD_FRAMES.length))];
  return (
    <div style={{ display: "inline-flex", flexDirection: "column", gap: 4 }}>
      <button
        ref={button}
        type="button"
        disabled={disabled}
        title={disabled ? reason : "按住鼠标、触屏或 F 0.8 秒；松开取消"}
        aria-label={`长按${label}`}
        aria-describedby={hintId}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 10,
          minHeight: 44,
          padding: "4px 12px",
          color: disabled ? "var(--cp-text-dim)" : holding ? "var(--cp-cyan)" : "var(--cp-yellow)",
          touchAction: "none",
          userSelect: "none",
        }}
        onPointerDown={(event) => {
          if (!event.isPrimary || event.button !== 0 || disabled || active.current !== null) return;
          event.preventDefault();
          event.currentTarget.focus();
          event.currentTarget.setPointerCapture(event.pointerId);
          activePointer.current = event.pointerId;
          begin("pointer");
        }}
        onPointerMove={(event) => {
          if (event.pointerId !== activePointer.current) return;
          const box = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < box.left ||
            event.clientX > box.right ||
            event.clientY < box.top ||
            event.clientY > box.bottom
          )
            cancel();
        }}
        onPointerUp={(event) => {
          if (event.pointerId === activePointer.current) cancel();
        }}
        onPointerCancel={cancel}
        onLostPointerCapture={cancel}
        onBlur={cancel}
        onContextMenu={(event) => event.preventDefault()}
        onClick={(event) => event.preventDefault()}
      >
        <span
          style={{
            position: "relative",
            display: "inline-grid",
            placeItems: "center",
            width: 36,
            height: 36,
          }}
        >
          <Asset id="key.fHold" height={24} tint="currentColor" />
          {ring && (
            <Asset
              id={ring}
              height={36}
              tint="currentColor"
              style={{ position: "absolute", inset: 0 }}
            />
          )}
        </span>
        <strong>{holding ? "松开取消" : `长按${label}`}</strong>
      </button>
      <span id={hintId} style={{ color: "var(--cp-text-dim)", fontSize: "var(--fs-label)" }}>
        按住 F 或按钮 0.8 秒 · 松开取消
      </span>
    </div>
  );
}
