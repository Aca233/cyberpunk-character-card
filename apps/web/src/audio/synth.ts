/**
 * 赛博朋克风格微交互与无素材兜底合成器（Web Audio API）：
 * - 用于原版流式 .wem 未覆盖的极短 <100ms 界面微交互音（悬停微滴、页签棘轮、开关启闭、欧元入账、全息来电）。
 * - 同时作为未运行 pnpm pick-assets 时的优雅降级兜底，不产生刺耳方波。
 */

export type SfxCue =
  | "boot"
  | "hover"
  | "click"
  | "confirm"
  | "cancel"
  | "tab"
  | "toggleOn"
  | "toggleOff"
  | "panelOpen"
  | "panelClose"
  | "error"
  | "turnSubmit"
  | "turnDone"
  | "notify"
  | "eddies"
  | "holocall"
  | "scan"
  | "quest"
  | "warning"
  | "heartbeat"
  | "sandevistan"
  | "cyberware"
  | "glitch"
  | "farewell";

function tone(
  ctx: AudioContext,
  dest: AudioNode,
  opts: {
    type: OscillatorType;
    freq: number;
    endFreq?: number;
    start?: number;
    duration: number;
    gain: number;
    filterFreq?: number;
  },
): void {
  const now = ctx.currentTime + (opts.start ?? 0);
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  osc.type = opts.type;
  osc.frequency.setValueAtTime(opts.freq, now);
  if (opts.endFreq !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.endFreq), now + opts.duration);
  }

  amp.gain.setValueAtTime(0.0001, now);
  amp.gain.linearRampToValueAtTime(opts.gain, now + Math.min(0.008, opts.duration * 0.25));
  amp.gain.exponentialRampToValueAtTime(0.0001, now + opts.duration);

  if (opts.filterFreq !== undefined) {
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(opts.filterFreq, now);
    osc.connect(filter);
    filter.connect(amp);
  } else {
    osc.connect(amp);
  }
  amp.connect(dest);
  osc.start(now);
  osc.stop(now + opts.duration + 0.02);
}

function noiseBurst(
  ctx: AudioContext,
  dest: AudioNode,
  opts: {
    start?: number;
    duration: number;
    gain: number;
    filterType: BiquadFilterType;
    filterFreq: number;
    q?: number;
  },
): void {
  const now = ctx.currentTime + (opts.start ?? 0);
  const length = Math.max(64, Math.floor(ctx.sampleRate * opts.duration));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / length);
  }
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = opts.filterType;
  filter.frequency.setValueAtTime(opts.filterFreq, now);
  if (opts.q !== undefined) filter.Q.setValueAtTime(opts.q, now);
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(opts.gain, now);
  amp.gain.exponentialRampToValueAtTime(0.0001, now + opts.duration);
  src.connect(filter);
  filter.connect(amp);
  amp.connect(dest);
  src.start(now);
}

