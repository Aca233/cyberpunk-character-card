import { describe, expect, it } from "vitest";
import { fixedRng } from "../../kernel/rng";
import type { SystemContext } from "../../kernel/system";
import { applyCombat, tickCombat } from "./apply";
import { type CombatCommand, type CombatState, CombatStateSchema } from "./schema";

/** 战斗只记后果：死者、伤口、流言、录像和战利品 */
function ctxOf(rolls: number[] = [], now = 0, data: Record<string, unknown> = {}): SystemContext {
  const states: Record<string, unknown> = {
    world: { location: "kabuki" },
    npc: { npcs: {} },
    health: { condition: "up" },
    economy: { eddies: 10000 },
  };
  return {
    rng: fixedRng(rolls),
    facts: {},
    data,
    now,
    read: (id: string) => states[id],
  } as unknown as SystemContext;
}

const fresh = (): CombatState => CombatStateSchema.parse({ active: null, last: null });
const cmd = (
  action: CombatCommand["action"],
  fields: Partial<Omit<CombatCommand, "type" | "action">> = {},
): CombatCommand => ({ type: "combat", action, ...fields });

const DAY = 1440;
const locations = [
  { id: "kabuki", name: "歌舞伎", district: "沃森" },
  { id: "japantown", name: "日本街", district: "威斯特布鲁克" },
  { id: "glen", name: "谷地区", district: "海伍德" },
  { id: "arroyo", name: "河谷区", district: "圣多明戈" },
  { id: "coastview", name: "海景区", district: "太平洲" },
];
const start = cmd("start", {
  foes: [{ name: "枪手", gang: "虎爪帮", archetype: "gunner", tier: "street" }],
});
const end = cmd("end", { witnesses: 0, cameras: false, truth: "玩家遭到伏击后脱身" });

function begin(data: Record<string, unknown> = { locations }, rolls: number[] = []): CombatState {
  const state = fresh();
  expect(applyCombat(state, start, ctxOf(rolls, 0, data)).ok).toBe(true);
  return state;
}

function advance(state: CombatState, from: number, to: number, rolls: number[] = []): void {
  tickCombat(state, { from, to }, ctxOf(rolls, to, { locations }));
}

describe("开打和收场只记事实", () => {
  it("登记在场的人和地区，不生成轮次或打算；没人看见时不生成流言录像", () => {
    const state = begin();
    expect(state.active).toMatchObject({
      startedAt: 0,
      district: "沃森",
      foes: [{ id: "foe1", gang: "虎爪帮", state: "up" }],
    });
    expect(state.active).not.toHaveProperty("round");
    expect(state.active?.foes[0]).not.toHaveProperty("intent");
    expect(applyCombat(state, start, ctxOf()).ok).toBe(false);
    expect(applyCombat(state, end, ctxOf([], 10))).toMatchObject({
      ok: true,
      signals: ["combat.end"],
    });
    expect(state.active).toBeNull();
    expect(state.last?.endedAt).toBe(10);
    expect(state.rumors).toEqual([]);
    expect(state.footage).toEqual([]);
    expect(applyCombat(state, end, ctxOf()).ok).toBe(false);
  });
});

