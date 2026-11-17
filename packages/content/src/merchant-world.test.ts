import {
  type Command,
  economyRules,
  inventoryRules,
  type LlmClient,
  type LlmRequest,
  newGameWorld,
  npcRules,
  projectState,
  registry,
  runNarratorTurn,
  TurnInputSchema,
  travelRules,
  type WorldState,
  worldRules,
} from "@cp/core";
import { describe, expect, it } from "vitest";
import { gameContent, gameData, ripperdocs, shops } from "./index";

const context = { data: gameData, rng: { roll: () => 1 } };
const inventory = (world: WorldState) =>
  inventoryRules.InventoryStateSchema.parse(world.slices.inventory);
const cash = (world: WorldState) =>
  economyRules.EconomyStateSchema.parse(world.slices.economy).eddies;
function at(location: string): WorldState {
  const world = newGameWorld({ startTime: 1000, startLocation: location }, gameContent);
  return {
    ...world,
    slices: {
      ...world.slices,
      economy: { ...economyRules.EconomyStateSchema.parse(world.slices.economy), eddies: 20000 },
    },
  };
}
function apply(world: WorldState, command: Command, evidence?: string) {
  return registry.applyCommands(world, [command], {
    ...context,
    ...(evidence ? { facts: { tradeNarrative: evidence } } : {}),
  });
}
function buy(world: WorldState, shop: string, item: string) {
  return apply(world, { type: "trade", action: "buy", with: shop, item, reason: "付款拿货" });
}
function order(world: WorldState, id: string, shop: string, item: string) {
  const evidence = "店员同意订一件，到货付款。";
  return apply(
    world,
    { type: "shopOrder", action: "place", id, shop, item, quantity: 1, evidence },
    evidence,
  );
}
function route(world: WorldState, location: string, blocked: boolean) {
  const evidence = blocked
    ? "配送入口已经被封锁，货车暂时无法通过。"
    : "封锁已经撤掉，货车可以正常通过。";
  return apply(
    world,
    { type: "logistics.route", location, blocked, reason: evidence, evidence },
    evidence,
  );
}

