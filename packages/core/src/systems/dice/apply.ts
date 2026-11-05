import type { Rng } from "../../kernel/ports";
import type { DiceRoll } from "../../kernel/turnlog";
import {
  attributeToTier,
  type CheckSpec,
  classifyBonusPool,
  type Difficulty,
  type Modifier,
  OPPONENT_TIERS,
  type TierNumber,
} from "./schema";

/** 3.0 筹码分池上限：硬件池 ≤ 3，战术池 ≤ 4，合并加成上限 7 */
export const HARDWARE_CAP = 3;
export const TACTIC_CAP = 4;
export const BONUS_CAP = HARDWARE_CAP + TACTIC_CAP;
export const PENALTY_CAP = 4;
export const DV_MOD_CAP = 4;
/** 街头传说的 −2 单独计算，不占修正上限；死亡之城的 +2 算进修正上限 */
const STREET_LEGEND_DV = -2;
const DEATH_CITY_DV = 2;
/** 3.0 属性上限 10（兼顾过渡期容错读取最高 20） */
export const MAX_ATTRIBUTE = 10;

export interface CappedTotal {
  readonly items: readonly Modifier[];
  /** 截断前的合计，HUD 明细里显示被截掉了多少 */
  readonly raw: number;
  readonly total: number;
}

/** 阶级压制判定详情 */
export interface TierCrushInfo {
  readonly actorTier: TierNumber;
  readonly targetTier: TierNumber;
  readonly diff: number;
  /** 我方 > 目标时，每高 1 级获 +2 固有碾压修正（不占硬件/战术池上限） */
  readonly crushBonus: number;
  /** 我方 < 目标 1 级时，目标 DV 硬性 +3 */
  readonly crushDv: number;
  /** 我方 < 目标 ≥ 2 级时，直接触发 Gate 物理拦截（成功率 0%） */
  readonly blocked: boolean;
}

export interface PreparedCheck {
  readonly spec: CheckSpec;
  readonly attributeValue: number;
  /** 硬件池（上限 +3） */
  readonly hardwarePool: CappedTotal;
  /** 战术池（上限 +4） */
  readonly tacticPool: CappedTotal;
  /** 硬件池 + 战术池合计（兼容旧字段 bonus） */
  readonly bonus: CappedTotal;
  readonly penalty: CappedTotal;
  readonly dvMods: CappedTotal;
  /** 阶级压制详情 */
  readonly tierCrush: TierCrushInfo;
  /** 武器形态修正（如狙击远距首枪 +3 / 狭窄室内 −4） */
  readonly formMod: number;
  /** 街头传说的难度值修正 */
  readonly modeDv: number;
  /** 最终难度值 = 基础 DV + 跨级刮痧 DV + 情境 DV 修正 + 难度模式修正 */
  readonly dv: number;
  /** 检定修正总值 = 有效属性 + 阶级碾压 + 硬件池 + 战术池 + 形态修正 − 减值 */
  readonly modifier: number;
  /** 2d6 至少要掷到多少才拿到【干净利落 Clean】（Δ ≥ 0） */
  readonly need: number;
  /** 成功率（拿到 Clean 或 Costly 的概率，整数百分比；被阶级拦截时为 0%） */
  readonly chance: number;
  /** 干净利落率（Δ ≥ 0 的整数百分比） */
  readonly cleanChance: number;
}

export type PrepareResult =
  | { readonly ok: true; readonly check: PreparedCheck }
  | { readonly ok: false; readonly reason: string };

/**
 * 3.0 三段式结果档位：
 * - clean（Δ ≥ 0 或双 6 大成功）：干净利落，推进 +2，无额外代价
 * - costly（-3 ≤ Δ ≤ -1）：惨胜（事办成了，但带刺！），推进 +1，伴随 1 项合理代价
 * - fail（Δ ≤ -4 或双 1 大失败）：搞砸，推进 0，风险 +2 或受重创
 */
export type CheckBand = "clean" | "costly" | "fail";

/** 细分结果（含双 6 大成功 critical、双 1 大失败 fumble、惨胜 costly） */
export type CheckOutcome = "critical" | "success" | "costly" | "failure" | "fumble";

export interface CheckResult {
  readonly faces: readonly number[];
  /** 2d6 骰面合计（2~12） */
  readonly roll: number;
  readonly total: number;
  readonly dv: number;
  /** 差值 Δ = total - dv */
  readonly delta: number;
  /** 三段式裁定档位：clean / costly / fail */
  readonly band: CheckBand;
  readonly outcome: CheckOutcome;
  /** 后台黑箱推进值增量（痛脚暴击成功时直接拉满） */
  readonly progressDelta: number;
  /** 后台黑箱风险/警戒值增量 */
  readonly riskDelta: number;
  /** 武器科技与形态触发的特殊战术标签 */
  readonly tacticalTags?: readonly string[];
}

