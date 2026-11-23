export {
  getLastStoryBgm,
  rememberStoryBgm,
  resolveRouteBgm,
  resolveStoryBgm,
} from "./director";
export {
  type AudioSnapshot,
  auditionSfxAsset,
  clearBgmPreview,
  type DuckReason,
  getActiveBgmTime,
  installAudioUnlock,
  playSfx,
  preloadCoreSfx,
  previewBgm,
  seekActiveBgm,
  setAudioDuck,
  setBgmTarget,
  setThemeBgmOverride,
  type ThemeBgmSpec,
  unlockAudioNow,
  useAudioState,
} from "./engine";
export {
  type AudioPrefs,
  audioPrefs,
  DEFAULT_AUDIO_PREFS,
  resetAudioPrefs,
  setAudioPref,
  toggleMute,
  useAudioPrefs,
} from "./prefs";
export type { SfxCue } from "./synth";
export { installUiAudioDelegation } from "./ui-delegation";
