import { evaluateHackTopology, type HackTopologyCheckInput } from "./netrunning";
import type { TierNumber } from "./systems/dice";
import { type DistrictSecurityInput, evaluateDistrictSecurityCheck } from "./worldClock";

/**
 * 《赛博朋克 2077：边缘账本》3.0 AI 引擎“双核铁锁”管线门面模块（Chapter 6 & Chapter 7）
 * - Step 1：前置物理边界锁定（查钱包、查显眼武器与安检着装、查网络拓扑气隙、算 2d6 检定、定战利品预算上限）
 * - Step 2：动态拼装物理边界与 `Mask vs CoreTruth` 人设上下文
 * - Step 3：动态字数弹性锁（日常交谈 150~300 字 / 交火高潮 500~800 字）与叙事尺度自适应
 * - Step 4：后台异步记账与自然分钟时钟/同行涟漪推演
 */

export interface LootBudgetCap {
  readonly maxItemTier: TierNumber;
  readonly maxEddies: number;
  readonly directive: string;
}

const LOOT_CAPS: Readonly<
  Record<TierNumber, { readonly maxEddies: number; readonly label: string }>
> = {
  1: { maxEddies: 150, label: "T1 街头零碎" },
  2: { maxEddies: 600, label: "T2 职业军火或芯片" },
  3: { maxEddies: 2500, label: "T3 企业/精锐级装备" },
  4: { maxEddies: 10000, label: "T4 原型机密或巨额不记名债券" },
};

/**
 * Step 1 ④：根据目标层级设定战利品合理预算上限（绝不替模型写死具体物品名称）
 */
export function computeLootBudgetCap(targetTier: TierNumber): LootBudgetCap {
  const cap = LOOT_CAPS[targetTier];
  return {
    maxItemTier: targetTier,
    maxEddies: cap.maxEddies,
    directive: `【战利品物理预算上限】若本轮搜刮或获利，价值上限为 ≤ T${targetTier} 物品（${cap.label}）/ ≤ ${cap.maxEddies}€，由叙事按现场自然演绎具体收获，严禁开空头支票`,
  };
}

export interface PhysicsLockInput {
  readonly currentEddies: number;
  readonly spendMoney?: number;
  readonly securityCheck?: DistrictSecurityInput;
  readonly hackCheck?: HackTopologyCheckInput;
  readonly lootTargetTier?: TierNumber;
}

export interface PhysicsLockResult {
  readonly blocked: boolean;
  readonly flags: readonly string[];
  readonly directives: readonly string[];
}

/**
 * Step 1：前置结算物理与硬账边界（钱够不够、枪能不能过安检、网络通不通）
 */
export function evaluatePhysicsBoundaries(input: PhysicsLockInput): PhysicsLockResult {
  const flags: string[] = [];
  const directives: string[] = [];
  let blocked = false;

  if (input.spendMoney !== undefined && input.spendMoney > input.currentEddies) {
    blocked = true;
    flags.push("[TX_DENIED]");
    directives.push(
      `【物理边界拦截 [TX_DENIED]】玩家试图花费 ${input.spendMoney}€，但当前账户仅余 ${input.currentEddies}€。交易当场被拒，请描写对方冷笑收起货品或终端弹出余额不足红字。`,
    );
  }

  if (input.securityCheck) {
    const sec = evaluateDistrictSecurityCheck(input.securityCheck);
    if (!sec.passed) {
      blocked = true;
      flags.push(`[${sec.code}]`);
      directives.push(`【物理安检拦截 [${sec.code}]】${sec.reason}`);
    } else if (sec.note) {
      directives.push(`【走私掩护生效】${sec.note}`);
    }
  }

  if (input.hackCheck) {
    const hack = evaluateHackTopology(input.hackCheck);
    if (!hack.allowed) {
      blocked = true;
      flags.push(`[${hack.code}]`);
      directives.push(`【网络拓扑拦截 [${hack.code}]】${hack.reason}`);
    } else {
      directives.push(`【网络入侵拓扑确认】${hack.summary}`);
    }
  }

  if (input.lootTargetTier !== undefined && !blocked) {
    directives.push(computeLootBudgetCap(input.lootTargetTier).directive);
  }

  return {
    blocked,
    flags,
    directives,
  };
}

export type NarrativeIntensity = "dialogue" | "exploration" | "climax";
export type NarrativeContentMode = "cinematicFade" | "uncensoredSensory";

/**
 * Step 3：动态字数弹性锁与尺度自适应指令
 */
export function resolveDynamicWordCountBudget(
  intensity: NarrativeIntensity,
  contentMode: NarrativeContentMode = "cinematicFade",
): {
  readonly minChars: number;
  readonly maxChars: number;
  readonly directive: string;
} {
  const range =
    intensity === "climax"
      ? { minChars: 500, maxChars: 800, label: "战斗爆发/暗杀/高潮转折（500~800 字）" }
      : intensity === "exploration"
        ? { minChars: 250, maxChars: 450, label: "街头探索/潜入踩点（250~450 字）" }
        : {
            minChars: 150,
            maxChars: 300,
            label: "日常交谈（150~300 字，自然停在 NPC 话尾与微表情处）",
          };

  const scaleNote =
    contentMode === "uncensoredSensory"
      ? "【感官直写模式】正面呈现夜之城真实的暴力创伤、霓虹肉欲与生理细节。"
      : "【电影暗场模式】暴力与亲密场面采用冷峻电影化镜头语言与留白暗场过渡。";

  return {
    minChars: range.minChars,
    maxChars: range.maxChars,
    directive: `【动态篇幅锁】${range.label}。${scaleNote}`,
  };
}

export * from "./narrator";
