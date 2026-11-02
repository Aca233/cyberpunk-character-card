import { describe, expect, it } from "vitest";
import { fixedRng } from "../../kernel/rng";
import type { SystemContext } from "../../kernel/system";
import {
  act,
  applyCombat,
  bracedTactic,
  drawIntent,
  endRound,
  overclock,
  startCombat,
} from "./apply";
import { type CombatCommand, type CombatState, CombatStateSchema } from "./schema";

/** 战斗推倒重来：藏着的打算、拦招、习惯被防、拿身体抵伤、超频和接管 */

function ctxOf(
  rolls: number[],
  opts: { humanity?: number; condition?: string } = {},
): SystemContext {
  const states: Record<string, unknown> = {
    npc: { npcs: {} },
    health: { condition: opts.condition ?? "up" },
    dice: { mode: "normal" },
    humanity: { current: opts.humanity ?? 80 },
  };
  return {
    rng: fixedRng(rolls),
    facts: {},
    data: {},
    now: 0,
    read: (id: string) => states[id],
  } as unknown as SystemContext;
}

const fresh = (): CombatState => CombatStateSchema.parse({ active: null, last: null });

const start = (archetype: "gunner" | "brute" = "gunner"): CombatCommand =>
  ({
    type: "combat",
    action: "start",
    objective: "脱身",
    defeat: "被抓走",
    foes: [{ name: "枪手", archetype, tier: "street" }],
  }) as CombatCommand;

describe("敌人的打算和你的习惯", () => {
  it("按类型的打算池抽，骰子定了结果就定了", () => {
    expect(drawIntent({ archetype: "gunner" }, fixedRng([1]))).toBe("shoot");
    expect(drawIntent({ archetype: "gunner" }, fixedRng([3]))).toBe("aim");
    expect(drawIntent({ archetype: "brute" }, fixedRng([4]))).toBe("execute");
  });

  it("同一种打法用到门槛才被防，取用得最多的那种", () => {
    expect(bracedTactic({ guns: 2 })).toBeNull();
    expect(bracedTactic({ guns: 3, blades: 2 })).toBe("guns");
    expect(bracedTactic({ guns: 3, blades: 4 })).toBe("blades");
  });

  it("开打时新敌人防着你用惯的打法", () => {
    const c = fresh();
    c.habits.guns = 3;
    expect(startCombat(c, start(), ctxOf([1])).ok).toBe(true);
    expect(c.active?.foes[0]?.braced).toBe("guns");
    expect(c.active?.foes[0]?.intent).toBe("shoot");
  });
});

const hit = (tactic: string): CombatCommand =>
  ({ type: "combat", action: "act", tactic, target: "foe1" }) as CombatCommand;

describe("拦招", () => {
  it("打法对上他的打算就拦下，同时记一笔习惯", () => {
    const c = fresh();
    startCombat(c, start(), ctxOf([1]));
    act(c, hit("stealth"), ctxOf([]));
    expect(c.active?.foes[0]?.fooled).toBe(true);
    expect(c.habits.stealth).toBe(1);
  });

  it("对不上打算的打法拦不住", () => {
    const c = fresh();
    startCombat(c, start(), ctxOf([1]));
    act(c, hit("guns"), ctxOf([]));
    expect(c.active?.foes[0]?.fooled).toBe(false);
  });

  it("他防着这一手时拦不住，超频了才破得开", () => {
    const c = fresh();
    c.habits.guns = 3;
    startCombat(c, start(), ctxOf([3]));
    act(c, hit("guns"), ctxOf([]));
    expect(c.active?.foes[0]?.fooled).toBe(false);
    overclock(c);
    act(c, hit("guns"), ctxOf([]));
    expect(c.active?.foes[0]?.fooled).toBe(true);
  });
});

describe("一轮打完", () => {
  it("没拦下的那一下记成待抵的伤，进下一轮重抽打算", () => {
    const c = fresh();
    startCombat(c, start(), ctxOf([1]));
    endRound(c, ctxOf([3]));
    expect(c.active?.pending).toEqual([
      { from: "foe1", name: "枪手", intent: "shoot", tier: "graze" },
    ]);
    expect(c.active?.round).toBe(2);
    expect(c.active?.foes[0]?.intent).toBe("aim");
  });

  it("想跑又没被拦下就跑了，没人站着算赢", () => {
    const c = fresh();
    startCombat(c, start(), ctxOf([5]));
    endRound(c, ctxOf([]));
    expect(c.active).toBeNull();
    expect(c.last?.outcome).toBe("victory");
    // 只记有人物卡的敌人（给宿敌用），杂兵跑了不留记录
    expect(c.last?.foes).toEqual([]);
  });

  it("打满轮数还没分出胜负按败局，倒下了也是败局", () => {
    const a = fresh();
    startCombat(a, start(), ctxOf([1]));
    if (a.active) a.active.round = 6;
    endRound(a, ctxOf([]));
    expect(a.last?.outcome).toBe("defeat");
    const b = fresh();
    startCombat(b, start(), ctxOf([1]));
    endRound(b, ctxOf([], { condition: "down" }));
    expect(b.last?.outcome).toBe("defeat");
  });

  it("人性低于门槛按差值掷接管，连着两轮不接管", () => {
    const c = fresh();
    startCombat(c, start(), ctxOf([1]));
    endRound(c, ctxOf([1, 20], { humanity: 30 }));
    expect(c.active?.takeoverRound).toBe(2);
    endRound(c, ctxOf([1], { humanity: 30 }));
    expect(c.active?.takeoverRound).toBe(2);
    const d = fresh();
    startCombat(d, start(), ctxOf([1]));
    endRound(d, ctxOf([1, 21], { humanity: 30 }));
    expect(d.active?.takeoverRound).toBeNull();
  });
});

