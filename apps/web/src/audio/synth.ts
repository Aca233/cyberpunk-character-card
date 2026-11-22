/**
 * 赛博朋克 2077 质感界面微交互音效（Web Audio API）：
 * - 抛弃廉价的扫频电子滴滴，全部以极短阻尼脉冲、窄带滤波机械微动和克制低频主体构成，
 *   模拟现代暗色硬件与《赛博朋克 2077》沉稳利落的 UI 触感。
 * - 同时在缺少原版长音效素材时提供克制的降级兜底。
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

const noiseBuffers = new WeakMap<AudioContext, AudioBuffer>();

function getNoiseBuffer(ctx: AudioContext): AudioBuffer {
  const cached = noiseBuffers.get(ctx);
  if (cached) return cached;
  const length = Math.floor(ctx.sampleRate * 0.25);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  // 确定性伪随机，保证每次加载音色稳定干净
  let seed = 0x517cc1b7;
  for (let i = 0; i < length; i += 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    data[i] = (seed / 0xffffffff) * 2 - 1;
  }
  noiseBuffers.set(ctx, buffer);
  return buffer;
}

/** 极短阻尼脉冲：模拟精密微动开关与金属棘轮触点 */
function dampedImpulse(
  ctx: AudioContext,
  dest: AudioNode,
  opts: {
    start?: number;
    decay: number;
    filterType: BiquadFilterType;
    freq: number;
    q?: number;
    gain: number;
  },
): void {
  const now = ctx.currentTime + (opts.start ?? 0);
  const src = ctx.createBufferSource();
  src.buffer = getNoiseBuffer(ctx);
  // 随机偏移采样起点，避免连续悬停产生机械重复感
  const offset = Math.random() * 0.16;

  const filter = ctx.createBiquadFilter();
  filter.type = opts.filterType;
  filter.frequency.setValueAtTime(opts.freq, now);
  if (opts.q !== undefined) filter.Q.setValueAtTime(opts.q, now);

  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0.0001, now);
  amp.gain.linearRampToValueAtTime(opts.gain, now + 0.0012);
  amp.gain.exponentialRampToValueAtTime(0.0001, now + opts.decay);

  src.connect(filter);
  filter.connect(amp);
  amp.connect(dest);
  src.start(now, offset, Math.min(0.08, opts.decay + 0.01));
}

/** 阻尼正弦主体：赋予按键厚重沉稳的实体质感，绝无尖锐扫频 */
function dampedBody(
  ctx: AudioContext,
  dest: AudioNode,
  opts: {
    start?: number;
    freq: number;
    endFreq?: number;
    decay: number;
    gain: number;
    type?: OscillatorType;
    lowpass?: number;
  },
): void {
  const now = ctx.currentTime + (opts.start ?? 0);
  const osc = ctx.createOscillator();
  osc.type = opts.type ?? "sine";
  osc.frequency.setValueAtTime(opts.freq, now);
  if (opts.endFreq !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(24, opts.endFreq), now + opts.decay);
  }

  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0.0001, now);
  amp.gain.linearRampToValueAtTime(opts.gain, now + 0.0018);
  amp.gain.exponentialRampToValueAtTime(0.0001, now + opts.decay);

  if (opts.lowpass !== undefined) {
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(opts.lowpass, now);
    osc.connect(lp);
    lp.connect(amp);
  } else {
    osc.connect(amp);
  }
  amp.connect(dest);
  osc.start(now);
  osc.stop(now + opts.decay + 0.015);
}

/** 轻柔微动触点（悬停 / 开关双段共用） */
function softTick(
  ctx: AudioContext,
  dest: AudioNode,
  opts: { start?: number; freq: number; bodyFreq: number; gain: number; q?: number },
): void {
  const start = opts.start ?? 0;
  dampedImpulse(ctx, dest, {
    start,
    decay: 0.016,
    filterType: "bandpass",
    freq: opts.freq,
    q: opts.q ?? 1.6,
    gain: opts.gain,
  });
  dampedBody(ctx, dest, {
    start,
    freq: opts.bodyFreq,
    decay: 0.018,
    gain: opts.gain * 0.24,
  });
}

