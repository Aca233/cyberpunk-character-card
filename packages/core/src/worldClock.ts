import type { Rng } from "./kernel/ports";
import type { CorpoRank } from "./state";
import type { WeaponConcealment } from "./systems/dice";
import type { StyleTag } from "./systems/inventory";

/**
 * 《赛博朋克 2077：边缘账本》3.0 去中心化城市物理法则与时钟引擎门面模块（Chapter 3, 5 & 7）
 * - 自然时间流逝（按分钟推进）、睡眠剥夺疲劳与黑蕾丝化学成瘾
 * - 城区安检、显眼长枪拦截与高端场所着装门禁（含流浪者改装车走私暗格免检）
 * - 真实企业科层清算（基层 KPI 垫底 -> HR 冻结账户+收回公寓+远程锁死产权义体；仅窃密/叛逃才派反情报灭口）
 * - 黑市二手拆机义体 25% 硬件隐患与每 7 天阶层账单结算
 */

export interface DistrictSecurityInput {
  readonly districtId: string;
  readonly weaponConcealment: WeaponConcealment;
  readonly styleTag: StyleTag;
  readonly enteringHighEndVenue?: boolean;
  /** 是否正通过狗镇大门或公司边境检查站，且违禁品已放入流浪者改装车【走私暗格】 */
  readonly storedInNomadSmugglingCompartment?: boolean;
  /** 角色是否持有 C3 及以上企业高管通行证 */
  readonly corpoRank?: CorpoRank;
}

export type DistrictSecurityResult =
  | { readonly passed: true; readonly note?: string }
  | {
      readonly passed: false;
      readonly code: "SECURITY_OPEN_WEAPON" | "VENUE_DRESS_GATE" | "CHECKPOINT_CONTRABAND";
      readonly reason: string;
    };

/**
 * 校验城区街头显眼武器与高档场所着装安检
 */
export function evaluateDistrictSecurityCheck(
  input: DistrictSecurityInput,
): DistrictSecurityResult {
  const highSecurity = input.districtId === "city-center" || input.districtId === "westbrook";
  const isLongArmVisible =
    input.weaponConcealment === "open" || input.weaponConcealment === "heavy";

  if (isLongArmVisible && input.storedInNomadSmugglingCompartment) {
    return {
      passed: true,
      note: "长枪与违禁军火已藏入改装座驾的屏蔽走私暗格，顺利混过检查站扫描",
    };
  }

  if (highSecurity && isLongArmVisible) {
    return {
      passed: false,
      code: "SECURITY_OPEN_WEAPON",
      reason: `在${input.districtId === "city-center" ? "市政中心" : "威斯布鲁克高档区"}公开拎着显眼长武器上街，当场触发街头安保无人机锁定与巡警拦截（需先把长枪存入汽车后备箱，仅携贴身手枪或隐蔽武器行动）`,
    };
  }

  if (input.enteringHighEndVenue) {
    const hasHighCorpoPass =
      input.corpoRank === "C3" || input.corpoRank === "C4" || input.corpoRank === "C5";
    const properAttire = input.styleTag === "neomilitarism" || input.styleTag === "neokitsch";
    if (!properAttire && !hasHighCorpoPass) {
      return {
        passed: false,
        code: "VENUE_DRESS_GATE",
        reason:
          "着装不符合大厦/高端会所门禁要求：门卫与礼宾扫描仪直接将你拦在门外（需换穿【新军权】公司正装、【新刻奇】权贵礼服，或出示 C3 以上高管工牌）",
      };
    }
    if (input.weaponConcealment !== "pocket") {
      return {
        passed: false,
        code: "SECURITY_OPEN_WEAPON",
        reason:
          "会所门口的毫米波安检门报警：除贴身可藏的微型武器或体内隐蔽义体外，外置枪械一律不得带入内场",
      };
    }
  }

  return { passed: true };
}

export interface CorpoAssessmentInput {
  readonly rank: CorpoRank;
  readonly kpi: number;
  readonly stoleClassifiedData?: boolean;
  readonly embezzledSlushFund?: boolean;
  readonly holdsExecutiveBlackmail?: boolean;
}

export type CorpoAssessmentResult =
  | { readonly status: "promoted"; readonly nextRank: CorpoRank; readonly summary: string }
  | { readonly status: "retained"; readonly summary: string }
  | {
      readonly status: "hrTerminated";
      readonly drmLocked: true;
      readonly penaltyDebt: number;
      readonly summary: string;
    }
  | {
      readonly status: "counterIntelHitSquad";
      readonly drmLocked: true;
      readonly summary: string;
    };

const NEXT_CORPO_RANK: Readonly<Record<CorpoRank, CorpoRank>> = {
  C1: "C2",
  C2: "C3",
  C3: "C4",
  C4: "C5",
  C5: "C5",
};

