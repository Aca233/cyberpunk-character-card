import { describe, expect, it } from "vitest";
import { fixedRng } from "../../kernel/rng";
import type { SystemContext } from "../../kernel/system";
import { applyHit } from "./apply";
import type { HealthState } from "./schema";

/** 战斗里没拦下的一下：拿义体、胳膊腿还是皮肉去抵 */

const ctxOf = (facts: Record<string, unknown> = {}) =>
  ({ rng: fixedRng([]), facts, data: {}, now: 0, read: () => ({}) }) as unknown as SystemContext;

const body = (hp = 100): HealthState => ({
  hp,
  max: 100,
  condition: "up",
  severeSince: null,
  bleeds: 0,
  damagedBy: null,
  lostLimbs: [],
  brokenChrome: [],
});

const hit = (tier: "graze" | "heavy" | "lethal", pay: "chrome" | "limb" | "flesh", more = {}) =>
  ({ type: "health.hit", tier, pay, reason: "测试", ...more }) as const;

describe("拿身体抵伤", () => {
  it("义体替你挡：义体坏了，不掉血", () => {
    const h = body();
    expect(applyHit(h, hit("heavy", "chrome", { chrome: "kiroshi-mk1" }), ctxOf()).ok).toBe(true);
    expect(h.brokenChrome).toEqual(["kiroshi-mk1"]);
    expect(h.hp).toBe(100);
  });

  it("舍掉肢体：断了，血按低一档扣", () => {
    const h = body();
    applyHit(h, hit("heavy", "limb", { limb: "left-arm" }), ctxOf());
    expect(h.lostLimbs).toEqual(["left-arm"]);
    expect(h.hp).toBe(90);
  });

  it("皮肉硬吃：致命一下打空血量就濒死，护甲降一档", () => {
    const a = body(50);
    applyHit(a, hit("lethal", "flesh"), ctxOf());
    expect(a.condition).toBe("dying");
    const b = body();
    applyHit(b, hit("heavy", "flesh"), ctxOf({ armor: "防弹衣" }));
    expect(b.hp).toBe(90);
  });

  it("已经倒下不能再挨打", () => {
    const h = { ...body(0), condition: "down" as const };
    expect(applyHit(h, hit("graze", "flesh"), ctxOf()).ok).toBe(false);
  });
});
