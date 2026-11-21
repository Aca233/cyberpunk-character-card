# 玩家内容包制作与分享（v2）

当前创意工坊使用本地 JSON 文件分享内容。可以导入模块、人物、武器及其他物品、义体、超梦作品和芯片资料，并明确指定哪些商店或诊所出售它们。当前页面提供导入、校验、启停、导出和卸载；条目的具体内容先在 JSON 中编辑。

## 导入与生效

1. 在「角色档案」进入「创意工坊」，下载空白模板，或使用本文的示例。
2. 修改 JSON 后点击「导入内容包」。页面会检查字段结构、重复 ID 和目录引用，并显示条目摘要。
3. 修正列出的问题，校验通过后点击「安装内容包」。同一个包 ID 不能重复安装；替换本地包时先卸载旧包，再导入修改后的文件。
4. 启用包后，模块、人物和符合开局规则的武器、义体进入角色创建目录。物品不会因为安装就直接发给玩家；需要上架、随人物持有，或在实际剧情中取得。
5. 新建存档会保存启用包的完整快照。角色已经选用的包也会随该存档保存，每份存档最多使用 40 个包。之后修改、停用或卸载本地包，不会改变已有存档；新装的包也不会自动加入已有存档。

包中的 JSON 是数据，不能包含执行代码、脚本、插件或任意自定义逻辑。能力说明用于表达当前系统能够处理的内容；新增一个字段或在描述中宣称能力，不会自动创建新的结算机制。

## 角色卡单独分享

可玩的玩家角色使用独立文件，不放在内容包的 `npcs` 中：

- 在「角色档案」点击「导出当前角色」，得到 `format: "cp2077-character"`、`version: 1` 的 JSON。
- 接收者点击「导入角色 JSON」，通过校验后会作为新角色保存到自己的角色库，不覆盖已有角色。切换前仍会保护当前未保存的修改。
- 角色卡如果选用了内容包的武器、义体、模块或人物，应同时分享并安装相应内容包。角色 JSON 不会自动打包这些依赖。
- 导出会去掉本机角色立绘引用，不会把本机生图或立绘文件打包给接收者。

玩家角色文件的外壳如下；`character` 应使用实际导出的完整角色数据：

```json
{
  "format": "cp2077-character",
  "version": 1,
  "character": {}
}
```

上面的空对象只是外壳说明，不是可导入的完整角色。

## 内容包外壳与 ID

```json
{
  "format": "cp2077-workshop-pack",
  "version": 2,
  "id": "my-pack",
  "title": "我的夜之城内容包",
  "author": "创作者署名",
  "description": "这份包包含什么内容",
  "modules": [],
  "acquaintances": [],
  "npcs": [],
  "seedNpcs": [],
  "items": [],
  "cyberware": [],
  "braindances": [],
  "chipContents": [],
  "shopListings": [],
  "ripperdocListings": []
}
```

空数组以及有默认值的元数据可以省略。顶层只接受当前定义的字段，不要自行添加 `scripts`、`events` 等未知字段。

- 包 `id` 最多 22 个字符；包内条目 `id` 最多 33 个字符。
- ID 只用小写英文字母、数字和单个连字符，不能以连字符开头或结尾，不能连续写两个连字符，也不能包含空格。例如 `rooftop-evening` 合法。
- 同包中的模块、NPC、物品、义体、超梦和芯片资料不能互相重用同一个条目 ID。超梦片段和芯片正文分段分别在所属作品或资料内保持唯一。
- JSON 内引用本包内容时，直接写该条目的原始 ID。进入游戏时会自动改写成 `wk-<包ID>--<条目ID>`。例如 `quiet-rooftop` 包的 `rooftop-chip` 变为 `wk-quiet-rooftop--rooftop-chip`；这个双连字符分隔符由系统生成，作者不要写进原始 ID。
- 引用只支持**本包条目或游戏自带目录**，暂不支持跨玩家内容包依赖。不要把其他包的运行时 ID 当作依赖写入。

## 各类条目

