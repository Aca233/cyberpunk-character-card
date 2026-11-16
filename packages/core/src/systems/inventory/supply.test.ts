import { describe, expect, it } from "vitest";
import { fixedRng } from "../../kernel/rng";
import type { Command } from "../../kernel/system";
import type { WorldState } from "../../kernel/world";
import { EconomyStateSchema } from "../economy";
import { LogisticsStateSchema } from "../logistics";
import { registry } from "../registry";
import { InventoryStateSchema } from "./schema";
import { shopsView } from "./shops";

const data = {
  items: [
    { id: "tool", name: "工具", kind: "misc", price: 100 },
    { id: "special", name: "特殊零件", kind: "misc", price: 150 },
  ],
  locations: ["corner", "bridge", "far"].map((id) => ({ id, name: id, district: "沃森" })),
  shops: [
    {
      id: "store",
      name: "街角工具店",
      keeper: "店员",
      location: "corner",
      shelf: ["tool"],
      initialStock: { tool: 2 },
      supply: {
        supplier: "depot",
        origin: "桥头仓库的现行配送合同",
        route: ["bridge", "corner"],
        leadMinutes: 60,
      },
    },
  ],
};
const context = { rng: fixedRng([]), data };
const inventory = (world: WorldState) => InventoryStateSchema.parse(world.slices.inventory);
const money = (world: WorldState) => EconomyStateSchema.parse(world.slices.economy).eddies;
const advance = (world: WorldState, time: number) => registry.advanceTo(world, time, context).world;
const stock = (world: WorldState) => inventory(world).merchants.store?.stock.tool;
function base(): WorldState {
  const world = registry.initialWorld(10);
  return registry.signal(
    {
      ...world,
      slices: {
        ...world.slices,
        world: { ...(world.slices.world as object), location: "corner" },
        economy: { eddies: 1000, settled: [] },
      },
    },
    "world.arrived",
    context,
  ).world;
}
function apply(world: WorldState, command: Command, evidence?: string) {
  return registry.applyCommands(world, [command], {
    ...context,
    ...(evidence === undefined ? {} : { facts: { tradeNarrative: evidence } }),
  });
}
function buy(world: WorldState) {
  return apply(world, {
    type: "trade",
    action: "buy",
    with: "store",
    item: "tool",
    reason: "买下工具",
  });
}
function route(world: WorldState, blocked: boolean, location = "bridge") {
  const evidence = blocked ? "运输桥口已实际封锁。" : "路障已经移走，运货恢复通行。";
  return apply(
    world,
    { type: "logistics.route", location, blocked, reason: evidence, evidence },
    evidence,
  );
}
function order(world: WorldState, id = "wanted", action = "place", item = "tool", quantity = 2) {
  const evidence = action === "place" ? "店员确认替你订两件，到货付款。" : "店员同意取消这笔订货。";
  return apply(
    world,
    { type: "shopOrder", action, id, shop: "store", item, quantity, evidence },
    evidence,
  );
}

