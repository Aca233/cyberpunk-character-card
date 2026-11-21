import type { AppearanceSelection } from "@cp/core";

/**
 * 零输入 7 部位纯物理体貌定制（BIOMETRIC SCAN）：
 * 严格不包含任何服装、外套或穿搭轮廓词，避免与实时 inventory.clothing 冲突。
 */

export type AppearancePartKey =
  | "build"
  | "hair"
  | "face"
  | "eyes"
  | "cyberwareFace"
  | "marks"
  | "grooming";

export const APPEARANCE_PART_KEYS: readonly AppearancePartKey[] = [
  "build",
  "hair",
  "face",
  "eyes",
  "cyberwareFace",
  "marks",
  "grooming",
];

export interface PhysicalOption {
  readonly id: string;
  readonly label: string;
  readonly text: string;
  readonly swatch?: string;
  readonly hint?: string;
  /** 仅在对应人称下纳入随机池（手动点击仍可选） */
  readonly randomFor?: readonly string[];
}

export const BUILD_OPTIONS: readonly PhysicalOption[] = [
  { id: "lean", label: "修长精干", text: "身形修长精干，线条利落" },
  { id: "athletic", label: "矫健匀称", text: "体格矫健匀称，肩背紧实" },
  { id: "wiry", label: "瘦削敏捷", text: "骨架偏细，身板瘦削却透着灵巧" },
  { id: "broad", label: "宽肩厚实", text: "肩宽背厚，站姿自带压迫感" },
  { id: "muscular", label: "精壮悍硕", text: "肌肉轮廓分明，块头结实悍硕" },
  { id: "petite", label: "娇小利落", text: "个头不高但比例利落，动作轻快" },
  { id: "tall", label: "高挑修硕", text: "身材高挑挺拔，在人群中一眼扎眼" },
  { id: "heavy-chrome", label: "重改骨架", text: "肩颈与四肢轮廓偏硬，看得出做过重型骨架强化" },
];

export const HAIR_STYLE_OPTIONS: readonly PhysicalOption[] = [
  { id: "undercut", label: "侧剃短发", text: "侧剃利落短发" },
  { id: "wolf-cut", label: "层次狼尾", text: "碎层次狼尾短发" },
  { id: "bob", label: "齐耳波波", text: "贴合下颌的齐耳短发" },
  { id: "long-straight", label: "垂顺长发", text: "垂落肩背的直长发" },
  { id: "high-ponytail", label: "高马尾", text: "利落扎起的高马尾" },
  { id: "messy-short", label: "凌乱碎发", text: "略显凌乱的街头碎短发" },
  { id: "slick-back", label: "大背头", text: "向后梳拢的冷硬背头" },
  { id: "buzz", label: "贴皮寸头", text: "极短的贴皮寸头" },
  { id: "braids", label: "脏辫编发", text: "紧贴头皮向后收拢的编发" },
  { id: "mohawk", label: "莫西干", text: "高耸锋利的莫西干发型" },
  { id: "shaved", label: "光头", text: "剃得干干净净的光头" },
];

export const HAIR_COLOR_OPTIONS: readonly PhysicalOption[] = [
  { id: "jet-black", label: "鸦黑", text: "鸦黑色", swatch: "#1a1c24" },
  { id: "ash-brown", label: "冷棕", text: "冷棕色", swatch: "#5a4334" },
  { id: "silver-white", label: "银白", text: "银白色", swatch: "#d6dce8" },
  { id: "neon-cyan", label: "霓虹青", text: "霓虹青色", swatch: "#5ef6ff" },
  { id: "crimson", label: "绯红", text: "绯红色", swatch: "#e63946" },
  { id: "cyber-pink", label: "赛博粉", text: "亮粉色", swatch: "#ff5ca8" },
  { id: "acid-yellow", label: "电光黄", text: "电光黄色", swatch: "#fcee0a" },
  { id: "violet", label: "暗紫", text: "暗紫色", swatch: "#9b5de5" },
  { id: "copper", label: "铜橘", text: "焦铜橘色", swatch: "#d96b27" },
  { id: "emerald", label: "毒绿", text: "荧光翠绿色", swatch: "#29ffb9" },
];

