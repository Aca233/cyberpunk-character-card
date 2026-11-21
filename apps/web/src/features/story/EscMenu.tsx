import { useLayer } from "../../ui/layers";
import { MenuItem } from "../../ui/MenuItem";
import { Panel } from "../../ui/Panel";
import styles from "./story.module.css";

export interface EscContext {
  readonly name: string;
  readonly location: string;
  readonly time: string;
  readonly turns: number;
}

/**
 * Esc 菜单：什么面板都没开时按 Esc 弹出，顶部附紧凑夜之城状态条。
 * 点击遮罩或再按一次 Esc 等于继续。
 */
export function EscMenu({
  context,
  onResume,
  canEndStory = false,
  onEndStory,
  onSettings,
  onQuit,
}: {
  readonly context?: EscContext | undefined;
  readonly onResume: () => void;
  /** 活着的未收尾存档显示「结束故事」，生成中保持灰显并说明原因 */
  readonly canEndStory?: boolean;
  readonly onEndStory?: (() => void) | undefined;
  readonly onSettings: () => void;
  /** 正在生成时不传：这一轮写完才能回主菜单 */
  readonly onQuit?: (() => void) | undefined;
}) {
  useLayer(onResume);
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: 点击半透明遮罩关闭菜单，键盘 Esc 由 useLayer 负责
    // biome-ignore lint/a11y/useKeyWithClickEvents: Esc 已由 useLayer 注册
    <div
      className={styles.journalBackdrop}
      onClick={(e) => {
        if (e.target === e.currentTarget) onResume();
      }}
    >
      <div role="dialog" aria-label="菜单" className={styles.escMenu}>
        <Panel as="div" line="var(--cp-red)">
          {context && (
            <header className={styles.escContext}>
              <div className={styles.escNameRow}>
                <b className={styles.escName}>{context.name}</b>
                <span className={styles.escTurns}>TURN {context.turns}</span>
              </div>
              <p className={styles.escSub}>
                {context.location}
                {context.time ? ` · ${context.time}` : ""}
              </p>
            </header>
          )}
          <nav className={styles.escList}>
            <MenuItem label="继续" onSelect={onResume} />
            {canEndStory && (
              <MenuItem
                label="结束故事"
                disabled={!onEndStory}
                reason="这一轮还没写完"
                onSelect={() => onEndStory?.()}
              />
            )}
            <MenuItem label="设置" onSelect={onSettings} />
            <MenuItem
              label="回主菜单"
              disabled={!onQuit}
              reason="这一轮还没写完"
              onSelect={() => onQuit?.()}
            />
          </nav>
        </Panel>
      </div>
    </div>
  );
}
