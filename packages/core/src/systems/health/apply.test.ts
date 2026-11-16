import { describe, expect, it } from "vitest";
import { fixedRng } from "../../kernel/rng";
import type { SystemContext } from "../../kernel/system";
import { applyDamage, applyHeal, applyHit, healthDisplay, recoverInjuries, revive } from "./apply";
import { health } from "./index";

const ctx = (now = 0, facts: Record<string, unknown> = {}): SystemContext => ({
  rng: fixedRng([]), facts, data: {}, now,
  read: <T>() => ({ healing: { id: "maxdoc", charges: 1 } }) as T,
});

describe("伤势由身体事实驱动", () => {
  it("大量浅伤不会按固定百分比累加成死亡或损坏义体", () => {
    const state = health.initial();
    for (let i = 0; i < 30; i++) applyDamage(state, { type: "damage", tier: "graze", part: "left-arm", reason: `玻璃擦伤 ${i}` }, ctx(i));
    expect(state.injuries).toHaveLength(30);
    expect(state.condition).toBe("up");
    expect(state).not.toHaveProperty("hp");
    expect(state.brokenChrome).toEqual([]);
    expect(healthDisplay(state)).toEqual({ hp: 90, max: 100 });
  });
  it("致命伤立即需要救援，未治疗不随等待消失", () => {
    const state = health.initial();
    applyHit(state, { type: "health.hit", tier: "lethal", part: "chest", injuryId: "shot-1", reason: "贯穿胸口" }, ctx());
    expect(state.condition).toBe("dying");
    recoverInjuries(state, { from: 0, to: 20 * 1440 });
    expect(state.injuries).toHaveLength(1);
    expect(revive(state, 20 * 1440).ok).toBe(true);
    expect(state.condition).toBe("up");
    expect(state.injuries[0]).toMatchObject({ id: "shot-1", treated: true, healsAt: 27 * 1440 });
    recoverInjuries(state, { from: 20 * 1440, to: 27 * 1440 });
    expect(state.injuries).toEqual([]);
  });
  it("治疗针只缓解症状并消耗真实补给，休整不会清除重伤", () => {
    const state = health.initial();
    applyDamage(state, { type: "damage", tier: "heavy", part: "right-leg", reason: "骨折" }, ctx());
    const use = applyHeal(state, { type: "heal", source: "maxdoc" }, ctx(5));
    expect(use).toMatchObject({ ok: true, emit: [{ type: "inventory.spend", slot: "healing" }] });
    applyHeal(state, { type: "heal", source: "rest" }, ctx(60));
    expect(state.injuries[0]).toMatchObject({ cause: "骨折", treated: false, healsAt: null });
    expect(state.painSuppressed).toBe(true);
    recoverInjuries(state, { from: 60, to: 125 });
    expect(state.painSuppressed).toBe(false);
  });
  it("新伤保留已有断肢与设备损坏，重复战斗伤处不会重复登记", () => {
    const state = health.initial();
    state.lostLimbs.push("left-arm");
    state.brokenChrome.push("kiroshi");
    const hit = { type: "health.hit", tier: "heavy", injuryId: "one", reason: "击伤" } as const;
    expect(applyHit(state, hit, ctx()).ok).toBe(true);
    expect(applyHit(state, hit, ctx()).ok).toBe(false);
    expect(state.injuries).toHaveLength(1);
    expect(state.lostLimbs).toEqual(["left-arm"]);
    expect(state.brokenChrome).toEqual(["kiroshi"]);
  });
});
