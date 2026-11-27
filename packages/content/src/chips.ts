import { inventoryRules, shardsRules } from "@cp/core";

/**
 * 夜之城五大类真实芯片资料目录：
 * - intel：情报与夜之城读物（门禁密码、黑市账本、派系动向、档案）
 * - daemon：加密信用芯片、子网后门与带毒/黑冰陷阱芯片（建议先用读写器 inspect 查毒，再离线 decrypt）
 * - skill：技能协议芯片（插入个人 2 槽神经接口提供定性事实能力，拔出即失效，不加任何数值）
 * - braindance：超梦卷轴载体芯片（与 braindance.ts 对应）
 * - behavior：行为协议芯片（配合已安装的 doll-behavior-chip 切入改装协议）
 */
export const chipContents = [
  // ======================== 1. braindance 超梦载体 ========================
  {
    id: "chip-bd-nc-night-drift",
    title: "超梦卷轴：沃森午夜飙车",
    category: "braindance",
    kind: "recording",
    from: "霓虹冲浪发行／洋子芯片铺",
    summary: "14 分钟商业娱乐超梦，沃森雨夜高架极速飙车体验。",
    braindance: "bd-nc-night-drift",
    encryption: "none",
    hazard: "none",
    eddies: 0,
    parts: [
      {
        id: "sleeve",
        label: "封套说明",
        text: "《沃森午夜飙车·雨幕霓虹》，14 分钟商业娱乐超梦，内置全套感官安全滤波。佩戴便携超梦头环或使用店内设备即可播放。",
      },
    ],
    related: ["kabuki-market", "yoko-tsuru", "bd-nc-night-drift"],
  },
  {
    id: "chip-bd-us-cracks-live",
    title: "超梦卷轴：激光泡泡日本街现场",
    category: "braindance",
    kind: "recording",
    from: "日落演艺发行／洋子芯片铺",
    summary: "18 分钟流行音乐演出超梦，含后台暖场与全场安可。",
    braindance: "bd-us-cracks-live",
    encryption: "none",
    hazard: "none",
    eddies: 0,
    parts: [
      {
        id: "sleeve",
        label: "封套说明",
        text: "《激光泡泡·日本街不插电现场》，18 分钟正规发行版超梦，支持任意便携头环沉浸播放。",
      },
    ],
    related: ["japantown", "yoko-tsuru", "bd-us-cracks-live"],
  },
  {
    id: "chip-bd-lizzies-velvet",
    title: "超梦卷轴：绯红天鹅绒",
    category: "braindance",
    kind: "recording",
    from: "丽姿酒吧莫克斯调谐室",
    summary: "20 分钟丽姿招牌高沉浸感官调谐片，成人分级。",
    braindance: "bd-lizzies-velvet",
    encryption: "none",
    hazard: "none",
    eddies: 0,
    parts: [
      {
        id: "sleeve",
        label: "调谐室封套",
        text: "丽姿酒吧莫克斯调谐室出品。仅面向成年顾客出售或包厢点播，含标准感官缓释安全曲线。",
      },
    ],
    related: ["lizzies-bar", "judy", "bd-lizzies-velvet"],
  },
  {
    id: "chip-bd-clouds-dream-suite",
    title: "超梦卷轴：霓虹雨夜·高空套房",
    category: "braindance",
    kind: "recording",
    from: "威斯特布鲁克私享厂牌",
    summary: "22 分钟高端私享感官调谐超梦。",
    braindance: "bd-clouds-dream-suite",
    encryption: "none",
    hazard: "none",
    eddies: 0,
    parts: [
      {
        id: "sleeve",
        label: "私享封套",
        text: "面向日本街高端会所发行的舒缓沉浸卷轴，适配所有标准超梦花环。",
      },
    ],
    related: ["clouds", "bd-clouds-dream-suite"],
  },
  {
    id: "chip-bd-konpeki-suite-raw",
    title: "调查原片：顶层套房偷录",
    category: "braindance",
    kind: "recording",
    from: "匿名潜入录制者",
    summary: "10 分钟未剪辑顶层套房调查原片，需编辑头环或专业工作站做三层轨道扫描。",
    braindance: "bd-konpeki-suite-raw",
    encryption: "none",
    hazard: "none",
    eddies: 0,
    parts: [
      {
        id: "tag",
        label: "原片标签",
        text: "无商业封套的裸卷轴，外壳用黑色记号笔写着「顶层·未调谐」。含完整视觉、音频与热感原始轨道。",
      },
    ],
    related: ["lizzies-bar", "judy", "evelyn", "bd-konpeki-suite-raw"],
  },
  {
    id: "chip-bd-clouds-vip-raw",
    title: "调查原片：云顶贵宾走廊",
    category: "braindance",
    kind: "recording",
    from: "匿名玩偶私录",
    summary: "8 分钟云顶后台原片碎片，记录了虎爪帮贵宾区与玩偶算法服务器线索。",
    braindance: "bd-clouds-vip-raw",
    encryption: "none",
    hazard: "none",
    eddies: 0,
    parts: [
      {
        id: "tag",
        label: "原片标签",
        text: "外壳刮花了编号的灰色超梦载体，仅标着「H8-后台」。建议在编辑模式下排查视觉、音频与热感三层线索。",
      },
    ],
    related: ["clouds", "judy", "bd-clouds-vip-raw"],
  },
  {
    id: "chip-bd-kabuki-ambush-raw",
    title: "调查原片：歌舞伎后巷交货",
    category: "braindance",
    kind: "recording",
    from: "无名跑腿仔遗留",
    summary: "6 分钟歌舞伎后巷遇袭原片，可扫描伏击者所属帮派与埋伏位置。",
    braindance: "bd-kabuki-ambush-raw",
    encryption: "none",
    hazard: "none",
    eddies: 0,
    parts: [
      {
        id: "tag",
        label: "原片标签",
        text: "带有焦糊味的数据芯片，记录在电磁脉冲干扰中突然中断，仍保留完整原始感官轨道。",
      },
    ],
    related: ["kabuki-market", "bd-kabuki-ambush-raw"],
  },
  {
    id: "chip-bd-scav-xbd-moth",
    title: "黑超梦（XBD）：死蛾子",
    category: "braindance",
    kind: "recording",
    from: "清道夫地下厂牌「死蛾子」",
    summary: "扭扭街暗巷流出的无滤波地下黑超梦，直看风险极高，藏有清道夫冰浴作坊线索。",
    braindance: "bd-scav-xbd-moth",
    encryption: "none",
    hazard: "none",
    eddies: 0,
    parts: [
      {
        id: "warning",
        label: "黑市手写警告",
        text: "透明芯片壳上蚀刻着一只残缺飞蛾图标。无滤波 XBD——强烈建议在专业编辑工作站下剥离情感轨道再扫描线索。",
      },
    ],
    related: ["jig-jig-street", "bd-scav-xbd-moth"],
  },
  {
    id: "chip-bd-maelstrom-chrome-fever",
    title: "黑超梦（XBD）：红眼过载",
    category: "braindance",
    kind: "recording",
    from: "漩涡帮地下义体工坊（流出版）",
    summary:
      "沃森黑市流传的无滤波漩涡帮神经超频 XBD，直看神经过载风险极高，藏有军用稳压件走私线索。",
    braindance: "bd-maelstrom-chrome-fever",
    encryption: "none",
    hazard: "none",
    eddies: 0,
    parts: [
      {
        id: "warning",
        label: "黑市警告贴纸",
        text: "焊锡封口的改装卷轴，外壳划着漩涡帮涂鸦。切勿裸脑沉浸直看——先备压制剂或走编辑模式排查。",
      },
    ],
    related: ["kabuki-market", "bd-maelstrom-chrome-fever"],
  },
  {
    id: "chip-bd-dogtown-blackwall-leak",
    title: "黑超梦（XBD）：裂隙回声",
    category: "braindance",
    kind: "recording",
    from: "狗镇体育场黑市流出",
    summary:
      "记录狗镇黑客打捞旧网军用碎片遭猩红脉冲反噬的无滤波 XBD，藏有狗镇地下链路与网监信标线索。",
    braindance: "bd-dogtown-blackwall-leak",
    encryption: "none",
    hazard: "none",
    eddies: 0,
    parts: [
      {
        id: "warning",
        label: "焦痕封套说明",
        text: "金属外壳带静电灼痕的非法黑超梦。未经安全滤波，强烈建议通过编辑头环脱离感官轨道逐层扫描。",
      },
    ],
    related: ["dogtown", "bd-dogtown-blackwall-leak"],
  },

  // ======================== 2. intel 情报与夜之城读物 ========================
  {
    id: "chip-intel-kabuki-rumors",
    title: "歌舞伎黑市风声简报",
    category: "intel",
    kind: "data",
    from: "洋子芯片铺·灰市杂录",
    summary: "近两周沃森与日本街地下的零散风声：黑超梦流向、漩涡帮动向与云顶换班规律。",
    encryption: "none",
    hazard: "none",
    eddies: 0,
    parts: [
      {
        id: "brief",
        label: "街头风声",
        text: "1）扭扭街深处最近冒出一批标着「死蛾子」的地下 XBD，买家多是清道夫中间人；2）虎爪帮加强了 H8 云顶电梯口的武器安检；3）丽姿酒吧地下室的调谐台不对生面孔外借，除非找莫克斯帮或朱迪引荐。",
      },
    ],
    related: ["kabuki-market", "lizzies-bar", "clouds", "jig-jig-street"],
  },
  {
    id: "chip-intel-clouds-manual",
    title: "云顶前台接待与安全词须知",
    category: "intel",
    kind: "data",
    from: "云顶内部流出的员工芯片",
    summary: "写明云顶进场存枪、个人链路算法匹配、玩偶行为芯片托管与安全词强制停机流程。",
    encryption: "none",
    hazard: "none",
    eddies: 0,
    parts: [
      {
        id: "protocol",
        label: "流程摘要",
        text: "所有访客必须在前台武器柜寄存随身枪械与重刃；前台终端通过个人链路抓取访客潜意识偏好并匹配在班玩偶。包厢内玩偶切入 doll 托管模式后本人意识退居后台且不保留该段记忆；访客或玩偶念出预设安全词（默认「山茶花」）时芯片立即断连切回清醒态。",
      },
    ],
    related: ["clouds", "evelyn"],
  },
  {
    id: "chip-intel-ncpd-scanner",
    title: "NCPD 沃森频段密语速查",
    category: "intel",
    kind: "data",
    from: "匿名街头记者",
    summary: "整理了 NCPD 与暴恐机动队在沃森、日本街常用的暗码与封控响应节奏。",
    encryption: "none",
    hazard: "none",
    eddies: 0,
    parts: [
      {
        id: "codes",
        label: "警用密语",
        text: "代码 10-71 指涉义体狂暴嫌疑；听到调度切向「高频加密 4 槽」通常意味着暴恐机动队浮空车已在三分钟航程内。普通街头火拼只要不波及企业车队，沃森巡警往往会晚十分钟才来收场。",
      },
    ],
    related: ["kabuki-market", "regina-office"],
  },

  // ======================== 3. daemon 加密与陷阱芯片 ========================
  {
    id: "chip-daemon-militech-cred",
    title: "军用科技加密信用芯片",
    category: "daemon",
    kind: "data",
    from: "军用科技外勤部门",
    summary:
      "军用科技外勤部门制式加密信用芯片，外壳封条有二次启封痕迹，需隔离查毒或破译后确认内部凭证与安全状况。",
    encryption: "corp",
    hazard: "malware",
    eddies: 1500,
    parts: [
      {
        id: "manifest",
        label: "明文编号",
        text: "MILITECH-CRED-8842｜类型：加密信用芯片｜状态：企业级加密锁定。未经隔离读写器查毒直接接入个人接口可能存在反制风险。",
      },
      {
        id: "vault",
        label: "破译后密文",
        text: "批次号 8842 原定用于支付沃森区线人封口费（面额 1,500 欧元）；内嵌一只延迟激活的恶意烧录木马，清理后可安全提取全部欧元。",
        encrypted: true,
      },
    ],
    related: ["kabuki-market"],
  },
  {
    id: "chip-daemon-arasaka-backdoor",
    title: "荒坂物流子网密钥",
    category: "daemon",
    kind: "data",
    from: "黑市数据贩子",
    summary:
      "黑市流出的荒坂物流仓储子网加密密钥芯片，外层军用封装严密，建议先经隔离读写器查验再破译。",
    encryption: "military",
    hazard: "black-ice",
    eddies: 0,
    parts: [
      {
        id: "header",
        label: "封装头信息",
        text: "ARASAKA-LOGISTICS-NODE-W4｜军用级加密封装。未隔离直插可能触发企业反入侵协议。",
      },
      {
        id: "key",
        label: "解密后子网后门",
        text: "子网入口：北工业区四号物流闸机维护端口；凭本芯片中的动态证书与完好网络接入仓可绕过外层身份验证直接接管摄像头与门禁。",
        encrypted: true,
      },
    ],
    related: ["corpo-plaza", "kabuki-market"],
  },

  // ======================== 4. skill 技能协议芯片（插个人 2 槽生效） ========================
  {
    id: "chip-skill-translator",
    title: "多语种实时神经翻译芯片",
    category: "skill",
    kind: "data",
    from: "岐路司民用软件部",
    summary: "插槽式语言解析协议，支持日语、西班牙语、海地克里奥尔语与俄语的实时听译与口型校准。",
    encryption: "none",
    hazard: "none",
    eddies: 0,
    ability:
      "插入个人神经芯片槽后，可实时听懂并流畅回应日语、西班牙语、海地克里奥尔语与俄语街头黑话（涵盖虎爪帮、瓦伦蒂诺、巫毒帮与清道夫暗语），拔出即失效。",
    parts: [
      {
        id: "spec",
        label: "协议说明",
        text: "占用 1 个个人神经芯片槽。实时转译常见帮派与跨国企业方言，无需联网。",
      },
    ],
    related: ["kabuki-market", "japantown"],
  },
  {
    id: "chip-skill-trauma-field",
    title: "创伤急救现场处置协议",
    category: "skill",
    kind: "data",
    from: "前创伤小组医护流出",
    summary: "插槽式战地创伤止血与义体排异应急处置动作协议。",
    encryption: "none",
    hazard: "none",
    eddies: 0,
    ability:
      "插入个人神经芯片槽后，能准确识别动脉出血、肺部贯穿与义体神经短路征兆，规范实施现场止血、清创与镇痛固定（仍需真实药物或医疗器材配合），拔出即失效。",
    parts: [
      {
        id: "spec",
        label: "协议说明",
        text: "占用 1 个个人神经芯片槽。提供标准化的现场急救步骤引导，不替代义体医生手术。",
      },
    ],
    related: ["vik-clinic", "kabuki-market"],
  },
  {
    id: "chip-skill-tactical-reload",
    title: "军用战术枪械肌电协议",
    category: "skill",
    kind: "data",
    from: "军用科技教范流片",
    summary: "插槽式短枪与冲锋枪快速换弹、故障排除与急停稳枪肌电校准协议。",
    encryption: "none",
    hazard: "none",
    eddies: 0,
    ability:
      "插入个人神经芯片槽后，在高压交火中保持沉稳握持、快速排除卡壳与单手战术换弹，大幅减少慌乱脱靶与换弹空档，拔出即失效。",
    parts: [
      {
        id: "spec",
        label: "协议说明",
        text: "占用 1 个个人神经芯片槽。校准前臂与手腕肌电协同，需真实持有可用枪械。",
      },
    ],
    related: ["kabuki-market", "megabuilding-h10"],
  },
  {
    id: "chip-skill-lockbypass",
    title: "安保门禁与线缆排查词典",
    category: "skill",
    kind: "data",
    from: "夜之城独立技术员协会",
    summary: "涵盖主流民用与商铺电子门禁、摄像头回路和配电箱的物理旁路拆解协议。",
    encryption: "none",
    hazard: "none",
    eddies: 0,
    ability:
      "插入个人神经芯片槽后，能迅速辨认夜之城常见电子锁型号、感应线路与报警回路，在具备基础工具时更干净地短接门禁或拆除警报而不触发误报，拔出即失效。",
    parts: [
      {
        id: "spec",
        label: "协议说明",
        text: "占用 1 个个人神经芯片槽。纯物理接线与工程排查指引，不能直接入侵军用黑冰网络。",
      },
    ],
    related: ["kabuki-market"],
  },

  // ======================== 5. behavior 行为协议芯片（需配合 doll-behavior-chip） ========================
  {
    id: "chip-behavior-doll-combat",
    title: "行为协议：改装玩偶格斗托管",
    category: "behavior",
    kind: "data",
    from: "丽姿地下室·朱迪改装版",
    summary: "将玩偶行为芯片的动作库改写为近身防卫与反关节拆招托管协议。",
    encryption: "none",
    hazard: "none",
    eddies: 0,
    protocol: "改装玩偶格斗协议",
    ability:
      "需已安装完好的玩偶行为芯片（doll-behavior-chip）并插入神经槽。切入 protocol 模式后，由芯片接管近身格斗步法、卸刃与反关节发力，动作冷酷精准无畏痛觉；长时间高强度运行易引发自我抽离症状，且存在被黑客干扰风险。",
    parts: [
      {
        id: "spec",
        label: "改装说明",
        text: "写入自云顶玩偶框架的反向工程版协议。切入 protocol 后立刻生效，念出安全词或主动断开可退回清醒。",
      },
    ],
    related: ["lizzies-bar", "clouds", "judy"],
  },
  {
    id: "chip-behavior-social-mask",
    title: "行为协议：高管礼仪与情绪屏蔽",
    category: "behavior",
    kind: "data",
    from: "威斯特布鲁克私密定制",
    summary: "面向潜入与谈判场合的微表情控制、声线平稳与情绪剥离行为协议。",
    encryption: "none",
    hazard: "none",
    eddies: 0,
    protocol: "情绪屏蔽与礼仪伪装协议",
    ability:
      "需已安装完好的玩偶行为芯片（doll-behavior-chip）并插入神经槽。切入 protocol 模式后，芯片压平心率波动与紧张微表情，以考究沉稳的贵族/高管体态应对盘问、测谎或谈判；退出后容易伴随短暂情感迟钝。",
    parts: [
      {
        id: "spec",
        label: "协议说明",
        text: "借用玩偶芯片的情绪隔离模块实现面具式社交伪装；不会凭空赋予未掌握的机密口令。",
      },
    ],
    related: ["clouds", "corpo-plaza"],
  },
].map((content) => shardsRules.ChipContentSchema.parse(content));