describe("地图商家与供货集成", () => {
  it("POI 开局持久化真实商家，剧情入口和地图入口共享库存，载入重访不刷新", () => {
    const start = at("poi:wat_lch_gunsmith_01");
    expect(inventory(start).merchants.wilson).toBeDefined();
    const stock = inventory(start).merchants.wilson?.stock.unity ?? 0;
    const purchased = buy(start, "wilson", "unity");
    expect(purchased.results.every((r) => r.result.ok)).toBe(true);
    const restored: WorldState = JSON.parse(JSON.stringify(purchased.world));
    const revisit = apply(restored, {
      type: "world",
      activity: "travel",
      location: "megabuilding-h10",
    }).world;
    const view = projectState(revisit, [], gameData);
    expect(
      view.shops.find((s) => s.id === "wilson")?.shelf.find((i) => i.id === "unity")?.left,
    ).toBe(stock - 1);
    expect(Object.keys(inventory(revisit).merchants)).toEqual(["wilson"]);
    expect(Object.values(inventory(revisit).supplyOrders)).toHaveLength(1);
  });

  it("有来源订单遇封锁暂停，JSON 载入后恢复剩余路程，到货与重访不会重复入库", () => {
    const shop = shops.find((s) => s.id === "m-wat-lch-foodshop-02");
    if (!shop?.supply) throw new Error("缺少实际食品商家");
    const start = at(shop.location);
    const initialStock = inventory(start).merchants[shop.id]?.stock.coffee;
    const placed = order(start, "coffee-request", shop.id, "coffee");
    expect(placed.results.every((r) => r.result.ok)).toBe(true);
    expect(cash(placed.world)).toBe(cash(start));
    const halfway = registry.advanceTo(placed.world, start.time + 60, context).world;
    const blocked = route(halfway, shop.supply.route[0] ?? "", true);
    expect(blocked.results.every((r) => r.result.ok)).toBe(true);
    expect(inventory(blocked.world).supplyOrders["coffee-request"]).toMatchObject({
      status: "delayed",
      remainingMinutes: 120,
    });
    const restored: WorldState = JSON.parse(JSON.stringify(blocked.world));
    const waited = registry.advanceTo(restored, start.time + 600, context).world;
    expect(inventory(waited).merchants[shop.id]?.stock.coffee).toBe(initialStock);
    const released = route(waited, shop.supply.route[0] ?? "", false).world;
    const dueAt = inventory(released).supplyOrders["coffee-request"]?.dueAt ?? 0;
    expect(dueAt).toBe(waited.time + 120);
    const delivered = registry.advanceTo(released, dueAt, context).world;
    expect(inventory(delivered).merchants[shop.id]?.stock.coffee).toBe((initialStock ?? 0) + 1);
    expect(inventory(delivered).supplyOrders["coffee-request"]).toMatchObject({
      status: "delivered",
      uncollected: 1,
    });
    const revisited = registry.signal(
      JSON.parse(JSON.stringify(delivered)),
      "world.arrived",
      context,
    ).world;
    const later = registry.advanceTo(revisited, dueAt + 600, context).world;
    expect(inventory(later).merchants[shop.id]?.stock.coffee).toBe((initialStock ?? 0) + 1);
    const taken = buy(later, shop.id, "coffee").world;
    expect(inventory(taken).supplyOrders["coffee-request"]?.uncollected).toBe(0);
    expect(inventory(taken).merchants[shop.id]?.stock.coffee).toBe(initialStock);
  });

  it("取消在途订单不送货不退款，取消已到货订单保留店内实物", () => {
    const shop = "m-wat-lch-foodshop-02";
    const start = at("poi:wat_lch_foodshop_02");
    const stock = inventory(start).merchants[shop]?.stock.coffee;
    const placed = order(start, "cancel-pending", shop, "coffee").world;
    const evidence = "店员同意取消这笔订货，不收取费用。";
    const cancel = (world: WorldState, id: string) =>
      apply(world, { type: "shopOrder", action: "cancel", id, shop, evidence }, evidence);
    const cancelled = cancel(placed, "cancel-pending");
    expect(cancelled.results.every((r) => r.result.ok)).toBe(true);
    const later = registry.advanceTo(cancelled.world, 1600, context).world;
    expect(inventory(later).merchants[shop]?.stock.coffee).toBe(stock);
    expect(cash(later)).toBe(cash(start));
    expect(cancel(later, "cancel-pending").results[0]?.result.ok).toBe(false);
    const second = order(later, "cancel-delivered", shop, "coffee").world;
    const arrived = registry.advanceTo(second, 1780, context).world;
    const abandoned = cancel(arrived, "cancel-delivered").world;
    expect(inventory(abandoned).supplyOrders["cancel-delivered"]).toMatchObject({
      status: "cancelled",
      uncollected: 0,
    });
    expect(inventory(abandoned).merchants[shop]?.stock.coffee).toBe((stock ?? 0) + 1);
    expect(cash(abandoned)).toBe(cash(start));
  });

  it("同一经营场所的地图入口封锁也会阻断剧情入口的供货", () => {
    const start = at("poi:wat_lch_gunsmith_01");
    const purchased = buy(start, "wilson", "unity").world;
    const blocked = route(purchased, "poi:wat_lch_gunsmith_01", true);
    expect(blocked.results.every((r) => r.result.ok)).toBe(true);
    expect(Object.values(inventory(blocked.world).supplyOrders)[0]?.status).toBe("delayed");
  });

  it("尚未访问的合法地图供货地点可以根据已发生证据登记封锁", () => {
    const start = at("megabuilding-h10");
    const blocked = route(start, "poi:wat_lch_foodshop_02", true);
    expect(blocked.results.every((r) => r.result.ok)).toBe(true);
    expect(
      worldRules.WorldClockStateSchema.parse(blocked.world.slices.world).places.some(
        (p) => p.id === "poi:wat_lch_foodshop_02",
      ),
    ).toBe(false);
  });

  it("已死亡且没有代班人员的店主不能继续同意取消订单", () => {
    const shop = "m-wat-lch-foodshop-02";
    const start = at("poi:wat_lch_foodshop_02");
    const inv = inventory(start);
    const merchant = inv.merchants[shop];
    if (!merchant) throw new Error("开局商家未保存");
    merchant.definition.keeperNpc = "clerk";
    const clerk = npcRules.NpcSchema.parse({
      id: "clerk",
      name: "店员",
      pronoun: "他",
      role: "食品店主",
      look: "围裙",
      voice: "简短",
      want: "经营店铺",
      limit: "赊账",
      alive: true,
      met: true,
      affinity: 0,
      location: "poi:wat_lch_foodshop_02",
      lastSeenAt: 1000,
      memories: [],
    });
    const staffed = {
      ...start,
      slices: { ...start.slices, inventory: inv, npc: { npcs: { clerk } } },
    };
    const placed = order(staffed, "dead-clerk-cancel", shop, "coffee");
    expect(placed.results.every((r) => r.result.ok)).toBe(true);
    const dead = {
      ...placed.world,
      slices: { ...placed.world.slices, npc: { npcs: { clerk: { ...clerk, alive: false } } } },
    };
    const evidence = "店员同意取消这笔订货，不收取费用。";
    const cancelled = apply(
      dead,
      { type: "shopOrder", action: "cancel", id: "dead-clerk-cancel", shop, evidence },
      evidence,
    );
    expect(cancelled.results[0]?.result.ok).toBe(false);
    expect(cancelled.world).toEqual(dead);
  });

  it("已登记 medical 能力的地图诊所可按实际经营身份提供看伤服务", () => {
    const start = at("poi:wat_nid_ripperdoc_01");
    const treated = apply(start, {
      type: "trade",
      action: "service",
      service: "medical",
      with: "r-wat-nid-ripperdoc-01",
      reason: "支付医生的看伤费用",
    });
    expect(treated.results.every((r) => r.result.ok)).toBe(true);
    expect(cash(treated.world)).toBe(cash(start) - economyRules.SERVICES.medical.price);
    const loaded: WorldState = JSON.parse(JSON.stringify(start));
    const changedData = {
      ...gameData,
      ripperdocs: ripperdocs.map((d) =>
        d.id === "r-wat-nid-ripperdoc-01"
          ? { ...d, name: "改写医生", location: "badlands", priceFactor: 2 }
          : d,
      ),
    };
    const quote = inventoryRules.quoteTrade(loaded, changedData, {
      action: "service",
      service: "medical",
      with: "r-wat-nid-ripperdoc-01",
    });
    expect(quote.ok).toBe(true);
    if (quote.ok) expect(quote.party.name).not.toBe("改写医生");
  });

  it("自由文字先到首次访问的 POI 再购物，正文报价与实际扣款一致", async () => {
    const start = at("megabuilding-h10");
    const target = "poi:wat_lch_foodshop_02";
    const merchant = "m-wat-lch-foodshop-02";
    const requests: LlmRequest[] = [];
    const llm: LlmClient = {
      async *stream(request) {
        requests.push(request);
        const stage = request.responseFormat?.name;
        const response =
          stage === "judge"
            ? {
                read: "你想到加州饭店买杯咖啡",
                ooc: false,
                ruling: null,
                buy: { item: "coffee", with: merchant, destination: target },
                recall: [],
              }
            : stage === "extract"
              ? {
                  changes: [
                    { type: "world", activity: "travel", location: target },
                    {
                      type: "trade",
                      action: "buy",
                      with: merchant,
                      item: "coffee",
                      reason: "向店员付钱买下咖啡",
                    },
                  ],
                  choices: [],
                  dropped: [],
                }
              : stage === "repair_batch"
                ? { fixes: [] }
                : "你到了加州饭店，店员把咖啡放到柜台上，收下十欧元。";
        yield {
          type: "text",
          text: typeof response === "string" ? response : JSON.stringify(response),
        };
        yield { type: "done", finishReason: "stop" };
      },
    };
    const result = await runNarratorTurn(
      { llm, ...context, offscreen: null, contextWindow: 64000 },
      start,
      [],
      { kind: "action", input: TurnInputSchema.parse({ text: "去加州饭店买一杯咖啡带走" }) },
    );
    expect(result.kind).toBe("done");
    if (result.kind !== "done") throw new Error("未完成回合");
    expect(result.turn.unsettled).toBeUndefined();
    expect(worldRules.WorldClockStateSchema.parse(result.turn.world.slices.world).location).toBe(
      target,
    );
    expect(inventory(result.turn.world).merchants[merchant]?.stock.coffee).toBe(11);
    expect(inventory(result.turn.world).backpack.coffee).toBe(1);
    const travelCost = travelRules.TravelStateSchema.parse(result.turn.world.slices.travel)
      .trips.filter((trip) => trip.at >= start.time)
      .reduce((total, trip) => total + trip.cost, 0);
    expect(cash(result.turn.world)).toBe(cash(start) - travelCost - 10);
    expect(result.turn.world.time).toBeGreaterThan(start.time);
    expect(requests.map((r) => r.responseFormat?.name ?? "narrate")).toEqual([
      "judge",
      "narrate",
      "extract",
    ]);
    const judgeContext =
      requests
        .find((request) => request.responseFormat?.name === "judge")
        ?.messages.map((message) => message.content)
        .join("\n") ?? "";
    expect(judgeContext).toContain("【相关经营入口】");
    expect(judgeContext).toContain(`${merchant} 加州饭店`);
    expect(judgeContext).toContain(target);
    expect(judgeContext).not.toContain("m-cz-heavy-hearts-dealer");
  });

  it("明确提及同名医生时列出各自地点与身份，不把相邻或同名经营者猜成同一家", () => {
    const start = at("megabuilding-h10");
    const text = worldRules.merchantEntranceText(
      worldRules.WorldClockStateSchema.parse(start.slices.world),
      gameData,
      "去找哈奇·斯宾德勒",
    );
    expect(text).toContain("r-bls-ina-se1-ripperdoc-01 ");
    expect(text).toContain("r-bls-ina-se1-ripperdoc-01b ");
    expect(text).toContain("poi:bls_ina_se1_ripperdoc_01 ");
    expect(text).toContain("poi:bls_ina_se1_ripperdoc_01b ");
    expect(text).toContain("同名且地点仍不明确时先确认");
    expect(text).not.toContain("r-cz-monument-av-ripperdoc-farida");
    expect(text).not.toContain("kiroshi-mk1");
  });
});