describe("商店真实供货与订货", () => {
  it("售出只补实际缺口，时间/重访/读档不会重复生成或重复到货", () => {
    const bought = buy(base());
    expect(bought.results[0]?.result.ok).toBe(true);
    expect(stock(bought.world)).toBe(1);
    expect(inventory(bought.world).supplyOrders["supply:store:1"]).toMatchObject({
      quantity: 1,
      supplier: "depot",
      origin: data.shops[0]?.supply.origin,
      route: ["bridge", "corner"],
      createdAt: 10,
      dueAt: 70,
      status: "pending",
      requestedBy: "store",
    });
    const justBefore = advance(bought.world, 69);
    expect(stock(justBefore)).toBe(1);
    const revisited = registry.signal(
      JSON.parse(JSON.stringify(justBefore)),
      "world.arrived",
      context,
    ).world;
    expect(Object.keys(inventory(revisited).supplyOrders)).toHaveLength(1);
    const delivered = advance(revisited, 70);
    expect(stock(delivered)).toBe(2);
    expect(inventory(delivered).supplyOrders["supply:store:1"]).toMatchObject({
      status: "delivered",
      deliveredAt: 70,
    });
    expect(stock(advance(delivered, 1000))).toBe(2);
    expect(money(delivered)).toBe(900);
  });
  it("无关封路不影响订单；相关封路保存剩余路程，解封不会立刻刷货", () => {
    const bought = buy(base()).world;
    const unrelated = route(advance(bought, 20), true, "far").world;
    expect(inventory(unrelated).supplyOrders["supply:store:1"]?.status).toBe("pending");
    const blocked = route(advance(unrelated, 30), true).world;
    expect(inventory(blocked).supplyOrders["supply:store:1"]).toMatchObject({
      status: "delayed",
      remainingMinutes: 40,
    });
    expect(shopsView({ world: blocked, data, records: [] })[0]?.restockAt).toContain("运输受阻");
    const waited = advance(JSON.parse(JSON.stringify(blocked)), 1000);
    expect(stock(waited)).toBe(1);
    const reopened = route(waited, false).world;
    expect(inventory(reopened).supplyOrders["supply:store:1"]).toMatchObject({
      status: "pending",
      dueAt: 1040,
    });
    expect(stock(advance(reopened, 1039))).toBe(1);
    const delivered = advance(reopened, 1040);
    expect(stock(delivered)).toBe(2);
    expect(stock(advance(delivered, 1100))).toBe(2);
  });
  it("同一封路命令重放不重置暂停时刻，封路期间的新单保留完整运输时间", () => {
    const blocked = route(base(), true).world;
    const placed = order(blocked).world;
    expect(inventory(placed).supplyOrders.wanted).toMatchObject({
      status: "delayed",
      remainingMinutes: 60,
    });
    const repeated = route(advance(placed, 100), true).world;
    expect(LogisticsStateSchema.parse(repeated.slices.logistics).routes.bridge?.changedAt).toBe(10);
    const reopened = route(repeated, false).world;
    expect(inventory(reopened).supplyOrders.wanted?.dueAt).toBe(160);
  });
  it("订货不预扣款，重复 id 和合同外商品原子拒绝，取货才走统一交易", () => {
    const before = base();
    const placed = order(before);
    expect(placed.results[0]?.result.ok).toBe(true);
    expect(money(placed.world)).toBe(1000);
    expect(order(placed.world).world).toEqual(placed.world);
    expect(order(before, "unsupported", "place", "special").world).toEqual(before);
    const arrived = advance(placed.world, 70);
    expect(stock(arrived)).toBe(4);
    expect(inventory(arrived).supplyOrders.wanted?.uncollected).toBe(2);
    const collected = buy(arrived).world;
    expect(money(collected)).toBe(900);
    expect(stock(collected)).toBe(3);
    expect(inventory(collected).supplyOrders.wanted?.uncollected).toBe(1);
  });
  it("取消未到货订单永不到货；取消已到货订单只解除取货承诺，不销毁店内实物或退款", () => {
    const placed = order(base()).world;
    const cancelled = order(placed, "wanted", "cancel").world;
    expect(stock(advance(cancelled, 1000))).toBe(2);
    expect(money(cancelled)).toBe(1000);
    expect(order(cancelled, "wanted", "cancel").world).toEqual(cancelled);
    const arrived = advance(placed, 70);
    const waived = order(arrived, "wanted", "cancel").world;
    expect(stock(waived)).toBe(4);
    expect(money(waived)).toBe(1000);
    expect(inventory(waived).supplyOrders.wanted).toMatchObject({
      status: "cancelled",
      uncollected: 0,
    });
    expect(stock(advance(waived, 1000))).toBe(4);
  });
  it("玩家订单占用自动编号时，后续补货不会覆盖原订单", () => {
    const placed = order(base(), "supply:store:1", "place", "tool", 1).world;
    const bought = buy(buy(placed).world).world;
    expect(inventory(bought).supplyOrders["supply:store:1"]?.requestedBy).toBe("player");
    expect(inventory(bought).supplyOrders["supply:store:2"]?.requestedBy).toBe("store");
    expect(stock(advance(bought, 70))).toBe(2);
  });
  it("停业和缺少正文证据时不能承诺新订货", () => {
    const before = base();
    const noEvidence = apply(before, {
      type: "shopOrder",
      action: "place",
      id: "wanted",
      shop: "store",
      item: "tool",
      quantity: 2,
      evidence: "店员答应订货",
    });
    expect(noEvidence.world).toEqual(before);
    const evidence = "店员拉下卷帘门，今天暂停营业。";
    const closed = apply(
      before,
      { type: "shopBusiness", shop: "store", action: "close", reason: "暂停营业", evidence },
      evidence,
    ).world;
    expect(order(closed).world).toEqual(closed);
  });
});

describe("供货变化的真实事件来源", () => {
  it("未知地点、不存在的城市事件、无正文证据都不能改变物流", () => {
    const before = base();
    const command = {
      type: "logistics.route",
      location: "bridge",
      blocked: true,
      reason: "封路",
      evidence: "运输桥口已实际封锁。",
    };
    expect(apply(before, command).world).toEqual(before);
    expect(apply(before, { ...command, location: "unknown" }, command.evidence).world).toEqual(
      before,
    );
    expect(apply(before, { ...command, sourceEvent: "missing" }, command.evidence).world).toEqual(
      before,
    );
  });
  it("只接受已记录事件事实，已经结束的事件不能新建封锁", () => {
    const evidence = "运输桥口已实际封锁，街角工具店暂停营业。";
    const cityEvent = {
      type: "city.event",
      id: "road-block",
      title: "桥口封路",
      body: evidence,
      status: "heating",
      weight: "minor",
    };
    const recorded = apply(base(), cityEvent).world;
    const command = {
      type: "logistics.route",
      location: "bridge",
      blocked: true,
      reason: "封路",
      evidence,
      sourceEvent: "road-block",
    };
    const blocked = apply(recorded, command);
    expect(blocked.results[0]?.result.ok).toBe(true);
    const closed = apply(recorded, {
      type: "shopBusiness",
      shop: "store",
      action: "close",
      reason: "桥口封路",
      evidence,
      sourceEvent: "road-block",
    });
    expect(closed.results[0]?.result.ok).toBe(true);
    expect(inventory(closed.world).merchants.store?.open).toBe(false);
    const over = apply(recorded, { ...cityEvent, status: "over" }).world;
    expect(apply(over, command).world).toEqual(over);
    expect(apply(recorded, { ...command, evidence: "无关内容" }).world).toEqual(recorded);
  });
});
