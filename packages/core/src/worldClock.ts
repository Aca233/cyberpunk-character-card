import type { WeaponConcealment } from "./systems/dice";

/**
 * 真实城市物理安检与日常账单压力模块：
 * - 城区显眼长枪安检与高端场所毫米波武器门禁（含流浪者走私暗格、安全屋豁免）
 * - 住房/生活账单与断水断电门锁现实压力
 * （已移除 KPI 百分比晋升辞退公式与二手义体随机摇奖机制）
 */

export interface DistrictSecurityInput {
  readonly districtId: string;
  readonly weaponConcealment: WeaponConcealment;
  readonly enteringHighEndVenue?: boolean;
  /** 人在自己的安全屋里：不算在街区巡逻安保眼皮底下公然扛枪走动 */
  readonly inSafehouse?: boolean;
  /** 长枪或违禁品是否收在改装座驾屏蔽暗格里 */
  readonly storedInNomadSmugglingCompartment?: boolean;
}

export type DistrictSecurityResult =
  | { readonly passed: true; readonly note?: string }
  | { readonly passed: false; readonly reason: string };

/**
 * 校验城区街头显眼长枪与高档场所毫米波武器门禁
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
      note: "长枪与违禁硬件藏在改装座驾屏蔽暗格里，安检扫描没有当场揪出来",
    };
  }

  if (highSecurity && isLongArmVisible && !input.inSafehouse) {
    return {
      passed: false,
      reason: `在${input.districtId === "city-center" ? "市政中心" : "威斯布鲁克富人区"}公然扛着显眼长枪或重武器走动，立刻引来巡逻安保无人机与武装警卫盘查拦截（须先放回安全屋存放箱、汽车后备箱，或只带贴身隐蔽武器）`,
    };
  }

  if (input.enteringHighEndVenue && input.weaponConcealment !== "pocket") {
    return {
      passed: false,
      reason:
        "门口毫米波安检闸机在响：除了极其隐蔽的袖珍防身武器或体内义体，外置长枪与大件火器带不进内场",
    };
  }

  return { passed: true };
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
      summary: `已结清本周「${info.label}」租金与物业水电 ${info.weeklyCost}€`,
    };
  }
  return {
    paid: false,
    cost: info.weeklyCost,
    remainingEddies: currentEddies,
    evictedOrLocked: true,
    summary: `手头余额不够扣「${info.label}」这周房租水电（还差 ${info.weeklyCost - currentEddies}€），物业电子锁已经亮起欠费红灯并切断热水供应`,
  };
}

export * from "./systems/city";
export * from "./systems/world";