/** 播放一条赛博风格合成音效（音量已由 dest 的主 SFX 增益总线控制） */
export function playSynthCue(ctx: AudioContext, dest: AudioNode, cue: SfxCue): void {
  const jitter = 0.985 + Math.random() * 0.03;

  switch (cue) {
    case "hover":
      // 极轻的高频数字微滴（克制不吵耳）
      tone(ctx, dest, {
        type: "triangle",
        freq: 1480 * jitter,
        endFreq: 980 * jitter,
        duration: 0.028,
        gain: 0.065,
        filterFreq: 2400,
      });
      return;

    case "click":
      tone(ctx, dest, {
        type: "triangle",
        freq: 620 * jitter,
        endFreq: 240,
        duration: 0.055,
        gain: 0.16,
        filterFreq: 1800,
      });
      noiseBurst(ctx, dest, {
        duration: 0.022,
        gain: 0.07,
        filterType: "bandpass",
        filterFreq: 2600,
        q: 2.2,
      });
      return;

    case "confirm":
      tone(ctx, dest, {
        type: "triangle",
        freq: 520,
        endFreq: 560,
        duration: 0.055,
        gain: 0.14,
        filterFreq: 1900,
      });
      tone(ctx, dest, {
        type: "sine",
        freq: 780,
        endFreq: 1040,
        start: 0.042,
        duration: 0.095,
        gain: 0.15,
      });
      return;

    case "cancel":
    case "panelClose":
      tone(ctx, dest, {
        type: "triangle",
        freq: 460,
        endFreq: 190,
        duration: 0.09,
        gain: 0.12,
        filterFreq: 1200,
      });
      return;

    case "tab":
      tone(ctx, dest, {
        type: "triangle",
        freq: 860 * jitter,
        endFreq: 1180 * jitter,
        duration: 0.048,
        gain: 0.11,
        filterFreq: 2200,
      });
      return;

    case "toggleOn":
      tone(ctx, dest, {
        type: "sine",
        freq: 480,
        endFreq: 660,
        duration: 0.055,
        gain: 0.13,
      });
      tone(ctx, dest, {
        type: "triangle",
        freq: 880,
        endFreq: 960,
        start: 0.045,
        duration: 0.075,
        gain: 0.12,
        filterFreq: 2200,
      });
      return;

    case "toggleOff":
      tone(ctx, dest, {
        type: "triangle",
        freq: 720,
        endFreq: 480,
        duration: 0.055,
        gain: 0.12,
        filterFreq: 1600,
      });
      tone(ctx, dest, {
        type: "sine",
        freq: 420,
        endFreq: 290,
        start: 0.045,
        duration: 0.075,
        gain: 0.11,
      });
      return;

    case "panelOpen":
      tone(ctx, dest, {
        type: "sawtooth",
        freq: 190,
        endFreq: 420,
        duration: 0.11,
        gain: 0.09,
        filterFreq: 950,
      });
      tone(ctx, dest, {
        type: "triangle",
        freq: 760,
        endFreq: 920,
        start: 0.04,
        duration: 0.08,
        gain: 0.09,
      });
      return;

    case "error":
      tone(ctx, dest, {
        type: "sawtooth",
        freq: 210,
        endFreq: 165,
        duration: 0.095,
        gain: 0.14,
        filterFreq: 680,
      });
      tone(ctx, dest, {
        type: "sawtooth",
        freq: 175,
        endFreq: 130,
        start: 0.105,
        duration: 0.13,
        gain: 0.15,
        filterFreq: 620,
      });
      return;

    case "eddies":
      // 赛博欧元转账清脆三连微响
      tone(ctx, dest, { type: "sine", freq: 1175, duration: 0.06, gain: 0.11 });
      tone(ctx, dest, { type: "sine", freq: 1568, start: 0.055, duration: 0.07, gain: 0.12 });
      tone(ctx, dest, { type: "triangle", freq: 2093, start: 0.11, duration: 0.13, gain: 0.11, filterFreq: 3200 });
      return;

    case "holocall":
      // 赛博朋克全息来电双脉冲提示
      for (const offset of [0, 0.24]) {
        tone(ctx, dest, {
          type: "triangle",
          freq: 740,
          endFreq: 1110,
          start: offset,
          duration: 0.15,
          gain: 0.16,
          filterFreq: 2400,
        });
        tone(ctx, dest, {
          type: "sine",
          freq: 1480,
          start: offset + 0.04,
          duration: 0.11,
          gain: 0.08,
        });
      }
      return;

    case "turnSubmit":
      tone(ctx, dest, { type: "triangle", freq: 340, endFreq: 780, duration: 0.11, gain: 0.12, filterFreq: 1800 });
      return;

    case "turnDone":
    case "notify":
      tone(ctx, dest, { type: "sine", freq: 660, duration: 0.09, gain: 0.11 });
      tone(ctx, dest, { type: "sine", freq: 990, start: 0.07, duration: 0.16, gain: 0.1 });
      return;

    case "scan":
      tone(ctx, dest, { type: "sine", freq: 420, endFreq: 1260, duration: 0.24, gain: 0.12 });
      return;

    case "warning":
      tone(ctx, dest, { type: "sawtooth", freq: 150, endFreq: 75, duration: 0.3, gain: 0.18, filterFreq: 520 });
      return;

    case "heartbeat":
      tone(ctx, dest, { type: "sine", freq: 72, endFreq: 42, duration: 0.28, gain: 0.22 });
      return;

    case "sandevistan":
      tone(ctx, dest, { type: "sawtooth", freq: 320, endFreq: 58, duration: 0.55, gain: 0.2, filterFreq: 900 });
      return;

    case "cyberware":
      tone(ctx, dest, { type: "triangle", freq: 240, endFreq: 920, duration: 0.35, gain: 0.15, filterFreq: 2000 });
      return;

    case "glitch":
      noiseBurst(ctx, dest, { duration: 0.18, gain: 0.14, filterType: "bandpass", filterFreq: 1400, q: 1.5 });
      tone(ctx, dest, { type: "sawtooth", freq: 140, endFreq: 540, duration: 0.14, gain: 0.1, filterFreq: 1100 });
      return;

    case "quest":
      tone(ctx, dest, { type: "triangle", freq: 293.66, duration: 0.22, gain: 0.14, filterFreq: 1600 });
      tone(ctx, dest, { type: "triangle", freq: 440, start: 0.14, duration: 0.32, gain: 0.15, filterFreq: 2000 });
      return;

    case "boot":
      tone(ctx, dest, { type: "sawtooth", freq: 80, endFreq: 240, duration: 0.45, gain: 0.14, filterFreq: 700 });
      return;

    case "farewell":
      tone(ctx, dest, { type: "sine", freq: 329.63, duration: 0.8, gain: 0.12 });
      tone(ctx, dest, { type: "sine", freq: 246.94, start: 0.3, duration: 0.9, gain: 0.11 });
      return;
  }
}
