import { describe, expect, it } from "vitest";
import { fixedRng } from "../../kernel/rng";
import { SERVICES } from "../economy";
import { HeatStateSchema } from "../heat";
import { registry } from "../registry";
import { WorldClockStateSchema } from "../world";
import { CombatStateSchema } from "./schema";

const DAY = 1440;
const care = { type: "combat", action: "treat", target: "w1" };
const context = () => ({ rng: fixedRng([]), data: { locations: [] } });

function recorded(
  dueAt = 2 * DAY,
  bystander = false,
  count = 1,
): import("../../kernel/world").WorldState & {
  slices: { combat: import("./schema").CombatState };
} {
  const world = registry.initialWorld(0);
  return {
    ...world,
    slices: {
      ...world.slices,
      combat: CombatStateSchema.parse({
        active: null,
        last: null,
        nextId: count + 1,
        footage: Array.from({ length: count }, (_, i) => ({
          id: `f${i + 1}`,
          shows: "街头交火",
          source: bystander ? "路人的义眼" : "街角监控",
          holder: bystander ? "bystander" : "ncpd",
          passTo: bystander ? "ncpd" : null,
          at: 0,
          district: "沃森",
          dueAt,
          fired: null,
          firedAt: null,
          resolved: null,
          rumor: null,
        })),
      }),
    },
  };
}

function injured(eddies: number) {
  const world = registry.initialWorld(0);
  return {
    ...world,
    slices: {
      ...world.slices,
      economy: { eddies, settled: [] },
      combat: CombatStateSchema.parse({
        active: null,
        last: null,
        nextId: 2,
        wounds: [
          {
            id: "w1",
            by: "枪手",
            gang: null,
            weapon: "霰弹枪",
            part: "left-arm",
            tier: "heavy",
            at: 0,
            district: "沃森",
            healsAt: 4 * DAY,
            treated: false,
          },
        ],
      }),
    },
  };
}

describe("录像与警方热度", () => {
  it.each([null, 0])("证据入库后换区只结算一次，已用日期 %s", (districtDay) => {
    const base = recorded(180, false, 3);
    const initial = {
      ...base,
      slices: {
        ...base.slices,
        heat: { ...HeatStateSchema.parse(base.slices.heat), district: "沃森", districtDay },
        world: { ...WorldClockStateSchema.parse(base.slices.world), location: "westbrook" },
      },
    };
    const ctx = {
      ...context(),
      data: { locations: [{ id: "westbrook", name: "街角", district: "威斯特布鲁克" }] },
    };
    const world = registry.advanceTo(initial, 360, ctx).world;
    expect(world.slices.heat).toMatchObject({
      stars: districtDay === null ? 2 : 3,
      district: "威斯特布鲁克",
      districtDay: 0,
      lastSeenAt: 180,
      decayedAt: 180,
    });
    const later = registry.advanceTo(world, 361, ctx).world;
    expect(later.slices.heat).toEqual(world.slices.heat);
  });
  it.each([359, 360])("安全屋按完整跨度 %i 分钟结算，不被证据入库切断", (minutes) => {
    const ctx = { ...context(), facts: { hideout: true } };
    const world = registry.advanceTo(recorded(180, false, 3), minutes, ctx).world;
    const relieved = minutes === 360;
    expect(world.slices.heat).toMatchObject({
      stars: relieved ? 2 : 3,
      hideoutDay: relieved ? 0 : null,
      lastSeenAt: 180,
      decayedAt: 180,
    });
    const later = registry.advanceTo(world, minutes + 360, ctx).world;
    expect(later.slices.heat).toMatchObject({ stars: 2, hideoutDay: 0 });
  });
  it("乱序证据按到期时间分组，封顶后仍在两组之间衰减", () => {
    const initial = recorded(2 * DAY, false, 9);
    initial.slices.combat.footage.forEach((f, i) => {
      f.dueAt = (i < 2 ? 4 : 2) * DAY;
    });
    const jumped = registry.advanceTo(initial, 5 * DAY, context()).world;
    let stepped = registry.advanceTo(initial, 2 * DAY, context()).world;
    stepped = registry.advanceTo(stepped, 4 * DAY, context()).world;
    stepped = registry.advanceTo(stepped, 5 * DAY, context()).world;
    expect(jumped.slices.heat).toMatchObject({
      stars: 4,
      lastSeenAt: 4 * DAY,
      decayedAt: 5 * DAY,
      notices: [
        { at: 2 * DAY, before: 0, after: 5 },
        { at: 4 * DAY, before: 3, after: 5 },
      ],
    });
    expect(jumped.slices.heat).toEqual(stepped.slices.heat);
    expect(jumped.slices.combat).toEqual(stepped.slices.combat);
  });
  it.each([false, true])("跨多天与分段推进一致，路人录像 %s", (bystander) => {
    const initial = recorded(2 * DAY, bystander, 3);
    const dueAt = (bystander ? 4 : 2) * DAY;
    const end = dueAt + DAY;
    const jumped = registry.advanceTo(initial, end, context()).world;
    const due = registry.advanceTo(initial, dueAt, context()).world;
    const stepped = registry.advanceTo(due, end, context()).world;
    expect(CombatStateSchema.parse(jumped.slices.combat).footage[0]).toMatchObject({
      fired: "evidence",
      firedAt: dueAt,
      dueAt: null,
    });
    expect(jumped.slices.heat).toMatchObject({
      stars: 2,
      lastSeenAt: dueAt,
      decayedAt: end,
    });
    expect(jumped.slices.combat).toEqual(stepped.slices.combat);
    expect(jumped.slices.heat).toEqual(stepped.slices.heat);
  });
  it("路人录像先转手，再等两天入库", () => {
    const passed = registry.advanceTo(recorded(2 * DAY, true), 2 * DAY, context()).world;
    expect(passed.slices.heat).toMatchObject({ stars: 0 });
    expect(CombatStateSchema.parse(passed.slices.combat).footage[0]).toMatchObject({
      holder: "ncpd",
      passTo: null,
      dueAt: 4 * DAY,
      fired: null,
      firedAt: null,
    });
    const before = registry.advanceTo(passed, 4 * DAY - 1, context()).world;
    expect(before.slices.heat).toMatchObject({ stars: 0 });
    const due = registry.advanceTo(before, 4 * DAY, context()).world;
    expect(due.slices.heat).toMatchObject({ stars: 1, lastSeenAt: 4 * DAY });
    expect(CombatStateSchema.parse(due.slices.combat).footage[0]).toMatchObject({
      fired: "evidence",
      firedAt: 4 * DAY,
      dueAt: null,
    });
  });
  it.each([1, 3, 7])("%i 段证据累加至封顶，满一天才衰减", (count) => {
    const due = registry.advanceTo(recorded(2 * DAY, false, count), 2 * DAY, context()).world;
    const stars = Math.min(5, count);
    expect(due.slices.heat).toMatchObject({ stars, decayedAt: 2 * DAY });
    const before = registry.advanceTo(due, 3 * DAY - 1, context()).world;
    expect(before.slices.heat).toMatchObject({ stars });
    const decayed = registry.advanceTo(before, 3 * DAY, context()).world;
    expect(decayed.slices.heat).toMatchObject({ stars: stars - 1, decayedAt: 3 * DAY });
    expect(CombatStateSchema.parse(decayed.slices.combat).footage).toHaveLength(count);
  });
  it("到期才入库，同时间和后续推进不重复涨星", () => {
    const before = registry.advanceTo(recorded(), 2 * DAY - 1, context()).world;
    expect(before.slices.heat).toMatchObject({ stars: 0 });
    expect(CombatStateSchema.parse(before.slices.combat).footage[0]?.fired).toBeNull();

    const due = registry.advanceTo(before, 2 * DAY, context()).world;
    expect(due.slices.heat).toMatchObject({ stars: 1, lastSeenAt: 2 * DAY });
    expect(CombatStateSchema.parse(due.slices.combat).footage[0]).toMatchObject({
      fired: "evidence",
      firedAt: 2 * DAY,
      dueAt: null,
    });
    expect(registry.advanceTo(due, 2 * DAY, context()).world).toBe(due);
    const later = registry.advanceTo(due, 2 * DAY + 1, context()).world;
    expect(later.slices.heat).toEqual(due.slices.heat);
  });
});

