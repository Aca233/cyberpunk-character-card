import { playSfx, unlockAudioNow } from "./engine";
import type { SfxCue } from "./synth";

/**
 * 全局交互音效事件委托：
 * 自动覆盖全站所有可交互控件（原生 <button>、链接、折叠 <summary>、role="button" 角块/卡片、
 * 页签、开关、下拉与显式 [data-sfx] 元素），避免逐个组件漏接或重复发声。
 */

const INTERACTIVE_SELECTOR = [
  "button",
  "a[href]",
  "summary",
  '[role="button"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[role="switch"]',
  '[role="checkbox"]',
  "select",
  'input[type="checkbox"]',
  'input[type="radio"]',
  "[data-sfx]",
].join(", ");

const EXPLICIT_CUES: ReadonlySet<string> = new Set<SfxCue>([
  "boot",
  "hover",
  "click",
  "confirm",
  "cancel",
  "tab",
  "toggleOn",
  "toggleOff",
  "panelOpen",
  "panelClose",
  "error",
  "turnSubmit",
  "turnDone",
  "notify",
  "eddies",
  "holocall",
  "scan",
  "quest",
  "warning",
  "heartbeat",
  "sandevistan",
  "cyberware",
  "glitch",
  "farewell",
]);

let installed = false;
let currentHovered: Element | null = null;

function isDisabled(el: Element): boolean {
  if (el.matches(":disabled")) return true;
  if (el.getAttribute("aria-disabled") === "true") return true;
  if (el.hasAttribute("data-disabled")) return true;
  return false;
}

function findInteractive(target: EventTarget | null): Element | null {
  if (!(target instanceof Element)) return null;
  const el = target.closest(INTERACTIVE_SELECTOR);
  if (!el || isDisabled(el)) return null;
  return el;
}

function resolvePressCue(el: Element): SfxCue | null {
  const explicit = el.getAttribute("data-sfx");
  if (explicit === "none") return null;
  if (explicit && EXPLICIT_CUES.has(explicit)) return explicit as SfxCue;

  // 复选框 / 单选框改由 change 事件按最终开闭状态发声，避免与 pointerdown 重复
  if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) {
    return null;
  }

  if (el.getAttribute("role") === "tab") {
    return el.getAttribute("aria-selected") === "true" ? null : "tab";
  }

  if (el.hasAttribute("data-primary")) return "confirm";
  if (el instanceof HTMLButtonElement && el.type === "submit") return "confirm";

  return "click";
}

export function installUiAudioDelegation(): void {
  if (installed || typeof document === "undefined") return;
  installed = true;

  // 悬停移入可交互区域：仅在切换至新的可交互元素时发声，不在子元素间抖动重触发
  document.addEventListener(
    "pointerover",
    (event) => {
      if (event.pointerType === "touch") return;
      const el = findInteractive(event.target);
      if (el === currentHovered) return;
      currentHovered = el;
      if (!el) return;
      if (el.getAttribute("data-sfx-hover") === "none") return;
      playSfx("hover");
    },
    { capture: true, passive: true },
  );

  // 指针移出窗口时复位，避免移回同一按钮不触发悬停音
  window.addEventListener(
    "blur",
    () => {
      currentHovered = null;
    },
    { passive: true },
  );
  document.addEventListener(
    "pointerleave",
    () => {
      currentHovered = null;
    },
    { passive: true },
  );

  // 按下即响（零延迟手感），并在用户手势同步阶段解锁 AudioContext
  document.addEventListener(
    "pointerdown",
    (event) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      unlockAudioNow();
      const el = findInteractive(event.target);
      if (!el) return;
      const cue = resolvePressCue(el);
      if (cue) playSfx(cue);
    },
    { capture: true, passive: true },
  );

  // 键盘 Enter / Space 触发的点击（detail === 0）同样补发按下音效
  document.addEventListener(
    "click",
    (event) => {
      if (event.detail !== 0) return;
      unlockAudioNow();
      const el = findInteractive(event.target);
      if (!el) return;
      const cue = resolvePressCue(el);
      if (cue) playSfx(cue);
    },
    { capture: true, passive: true },
  );

  // 复选框 / 开关 / 下拉选择变化音
  document.addEventListener(
    "change",
    (event) => {
      const target = event.target;
      if (
        target instanceof HTMLInputElement &&
        (target.type === "checkbox" || target.type === "radio")
      ) {
        if (target.disabled || target.getAttribute("data-sfx") === "none") return;
        playSfx(target.checked ? "toggleOn" : "toggleOff");
      } else if (target instanceof HTMLSelectElement) {
        if (target.disabled || target.getAttribute("data-sfx") === "none") return;
        playSfx("tab");
      }
    },
    { capture: true, passive: true },
  );
}