describe("死者有名有姓", () => {
  it("超过二十名死者仍保留亲属和待结算的复仇", () => {
    const state = fresh();
    for (let i = 0; i < 21; i += 1) {
      expect(applyCombat(state, start, ctxOf([], 0, { locations })).ok).toBe(true);
      expect(
        applyCombat(
          state,
          cmd("foe", {
            target: state.active?.foes[0]?.id,
            state: "dead",
          }),
          ctxOf([1, 1, 1, 2]),
        ).ok,
      ).toBe(true);
      expect(applyCombat(state, end, ctxOf()).ok).toBe(true);
    }
    expect(state.dead).toHaveLength(21);
    expect(state.dead[0]).toMatchObject({
      id: "d1",
      mournerName: "丽塔·冈萨雷斯",
      district: "沃森",
      reckonAt: 3 * DAY,
      avenger: null,
    });
    advance(state, 0, 3 * DAY, Array(21).fill(1));
    expect(state.dead.every((d) => d.avenger === "pending")).toBe(true);
    expect(state.dead.every((d) => d.reckonAt === null)).toBe(true);
    advance(state, 3 * DAY, 20 * DAY);
    expect(state.dead).toHaveLength(21);
    expect(state.dead[0]?.id).toBe("d1");
  });
  it("记下死者和亲属，同一次死亡不重复记账；到期只掷一次", () => {
    const state = begin();
    const killed = cmd("foe", { target: "foe1", state: "dead" });
    expect(applyCombat(state, killed, ctxOf([1, 1, 1, 2])).ok).toBe(true);
    expect(state.dead[0]).toMatchObject({
      name: "马科·冈萨雷斯",
      gang: "虎爪帮",
      mourner: "sibling",
      mournerName: "丽塔·冈萨雷斯",
      reckonAt: 3 * DAY,
      avenger: null,
    });
    expect(applyCombat(state, killed, ctxOf()).ok).toBe(true);
    expect(state.dead).toHaveLength(1);
    advance(state, 0, 3 * DAY - 1);
    expect(state.dead[0]?.avenger).toBeNull();
    advance(state, 3 * DAY - 1, 3 * DAY, [25]);
    expect(state.dead[0]?.avenger).toBe("pending");
    expect(state.dead[0]?.reckonAt).toBeNull();
    advance(state, 3 * DAY, 4 * DAY);
    expect(state.dead[0]?.avenger).toBe("pending");
  });
});

describe("伤口带着来历", () => {
  const hit = cmd("wound", { by: "foe1", weapon: "霰弹枪", part: "left-arm", tier: "heavy" });
  it("记录具体伤处；未经处理的深层创伤不会因时间或切场消失", () => {
    const state = begin();
    expect(applyCombat(state, hit, ctxOf())).toMatchObject({
      ok: true,
      emit: [
        {
          type: "health.hit",
          tier: "heavy",
          part: "left-arm",
          injuryId: "w1",
          reason: "虎爪帮的枪手的霰弹枪",
        },
      ],
    });
    expect(state.wounds[0]).toMatchObject({
      by: "枪手",
      gang: "虎爪帮",
      part: "left-arm",
      district: "沃森",
      healsAt: null,
      treated: false,
    });
    advance(state, 0, 20 * DAY);
    expect(state.wounds).toHaveLength(1);
    expect(state.scars).toEqual([]);
  });
  it("处理后开始恢复，重复处理不重设时间", () => {
    const state = begin();
    applyCombat(state, hit, ctxOf());
    const care = cmd("treat", { target: state.wounds[0]?.id });
    expect(applyCombat(state, care, ctxOf())).toMatchObject({
      ok: true,
      emit: [{ type: "health.treat", id: "w1" }, { type: "money" }],
    });
    expect(state.wounds[0]).toMatchObject({ treated: true, healsAt: 4 * DAY });
    expect(applyCombat(state, care, ctxOf([], DAY)).ok).toBe(true);
    expect(state.wounds[0]?.healsAt).toBe(4 * DAY);
    advance(state, 0, 4 * DAY);
    expect(state.wounds).toEqual([]);
    expect(state.scars).toEqual([]);
  });
  it("长时间未处理不会丢失早期创口记录", () => {
    const state = begin();
    for (let i = 0; i < 21; i++) applyCombat(state, { ...hit, weapon: `霰弹枪${i}` }, ctxOf());
    advance(state, 0, 20 * DAY);
    expect(state.wounds).toHaveLength(21);
    expect(state.wounds[0]).toMatchObject({ weapon: "霰弹枪0", healsAt: null });
  });
  it("擦伤自然愈合", () => {
    const state = begin();
    applyCombat(state, { ...hit, tier: "graze" }, ctxOf());
    advance(state, 0, DAY);
    expect(state.wounds).toEqual([]);
    expect(state.scars).toEqual([]);
  });
});

