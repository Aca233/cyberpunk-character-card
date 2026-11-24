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
  /** 目标自身明确装有完好自我 ICE 或脑防线（首道破解极易被截断并触发警报/反烧） */
  readonly targetSelfIce?: boolean;
  /** 目标装有接地镀层或抗电涌重型屏蔽（对电磁短路有显著硬件抗性） */
  readonly targetSurgeShielded?: boolean;
  /** 目标装有防火涂层或军用级冗余散热（对过热有显著硬件抗性） */
  readonly targetThermalShielded?: boolean;
  /** 目标装有史诗/传说级战斗操作系统或重型军用义体（自带稳压熔断与散热冗余，单发入门破解无法一击炸缸） */
  readonly targetHighTierChrome?: boolean;
  /** 现场或所属子网存在敌方网络黑客协防（触发双向黑客对垒与反追踪） */
  readonly enemyNetrunnerPresent?: boolean;
  /** 现场涉及的电子战高危帮派/公司名称（如虎爪帮、漩涡帮、巫毒帮、荒坂等） */
  readonly hardenedFaction?: string;
  /** 侵入方自身接入仓档次：basic(白/绿入门) / pro(蓝/紫专业) / elite(金传说军用) */
  readonly playerDeckTier?: "basic" | "pro" | "elite";
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
  const deckGap =
    input.playerDeckTier === "basic"
      ? "玩家当前为入门/民用级接入仓，算力与破冰穿透力有限"
      : input.playerDeckTier === "pro"
        ? "玩家配备专业级接入仓"
        : input.playerDeckTier === "elite"
          ? "玩家配备顶级军用/传说级接入仓"
          : undefined;

  if (input.vector === "directLink") {
    notes.push(
      input.hardenedIce || input.targetSelfIce
        ? "已通过个人连接线物理直插跳过无线屏障，但对方底层挂着自我 ICE / 硬化黑冰，硬切极易引发反烧灼与位置暴露"
        : "已通过个人连接线物理直插接入硬件节点，跳过外围无线屏障",
    );
  } else {
    const route =
      input.vector === "localSubnet"
        ? `经已渗入的「${input.requiredSubnet ?? "局域子网"}」内网路径切入`
        : "经近距无线端口试探切入";
    if (input.targetSelfIce) {
      notes.push(
        `${route}；目标明确装有完好「自我 ICE / 脑防线」：首道直接上传的快速破解会被自卫冰墙自动截断或大幅削弱，并立刻拉响端口告警甚至顺着链路反烧，须先消耗/捅穿其自卫黑冰再打核心破解`,
      );
    } else if (input.hardenedIce) {
      notes.push(
        `${route}；对面挂有硬化个人黑冰、据点防火墙或驻守黑客${input.hardenedFaction ? `（${input.hardenedFaction}电子战防线）` : ""}，须先侦察/破冰再上传——无掩护硬撞极易被挡回、触发反向追踪或遭反烧`,
      );
    } else if (input.hardenedFaction) {
      notes.push(
        `${route}；现场属「${input.hardenedFaction}」地盘或武装编组，绝非裸奔民用网，据点子网常带防火墙与自我 ICE 骨干，高调上传伤害破解易拉响警报并引出驻场黑客反制`,
      );
    } else {
      notes.push(
        `${route}，无线端口可达；仍需先掠过对方个人防火墙（无自我 ICE 的街头散兵或民用端口阻力较低，但高噪伤害破解仍可能惊动同网耳目）`,
      );
    }
  }

  if (input.enemyNetrunnerPresent) {
    notes.push(
      "现场/子网存在敌方网络黑客协防：玩家发起高调破解会立刻暴露无线信号特征，敌方黑客将同步发起反追踪或快速破解反制（须在 counterHack 裁决对抗结果）",
    );
  }

  if (input.targetSurgeShielded) {
    notes.push(
      "目标装有接地镀层/抗电涌屏蔽：「电磁短路」类高压电涌会被大幅泄流削弱，无法一发直接瘫痪其核心义体",
    );
  }

  if (input.targetThermalShielded) {
    notes.push("目标装有防火涂层/隔热保护：「过热」类升温灼烧效果明显受抑，难以一发直接烧毁散热件");
  }

  if (input.targetHighTierChrome) {
    notes.push(
      `目标配备高阶军用/传说级战斗义体，自带稳压熔断与冗余散热环${deckGap ? `（${deckGap}）` : ""}：单发「过热」或「电磁短路」至多引发高温告警、短暂降频卡顿或皮表灼痛，绝不会一发直接令顶级义体炸缸报废；需先破冰并多轮压制、高阶强攻接入仓或配合实弹/近战拆毁`,
    );
  } else if (deckGap && (input.hardenedIce || input.targetSelfIce || input.enemyNetrunnerPresent)) {
    notes.push(`${deckGap}，硬撞高阶黑冰或敌方黑客时阻力与积热惩罚更重`);
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