export const AGE_OPTIONS: readonly PhysicalOption[] = [
  { id: "early-20s", label: "二十出头", text: "看起来二十出头" },
  { id: "mid-20s", label: "二十五六", text: "二十五六岁模样" },
  { id: "early-30s", label: "三十上下", text: "三十岁上下" },
  { id: "late-30s", label: "近四十岁", text: "将近四十岁" },
  { id: "weathered", label: "四十开外", text: "四十开外、饱经风霜" },
];

export const FACE_OPTIONS: readonly PhysicalOption[] = [
  { id: "sharp", label: "冷峻棱角", text: "下颌线锋利，五官冷峻有棱角" },
  { id: "weary", label: "倦怠厌世", text: "眼下带淡淡倦意，神情总像没睡醒" },
  { id: "refined", label: "精致清冷", text: "眉眼精致清冷，面容疏离克制" },
  { id: "fierce", label: "悍利压迫", text: "眉骨偏高、眼神凶狠，不笑时透着煞气" },
  { id: "calm", label: "沉静寡言", text: "轮廓端正沉静，神色很难看出喜怒" },
  { id: "sly", label: "玩世痞气", text: "眉梢眼角带着几分玩世不恭的锋芒" },
  { id: "gaunt", label: "清瘦苍白", text: "面颊偏瘦、肤色偏白，颧骨线条清晰" },
  { id: "warm", label: "平易耐看", text: "五官柔和耐看，混在人群里毫不惹眼" },
];

export const EYE_OPTIONS: readonly PhysicalOption[] = [
  {
    id: "natural-dark",
    label: "深褐原生眼",
    text: "一双深褐色原生眼眸，目光沉稳",
    swatch: "#4a3222",
  },
  { id: "cold-grey", label: "冷灰原生眼", text: "冷灰色虹膜，眼神锐利冷静", swatch: "#8f9aa8" },
  {
    id: "kiroshi-cyan",
    label: "青光岐路司",
    text: "义眼虹膜泛着微弱的冰青色电子环纹",
    swatch: "#5ef6ff",
  },
  {
    id: "amber-optic",
    label: "琥珀义眼",
    text: "琥珀金色义眼在暗处隐约透出聚焦微光",
    swatch: "#f5a623",
  },
  {
    id: "crimson-scan",
    label: "猩红战术眼",
    text: "猩红色战术义眼，瞳孔内可见细密对焦环",
    swatch: "#ff3b4e",
  },
  {
    id: "heterochromia",
    label: "异色双瞳",
    text: "左右眼虹膜异色，一眼冷灰一眼淡琥珀",
    swatch: "#7dd3fc",
  },
  {
    id: "black-sclera",
    label: "全黑巩膜",
    text: "漆黑巩膜配银白瞳环，看人时压迫感十足",
    swatch: "#10131a",
  },
  {
    id: "emerald-optic",
    label: "幽绿义眼",
    text: "幽绿色义眼微微发亮，像随时在后台跑扫描",
    swatch: "#29ffb9",
  },
];

export const CYBERWARE_FACE_OPTIONS: readonly PhysicalOption[] = [
  { id: "none", label: "无明显面线", text: "脸上几乎看不出外露义体接缝" },
  { id: "cheek-seams", label: "双颊细缝", text: "双颊与下颌缘留有对称的细密镀铬接缝" },
  { id: "temple-jack", label: "太阳穴插槽", text: "太阳穴与耳后嵌着哑光黑神经插槽与微灯" },
  { id: "gold-lines", label: "鎏金面纹", text: "眉骨至颧骨嵌着纤细的鎏金义体导轨" },
  { id: "jaw-plate", label: "半颌装甲", text: "下半张脸覆着哑光碳纤与钛合金拼接下颌板" },
  { id: "eye-frame", label: "眼眶环饰", text: "眼眶外缘一圈精密钛合金环框与微型传感点" },
  { id: "neck-ports", label: "颈侧散热鳍", text: "耳后至颈侧排着一列纤细金属散热片与接口" },
];

