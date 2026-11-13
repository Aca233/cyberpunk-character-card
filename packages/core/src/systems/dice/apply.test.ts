import { describe, expect, it } from "vitest";
import { resolveDeathLineChannel, woundPenalty, woundSlotOf } from "../health/apply";
import { humanityCap, isGlitchZone, isImmunosuppressed } from "../humanity/apply";
import { weaponConcealment } from "../inventory/schema";
import { isBlackLaceWithdrawal, isFatigued, phaseClockOf } from "../world/apply";
import { computeTierCrush, prepareCheck, resolveCheck } from "./apply";
import { CheckSpecSchema } from "./schema";

describe("3.0 底层数学与夜之城物理拟真检定引擎", () => {
  it("2d6 三段式结果：Clean（Δ≥0）、Costly（-3≤Δ≤-1）、Fail（Δ≤-4）与双6/双1", () => {
    const spec = CheckSpecSchema.parse({
      intent: "潜入荒坂仓库",
      attribute: "cool",
      tier: "veteran",
      dv: 11,
      success: "潜入成功",
      failure: "触发警报",
    });
    const prep = prepareCheck(spec, 4, "nightCity");
    expect(prep.ok).toBe(true);
    if (!prep.ok) return;

    // 有效属性 4，目标 T2(DV 11) -> need = 7
    expect(prep.check.need).toBe(7);

    // 掷出 4+3=7 -> total 11, Δ = 0 -> clean (success)
    const cleanRes = resolveCheck(prep.check, [4, 3]);
    expect(cleanRes.band).toBe("clean");
    expect(cleanRes.outcome).toBe("success");
    expect(cleanRes.delta).toBe(0);

    // 掷出 3+2=5 -> total 9, Δ = -2 -> costly (事办成了但带刺)
    const costlyRes = resolveCheck(prep.check, [3, 2]);
    expect(costlyRes.band).toBe("costly");
    expect(costlyRes.outcome).toBe("costly");
    expect(costlyRes.delta).toBe(-2);

    // 掷出 2+1=3 -> total 7, Δ = -4 -> fail
    const failRes = resolveCheck(prep.check, [2, 1]);
    expect(failRes.band).toBe("fail");
    expect(failRes.outcome).toBe("failure");

    // 双 6 恒为大成功，双 1 恒为大失败
    expect(resolveCheck(prep.check, [6, 6]).outcome).toBe("critical");
    expect(resolveCheck(prep.check, [1, 1]).outcome).toBe("fumble");
  });

  it("拆分【社会权限层级】与【物理装甲等级】：无甲 T4 高管不防弹，重型外骨骼弹开轻武器", () => {
    // 1. 权限/门禁对抗：拿 T1 街头伪造卡闯 T3 公司门禁 -> 跨 2 级直接拦截
    const gateCrush = computeTierCrush(1, 3);
    expect(gateCrush.blocked).toBe(true);

    // 2. 物理刺杀：拿普通手枪（penetration=1）射击无保镖护卫的 T4 西装高管（targetArmor=0） -> 绝不触发阶级拦截！
    const execSpec = CheckSpecSchema.parse({
      intent: "在旅馆房间近距射杀落单的董事会高管",
      attribute: "reflexes",
      tier: "legend",
      dv: 18,
      targetArmor: 0,
      weaponPenetration: 1,
      success: "一枪毙命",
      failure: "被高管躲入掩体",
    });
    const execPrep = prepareCheck(execSpec, 5, "nightCity");
    expect(execPrep.ok).toBe(true);
    if (execPrep.ok) {
      expect(execPrep.check.tierCrush.blocked).toBe(false);
      expect(execPrep.check.tierCrush.crushDv).toBe(0);
    }

    // 3. 拿普通手枪（penetration=1）正面打重型外骨骼机甲（targetArmor=3） -> 物理跳弹拦截
    const mechSpec = CheckSpecSchema.parse({
      intent: "用手枪射击重型外骨骼机甲正面",
      attribute: "reflexes",
      tier: "elite",
      dv: 14,
      targetArmor: 3,
      weaponPenetration: 1,
      success: "击损机甲",
      failure: "子弹跳弹",
    });
    const mechPrep = prepareCheck(mechSpec, 5, "nightCity");
    expect(mechPrep.ok).toBe(true);
    if (mechPrep.ok) {
      expect(mechPrep.check.tierCrush.blocked).toBe(true);
      expect(mechPrep.check.chance).toBe(0);
      const res = resolveCheck(mechPrep.check, [5, 5]);
      expect(res.band).toBe("fail");
      expect(res.tacticalTags?.[0]).toContain("装甲跳弹拦截");
    }
  });

  it("真实枪械物理体系：Tech 扫描穿墙免反伤、Smart 智能制导与虎爪帮/荒坂干扰器偏转", () => {
    // Tech 武器扫描后隔墙射击：惨胜免除反击风险，且穿甲 +1
    const techSpec = CheckSpecSchema.parse({
      intent: "使用电磁充能步枪隔墙狙击重甲保安",
      attribute: "tech",
      tier: "veteran",
      dv: 11,
      targetArmor: 2,
      weaponPenetration: 1,
      weaponTech: "tech",
      scannedTarget: true,
      success: "穿墙击倒",
      failure: "暴露位置",
    });
    const techPrep = prepareCheck(techSpec, 4, "nightCity");
    expect(techPrep.ok).toBe(true);
    if (techPrep.ok) {
      // 原本穿甲 1 打重甲 2 会 +3 DV，但 Tech 扫描蓄力穿甲 +1 后不再受重甲惩罚
      expect(techPrep.check.tierCrush.crushDv).toBe(0);
      const costly = resolveCheck(techPrep.check, [3, 2]);
      expect(costly.band).toBe("costly");
      expect(costly.riskDelta).toBe(0);
    }

    // Smart 武器：正常情况取智力与反应较高者并避免双 1 大失败；遭遇智能干扰器时偏转 -2
    const smartJammed = CheckSpecSchema.parse({
      intent: "用智能冲锋枪扫射虎爪帮刀手",
      attribute: "reflexes",
      tier: "veteran",
      dv: 11,
      weaponTech: "smart",
      hasSmartLink: true,
      targetSmartJammer: true,
      intelligenceValue: 7,
      reflexesValue: 3,
      success: "命中目标",
      failure: "弹道偏转",
    });
    const jammedPrep = prepareCheck(smartJammed, 3, "nightCity");
    expect(jammedPrep.ok).toBe(true);
    if (jammedPrep.ok) {
      expect(jammedPrep.check.attributeValue).toBe(3);
      expect(jammedPrep.check.formMod).toBe(-2);
    }
  });

  it("四阶段真实伤势、创伤小组信号盲区、自然时钟疲劳、黑蕾丝戒断与武器隐蔽度", () => {
    expect(woundSlotOf({ hp: 100, max: 100 })).toBe(0);
    expect(woundSlotOf({ hp: 80, max: 100 })).toBe(1);
    expect(woundSlotOf({ hp: 45, max: 100 })).toBe(2);
    expect(woundSlotOf({ hp: 20, max: 100 })).toBe(3);
    expect(woundSlotOf({ hp: 0, max: 100 })).toBe(4);

    // 贯通重创（2级）对肉体/反应 -2，对智力不减；打止痛针后压制
    expect(woundPenalty({ hp: 45, max: 100 }, "body")?.value).toBe(2);
    expect(woundPenalty({ hp: 45, max: 100 }, "intelligence")).toBeUndefined();
    expect(woundPenalty({ hp: 45, max: 100, painSuppressed: true }, "body")).toBeUndefined();

    // 创伤小组白金卡：在地下掩体/信号屏蔽区无法降落救援，改走副心脏或同伴拖离
    const deadZoneRescue = resolveDeathLineChannel({
      hasPlatinumTrauma: true,
      inSignalDeadZone: true,
      hasSecondHeart: true,
      mode: "deathCity",
    });
    expect(deadZoneRescue.channel).toBe("secondHeartOrAlly");

    // 神经负荷与免疫抑制剂压制
    expect(humanityCap({ cyberwareCost: 35 })).toBe(65);
    expect(isGlitchZone(28, false)).toBe(true);
    expect(isGlitchZone(28, true)).toBe(false);
    expect(isImmunosuppressed({ immunosuppressantUntil: 1000 }, 600)).toBe(true);

    // 自然时间与疲劳/黑蕾丝戒断
    expect(phaseClockOf(14 * 60).phase).toBe(0);
    expect(phaseClockOf(23 * 60).phase).toBe(2);
    expect(isFatigued({ phasesAwake: 4 })).toBe(true);
    expect(
      isBlackLaceWithdrawal({ blackLaceDoses: [100, 500, 900], blackLaceActiveUntil: 1100 }, 1200),
    ).toBe(true);

    // 武器隐蔽度：手枪可藏入衣袋（pocket），狙击枪属于显眼重武（heavy）
    expect(weaponConcealment("pistol")).toBe("pocket");
    expect(weaponConcealment("smg")).toBe("coat");
    expect(weaponConcealment("assaultRifle")).toBe("open");
    expect(weaponConcealment("sniperRifle")).toBe("heavy");
  });
});
