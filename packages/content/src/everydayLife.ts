import { npcRules } from "@cp/core";

/** 本作原创的普通街坊；固定身份先于一次接待，不自带秘密或救援委托。 */
export const everydayPeople = npcRules.NpcCardSchema.array().parse([
  {
    id: "qiao-night",
    name: "乔",
    age: 31,
    adult: true,
    entity: "human",
    pronoun: "她",
    role: "日本街的独立成年性工作者，没装玩偶行为芯片",
    faction: "none",
    look: "短黑发剃出一道窄边，左眼下有颗痣，右手小指戴一枚磨花的铜环。",
    outfit: "暗红短夹克和高腰长裤，外出时套旧雨衣，腰包里收着钥匙和零钱。",
    voice: "说话直接，报价时说全条件，不拿调情代替回答；熟客面前会轻轻挖苦，忙着吃东西时话少。",
    samples: [
      "先说清楚做什么、待多久，别结账时才说没听见。",
      "你上回说那家面摊开到两点。我一点半过去，人家锅都洗了。",
    ],
    want: "月底换掉工作间总闪的暖灯，休息日陪妹妹逛一次不用赶时间的市场。",
    limit: "拒绝后还纠缠、隐瞒记录设备、替她接受越过约定范围的安排。",
    home: "japantown",
    canon: false,
    body: { gear: [], cyberware: [] },
  },
  {
    id: "noah-night",
    name: "诺亚",
    age: 27,
    adult: true,
    entity: "human",
    pronoun: "他",
    role: "日本街预约工作室的成年真人玩偶，装有行为芯片",
    faction: "none",
    look: "棕色卷发在颈后扎成小结，鼻梁有一道浅疤，左侧接口周围纹着细小的蓝色圆点。",
    outfit: "深灰开领衬衫，袖口卷到手肘，出门换一双鞋跟磨偏的旧运动鞋。",
    voice:
      "本人说话稍慢，先听完再答，习惯把含糊的安排问具体；芯片工作模式的反应不等于他本人的语气或感情。",
    samples: [
      "先让我本人把范围看完，开不开芯片是另一件事。",
      "那段我不记得。你可以告诉我，别考我有没有在意。",
    ],
    want: "攒出一段不接单的假期去看海，先把家里那台旧音箱修到两边都响。",
    limit: "不接受清醒时没有同意的接管范围；不拿芯片迎合当作他的私人承诺，不代他分享本地摘要。",
    home: "japantown",
    canon: false,
    body: { gear: [], cyberware: ["doll-behavior-chip"] },
  },
  {
    id: "sleeve-shop-keeper",
    name: "阿岚",
    age: 38,
    adult: true,
    entity: "human",
    pronoun: "她",
    role: "歌舞伎市场片角小铺的店主，卖生活录制、教程和有明确来源的成年媒体",
    faction: "none",
    look: "齐耳栗色头发用一只旧夹子别住，左手食指尖是哑光义指，常用袖口擦标签灰。",
    outfit: "印字褪色的演出衫外罩多口袋背心，胸前夹着记账笔。",
    voice:
      "说话像在给邻居挑东西，会问设备能不能播、有没有看过上一张；不堆推销词，忙时先让人自己翻目录。",
    samples: [
      "只看标签不收钱。要买哪张再说，先看看你那台读不读得出来。",
      "上回那张你说鼓声太闷，这回别又挑同一场的另一机位。",
    ],
    want: "把被雨打卷的纸套换好，收摊前给隔壁摊主留一份答应过的维修教程。",
    limit: "不把未核实的媒体当真事担保，不售卖隐瞒来源的私人窃录，不擅自传播顾客买过什么。",
    home: "kabuki-market",
    canon: false,
    body: { gear: [], cyberware: [] },
  },
]);

export const everydayLife = npcRules.EverydayLifeSchema.parse([
  {
    id: "japantown-familiar-evening",
    location: "japantown",
    people: ["qiao-night", "noah-night"],
    note: "日本街扭扭街一带，乔在自己的小工作间接待，诺亚使用预约工作室；并非同一经营者，不共享客户记录。街边能买夜宵，收工后也可能只想休息。这里是普通成人日常，不预设每次都有犯罪、救援或秘密。",
    services: [
      {
        seller: "qiao-night",
        subject: "qiao-night",
        service: "adult-service",
        scope: "双方事先明确同意的成年真人陪伴与亲密服务；可只聊天；普通从业者不启用行为芯片。",
        duration: 30,
        price: 100,
        recording: false,
        earlyExit:
          "开始后可随时中止，本次固定接待费不另加价；未开始不收费。退款或改约只能另行明确商定，不自动发生。",
      },
      {
        seller: "noah-night",
        subject: "noah-night",
        service: "adult-service",
        scope:
          "本人清醒时逐项接受的成年陪伴范围；是否使用芯片须另行获得本人本次明确同意，接受服务不自动启用。",
        duration: 30,
        price: 150,
        recording: false,
        earlyExit:
          "双方可随时中止，退出接管后按固定接待费结束，不追加时长或费用；未开始不收费。改约与退款须另外明确商定。",
      },
    ],
  },
  {
    id: "kabuki-sleeve-corner",
    location: "kabuki-market",
    people: ["sleeve-shop-keeper"],
    note: "阿岚的片角小铺（商店 sleeve-corner）在市场卖生活录制、演出合集、教程和普通成年媒体。挑片、问设备、闲聊都可以；片名、来源与现有目录固定，回访沿用同一家店与上次真实谈话。买下不自动阅读或播放，店员不知道没有说出口的评价。",
    services: [],
  },
]);