/**
 * 真实企业周期考核与人事清算逻辑（告别“基层 KPI 低就派杀手灭口”的荒诞网游逻辑）：
 * - 只有窃取核心机密、侵吞巨额公款或卷入高层黑料灭口时，反情报部才会派出清理小队；
 * - 基层/中层员工如果仅仅是 KPI 垫底（< 30），公司执行标准的冷血人事清算（HR Termination）：
 *   注销工牌、冻结薪资卡、收回公司公寓、远程激活【企业产权义体锁（DRM Lock）】并追缴违约金。
 */
export function evaluateCorpoStanding(input: CorpoAssessmentInput): CorpoAssessmentResult {
  if (input.stoleClassifiedData || input.embezzledSlushFund || input.holdsExecutiveBlackmail) {
    return {
      status: "counterIntelHitSquad",
      drmLocked: true,
      summary:
        "【公司反情报部最高追杀令】因涉嫌窃取核心资产/侵吞公款，公司已远程锁死你体内的企业产权义体，并派出反情报清理小队执行物理抹除",
    };
  }

  if (input.kpi >= 100) {
    const nextRank = NEXT_CORPO_RANK[input.rank];
    return {
      status: "promoted",
      nextRank,
      summary: `周期绩效（${input.kpi}%）达标，获准晋升至职级 ${nextRank}`,
    };
  }

  if (input.kpi < 30) {
    return {
      status: "hrTerminated",
      drmLocked: true,
      penaltyDebt: 4000,
      summary:
        "【企业人事清算（HR Termination）】因周期绩效垫底，人事部已远程注销你的工牌权限、冻结薪资账户、限期腾退公司公寓，并激活【企业产权义体锁（DRM Lock）】及 4,000€ 培训违约金账单",
    };
  }

  return {
    status: "retained",
    summary: `周期绩效（${input.kpi}%）维持原职级 ${input.rank}`,
  };
}

export type SecondhandDefectKind =
  | "none"
  | "neuralRejection"
  | "capacitorShort"
  | "corporateBeacon";

export interface SecondhandDefectResult {
  readonly hasDefect: boolean;
  readonly kind: SecondhandDefectKind;
  readonly extraHumanityCost: number;
  readonly description: string;
}

/**
 * 黑市/清道夫二手拆机义体（4折廉价货）25% 硬件隐患判定
 */
export function rollSecondhandCyberwareDefect(rng: Rng): SecondhandDefectResult {
  const roll = rng.roll(100);
  if (roll > 25) {
    return {
      hasDefect: false,
      kind: "none",
      extraHumanityCost: 0,
      description: "二手义体固件自检正常，未发现明显硬件暗桩",
    };
  }
  const sub = rng.roll(3);
  if (sub === 1) {
    return {
      hasDefect: true,
      kind: "neuralRejection",
      extraHumanityCost: 3,
      description: "【二手义体隐患·神经排异】接口残留前主人的烧灼痕迹，额外多占用 3 点人性上限",
    };
  }
  if (sub === 2) {
    return {
      hasDefect: true,
      kind: "capacitorShort",
      extraHumanityCost: 0,
      description: "【二手义体隐患·电容老化】高负荷运转或检定大失败时偶发短路电击",
    };
  }
  return {
    hasDefect: true,
    kind: "corporateBeacon",
    extraHumanityCost: 0,
    description: "【二手义体隐患·底层后门】主板未刷净原厂固件，面对企业黑客时极易被走后门锁死",
  };
}

export type HousingTier = "capsule" | "standard" | "penthouse";

export const WEEKLY_LIFESTYLE_BILLS: Readonly<
  Record<
    HousingTier,
    {
      readonly label: string;
      readonly weeklyCost: number;
      readonly includesPlatinumTrauma: boolean;
    }
  >
> = {
  capsule: {
    label: "摩天H楼胶囊公寓",
    weeklyCost: 500,
    includesPlatinumTrauma: false,
  },
  standard: {
    label: "标准独立公寓",
    weeklyCost: 2500,
    includesPlatinumTrauma: false,
  },
  penthouse: {
    label: "公司广场顶层豪宅（含创伤小组白金卡）",
    weeklyCost: 10000,
    includesPlatinumTrauma: true,
  },
};

export function settleWeeklyLifestyleBill(
  tier: HousingTier,
  currentEddies: number,
): {
  readonly paid: boolean;
  readonly cost: number;
  readonly remainingEddies: number;
  readonly evictedOrLocked: boolean;
  readonly summary: string;
} {
  const info = WEEKLY_LIFESTYLE_BILLS[tier];
  if (currentEddies >= info.weeklyCost) {
    return {
      paid: true,
      cost: info.weeklyCost,
      remainingEddies: currentEddies - info.weeklyCost,
      evictedOrLocked: false,
      summary: `已自动扣缴本周「${info.label}」租金与维护账单 ${info.weeklyCost}€`,
    };
  }
  return {
    paid: false,
    cost: info.weeklyCost,
    remainingEddies: currentEddies,
    evictedOrLocked: true,
    summary: `账户余额不足以支付「${info.label}」周账单（${info.weeklyCost}€），公寓智能门锁已亮红灯锁死并停水停电`,
  };
}

export * from "./systems/city";
export * from "./systems/world";