describe("超频", () => {
  it("一轮只扣一次人性，每多超频一次贵一截", () => {
    const c = fresh();
    startCombat(c, start(), ctxOf([1]));
    expect(overclock(c)).toMatchObject({ emit: [{ type: "humanity", delta: -4 }] });
    expect(overclock(c)).toEqual({ ok: true, notes: [] });
    endRound(c, ctxOf([1]));
    expect(c.active?.overclocked).toBe(false);
    expect(overclock(c)).toMatchObject({ emit: [{ type: "humanity", delta: -6 }] });
  });

  it("不在战斗中不能超频", () => {
    expect(overclock(fresh()).ok).toBe(false);
  });
});

describe("玩家用文字说拿什么抵", () => {
  const payCmd = (more: object) => ({ type: "combat", action: "pay", ...more }) as CombatCommand;

  it("模型发的 pay 和按钮走同一条路：抵掉最早那一下，交给 health 记", () => {
    const c = fresh();
    startCombat(c, start(), ctxOf([1]));
    endRound(c, ctxOf([3]));
    const out = applyCombat(c, payCmd({ pay: "limb", limb: "left-arm" }), ctxOf([]));
    expect(out).toMatchObject({
      ok: true,
      emit: [{ type: "health.hit", tier: "graze", pay: "limb", limb: "left-arm" }],
    });
    expect(c.active?.pending).toEqual([]);
  });

  it("没有待抵的伤、或没写拿什么抵，都不算", () => {
    const c = fresh();
    startCombat(c, start(), ctxOf([1]));
    expect(applyCombat(c, payCmd({ pay: "flesh" }), ctxOf([])).ok).toBe(false);
    expect(applyCombat(c, payCmd({}), ctxOf([])).ok).toBe(false);
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
  const withItems = (rolls: number[]) => ({ ...ctxOf(rolls), data: { items } }) as SystemContext;
  const cmd = (more: object) => ({ type: "combat", ...more }) as CombatCommand;
  const begin = () => {
    const c = fresh();
    // 打算 1；武器池只剩档位够得着、不是不朽的那一把，不用掷；掷 2 再带一件治疗品
    startCombat(c, start(), withItems([1, 2]));
    return c;
  };

  it("开打时按路数和档位抽身上带的，不朽的不掉", () => {
    expect(begin().active?.foes[0]?.carry).toEqual(["unity", "maxdoc"]);
  });
  it("站着的捡不到；倒下了捡一件进物品栏，捡过的没了", () => {
    const c = begin();
    const take = cmd({ action: "loot", target: "foe1", item: "unity" });
    expect(applyCombat(c, take, ctxOf([])).ok).toBe(false);
    applyCombat(c, cmd({ action: "foe", target: "foe1", state: "down" }), ctxOf([]));
    expect(applyCombat(c, take, ctxOf([]))).toMatchObject({
      ok: true,
      emit: [{ type: "item", action: "gain", id: "unity" }],
    });
    expect(applyCombat(c, take, ctxOf([])).ok).toBe(false);
  });

  it("跑了的带走了；打完剩下的还能搜", () => {
    const take = (item: string) => cmd({ action: "loot", target: "foe1", item });
    const a = begin();
    applyCombat(a, cmd({ action: "foe", target: "foe1", state: "fled" }), ctxOf([]));
    expect(applyCombat(a, take("unity"), ctxOf([])).ok).toBe(false);
    const b = begin();
    applyCombat(b, cmd({ action: "foe", target: "foe1", state: "down" }), ctxOf([]));
    endRound(b, ctxOf([]));
    expect(b.last?.loot).toEqual([{ from: "foe1", name: "枪手", items: ["unity", "maxdoc"] }]);
    expect(applyCombat(b, take("maxdoc"), ctxOf([])).ok).toBe(true);
    expect(b.last?.loot[0]?.items).toEqual(["unity"]);
  });
});
