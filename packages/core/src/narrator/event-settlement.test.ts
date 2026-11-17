import { applyPatches } from "immer";
import { describe, expect, it } from "vitest";
import type { Rng } from "../kernel/ports";
import { fixedRng } from "../kernel/rng";
import type { Command } from "../kernel/system";
import type { WorldState } from "../kernel/world";
import { CombatStateSchema } from "../systems/combat";
import { EconomyStateSchema } from "../systems/economy";
import { InventoryStateSchema, ItemDefSchema } from "../systems/inventory";
import { registry } from "../systems/registry";
import { applyEventCommands, type SettlementEvent } from "./event-settlement";
import { preparePurchases } from "./merchant-settlement";

const data = {
  items: [ItemDefSchema.parse({ id: "chip", name: "数据芯片", kind: "misc", price: 250 })],
  locations: [{ id: "market", name: "市场", district: "沃森" }],
  shops: [{ id: "shop", name: "商店", keeper: "店员", location: "market", shelf: ["chip"] }],
};
const context = (rng: Rng = fixedRng([])) => ({ rng, data });
function initial(cash = 2000): WorldState {
  const world = registry.initialWorld(1000);
  return {
    ...world,
    slices: {
      ...world.slices,
      world: { ...(world.slices.world as object), location: "market" },
      economy: { eddies: cash, settled: [] },
    },
  };
}
const cash = (world: WorldState) => EconomyStateSchema.parse(world.slices.economy).eddies;
const inventory = (world: WorldState) => InventoryStateSchema.parse(world.slices.inventory);
const buy: Command = {
  type: "trade",
  action: "buy",
  with: "shop",
  item: "chip",
  reason: "接受现货报价",
};
const gain: Command = { type: "item", action: "gain", id: "chip", reason: "另一人交付的另一件" };
const fail: Command = { type: "item", action: "lose", id: "missing", reason: "并不存在的物品" };
const event = (
  id: string,
  commands: readonly Command[],
  requires: readonly string[] = [],
): SettlementEvent => ({ id, requires, commands });
const purchases = (world: WorldState) =>
  preparePurchases(world, data, { item: "chip", with: "shop" }).purchases;

