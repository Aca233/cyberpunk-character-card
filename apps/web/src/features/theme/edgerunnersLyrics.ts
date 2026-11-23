/**
 * 《I Really Want to Stay at Your House》— Rosa Walton & Hallie Coggins
 * 精确逐词时间轴源自 Folia LyricData (.fia, durationMs: 246652)，与
 * apps/web/public/media/themes/stay-at-your-house.mp3 (246.70s) 毫秒级对齐。
 */

export interface LyricWordSpan {
  readonly key: string;
  readonly text: string;
  readonly startTime: number;
  readonly endTime: number;
  readonly startRatio: number;
  readonly endRatio: number;
  readonly emphasis: boolean;
  /** true 表示与下一个音节/词紧密相连（如 self- + control），渲染时不插空格 */
  readonly joinNext?: boolean;
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

/** 逐词时间轴紧凑元组：[text, startTimeSec, endTimeSec, joinNextFlag?] */
type RawWordTuple =
  | readonly [text: string, startTime: number, endTime: number]
  | readonly [text: string, startTime: number, endTime: number, joinNext: 1];

interface RawLyricSeed {
  readonly startTime: number;
  readonly endTime: number;
  readonly en: string;
  readonly zh: string;
  readonly isChorus?: boolean;
  readonly isInterlude?: boolean;
  readonly words?: readonly RawWordTuple[];
}

const EMPHASIS_WORDS = new Set([
  "stay",
  "house",
  "rainbow",
  "compromise",
  "self",
  "control",
  "self-control",
  "go",
  "away",
  "party",
  "handshake",
  "broke",
  "apart",
  "call",
  "side",
  "ide",
  "side-ide",
  "lie",
  "lies",
  "no",
  "one",
  "no-one",
  "miss",
  "time",
  "lines",
]);

function isEmphasisWord(text: string, isLast: boolean): boolean {
  const clean = text
    .toLowerCase()
    .replace(/[^a-z-]/g, "")
    .replace(/^-+|-+$/g, "");
  return EMPHASIS_WORDS.has(clean) || isLast;
}

function clamp01(value: number): number {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function buildTimedWordSpans(
  tuples: readonly RawWordTuple[],
  lineStart: number,
  lineEnd: number,
): readonly LyricWordSpan[] {
  const lineSpan = Math.max(0.05, lineEnd - lineStart);
  return tuples.map((tuple, idx) => {
    const [text, startTime, endTime, joinNextFlag] = tuple;
    const startRatio = clamp01((startTime - lineStart) / lineSpan);
    const endRatio = clamp01((endTime - lineStart) / lineSpan);
    return {
      key: `w-${idx}-${startTime.toFixed(3)}-${text}`,
      text,
      startTime,
      endTime,
      startRatio,
      endRatio,
      emphasis: isEmphasisWord(text, idx === tuples.length - 1),
      ...(joinNextFlag === 1 ? { joinNext: true } : {}),
    };
  });
}

function buildFallbackWordSpans(
  en: string,
  lineStart: number,
  lineEnd: number,
): readonly LyricWordSpan[] {
  const parts = en.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return [];
  const weights = parts.map((w) => Math.max(2, w.length));
  const totalWeight = weights.reduce((acc, w) => acc + w, 0);
  const lineSpan = Math.max(0.05, lineEnd - lineStart);
  let cursor = 0;
  return parts.map((text, idx) => {
    const w = weights[idx] ?? 2;
    const startRatio = cursor / totalWeight;
    cursor += w;
    const endRatio = cursor / totalWeight;
    return {
      key: `w-${idx}-${startRatio.toFixed(4)}-${text}`,
      text,
      startTime: lineStart + startRatio * lineSpan,
      endTime: lineStart + endRatio * lineSpan,
      startRatio,
      endRatio,
      emphasis: isEmphasisWord(text, idx === parts.length - 1),
    };
  });
}

const RAW_SEEDS: readonly RawLyricSeed[] = [
  {
    startTime: 0,
    endTime: 1.54,
    en: "I Really Want to Stay at Your House",
    zh: "赛博朋克：边缘行者 · Rosa Walton & Hallie Coggins",
    isInterlude: true,
  },
  {
    startTime: 1.543,
    endTime: 5.099,
    en: "I couldn't wait for you to come clear the cupboards",
    zh: "我已经等不及你来清理橱柜",
    words: [
      ["I", 1.543, 1.802],
      ["couldn't", 1.802, 2.196],
      ["wait", 2.196, 2.426],
      ["for", 2.426, 2.658],
      ["you", 2.658, 2.866],
      ["to", 2.866, 3.108],
      ["come", 3.108, 3.314],
      ["clear", 3.549, 3.795],
      ["the", 3.795, 4.059],
      ["cupboards", 4.059, 5.099],
    ],
  },
  {
    startTime: 9.178,
    endTime: 12.16,
    en: "But now you're going to leave with nothing but a sign",
    zh: "但现在你准备离开 唯留下一丝印记",
    words: [
      ["But", 9.178, 9.345],
      ["now", 9.345, 9.494],
      ["you're", 9.494, 9.711],
      ["going", 9.711, 9.91],
      ["to", 9.91, 10.298],
      ["leave", 10.298, 10.607],
      ["with", 10.607, 10.855],
      ["nothing", 10.855, 11.082],
      ["but", 11.082, 11.377],
      ["a", 11.377, 11.629],
      ["sign", 11.629, 12.16],
    ],
  },
  {
    startTime: 16.84,
    endTime: 23.16,
    en: "Another evening I'll be sitting reading in between your lines",
    zh: "又一个夜晚 我会静坐着 品读你的言外之意",
    words: [
      ["Another", 16.84, 17.343],
      ["evening", 17.343, 17.923],
      ["I'll", 17.923, 18.128],
      ["be", 18.128, 18.343],
      ["sitting", 18.343, 18.855],
      ["reading", 18.855, 19.304],
      ["in", 19.304, 20.225],
      ["between", 20.225, 21.08],
      ["your", 21.08, 21.303],
      ["lines", 21.303, 23.16],
    ],
  },
  {
    startTime: 24.418,
    endTime: 26.558,
    en: "Because I miss you all the time",
    zh: "因为我每时每刻都在想念你",
    words: [
      ["Because", 24.418, 24.824],
      ["I", 24.824, 25.112],
      ["miss", 25.112, 25.315],
      ["you", 25.315, 25.6],
      ["all", 25.6, 25.792],
      ["the", 25.792, 26.064],
      ["time", 26.064, 26.558],
    ],
  },
  {
    startTime: 30.458,
    endTime: 32.193,
    en: "So get away",
    zh: "所以离开吧",
    words: [
      ["So", 30.458, 30.858],
      ["get", 31.258, 31.732],
      ["away", 31.732, 32.193],
    ],
  },
  {
    startTime: 32.597,
    endTime: 36.638,
    en: "Another way to feel what you didn't want yourself to know",
    zh: "另一种方式去感知你不愿让自己面对的秘密",
    words: [
      ["Another", 32.597, 33.146],
      ["way", 33.146, 33.403],
      ["to", 33.403, 33.69],
      ["feel", 33.69, 34.13],
      ["what", 34.13, 34.39],
      ["you", 34.39, 34.602],
      ["didn't", 34.602, 35.01],
      ["want", 35.01, 35.31],
      ["yourself", 35.31, 36.01],
      ["to", 36.01, 36.249],
      ["know", 36.249, 36.638],
    ],
  },
  {
    startTime: 36.833,
    endTime: 38.517,
    en: "And let yourself go",
    zh: "释放自我吧",
    words: [
      ["And", 36.833, 37.122],
      ["let", 37.122, 37.29],
      ["yourself", 37.29, 37.98],
      ["go", 37.98, 38.517],
    ],
  },
  {
    startTime: 39.749,
    endTime: 42.805,
    en: "You know you didn't lose your self-control",
    zh: "你知道你不会失去你的自控力",
    words: [
      ["You", 39.749, 40.005],
      ["know", 40.005, 40.213],
      ["you", 40.213, 40.452],
      ["didn't", 40.452, 40.853],
      ["lose", 40.853, 41.149],
      ["your", 41.149, 41.38],
      ["self-", 41.38, 41.893, 1],
      ["control", 41.893, 42.805],
    ],
  },
  {
    startTime: 43.734,
    endTime: 46.23,
    en: "Let's start at the rainbow",
    zh: "让我们于彩虹之端启程",
    words: [
      ["Let's", 43.734, 44.206],
      ["start", 44.206, 44.431],
      ["at", 44.431, 44.688],
      ["the", 44.903, 45.198],
      ["rainbow", 45.198, 46.23],
    ],
  },
  {
    startTime: 46.613,
    endTime: 47.606,
    en: "Turn away",
    zh: "转身走开吧",
    words: [
      ["Turn", 46.613, 47.142],
      ["away", 47.142, 47.606],
    ],
  },
  {
    startTime: 47.985,
    endTime: 52.374,
    en: "Another way to be where you didn't want yourself to go",
    zh: "另一种方法前往你不愿涉足半步的天地",
    words: [
      ["Another", 47.985, 48.549],
      ["way", 48.549, 48.805],
      ["to", 48.805, 49.073],
      ["be", 49.073, 49.534],
      ["where", 49.534, 49.749],
      ["you", 49.749, 50.03],
      ["didn't", 50.03, 50.478],
      ["want", 50.478, 50.726],
      ["yourself", 50.726, 51.406],
      ["to", 51.406, 51.654],
      ["go", 51.654, 52.374],
    ],
  },
  {
    startTime: 52.374,
    endTime: 53.868,
    en: "Let yourself go",
    zh: "释放自我吧",
    words: [
      ["Let", 52.374, 52.644],
      ["yourself", 52.644, 53.357],
      ["go", 53.357, 53.868],
    ],
  },
  {
    startTime: 55.045,
    endTime: 58.148,
    en: "Is that a compromise",
    zh: "这算是选择妥协吗",
    words: [
      ["Is", 55.045, 55.285],
      ["that", 55.285, 55.53],
      ["a", 55.53, 55.814],
      ["compromise", 55.814, 58.148],
    ],
  },
  {
    startTime: 60.365,
    endTime: 64.023,
    en: "So what do you wanna do what's your point of view",
    zh: "所以你想做什么 你的看法是什么",
    isChorus: true,
    words: [
      ["So", 60.365, 60.597],
      ["what", 60.597, 60.813],
      ["do", 60.813, 61.053],
      ["you", 61.053, 61.357],
      ["wanna", 61.357, 61.974],
      ["do", 61.974, 62.484],
      ["what's", 62.484, 62.7],
      ["your", 62.7, 63.24],
      ["point", 63.24, 63.709],
      ["of", 63.709, 63.949],
      ["view", 63.949, 64.023],
    ],
  },
  {
    startTime: 64.384,
    endTime: 67.68,
    en: "There's a party soon do you wanna go",
    zh: "派对即将拉开序幕 你是否愿意参加",
    isChorus: true,
    words: [
      ["There's", 64.384, 64.621],
      ["a", 64.621, 65.062],
      ["party", 65.062, 65.83],
      ["soon", 65.83, 66.326],
      ["do", 66.326, 66.557],
      ["you", 66.557, 66.784],
      ["wanna", 66.784, 67.11],
      ["go", 67.11, 67.68],
    ],
  },
  {
    startTime: 68.247,
    endTime: 72.139,
    en: "A handshake with you what's your point of view",
    zh: "与你握手问好 你的看法是什么",
    isChorus: true,
    words: [
      ["A", 68.247, 68.399],
      ["handshake", 68.399, 69.48],
      ["with", 69.48, 69.729],
      ["you", 69.729, 70.198],
      ["what's", 70.198, 70.433],
      ["your", 70.433, 70.91],
      ["point", 70.91, 71.351],
      ["of", 71.351, 71.614],
      ["view", 71.614, 72.139],
    ],
  },
  {
    startTime: 72.139,
    endTime: 75.286,
    en: "I'm on top of you I don't wanna go",
    zh: "我和你依偎在一起 我不愿离开",
    isChorus: true,
    words: [
      ["I'm", 72.139, 72.342],
      ["on", 72.342, 72.849],
      ["top", 72.849, 73.255],
      ["of", 73.255, 73.512],
      ["you", 73.512, 73.999],
      ["I", 73.999, 74.224],
      ["don't", 74.224, 74.471],
      ["wanna", 74.471, 74.959],
      ["go", 74.959, 75.286],
    ],
  },
  {
    startTime: 75.496,
    endTime: 79.513,
    en: "'Cause I really wanna stay at your house",
    zh: "因为我真心希望待在你的家里",
    isChorus: true,
    words: [
      ["'Cause", 75.496, 75.705],
      ["I", 75.705, 75.935],
      ["really", 75.935, 76.39],
      ["wanna", 76.39, 76.983],
      ["stay", 76.983, 77.247],
      ["at", 77.247, 77.622],
      ["your", 77.622, 78.214],
      ["house", 78.214, 79.513],
    ],
  },
  {
    startTime: 79.513,
    endTime: 82.234,
    en: "And I hope this works out",
    zh: "我希望能够得偿所愿",
    isChorus: true,
    words: [
      ["And", 79.513, 79.759],
      ["I", 79.759, 80.288],
      ["hope", 80.288, 80.818],
      ["this", 80.818, 81.223],
      ["works", 81.223, 81.658],
      ["out", 81.658, 82.234],
    ],
  },
  {
    startTime: 83.053,
    endTime: 85.975,
    en: "But you know how much you broke me apart",
    zh: "但你知道你让我伤心欲绝",
    isChorus: true,
    words: [
      ["But", 83.053, 83.325],
      ["you", 83.325, 83.637],
      ["know", 83.637, 83.942],
      ["how", 83.942, 84.125],
      ["much", 84.125, 84.325],
      ["you", 84.325, 84.556],
      ["broke", 84.556, 84.836],
      ["me", 84.836, 85.176],
      ["apart", 85.176, 85.975],
    ],
  },
  {
    startTime: 85.975,
    endTime: 89.365,
    en: "I'm done with you I'm ignoring you",
    zh: "我跟你分道扬镳 我对你视而不见",
    isChorus: true,
    words: [
      ["I'm", 85.975, 86.262],
      ["done", 86.262, 86.718],
      ["with", 86.718, 86.965],
      ["you", 86.965, 87.461],
      ["I'm", 87.461, 87.934],
      ["ignoring", 87.934, 88.853],
      ["you", 88.853, 89.365],
    ],
  },
  {
    startTime: 89.365,
    endTime: 94.809,
    en: "I don't wanna know ah-",
    zh: "我不想知道",
    isChorus: true,
    words: [
      ["I", 89.365, 89.624],
      ["don't", 89.624, 89.96],
      ["wanna", 89.96, 90.393],
      ["know", 90.393, 91.505],
      ["ah-", 92.217, 94.809],
    ],
  },
  {
    startTime: 94.859,
    endTime: 101.315,
    en: "98.7 BODY HEAT RADIO // LUNAR ORBIT SYNTH",
    zh: "♪ 霓虹合成器间奏 · 月海轨道 ♪",
    isInterlude: true,
  },
  {
    startTime: 101.365,
    endTime: 104.713,
    en: "And I'm aware that you were lying in the gutter",
    zh: "我知道你身陷囹圄",
    words: [
      ["And", 101.365, 101.529],
      ["I'm", 101.529, 101.73],
      ["aware", 101.73, 102.142],
      ["that", 102.142, 102.357],
      ["you", 102.357, 102.626],
      ["were", 102.626, 102.841],
      ["lying", 102.841, 103.259],
      ["in", 103.259, 103.513],
      ["the", 103.513, 103.833],
      ["gutter", 103.833, 104.713],
    ],
  },
  {
    startTime: 108.868,
    endTime: 116.483,
    en: "'Cause I did everything to be there by your side-ide",
    zh: "因为我使尽浑身解数才能陪在你身边",
    words: [
      ["'Cause", 108.868, 109.061],
      ["I", 109.061, 109.277],
      ["did", 109.277, 109.524],
      ["everything", 109.524, 110.248],
      ["to", 110.248, 110.5],
      ["be", 110.5, 110.796],
      ["there", 110.796, 110.996],
      ["by", 110.996, 111.222],
      ["your", 111.222, 111.445],
      ["side-", 111.445, 111.977, 1],
      ["ide", 112.697, 116.483],
    ],
  },
  {
    startTime: 116.665,
    endTime: 122.906,
    en: "So when you tell me I'm the reason I just can't believe the lie-es",
    zh: "所以当你说我就是原因所在 我只是无法相信那些谎言",
    words: [
      ["So", 116.665, 116.825],
      ["when", 116.825, 117.026],
      ["you", 117.026, 117.252],
      ["tell", 117.252, 117.466],
      ["me", 117.466, 117.689],
      ["I'm", 117.689, 117.904],
      ["the", 117.904, 118.131],
      ["reason", 118.131, 118.611],
      ["I", 118.611, 118.841],
      ["just", 118.841, 119.145],
      ["can't", 119.145, 119.865],
      ["believe", 119.865, 120.962],
      ["the", 120.962, 121.139],
      ["lie-", 121.139, 122.237, 1],
      ["es", 122.237, 122.906],
    ],
  },
  {
    startTime: 124.091,
    endTime: 126.75,
    en: "And why do I so want to call you",
    zh: "我为什么如此渴望给你打去电话",
    words: [
      ["And", 124.091, 124.291],
      ["why", 124.291, 124.515],
      ["do", 124.515, 124.747],
      ["I", 124.747, 124.971],
      ["so", 124.971, 125.219],
      ["want", 125.219, 125.406],
      ["to", 125.406, 125.733],
      ["call", 125.733, 126.173],
      ["you", 126.173, 126.75],
    ],
  },
  {
    startTime: 126.779,
    endTime: 129.551,
    en: "Call you call you call you",
    zh: "给你打去电话",
    words: [
      ["Call", 126.779, 127.245],
      ["you", 127.245, 127.767],
      ["call", 127.767, 128.228],
      ["you", 128.228, 128.726],
      ["call", 128.726, 129.19],
      ["you", 129.19, 129.551],
    ],
  },
  {
    startTime: 129.551,
    endTime: 133.297,
    en: "So what do you wanna do what's your point of view",
    zh: "所以你想做什么 你的看法是什么",
    isChorus: true,
    words: [
      ["So", 129.551, 129.724],
      ["what", 129.724, 129.917],
      ["do", 129.917, 130.156],
      ["you", 130.156, 130.413],
      ["wanna", 130.413, 131.109],
      ["do", 131.109, 131.589],
      ["what's", 131.589, 131.812],
      ["your", 131.812, 132.341],
      ["point", 132.341, 132.782],
      ["of", 132.782, 133.004],
      ["view", 133.004, 133.297],
    ],
  },
  {
    startTime: 133.593,
    endTime: 137.106,
    en: "There's a party soon do you wanna go",
    zh: "派对即将拉开序幕 你是否愿意参加",
    isChorus: true,
    words: [
      ["There's", 133.593, 133.752],
      ["a", 133.752, 134.183],
      ["party", 134.183, 134.799],
      ["soon", 134.799, 135.368],
      ["do", 135.368, 135.594],
      ["you", 135.594, 135.852],
      ["wanna", 135.852, 136.343],
      ["go", 136.343, 137.106],
    ],
  },
  {
    startTime: 137.403,
    endTime: 141.243,
    en: "A handshake with you what's your point of view",
    zh: "与你握手问好 你的看法是什么",
    isChorus: true,
    words: [
      ["A", 137.403, 137.629],
      ["handshake", 137.629, 138.533],
      ["with", 138.533, 138.804],
      ["you", 138.804, 139.292],
      ["what's", 139.292, 139.551],
      ["your", 139.551, 140.012],
      ["point", 140.012, 140.468],
      ["of", 140.468, 140.732],
      ["view", 140.732, 141.243],
    ],
  },
  {
    startTime: 141.243,
    endTime: 144.564,
    en: "I'm on top of you I don't wanna go",
    zh: "我和你依偎在一起 我不愿离开",
    isChorus: true,
    words: [
      ["I'm", 141.243, 141.491],
      ["on", 141.491, 141.94],
      ["top", 141.94, 142.366],
      ["of", 142.366, 142.668],
      ["you", 142.668, 142.956],
      ["I", 143.149, 143.371],
      ["don't", 143.371, 143.636],
      ["wanna", 143.636, 144.124],
      ["go", 144.124, 144.564],
    ],
  },
  {
    startTime: 144.564,
    endTime: 148.156,
    en: "'Cause I really wanna stay at your house",
    zh: "因为我真心希望待在你的家里",
    isChorus: true,
    words: [
      ["'Cause", 144.564, 144.837],
      ["I", 144.837, 145.093],
      ["really", 145.093, 145.499],
      ["wanna", 145.499, 146.069],
      ["stay", 146.069, 146.38],
      ["at", 146.38, 146.661],
      ["your", 146.661, 147.301],
      ["house", 147.301, 148.156],
    ],
  },
  {
    startTime: 148.603,
    endTime: 151.372,
    en: "And I hope this works out",
    zh: "我希望能够得偿所愿",
    isChorus: true,
    words: [
      ["And", 148.603, 148.796],
      ["I", 148.796, 149.429],
      ["hope", 149.429, 149.716],
      ["this", 149.716, 150.174],
      ["works", 150.174, 150.669],
      ["out", 150.669, 151.372],
    ],
  },
  {
    startTime: 152.295,
    endTime: 155.042,
    en: "But you know how much you broke me apart",
    zh: "但你知道你让我伤心欲绝",
    isChorus: true,
    words: [
      ["But", 152.295, 152.51],
      ["you", 152.51, 152.743],
      ["know", 152.743, 152.975],
      ["how", 152.975, 153.207],
      ["much", 153.207, 153.447],
      ["you", 153.447, 153.71],
      ["broke", 153.71, 153.975],
      ["me", 153.975, 154.249],
      ["apart", 154.249, 155.042],
    ],
  },
  {
    startTime: 155.042,
    endTime: 158.461,
    en: "I'm done with you I'm ignoring you",
    zh: "我跟你分道扬镳 我对你视而不见",
    isChorus: true,
    words: [
      ["I'm", 155.042, 155.332],
      ["done", 155.332, 155.795],
      ["with", 155.979, 156.154],
      ["you", 156.154, 156.557],
      ["I'm", 156.557, 156.762],
      ["ignoring", 156.762, 158.036],
      ["you", 158.036, 158.461],
    ],
  },
  {
    startTime: 158.461,
    endTime: 163.732,
    en: "I don't wanna know ah-",
    zh: "我不想知道",
    isChorus: true,
    words: [
      ["I", 158.461, 158.683],
      ["don't", 158.683, 158.938],
      ["wanna", 158.938, 159.428],
      ["know", 159.428, 160.331],
      ["ah-", 161.091, 163.732],
    ],
  },
  {
    startTime: 163.782,
    endTime: 168.338,
    en: "NIGHT CITY // RAIN & NEON REVERB",
    zh: "♪ 雨夜残响 · 霓虹回声 ♪",
    isInterlude: true,
  },
  {
    startTime: 168.388,
    endTime: 170.629,
    en: "Oh-oh oh-oh-oh",
    zh: "噢——",
    words: [
      ["Oh-", 168.388, 168.636, 1],
      ["oh", 168.636, 168.997],
      ["oh-", 168.997, 169.375, 1],
      ["oh-", 169.375, 169.957, 1],
      ["oh", 169.957, 170.629],
    ],
  },
  {
    startTime: 171.053,
    endTime: 173.556,
    en: "I don't know why I'm no-one",
    zh: "我不想知道我一无是处的缘由",
    words: [
      ["I", 171.053, 171.216],
      ["don't", 171.216, 171.399],
      ["know", 171.399, 171.632],
      ["why", 171.632, 172.143],
      ["I'm", 172.143, 172.597],
      ["no-", 172.597, 173.068, 1],
      ["one", 173.068, 173.556],
    ],
  },
  {
    startTime: 176.23,
    endTime: 178.206,
    en: "So get away",
    zh: "所以离开吧",
    words: [
      ["So", 176.23, 176.802],
      ["get", 177.246, 177.653],
      ["away", 177.653, 178.206],
    ],
  },
  {
    startTime: 178.548,
    endTime: 182.742,
    en: "Another way to feel what you didn't want yourself to know",
    zh: "另一种方式去感知你不愿让自己面对的秘密",
    words: [
      ["Another", 178.548, 179.093],
      ["way", 179.093, 179.349],
      ["to", 179.349, 179.612],
      ["feel", 179.612, 180.076],
      ["what", 180.076, 180.341],
      ["you", 180.341, 180.502],
      ["didn't", 180.502, 180.95],
      ["want", 180.95, 181.217],
      ["yourself", 181.217, 181.934],
      ["to", 181.934, 182.207],
      ["know", 182.207, 182.742],
    ],
  },
  {
    startTime: 182.742,
    endTime: 184.414,
    en: "And let yourself go",
    zh: "释放自我吧",
    words: [
      ["And", 182.742, 182.999],
      ["let", 182.999, 183.213],
      ["yourself", 183.213, 183.838],
      ["go", 183.838, 184.414],
    ],
  },
  {
    startTime: 185.654,
    endTime: 188.886,
    en: "You know you didn't lose your self-control",
    zh: "你知道你不会失去你的自控力",
    words: [
      ["You", 185.654, 185.87],
      ["know", 185.87, 186.158],
      ["you", 186.158, 186.364],
      ["didn't", 186.364, 186.807],
      ["lose", 186.807, 187.038],
      ["your", 187.038, 187.302],
      ["self-", 187.302, 187.765, 1],
      ["control", 187.765, 188.886],
    ],
  },
  {
    startTime: 189.761,
    endTime: 192.129,
    en: "Let's start at the rainbow",
    zh: "让我们于彩虹之端启程",
    words: [
      ["Let's", 189.761, 190.216],
      ["start", 190.216, 190.592],
      ["at", 190.592, 190.793],
      ["the", 190.968, 191.16],
      ["rainbow", 191.16, 192.129],
    ],
  },
  {
    startTime: 192.617,
    endTime: 193.513,
    en: "Turn away",
    zh: "转身离开",
    words: [
      ["Turn", 192.617, 192.977],
      ["away", 192.977, 193.513],
    ],
  },
  {
    startTime: 193.928,
    endTime: 198.069,
    en: "Another way to be where you didn't want yourself to go",
    zh: "另一种方法前往你不愿涉足半步的天地",
    words: [
      ["Another", 193.928, 194.472],
      ["way", 194.472, 194.745],
      ["to", 194.745, 194.952],
      ["be", 194.952, 195.437],
      ["where", 195.437, 195.681],
      ["you", 195.681, 195.944],
      ["didn't", 195.944, 196.36],
      ["want", 196.36, 196.616],
      ["yourself", 196.616, 197.289],
      ["to", 197.289, 197.592],
      ["go", 197.592, 198.069],
    ],
  },
  {
    startTime: 198.305,
    endTime: 199.844,
    en: "Let yourself go",
    zh: "释放自我吧",
    words: [
      ["Let", 198.305, 198.559],
      ["yourself", 198.559, 199.204],
      ["go", 199.204, 199.844],
    ],
  },
  {
    startTime: 200.982,
    endTime: 204.078,
    en: "Is that a compromise",
    zh: "这算是选择妥协吗",
    words: [
      ["Is", 200.982, 201.222],
      ["that", 201.222, 201.455],
      ["a", 201.455, 201.71],
      ["compromise", 201.71, 204.078],
    ],
  },
  {
    startTime: 204.128,
    endTime: 210.014,
    en: "TRANQUILITY BASE // FINAL DROP",
    zh: "♪ 静海基地 · 终章前奏 ♪",
    isInterlude: true,
  },
  {
    startTime: 210.064,
    endTime: 214.01,
    en: "So what do you wanna do what's your point of view",
    zh: "所以你想做什么 你的看法是什么",
    isChorus: true,
    words: [
      ["So", 210.064, 210.375],
      ["what", 210.375, 210.534],
      ["do", 210.534, 210.718],
      ["you", 210.718, 210.976],
      ["wanna", 210.976, 211.687],
      ["do", 211.687, 212.238],
      ["what's", 212.238, 212.479],
      ["your", 212.479, 212.976],
      ["point", 212.976, 213.416],
      ["of", 213.416, 213.687],
      ["view", 213.687, 214.01],
    ],
  },
  {
    startTime: 214.25,
    endTime: 217.85,
    en: "There's a party soon do you wanna go",
    zh: "派对即将拉开序幕 你是否愿意参加",
    isChorus: true,
    words: [
      ["There's", 214.25, 214.433],
      ["a", 214.433, 214.828],
      ["party", 214.828, 215.53],
      ["soon", 215.53, 216.034],
      ["do", 216.034, 216.259],
      ["you", 216.259, 216.507],
      ["wanna", 216.507, 216.989],
      ["go", 216.989, 217.85],
    ],
  },
  {
    startTime: 217.89,
    endTime: 221.872,
    en: "A handshake with you what's your point of view",
    zh: "与你握手问好 你的看法是什么",
    isChorus: true,
    words: [
      ["A", 217.89, 218.218],
      ["handshake", 218.218, 219.155],
      ["with", 219.155, 219.436],
      ["you", 219.436, 219.937],
      ["what's", 219.937, 220.162],
      ["your", 220.162, 220.61],
      ["point", 220.61, 221.077],
      ["of", 221.077, 221.354],
      ["view", 221.354, 221.872],
    ],
  },
  {
    startTime: 221.872,
    endTime: 225.194,
    en: "I'm on top of you I don't wanna go",
    zh: "我和你依偎在一起 我不愿离开",
    isChorus: true,
    words: [
      ["I'm", 221.872, 222.122],
      ["on", 222.122, 222.523],
      ["top", 222.523, 222.987],
      ["of", 222.987, 223.26],
      ["you", 223.26, 223.786],
      ["I", 223.786, 224.018],
      ["don't", 224.018, 224.275],
      ["wanna", 224.275, 224.738],
      ["go", 224.738, 225.194],
    ],
  },
  {
    startTime: 225.194,
    endTime: 228.724,
    en: "'Cause I really wanna stay at your house",
    zh: "因为我真心希望待在你的家里",
    isChorus: true,
    words: [
      ["'Cause", 225.194, 225.434],
      ["I", 225.434, 225.706],
      ["really", 225.706, 226.148],
      ["wanna", 226.148, 226.682],
      ["stay", 226.682, 227.002],
      ["at", 227.002, 227.323],
      ["your", 227.323, 227.973],
      ["house", 227.973, 228.724],
    ],
  },
  {
    startTime: 229.307,
    endTime: 232.067,
    en: "And I hope this works out",
    zh: "我希望能够得偿所愿",
    isChorus: true,
    words: [
      ["And", 229.307, 229.507],
      ["I", 229.507, 230.093],
      ["hope", 230.093, 230.501],
      ["this", 230.501, 230.923],
      ["works", 230.923, 231.403],
      ["out", 231.403, 232.067],
    ],
  },
  {
    startTime: 232.801,
    endTime: 235.8,
    en: "But you know how much you broke me apart",
    zh: "但你知道你让我伤心欲绝",
    isChorus: true,
    words: [
      ["But", 232.801, 233.079],
      ["you", 233.079, 233.312],
      ["know", 233.312, 233.543],
      ["how", 233.543, 233.831],
      ["much", 233.831, 234.064],
      ["you", 234.064, 234.344],
      ["broke", 234.344, 234.593],
      ["me", 234.593, 234.911],
      ["apart", 234.911, 235.8],
    ],
  },
  {
    startTime: 235.8,
    endTime: 239.13,
    en: "I'm done with you I'm ignoring you",
    zh: "我跟你分道扬镳 我对你视而不见",
    isChorus: true,
    words: [
      ["I'm", 235.8, 236.098],
      ["done", 236.098, 236.557],
      ["with", 236.557, 236.786],
      ["you", 236.786, 237.226],
      ["I'm", 237.226, 237.468],
      ["ignoring", 237.468, 238.619],
      ["you", 238.619, 239.13],
    ],
  },
  {
    startTime: 239.13,
    endTime: 242.347,
    en: "I don't wanna know ah",
    zh: "我不想知道",
    isChorus: true,
    words: [
      ["I", 239.13, 239.364],
      ["don't", 239.364, 239.611],
      ["wanna", 239.611, 240.062],
      ["know", 240.062, 241.092],
      ["ah", 241.541, 242.347],
    ],
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
  words: seed.words
    ? buildTimedWordSpans(seed.words, seed.startTime, seed.endTime)
    : buildFallbackWordSpans(seed.en, seed.startTime, seed.endTime),
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
