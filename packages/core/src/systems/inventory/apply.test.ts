import { describe, expect, it } from "vitest";
import { applyItem } from "./apply";
import type { InventoryState, ItemDef } from "./schema";

/** 物品栏精简（用户定的方案 A）：快捷栏不让玩家手动摆，拿到治疗品时格子空着就自动放进去 */

const maxdoc: ItemDef = {
  id: "maxdoc",
  name: "复面康 1型",
  kind: "healing",
  charges: 3,
  healPercent: 30,
  iconic: false,
};
const bounce: ItemDef = {
  id: "bounceback",
  name: "回弹",
  kind: "healing",
  charges: 2,
  healPercent: 20,
  iconic: false,
};
const catalog = new Map([
  [maxdoc.id, maxdoc],
  [bounce.id, bounce],
]);

function empty(): InventoryState {
  return {
    objects: {},
    weapons: [null, null, null],
    active: null,
    healing: null,
    grenade: null,
    backpack: {},
    depleted: {},
    clothing: {},
    outfit: {},
    mods: {},
    parts: 0,
    tuned: {},
    shopStock: {},
  };
}

const gain = (id: string) => ({ type: "item", action: "gain", id, reason: "测试" }) as const;
const equip = (id: string) => ({ type: "item", action: "equip", id, reason: "测试" }) as const;

describe("拿到治疗品自动进快捷栏", () => {
  it("快捷栏空着时直接放进去，次数满", () => {
    const inv = empty();
    expect(applyItem(inv, gain("maxdoc"), catalog).ok).toBe(true);
    expect(inv.healing).toEqual({ id: "maxdoc", charges: 3, max: 3 });
    expect(inv.backpack).toEqual({});
  });

  it("快捷栏已有东西时不换，新的留在背包", () => {
    const inv = empty();
    applyItem(inv, gain("maxdoc"), catalog);
    applyItem(inv, gain("bounceback"), catalog);
    expect(inv.healing?.id).toBe("maxdoc");
    expect(inv.backpack).toEqual({ bounceback: 1 });
  });

  it("之前卸下时没恢复的次数照旧算", () => {
    const inv = empty();
    inv.depleted = { maxdoc: 1 };
    applyItem(inv, gain("maxdoc"), catalog);
    expect(inv.healing).toEqual({ id: "maxdoc", charges: 1, max: 3 });
    expect(inv.depleted).toEqual({});
  });

  it("开局先 gain 再 equip 不算失败（旧存档重放开局）", () => {
    const inv = empty();
    applyItem(inv, gain("maxdoc"), catalog);
    expect(applyItem(inv, equip("maxdoc"), catalog).ok).toBe(true);
    expect(inv.healing).toEqual({ id: "maxdoc", charges: 3, max: 3 });
    expect(inv.backpack).toEqual({});
  });
});
