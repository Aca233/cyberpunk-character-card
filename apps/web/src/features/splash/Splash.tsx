import { useEffect } from "react";
import { useNavigate } from "react-router";
import { playSfx, unlockAudioNow } from "../../audio";
import { Asset, cssUrl } from "../../ui/Asset";
import styles from "./splash.module.css";

const DURATION_MS = 2400;

/** 启动画面：扫描线唤醒 + 黄色 Logo 色差故障闪入，约 2.4 秒后进主菜单；任意键或点击跳过 */
export function Splash() {
  const navigate = useNavigate();
  useEffect(() => {
    let left = false;
    const go = (withGesture: boolean) => {
      if (left) return;
      left = true;
      if (withGesture) {
        unlockAudioNow();
        playSfx("boot");
      }
      navigate("/menu", { replace: true });
    };
    const onGesture = () => go(true);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timer = window.setTimeout(() => go(false), reduced ? 800 : DURATION_MS);
    window.addEventListener("keydown", onGesture);
    window.addEventListener("pointerdown", onGesture);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", onGesture);
      window.removeEventListener("pointerdown", onGesture);
    };
  }, [navigate]);
  return (
    <main className={styles.splash}>
      <span
        className={styles.scan}
        style={{ backgroundImage: cssUrl("fx.scanlines") }}
        aria-hidden
      />
      <span className={styles.flashLine} aria-hidden />
      <div className={styles.logo}>
        <Asset id="splash.logo" height={180} alt="赛博朋克2091" className={styles.base} />
        <Asset id="splash.logo" height={180} className={styles.ghostA} />
        <Asset id="splash.logo" height={180} className={styles.ghostB} />
      </div>
      <div className={styles.footer}>
        <Asset id="loading.circle" height={28} tint="var(--cp-red)" className={styles.spinner} />
        <span className="label">赛博朋克2091 · 按任意键继续</span>
      </div>
    </main>
  );
}
