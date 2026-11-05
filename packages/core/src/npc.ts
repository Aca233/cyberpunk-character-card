import { computeNpcVectors, isCoreTruthUnlocked, type Npc, type SeedTag } from "./systems/npc";
import { periodOf } from "./systems/world";

/**
 * 《赛博朋克 2077：边缘账本》3.0 自走式 NPC 与去中心化人际引擎门面模块（Chapter 4 & Chapter 7）
 * - 三维关系向量 `{ trust, leverage, respect }`（-100 ~ +100）
 * - `Mask vs CoreTruth` 双层人格锁动态裁剪器（`trust < 40 && leverage < 40` 时隐藏真我与秘密）
 * - 现实利益/胁迫背叛判定、24 小时真实作息与电话闭门羹、同行竞争池（Rival Pool）与 `SeedTag` 路人升格机
 */

export interface CroppedNpcPersona {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly voice: string;
  readonly maskWant: string;
  readonly coreTruthUnlocked: boolean;
  readonly coreSecret: string | null;
}

/** 按 Trust/Leverage 动态裁剪 NPC 人设：未达标者仅暴露社交面具与语言指纹 */
export function cropNpcPersona(npc: Npc): CroppedNpcPersona {
  const unlocked = isCoreTruthUnlocked(npc);
  return {
    id: npc.id,
    name: npc.name,
    role: npc.role,
    voice: npc.voice,
    maskWant: npc.want,
    coreTruthUnlocked: unlocked,
    coreSecret: unlocked ? (npc.secret ?? null) : null,
  };
}

/**
 * 现实利益与胁迫背叛判定：
 * 当外部存在巨额收买或灭口胁迫（externalWeight，0~150）且大于 `trust + respect` 时，触发背叛/出卖
 */
export function evaluateBetrayal(
  npc: Pick<Npc, "affinity" | "ledger" | "known" | "vectors">,
  externalTemptationOrThreatWeight: number,
): { readonly betrayed: boolean; readonly margin: number; readonly reason: string } {
  const { trust, respect } = computeNpcVectors(npc);
  const threshold = trust + respect;
  const betrayed =
    externalTemptationOrThreatWeight > 0 && externalTemptationOrThreatWeight > threshold;
  return {
    betrayed,
    margin: externalTemptationOrThreatWeight - threshold,
    reason: betrayed
      ? `外部筹码/威胁（${externalTemptationOrThreatWeight}）压倒了信任与敬畏之和（${threshold}），触发反水出卖`
      : `信任与敬畏之和（${threshold}）抵御了外部诱惑（${externalTemptationOrThreatWeight}）`,
  };
}

/**
 * 24 小时真实作息与电话接听判定：
 * 深夜/凌晨（21:00 ~ 08:59）给非夜行职业且信任度 < 45 的人物打电话，或对方正在忙棘手活计，会转入语音信箱或被挂断
 */
export function evaluatePhoneAvailability(
  npc: Pick<Npc, "name" | "role" | "doing" | "affinity" | "ledger" | "known" | "vectors">,
  nowMinutes: number,
): { readonly answered: boolean; readonly reason?: string } {
  const period = periodOf(nowMinutes);
  const { trust, leverage } = computeNpcVectors(npc);
  const isNightOwl = /中间人|酒保|黑客|佣兵|玩偶|夜店|莫克斯/.test(npc.role);

  if ((period === "night" || period === "dawn") && !isNightOwl && trust < 45 && leverage < 40) {
    return {
      answered: false,
      reason: `正值${period === "night" ? "深夜" : "凌晨"}，${npc.name}已将私人通讯切入免打扰语音信箱（或被吵醒后不耐烦地直接挂断）`,
    };
  }
  if (npc.doing && /手术|交火|潜网|审讯|逃亡|开会/.test(npc.doing.text) && leverage < 50) {
    return {
      answered: false,
      reason: `${npc.name}此刻正忙于「${npc.doing.text}」，全息呼叫无人接听，稍后才会回拨`,
    };
  }
  return { answered: true };
}

/**
 * 路人轻量种子（SeedTag）交集记录与升格判定：
 * 当发生第 2 次重逢或玩家主动深交时，返回 `promoteToFullCard: true`
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
 * 夜之城活跃同行佣兵竞争池（Rival Merc Pool）：
 * 委托拖延过久会被他们截胡，或在现场撞车争抢同一目标
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