describe("因果事件结算", () => {
  it("同组扣款后交付失败会撤回全部钱货、补丁和成功说明", () => {
    const world = initial();
    const result = applyEventCommands(
      world,
      [event("delivery", [{ type: "money", delta: -250, reason: "交付付款" }, gain, fail])],
      context(),
      [],
    );
    expect(result.world).toBe(world);
    expect(result.patches).toEqual([]);
    expect(result.events[0]?.status).toBe("failed");
    expect(result.results).toHaveLength(3);
    expect(result.results.every(({ result }) => !result.ok)).toBe(true);
  });

  it("一张购买授权不能在不同事件里成功使用两次", () => {
    const world = initial();
    const result = applyEventCommands(
      world,
      [event("first", [buy]), event("second", [buy])],
      context(),
      purchases(world),
    );
    expect(result.events.map((e) => e.status)).toEqual(["applied", "failed"]);
    expect(cash(result.world)).toBe(1750);
    expect(inventory(result.world).backpack.chip).toBe(1);
    expect(applyPatches(world, [...result.patches])).toEqual(result.world);
  });

  it("购买所在事件回滚后，独立事件可以使用尚未消费的授权", () => {
    const world = initial();
    const result = applyEventCommands(
      world,
      [event("failed", [buy, fail]), event("retry", [buy])],
      context(),
      purchases(world),
    );
    expect(result.events.map((e) => e.status)).toEqual(["failed", "applied"]);
    expect(cash(result.world)).toBe(1750);
    expect(inventory(result.world).backpack.chip).toBe(1);
    expect(inventory(result.world).merchants.shop?.stock.chip).toBe(2);
  });

  it("独立事件的同款物品和同额支出不被当成交易重复结算", () => {
    const world = initial();
    const result = applyEventCommands(
      world,
      [
        event("gift", [gain]),
        event("purchase", [buy]),
        event("other-expense", [{ type: "money", delta: -250, reason: "另一笔实际费用" }]),
      ],
      context(),
      purchases(world),
    );
    expect(result.events.every((e) => e.status === "applied")).toBe(true);
    expect(inventory(result.world).backpack.chip).toBe(2);
    expect(cash(result.world)).toBe(1500);
  });

  it.each(["before", "after"])("同一事件 %s 成交重复扣款会整体拒绝", (order) => {
    const world = initial();
    const money = { type: "money", delta: -250, reason: "重复扣成交价" };
    const commands = order === "before" ? [money, buy] : [buy, money];
    const result = applyEventCommands(
      world,
      [event("purchase", commands)],
      context(),
      purchases(world),
    );
    expect(result.events[0]?.status).toBe("failed");
    expect(result.world).toBe(world);
    expect(result.results.every(({ result }) => !result.ok)).toBe(true);
  });

  it("失败只阻断依赖链，独立事件与无状态变化的成功事件仍可提交", () => {
    const world = initial();
    const result = applyEventCommands(
      world,
      [
        event("access", [fail]),
        event("take", [gain], ["access"]),
        event("give", [{ type: "item", action: "lose", id: "chip", reason: "交出" }], ["take"]),
        event("conversation", []),
        event("gift", [gain], ["conversation"]),
      ],
      context(),
      [],
    );
    expect(result.events.map((e) => e.status)).toEqual([
      "failed",
      "blocked",
      "blocked",
      "applied",
      "applied",
    ]);
    expect(inventory(result.world).backpack.chip).toBe(1);
  });

  it("行动受阻只阻断显式依赖 $action 的事件", () => {
    const world = initial();
    const result = applyEventCommands(
      world,
      [event("take", [gain], ["$action"]), event("gift", [gain])],
      context(),
      [],
      "门禁未打开",
    );
    expect(result.events.map((e) => e.status)).toEqual(["blocked", "applied"]);
    expect(inventory(result.world).backpack.chip).toBe(1);
  });

  it("重复标识和向后依赖在执行前拒绝，不隐式重排事件", () => {
    const world = initial();
    const result = applyEventCommands(
      world,
      [
        event("duplicate", [gain]),
        event("duplicate", [gain]),
        event("early", [gain], ["late"]),
        event("late", []),
      ],
      context(),
      [],
    );
    expect(result.events.map((e) => e.status)).toEqual(["failed", "failed", "failed", "applied"]);
    expect(result.world).toBe(world);
  });

  it("无效事件不消费授权，系统事件可作为显式依赖锚点", () => {
    const world = initial();
    const result = applyEventCommands(
      world,
      [
        event("$setup", []),
        { ...event("invalid", [buy]), invalid: "抽取条目未通过校验" },
        event("purchase", [buy], ["$setup", "$action"]),
        event("$scene-end", [{ type: "world.endScene" }], ["purchase"]),
      ],
      context(),
      purchases(world),
    );
    expect(result.events.map((e) => e.status)).toEqual(["applied", "failed", "applied", "applied"]);
    expect(cash(result.world)).toBe(1750);
    expect(inventory(result.world).backpack.chip).toBe(1);
  });

  it("成功组只执行一次，后来失败和依赖阻断不重新抽取它的随机结果", () => {
    const world = initial();
    const calls: number[] = [];
    const rng = {
      roll(sides: number) {
        calls.push(sides);
        return 1;
      },
    };
    const start = {
      type: "combat",
      action: "start",
      foes: [{ name: "守卫", archetype: "gunner", tier: "street" }],
    };
    const result = applyEventCommands(
      world,
      [event("combat", [start]), event("failed", [fail]), event("blocked", [start], ["failed"])],
      context(rng),
      [],
    );
    expect(result.events.map((e) => e.status)).toEqual(["applied", "failed", "blocked"]);
    expect(calls).toEqual([2]);
    expect(CombatStateSchema.parse(result.world.slices.combat).active?.foes).toHaveLength(1);
  });

  it("首失败后的命令完全不执行，已试算的时间和信号也撤回", () => {
    const world = initial();
    const result = applyEventCommands(
      world,
      [
        event("failed", [
          { type: "world", activity: "rest", time: 1100 },
          { type: "world.endScene" },
          fail,
          {
            type: "combat",
            action: "start",
            foes: [{ name: "守卫", archetype: "gunner", tier: "street" }],
          },
        ]),
      ],
      context({
        roll() {
          throw new Error("失败后不应抽样");
        },
      }),
      [],
    );
    expect(result.world).toBe(world);
    expect(result.patches).toEqual([]);
    expect(result.results.every(({ result }) => !result.ok)).toBe(true);
  });
});
