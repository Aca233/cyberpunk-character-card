import { useEffect } from "react";
import { useNavigate } from "react-router";
import { Asset } from "../../ui/Asset";
import styles from "./splash.module.css";

const DURATION_MS = 2200;

/** 启动画面：黄色 Logo 故障闪入，约 2 秒后进主菜单；任意键或点击跳过 */
export function Splash() {
  const navigate = useNavigate();
  useEffect(() => {
    const go = () => navigate("/menu", { replace: true });
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timer = window.setTimeout(go, reduced ? 800 : DURATION_MS);
    window.addEventListener("keydown", go);
    window.addEventListener("pointerdown", go);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", go);
      window.removeEventListener("pointerdown", go);
    };
  }, [navigate]);
  return (
    <main className={styles.splash}>
      <div className={styles.logo}>
        <Asset id="splash.logo" height={180} alt="赛博朋克 2077" className={styles.base} />
        <Asset id="splash.logo" height={180} className={styles.ghostA} />
        <Asset id="splash.logo" height={180} className={styles.ghostB} />
      </div>
      <div className={styles.footer}>
        <Asset id="loading.circle" height={28} tint="var(--cp-red)" className={styles.spinner} />
        <span className="label">夜之城角色卡 · 按任意键继续</span>
      </div>
    </main>
  );
}
