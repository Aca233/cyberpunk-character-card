export interface LyricWordSpan {
  readonly key: string;
  readonly text: string;
  readonly startRatio: number;
  readonly endRatio: number;
  readonly emphasis: boolean;
}

export interface EdgerunnersLyricLine {
  readonly id: number;
  readonly startTime: number;
  readonly endTime: number;
  readonly en: string;
  readonly zh: string;
  readonly isChorus: boolean;
  readonly isInterlude?: boolean;
  readonly words: readonly LyricWordSpan[];
}

interface RawLyricSeed {
  readonly startTime: number;
  readonly endTime: number;
  readonly en: string;
  readonly zh: string;
  readonly isChorus?: boolean;
  readonly isInterlude?: boolean;
}

const EMPHASIS_WORDS = new Set([
  "stay",
  "house",
  "rainbow",
  "compromise",
  "self-control",
  "go",
  "away",
  "party",
  "handshake",
  "broke",
  "apart",
  "call",
  "side-ide",
  "lies",
  "no-one",
  "miss",
  "time",
  "lines",
]);

function buildWordSpans(en: string): readonly LyricWordSpan[] {
  const parts = en.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return [];
  const weights = parts.map((w) => Math.max(2, w.length));
  const totalWeight = weights.reduce((acc, w) => acc + w, 0);
  let cursor = 0;
  return parts.map((text, idx) => {
    const w = weights[idx] ?? 2;
    const startRatio = cursor / totalWeight;
    cursor += w;
    const endRatio = cursor / totalWeight;
    const clean = text.toLowerCase().replace(/[^a-z-]/g, "");
    return {
      key: `w-${startRatio.toFixed(4)}-${text}`,
      text,
      startRatio,
      endRatio,
      emphasis: EMPHASIS_WORDS.has(clean) || idx === parts.length - 1,
    };
  });
}

