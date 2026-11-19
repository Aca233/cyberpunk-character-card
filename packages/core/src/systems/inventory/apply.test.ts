import { describe, expect, it } from "vitest";
import { applyItem, spend } from "./apply";
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
    placed: [],
    healing: null,
    grenade: null,
    backpack: {},
    heldWeapons: null,
    clothing: {},
    parts: 0,
    merchants: {},
    supplyOrders: {},
    nextSupply: 1,
    nextWeaponSeq: 1,
    nextSupplyInstanceSeq: 1,
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

  it("拆封补给独立保存余量，新补给不继承旧包次数", () => {
    const inv = empty();
    applyItem(inv, gain("maxdoc"), catalog);
    spend(inv, "healing", catalog);
    const partialId = inv.healing?.id;
    expect(partialId).toBe("supply:maxdoc:1");
    if (!partialId) throw new Error("没有拆封补给");
    applyItem(
      inv,
      { type: "item", action: "unequip", id: partialId, reason: "收回半包补给" },
      catalog,
    );
    applyItem(inv, gain("maxdoc"), catalog);
    expect(inv.healing).toEqual({ id: "maxdoc", charges: 3, max: 3 });
    expect(inv.objects[partialId]?.remaining).toBe(2);
    applyItem(inv, equip(partialId), catalog);
    expect(inv.healing).toEqual({ id: partialId, charges: 2, max: 3 });
    expect(inv.backpack.maxdoc).toBe(1);
  });

  it("开局先 gain 再 equip 不算失败（旧存档重放开局）", () => {
    const inv = empty();
    applyItem(inv, gain("maxdoc"), catalog);
    expect(applyItem(inv, equip("maxdoc"), catalog).ok).toBe(true);
    expect(inv.healing).toEqual({ id: "maxdoc", charges: 3, max: 3 });
    expect(inv.backpack).toEqual({});
  });
});
