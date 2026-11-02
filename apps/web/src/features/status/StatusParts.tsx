import { type ReactNode, useSyncExternalStore } from "react";
import { isRouteErrorResponse, useNavigate, useRouteError } from "react-router";
import { LOCAL_MODE, subscribeTab, tabState, takeOverTab } from "../../api/transport";
import { assetTier, useMissingAssets } from "../../assets";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import styles from "./status.module.css";

/** 开发时缺图的汇总提示：列出缺哪几张，提示重新运行 pick-assets */
export function MissingAssetsAlert() {
  const missing = useMissingAssets();
  if (missing.length === 0) return null;
  return (
    <aside className={styles.missing} role="alert">
      <strong>缺少 {missing.length} 张素材</strong>
      <span>{missing.join("、")}</span>
      <span>运行 pnpm pick-assets 重新生成，再用 pnpm check-assets 检查</span>
    </aside>
  );
}

/** 页面底部的声明；demo 素材另外注明只在本机使用 */
export function FanNotice() {
  return (
    <p className={styles.notice}>
      非官方粉丝作品，未经 CD PROJEKT RED 认可，相关版权归 CD PROJEKT RED
      {assetTier() === "demo" ? " · demo 素材，仅限本机使用" : ""}
    </p>
  );
}

/**
 * 纯前端模式的多标签页提示：同一时间只有一个标签页能读写存档（Web Locks，见 api/transport.ts）。
 * 另一个标签页在用时这里等着，那边关掉后自动接上，也可以点「在这里继续」接管；
 * 被别的标签页接管后这里停用，只能刷新
 */
export function TabNotice() {
  const state = useSyncExternalStore(subscribeTab, tabState);
  if (!LOCAL_MODE) return null;
  if (state === "elsewhere") {
    return (
      <Dialog
        title="游戏在另一个标签页里开着"
        tone="warning"
        actions={
          <Button primary onClick={takeOverTab}>
            在这里继续
          </Button>
        }
      >
        <p>存档同一时间只能在一个标签页里读写，免得两边互相覆盖。</p>
        <p>
          关掉另一个标签页后这里会自动接上；也可以直接在这里继续，那边会停用。那边如果正在生成，这一轮会丢掉。
        </p>
      </Dialog>
    );
  }
  if (state === "taken") {
    return (
      <Dialog
        title="游戏已经在另一个标签页继续"
        tone="warning"
        actions={
          <Button primary onClick={() => window.location.reload()}>
            刷新
          </Button>
        }
      >
        <p>这个标签页停用了，不会再读写存档。刷新后可以重新接管。</p>
      </Dialog>
    );
  }
  return null;
}

/** 空状态：一句说明加一个下一步按钮，不留白屏 */
export function EmptyState({
  text,
  action,
}: {
  readonly text: string;
  readonly action?: ReactNode;
}) {
  return (
    <div className={styles.empty}>
      <p>{text}</p>
      {action}
    </div>
  );
}

export function RouteError() {
  const error = useRouteError();
  const navigate = useNavigate();
  const message = isRouteErrorResponse(error)
    ? error.status === 404
      ? "没有这个页面"
      : `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : String(error);
  return (
    <Dialog
      title="界面出错"
      tone="danger"
      actions={
        <>
          <Button onClick={() => window.location.reload()}>刷新</Button>
          <Button primary onClick={() => navigate("/menu")}>
            回主菜单
          </Button>
        </>
      }
    >
      {message}
    </Dialog>
  );
}