| 字段 | 内容与使用方式 |
| --- | --- |
| `modules` | 角色主板模块。`slot` 为 `origin`、`past`、`skill` 或 `flaw`；主要填写 `id`、`slot`、`label`、`ability`、`hook`，可带标签、检定属性和模块带出的故人。安装后可在建角时选择。 |
| `acquaintances` | 人脉关系预设。可引用本包或游戏自带 NPC，也可用 `custom: true` 写简要自创旧识；填写名字、身份、关系和关系备注。关系值为 `nod`、`friend`、`owesYou`、`youOwe`、`ex` 或 `grudge`。 |
| `npcs` | 完整 NPC 人物卡，包含身份、外观、口吻、动机、边界及身体装备等现有字段。它与可玩的玩家角色卡不是同一种结构。`body.gear` 引用物品，`body.cyberware` 引用义体。 |
| `seedNpcs` | 要在新局初始化时加入出场人物的包内 NPC ID。只定义在 `npcs` 中，不等于该人物自动在每个场景出现。 |
| `items` | 完整物品定义。`kind` 支持 `weapon`、`healing`、`grenade`、`consumable`、`clothing`、`mod`、`misc`；芯片、阅读器和超梦设备通常用 `misc`。 |
| `cyberware` | 完整义体定义，包含部位、稀有度、参考价、人性成本和实际能力等。义体价格必须大于 0；建角仍遵守部位容量及开局可选规则。 |
| `braindances` | 超梦作品定义：作品信息、分段梗概、每段时长，以及可通过具体方式查证的细节。所有片段时长之和必须等于 `durationMinutes`。 |
| `chipContents` | 芯片里的固定资料，与实体载体分开保存。可承载邮件、日记、录音、普通资料、功能辅助内容或超梦作品引用。 |
| `shopListings` | 给已有商店上架物品，填写 `shop`、`item` 和 `stock`。`shop` 是游戏自带商店 ID；`item` 是本包或自带物品 ID。默认库存为 1。 |
| `ripperdocListings` | 给已有义体诊所上架义体，填写 `ripperdoc`、`cyberware` 和 `stock`。默认库存为 1。 |

详细字段以源码 schema 为准：`packages/core/src/schemas/workshop.ts` 负责包结构与引用；各条目复用现有系统中的物品、义体、NPC、芯片和超梦 schema。包内不支持新增商店或诊所定义，上架只能指向已有目录中的地点经营者。

武器还需要填写类别、对应检定属性，以及远程武器体系；近战武器不能写威能、技术或智能类型。预装改装件也必须是已登记且可适用的改装件。普通上架交易继续使用物品参考价和商店现有规则，不会绕开实际库存、货源或交易条件。

## 芯片、超梦与设备的引用链

实体芯片、资料内容与超梦作品是三份不同数据：

```text
items 中的实体载体
  chipContentId → chipContents 中的固定资料
                   braindance → braindances 中的超梦作品
```

`chipContents` 的 `parts` 是可读取的正文分段，每段有 `id`、`label`、`text`，可选 `media` 与 `encrypted`（布尔，默认 `false`）；`kind` 为 `recording`、`email`、`diary` 或 `data`；`category` 必填，为 `intel`（情报资料）、`daemon`（加密魔偶/信用芯片/陷阱）、`skill`（技能协议）、`braindance`（超梦卷轴）或 `behavior`（行为协议）。可选字段：`encryption`（`none` / `standard` / `corp` / `military`）、`hazard`（`none` / `malware` / `black-ice`）、`eddies`（加密信用芯片内含欧元，默认 `0`）、`ability`（技能/行为协议插槽后的定性能力描述）、`protocol`（行为协议名）、`braindance`（关联超梦作品 ID）。

- 未加密、无隐患的芯片可直接通过个人颈后神经槽读取；未知来历或带隐患芯片需隔离芯片读写器（`chipDevice: "reader-writer"`）执行沙盒查毒；离线破译加密芯片需要完好网络接入仓（可配合隔离读写器）；空白存储载体填写 `chipStorage: true`。
- 播放实体超梦需要可接触的作品载体，以及填写了 `braindanceDevice.playback: true` 的真实设备。`analysis` 只能列出设备确实支持的 `visual`、`audio`、`thermal` 三层轨道（不要给纯超梦头环填写 `chipDevice`）。
- `skill` / `behavior` 类芯片可插入个人颈后神经槽（上限 2 槽，同款协议不可重复叠加）提供真实定性能力，拔出即失效，不提供属性数值或骰点加值；`behavior` 芯片需已安装完好的行为芯片义体（`doll-behavior-chip`）。
- 买到芯片不等于已经阅读；买到超梦也不等于已经观看或发现全部细节。内容定义不是角色已经知道的事实。
- 目前包可以出售实体超梦载体和播放设备；不能通过 `shopListings` 把作品直接添加到商家的付费超梦体验服务片单。

