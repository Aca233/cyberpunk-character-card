import type { RuleModule } from "../../kernel/system";
import { RARITY_LABELS } from "../economy";
import { cyberwareCatalog } from "./apply";
import { type CyberwareState, SLOT_LABELS } from "./schema";

export const cyberwareRules: RuleModule<CyberwareState> = {
  id: "cyberware",
  title: "义体",
  commands: [
    "cyberware",
    "cyberware.clinic",
    "cyberware.part",
    "cyberware.service",
    "cyberware.supply",
    "cyberware.behavior",
  ],
  when: () => true,
  judge: `- 【当前状态】里的「义体」是角色身上真的装着的硬实力，写着的能力、稀有度与「义体武装度」就是真实的物理与战术代差：满身中高配/传说义体的人面对街头混混、普通帮派杂兵和常规轻武器，在反应速度、力量、抗击打和输出上应当干脆利落地碾压或轻松压制，不要为了凑“惊险感”把满义体写成跟小兵五五开或动不动就挂彩（costly/受伤）。
- 【义眼光学扫描与情报先手】：装着完好义眼时，玩家主动扫描或已扫过目标（见【人物】里「玩家已用义眼扫描此人」）会带来真实的信息与战术优势——按所装义眼型号兑现能力（如“千里目”隔墙透视伏兵、“神谕”标出敌人/监控/炮塔/陷阱、“祸兆”排爆、“2 型”夜视与识破伪装、“追猎”解算穿甲弹道、“石化鸡蛇”锁定护甲弱点）。利用扫出的弱点、监控死角、无自我 ICE 缺口或提前识破埋伏出手，应明显降低阻力、直接裁为 possible 或免于中伏。
- 只有对手确实具备匹配硬件（精英特勤、重装义体人、高阶黑客、重口径/穿甲/爆炸火力）、明显人数火力压制，或玩家自身失误/重伤/中埋伏时，才构成对等威胁；没装的义体做不到，也不算硬件优势。
- 坏着的义体修好前用不了，无法提供任何能力或硬件支持。
- 物理改造事实与真实代价：生活/时尚/感官/亲密/暗格类义体几乎不占神经负荷；若角色装了双中枢（接入仓 + 斯安威斯坦/狂暴并行）、军用重器或全身义体化（FBC），连开加速并发骇入、重伤失血、情感重创或长期断药/不做调校会真实引发过热、排异与神经症状，公司安检与日常维修成本也按实际全身镀铬程度如实呈现。
- 读到行为芯片协议或买下未安装实物都不会启用身体接管；玩家与 NPC 均可在义体医生处安装 doll-behavior-chip。行为芯片统一四态（off 清醒 / doll 玩偶托管 / protocol 改装协议 / glitch 故障被骇）：改装协议提供真实动作/表现条件，高强度或长时间运行可能引发自我抽离类神经症状且易遭敌方黑客干扰。`,
  narrate: `- 把角色身上装着的义体和「义体武装度」写实、写硬：皮下护甲弹开小口径手枪弹或只留焦痕凹坑、猩猩手臂一拳砸碎门板或打飞混混、螳螂刀/单分子线瞬秒贴身杂兵、克伦齐科夫/斯安威斯坦启动时普通敌人甚至来不及扣动扳机、光学迷彩与强化肌腱带来压倒性的机动优势。
- 义眼扫描不是摆设：玩家扫描了人物或环境后，写出岐路司 HUD 上实际跳出的读数——对方体内的植入体型号、有无自我 ICE、护甲接缝、旧伤部位、墙后热源轮廓、监控盲区或地雷绊线，并让这些情报真正帮上玩家下一步的潜入、骇入、对峙或精准打击。
- 硬件代差必须落实在结果上：满配义体收拾街头小兵就该干净利落、震慑旁人，不要强行写成苦战、狼狈闪避或莫名挨枪；真正让人绷紧神经的是重装精英、军用火力、顶级黑客、局势代价，以及高负荷/极限超载下身体自身的神经排异与反噬。
- 高压/极限负荷代价要落地：当【当前状态】标明「义体神经负荷」处于高压重改或极限超载（尤其双中枢并行、全身义体化或堆叠大量高负荷军用件）且未在压制剂药效内，刚叠装高压义体、连开加速、加速并骇入、高烈度战斗或重伤失血时，按事实写出对应的神经排异与过热感（脊柱灼痛、耳鸣、视野色散、鼻血、指尖震颤、情绪疏离或短暂失真），不要写成塞满全身军用重器却像普通人一样毫无负担。
- 买下实物、开始手术与安装完成是不同事实。按给定医生、现货、旧件去向和服务起止时刻写；正文使用同一时间，不再次累加。只有已经完成安装的零件能提供能力。询价不成交，缺钱不自动赊账，黑市来源不强制造成故障。
- 行为芯片依四态运行，安全词可随时中止托管切回 off；托管切回 off 时默认保留记忆断层，设备日志查阅不会恢复亲历记忆，也不会替玩家决定感情或台词。`,
  text: `- 【当前状态】里的「义体」是角色身上真的装着的东西，写着的能力角色真的做得到：装着螳螂刀就能爬墙，装着义眼就能扫描，不用再问；没装的义体角色做不到。
- cyberware：buy 只买下实物；install 购买并安装，或 part 指定自己实际持有的零件；remove 拆下；repair 修复已损坏的装机或自带件；repay 还清指定医生欠款。doc、id 和授权时间来自共同报价，不写任意 price，不另发 money/trade 重复收费。议价引用双方已确认的 offer。
- 满位必须指定 replace；拆卸或替换必须明确 disposition:keep（旧件带走）、sell（出售回诊所）、scrap（报废），不能自行选最早旧件或出售。tradeIn:true 也是出售旧件授权，不能与 keep/scrap 同写。未安装实物记录在「未安装义体」里，不能当作身体能力。
- 预约与复杂手术使用 cyberware.service：book 只预约；start 才付款并交接实物/拆旧；complete 按原结束时刻完成。中断只在真实事件发生时 interrupt，resume 继续剩余时间，cancel 保留已付款和实际实物去向，不自动退款或复原身体。开始、继续和取消须有玩家意图，不能靠抽取擅自替玩家接受手术。
- cyberware.part 记录有来源的捡拾、赠与、转交和检测：从诊所批量现货实际取走用 takeStock 并写 from 诊所，扣同一库存；已有独立实物用 transfer，不能 record 复制同一件。已安装或进行中手术的实物不能直接拿走；取消/中断后仍须实际交回。
- cyberware.clinic 只记真实营业、人员、设备变化；cyberware.supply 只登记已确认供货方、物件、路线和到达时刻，正常到货由本地时间结算。未到货不能先卖，重访不补满，封路只影响途经的订单。
- 缺钱且玩家明确接受欠款才写 credit:true；多笔欠款合计不超过医生实际信用额度。只有约定期限才生成到期事项，不自行统一七天。安装零负荷义体不引发症状；但若角色处于高压/极限神经负荷且正文实际写出了排异、耳鸣色散、鼻血过载、失真或解离等症状，必须同步发 humanity affect 记账。
- 玩家本人已安装的行为芯片用 cyberware.behavior 切换四态：mode 写 off / doll / protocol（须写 protocol 协议名）/ glitch；log 记非清醒态下设备留下的摘要，review 记清醒态下本人查阅。NPC 对应 npcBehavior。`,
};

