import { type ReactNode, useEffect } from "react";
import { NineSlice } from "../../ui/Asset";
import { useLayer } from "../../ui/layers";
import neural from "./neural.module.css";

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || target.closest("input, textarea, select") !== null)
  );
}

/** 切法照 MapPanel 侧板 map.panel* */
const PANEL_SLICE = [20, 20, 30, 30] as const;

/**
 * 地图浮层（M，第十二节）：盖在中列和右边四角上，左边四角那一列让出来；底板半透明。
 * 占面板栈，Esc 收起；自己在栈顶时 M 也收起
 */
export function MapLayer({
  onClose,
  children,
}: {
  readonly onClose: () => void;
  readonly children: ReactNode;
}) {
  const isTop = useLayer(onClose);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || isTyping(e.target)) return;
      if (e.key.toLowerCase() !== "m" || !isTop()) return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, isTop]);
  return (
    <section className={neural.mapLayer} data-layer="map" role="dialog" aria-label="地图">
      <NineSlice id="map.panelBg" tint="var(--cp-surface)" slice={PANEL_SLICE} />
      <NineSlice id="map.panelFg" tint="var(--cp-red)" slice={PANEL_SLICE} />
      {/* 关闭键在地图顶栏那一排里（MapBody 的 onClose），这里不再另浮一排按键（用户定的，计划第十二节） */}
      <div className={neural.mapInner}>{children}</div>
    </section>
  );
}