describe("流言会走样", () => {
  it("超过二十条流言和录像仍保留关联并结算最早一条", () => {
    const state = fresh();
    for (let i = 0; i < 21; i += 1) {
      expect(applyCombat(state, start, ctxOf([], 0, { locations })).ok).toBe(true);
      expect(
        applyCombat(
          state,
          {
            ...end,
            cameras: true,
            truth: `第${i}场交战`,
          },
          ctxOf([2]),
        ).ok,
      ).toBe(true);
    }
    expect(state.rumors).toHaveLength(21);
    expect(state.footage).toHaveLength(21);
    expect(state.rumors[0]).toMatchObject({ id: "r1", truth: "第0场交战" });
    expect(state.footage[0]).toMatchObject({ rumor: "r1", dueAt: 2 * DAY });
    advance(state, 0, 2 * DAY, Array(84).fill(1));
    expect(state.rumors.every((r) => r.confirmed && r.hops.length === 3)).toBe(true);
    expect(state.footage.every((f) => f.fired === "sold" && f.dueAt === null)).toBe(true);
    expect(state.rumors).toHaveLength(21);
    expect(state.footage).toHaveLength(21);
  });
  it("从当地起，每天传到新地区；流言走样不改写真相", () => {
    const state = begin();
    expect(applyCombat(state, { ...end, witnesses: 2, cameras: true }, ctxOf([1])).ok).toBe(true);
    expect(state.rumors[0]).toMatchObject({
      truth: "玩家遭到伏击后脱身",
      dead: 0,
      hops: [{ district: "沃森", at: 0, count: 0, drifts: [] }],
      nextAt: DAY,
    });
    advance(state, 0, DAY - 1);
    expect(state.rumors[0]?.hops).toHaveLength(1);
    advance(state, DAY - 1, DAY, [3, 1]);
    expect(state.rumors[0]?.hops[1]).toEqual({
      district: "威斯特布鲁克",
      at: DAY,
      count: 0,
      drifts: ["face"],
    });
    expect(state.rumors[0]?.truth).toBe("玩家遭到伏击后脱身");
    expect(state.rumors[0]?.nextAt).toBe(2 * DAY);
  });

  it("跨过多天逐站传播，地区不重复，传遍后停止", () => {
    const state = begin();
    applyCombat(state, { ...end, witnesses: 1 }, ctxOf([1]));
    advance(state, 0, 5 * DAY, [1, 1, 1, 1, 1, 1, 1]);
    const rumor = state.rumors[0];
    expect(rumor?.hops.map((h) => h.at)).toEqual([0, DAY, 2 * DAY, 3 * DAY, 4 * DAY]);
    expect(rumor?.hops.map((h) => h.count)).toEqual([0, 1, 2, 4, 8]);
    expect(new Set(rumor?.hops.map((h) => h.district)).size).toBe(5);
    expect(rumor?.dead).toBe(0);
    expect(rumor?.stopped).toBe("faded");
    expect(rumor?.nextAt).toBeNull();
    advance(state, 5 * DAY, 6 * DAY);
    expect(rumor?.hops).toHaveLength(5);
  });
});

describe("录像在别人手里", () => {
  it.each([
    [1, "evidence"],
    [2, "sold"],
    [3, "demand"],
  ] as const)("持有人骰面 %i 到期产生 %s，之后不重复触发", (roll, fired) => {
    const state = begin();
    applyCombat(state, { ...end, cameras: true }, ctxOf([roll]));
    advance(state, 0, 2 * DAY - 1, [1, 1]);
    expect(state.footage[0]?.fired).toBeNull();
    advance(state, 2 * DAY - 1, 2 * DAY, [1, 1]);
    expect(state.footage[0]).toMatchObject({
      fired,
      firedAt: 2 * DAY,
      dueAt: null,
    });
    expect(state.rumors[0]?.confirmed).toBe(fired === "sold");
    advance(state, 2 * DAY, 2 * DAY + 1);
    expect(state.footage[0]?.firedAt).toBe(2 * DAY);
  });
});