/** 芯片系统硬件与实体芯片载体目录，汇总入 items.ts。 */
export const everydayChipItems = inventoryRules.ItemCatalogSchema.parse([
  // 硬件设备
  {
    id: "chip-reader-writer",
    name: "隔离芯片读写器",
    kind: "misc",
    price: 350,
    rarity: "common",
    chipDevice: "reader-writer",
    ability:
      "离线沙盒芯片读写终端：可对来路不明的芯片执行安全查毒（inspect）识别加密锁、病毒与黑冰，避免盲插反噬；配合完好网络接入仓可离线破译加密芯片，或将可读非信用芯片刻录到空白芯片（blank-shard）。",
  },
  {
    id: "bd-portable-player",
    name: "便携超梦花环",
    kind: "misc",
    price: 400,
    rarity: "common",
    braindanceDevice: { playback: true, analysis: [] },
    ability:
      "夜之城街头最常见的便携超梦播放花环：可随时在安全停留处以沉浸模式（immerse）观看持有的超梦卷轴，不支持编辑分析、三层轨道扫描或芯片查毒。",
  },
  {
    id: "bd-editor-wreath",
    name: "专业超梦编辑头环",
    kind: "misc",
    price: 1800,
    rarity: "uncommon",
    braindanceDevice: { playback: true, analysis: ["visual", "audio", "thermal"] },
    ability:
      "调谐师级专业超梦编辑花环（支持沉浸回放与编辑分析模式）：可对调查原片（raw）与黑超梦（xbd）切换视觉、音频与热感三层感官轨道，逐帧扫描隐藏线索；不具备芯片隔离查毒或刻录功能。",
  },
  {
    id: "blank-shard",
    name: "空白数据芯片",
    kind: "misc",
    price: 20,
    rarity: "common",
    chipStorage: true,
    ability: "一份未写入数据的空白神经芯片载体，可配合隔离芯片读写器刻录已有芯片副本。",
  },

  // 超梦卷轴实体载体
  {
    id: "shard-bd-nc-night-drift",
    name: "超梦卷轴·沃森午夜飙车",
    kind: "misc",
    price: 90,
    rarity: "common",
    chipContentId: "chip-bd-nc-night-drift",
  },
  {
    id: "shard-bd-us-cracks-live",
    name: "超梦卷轴·激光泡泡日本街现场",
    kind: "misc",
    price: 110,
    rarity: "common",
    chipContentId: "chip-bd-us-cracks-live",
  },
  {
    id: "shard-bd-lizzies-velvet",
    name: "超梦卷轴·绯红天鹅绒",
    kind: "misc",
    price: 220,
    rarity: "common",
    chipContentId: "chip-bd-lizzies-velvet",
  },
  {
    id: "shard-bd-clouds-dream-suite",
    name: "超梦卷轴·霓虹雨夜高空套房",
    kind: "misc",
    price: 260,
    rarity: "common",
    chipContentId: "chip-bd-clouds-dream-suite",
  },
  {
    id: "shard-bd-konpeki-suite-raw",
    name: "调查原片·顶层套房偷录",
    kind: "misc",
    price: 600,
    rarity: "uncommon",
    chipContentId: "chip-bd-konpeki-suite-raw",
  },
  {
    id: "shard-bd-clouds-vip-raw",
    name: "调查原片·云顶贵宾走廊",
    kind: "misc",
    price: 550,
    rarity: "uncommon",
    chipContentId: "chip-bd-clouds-vip-raw",
  },
  {
    id: "shard-bd-kabuki-ambush-raw",
    name: "调查原片·歌舞伎后巷交货",
    kind: "misc",
    price: 420,
    rarity: "common",
    chipContentId: "chip-bd-kabuki-ambush-raw",
  },
  {
    id: "shard-bd-scav-xbd-moth",
    name: "黑超梦（XBD）·死蛾子",
    kind: "misc",
    price: 750,
    rarity: "uncommon",
    chipContentId: "chip-bd-scav-xbd-moth",
  },
  {
    id: "shard-bd-maelstrom-chrome-fever",
    name: "黑超梦（XBD）·红眼过载",
    kind: "misc",
    price: 880,
    rarity: "rare",
    chipContentId: "chip-bd-maelstrom-chrome-fever",
  },
  {
    id: "shard-bd-dogtown-blackwall-leak",
    name: "黑超梦（XBD）·裂隙回声",
    kind: "misc",
    price: 1150,
    rarity: "epic",
    chipContentId: "chip-bd-dogtown-blackwall-leak",
  },

  // 情报芯片
  {
    id: "shard-intel-kabuki-rumors",
    name: "情报芯片·歌舞伎黑市风声",
    kind: "misc",
    price: 45,
    rarity: "common",
    chipContentId: "chip-intel-kabuki-rumors",
  },
  {
    id: "shard-intel-clouds-manual",
    name: "资料芯片·云顶接待与安全词须知",
    kind: "misc",
    price: 60,
    rarity: "common",
    chipContentId: "chip-intel-clouds-manual",
  },
  {
    id: "shard-intel-ncpd-scanner",
    name: "资料芯片·NCPD 沃森频段密语",
    kind: "misc",
    price: 80,
    rarity: "common",
    chipContentId: "chip-intel-ncpd-scanner",
  },

  // 加密与陷阱芯片
  {
    id: "shard-daemon-militech-cred",
    name: "加密信用芯片·军用科技外勤款",
    kind: "misc",
    price: 1200,
    rarity: "uncommon",
    chipContentId: "chip-daemon-militech-cred",
  },
  {
    id: "shard-daemon-arasaka-backdoor",
    name: "加密密钥芯片·荒坂物流子网",
    kind: "misc",
    price: 1400,
    rarity: "uncommon",
    chipContentId: "chip-daemon-arasaka-backdoor",
  },

  // 技能协议芯片（插入神经槽提供定性能力）
  {
    id: "shard-skill-translator",
    name: "技能芯片·多语种实时神经翻译",
    kind: "misc",
    price: 450,
    rarity: "common",
    chipContentId: "chip-skill-translator",
  },
  {
    id: "shard-skill-trauma-field",
    name: "技能芯片·创伤急救现场处置",
    kind: "misc",
    price: 550,
    rarity: "common",
    chipContentId: "chip-skill-trauma-field",
  },
  {
    id: "shard-skill-tactical-reload",
    name: "技能芯片·军用战术枪械肌电",
    kind: "misc",
    price: 750,
    rarity: "uncommon",
    chipContentId: "chip-skill-tactical-reload",
  },
  {
    id: "shard-skill-lockbypass",
    name: "技能芯片·安保门禁排查词典",
    kind: "misc",
    price: 650,
    rarity: "common",
    chipContentId: "chip-skill-lockbypass",
  },

  // 行为协议芯片（配合玩偶行为芯片）
  {
    id: "shard-behavior-doll-combat",
    name: "行为协议芯片·改装玩偶格斗",
    kind: "misc",
    price: 1200,
    rarity: "uncommon",
    chipContentId: "chip-behavior-doll-combat",
  },
  {
    id: "shard-behavior-social-mask",
    name: "行为协议芯片·高管礼仪与情绪屏蔽",
    kind: "misc",
    price: 1100,
    rarity: "uncommon",
    chipContentId: "chip-behavior-social-mask",
  },

  // 快速破解程序芯片（非终极类可于黑客铺子或暗巷黑市明码购入，购入后自动录入接入仓芯片库；终极神经接管类禁止明买）
  {
    id: "qh-sonic-shock",
    name: "快速破解芯片·音波震冲",
    kind: "misc",
    price: 1800,
    rarity: "uncommon",
    quickhackId: "sonic-shock",
    ability:
      "隐蔽类快速破解程序芯片（低负载）。购入后收入随身芯片盒，插进接入仓存储插槽即可使用：干扰对方听觉义体并掐断其小队无线通信链路。",
  },
  {
    id: "qh-memory-wipe",
    name: "快速破解芯片·记忆擦除",
    kind: "misc",
    price: 3600,
    rarity: "rare",
    quickhackId: "memory-wipe",
    ability:
      "隐蔽类快速破解程序芯片（高负载）。购入后收入随身芯片盒，插进接入仓存储插槽即可使用：强行清刷对方神经接口缓存并中断敌方追踪与警戒信号。",
  },
  {
    id: "qh-cripple-movement",
    name: "快速破解芯片·阻碍移动",
    kind: "misc",
    price: 2600,
    rarity: "uncommon",
    quickhackId: "cripple-movement",
    ability:
      "控制类快速破解程序芯片（中负载）。购入后收入随身芯片盒，插进接入仓存储插槽即可使用：锁死腿部与下肢运动义体伺服电机，让带动力义腿者原地僵死。",
  },
  {
    id: "qh-short-circuit",
    name: "快速破解芯片·电磁短路",
    kind: "misc",
    price: 4200,
    rarity: "rare",
    quickhackId: "short-circuit",
    ability:
      "伤害类快速破解程序芯片（中负载）。购入后收入随身芯片盒，插进接入仓存储插槽即可使用：高压电涌直穿义肢、斯安威斯坦或机械电路，致其冒烟瘫痪。",
  },
  {
    id: "qh-contagion",
    name: "快速破解芯片·连带传染",
    kind: "misc",
    price: 4800,
    rarity: "rare",
    quickhackId: "contagion",
    ability:
      "伤害类快速破解程序芯片（高负载）。购入后收入随身芯片盒，插进接入仓存储插槽即可使用：向目标体内医疗/生物义体注入神经毒素脚本并沿局域子网向邻近连网节点扩散。",
  },
]);
