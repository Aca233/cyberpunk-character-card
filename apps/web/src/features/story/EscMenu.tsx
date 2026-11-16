import { useLayer } from "../../ui/layers";
import { MenuItem } from "../../ui/MenuItem";
import { Panel } from "../../ui/Panel";
import styles from "./story.module.css";

/**
 * Esc 菜单（2077-interface-plan.md 第五节第 7 条）：什么面板都没开时按 Esc 弹出，
 * 继续、设置、回主菜单。算游戏外面的东西，用主菜单的 MenuItem，不套神经界面的样式。
 * 再按一次 Esc 等于继续
 */
export function EscMenu({
  onResume,
  onMemory,
  canEndStory = false,
  onEndStory,
  onSettings,
  onQuit,
}: {
  readonly onResume: () => void;
  readonly onMemory?: (() => void) | undefined;
  /** 活着的未收尾存档显示「结束故事」，生成中保持灰显并说明原因 */
  readonly canEndStory?: boolean;
  readonly onEndStory?: (() => void) | undefined;
  readonly onSettings: () => void;
  /** 正在生成时不传：这一轮写完才能回主菜单 */
  readonly onQuit?: (() => void) | undefined;
}) {
  useLayer(onResume);
  return (
    <div className={styles.journalBackdrop}>
      <div role="dialog" aria-label="菜单" className={styles.escMenu}>
        <Panel as="div" line="var(--cp-red)">
          <nav className={styles.escList}>
            <MenuItem label="继续" onSelect={onResume} />
            {onMemory && <MenuItem label="记忆管理" onSelect={onMemory} />}
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