describe("路人的录像会转手", () => {
  it("两天后转给买家，再过两天才出事", () => {
    const state = begin();
    applyCombat(state, { ...end, witnesses: 1 }, ctxOf([2]));
    expect(state.footage[0]).toMatchObject({
      holder: "bystander",
      passTo: "dealer",
      dueAt: 2 * DAY,
    });
    advance(state, 0, 2 * DAY, [1, 1, 1, 1]);
    expect(state.footage[0]).toMatchObject({
      holder: "dealer",
      passTo: null,
      dueAt: 4 * DAY,
      fired: null,
    });
    advance(state, 2 * DAY, 4 * DAY - 1, [1, 1]);
    expect(state.footage[0]?.fired).toBeNull();
    advance(state, 4 * DAY - 1, 4 * DAY, [1]);
    expect(state.footage[0]).toMatchObject({
      fired: "sold",
      firedAt: 4 * DAY,
      dueAt: null,
    });
    expect(state.rumors[0]?.confirmed).toBe(true);
  });
});

describe("了结流言", () => {
  it.each(["silenced", "bought"] as const)("%s 停止传播，重复操作不重复扣钱", (how) => {
    const state = begin();
    applyCombat(state, { ...end, cameras: true }, ctxOf([3]));
    const settle = cmd("rumor", { target: state.rumors[0]?.id, how });
    const result = applyCombat(state, settle, ctxOf());
    expect(result.ok).toBe(true);
    if (how === "bought") {
      expect(result).toMatchObject({ emit: [{ type: "money", delta: -500 }] });
    } else {
      expect(result).not.toHaveProperty("emit");
    }
    expect(state.rumors[0]).toMatchObject({ stopped: how, nextAt: null });
    expect(applyCombat(state, settle, ctxOf())).toEqual({ ok: true, notes: [] });
    advance(state, 0, DAY);
    expect(state.rumors[0]?.hops).toHaveLength(1);
  });
});

describe("了结录像", () => {
  it.each(["recovered", "destroyed", "paid"] as const)("%s 阻止到期事件且只结算一次", (how) => {
    const state = begin();
    applyCombat(state, { ...end, cameras: true }, ctxOf([3]));
    const settle = cmd("footage", { target: state.footage[0]?.id, how });
    const result = applyCombat(state, settle, ctxOf());
    expect(result.ok).toBe(true);
    if (how === "paid") {
      expect(result).toMatchObject({ emit: [{ type: "money", delta: -2000 }] });
    } else {
      expect(result).not.toHaveProperty("emit");
    }
    expect(state.footage[0]).toMatchObject({ resolved: how, dueAt: null });
    expect(applyCombat(state, settle, ctxOf())).toEqual({ ok: true, notes: [] });
    advance(state, 0, 2 * DAY, [1, 1, 1, 1]);
    expect(state.footage[0]?.fired).toBeNull();
  });
});

describe("流出的录像无法追回", () => {
  it.each([1, 2])("持有人骰面 %i 的录像流出后拒绝结算", (roll) => {
    const state = begin();
    applyCombat(state, { ...end, cameras: true }, ctxOf([roll]));
    advance(state, 0, 2 * DAY, [1, 1, 1, 1]);
    for (const how of ["recovered", "destroyed", "paid"] as const) {
      expect(
        applyCombat(
          state,
          cmd("footage", {
            target: state.footage[0]?.id,
            how,
          }),
          ctxOf(),
        ).ok,
      ).toBe(false);
    }
    expect(state.footage[0]?.resolved).toBeNull();
    if (roll === 2) {
      for (const how of ["silenced", "bought"] as const) {
        expect(
          applyCombat(
            state,
            cmd("rumor", {
              target: state.rumors[0]?.id,
              how,
            }),
            ctxOf(),
          ).ok,
        ).toBe(false);
      }
      expect(state.rumors[0]?.stopped).toBeNull();
    }
  });
});

describe("找上门的人可以了结", () => {
  it("到期前不能登场，来了再了结，重复操作不重开", () => {
    const state = begin();
    applyCombat(state, cmd("foe", { target: "foe1", state: "dead" }), ctxOf([1, 1, 1, 2]));
    const target = state.dead[0]?.id;
    const came = cmd("avenger", { target, how: "came" });
    expect(applyCombat(state, came, ctxOf()).ok).toBe(false);
    advance(state, 0, 3 * DAY, [1]);
    expect(applyCombat(state, came, ctxOf()).ok).toBe(true);
    expect(state.dead[0]?.avenger).toBe("came");
    expect(applyCombat(state, cmd("avenger", { target, how: "settled" }), ctxOf()).ok).toBe(true);
    expect(applyCombat(state, came, ctxOf())).toEqual({ ok: true, notes: [] });
    expect(state.dead[0]?.avenger).toBe("settled");
  });
});