export const MARKS_OPTIONS: readonly PhysicalOption[] = [
  { id: "brow-scar", label: "断眉旧疤", text: "一道斜切眉骨的旧刀疤" },
  { id: "cheek-scar", label: "颧骨划痕", text: "左颧骨旁留着浅淡弹片划痕" },
  { id: "neck-tattoo", label: "颈侧刺青", text: "颈侧爬满深色几何与条码刺青" },
  { id: "sleeve-tattoo", label: "小臂花臂", text: "露出的小臂覆着赛博浮世绘与电路纹身" },
  { id: "burn-mark", label: "电灼印记", text: "耳后与颈根留有老旧的高压电弧灼痕" },
  { id: "nose-bridge", label: "鼻梁横疤", text: "鼻梁上横着一道干脆利落的浅疤" },
  { id: "knuckle-marks", label: "指节老茧", text: "双手骨节粗大，虎口与指背布满细碎旧伤" },
  { id: "cyber-ink", label: "荧光微纹", text: "锁骨与太阳穴旁点缀着暗光下微亮的荧光纹饰" },
];

export const GROOMING_OPTIONS: readonly PhysicalOption[] = [
  { id: "clean", label: "干净素颜", text: "面容干净素净，没有多余修饰" },
  { id: "smoky-liner", label: "冷黑眼线", text: "眼尾抹着冷硬的深黑烟熏眼线" },
  { id: "neon-accent", label: "荧光眼角妆", text: "眼角点缀一抹霓虹色金属妆粉" },
  {
    id: "dark-lip",
    label: "暗色唇妆",
    text: "哑光深色唇妆衬得面色更加冷冽",
    randomFor: ["她", "TA"],
  },
  {
    id: "stubble",
    label: "冷硬胡茬",
    text: "下巴留着一圈修剪利落的短胡茬",
    randomFor: ["他", "TA"],
  },
  { id: "trimmed-beard", label: "络腮短须", text: "下颌蓄着打理整齐的短须", randomFor: ["他"] },
  { id: "piercings", label: "金属唇眉钉", text: "眉骨与耳廓别着几枚哑光钛合金穿环" },
];

function findOption(
  list: readonly PhysicalOption[],
  id: string | undefined,
): PhysicalOption | undefined {
  if (!id) return undefined;
  return list.find((o) => o.id === id);
}

/** 统计已定制的物理体貌部位数（0..7） */
export function appearanceFilledCount(sel?: AppearanceSelection): number {
  if (!sel) return 0;
  let count = 0;
  if (sel.build) count += 1;
  if (sel.hairStyle || sel.hairColor) count += 1;
  if (sel.age || sel.face) count += 1;
  if (sel.eyes) count += 1;
  if (sel.cyberwareFace) count += 1;
  if (sel.marks && sel.marks.length > 0) count += 1;
  if (sel.grooming) count += 1;
  return count;
}

/**
 * 将 7 部位物理体貌选择合成为流畅自然的中文外貌描写（严格 ≤ 300 字，绝不掺杂服装词）。
 */
export function synthesizeAppearanceLook(sel?: AppearanceSelection): string {
  if (!sel) return "";
  const sentences: string[] = [];

  const age = findOption(AGE_OPTIONS, sel.age);
  const build = findOption(BUILD_OPTIONS, sel.build);
  const face = findOption(FACE_OPTIONS, sel.face);
  const firstParts = [age?.text, build?.text, face?.text].filter(Boolean);
  if (firstParts.length > 0) {
    sentences.push(`${firstParts.join("，")}。`);
  }

  const hairColor = findOption(HAIR_COLOR_OPTIONS, sel.hairColor);
  const hairStyle = findOption(HAIR_STYLE_OPTIONS, sel.hairStyle);
  let hairClause = "";
  if (hairStyle?.id === "shaved") {
    hairClause = hairStyle.text;
  } else if (hairColor && hairStyle) {
    hairClause = `留着一头${hairColor.text}${hairStyle.text}`;
  } else if (hairStyle) {
    hairClause = `留着${hairStyle.text}`;
  } else if (hairColor) {
    hairClause = `发色偏${hairColor.text}`;
  }

  const eyes = findOption(EYE_OPTIONS, sel.eyes);
  const secondParts = [hairClause, eyes?.text].filter(Boolean);
  if (secondParts.length > 0) {
    sentences.push(`${secondParts.join("，")}。`);
  }

  const cwFace = findOption(CYBERWARE_FACE_OPTIONS, sel.cyberwareFace);
  const markTexts = (sel.marks ?? [])
    .map((id) => findOption(MARKS_OPTIONS, id)?.text)
    .filter((t): t is string => Boolean(t));
  const grooming = findOption(GROOMING_OPTIONS, sel.grooming);

  const detailParts: string[] = [];
  if (cwFace) detailParts.push(cwFace.text);
  if (markTexts.length > 0) detailParts.push(`身上带着${markTexts.join("与")}`);
  if (grooming) detailParts.push(grooming.text);
  if (detailParts.length > 0) {
    sentences.push(`${detailParts.join("，")}。`);
  }

  return sentences.join("").slice(0, 300);
}

