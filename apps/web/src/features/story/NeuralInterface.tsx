import { type ReactNode, useEffect } from "react";
import type { AssetId } from "../../assets";
import { Asset, cssUrl, NineSlice } from "../../ui/Asset";
import { KeyBar, KeyHint } from "../../ui/KeyHint";
import { useLayer } from "../../ui/layers";
import styles from "./neural.module.css";

/**
 * 神经界面（I，2077-interface-plan.md 第五节第 4 条）：全屏，不花游戏时间，不调模型。
 * 外框照 U0 视觉稿：压暗、扫描线扫一遍、标签栏落下；标签用原作 atlas_tabs 的 tab.bg 和 tab.line。
 * 这里只管页签和按键，每页的内容由剧情页传进来
 */

/**
 * 原作 panel.frame（1060×1560，fullscreen/thin_red_frame01）：线条离图边约 44 原图像素，切角和侧边缺口都在
 * 离边 120 以内，按 120 切，中间只拉直线（计划第十二节第 9 条）
 */
const FRAME_SLICE = 120;

/**
 * 只留要整理东西的页（计划第十二节）：物品栏、义体；制作页随物品栏精简去掉（用户定的方案 A）。
 * 人物、联系人改成左边缘抽屉，日志、消息、数据库改成右边缘抽屉，地图是浮层，都不再进全屏
 */
export type NeuralPage = "inventory" | "cyberware";

/** 两页，页名照原作文本库；键位图标是原作 icons_keyboard，原作没有默认键的页留空 */
export const NEURAL_PAGES: readonly {
  readonly id: NeuralPage;
  readonly name: string;
  readonly key: string | null;
  readonly icon: AssetId | null;
}[] = [
  { id: "inventory", name: "物品栏", key: "o", icon: "key.o" },
  { id: "cyberware", name: "义体", key: null, icon: null },
];

/** 剧情页上直接打开某一页的键（I 打开上次那页） */
export const PAGE_KEYS: Readonly<Record<string, NeuralPage>> = Object.fromEntries(
  NEURAL_PAGES.flatMap((p) => (p.key ? [[p.key, p.id]] : [])),
);

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || target.closest("input, textarea, select") !== null)
  );
}

export function NeuralInterface({
  page,
  eddies,
  badges,
  onPage,
  onClose,
  children,
}: {
  readonly page: NeuralPage;
  readonly eddies: number;
  /** 页签上的未读数，没有就不写 */
  readonly badges: Partial<Record<NeuralPage, number>>;
  readonly onPage: (page: NeuralPage) => void;
  readonly onClose: () => void;
  readonly children: ReactNode;
}) {
  const isTop = useLayer(onClose);

  // Q/E 上一页、下一页，P/O/K/J/M/T 直达，I 关闭；上面压着商店、确认框这些层时不响应
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || isTyping(e.target)) return;
      if (!isTop()) return;
      const k = e.key.toLowerCase();
      const i = NEURAL_PAGES.findIndex((p) => p.id === page);
      const n = NEURAL_PAGES.length;
      let next: NeuralPage | null = null;
      if (k === "q") next = NEURAL_PAGES[(i - 1 + n) % n]?.id ?? null;
      else if (k === "e") next = NEURAL_PAGES[(i + 1) % n]?.id ?? null;
      else if (k === "i") {
        e.preventDefault();
        onClose();
        return;
      } else next = PAGE_KEYS[k] ?? null;
      if (next === null) return;
      e.preventDefault();
      if (next !== page) onPage(next);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [page, onPage, onClose, isTop]);

  return (
    <section className={styles.menu} data-layer="os" role="dialog" aria-label="神经界面">
      <span
        className={styles.menuBg}
        style={{ backgroundImage: cssUrl("menu.nightCity") }}
        aria-hidden
      />
      <span className={styles.menuDim} aria-hidden />
      <span
        className={styles.menuScan}
        style={{ backgroundImage: cssUrl("fx.scanlines") }}
        aria-hidden
      />
      {/*
       * 全屏大页的外框换成原作 panel.frame 红色细线切角框（用户定的换框对照表，计划第十二节第 9 条），
       * 和四角块的 map.panel、面板的 notify.itemCell 区分开；切线 120 原图像素，四角切角不拉伸
       */}
      <NineSlice
        id="panel.frame"
        tint="var(--cp-red)"
        slice={FRAME_SLICE}
        className={styles.menuFrame}
      />
      <header className={styles.menuHead}>
        <Asset id="menu.header" tint="var(--cp-red)" height={72} className={styles.menuHeadBg} />
        <b className={styles.title}>神经界面</b>
        <Asset id="fluff.code" tint="var(--cp-red)" height={16} />
        <span className={styles.eddies}>
          <Asset id="notify.cash" tint="var(--cp-yellow)" height={20} />
          {eddies.toLocaleString("en-US")} 欧元
        </span>
      </header>
      <nav className={styles.tabs} aria-label="页面">
        {NEURAL_PAGES.map((p) => (
          <button
            key={p.id}
            type="button"
            className={styles.tab}
            aria-pressed={p.id === page}
            onClick={() => onPage(p.id)}
          >
            <NineSlice id="tab.bg" tint="currentColor" slice={14} className={styles.tabBg} />
            <span className={styles.inner}>
              {p.icon && <Asset id={p.icon} tint="currentColor" height={20} />}
              {p.name}
              {(badges[p.id] ?? 0) > 0 && <b className={styles.badge}>{badges[p.id]}</b>}
            </span>
          </button>
        ))}
      </nav>
      <span
        className={styles.tabLine}
        style={{ maskImage: cssUrl("tab.line"), WebkitMaskImage: cssUrl("tab.line") }}
        aria-hidden
      />
      <div className={styles.body} data-page={page}>
        {children}
      </div>
      <div className={styles.keys}>
        <KeyBar>
          <KeyHint keyId="key.q" label="上一个面板" />
          <KeyHint keyId="key.e" label="下一个面板" />
          <KeyHint keyId="key.i" label="关闭" onClick={onClose} />
          <KeyHint keyId="key.esc" label="返回" onClick={onClose} />
        </KeyBar>
      </div>
    </section>
  );
}
