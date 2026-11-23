import { z } from "zod";
import { type HackingState, THERMAL_LABELS, type ThermalLevel } from "./systems/hacking";

/**
 * 真实网络拓扑与电子战物理可达性校验：
 * - 三大物理接入途径：directLink（个人连接线直插） / localSubnet（已渗透的局域子网） / wireless（近距无线扫描）
 * - 信号与漏洞硬门槛：离线气隙隔离（Air-Gapped）、端口物理离线/电磁屏蔽、纯肉体无义体、纯机械无智能芯片武器
 * - 个人黑冰/硬化防火墙反制警示、程序芯片缺失与接入仓热负荷过载风险提示
 */

export const AccessVectorSchema = z.enum(["directLink", "localSubnet", "wireless"]);
export type AccessVector = z.infer<typeof AccessVectorSchema>;

export interface HackTopologyCheckInput {
  readonly vector: AccessVector;
  /** 目标关键义体或终端是否处于离线气隙隔离或物理离线屏蔽状态（无线不可达） */
  readonly targetAirGapped?: boolean;
  /** 目标是否位于特定建筑内网子网中（无线访问前须先物理/节点渗透该子网） */
  readonly requiredSubnet?: string;
  readonly breachedSubnets?: readonly string[];
  /** 目标是否为纯肉体（未安装可联网的电子义体或硬件接口） */
  readonly targetUnchromed?: boolean;
  /** 尝试干扰的武器是否为老式纯机械土枪/无智能芯片武器/冷兵器 */
  readonly mechanicalWeaponOnly?: boolean;
  /** 侵入方是否随身装有完好网络接入仓（无接入仓无法发射快速破解） */
  readonly hasCyberdeck?: boolean;
  /** 目标是否带有军用/企业级硬化冰墙、高阶个人自卫黑冰或敌方网络黑客驻守 */
  readonly hardenedIce?: boolean;
  /** 本次试图调用但接入仓槽位尚未插装的目录程序名称（提示无法直接上传） */
  readonly missingProgramName?: string;
  /** 试图起手直放终极程序但尚未捅穿目标个人黑冰建立立足点 */
  readonly missingFootholdFor?: string;
  /** 当前接入仓与脑神经热负荷档次 */
  readonly thermalLevel?: ThermalLevel;
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
 * 校验电子战快速破解与网络入侵的物理拓扑、信号漏洞、芯片槽位与热负荷约束
 */
export function evaluateHackTopology(input: HackTopologyCheckInput): HackTopologyResult {
  if (input.hasCyberdeck === false) {
    return {
      allowed: false,
      reason: "没有安装完好的网络接入仓，体内缺少发信与破冰硬件，无法发起快速破解或潜网接入",
    };
  }

  if (input.mechanicalWeaponOnly) {
    return {
      allowed: false,
      reason:
        "目标手里是无智能芯片的纯机械武器（老式机械枪/土枪/冷兵器），不存在可注入信号的火控端口，武器故障类无线破解完全无效",
    };
  }

  if (input.targetUnchromed) {
    return {
      allowed: false,
      reason:
        "目标是未改装电子义体的纯肉体（或纯机械无芯片终端），扫描不到无线接口，破解程序无从注入",
    };
  }

  if (input.targetAirGapped && input.vector === "wireless") {
    return {
      allowed: false,
      reason:
        "目标处于物理离线屏蔽或气隙隔离（Air-Gapped），无线端口已关闭无法建连，必须换物理手段、找本地接线口或用个人连接线直插",
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

  if (input.missingProgramName) {
    return {
      allowed: false,
      reason: `接入仓槽位里没有插装「${input.missingProgramName}」程序芯片，实战无法直接调用该程序（需脱战换插或改用已插装的程序/物理手段）`,
    };
  }

  if (input.missingFootholdFor) {
    return {
      allowed: false,
      reason: `「${input.missingFootholdFor}」需要深度接管目标中枢神经，当前尚未捅穿对方个人黑冰建立入侵立足点，无法起手瞬发`,
    };
  }

  const notes: string[] = [];

  if (input.vector === "directLink") {
    notes.push(
      input.hardenedIce
        ? "已通过个人连接线物理直插跳过无线屏障，但对方底层挂着硬化黑冰/个人防火墙，硬切极易引发反烧灼与位置暴露"
        : "已通过个人连接线物理直插接入硬件节点，跳过外围无线屏障",
    );
  } else {
    const route =
      input.vector === "localSubnet"
        ? `经已渗入的「${input.requiredSubnet ?? "局域子网"}」内网路径切入`
        : "经近距无线端口试探切入";
    notes.push(
      input.hardenedIce
        ? `${route}；对面挂有高阶个人自卫黑冰、自我 ICE 或驻守黑客，先捅穿黑冰再上传——硬撞极易被挡回、暴露位置触发反向追踪或遭反烧`
        : `${route}，无线端口可达；仍需先掠过对方个人防火墙（街头民用端口破冰阻力低）`,
    );
  }

  if (input.thermalLevel === "critical") {
    notes.push(
      `接入仓热负荷已达「${THERMAL_LABELS.critical}」：神经接口发烫濒临熔毁，本轮继续强行上传会反烧大脑（流鼻血、视神经剧痛并登记头部神经创伤），建议立刻停手散热`,
    );
  } else if (input.thermalLevel === "hot") {
    notes.push(
      `接入仓热负荷已至「${THERMAL_LABELS.hot}」：连发高负载或终极程序会直接冲进过载临界反烧大脑`,
    );
  }

  return {
    allowed: true,
    summary: notes.join("；"),
  };
}

/** 判断当前地点（或任意地点）是否已接入指定局域网 */
export function hasSubnetAccess(
  state: Pick<HackingState, "breachedNetworks">,
  networkName: string,
  location?: string | null,
): boolean {
  return state.breachedNetworks.some(
    (n) =>
      n.name === networkName &&
      (location === undefined || n.location === null || n.location === location),
  );
}

export * from "./systems/hacking";