const cyberwareRenderCache = new WeakMap<object, Map<boolean, string>>();

/** 义体表：和物品表一样放在系统提示词末尾，按部位分组 */
export function cyberwareSection(
  data: Readonly<Record<string, unknown>>,
  includeAbilities = true,
): string | undefined {
  const raw = data.cyberware;
  if (typeof raw === "object" && raw !== null) {
    const hit = cyberwareRenderCache.get(raw)?.get(includeAbilities);
    if (hit !== undefined) return hit;
  }
  const parts = [...cyberwareCatalog(data).values()];
  if (parts.length === 0) return undefined;
  const groups = new Map<string, string[]>();
  for (const p of parts) {
    const notes = [RARITY_LABELS[p.rarity], p.iconic ? "不朽" : String(p.price)];
    const group = SLOT_LABELS[p.slot];
    groups.set(group, [
      ...(groups.get(group) ?? []),
      `- ${p.id} ${p.name}｜${notes.join("｜")}${includeAbilities ? `：${p.ability}` : ""}`,
    ]);
  }
  const body = [...groups].map(([group, lines]) => `${group}\n${lines.join("\n")}`).join("\n");
  const rendered = `【义体表】
cyberware 指令的 id 只能用下面这些，正文里用名称。
每行是：id 名称｜稀有度｜参考价（欧元）${includeAbilities ? "：能力" : "；本轮相关能力另列在用户消息里，未展开的义体仍可按索引引用"}。这是设备目录，不代表眼前诊所有货；成交以指定医生的货架与已确认报价为准，不能按标签或参考价直接生成交易。
${body}`;
  if (typeof raw === "object" && raw !== null) {
    let byMode = cyberwareRenderCache.get(raw);
    if (!byMode) {
      byMode = new Map();
      cyberwareRenderCache.set(raw, byMode);
    }
    byMode.set(includeAbilities, rendered);
  }
  return rendered;
}