## 可复制示例：屋顶超梦、芯片与便携播放器

把下面内容保存为 `quiet-rooftop.json` 后导入。它会在歌舞伎市场阿岚的芯片小铺（商店 ID `sleeve-corner`）上架 3 张作品芯片和 1 台播放器。这个示例只使用现有字段，省略的数组与布尔值由 schema 补默认值。

```json
{
  "format": "cp2077-workshop-pack",
  "version": 2,
  "id": "quiet-rooftop",
  "title": "屋顶晚风",
  "author": "你的署名",
  "description": "一部原创生活超梦，以及它的芯片载体和便携播放设备。",
  "items": [
    {
      "id": "rooftop-chip",
      "name": "《屋顶晚风》作品芯片",
      "kind": "misc",
      "price": 80,
      "rarity": "common",
      "chipContentId": "rooftop-program",
      "ability": "承载已授权的生活超梦《屋顶晚风》，需要实际播放设备才能体验。"
    },
    {
      "id": "pocket-player",
      "name": "晚风便携超梦播放器",
      "kind": "misc",
      "price": 300,
      "rarity": "common",
      "braindanceDevice": {
        "playback": true,
        "analysis": ["visual", "audio"]
      },
      "ability": "播放超梦卷轴，支持视觉与音频双层轨道分析，不支持热成像或芯片隔离查毒。"
    }
  ],
  "chipContents": [
    {
      "id": "rooftop-program",
      "title": "《屋顶晚风》发行资料",
      "category": "braindance",
      "kind": "recording",
      "from": "独立录制者林野",
      "summary": "一段收工后整理屋顶花箱的授权生活记录，无额外任务或隐藏报酬。",
      "braindance": "rooftop-evening",
      "parts": [
        {
          "id": "liner-notes",
          "label": "发行说明",
          "text": "录制者林野。全片六分钟，分为上楼与收拾花箱两段。此副本获准私人播放；作品中的约定与经历不自动成为观看者的经历。"
        }
      ]
    }
  ],
  "braindances": [
    {
      "id": "rooftop-evening",
      "title": "屋顶晚风",
      "tier": "raw",
      "recorder": "独立录制者林野",
      "synopsis": "结束夜班后，录制者提着水壶走上屋顶，给花箱浇水，再安静地下楼。",
      "durationMinutes": 6,
      "passages": [
        {
          "id": "stairs",
          "label": "上楼",
          "minutes": 2,
          "outline": "录制者提着水壶沿楼梯上到屋顶，经过一扇贴着褪色维修标签的铁门。记录没有展示门后的房间。"
        },
        {
          "id": "planters",
          "label": "花箱边",
          "minutes": 4,
          "outline": "录制者给薄荷浇水，收起晾在栏杆上的手套。楼下有洗衣机运转声，片尾录制者带着空壶下楼，记录自然结束。"
        }
      ],
      "details": [
        {
          "id": "washer-rattle",
          "passage": "planters",
          "layer": "audio",
          "finding": "音轨里能辨认出滚筒周期性的轻碰声，但没有设备型号、房号或故障检测结果，不能仅凭此认定机器损坏。"
        }
      ]
    }
  ],
  "shopListings": [
    { "shop": "sleeve-corner", "item": "rooftop-chip", "stock": 3 },
    { "shop": "sleeve-corner", "item": "pocket-player", "stock": 1 }
  ]
}
```

示例引用都写本包原始 ID；导入后系统会一起重写载体的 `chipContentId` 和资料的 `braindance`。不要只复制 `braindances` 而遗漏资料或实体载体，否则玩家没有这部作品的实际播放来源。

## 媒体与立绘边界

芯片正文分段和超梦片段可填写 `media` 附件，支持 `link`、`image`、`video`、`audio`；每段最多 8 个。每个附件至少有 `kind`、`url`、`label`，可带 `caption`；视频还可有 `poster`、`captionsUrl`。

媒体只引用**已经存在且可访问的 URL**：`http://`、`https://`，或单斜杠开头的同源路径。不要编造资源地址，也不要填写 `file://`、`data:`、`javascript:`、Windows 本地路径或内嵌执行代码。JSON 包不会上传、复制或内嵌本机媒体文件与立绘；同源路径也需要接收者的服务实际提供该资源。浏览器加载附件不代表角色已经联网、观看或掌握附件内容。
