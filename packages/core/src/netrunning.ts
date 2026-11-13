import { z } from "zod";
import type { HackingState } from "./systems/hacking";

/**
 * 真实网络拓扑与黑客物理可达性校验：
 * - 三大物理接入途径：directLink（个人连接线直插） / localSubnet（已渗透的局域子网） / wireless（近距无线扫描）
 * - 离线气隙隔离（Air-Gapped）与子网隔离的硬物理约束
 * - 纯肉体无电子接口不可快速破解，军用级硬化防火墙与神经反制风险提示
 */

export const AccessVectorSchema = z.enum(["directLink", "localSubnet", "wireless"]);
export type AccessVector = z.infer<typeof AccessVectorSchema>;

export interface HackTopologyCheckInput {
  readonly vector: AccessVector;
  /** 目标关键义体或终端是否处于离线气隙隔离状态（无线不可达） */
  readonly targetAirGapped?: boolean;
  /** 目标是否位于特定建筑内网子网中（无线访问前须先物理/节点渗透该子网） */
  readonly requiredSubnet?: string;
  readonly breachedSubnets?: readonly string[];
  /** 目标是否为纯肉体（未安装可联网的电子义体或硬件接口） */
  readonly targetUnchromed?: boolean;
  /** 侵入方是否随身装有网络接入仓（无接入仓无法发射快速破解） */
  readonly hasCyberdeck?: boolean;
  /** 目标是否带有军用/企业级硬化冰墙或敌方网络黑客驻守 */
  readonly hardenedIce?: boolean;
}

export type HackTopologyResult =
  | {
      readonly allowed: true;
      readonly summary: string;
    }
  | {
      readonly allowed: false;
      readonly reason: string;
    };

/**
 * 校验黑客入侵的物理网络拓扑可达性与硬阻挡原因
 */
export function evaluateHackTopology(input: HackTopologyCheckInput): HackTopologyResult {
  if (input.hasCyberdeck === false) {
    return {
      allowed: false,
      reason: "没有安装网络接入仓，体内缺少发信与破冰硬件，无法发起快速破解或潜网接入",
    };
  }

  if (input.targetUnchromed) {
    return {
      allowed: false,
      reason: "目标是未改装电子义体的纯肉体（或纯机械无芯片终端），无线破解程序无从注入",
    };
  }

  if (input.targetAirGapped && input.vector === "wireless") {
    return {
      allowed: false,
      reason:
        "目标处于离线气隙隔离（Air-Gapped），无线扫描无法建连，必须找物理接口或用个人连接线直插",
    };
  }

  if (
    input.requiredSubnet &&
    input.vector === "wireless" &&
    !(input.breachedSubnets ?? []).includes(input.requiredSubnet)
  ) {
    return {
      allowed: false,
      reason: `目标所在节点藏在受隔离的「${input.requiredSubnet}」内网子网里，须先通过外围接入点、摄像头或终端渗入子网`,
    };
  }

  if (input.vector === "directLink") {
    return {
      allowed: true,
      summary: input.hardenedIce
        ? "已通过个人连接线物理直插接入，但对方底层挂着军用/企业硬化冰墙，硬切可能引发高热神经灼烧与位置暴露"
        : "已通过个人连接线物理直插接入硬件节点，跳过外围无线屏障",
    };
  }

  const route =
    input.vector === "localSubnet"
      ? `经已渗入的「${input.requiredSubnet ?? "局域子网"}」内网路径切入`
      : "经近距无线链路试探侵入";

  return {
    allowed: true,
    summary: input.hardenedIce
      ? `${route}；对面有硬化冰墙或驻守黑客警戒，一旦强攻会立刻触发反追踪与神经反馈冲击`
      : `${route}，链路物理可达`,
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
