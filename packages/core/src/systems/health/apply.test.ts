import { describe, expect, it } from "vitest";
import { fixedRng } from "../../kernel/rng";
import type { SystemContext } from "../../kernel/system";
import { applyHit } from "./apply";
import type { HealthState } from "./schema";

/** 战斗伤口按档位扣血，保留已有断肢和义体损坏 */

const ctxOf = (facts: Record<string, unknown> = {}) =>
  ({ rng: fixedRng([]), facts, data: {}, now: 0, read: () => ({}) }) as unknown as SystemContext;

const body = (hp = 100): HealthState => ({
  hp,
  max: 100,
  condition: "up",
  wounds: 0,
  painSuppressed: false,
  severeSince: null,
  bleeds: 0,
  damagedBy: null,
  lostLimbs: [],
  brokenChrome: [],
});

const hit = (tier: "graze" | "heavy" | "lethal") =>
  ({ type: "health.hit", tier, reason: "测试" }) as const;

describe("战斗伤口扣血", () => {
  it.each([
    ["graze", 90],
    ["heavy", 70],
    ["lethal", 40],
  ] as const)("%s 按档位扣血，不新增身体损坏", (tier, hp) => {
    const h = body();
    expect(applyHit(h, { type: "health.hit", tier, reason: "测试" }, ctxOf()).ok).toBe(true);
    expect(h.hp).toBe(hp);
    expect(h.lostLimbs).toEqual([]);
    expect(h.brokenChrome).toEqual([]);
  });

  it("登记新伤不会清除已有断肢和义体损坏", () => {
    const h = body();
    h.lostLimbs = ["left-arm"];
    h.brokenChrome = ["kiroshi-mk1"];
    applyHit(h, { type: "health.hit", tier: "heavy", reason: "测试" }, ctxOf());
    expect(h.hp).toBe(70);
    expect(h.lostLimbs).toEqual(["left-arm"]);
    expect(h.brokenChrome).toEqual(["kiroshi-mk1"]);
  });

  it("皮肉硬吃：致命一下打空血量就濒死，护甲降一档", () => {
    const a = body(50);
    applyHit(a, hit("lethal"), ctxOf());
    expect(a.condition).toBe("dying");
    const b = body();
    applyHit(b, hit("heavy"), ctxOf({ armor: "防弹衣" }));
    expect(b.hp).toBe(90);
  });

  it("已经倒下不能再挨打", () => {
    const h = { ...body(0), condition: "down" as const };
    expect(applyHit(h, hit("graze"), ctxOf()).ok).toBe(false);
  });
});
