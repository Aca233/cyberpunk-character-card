# 装备差异化深度重写计划（去水分、强个性、轻架构）

- **状态**：已完成
- **目标**：在不引入笨重新字段或复杂数值表格的前提下，通过深度重写高度同质化的义体与武器 `ability` 文案，并补通【当前状态】的武器特质透传与极少量现成系统钩子，让每一件义体和武器在阅读与实战判定中都具备不可替代的战术绝活与真实物理短板。

## 一、重写原则

1. **一物一绝活**：告别“提升护甲 / 提高暴击率 / 缩短冷却”等动作游戏数值直译，转化为真实可落地的物理现象、战斗动作或剧情交互优势。
2. **明确短板与条件**：绝大多数装备附带清晰的使用前提、暴露风险或生理/环境代价（如发热、显眼、怕 EMP、震手腕、站桩无效、涉水易沉等），使配装成为有取舍的战术决策。
3. **零数值公式与废话**：不含 `+N` / `-N` / `N%`，砍掉“毁灭性破坏 / 显著增幅 / 极大提升”等空洞修饰词，保持精炼硬核的赛博朋克 2077 机械质感。

## 二、义体重写批次（`packages/content/src/cyberware.ts`）

1. **额叶皮质（13 件）**：重塑暴击系（`limbic-enhancement`、`visual-cortex-support`、`burnout-buffer`、`cox2-optimizer`、`deep-field-visual`）与冷却/缓存系（`ram-upgrade`、`ex-disk`、`memory-boost`、`camillo-ram-manager`、`newton-module`、`bioconductor`、`quantum-tuner`、`ram-reallocator`），各自锚定独特神经机制。
2. **表皮系统（15 件）**：彻底打破“全在加护甲”的同质化（`subdermal-armor`、`cogito-lattice`、`nano-plating`、`painducer`、`proxishield`、`countershell`、`rangeguard`、`carapace`、`defenzikov`、`shock-n-awe`、`pain-editor`、`chitin`、`axolotl`、`peripheral-inverse`、`cellular-adapter`），分清站桩/机动/贴身/背刺/脱战/反伤/断痛等不同物理防护模式。
3. **骨骼系统（12 件）**：拉开承重、稳枪、防撞、药剂增幅、格挡卸力、黑客散热、压电充电、蹲姿锁固、濒死凝骨、体能偏折、重甲沉重与外露铆钉的差异。
4. **神经 / 眼部 / OS / 循环 / 手部 / 腿部撞车对（18 件）**：拉开 5 款斯安威斯坦、4 款狂暴、两对濒死/开战加速神经件（`reflex-tuner` vs `revulsor`、`adrenaline-converter` vs `adreno-trigger`）、两件不朽手部（`immovable-force` vs `isometric-stabilizer`）、循环回复件及短跑腿件的区分，去除 `kiroshi-cockatrice` 的纯“暴击概率”写法。

## 三、武器重写批次（`packages/content/src/items.ts`）

1. **威能 / 技术 / 智能手枪与左轮**：拉开 `tamayura`、`grit`、`omaha` / `kenshin` / `ticon`、`yukimura` / `chao` / `kappa`，并去除 `dying-night`、`pride`、`her-majesty` 等不朽手枪的“暴击率”网游表述。
2. **威能 / 智能冲锋枪与突击步枪**：拉开 `saratoga` / `pulsar` / `guillotine` / `shigure`、`shingen` / `warden` / `dian`、`masamune` / `nowaki` / `umbra` / `copperhead` / `ajax` / `kyubi` 的真实射击手感与战术场景。
3. **霰弹枪 / 狙击枪 / 轻机枪**：锐化 `ma70` vs `defender`、`kolac` / `grad` / `nekomata` / `rasetsu` 及常规霰弹的取舍。
4. **冷兵器刀剑与钝器**：拉开 3 款短刀、4 款重砍刃、2 款战斧、5 款街头钝器与 2 款电击棍的隐蔽/工具/破拆/制服差异，并去除 `satori`、`jinchu-maru`、`errata` 的纯“暴击”字眼。

## 四、轻量化引擎贯通（零新系统、零 UI 膨胀）

- [packages/core/src/systems/inventory/status.ts](file:///c:/cyberpunk-character-card/packages/core/src/systems/inventory/status.ts)：
  - 随身武器行补充精炼武器特质（`summarizeAbility(detail.ability, 72)`），让模型在每轮直接看到手中武器的独特脾气与短板。
  - 手部智能联锁判定同步识别 `tyger-claws-tattoo`（虎爪帮智能联锁纹身）。
- [packages/core/src/systems/inventory/schema.ts](file:///c:/cyberpunk-character-card/packages/core/src/systems/inventory/schema.ts)：
  - 承重骨骼集合 `LOAD_BEARING_CYBERWARE` 同步纳入 `cargo-spine-frame`（工业负重脊柱架）。
- [packages/core/src/systems/cyberware/status.ts](file:///c:/cyberpunk-character-card/packages/core/src/systems/cyberware/status.ts)：
  - 将 `trimAbility` 上限适度放宽至 88 字，确保义体的绝活与代价不被过早腰斩；元素手臂变体在状态栏显式标出元素属性。

## 五、验收清单

- [x] `tsx tools/check-data.ts` 通过（零 `+N`/`N%` 违规、价格与引用校验全过，物品 195、义体 169）
- [x] `biome check` 针对所有修改文件零错误
- [x] `tsc --noEmit` 全部 5 个包零报错
