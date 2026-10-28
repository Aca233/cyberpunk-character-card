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

export type NeuralPage =
  | "character"
  | "cyberware"
  | "inventory"
  | "crafting"
  | "journal"
  | "map"
  | "messages"
  | "contacts"
  | "database";

/** 九页，页名照原作文本库；键位图标是原作 icons_keyboard，原作没有默认键的页留空 */
export const NEURAL_PAGES: readonly {
  readonly id: NeuralPage;
  readonly name: string;
  readonly key: string | null;
  readonly icon: AssetId | null;
}[] = [
  { id: "character", name: "人物", key: "p", icon: "key.p" },
  { id: "cyberware", name: "义体", key: null, icon: null },
  { id: "inventory", name: "物品栏", key: "o", icon: "key.o" },
  { id: "crafting", name: "制作", key: "k", icon: "key.k" },
  { id: "journal", name: "日志", key: "j", icon: "key.j" },
  { id: "map", name: "地图", key: "m", icon: "key.m" },
  { id: "messages", name: "消息", key: "t", icon: "key.t" },
  { id: "contacts", name: "联系人", key: null, icon: null },
  { id: "database", name: "数据库", key: null, icon: null },
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
      <span className={styles.menuDim} aria-hidden />
      <span
        className={styles.menuScan}
        style={{ backgroundImage: cssUrl("fx.scanlines") }}
        aria-hidden
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
