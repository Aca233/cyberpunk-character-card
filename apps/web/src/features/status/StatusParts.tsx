import type { ReactNode } from "react";
import { isRouteErrorResponse, useNavigate, useRouteError } from "react-router";
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