function capTotal(items: readonly Modifier[], limit: number): CappedTotal {
  const raw = items.reduce((sum, item) => sum + item.value, 0);
  return { items, raw, total: Math.min(raw, limit) };
}

/** 计算阶级压制（Tier Crush） */
export function computeTierCrush(actorTier: TierNumber, targetTier: TierNumber): TierCrushInfo {
  const diff = actorTier - targetTier;
  if (diff > 0) {
    return {
      actorTier,
      targetTier,
      diff,
      crushBonus: diff * 2,
      crushDv: 0,
      blocked: false,
    };
  }
  if (diff === -1) {
    return {
      actorTier,
      targetTier,
      diff,
      crushBonus: 0,
      crushDv: 3,
      blocked: false,
    };
  }
  if (diff <= -2) {
    return {
      actorTier,
      targetTier,
      diff,
      crushBonus: 0,
      crushDv: 0,
      blocked: true,
    };
  }
  return {
    actorTier,
    targetTier,
    diff: 0,
    crushBonus: 0,
    crushDv: 0,
    blocked: false,
  };
}

/** 算出难度值、检定值和成功率；档位不对或属性越界时拒绝 */
export function prepareCheck(
  spec: CheckSpec,
  attributeValue: number,
  mode: Difficulty,
): PrepareResult {
  if (!Number.isInteger(attributeValue) || attributeValue < 1 || attributeValue > 20) {
    return { ok: false, reason: `属性值必须是 1–${MAX_ATTRIBUTE} 的整数：${attributeValue}` };
  }
  const normalizedAttr = Math.min(MAX_ATTRIBUTE, attributeValue);
  const tier = OPPONENT_TIERS[spec.tier];
  const [min, max] = tier.dv;
  if (spec.dv < min || spec.dv > max) {
    return { ok: false, reason: `${tier.label}的难度值应在 ${min}–${max} 之间，给的是 ${spec.dv}` };
  }
  if (spec.limb === true && spec.damage !== "lethal") {
    return { ok: false, reason: "断肢风险只能和致命档（damage: lethal）一起写" };
  }

  // 智能武器（Smart）：若目标未开启智能干扰器且我方装有智能连接，取【智力】与【反应】较高者
  let effectiveAttr = normalizedAttr;
  const smartActive =
    spec.weaponTech === "smart" && spec.hasSmartLink !== false && !spec.targetSmartJammer;
  if (smartActive) {
    effectiveAttr = Math.max(
      effectiveAttr,
      spec.intelligenceValue ?? effectiveAttr,
      spec.reflexesValue ?? effectiveAttr,
    );
  }

  // 队友代投：在场队友对应属性高于玩家时，直接由队友出手；否则提供 +1 协战
  const bonusItems: Modifier[] = [...spec.bonuses];
  if (spec.squadAssist) {
    if (spec.squadAssist.attributeValue > effectiveAttr) {
      effectiveAttr = spec.squadAssist.attributeValue;
    } else {
      bonusItems.push({
        source: `队友协战：${spec.squadAssist.name}`,
        value: 1,
        reason: "在场队友提供协战支援",
        pool: "tactic",
      });
    }
  }

  // 分池计算：硬件池（≤3）与战术池（≤4）
  const hardwareItems = bonusItems.filter((m) => classifyBonusPool(m) === "hardware");
  const tacticItems = bonusItems.filter((m) => classifyBonusPool(m) === "tactic");
  const hardwarePool = capTotal(hardwareItems, HARDWARE_CAP);
  const tacticPool = capTotal(tacticItems, TACTIC_CAP);
  const bonus: CappedTotal = {
    items: bonusItems,
    raw: hardwarePool.raw + tacticPool.raw,
    total: hardwarePool.total + tacticPool.total,
  };

  const penalty = capTotal(spec.penalties, PENALTY_CAP);

  // 物理装甲穿深 vs 社会/权限层级压制：
  // 若指定了目标物理装甲（targetArmor），按真实物理穿甲结算（西装高管 targetArmor=0 绝不会因社会地位高而肉身防弹）
  const actorTier = spec.actorTier ?? attributeToTier(effectiveAttr);
  let tierCrush: TierCrushInfo;
  if (spec.targetArmor !== undefined) {
    const basePen = spec.weaponPenetration ?? 1;
    const effectivePen = Math.min(
      4,
      basePen + (spec.weaponTech === "tech" && spec.scannedTarget ? 1 : 0),
    ) as TierNumber;
    if (spec.targetArmor === 0) {
      // 无甲肉身/便服：任何致命武器均无装甲阻碍
      tierCrush = {
        actorTier: effectivePen,
        targetTier: 1,
        diff: effectivePen - 1,
        crushBonus: effectivePen > 1 ? 2 : 0,
        crushDv: 0,
        blocked: false,
      };
    } else if (spec.targetArmor === 3 && effectivePen <= 1) {
      // 轻武器正面射击重型外骨骼/机甲：物理跳弹拦截
      tierCrush = {
        actorTier: effectivePen,
        targetTier: 4,
        diff: -2,
        crushBonus: 0,
        crushDv: 0,
        blocked: true,
      };
    } else if (spec.targetArmor > effectivePen) {
      // 穿深不足（如普通手枪打重型皮下护甲）：DV 硬性 +3
      tierCrush = {
        actorTier: effectivePen,
        targetTier: (spec.targetArmor + 1) as TierNumber,
        diff: -1,
        crushBonus: 0,
        crushDv: 3,
        blocked: false,
      };
    } else {
      const diff = effectivePen - spec.targetArmor;
      tierCrush = {
        actorTier: effectivePen,
        targetTier: spec.targetArmor as TierNumber,
        diff,
        crushBonus: diff > 0 ? 2 : 0,
        crushDv: 0,
        blocked: false,
      };
    }
  } else {
    tierCrush = computeTierCrush(actorTier, tier.tierNumber);
  }

  // 智能武器遭遇光学迷彩或智能信号干扰器时，制导偏转 −2
  const formMod = spec.weaponTech === "smart" && spec.targetSmartJammer ? -2 : 0;

  const dvItems: Modifier[] = [...spec.dvMods];
  if (mode === "deathCity") {
    dvItems.push({ source: "difficulty", value: DEATH_CITY_DV, reason: "死亡之城难度" });
  }
  const dvMods = capTotal(dvItems, DV_MOD_CAP);
  const modeDv = mode === "streetLegend" ? STREET_LEGEND_DV : 0;
  const dv = spec.dv + tierCrush.crushDv + dvMods.total + modeDv;
  const modifier = effectiveAttr + tierCrush.crushBonus + bonus.total + formMod - penalty.total;
  const need = dv - modifier;

  const cleanChance = tierCrush.blocked ? 0 : successChance(need, spec);
  // 惨胜线（Δ ≥ -3）作为广义办成事的概率
  const chance = tierCrush.blocked ? 0 : successChance(need - 3, spec);

  return {
    ok: true,
    check: {
      spec,
      attributeValue: effectiveAttr,
      hardwarePool,
      tacticPool,
      bonus,
      penalty,
      dvMods,
      tierCrush,
      formMod,
      modeDv,
      dv,
      modifier,
      need,
      chance,
      cleanChance,
    },
  };
}

