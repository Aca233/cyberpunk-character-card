/** 城区规范化 ID 与 DISTRICT_LAWS 规则查询；纯工具模块，不依赖任何系统切片以避免循环导入 */

export interface DistrictLawRule {
  readonly id: string;
  readonly name: string;
  readonly securityTier: 0 | 1 | 2 | 3 | 4;
  readonly forbidsOpenLongArms: boolean;
  readonly traumaCoverage: "full" | "platinumOnly" | "blocked";
  readonly lawSummary: string;
}

/** 城区中文名/常见子区名到 canonical districtId 的统一映射 */
const DISTRICT_ALIAS_MAP: Readonly<Record<string, string>> = {
  "city-center": "city-center",
  city_center: "city-center",
  市政中心: "city-center",
  市中心: "city-center",
  公司广场: "city-center",
  westbrook: "westbrook",
  威斯特布鲁克: "westbrook",
  威斯布鲁克: "westbrook",
  日本街: "westbrook",
  宪章山: "westbrook",
  北橡区: "westbrook",
  heywood: "heywood",
  海伍德: "heywood",
  watson: "watson",
  沃森: "watson",
  沃森区: "watson",
  "santo-domingo": "santo-domingo",
  santo_domingo: "santo-domingo",
  圣多明戈: "santo-domingo",
  pacifica: "pacifica",
  太平洲: "pacifica",
  dogtown: "dogtown",
  狗镇: "dogtown",
  badlands: "badlands",
  恶土: "badlands",
};

export function normalizeDistrictId(district: string | null | undefined): string | undefined {
  if (!district) return undefined;
  const trimmed = district.trim();
  return DISTRICT_ALIAS_MAP[trimmed] ?? trimmed;
}

/** 从 data.districtLaws 查找城区物理与法制规则 */
export function districtLawFor(
  data: Readonly<Record<string, unknown>> | undefined,
  district: string | null | undefined,
): DistrictLawRule | undefined {
  const id = normalizeDistrictId(district);
  if (!id) return undefined;
  const raw = data?.districtLaws;
  if (typeof raw !== "object" || raw === null) return undefined;
  const record = (raw as Record<string, unknown>)[id];
  if (typeof record !== "object" || record === null) return undefined;
  const law = record as Partial<DistrictLawRule>;
  if (
    typeof law.id !== "string" ||
    typeof law.name !== "string" ||
    typeof law.forbidsOpenLongArms !== "boolean" ||
    typeof law.lawSummary !== "string"
  ) {
    return undefined;
  }
  return law as DistrictLawRule;
}

export interface RentSettlementResult {
  readonly paid: boolean;
  readonly cost: number;
  readonly remainingEddies: number;
  readonly locked: boolean;
  readonly summary: string;
}

/** 核验租住公寓单期房租水电结算（替代旧版孤儿周账单表） */
export function settleHousingRentBill(
  homeName: string,
  rentAmount: number,
  currentEddies: number,
): RentSettlementResult {
  if (currentEddies >= rentAmount) {
    return {
      paid: true,
      cost: rentAmount,
      remainingEddies: currentEddies - rentAmount,
      locked: false,
      summary: `已结清「${homeName}」本期房租水电 ${rentAmount}€，电子门锁恢复正常通行`,
    };
  }
  return {
    paid: false,
    cost: rentAmount,
    remainingEddies: currentEddies,
    locked: true,
    summary: `手头余额不够缴「${homeName}」房租水电（还差 ${rentAmount - currentEddies}€），物业电子门锁亮起欠费红灯并切断水电，暂不可进入休息或存取存放箱`,
  };
}
