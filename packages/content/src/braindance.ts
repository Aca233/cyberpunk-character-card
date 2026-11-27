import { braindanceRules } from "@cp/core";

/**
 * 夜之城四级超梦目录：
 * - commercial：商业娱乐片（歌舞伎音像摊、日常解压）
 * - sensory：莫克斯精修感官调谐片（丽姿酒吧、高端会所）
 * - raw：未剪辑第一人称调查原片（支持编辑模式 visual / audio / thermal 三层轨道扫描）
 * - xbd：地下黑超梦（未经滤波，高神经冲击风险，藏匿关键地下线索）
 */
export const braindances = braindanceRules.BdWorkListSchema.parse([
  // 1. commercial — 商业娱乐
  {
    id: "bd-nc-night-drift",
    title: "沃森午夜飙车·雨幕霓虹",
    tier: "commercial",
    recorder: "商业超梦厂牌「霓虹冲浪」",
    synopsis: "从改装石英跑车驾驶席直冲沃森高架与歌舞伎霓虹隧道的肾上腺素娱乐片。",
    durationMinutes: 14,
    location: "kabuki-market",
    passages: [
      {
        id: "ramp-launch",
        label: "高架起步",
        minutes: 5,
        outline:
          "双涡轮在雨夜高架匝道拉高转速，挡风玻璃上霓虹拉成赤蓝光带，车尾甩过积水护栏直切进主干道车流。",
      },
      {
        id: "tunnel-sprint",
        label: "隧道极速",
        minutes: 5,
        outline:
          "车速拉满冲入歌舞伎下沉隧道，引擎低吼与合成器节拍同步震动胸腔，擦着重型货车盲区完成连续超车。",
      },
      {
        id: "pier-cooldown",
        label: "海风收尾",
        minutes: 4,
        outline:
          "跑车滑停在北岸防波堤，熄火后只剩雨滴敲打引擎盖与远处全息广告的低吟，感官滤波器平稳淡出。",
      },
    ],
    details: [
      {
        id: "drift-tunnel-plate",
        passage: "tunnel-sprint",
        layer: "visual",
        finding: "隧道超车瞬间，右侧重型货车的车厢侧栏闪过「歌舞伎夜航物流·04 号冷链」编号贴纸。",
      },
      {
        id: "drift-radio-chatter",
        passage: "pier-cooldown",
        layer: "audio",
        finding:
          "熄火后远处的海风里混着微弱的街头飙车暗网频道播报，提到每周五子夜在北岸工业区发车。",
      },
    ],
  },
  // 2. commercial — 商业娱乐
  {
    id: "bd-us-cracks-live",
    title: "激光泡泡·日本街不插电现场",
    tier: "commercial",
    recorder: "日落演艺发行",
    synopsis: "贴近舞台边缘与后台的流行演出超梦，含人群音浪、镁光灯热感与安可合唱。",
    durationMinutes: 18,
    location: "japantown",
    passages: [
      {
        id: "backstage-warm",
        label: "后台暖场",
        minutes: 5,
        outline: "全息化妆镜亮起，乐手试音的合成器泛音混着香槟气泡味，舞台监督倒数三秒推开侧幕。",
      },
      {
        id: "main-chorus",
        label: "霓虹副歌",
        minutes: 9,
        outline:
          "聚光灯打满舞池，观众荧光棒连成海浪，低音炮震动顺着脚底直冲脊背，情绪轨道调谐得轻快上头。",
      },
      {
        id: "encore-fade",
        label: "散场余温",
        minutes: 4,
        outline: "彩带落满肩头，录制者退回侧台喝下半杯冰水，掌声在滤波器中渐弱，结束得干脆舒缓。",
      },
    ],
    details: [
      {
        id: "cracks-vip-pass",
        passage: "backstage-warm",
        layer: "visual",
        finding:
          "化妆台角落放着一张日本街黑蓝宝石巡演协办方的后台通行证，落款来自威斯特布鲁克某家虎爪帮控股的演艺公司。",
      },
      {
        id: "cracks-stage-comms",
        passage: "encore-fade",
        layer: "audio",
        finding:
          "侧台耳返泄漏出舞台监督压低声音的叮嘱：“散场走地下货运梯，别碰正门那群等债的记者。”",
      },
    ],
  },
  // 3. sensory — 丽姿酒吧感官调谐
  {
    id: "bd-lizzies-velvet",
    title: "绯红天鹅绒·丽姿定制调谐",
    tier: "sensory",
    recorder: "莫克斯特约调谐室（丽姿酒吧）",
    synopsis: "丽姿酒吧招牌高沉浸感官调谐卷轴，放大雨夜丝绒、低频心跳与近距呼吸的温度。",
    durationMinutes: 20,
    location: "lizzies-bar",
    passages: [
      {
        id: "neon-booth",
        label: "暗红丝绒包厢",
        minutes: 6,
        outline:
          "门帘隔绝了丽姿舞池的轰鸣，紫红霓虹斜落在丝绒沙发与冰杯壁上，空气里浮着淡淡雪松与合成樱桃香。",
      },
      {
        id: "pulse-sync",
        label: "呼吸与脉搏共鸣",
        minutes: 9,
        outline:
          "调谐师精细校准了触觉与体温层：指尖掠过锁骨的温差、贴耳低语的气流与稳定渐升的心跳节拍层层叠加。",
      },
      {
        id: "afterglow",
        label: "余韵缓释",
        minutes: 5,
        outline: "感官增益按莫克斯安全曲线缓缓回落，留下一段微醺松弛的体感余韵，不带残留眩晕。",
      },
    ],
    details: [
      {
        id: "velvet-tune-signature",
        passage: "pulse-sync",
        layer: "thermal",
        finding:
          "体温与皮电曲线经过极其细腻的人工分段限幅，带有朱迪调谐工作站特有的莫克斯防成瘾安全签名。",
      },
    ],
  },
  // 4. sensory — 高端感官调谐
  {
    id: "bd-clouds-dream-suite",
    title: "霓虹雨夜·高空云端套房",
    tier: "sensory",
    recorder: "威斯特布鲁克私享调谐厂牌",
    synopsis:
      "面向企业高管与贵宾的奢华感官片：落地窗外俯瞰夜之城霓虹雨海，主打彻底抽离现实的温柔沉浸。",
    durationMinutes: 22,
    location: "clouds",
    passages: [
      {
        id: "glass-rain",
        label: "百层雨幕",
        minutes: 7,
        outline:
          "站在超级摩天楼顶层落地玻璃前，整座夜之城在脚下化成无声光河，真皮地毯暖意渗入赤足。",
      },
      {
        id: "whisper-lounge",
        label: "低语与温水",
        minutes: 10,
        outline:
          "暖灯调暗，轻缓的声线在耳畔把现实烦恼逐一拆散；调谐后的多巴胺与催产素曲线让人产生被无条件理解的错觉。",
      },
      {
        id: "dawn-fade",
        label: "晨雾淡出",
        minutes: 5,
        outline: "远方天际渗出灰蓝，播放程序按预设安全阈值平稳断开连接。",
      },
    ],
    details: [
      {
        id: "dream-suite-watermark",
        passage: "glass-rain",
        layer: "visual",
        finding:
          "落地窗角落极淡的玻璃倒影里闪过 H8 摩天楼云顶会所的定制编码水印与一套玩偶行为算法版本号。",
      },
      {
        id: "dream-suite-carrier-hum",
        passage: "whisper-lounge",
        layer: "audio",
        finding:
          "在温柔低语的底层频段藏着一段极低幅度的脉冲诱导音频，用来延长贵宾的情感依赖与复购意愿。",
      },
    ],
  },
  // 5. raw — 调查原片（绀碧大厦偷拍风格 / 荒坂高层线）
  {
    id: "bd-konpeki-suite-raw",
    title: "顶层套房偷录原片·未剪辑",
    tier: "raw",
    recorder: "匿名潜入录制者",
    synopsis:
      "一段未经任何调谐与剪辑的酒店顶层套房第一人称原始卷轴，包含视觉、音频与热感三层硬线索。",
    durationMinutes: 10,
    location: "lizzies-bar",
    passages: [
      {
        id: "suite-entry",
        label: "步入套房客厅",
        minutes: 4,
        outline:
          "录制者端着香槟托盘走进挑高客厅，全息盆景旁站着一名穿深灰西装的荒坂保镖，桌上数据板亮着微弱蓝光。",
      },
      {
        id: "balcony-call",
        label: "阳台加密通话",
        minutes: 3,
        outline: "套房主人背身走向落地窗接听加密语音，壁炉左侧墙体传出微弱制冷压缩机嗡鸣。",
      },
      {
        id: "exit-corridor",
        label: "退回电梯厅",
        minutes: 3,
        outline: "录制者在保镖目光催促下退出房门，镜头扫过电梯面板与墙角安保终端后中断。",
      },
    ],
    details: [
      {
        id: "konpeki-pad-code",
        passage: "suite-entry",
        layer: "visual",
        finding: "放大客厅数据板反光可见临时安保权限码「ARS-7741」与北码头三号冷库签收单。",
      },
      {
        id: "konpeki-voice-name",
        passage: "balcony-call",
        layer: "audio",
        finding: "剥离雨声与背景乐后，加密通话里清晰提到“今晚子夜在歌舞伎货运通道交接芯片原型”。",
      },
      {
        id: "konpeki-cold-safe",
        passage: "balcony-call",
        layer: "thermal",
        finding: "壁炉左侧暗墙后存在明显的低温制冷轮廓，是一具恒温生物冷藏保险箱。",
      },
    ],
  },
  // 6. raw — 调查原片（云顶后台与虎爪帮监控）
  {
    id: "bd-clouds-vip-raw",
    title: "云顶贵宾走廊·原片碎片",
    tier: "raw",
    recorder: "云顶某名玩偶私录",
    synopsis: "一段在云顶后台维护通道仓促录下的 8 分钟原片，记录了虎爪帮头目与管事的密谈与暗门。",
    durationMinutes: 8,
    location: "clouds",
    passages: [
      {
        id: "vip-hall",
        label: "贵宾厅侧门",
        minutes: 4,
        outline:
          "录制者低头端着托盘穿过樱花投影走廊，右侧办公室虚掩着门缝，两名虎爪帮武装人员守在转角。",
      },
      {
        id: "office-pass",
        label: "管事门外驻足",
        minutes: 4,
        outline: "门内传来低沉争吵与芯片烧录器的提示音，录制者假装整理托盘停顿十余秒后快步离开。",
      },
    ],
    details: [
      {
        id: "clouds-door-badge",
        passage: "vip-hall",
        layer: "visual",
        finding: "转角安保腰间挂着虎爪帮 H8 贵宾区电子门禁卡，卡面印有「VIP-09 / 木头人办公室」。",
      },
      {
        id: "clouds-debt-talk",
        passage: "office-pass",
        layer: "audio",
        finding:
          "门内管事压低声音说“把坏掉行为芯片的货连夜转去扭扭街地下诊所，别让莫克斯帮嗅到风声”。",
      },
      {
        id: "clouds-server-heat",
        passage: "office-pass",
        layer: "thermal",
        finding: "办公室暗门后方的墙体呈高热红斑，藏着一台持续满载运转的玩偶行为算法本地服务器。",
      },
    ],
  },
  // 7. raw — 调查原片（街角伏击与交易记录）
  {
    id: "bd-kabuki-ambush-raw",
    title: "歌舞伎后巷交货原片",
    tier: "raw",
    recorder: "无名跑腿仔（来源不明）",
    synopsis: "一段在歌舞伎雨夜后巷戛然而止的 6 分钟第一人称原片，适合用编辑头环查清伏击者身份。",
    durationMinutes: 6,
    location: "kabuki-market",
    passages: [
      {
        id: "alley-wait",
        label: "霓虹巷口等候",
        minutes: 3,
        outline:
          "录制者靠在生锈自动售货机旁抽烟，手里攥着一只带军用科技封条的铝箱，远处停着一辆熄灯的改装厢货。",
      },
      {
        id: "sudden-flash",
        label: "红点与断联",
        minutes: 3,
        outline: "巷口铁梯上方闪过一道激光瞄准红点，紧接着电磁脉冲炸响，画面雪花翻涌后彻底黑屏。",
      },
    ],
    details: [
      {
        id: "ambush-plate",
        passage: "alley-wait",
        layer: "visual",
        finding: "厢货挡风玻璃内侧贴着漩涡帮沃森废弃食品厂的通行涂鸦标志。",
      },
      {
        id: "ambush-comms",
        passage: "sudden-flash",
        layer: "audio",
        finding: "脉冲炸响前半秒，巷顶无线电泄出沙哑指令：“箱子带走，活口拖回全食品厂拆义体。”",
      },
      {
        id: "ambush-snipers",
        passage: "sudden-flash",
        layer: "thermal",
        finding: "铁梯上方与对面空调外机处藏着两处明显高于环境温度的义体散热源。",
      },
    ],
  },
  // 8. xbd — 地下黑超梦（清道夫厂牌，高神经冲击风险 + 关键线索）
  {
    id: "bd-scav-xbd-moth",
    title: "死蛾子·地下黑超梦（XBD）",
    tier: "xbd",
    xbdRisk: "未经任何痛觉与恐惧滤波，直看极易引发剧烈耳鸣、感官解离与幻痛神经症状",
    recorder: "清道夫地下厂牌「死蛾子」",
    synopsis:
      "扭扭街暗巷私下流通的非法无滤波黑超梦，记录了清道夫地下冰浴作坊的残酷片段，却也无意间露出了作坊位置线索。",
    durationMinutes: 6,
    location: "jig-jig-street",
    passages: [
      {
        id: "ice-basement",
        label: "潮湿地下室",
        minutes: 3,
        outline:
          "刺眼的冷白日光灯剧烈频闪，录制者的剧烈心跳、缺氧喘息与刺骨寒意毫无过滤地砸进神经，四周摆满挂着塑料帘的铁架床。",
      },
      {
        id: "scav-mask",
        label: "全息面具与杂音",
        minutes: 3,
        outline:
          "两名戴着闪屏全息面具的清道夫推着手术车走近，电锯预热声与失真重金属混作一团，强神经冲击令画面在剧痛中强行切断。",
      },
    ],
    details: [
      {
        id: "xbd-crate-logo",
        passage: "ice-basement",
        layer: "visual",
        finding: "铁架床角落堆着印有「圣多明戈发电厂旧仓 B-4」字样的工业冷链箱与扭扭街外卖纸杯。",
      },
      {
        id: "xbd-subway-echo",
        passage: "ice-basement",
        layer: "audio",
        finding:
          "剥离失真音乐后，每隔四十五秒天花板就会传来轻轨列车驶过钢梁的低频轰鸣与工业排风声。",
      },
      {
        id: "xbd-tub-cold",
        passage: "scav-mask",
        layer: "thermal",
        finding:
          "塑料帘后方藏着三口零度以下的冰浴槽与一台大功率工业制冰机散热口，直通地下排水管网。",
      },
    ],
  },
  // 9. xbd — 地下黑超梦（漩涡帮神经超频改装实录）
  {
    id: "bd-maelstrom-chrome-fever",
    title: "红眼过载·全食品厂黑超梦（XBD）",
    tier: "xbd",
    xbdRisk: "强电流痛觉与多目光学视野畸变未经限幅，直看会引发视神经撕裂感、狂躁与短暂解离",
    recorder: "漩涡帮地下义体工坊（流出版）",
    synopsis:
      "在沃森北区黑市暗流涌动的无滤波黑超梦，从一名刚被强行加装多目光学与超频神经件的漩涡帮成员视角录下，充斥着电弧烧灼与剧烈神经排异。",
    durationMinutes: 7,
    location: "kabuki-market",
    passages: [
      {
        id: "chair-weld",
        label: "焊枪与神经接驳",
        minutes: 3,
        outline:
          "多目光学模块强行同步的瞬间，视界裂成六块重影与刺目红框，电焊臭氧味和神经突触过流灼痛毫无阻隔地冲进大脑皮层。",
      },
      {
        id: "overclock-rush",
        label: "黑蕾丝超频狂潮",
        minutes: 4,
        outline:
          "录制者吞下双倍黑蕾丝冲出手术间，心跳飙破极限，工业重金属噪音化作尖锐电流啸叫，感官在过载白光里骤然撕裂。",
      },
    ],
    details: [
      {
        id: "fever-crate-seal",
        passage: "chair-weld",
        layer: "visual",
        finding:
          "手术台下方堆着印有「军用科技沃森 07 号车队」封条的军规神经稳压模块箱，批号被磨掉一半。",
      },
      {
        id: "fever-boss-voice",
        passage: "overclock-rush",
        layer: "audio",
        finding:
          "剥离狂躁噪点后，背景里有人用合成器变声腔吩咐“把剩下的稳压件明天凌晨转运去北码头废弃冷库”。",
      },
      {
        id: "fever-coil-heat",
        passage: "chair-weld",
        layer: "thermal",
        finding: "手术室隔壁铁门后方藏着一组高温运转的非法大功率神经压制剂合成反应釜与散热管道。",
      },
    ],
  },
  // 10. xbd — 地下黑超梦（狗镇黑墙脉冲实验泄漏原片）
  {
    id: "bd-dogtown-blackwall-leak",
    title: "裂隙回声·狗镇黑市黑超梦（XBD）",
    tier: "xbd",
    xbdRisk: "残存旧网异常脉冲与神经反烧余波，未受压制剂或编辑隔离保护极易直接冲垮神经稳态",
    recorder: "狗镇体育场地下黑客（失踪）",
    synopsis:
      "狗镇黑市高价私售的非法 XBD 残片，录下一名潜网黑客试图打捞旧网军用碎片时遭遇猩红脉冲反噬的最后几分钟。",
    durationMinutes: 6,
    location: "dogtown",
    passages: [
      {
        id: "ice-tub-dive",
        label: "体育场地下冰槽",
        minutes: 3,
        outline:
          "录制者浸在满是碎冰的旧蓄水池里接入私改终端，四周混凝土墙回荡着幽冥犬巡逻队的靴声，数据流骤然泛起不自然的猩红锯齿。",
      },
      {
        id: "crimson-spike",
        label: "猩红反烧脉冲",
        minutes: 3,
        outline:
          "无数错乱语音与冰冷数据噪声瞬间灌满听觉与视网膜，个人链路接口冒出焦烟，录制者在剧烈抽搐与窒息感中彻底失联。",
      },
    ],
    details: [
      {
        id: "leak-terminal-tag",
        passage: "ice-tub-dive",
        layer: "visual",
        finding:
          "终端机箱侧面刻着「狗镇体育场 B2 配电夹层 · 3 号走私链路」与一组尚未失效的离线跳板坐标。",
      },
      {
        id: "leak-netwatch-ping",
        passage: "crimson-spike",
        layer: "audio",
        finding:
          "猩红脉冲噪点底层夹杂着网络监察自动封锁信标的加密握手音，说明这批军用碎片已被网监反向挂标。",
      },
      {
        id: "leak-ice-melt",
        passage: "crimson-spike",
        layer: "thermal",
        finding:
          "脉冲爆发瞬间，录制者后颈接入仓与冰槽电缆温度在两秒内飙升至灼伤区间，旁侧散热器却被人为动过手脚。",
      },
    ],
  },
]);
