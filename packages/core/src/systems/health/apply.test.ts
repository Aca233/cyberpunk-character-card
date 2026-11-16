import { describe, expect, it } from "vitest";
import { fixedRng } from "../../kernel/rng";
import type { SystemContext } from "../../kernel/system";
import { applyDamage, applyHeal, applyHit, healthDisplay, recoverInjuries, revive } from "./apply";
import { health } from "./index";
import { registry } from "../registry";
import { InventoryStateSchema } from "../inventory";

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
  it("伤口不得超出裁决范围，愈合后登记新伤使用新身份", () => {
    const state = health.initial();
    const facts = { ruling: { id: "one", kind: "costly", harm: "graze" } };
    expect(applyDamage(state, { type: "damage", tier: "heavy", reason: "超范围" }, ctx(0, facts)).ok).toBe(false);
    expect(state.injuries).toEqual([]);
    applyDamage(state, { type: "damage", tier: "graze", reason: "擦伤" }, ctx());
    const firstId = state.injuries[0]?.id;
    recoverInjuries(state, { from: 0, to: 1440 });
    applyDamage(state, { type: "damage", tier: "graze", reason: "另一处伤" }, ctx(1440));
    expect(state.injuries[0]?.id).not.toBe(firstId);
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
  it("快捷医疗包耗尽后仅使用真实备用包，不因空快捷栏拒绝现存补给", () => {
    const context = { rng: fixedRng([]), data: { locations: [], items: [{ id: "needle", name: "医疗针", kind: "healing", charges: 1, healPercent: 30 }] } };
    let world = registry.applyCommands(registry.initialWorld(0), [
      { type: "damage", tier: "heavy", reason: "重伤" },
      { type: "item", action: "gain", id: "needle", reason: "第一支" },
      { type: "item", action: "gain", id: "needle", reason: "备用针" },
      { type: "heal", source: "maxdoc" },
    ], context).world;
    world = registry.advanceTo(world, 121, context).world;
    const next = registry.applyCommands(world, [{ type: "heal", source: "maxdoc" }], context);
    expect(next.results[0]?.result.ok).toBe(true);
    expect(InventoryStateSchema.parse(next.world.slices.inventory).backpack.needle).toBeUndefined();
    expect(InventoryStateSchema.parse(next.world.slices.inventory).healing?.charges).toBe(0);
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