describe("敲诈发生后仍能付钱", () => {
  it("付款了结索款，保留已经发生的记录，不重复扣钱", () => {
    const state = begin();
    applyCombat(state, { ...end, cameras: true }, ctxOf([3]));
    advance(state, 0, 2 * DAY, [1, 1, 1, 1]);
    expect(state.footage[0]?.fired).toBe("demand");
    const pay = cmd("footage", { target: state.footage[0]?.id, how: "paid" });
    expect(applyCombat(state, pay, ctxOf())).toMatchObject({
      ok: true,
      emit: [{ type: "money", delta: -2000 }],
    });
    expect(state.footage[0]).toMatchObject({
      fired: "demand",
      resolved: "paid",
      dueAt: null,
    });
    expect(applyCombat(state, pay, ctxOf())).toEqual({ ok: true, notes: [] });
  });
});

describe("从倒下的人身上捡东西", () => {
  const gun = { kind: "weapon", category: "pistol", attribute: "cool", weaponType: "power" };
  const items = [
    { id: "unity", name: "统一", rarity: "common", ...gun },
    { id: "kenshin", name: "健信", rarity: "rare", ...gun },
    { id: "plain", name: "破枪", iconic: true, rarity: "common", ...gun },
    {
      id: "maxdoc",
      name: "MaxDoc",
      kind: "healing",
      charges: 2,
      healPercent: 40,
      rarity: "common",
    },
  ];
  const armed = () => begin({ locations, items }, [2]);
  const take = (item: string) => cmd("loot", { target: "foe1", item });

  it("按档位抽携带物，不掉不朽物品", () => {
    expect(armed().active?.foes[0]?.carry).toEqual(["unity", "maxdoc"]);
  });

  it("站着不能捡，倒下后每件只能拾取一次", () => {
    const state = armed();
    expect(applyCombat(state, take("unity"), ctxOf()).ok).toBe(false);
    applyCombat(state, cmd("foe", { target: "foe1", state: "down" }), ctxOf());
    expect(applyCombat(state, take("unity"), ctxOf())).toMatchObject({
      ok: true,
      emit: [{ type: "item", action: "gain", id: "unity" }],
    });
    expect(applyCombat(state, take("unity"), ctxOf()).ok).toBe(false);
    expect(state.active?.foes[0]?.carry).toEqual(["maxdoc"]);
  });

  it("跑掉的人带走物品，收场后也不能搜", () => {
    const state = armed();
    applyCombat(state, cmd("foe", { target: "foe1", state: "fled" }), ctxOf());
    expect(applyCombat(state, take("unity"), ctxOf()).ok).toBe(false);
    applyCombat(state, end, ctxOf());
    expect(state.groundLoot).toEqual([]);
    expect(applyCombat(state, take("unity"), ctxOf()).ok).toBe(false);
  });

  it("收场保留未拾取物品，拾取后不会再次获得", () => {
    const state = armed();
    applyCombat(state, cmd("foe", { target: "foe1", state: "down" }), ctxOf());
    expect(applyCombat(state, end, ctxOf()).ok).toBe(true);
    expect(state.groundLoot).toMatchObject([
      { from: "foe1", name: "枪手", location: "kabuki", items: ["unity", "maxdoc"] },
    ]);
    expect(applyCombat(state, take("maxdoc"), ctxOf())).toMatchObject({
      ok: true,
      emit: [{ type: "item", action: "gain", id: "maxdoc" }],
    });
    expect(state.groundLoot[0]?.items).toEqual(["unity"]);
    expect(applyCombat(state, take("maxdoc"), ctxOf()).ok).toBe(false);
    expect(applyCombat(state, start, ctxOf()).ok).toBe(true);
    expect(state.active?.foes[0]?.id).toBe("foe2");
    expect(state.groundLoot[0]?.items).toEqual(["unity"]);
    expect(applyCombat(state, take("unity"), ctxOf()).ok).toBe(true);
  });
});
