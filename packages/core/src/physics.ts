import { evaluateHackTopology, type HackTopologyCheckInput } from "./netrunning";
import { type DistrictSecurityInput, evaluateDistrictSecurityCheck } from "./worldClock";

/**
 * 夜之城定性物理与现实约束门面：
 * - 前置核查客观硬条件：余额缺口、城区武器安检与门禁、物理气隙与网络拓扑、枪械口径与重甲错配
 * - 无预设启用时提供按气氛节律伸缩的柔性篇幅参考（启用 SillyTavern 预设时全权交由预设）
 */

export interface PhysicsLockInput {
  readonly currentEddies: number;
  readonly spendMoney?: number;
  readonly securityCheck?: DistrictSecurityInput;
  readonly hackCheck?: HackTopologyCheckInput;
  /** 随身携带过多大件（软超重）：不阻塞行动，但施加定性物理劣势引导 */
  readonly bulkyOverload?: {
    readonly count: number;
    readonly max: number;
    readonly items: readonly string[];
  };
  /** 当尝试轻武器正面硬撼重甲/机甲时，给出定性物理反馈 */
  readonly ballisticMismatch?: string;
  /** 武器声学、智能联锁与改装能力等非阻塞客观物理参考（不触发 blocked） */
  readonly weaponAdvisories?: readonly string[];
}

export interface PhysicsLockResult {
  readonly blocked: boolean;
  readonly directives: readonly string[];
}

/**
 * 汇总确定性物理与环境硬阻挡，输出纯白话客观因果供裁决与正文遵循
 */
export function evaluatePhysicsBoundaries(input: PhysicsLockInput): PhysicsLockResult {
  const directives: string[] = [];
  let blocked = false;

  if (input.spendMoney !== undefined && input.spendMoney > input.currentEddies) {
    blocked = true;
    directives.push(
      `余额不足（要花 ${input.spendMoney}€，手头只有 ${input.currentEddies}€）：交易在刷卡/核验那一步卡住，对方不会白送`,
    );
  }

  if (input.securityCheck) {
    const sec = evaluateDistrictSecurityCheck(input.securityCheck);
    if (!sec.passed) {
      blocked = true;
      directives.push(sec.reason);
    } else if (sec.note) {
      directives.push(sec.note);
    }
  }

  if (input.hackCheck) {
    const hack = evaluateHackTopology(input.hackCheck);
    if (!hack.allowed) {
      blocked = true;
      directives.push(hack.reason);
    } else {
      directives.push(hack.summary);
    }
  }

  if (input.ballisticMismatch) {
    blocked = true;
    directives.push(input.ballisticMismatch);
  }

  if (input.bulkyOverload) {
    const list =
      input.bulkyOverload.items.length > 0 ? `（${input.bulkyOverload.items.join("、")}）` : "";
    directives.push(
      `随身大件超重（带着 ${input.bulkyOverload.count}/${input.bulkyOverload.max} 件显眼大件${list}）：身上鼓囊沉重、重心受阻，翻墙、钻缝、潜行、近身闪避与高速追逐动作均吃物理劣势`,
    );
  }

  if (input.weaponAdvisories) {
    for (const note of input.weaponAdvisories) {
      if (note) directives.push(note);
    }
  }

  return {
    blocked,
    directives,
  };
}

export type NarrativeIntensity = "dialogue" | "exploration" | "climax";
export type NarrativeContentMode = "cinematicFade" | "uncensoredSensory";

/**
 * 未启用 SillyTavern 预设时的柔性节律引导（避免死板截断角色心理与五感细节）
 */
export function resolveDynamicWordCountBudget(
  intensity: NarrativeIntensity,
  contentMode: NarrativeContentMode = "uncensoredSensory",
): {
  readonly minChars: number;
  readonly maxChars: number;
  readonly directive: string;
} {
  const range =
    intensity === "climax"
      ? {
          minChars: 450,
          maxChars: 850,
          label:
            "高压冲突、枪战或情绪撕裂场景可充分铺开（约 450–850 字），写透物理碰撞、感官震颤与局面转换",
        }
      : intensity === "exploration"
        ? {
            minChars: 250,
            maxChars: 550,
            label:
              "街区穿行、踩点或暗涌试探（约 250–550 字），留出心理暗流、五感气味与夜之城背景动静",
          }
        : {
            minChars: 150,
            maxChars: 380,
            label:
              "日常闲谈与贴身交锋（约 150–380 字），写清言外之意、动作微表情后自然留给对方接话",
          };

  const scaleNote =
    contentMode === "uncensoredSensory"
      ? "伤痛、血肉撞击与感官刺激冷峻直写，不做刻意美化。"
      : "极度血腥与亲密场面保留电影化克制镜头与留白过渡。";

  return {
    minChars: range.minChars,
    maxChars: range.maxChars,
    directive: `- 节律建议：${range.label}。${scaleNote}`,
  };
}