/** 2d6 骰面求和（兼容旧日志单颗或爆骰记录） */
export function faceTotal(faces: readonly number[]): number {
  if (faces.length === 0) throw new Error("没有骰面");
  for (const face of faces) {
    if (!Number.isInteger(face) || face < 1 || face > 10) {
      throw new Error(`骰面必须是正整数：${face}`);
    }
  }
  return faces.reduce((sum, f) => sum + f, 0);
}

/**
 * 2d6 钟形曲线概率计算（枚举 6×6 = 36 种组合，换算为 0~100 整数百分比）：
 * - 双 6 (6,6) 恒为大成功
 * - 双 1 (1,1) 恒为大失败（除非装有未被干扰的 Smart 智能武器）
 */
export function successChance(need: number, spec?: Partial<CheckSpec>): number {
  const smartImmune =
    spec?.weaponTech === "smart" && spec?.hasSmartLink !== false && !spec?.targetSmartJammer;
  let wins = 0;
  for (let d1 = 1; d1 <= 6; d1 += 1) {
    for (let d2 = 1; d2 <= 6; d2 += 1) {
      if (d1 === 6 && d2 === 6) {
        wins += 1;
        continue;
      }
      if (d1 === 1 && d2 === 1 && !smartImmune) {
        continue;
      }
      if (d1 + d2 >= need) {
        wins += 1;
      }
    }
  }
  return Math.round((wins / 36) * 100);
}

/** 掷 2d6（两颗六面骰） */
export function rollFaces(rng: Rng): number[] {
  return [rng.roll(6), rng.roll(6)];
}

/**
 * 按已有 2d6 骰面结算三段式结果（Clean / Costly / Fail）与物理武器特性
 */
