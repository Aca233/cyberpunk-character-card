import { hasDeepBond, type Npc, type SeedTag } from "./systems/npc";
import { periodOf } from "./systems/world";

/**
 * 夜之城真实人际动力学门面：
 * - 表里分层（未建立深度关系或利益牵绊前，只展示社交表层诉求与防备；深交后才显露隐秘动机）
 * - 24 小时现实作息与拒接来电（不再依赖数值阈值，只看时段、职业习惯、手上正在忙的事、人情与过往经历）
 * - 路人轻量种子（SeedTag）多次碰面升格
 * （已移除 trust>=40 解锁秘密与 externalWeight > trust+respect 数学背叛公式）
 */

export interface CroppedNpcPersona {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly voice: string;
  readonly maskWant: string;
  readonly coreTruthRevealed: boolean;
  readonly coreSecret: string | null;
}

/** 裁剪给前端/非剧透视角的 NPC 人设：真正涉密前保密核心底牌 */
export function cropNpcPersona(npc: Npc): CroppedNpcPersona {
  const revealed = hasDeepBond(npc);
  return {
    id: npc.id,
    name: npc.name,
    role: npc.role,
    voice: npc.voice,
    maskWant: npc.want,
    coreTruthRevealed: revealed,
    coreSecret: revealed ? (npc.secret ?? null) : null,
  };
}

/**
 * 24 小时真实作息与全息来电接听判定：
 * - 深夜/凌晨给非夜行生计的人打电话（且非熟人紧急牵绊），对方关机或挂断
 * - 对方手上正忙着手术、交火、潜网、审讯、逃亡或开会时，无人接听
 * - 若双方记着未了的仇怨，大概率直接拉黑/不接
 */
export function evaluatePhoneAvailability(
  npc: Pick<Npc, "name" | "role" | "doing" | "met" | "relation" | "ledger" | "known">,
  nowMinutes: number,
): { readonly answered: boolean; readonly reason?: string } {
  const period = periodOf(nowMinutes);
  const isNightOwl = /中间人|酒保|黑客|佣兵|玩偶|夜店|莫克斯/.test(npc.role);
  const deep = hasDeepBond(npc);
  const hasGrudge = npc.ledger.some((e) => e.settledAt === null && e.kind === "grudge");

  if (hasGrudge && !npc.ledger.some((e) => e.settledAt === null && e.kind === "owesYou")) {
    return {
      answered: false,
      reason: `${npc.name}和你心里还记着梁子，屏幕亮了两下就直接挂断拒接了`,
    };
  }

  if ((period === "night" || period === "dawn") && !isNightOwl && !deep) {
    return {
      answered: false,
      reason: `现在是${period === "night" ? "深夜" : "凌晨"}，${npc.name}不是熬夜吃街头饭的人，这通全息呼叫直接转进了语音信箱`,
    };
  }

  if (npc.doing && /手术|交火|潜网|审讯|逃亡|开会/.test(npc.doing.text)) {
    return {
      answered: false,
      reason: `${npc.name}眼下正脱不开身（${npc.doing.text}），响了几声自动断线，得晚点再回拨`,
    };
  }

  return { answered: true };
}

/**
 * 路人轻量种子（SeedTag）交集记录与升格判定：
 * 当发生第 2 次碰面或深度交谈时，返回 `promoteToFullCard: true`
 */
export function recordSeedEncounter(
  existing: Readonly<Record<string, SeedTag>>,
  tag: Omit<SeedTag, "encounters">,
  deepInteraction = false,
): {
  readonly nextSeeds: Record<string, SeedTag>;
  readonly promoteToFullCard: boolean;
  readonly seed: SeedTag;
} {
  const prev = existing[tag.id];
  const encounters = (prev?.encounters ?? 0) + 1;
  const updated: SeedTag = {
    ...tag,
    encounters,
  };
  const promoteToFullCard = encounters >= 2 || deepInteraction;
  return {
    nextSeeds: { ...existing, [tag.id]: updated },
    promoteToFullCard,
    seed: updated,
  };
}

/**
 * 夜之城同行业生计竞争者名录（用于真实市井流言、抢单风声或场外背景交汇）
 */
export const RIVAL_MERC_POOL = [
  {
    id: "rival-brick-vance",
    name: "万斯·铁颚",
    role: "前军用科技重装雇佣兵",
    district: "圣多明戈",
    style: "重火力强攻，从不留活口",
  },
  {
    id: "rival-nyx-kuroda",
    name: "黑田·夜枭",
    role: "歌舞伎町自由潜网黑客",
    district: "沃森区",
    style: "偏爱远程瘫痪安保后悄无声息盗走芯片",
  },
  {
    id: "rival-valerie-stiletto",
    name: "“毒针”瓦莱莉",
    role: "威斯布鲁克高阶商业间谍",
    district: "威斯布鲁克",
    style: "伪装成名流混入酒会，用神经毒素完成暗杀",
  },
  {
    id: "rival-diego-coyote",
    name: "迪亚哥·郊狼",
    role: "海伍德飞车走私客",
    district: "海伍德",
    style: "擅长高架桥截车与快进快出抢劫",
  },
  {
    id: "rival-zero-ghost",
    name: "“零度”幽灵",
    role: "太平洲独行狙击手",
    district: "太平洲",
    style: "光学迷彩配电磁狙击枪，专接高危猎头单",
  },
  {
    id: "rival-kane-hound",
    name: "凯恩·猎犬",
    role: "狗镇黑市清道夫小队头目",
    district: "狗镇",
    style: "成群行动，抢夺空投箱与高价值义体",
  },
] as const;

export * from "./systems/npc";
