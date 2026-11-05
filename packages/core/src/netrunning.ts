import { z } from "zod";
import type { TierNumber } from "./systems/dice";
import type { HackingState } from "./systems/hacking";

/**
 * 《赛博朋克 2077：边缘账本》3.0 真实网络拓扑与黑客引擎门面模块（Chapter 2.2 & Chapter 7）
 * - 三大物理接入途径：directLink（个人连接线直插） / localSubnet（已渗透的局域子网） / wireless（近距无线扫描）
 * - 气隙隔离（Air-Gapped）与内网未接入物理拦截
 * - ICE 防火墙对抗与反向追踪（Trace）/ 神经反馈过载（Backfire）
 * - 硬件级快速破解与冰浴缸深潜（绝无奇幻“抹除记忆洗脑”）
 */

export const AccessVectorSchema = z.enum(["directLink", "localSubnet", "wireless"]);
export type AccessVector = z.infer<typeof AccessVectorSchema>;

export interface HackTopologyCheckInput {
  readonly vector: AccessVector;
  readonly deckTier: TierNumber;
  readonly targetIceTier: TierNumber;
  readonly baseRamCost: number;
  readonly availableRam: number;
  /** 目标关键义体或终端是否处于离线气隙隔离状态（无线不可达） */
  readonly targetAirGapped?: boolean;
  /** 目标是否位于特定建筑子网内（需先 breach 该子网或采用 directLink） */
  readonly requiredSubnet?: string;
  readonly breachedSubnets?: readonly string[];
  /** 目标是否为纯肉体（未安装对应电子义体） */
  readonly targetUnchromed?: boolean;
}

export type HackTopologyResult =
  | {
      readonly allowed: true;
      readonly ramCost: number;
      /** 是否需要掷智力对抗目标的自卫 ICE（当目标 ICE 等级 >= 接入仓等级且非直插时需检定） */
      readonly requiresIceCheck: boolean;
      readonly summary: string;
    }
  | {
      readonly allowed: false;
      readonly code: "HACK_NO_CHROME" | "HACK_AIRGAPPED" | "HACK_SUBNET_ISOLATED" | "HACK_LOW_RAM";
      readonly reason: string;
    };

/**
 * Step 1 前置验证黑客入侵的物理网络拓扑与 RAM 消耗
 */
export function evaluateHackTopology(input: HackTopologyCheckInput): HackTopologyResult {
  if (input.targetUnchromed) {
    return {
      allowed: false,
      code: "HACK_NO_CHROME",
      reason: "目标未安装可被入侵的电子义体或联网接口，黑客程序无从注入",
    };
  }

  if (input.targetAirGapped && input.vector === "wireless") {
    return {
      allowed: false,
      code: "HACK_AIRGAPPED",
      reason:
        "目标采用离线气隙隔离（Air-Gapped），无线扫描无法建立连接，必须通过个人连接线直插或物理接入点切入",
    };
  }

  if (
    input.requiredSubnet &&
    input.vector === "wireless" &&
    !(input.breachedSubnets ?? []).includes(input.requiredSubnet)
  ) {
    return {
      allowed: false,
      code: "HACK_SUBNET_ISOLATED",
      reason: `目标位于受防火墙隔离的局域子网「${input.requiredSubnet}」内，需先通过接入点、监控摄像头或终端完成子网渗透（Breach）`,
    };
  }

  // 跨级入侵高阶 ICE 时 RAM 负荷翻倍；个人连接线直插可省去外围无线握手开销
  const tierDiff = input.targetIceTier - input.deckTier;
  const multiplier = tierDiff >= 1 && input.vector !== "directLink" ? 2 : 1;
  const ramCost = input.baseRamCost * multiplier;

  if (input.availableRam < ramCost) {
    return {
      allowed: false,
      code: "HACK_LOW_RAM",
      reason: `接入仓可用 RAM 不足：突破目标 T${input.targetIceTier} 级 ICE 需 ${ramCost} 格 RAM，当前仅余 ${input.availableRam} 格`,
    };
  }

  const requiresIceCheck =
    input.targetIceTier >= 2 &&
    (input.targetIceTier > input.deckTier || input.vector === "wireless");

  return {
    allowed: true,
    ramCost,
    requiresIceCheck,
    summary:
      input.vector === "directLink"
        ? `通过个人连接线物理直插注入（耗费 ${ramCost} RAM）`
        : `通过${input.vector === "localSubnet" ? "已渗透的局域子网" : "无线链路"}发起固件入侵（耗费 ${ramCost} RAM${requiresIceCheck ? "，需突破目标自卫 ICE" : ""}）`,
  };
}

/** 判断当前地点是否已接入指定局域网 */
export function hasSubnetAccess(
  state: Pick<HackingState, "breachedNetworks">,
  networkName: string,
): boolean {
  return state.breachedNetworks.some((n) => n.name === networkName);
}

export * from "./systems/hacking";
