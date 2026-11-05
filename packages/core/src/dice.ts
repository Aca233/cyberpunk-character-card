/**
 * 《赛博朋克 2077：边缘账本》3.0 核心数学与物理检定引擎门面模块（Chapter 1 & Chapter 7）
 * - 2d6 钟形骰池（双 6 大成功 / 双 1 大失败）
 * - 社会权限层级（Social Tier 1~4）与物理防护装甲（Armor Grade 0~3）双轨判定
 * - 三段式结果裁定（clean 干净利落 Δ ≥ 0 / costly 惨胜 -3 ≤ Δ ≤ -1 / fail 搞砸 Δ ≤ -4）
 * - 硬件池（≤ 3）与战术池（≤ 4）、真实枪械物理体系（Power / Tech / Smart + 智能干扰）与声学隐蔽特征
 */

export * from "./systems/dice";