const RAW_SEEDS: readonly RawLyricSeed[] = [
  {
    startTime: 0,
    endTime: 1.2,
    en: "I Really Want to Stay at Your House",
    zh: "赛博朋克：边缘行者 · Rosa Walton & Hallie Coggins",
    isInterlude: true,
  },
  {
    startTime: 1.2,
    endTime: 9.0,
    en: "I couldn't wait for you to come clear the cupboards",
    zh: "我已经等不及你来清理橱柜",
  },
  {
    startTime: 9.0,
    endTime: 16.0,
    en: "But now you're going to leave with nothing but a sign",
    zh: "但现在你准备离开 唯留下一丝印记",
  },
  {
    startTime: 16.0,
    endTime: 24.0,
    en: "Another evening I'll be sitting reading in between your lines",
    zh: "又一个夜晚 我会静坐着 品读你的言外之意",
  },
  {
    startTime: 24.0,
    endTime: 30.0,
    en: "Because I miss you all the time",
    zh: "因为我每时每刻都在想念你",
  },
  {
    startTime: 30.0,
    endTime: 32.2,
    en: "So, get away",
    zh: "所以离开吧",
  },
  {
    startTime: 32.2,
    endTime: 36.2,
    en: "Another way to feel what you didn't want yourself to know",
    zh: "另一种方式去感知你不愿让自己面对的秘密",
  },
  {
    startTime: 36.2,
    endTime: 39.0,
    en: "And let yourself go",
    zh: "释放自我吧",
  },
  {
    startTime: 39.0,
    endTime: 43.2,
    en: "You know you didn't lose your self-control",
    zh: "你知道你不会失去你的自控力",
  },
  {
    startTime: 43.2,
    endTime: 46.0,
    en: "Let's start at the rainbow",
    zh: "让我们于彩虹之端启程",
  },
  {
    startTime: 46.0,
    endTime: 47.4,
    en: "Turn away",
    zh: "转身走开吧",
  },
  {
    startTime: 47.4,
    endTime: 52.0,
    en: "Another way to be where you didn't want yourself to go",
    zh: "另一种方法前往你不愿涉足半步的天地",
  },
  {
    startTime: 52.0,
    endTime: 55.0,
    en: "Let yourself go",
    zh: "释放自我吧",
  },
  {
    startTime: 55.0,
    endTime: 60.0,
    en: "Is that a compromise?",
    zh: "这算是选择妥协吗",
  },
  {
    startTime: 60.0,
    endTime: 64.0,
    en: "So what do you wanna do, what's your point of view?",
    zh: "所以你想做什么 你的看法是什么",
    isChorus: true,
  },
  {
    startTime: 64.0,
    endTime: 68.0,
    en: "There's a party soon, do you wanna go?",
    zh: "派对即将拉开序幕 你是否愿意参加",
    isChorus: true,
  },
  {
    startTime: 68.0,
    endTime: 72.0,
    en: "A handshake with you, what's your point of view?",
    zh: "与你握手问好 你的看法是什么",
    isChorus: true,
  },
  {
    startTime: 72.0,
    endTime: 75.2,
    en: "I'm on top of you, I don't wanna go",
    zh: "我和你依偎在一起 我不愿离开",
    isChorus: true,
  },
  {
    startTime: 75.2,
    endTime: 79.0,
    en: "'Cause I really wanna stay at your house",
    zh: "因为我真心希望待在你的家里",
    isChorus: true,
  },
  {
    startTime: 79.0,
    endTime: 83.0,
    en: "And I hope this works out",
    zh: "我希望能够得偿所愿",
    isChorus: true,
  },
  {
    startTime: 83.0,
    endTime: 85.4,
    en: "But you know how much you broke me apart",
    zh: "但你知道你让我伤心欲绝",
    isChorus: true,
  },
  {
    startTime: 85.4,
    endTime: 89.0,
    en: "I'm done with you, I'm ignoring you",
    zh: "我跟你分道扬镳 我对你视而不见",
    isChorus: true,
  },
  {
    startTime: 89.0,
    endTime: 94.5,
    en: "I don't wanna know, ah-",
    zh: "我不想知道",
    isChorus: true,
  },
  {
    startTime: 94.5,
    endTime: 101.0,
    en: "98.7 BODY HEAT RADIO // LUNAR ORBIT SYNTH",
    zh: "♪ 霓虹合成器间奏 · 月海轨道 ♪",
    isInterlude: true,
  },
  {
    startTime: 101.0,
    endTime: 108.0,
    en: "And I'm aware that you were lying in the gutter",
    zh: "我知道你身陷囹圄",
  },
  {
    startTime: 108.0,
    endTime: 116.0,
    en: "'Cause I did everything to be there by your side-ide",
    zh: "因为我使尽浑身解数才能陪在你身边",
  },
  {
    startTime: 116.0,
    endTime: 124.0,
    en: "So when you tell me I'm the reason, I just can't believe the lies",
    zh: "所以当你说我就是原因所在 我只是无法相信那些谎言",
  },
  {
    startTime: 124.0,
    endTime: 126.4,
    en: "And why do I so want to call you?",
    zh: "我为什么如此渴望给你打去电话",
  },
  {
    startTime: 126.4,
    endTime: 129.0,
    en: "Call you, call you, call you",
    zh: "给你打去电话",
  },
  {
    startTime: 129.0,
    endTime: 133.0,
    en: "So what do you wanna do, what's your point of view?",
    zh: "所以你想做什么 你的看法是什么",
    isChorus: true,
  },
  {
    startTime: 133.0,
    endTime: 137.0,
    en: "There's a party soon, do you wanna go?",
    zh: "派对即将拉开序幕 你是否愿意参加",
    isChorus: true,
  },
  {
    startTime: 137.0,
    endTime: 141.0,
    en: "A handshake with you, what's your point of view?",
    zh: "与你握手问好 你的看法是什么",
    isChorus: true,
  },
  {
    startTime: 141.0,
    endTime: 144.2,
    en: "I'm on top of you, I don't wanna go",
    zh: "我和你依偎在一起 我不愿离开",
    isChorus: true,
  },
  {
    startTime: 144.2,
    endTime: 148.0,
    en: "'Cause I really wanna stay at your house",
    zh: "因为我真心希望待在你的家里",
    isChorus: true,
  },
  {
    startTime: 148.0,
    endTime: 152.0,
    en: "And I hope this works out",
    zh: "我希望能够得偿所愿",
    isChorus: true,
  },
  {
    startTime: 152.0,
    endTime: 155.0,
    en: "But you know how much you broke me apart",
    zh: "但你知道你让我伤心欲绝",
    isChorus: true,
  },
  {
    startTime: 155.0,
    endTime: 158.2,
    en: "I'm done with you, I'm ignoring you",
    zh: "我跟你分道扬镳 我对你视而不见",
    isChorus: true,
  },
  {
    startTime: 158.2,
    endTime: 164.0,
    en: "I don't wanna know, ah-",
    zh: "我不想知道",
    isChorus: true,
  },
  {
    startTime: 164.0,
    endTime: 168.0,
    en: "NIGHT CITY // RAIN & NEON REVERB",
    zh: "♪ 雨夜残响 · 霓虹回声 ♪",
    isInterlude: true,
  },
  {
    startTime: 168.0,
    endTime: 171.0,
    en: "Oh-oh, oh-oh-oh",
    zh: "噢——",
  },
  {
    startTime: 171.0,
    endTime: 176.0,
    en: "I don't know why I'm no-one",
    zh: "我不想知道我一无是处的缘由",
  },
  {
    startTime: 176.0,
    endTime: 178.2,
    en: "So, get away",
    zh: "所以离开吧",
  },
  {
    startTime: 178.2,
    endTime: 182.2,
    en: "Another way to feel what you didn't want yourself to know",
    zh: "另一种方式去感知你不愿让自己面对的秘密",
  },
  {
    startTime: 182.2,
    endTime: 185.0,
    en: "And let yourself go",
    zh: "释放自我吧",
  },
  {
    startTime: 185.0,
    endTime: 189.0,
    en: "You know you didn't lose your self-control",
    zh: "你知道你不会失去你的自控力",
  },
  {
    startTime: 189.0,
    endTime: 192.0,
    en: "Let's start at the rainbow",
    zh: "让我们于彩虹之端启程",
  },
  {
    startTime: 192.0,
    endTime: 193.4,
    en: "Turn away",
    zh: "转身离开",
  },
  {
    startTime: 193.4,
    endTime: 198.0,
    en: "Another way to be where you didn't want yourself to go",
    zh: "另一种方法前往你不愿涉足半步的天地",
  },
  {
    startTime: 198.0,
    endTime: 200.4,
    en: "Let yourself go",
    zh: "释放自我吧",
  },
  {
    startTime: 200.4,
    endTime: 206.5,
    en: "Is that a compromise?",
    zh: "这算是选择妥协吗",
  },
  {
    startTime: 206.5,
    endTime: 210.0,
    en: "TRANQUILITY BASE // FINAL DROP",
    zh: "♪ 静海基地 · 终章前奏 ♪",
    isInterlude: true,
  },
  {
    startTime: 210.0,
    endTime: 214.0,
    en: "So what do you wanna do, what's your point of view?",
    zh: "所以你想做什么 你的看法是什么",
    isChorus: true,
  },
  {
    startTime: 214.0,
    endTime: 217.2,
    en: "There's a party soon, do you wanna go?",
    zh: "派对即将拉开序幕 你是否愿意参加",
    isChorus: true,
  },
  {
    startTime: 217.2,
    endTime: 221.0,
    en: "A handshake with you, what's your point of view?",
    zh: "与你握手问好 你的看法是什么",
    isChorus: true,
  },
  {
    startTime: 221.0,
    endTime: 225.0,
    en: "I'm on top of you, I don't wanna go",
    zh: "我和你依偎在一起 我不愿离开",
    isChorus: true,
  },
  {
    startTime: 225.0,
    endTime: 229.0,
    en: "'Cause I really wanna stay at your house",
    zh: "因为我真心希望待在你的家里",
    isChorus: true,
  },
  {
    startTime: 229.0,
    endTime: 232.2,
    en: "And I hope this works out",
    zh: "我希望能够得偿所愿",
    isChorus: true,
  },
  {
    startTime: 232.2,
    endTime: 235.2,
    en: "But you know how much you broke me apart",
    zh: "但你知道你让我伤心欲绝",
    isChorus: true,
  },
  {
    startTime: 235.2,
    endTime: 239.0,
    en: "I'm done with you, I'm ignoring you",
    zh: "我跟你分道扬镳 我对你视而不见",
    isChorus: true,
  },
  {
    startTime: 239.0,
    endTime: 246.7,
    en: "I don't wanna know, ah",
    zh: "我不想知道",
    isChorus: true,
  },
];

export const EDGERUNNERS_LYRICS: readonly EdgerunnersLyricLine[] = RAW_SEEDS.map((seed, idx) => ({
  id: idx,
  startTime: seed.startTime,
  endTime: seed.endTime,
  en: seed.en,
  zh: seed.zh,
  isChorus: seed.isChorus === true,
  ...(seed.isInterlude ? { isInterlude: true } : {}),
  words: buildWordSpans(seed.en),
}));

export function findActiveLyricIndex(timeSec: number): number {
  if (!Number.isFinite(timeSec) || timeSec <= 0) return 0;
  for (let i = EDGERUNNERS_LYRICS.length - 1; i >= 0; i--) {
    const line = EDGERUNNERS_LYRICS[i];
    if (line && timeSec >= line.startTime) {
      return i;
    }
  }
  return 0;
}
