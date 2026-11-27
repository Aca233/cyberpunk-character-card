/**
 * 《赛博朋克 2077：边缘账本》3.0 城区物理安检法则与夜之城百态生活切片库（Chapter 5 & Chapter 7）
 * - 收录八大城区安检与显眼武器执法法则
 * - 收录中间人脾气与信誉偏好权重
 * - 收录常态闲逛时注入的【夜之城百态烟火气生活切片】（无强制任务绑定，营造真实呼吸感）
 */

export interface DistrictLaw {
  readonly id: string;
  readonly name: string;
  /** 城区安全与消费层级（0 无警察区 / 1 底层街头 / 2 混管城区 / 3 高档与军管 / 4 核心巨企禁区） */
  readonly securityTier: 0 | 1 | 2 | 3 | 4;
  /** 是否严禁公开携带显眼长武器（open / heavy）上街 */
  readonly forbidsOpenLongArms: boolean;
  /** 创伤小组普通响应是否覆盖（太平洲与地下屏蔽区不覆盖） */
  readonly traumaCoverage: "full" | "platinumOnly" | "blocked";
  /** 执法与环境物理法则描述 */
  readonly lawSummary: string;
}

export const DISTRICT_LAWS: Readonly<Record<string, DistrictLaw>> = {
  "city-center": {
    id: "city-center",
    name: "市政中心",
    securityTier: 4,
    forbidsOpenLongArms: true,
    traumaCoverage: "full",
    lawSummary:
      "巨企总部与公司广场核心区。街头遍布安保无人机与面部识别，严禁公开拎长枪/重武器上街；进入企业大厦与五星酒店需穿着得体并通过门口安检。",
  },
  westbrook: {
    id: "westbrook",
    name: "威斯布鲁克",
    securityTier: 3,
    forbidsOpenLongArms: true,
    traumaCoverage: "full",
    lawSummary:
      "日本街繁华夜生活与北橡区权贵豪宅并存。高档会所与私人公馆注重门面与安检；街头显眼长枪会引起虎爪帮巡街刀手或私人安保盘查。",
  },
  heywood: {
    id: "heywood",
    name: "海伍德",
    securityTier: 2,
    forbidsOpenLongArms: false,
    traumaCoverage: "full",
    lawSummary:
      "市政中心南侧的密集居住区，瓦伦蒂诺帮与六街帮势力交错。穿街头夹克更容易在酒吧与巷口搭上话；穿昂贵公司西装独闯暗巷易被当成肥羊。",
  },
  watson: {
    id: "watson",
    name: "沃森区",
    securityTier: 1,
    forbidsOpenLongArms: false,
    traumaCoverage: "full",
    lawSummary:
      "歌舞伎町黑市、丽姿酒吧与北侧老工业区。漩涡帮与虎爪帮在暗巷活动，风衣下藏手枪或冲锋枪司空见惯，NCPD 巡逻迟缓。",
  },
  "santo-domingo": {
    id: "santo-domingo",
    name: "圣多明戈",
    securityTier: 1,
    forbidsOpenLongArms: false,
    traumaCoverage: "full",
    lawSummary:
      "河谷区重工业厂房与科罗纳多农场。空气常年弥漫化工酸雾，六街帮武装巡逻普遍；南侧公路直通恶土，流浪者车队常在此交接走私货。",
  },
  pacifica: {
    id: "pacifica",
    name: "太平洲",
    securityTier: 0,
    forbidsOpenLongArms: false,
    traumaCoverage: "platinumOnly",
    lawSummary:
      "烂尾度假村与无警察法外之地。NCPD 完全放弃出警，动物帮与巫毒帮控制街区，连重机枪摆上街也无人执法，但夜间随时面临黑客暗算与黑帮火并。",
  },
  dogtown: {
    id: "dogtown",
    name: "狗镇",
    securityTier: 3,
    forbidsOpenLongArms: false,
    traumaCoverage: "blocked",
    lawSummary:
      "汉森上校麾下幽冥犬军管的独立飞地，黑市与体育场对夜之城佣兵与商客开放进出。常规大门接受身份与随身武器扫描（或走太平洲地下通道）即可放行，不会以「缺少通行证」无故拒入；仅当与幽冥犬敌对/见面就打、开赃车或身背高星通缉时，关口盘查才会升级为阻拦或冲突。空域封闭，创伤小组无法直接降落。",
  },
  badlands: {
    id: "badlands",
    name: "恶土",
    securityTier: 1,
    forbidsOpenLongArms: false,
    traumaCoverage: "platinumOnly",
    lawSummary:
      "环绕夜之城的广袤荒漠、垃圾场与风力电网。跨距极远必须驾车出行，NCPD 通缉令无法直接触达，阿德卡多等流浪者家族与乱刀会在此争夺公路控制权。",
  },
};