describe("治疗费用连锁结算", () => {
  it.each([0, 125])("治疗扣一次医疗费，余款 %i", (remaining) => {
    const world = injured(SERVICES.medical.price + remaining);
    const first = registry.applyCommands(world, [care], context());
    expect(first.results[0]?.result.ok).toBe(true);
    expect(first.world.slices.economy).toMatchObject({ eddies: remaining });
    const combat = CombatStateSchema.parse(first.world.slices.combat);
    expect(combat.wounds[0]).toMatchObject({ treated: true, healsAt: 2 * DAY });
    expect(combat.scars).toEqual([]);

    const repeated = registry.applyCommands(first.world, [care], context());
    expect(repeated.results[0]?.result.ok).toBe(true);
    expect(repeated.world).toEqual(first.world);
    expect(repeated.patches).toEqual([]);
  });
  it.each([3 * DAY, 4 * DAY - 1])("第 %i 分钟治疗不延长恢复期限", (time) => {
    const world = registry.advanceTo(injured(SERVICES.medical.price), time, context()).world;
    const result = registry.applyCommands(world, [care], context());
    expect(result.results[0]?.result.ok).toBe(true);
    expect(result.world.slices.economy).toMatchObject({ eddies: 0 });
    expect(CombatStateSchema.parse(result.world.slices.combat).wounds[0]).toMatchObject({
      treated: true,
      healsAt: 4 * DAY,
    });
    const healed = registry.advanceTo(result.world, 4 * DAY, context()).world;
    const combat = CombatStateSchema.parse(healed.slices.combat);
    expect(combat.wounds).toEqual([]);
    expect(combat.scars).toEqual([]);
  });

  it.each([4 * DAY, 4 * DAY + 1])("第 %i 分钟伤已愈合，不能收费或消除疤痕", (time) => {
    const world = registry.advanceTo(injured(SERVICES.medical.price), time, context()).world;
    const combat = CombatStateSchema.parse(world.slices.combat);
    expect(combat.wounds).toEqual([]);
    expect(combat.scars).toHaveLength(1);
    expect(combat.scars[0]).toMatchObject({
      by: "枪手",
      weapon: "霰弹枪",
      part: "left-arm",
      district: "沃森",
    });
    const result = registry.applyCommands(world, [care], context());
    expect(result.results[0]?.result.ok).toBe(false);
    expect(result.world).toBe(world);
    expect(result.patches).toEqual([]);
    expect(result.world.slices.economy).toMatchObject({ eddies: SERVICES.medical.price });
  });

  it("余额不足时治疗和扣款一起回滚", () => {
    const world = injured(SERVICES.medical.price - 1);
    const result = registry.applyCommands(world, [care], context());
    expect(result.results[0]?.result.ok).toBe(false);
    expect(result.world).toBe(world);
    expect(result.patches).toEqual([]);
  });
});
