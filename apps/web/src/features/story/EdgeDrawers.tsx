import { type CSSProperties, type ReactNode, useEffect } from "react";
import { cssUrl, NineSlice } from "../../ui/Asset";
import { useLayer } from "../../ui/layers";
import type { PeekState } from "./Corners";
import neural from "./neural.module.css";
import { usePeek } from "./peek";

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || target.closest("input, textarea, select") !== null)
  );
}

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
      <NineSlice id="map.panelBg" tint="rgb(10 10 18 / 80%)" slice={PANEL_SLICE} />
      <NineSlice id="map.panelFg" tint="var(--cp-red)" slice={PANEL_SLICE} />
      <div className={neural.mapInner}>{children}</div>
    </section>
  );
}

/**
 * 边缘抽屉（2077-interface-plan.md 第十二节）：鼠标贴到屏幕左右边缘停一下就滑出来，移开收起，
 * 点边缘或按页面键钉住，Esc 收起。底板压低不透明度，正文在下面照常看得见。
 * 左边是人物、联系人，右边是日志、消息、数据库；每页的内容由剧情页传进来
 */

export type DrawerSide = "left" | "right";
export type LeftPage = "character" | "contacts";
export type RightPage = "journal" | "messages" | "database";

/** 抽屉在展开状态里的 id */
export function drawerId(side: DrawerSide): string {
  return `drawer:${side}`;
}

/** 切法照 MapPanel 侧板 map.panel* */
const PANEL_SLICE = [20, 20, 30, 30] as const;

export function EdgeDrawer<T extends string>({
  side,
  label,
  line,
  tabs,
  page,
  peek,
  onPage,
  children,
}: {
  readonly side: DrawerSide;
  readonly label: string;
  readonly line: string;
  /** 页签：id、名字、未读数 */
  readonly tabs: readonly (readonly [T, string, number])[];
  readonly page: T;
  readonly peek: PeekState;
  /** 点页签：换页并钉住 */
  readonly onPage: (page: T) => void;
  readonly children: ReactNode;
}) {
  const p = usePeek(drawerId(side), peek.expand, peek.setExpand);
  return (
    // biome-ignore lint/a11y/useSemanticElements: 边缘热区里套着整个抽屉，不能整个换成 button
    <div
      className={neural.edge}
      data-side={side}
      data-open={p.open || undefined}
      role="button"
      tabIndex={0}
      aria-label={label}
      aria-expanded={p.open}
      {...p.bind}
    >
      {p.open && (
        // 不是一整块板子：一层从边缘渐隐的暗角，页签和各个面板各自浮在上面，中间留缝
        <section
          className={neural.drawer}
          data-side={side}
          data-pinned={p.pinned || undefined}
          data-peek-panel=""
          aria-label={label}
          style={{ "--accent": line } as CSSProperties}
        >
          <span className={neural.drawerScrim} aria-hidden />
          <header className={neural.drawerHead}>
            <nav className={neural.drawerTabs} aria-label={label}>
              {tabs.map(([id, name, badge]) => (
                <button
                  key={id}
                  type="button"
                  className={neural.tab}
                  aria-pressed={id === page}
                  onClick={() => onPage(id)}
                >
                  <NineSlice id="tab.bg" tint="currentColor" slice={14} className={neural.tabBg} />
                  <span className={neural.inner}>
                    {name}
                    {badge > 0 && <b className={neural.badge}>{badge}</b>}
                  </span>
                </button>
              ))}
            </nav>
            <span
              className={neural.tabLine}
              style={{ maskImage: cssUrl("tab.line"), WebkitMaskImage: cssUrl("tab.line") }}
              aria-hidden
            />
          </header>
          <div className={neural.drawerBody} data-page={page} key={page}>
            {children}
          </div>
        </section>
      )}
    </div>
  );
}