/** 沉稳哑光微动按键音（普通按下 / 主操作底座） */
function tactileClick(ctx: AudioContext, dest: AudioNode, scale = 1): void {
  const jitter = 0.97 + Math.random() * 0.06;
  // 温暖厚实的低中频按键主体
  dampedBody(ctx, dest, {
    freq: 175 * jitter,
    endFreq: 76,
    decay: 0.046,
    gain: 0.28 * scale,
  });
  // 干脆利落的触点瞬态
  dampedImpulse(ctx, dest, {
    decay: 0.02,
    filterType: "bandpass",
    freq: 1550 * jitter,
    q: 1.35,
    gain: 0.36 * scale,
  });
  // 极轻的高频金属空气感
  dampedImpulse(ctx, dest, {
    decay: 0.014,
    filterType: "bandpass",
    freq: 3100 * jitter,
    q: 2.0,
    gain: 0.12 * scale,
  });
}

/** 播放一条界面微交互或兜底音效（音量已由 dest 主 SFX 总线控制） */
export function playSynthCue(ctx: AudioContext, dest: AudioNode, cue: SfxCue): void {
  const jitter = 0.96 + Math.random() * 0.08;

  switch (cue) {
    case "hover":
      // 极短 16ms 哑光微动轻滴：干脆克制，完全没有尖锐哨音
      softTick(ctx, dest, {
        freq: 1900 * jitter,
        bodyFreq: 340 * jitter,
        gain: 0.26,
        q: 1.6,
      });
      return;

    case "click":
      tactileClick(ctx, dest, 1);
      return;

    case "confirm":
      // 主操作确认：沉稳按键 + 26ms 后柔和暗色调五度共鸣尾点
      tactileClick(ctx, dest, 1.05);
      dampedBody(ctx, dest, {
        start: 0.026,
        freq: 293.66,
        decay: 0.095,
        gain: 0.12,
        lowpass: 950,
      });
      dampedBody(ctx, dest, {
        start: 0.026,
        freq: 440,
        decay: 0.085,
        gain: 0.075,
        lowpass: 1100,
      });
      return;

    case "tab":
      // 磁吸导轨式页签棘轮声
      dampedImpulse(ctx, dest, {
        decay: 0.022,
        filterType: "bandpass",
        freq: 2350 * jitter,
        q: 1.9,
        gain: 0.28,
      });
      dampedBody(ctx, dest, {
        freq: 420 * jitter,
        endFreq: 260,
        decay: 0.028,
        gain: 0.14,
      });
      return;

    case "toggleOn":
      softTick(ctx, dest, { freq: 1650, bodyFreq: 300, gain: 0.28, q: 1.7 });
      softTick(ctx, dest, { start: 0.028, freq: 2350, bodyFreq: 480, gain: 0.34, q: 1.9 });
      return;

    case "toggleOff":
      softTick(ctx, dest, { freq: 2200, bodyFreq: 440, gain: 0.3, q: 1.8 });
      softTick(ctx, dest, { start: 0.028, freq: 1350, bodyFreq: 240, gain: 0.26, q: 1.6 });
      return;

    case "cancel":
    case "panelClose":
      dampedBody(ctx, dest, {
        freq: 145,
        endFreq: 64,
        decay: 0.068,
        gain: 0.24,
      });
      dampedImpulse(ctx, dest, {
        decay: 0.036,
        filterType: "lowpass",
        freq: 680,
        q: 0.9,
        gain: 0.14,
      });
      return;

    case "panelOpen":
      // 轻柔短促的面板滑入微响（与 panelClose 对称，绝不刺耳）
      dampedBody(ctx, dest, {
        freq: 115,
        endFreq: 170,
        decay: 0.055,
        gain: 0.14,
      });
      dampedImpulse(ctx, dest, {
        start: 0.008,
        decay: 0.024,
        filterType: "lowpass",
        freq: 820,
        q: 0.9,
        gain: 0.11,
      });
      return;

    case "error":
      // 低沉双闷击（绝不刺耳）
      dampedBody(ctx, dest, { freq: 118, endFreq: 86, decay: 0.085, gain: 0.28, lowpass: 340 });
      dampedBody(ctx, dest, {
        start: 0.095,
        freq: 98,
        endFreq: 70,
        decay: 0.11,
        gain: 0.3,
        lowpass: 300,
      });
      return;

    case "eddies":
      // 轻盈克制的欧元电子凭证入账微响
      dampedBody(ctx, dest, { freq: 1318.5, decay: 0.075, gain: 0.11 });
      dampedBody(ctx, dest, { start: 0.055, freq: 1760, decay: 0.12, gain: 0.13 });
      softTick(ctx, dest, { freq: 2800, bodyFreq: 660, gain: 0.12, q: 2.2 });
      return;

    case "holocall":
      // 柔和全息来电双脉冲提示（低通柔化，避免刺耳）
      for (const offset of [0, 0.26]) {
        dampedBody(ctx, dest, {
          start: offset,
          freq: 587.33,
          decay: 0.18,
          gain: 0.14,
          type: "triangle",
          lowpass: 1400,
        });
        dampedBody(ctx, dest, {
          start: offset + 0.055,
          freq: 880,
          decay: 0.22,
          gain: 0.12,
          type: "sine",
        });
      }
      return;

    case "turnSubmit":
      tactileClick(ctx, dest, 1.0);
      dampedBody(ctx, dest, { start: 0.02, freq: 240, endFreq: 360, decay: 0.09, gain: 0.12 });
      return;

    case "turnDone":
    case "notify":
      dampedBody(ctx, dest, { freq: 523.25, decay: 0.12, gain: 0.11 });
      dampedBody(ctx, dest, { start: 0.065, freq: 783.99, decay: 0.18, gain: 0.1 });
      return;

    case "scan":
      dampedBody(ctx, dest, { freq: 320, endFreq: 640, decay: 0.18, gain: 0.14, lowpass: 1400 });
      return;

    case "warning":
      dampedBody(ctx, dest, {
        freq: 130,
        endFreq: 68,
        decay: 0.26,
        gain: 0.28,
        type: "triangle",
        lowpass: 420,
      });
      return;

    case "heartbeat":
      dampedBody(ctx, dest, { freq: 70, endFreq: 42, decay: 0.24, gain: 0.3 });
      return;

    case "sandevistan":
      dampedBody(ctx, dest, {
        freq: 220,
        endFreq: 55,
        decay: 0.45,
        gain: 0.24,
        type: "triangle",
        lowpass: 650,
      });
      return;

    case "cyberware":
      dampedBody(ctx, dest, { freq: 220, endFreq: 520, decay: 0.26, gain: 0.15, lowpass: 1200 });
      return;

    case "glitch":
      dampedImpulse(ctx, dest, {
        decay: 0.14,
        filterType: "bandpass",
        freq: 1200,
        q: 1.4,
        gain: 0.2,
      });
      return;

    case "quest":
      dampedBody(ctx, dest, {
        freq: 293.66,
        decay: 0.24,
        gain: 0.14,
        type: "triangle",
        lowpass: 1200,
      });
      dampedBody(ctx, dest, {
        start: 0.12,
        freq: 440,
        decay: 0.34,
        gain: 0.14,
        type: "triangle",
        lowpass: 1400,
      });
      return;

    case "boot":
      dampedBody(ctx, dest, { freq: 76, endFreq: 165, decay: 0.38, gain: 0.2, lowpass: 480 });
      return;

    case "farewell":
      dampedBody(ctx, dest, { freq: 329.63, decay: 0.75, gain: 0.13 });
      dampedBody(ctx, dest, { start: 0.25, freq: 246.94, decay: 0.85, gain: 0.12 });
      return;
  }
}
