# 义体库扩充与图标补全计划（原作缺口 + 角色扮演功能件）

- **状态**：已完成
- **目标**：解决当前 10 个义体部位中手臂、腿部、手部、面部等槽位可选偏少的问题，同时结合本机解包素材（AB 方案）补齐全部新旧义体的原作图标，并为元素变体增加清晰的元素色标与光晕区分。

## 一、扩充范围（共新增 50 件常规义体：119 → 169 件）

| 部位 | 现状（常规 / 不朽） | 新增常规 | 扩充后（常规 / 不朽） | 核心新增内容 |
| --- | --- | --- | --- | --- |
| 手臂 `arms` | 5 / 1 | +14 | 19 / 1 | 四大武器臂 × 热能/电磁/化学 12 件元素变体 + 技师工程义臂 + 战地外科义臂 |
| 腿部 `legs` | 5 / 1 | +5 | 10 / 1 | 磁吸攀爬足、重装液压锚定腿、高空缓冲义腿、恶土全地形义腿、暗藏快拔义腿 |
| 手部 `hands` | 6 / 2 | +6 | 12 / 2 | 虎爪帮智能联锁纹身、强力液压握持、掌心工程诊断接口、近场干扰掌模、精密稳定机械手、暗藏指节微刃 |
| 眼部/面部 `eyes` | 7 / 1 | +6 | 13 / 1 | 行为印记同步面板（易容换脸）、荒坂战术义眼、军用科技热成像义眼、泽塔科技数据流义眼、街头改装夜视义眼、微表情测谎物镜 |
| 操作系统 `os` | 14 / 4 | +6 | 20 / 4 | 生物动力/冬月电子/瑞草/史蒂芬森 4 款经典接入仓 + 荒坂“影步”斯安威斯坦 + 动物帮改装狂暴 |
| 表皮系统 `integumentary` | 14 / 4 | +4 | 18 / 4 | 个人声学消音膜、皮下屏蔽走私腔、镀铬装饰装甲皮、全息伪装覆膜 |
| 额叶皮质 `frontalCortex` | 14 / 3 | +3 | 17 / 3 | 多语实时神经翻译器、情绪稳态阻尼器、黑冰嗅探协处理器 |
| 神经系统 `nervous` | 11 / 2 | +2 | 13 / 2 | 声带频段调制器、节律清醒调节器 |
| 循环系统 `circulatory` | 11 / 1 | +2 | 13 / 1 | 血液毒素净化阀、免疫抑制自动泵 |
| 骨骼 `skeleton` | 12 / 1 | +2 | 14 / 1 | 工业负重脊柱架、肋骨防爆缓冲架 |

## 二、图标方案（AB 组合）

1. **从 `C:\Cyberpunk 2077\_unpack` 抽取原作专属图标（+33 张 160×160 原作高清单图）**：
   - 追加到 `tools/assets/manifest.json` 的 `groups.implants`：包含 `cw_facemask`（行为印记面板）、`icon_tattoo_tyger`（虎爪帮纹身）、`cw_hands_powergrip`（强力握持）、4 款经典接入仓、3 款岐路司光学变体、`cw_eyes_critical_iconic`、`cw_os_capacity_booster`、`cw_integumentary_personalsoundsilencer`、`cw_integumentary_metalcoveredskin`、`cw_integumentary_holographiccamo`、`cw_immunesystem_toxincleanser`、`cw_immunesystem_reversemetabolicenhancer`、`cw_frontalcortex_fastaccessmemory`、`cw_nervoussystem_nervoussystemdischarge`、`cwf_arasakasandevistan`、`cwf_animalsberserk` 等。
   - 运行 `tsx tools/assets/pick.ts --tier demo --only ui` 导出至 `apps/web/public/assets/local/ui/` 并重新生成 `apps/web/src/assets/ids.gen.ts`。
2. **全量补全 `apps/web/src/features/story/art.ts` 映射**：
   - 为全部 50 件新义体 + 18 件此前漏配的旧义体（含 `kiroshi-cockatrice`、`chrome-compressor`、`metabolic-editor`、`doll-behavior-chip` 等）绑定对应的 `cyberArt.*`，实现 **169 件义体 100% 图标覆盖**。
3. **元素变体视觉区分（`CyberItemCell` 与 `CyberDoll`）**：
   - 在 `art.ts` 新增 `itemElementOf(id)` 返回 `"thermal" | "electrical" | "chemical" | undefined`。
   - 在 `CyberDoll.tsx` 与 `neural.module.css` 为元素变体义体格添加对应属性微光（热能橙红 / 电磁电青 / 化学毒绿）与右上角紧凑元素角标（`热` / `电` / `毒`），在捏人、义体医生与局内义体页同步生效。

## 三、义体医生货架与平衡规则

- 维克多自动上架所有 `!iconic` 常规义体，天然包含全部 50 件新义体。
- 为歌舞伎黑市医生「针眼」（`packages/content/src/ripperdocs.ts`）与各城区诊所（`packages/content/src/merchant-sites.ts`）补充契合区域生态的精选新义体。
- 严格遵循 `contentPriceIssues` 稀有度价格区间，所有 `ability` 描述采用定性因果中文，不出现 `+N` / `N%` 数值公式；所有带 `deckTraits` 的义体均配齐 `deckProfile` 与 `deckSlots`（OS 位）。

## 四、验收清单

- [x] `tsx tools/assets/pick.ts --tier demo --only ui` 与 `tsx tools/assets/check.ts` 零缺图通过（UI 707 张，新增 34 张 160×160 原作义体图标）
- [x] `tsx tools/check-data.ts` 通过且所有 169 件义体均存在 `itemArtOf(id)` 映射（缺图数 `0`）
- [x] `biome check` 针对所有改动文件通过
- [x] `tsc --noEmit` 覆盖全部 5 个包零报错
