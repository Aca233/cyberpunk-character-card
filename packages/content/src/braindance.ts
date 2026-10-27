import { braindanceRules } from "@cp/core";

/**
 * 超梦调查的示例录像：叙事模型开调查时按局面现写一段（写定冻结），这里的三段是给它照着写的样子，
 * 局面对得上时也可以直接拿来用。
 * - 编辑器的叫法照文本库：超梦体验编辑器、编码层：视频 / 音频 / 红外层、录像、线索。
 * - 扫描结果照原作的「名目：内容」加一句结论（文本库 q105 黑超梦片场的扫描条目，例如「类型：」「状态：」「侦测到液体：」）。
 * - 原作依据写在 refs（本机文本库 cyberpunk2077_text.db 的 key）；情节都是本作改编，人物换成了无名的路人，
 *   玩家角色不是 V，不套原作里 V 的经历。原作任务细节没逐句核对。
 */
export const braindances = braindanceRules.BdExampleListSchema.parse([
  {
    id: "suite-datapad",
    when: "委托：查一段公司保镖录下的超梦，弄清高管在酒店套房里出了什么事",
    recording: {
      title: "套房里的交易",
      recorder: "高管的贴身保镖",
      segments: [
        {
          time: "00:04",
          label: "酒店套房",
          visual: "高管背对落地窗坐着，桌上一瓶开了的香槟；对面楼顶有一点反光一闪一闪",
          audio: "空调低鸣，走廊里推车的轮子声由远到近",
          thermal: "房里两个人体热源：高管和录制者自己；窗外很冷，什么都没有",
        },
        {
          time: "00:31",
          label: "递数据板",
          visual: "高管把一块数据板推过桌面，屏幕亮着，传输进度条走到一半",
          audio: "高管压低声音：「钱到账以前，别让任何人进来。」",
          thermal: "数据板发热，正在往外传东西",
        },
        {
          time: "01:12",
          label: "服务生进门",
          visual: "穿酒店制服的服务生推着餐车进门，低着头，袖子盖住左手",
          audio: "门外电子锁「嘀」一声：开的是服务通道的门，不是正门",
          thermal: "服务生的左前臂比全身热一大截，像有东西在里面运转",
        },
        {
          time: "01:58",
          label: "枪响",
          visual: "画面猛地一晃，录制者拔枪开了两枪，服务生已经不在门口；高管倒在桌边",
          audio: "两声枪响都很近，是录制者自己的枪；之后服务通道的门又「嘀」了一声",
          thermal: "录制者手里的枪管发烫；高管的体温开始往下掉",
        },
      ],
      points: [
        {
          id: "datapad",
          segment: 1,
          layer: "visual",
          label: "数据板",
          scan: {
            facts: [
              { name: "类型：", value: "加密数据板" },
              { name: "状态：", value: "正在传输，收件人代号「白鹭」" },
            ],
            conclusion: "高管在把数据卖给一个代号「白鹭」的买家",
          },
          key: true,
        },
        {
          id: "waiter-arm",
          segment: 2,
          layer: "thermal",
          label: "服务生的左臂",
          scan: {
            facts: [
              { name: "热源：", value: "左前臂内侧" },
              { name: "判断：", value: "收起来的刀刃型手臂义体" },
            ],
            conclusion: "进门的不是服务生，是装了螳螂刀的杀手",
          },
          key: true,
        },
        {
          id: "service-door",
          segment: 2,
          layer: "audio",
          label: "门锁声",
          scan: {
            facts: [
              { name: "来源：", value: "服务通道电子锁" },
              { name: "权限：", value: "酒店后勤卡" },
            ],
            conclusion: "有人提前给了杀手后勤卡，进出都走服务通道",
          },
          key: true,
        },
        {
          id: "window-glint",
          segment: 0,
          layer: "visual",
          label: "对面楼顶的反光",
          scan: {
            facts: [
              { name: "类型：", value: "全息广告牌的支架" },
              { name: "状态：", value: "随广告循环闪烁" },
            ],
            conclusion: "只是广告牌，不是狙击镜",
          },
          key: false,
        },
        {
          id: "guard-gun",
          segment: 3,
          layer: "thermal",
          label: "录制者的枪",
          scan: {
            facts: [
              { name: "状态：", value: "刚开过两枪" },
              { name: "弹着：", value: "门框，没打中人" },
            ],
            conclusion: "保镖开了枪，但子弹打在门框上",
          },
          key: false,
        },
        {
          id: "champagne",
          segment: 0,
          layer: "visual",
          label: "香槟",
          scan: {
            facts: [
              { name: "品质：", value: "高级" },
              { name: "状态：", value: "只倒了一杯" },
            ],
            conclusion: "高管在等着庆祝，没打算和谁分",
          },
          key: false,
        },
      ],
      conclusions: [
        { id: "buyer-hit", text: "买家「白鹭」拿到数据后，派人扮成服务生从服务通道进来灭口" },
        { id: "guard-betray", text: "保镖自己开枪杀了高管，服务生只是碰巧进门" },
        { id: "sniper", text: "对头公司的狙击手从对面楼顶开的枪" },
      ],
      answer: "buyer-hit",
      truth:
        "高管私下把公司数据卖给代号「白鹭」的买家；买家不想留活口，通过酒店后勤的内线拿到后勤卡，派装了螳螂刀的杀手扮成服务生进门，一刀得手后从服务通道离开。保镖开了两枪都打在门框上。",
    },
    refs: [
      "Story-base-journal-quests-main_quest-prologue-q004_braindance-02_find_documents_description",
      "Story-base-journal-onscreens-tutorials-Bd_correct_layer_description",
    ],
    source:
      "本作改编：借原作序章超梦教学「当数据板打开时在视频层里对它进行扫描」的做法，人物、地点和案情都是自拟，没核对原作细节",
  },
  {
    id: "black-studio",
    when: "有人托玩家找一个失踪的超梦演员，手上只有她最后录下的一段超梦",
    recording: {
      title: "最后一次试镜",
      recorder: "失踪的超梦演员",
      segments: [
        {
          time: "00:09",
          label: "出租屋",
          visual: "她翻着一本杂志，折角的一页上圈了一个电话；桌上一个装着钱的信封",
          audio: "楼下的车流声，她自言自语：「这次总该轮到我了。」",
          thermal: "屋里只有她一个人，暖气片冷着",
        },
        {
          time: "02:40",
          label: "仓库门口",
          visual: "一扇生锈的卷帘门，门边堆着贴好封条的箱子",
          audio: "远处一声很长的雾笛，海鸥叫；有人在门里喊她的名字",
          thermal: "卷帘门后面有四五个热源，挤在一起不动",
        },
        {
          time: "03:15",
          label: "片场",
          visual: "灯光很亮，一张不锈钢台子，旁边一副手铐；几个化学桶堆在角落",
          audio: "导演说「放松，就当是试镜」，录制者的心跳越来越快",
          thermal: "隔壁房间那几个热源一直没动过，体温偏低",
        },
        {
          time: "03:52",
          label: "黑屏",
          visual: "有人从背后按住她，画面一黑",
          audio: "她在叫，导演说：「这条留着，能卖好价钱。」",
          thermal: "录制者的体温骤升，随后录像中断",
        },
      ],
      points: [
        {
          id: "magazine",
          segment: 0,
          layer: "visual",
          label: "杂志",
          scan: {
            facts: [
              { name: "片名：", value: "《演艺夜之城》" },
              { name: "当前页面：", value: "求职" },
            ],
            conclusion: "超梦演员用来找低薪工作的杂志：她是照招聘广告去的",
          },
          key: true,
        },
        {
          id: "foghorn",
          segment: 1,
          layer: "audio",
          label: "雾笛声",
          scan: {
            facts: [
              { name: "来源：", value: "货船雾笛" },
              { name: "距离：", value: "不到一公里" },
            ],
            conclusion: "仓库就在港口边上",
          },
          key: true,
        },
        {
          id: "captives",
          segment: 2,
          layer: "thermal",
          label: "隔壁的热源",
          scan: {
            facts: [
              { name: "数量：", value: "五个人体" },
              { name: "状态：", value: "被绑着，体温偏低" },
            ],
            conclusion: "被关在这里的不止她一个",
          },
          key: true,
        },
        {
          id: "handcuffs",
          segment: 2,
          layer: "visual",
          label: "手铐",
          scan: {
            facts: [
              { name: "状态：", value: "完好" },
              { name: "侦测到液体：", value: "人血" },
            ],
            conclusion: "受害人没有逃生的机会",
          },
          key: false,
        },
        {
          id: "steel-table",
          segment: 2,
          layer: "visual",
          label: "不锈钢台子",
          scan: {
            facts: [
              { name: "品质：", value: "高级" },
              { name: "状态：", value: "使用过" },
            ],
            conclusion: "适合进行外科手术",
          },
          key: false,
        },
        {
          id: "envelope",
          segment: 0,
          layer: "visual",
          label: "信封",
          scan: {
            facts: [
              { name: "内容：", value: "两百欧元" },
              { name: "来源：", value: "片方给的定金" },
            ],
            conclusion: "她收了定金，以为是正经活",
          },
          key: false,
        },
      ],
      conclusions: [
        { id: "black-bd", text: "她照招聘广告去试镜，被关在港口仓库的黑超梦片场，和别人一起" },
        { id: "ran-off", text: "她拿了定金自愿去拍，拍完拿钱跑了" },
        { id: "harvest", text: "她被拐去拆义体，人已经没了" },
      ],
      answer: "black-bd",
      truth:
        "片方在《演艺夜之城》上登假招聘，专骗想出头的超梦演员，把人关在港口一间仓库里拍黑超梦，录完转卖。她和另外五个人还关在那里，还活着；那张台子是给不听话的人准备的。",
    },
    refs: [
      "Story-base-gameplay-static_data-database-scanning-main_quests-q105-q105_bd_magazines_conclusion_localizedDescription",
      "Story-base-gameplay-static_data-database-scanning-main_quests-q105-q105_bd_handcuffs_conclusion_localizedDescription",
      "Story-base-gameplay-static_data-database-scanning-main_quests-q105-q105_bd_operation_conclusion_localizedDescription",
    ],
    source:
      "本作改编：扫描条目（杂志、手铐、手术台）的名目和结论照原作第一幕黑超梦片场（q105）的扫描文本，失踪的演员和案情是自拟，不是原作人物",
  },
  {
    id: "alley-shooting",
    when: "街头：有人塞给玩家一段路人录的超梦，NCPD 说巷子里是帮派火并",
    recording: {
      title: "巷子里的两枪",
      recorder: "躲在垃圾箱后面的路人",
      segments: [
        {
          time: "00:02",
          label: "巷口",
          visual: "墙上瓦伦蒂诺帮的涂鸦，一个年轻人背着手站着，对面一个穿夹克的男人",
          audio: "改装车的引擎声在巷口转了一圈开走了",
          thermal: "两个人体热源，一条流浪狗缩在角落",
        },
        {
          time: "00:20",
          label: "拔枪",
          visual: "穿夹克的男人掀开衣襟拔枪，衣襟下面闪了一下金属",
          audio: "年轻人喊：「我什么都没干！」",
          thermal: "年轻人两手空空，手上没有任何发热的东西",
        },
        {
          time: "00:26",
          label: "两枪",
          visual: "年轻人倒下；男人蹲下，把一把手枪塞进他手里",
          audio: "两声枪响，之后男人的对讲机响了",
          thermal: "男人手里的枪管发烫；塞进死者手里的那把是冷的",
        },
      ],
      points: [
        {
          id: "badge",
          segment: 1,
          layer: "visual",
          label: "衣襟下的金属",
          scan: {
            facts: [
              { name: "类型：", value: "NCPD 警徽" },
              { name: "状态：", value: "藏在便衣里" },
            ],
            conclusion: "开枪的人是便衣警察",
          },
          key: true,
        },
        {
          id: "radio",
          segment: 2,
          layer: "audio",
          label: "对讲机",
          scan: {
            facts: [
              { name: "频道：", value: "NCPD 内部" },
              { name: "内容：", value: "「十三号，现场处理干净。」" },
            ],
            conclusion: "有人在频道里等着他收拾现场",
          },
          key: true,
        },
        {
          id: "cold-gun",
          segment: 2,
          layer: "thermal",
          label: "死者手里的枪",
          scan: {
            facts: [
              { name: "温度：", value: "和气温一样" },
              { name: "状态：", value: "没开过火" },
            ],
            conclusion: "这把枪是死后才塞进他手里的",
          },
          key: true,
        },
        {
          id: "graffiti",
          segment: 0,
          layer: "visual",
          label: "涂鸦",
          scan: {
            facts: [
              { name: "类型：", value: "瓦伦蒂诺帮标记" },
              { name: "状态：", value: "新喷的" },
            ],
            conclusion: "这条巷子是瓦伦蒂诺帮的地盘",
          },
          key: false,
        },
        {
          id: "lowrider",
          segment: 0,
          layer: "audio",
          label: "引擎声",
          scan: {
            facts: [
              { name: "类型：", value: "改装低底盘车" },
              { name: "方向：", value: "开出巷口，没停" },
            ],
            conclusion: "帮派的车经过，但没人下车",
          },
          key: false,
        },
        {
          id: "dog",
          segment: 0,
          layer: "thermal",
          label: "角落的热源",
          scan: {
            facts: [{ name: "类型：", value: "流浪狗" }],
            conclusion: "只是一条狗",
          },
          key: false,
        },
      ],
      conclusions: [
        { id: "cop-plant", text: "便衣警察开枪打死了没带枪的年轻人，事后栽了一把枪" },
        { id: "gang-war", text: "瓦伦蒂诺帮在自己地盘上火并，年轻人被误伤" },
        { id: "self-defense", text: "年轻人先拔枪，对方是正当防卫" },
      ],
      answer: "cop-plant",
      truth:
        "开枪的是一个拿帮派钱的便衣警察，年轻人撞见了他收钱；他照频道里的吩咐灭口，再把一把没开过火的枪塞进死者手里，报成帮派火并。",
    },
    refs: ["Story-base-journal-onscreens-tutorials-Bd_correct_layer_description"],
    source: "本作改编：原作没有这件事，照超梦教学「录制者感知到的才扫描得出来」的做法自拟",
  },
]);