export function resolveCheck(check: PreparedCheck, faces: readonly number[]): CheckResult {
  const { spec, tierCrush } = check;
  const roll = faceTotal(faces);
  const isDoubleSix = faces.length >= 2 && faces[0] === 6 && faces[1] === 6;
  const rawDoubleOne = faces.length >= 2 && faces[0] === 1 && faces[1] === 1;
  const smartImmune =
    spec.weaponTech === "smart" && spec.hasSmartLink !== false && !spec.targetSmartJammer;
  const isDoubleOne = rawDoubleOne && !smartImmune;

  const total = roll + check.modifier;
  const delta = total - check.dv;

  const tacticalTags: string[] = [];
  if (spec.weaponTech === "smart" && spec.targetSmartJammer) {
    tacticalTags.push("【智能信号干扰】目标装有干扰器或光学迷彩，微陀螺制导弹道偏转");
  } else if (rawDoubleOne && smartImmune) {
    tacticalTags.push("【智能制导修正】微陀螺弹头自动修正手滑偏差");
  }

  let band: CheckBand;
  let outcome: CheckOutcome;

  if (tierCrush.blocked) {
    band = "fail";
    outcome = "failure";
    if (spec.targetArmor !== undefined) {
      tacticalTags.push("【装甲跳弹拦截】轻武器无法击穿目标的重型外骨骼装甲");
    } else {
      tacticalTags.push(
        `【层级拦截】我方条件(T${tierCrush.actorTier})远低于目标门槛(T${tierCrush.targetTier})，无法强行突破`,
      );
    }
  } else if (isDoubleSix) {
    band = "clean";
    outcome = "critical";
  } else if (isDoubleOne) {
    band = "fail";
    outcome = "fumble";
  } else if (delta >= 0) {
    band = "clean";
    outcome = "success";
  } else if (delta >= -3) {
    band = "costly";
    outcome = "costly";
  } else {
    band = "fail";
    outcome = "failure";
  }

  // 后台态势推进与暴露风险变化
  let progressDelta = band === "clean" ? 2 : band === "costly" ? 1 : 0;
  let riskDelta = band === "clean" ? 0 : band === "costly" ? 1 : 2;

  // 针对真实弱点/把柄下手：大幅瓦解目标防线
  if (spec.weakpointStrike && band !== "fail") {
    progressDelta += 2;
    tacticalTags.push("【直击软肋】精准利用目标暴露的弱点或把柄");
  }

  // 真实武器物理特性
  if (spec.weaponTech === "power" && band === "costly") {
    tacticalTags.push("【动能跳弹/压制】大口径动能弹道迫使目标缩回掩体");
  }
  if (spec.weaponTech === "tech" && spec.scannedTarget && band === "costly") {
    riskDelta = 0;
    tacticalTags.push("【电磁穿墙】借助义眼扫描隔着掩体蓄力击穿目标，自身未暴露于反击火力下");
  }

  // 声学动静特征
  if (spec.weaponNoise === "silent" && band === "clean") {
    riskDelta = 0;
    tacticalTags.push("【无声处决】消音器械或利刃未惊动隔间与周围安保");
  } else if (spec.weaponNoise === "explosive") {
    riskDelta += 2;
    tacticalTags.push("【剧烈爆炸】震耳欲聋的爆破声惊动整片街区并触发安保响应");
  }

  return {
    faces: [...faces],
    roll,
    total,
    dv: check.dv,
    delta,
    band,
    outcome,
    progressDelta,
    riskDelta,
    ...(tacticalTags.length > 0 ? { tacticalTags } : {}),
  };
}

export function rollCheck(check: PreparedCheck, rng: Rng): CheckResult {
  return resolveCheck(check, rollFaces(rng));
}

/** 3.0 检定直接入口：一步完成准备与 2d6 掷骰结算 */
export function roll2d6TierCheck(
  spec: CheckSpec,
  attributeValue: number,
  rng: Rng,
  mode: Difficulty = "nightCity",
): { readonly prepared: PreparedCheck; readonly result: CheckResult } | { readonly error: string } {
  const prep = prepareCheck(spec, attributeValue, mode);
  if (!prep.ok) return { error: prep.reason };
  return { prepared: prep.check, result: rollCheck(prep.check, rng) };
}

/**
 * 事是否办成：Clean（critical/success）与 Costly（惨胜：事办成了，但带刺）均视为行动达成意图；
 * 只有 Fail（failure/fumble）为企图落空
 */
export function isSuccess(outcome: CheckOutcome): boolean {
  return outcome === "critical" || outcome === "success" || outcome === "costly";
}

/** 是否干净利落无代价达成 */
export function isCleanSuccess(outcome: CheckOutcome): boolean {
  return outcome === "critical" || outcome === "success";
}

/** 写进回合日志的 2d6 掷骰记录；调模型之前先落盘 */
export function diceRecord(check: PreparedCheck, result: CheckResult): DiceRoll {
  return { purpose: `check:${check.spec.attribute}`, sides: 6, faces: [...result.faces] };
}
