import {
  type DistrictLawRule,
  districtLawFor,
  normalizeDistrictId,
  type RentSettlementResult,
  settleHousingRentBill,
} from "./district-laws";
import type { WeaponConcealment } from "./systems/dice";

export {
  type DistrictLawRule,
  districtLawFor,
  normalizeDistrictId,
  type RentSettlementResult,
  settleHousingRentBill,
};

/**
 * 真实城市物理安检与租住账单压力模块：
 * - 城区显眼长枪安检与高端场所毫米波武器门禁（由 DISTRICT_LAWS 驱动，含流浪者走私暗格、安全屋豁免）
 * - 城区中文名/子区名统一映射到 canonical districtId
 * - 租住公寓周期水电房租状态核验（替换旧版孤儿 WEEKLY_LIFESTYLE_BILLS）
 */

export interface DistrictSecurityInput {
  readonly districtId: string;
  readonly weaponConcealment: WeaponConcealment;
  /** 可选：来自 content/slices.ts 的城区法制条目；省略时按默认高安区集合判定 */
  readonly districtLaw?: DistrictLawRule | undefined;
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
 * 校验城区街头显眼长枪与高档场所毫米波武器门禁（优先读取 DISTRICT_LAWS 规则）
 */
export function evaluateDistrictSecurityCheck(
  input: DistrictSecurityInput,
): DistrictSecurityResult {
  const canonicalId = normalizeDistrictId(input.districtId) ?? input.districtId;
  const forbidsLongArms =
    input.districtLaw?.forbidsOpenLongArms ??
    (canonicalId === "city-center" || canonicalId === "westbrook");
  const districtLabel =
    input.districtLaw?.name ??
    (canonicalId === "city-center"
      ? "市政中心"
      : canonicalId === "westbrook"
        ? "威斯布鲁克富人区"
        : input.districtId);
  const isLongArmVisible =
    input.weaponConcealment === "open" || input.weaponConcealment === "heavy";

  if (isLongArmVisible && input.storedInNomadSmugglingCompartment) {
    return {
      passed: true,
      note: "长枪与违禁硬件藏在改装座驾屏蔽暗格里，安检扫描没有当场揪出来",
    };
  }

  if (forbidsLongArms && isLongArmVisible && !input.inSafehouse) {
    return {
      passed: false,
      reason: `在${districtLabel}公然扛着显眼长枪或重武器走动，违反本区明火持械禁令，立刻引来巡逻安保无人机与武装警卫盘查拦截（须先放回安全屋存放箱、汽车后备箱，或只带贴身隐蔽武器）`,
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

export * from "./systems/city";
export * from "./systems/world";
