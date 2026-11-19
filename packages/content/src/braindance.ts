import { braindanceRules } from "@cp/core";

/** 本作原创的固定目录；普通娱乐不附带委托或危险。 */
export const braindances = braindanceRules.BdWorkListSchema.parse([
  {
    id: "bd-night-market",
    title: "摊灯熄灭以前",
    recorder: "歌舞伎夜市摊主阿娴",
    synopsis: "收摊前的一顿夜宵。没有追逐，也没有英雄，只是从一个夜班人的位置看看街口。",
    durationMinutes: 18,
    passages: [
      {
        id: "last-orders",
        label: "最后几单",
        minutes: 6,
        outline:
          "录制者在夜市小摊翻热汤，把同事留的塑料杯挪到风扇下。客人点加辣，送货员抱怨停车位。事件止于正常交付，不出现隐藏求救。",
      },
      {
        id: "shared-table",
        label: "共用的折叠桌",
        minutes: 7,
        outline:
          "录制者端自己的面坐到街沿桌边，与隔壁修鞋的中年人商量明天谁带热水壶。街上广告循环、有人争论球赛，没人向观看者搭话。",
      },
      {
        id: "lights-out",
        label: "关灯",
        minutes: 5,
        outline:
          "录制者清点当天零钱，把没卖完的食材装进保温箱，和对面摊位互道明天见。记录在卷下棚布时自然结束。",
      },
    ],
    details: [],
  },
  {
    id: "bd-rain-rooftop",
    title: "雨停后的屋顶",
    recorder: "独立录制者洛蕾",
    synopsis: "屋顶花箱、楼下的洗衣房和一杯逐渐变凉的咖啡。一段可以安静待着的私人授权作品。",
    durationMinutes: 15,
    passages: [
      {
        id: "stairs",
        label: "走上屋顶",
        minutes: 4,
        outline:
          "录制者沿熟悉的楼梯走上屋顶，把咖啡放在干燥的水泥沿。楼下洗衣房传来滚筒转动声，雨水仍从天线滴落。",
      },
      {
        id: "planters",
        label: "花箱边",
        minutes: 7,
        outline:
          "录制者给几株薄荷修掉烂叶，远处邻居晾起衣服。片中有短信提示但内容未被打开，不能据此辨认发件人或关系。",
      },
      {
        id: "sun-break",
        label: "云层开了一点",
        minutes: 4,
        outline: "云隙透光，录制者喝完咖啡，提起空壶下楼。记录不附秘密或后续任务，平静结束。",
      },
    ],
    details: [],
  },
  {
    id: "bd-small-stage",
    title: "返场第三首",
    recorder: "本地乐手咪娜",
    synopsis: "从小场地键盘手的位置参加一场普通夜演，连同调音、紧张、失误和散场。",
    durationMinutes: 24,
    passages: [
      {
        id: "soundcheck",
        label: "试音",
        minutes: 5,
        outline:
          "录制者在狭窄后台调试键盘，与鼓手确认返场曲目。工作人员递温水，左侧监听音箱偶尔有低噪。",
        media: [
          {
            kind: "image",
            url: "/media/everyday/needle-drop-program.svg",
            label: "《返场第三首》随片节目单",
            caption:
              "本作原创的发行资料，列出试音、返场与散场顺序；不是现实演出公告，也不包含未发现的分析材料。",
          },
          {
            kind: "link",
            url: "/media/everyday/needle-drop-program.svg",
            label: "查看节目单原件",
          },
        ],
      },
      {
        id: "encore",
        label: "返场",
        minutes: 14,
        outline:
          "演出实际经过几首曲子，录制者一处和弦按晚半拍，同伴用眼神提醒，观众继续跟唱。不得把录制者的紧张与释然写成观看者自己决定的情绪。",
      },
      {
        id: "load-out",
        label: "散场",
        minutes: 5,
        outline:
          "录制者收线、整理租来的设备，和工作人员约好取回落下的围巾。现场正常散去，片中约定不会自动变成观看者的任务。",
      },
    ],
    details: [
      {
        id: "monitor-noise",
        passage: "soundcheck",
        cues: ["监听", "低噪", "音箱", "接触不良"],
        method: "audio",
        finding:
          "低噪只出现在左侧监听，随录制者按住接口消失；录音支持接触不良这一解释，不能据此证明有人破坏设备。",
      },
    ],
  },
  {
    id: "bd-service-corridor",
    title: "后勤通道的三分钟",
    recorder: "某酒店维修员，来源标注待核实",
    synopsis: "一份已取得的短记录。可回放门禁声与走廊标识，不包含走廊之外的画面。",
    durationMinutes: 3,
    passages: [
      {
        id: "corridor-entry",
        label: "走入走廊",
        minutes: 1,
        outline:
          "录制者提着工具箱走进酒店后勤走廊，右边有贴着 C-17 标签的配电箱。一个穿工作服的人从侧门经过，面部被门框挡住。",
      },
      {
        id: "lock-tone",
        label: "门锁响起",
        minutes: 1,
        outline: "录制者低头检查墙面检修口，身后门禁响过一次；画面未拍到刷卡者。远处有人推餐车。",
      },
      {
        id: "recording-ends",
        label: "记录结束",
        minutes: 1,
        outline:
          "录制者收回检修探头，拿起工具箱离开，记录正常截止。没有录到房内人员或后续去向，不能补全为既定案情。",
      },
    ],
    details: [
      {
        id: "panel-label",
        passage: "corridor-entry",
        cues: ["配电箱", "C-17", "箱上标签", "走廊标识"],
        method: "observe",
        finding:
          "配电箱标签能辨出 C-17，下面的楼层编号被磨损，无法从记录确认酒店名称或具体楼层；需要另外查证。",
      },
      {
        id: "door-tone",
        passage: "lock-tone",
        cues: ["门禁", "门锁", "刷卡", "确认音"],
        method: "audio",
        finding:
          "门禁发出一次短促确认音；录音没有报读卡号、持卡人或权限类别，不能据此认定某个人刷卡。",
      },
    ],
  },
]);