export interface FixerTemperament {
  readonly id: string;
  readonly name: string;
  readonly district: string;
  readonly preferredStyle: string;
  readonly taboo: string;
}

export const FIXER_TEMPERAMENTS: readonly FixerTemperament[] = [
  {
    id: "wakako",
    name: "冈田和歌子",
    district: "威斯布鲁克",
    preferredStyle: "讲究规矩、干净利落、不惊动虎爪帮高层面子",
    taboo: "最恨佣兵在她的地盘乱开火引来条子或对委托人讨价还价",
  },
  {
    id: "regina",
    name: "瑞吉娜·琼斯",
    district: "沃森区",
    preferredStyle: "偏爱活捉赛博精神病、保护平民与收集真相",
    taboo: "厌恶无差别屠杀平民与滥用致命暴力的疯狗行径",
  },
  {
    id: "padre",
    name: "塞巴斯蒂安·“神父”·伊巴拉",
    district: "海伍德",
    preferredStyle: "敬畏传统、讲究街区体面与以眼还眼的分寸",
    taboo: "轻慢长辈、破坏海伍德教堂周边的规矩",
  },
  {
    id: "rogue",
    name: "罗格·阿曼迪亚雷斯",
    district: "来生（沃森/全城）",
    preferredStyle: "只看专业水准与硬实力，高风险高回报",
    taboo: "害死队友、临阵脱逃或把尾巴带回来生酒吧",
  },
  {
    id: "hands",
    name: "汉兹先生",
    district: "太平洲 / 狗镇",
    preferredStyle: "看重政治杠杆、保密性与利益最大化",
    taboo: "愚蠢的鲁莽冲动导致破坏他精心布局的权力的游戏",
  },
];

export interface NightCitySlice {
  readonly id: string;
  readonly district: string;
  readonly period: "dawn" | "day" | "dusk" | "night" | "any";
  readonly text: string;
}

/**
 * 夜之城百态生活切片种子库（无强制剧情绑定，仅作为环境背景音注入，消解“全世界围着玩家转”的虚假感）
 */
export const NIGHT_CITY_SLICES: readonly NightCitySlice[] = [
  {
    id: "slice-kabuki-noodles",
    district: "watson",
    period: "night",
    text: "街角合成面摊的蒸汽混着霓虹灯管的紫光往上冒，两个刚下夜班的诊所护工正蹲在塑料凳上抱怨义体排异药又涨了五十欧。",
  },
  {
    id: "slice-corpo-plaza-rain",
    district: "city-center",
    period: "dusk",
    text: "全息巨幅广告里的虚拟偶像在酸雨里微笑，楼下穿荒坂定制西装的年轻专员正蹲在垃圾桶旁一边干呕一边接上司的全息训话。",
  },
  {
    id: "slice-heywood-lowrider",
    district: "heywood",
    period: "day",
    text: "镀金底盘的古德拉改装车慢吞吞滑过街口，车载音响震得路边圣母壁画下的烛台嗡嗡作响，几个瓦伦蒂诺青年斜靠在引擎盖上吹口哨。",
  },
  {
    id: "slice-japantown-bd",
    district: "westbrook",
    period: "night",
    text: "樱花全息投影下，一个戴着廉价超梦头环的流浪汉靠在自动售货机旁抽搐傻笑，路过的虎爪帮刀手连眼皮都没抬一下。",
  },
  {
    id: "slice-santo-blackout",
    district: "santo-domingo",
    period: "dawn",
    text: "远处变电站爆出一团蓝白色电弧，整条街的路灯暗了三秒才重新亮起，早班工人们习以为常地紧了紧防尘面罩。",
  },
  {
    id: "slice-pacifica-gunfire",
    district: "pacifica",
    period: "any",
    text: "隔着两个街区的烂尾商场里传来一串沉闷的重机枪点射，几秒后又恢复死寂，海风卷着塑料袋擦过生锈的摩天轮支架。",
  },
  {
    id: "slice-dogtown-checkpoint",
    district: "dogtown",
    period: "any",
    text: "幽灵犬的装甲巡逻车堵在窄巷口查验芯片，排队的黑市商贩低着头把一叠欧元芯片塞进士兵战术背心的侧袋。",
  },
  {
    id: "slice-badlands-tumbleweed",
    district: "badlands",
    period: "day",
    text: "滚烫的沥青路面上热浪扭曲，远处生物技术蛋白农场的温室大棚像一片银色坟场，无线电里断断续续传来阿德卡多车队的调频摇滚乐。",
  },
];