function pickOne<T>(list: readonly T[], random: () => number): T | undefined {
  if (list.length === 0) return undefined;
  return list[Math.floor(random() * list.length)];
}

/** 一键随机体貌：尊重已锁定的部位，且根据人称过滤毛发/妆容随机池 */
export function randomizeAppearance(
  current: AppearanceSelection,
  locked: ReadonlySet<AppearancePartKey>,
  pronoun = "TA",
  random: () => number = Math.random,
): AppearanceSelection {
  const next: {
    build?: string | undefined;
    hairStyle?: string | undefined;
    hairColor?: string | undefined;
    age?: string | undefined;
    face?: string | undefined;
    eyes?: string | undefined;
    cyberwareFace?: string | undefined;
    marks: string[];
    grooming?: string | undefined;
  } = {
    build: current.build,
    hairStyle: current.hairStyle,
    hairColor: current.hairColor,
    age: current.age,
    face: current.face,
    eyes: current.eyes,
    cyberwareFace: current.cyberwareFace,
    marks: [...(current.marks ?? [])],
    grooming: current.grooming,
  };

  if (!locked.has("build")) {
    next.build = pickOne(BUILD_OPTIONS, random)?.id;
  }
  if (!locked.has("hair")) {
    const style = pickOne(HAIR_STYLE_OPTIONS, random);
    next.hairStyle = style?.id;
    next.hairColor = style?.id === "shaved" ? undefined : pickOne(HAIR_COLOR_OPTIONS, random)?.id;
  }
  if (!locked.has("face")) {
    next.age = pickOne(AGE_OPTIONS, random)?.id;
    next.face = pickOne(FACE_OPTIONS, random)?.id;
  }
  if (!locked.has("eyes")) {
    next.eyes = pickOne(EYE_OPTIONS, random)?.id;
  }
  if (!locked.has("cyberwareFace")) {
    next.cyberwareFace = pickOne(CYBERWARE_FACE_OPTIONS, random)?.id;
  }
  if (!locked.has("marks")) {
    const count = random() < 0.25 ? 0 : random() < 0.72 ? 1 : 2;
    const pool = [...MARKS_OPTIONS];
    const picked: string[] = [];
    while (picked.length < count && pool.length > 0) {
      const idx = Math.floor(random() * pool.length);
      const [item] = pool.splice(idx, 1);
      if (item) picked.push(item.id);
    }
    next.marks = picked;
  }
  if (!locked.has("grooming")) {
    const p = pronoun.trim() || "TA";
    const pool = GROOMING_OPTIONS.filter((o) => !o.randomFor || o.randomFor.includes(p));
    next.grooming = pickOne(pool.length > 0 ? pool : GROOMING_OPTIONS, random)?.id;
  }

  return {
    ...(next.build ? { build: next.build } : {}),
    ...(next.hairStyle ? { hairStyle: next.hairStyle } : {}),
    ...(next.hairColor ? { hairColor: next.hairColor } : {}),
    ...(next.age ? { age: next.age } : {}),
    ...(next.face ? { face: next.face } : {}),
    ...(next.eyes ? { eyes: next.eyes } : {}),
    ...(next.cyberwareFace ? { cyberwareFace: next.cyberwareFace } : {}),
    marks: next.marks,
    ...(next.grooming ? { grooming: next.grooming } : {}),
  };
}
