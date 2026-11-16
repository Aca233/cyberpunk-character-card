import { describe, expect, it } from "vitest";
import { fixedRng } from "../kernel/rng";
import type { Command } from "../kernel/system";
import type { WorldState } from "../kernel/world";
import { CyberwareStateSchema } from "../systems/cyberware";
import { EconomyStateSchema } from "../systems/economy";
import { InventoryStateSchema } from "../systems/inventory";
import { LogisticsStateSchema } from "../systems/logistics";
import { registry } from "../systems/registry";
import { buildOffscreenPrompt, readOffscreen } from "./offscreen";
import { offscreenMerchantContext } from "./offscreen-merchants";

const data = {
  items: [
    { id: "tool", name: "工具", kind: "misc", price: 100 },
    { id: "unrelated-stock", name: "无关货架物品", kind: "misc", price: 200 },
  ],
  cyberware: [],
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
        origin: "桥头仓库配送合同",
        route: ["bridge", "corner"],
        leadMinutes: 60,
      },
    },
    {
      id: "unvisited",
      name: "从未到过的商店",
      keeper: "远方店员",
      location: "far",
      shelf: ["unrelated-stock"],
    },
  ],
  ripperdocs: [{ id: "doc", name: "本地医生", location: "corner", shelf: ["model"] }],
};
const context = { data, rng: fixedRng([]) };
const inv = (world: WorldState) => InventoryStateSchema.parse(world.slices.inventory);
const cyber = (world: WorldState) => CyberwareStateSchema.parse(world.slices.cyberware);
function base(): WorldState {
  const world = registry.initialWorld(1000);
  return registry.signal(
    {
      ...world,
      slices: {
        ...world.slices,
        world: { ...(world.slices.world as object), location: "corner" },
        economy: { eddies: 1000, settled: [] },
        cyberware: {
          ...cyber(world),
          clinics: {
            doc: {
              stock: { model: 1 },
              initializedAt: 1000,
              revision: 0,
              open: true,
              reason: "正常营业",
              staff: [],
              equipment: ["surgery"],
            },
          },
        },
      },
    },
    "world.arrived",
    context,
  ).world;
}
function apply(world: WorldState, commands: Command[]) {
  const result = registry.applyCommands(world, commands, context);
  expect(result.results.every((row) => row.result.ok)).toBe(true);
  return result.world;
}
const evidence = "桥口实际封路，街角工具店和诊所都暂时停业。";
const event = {
  id: "bridge-block",
  title: "桥口封路",
  body: evidence,
  status: "heating",
  weight: "minor",
};
const block = {
  type: "logistics.route",
  location: "bridge",
  blocked: true,
  reason: "桥口封路",
  evidence,
  sourceEvent: event.id,
};
const close = {
  type: "shopBusiness",
  shop: "store",
  action: "close",
  reason: "桥口封路",
  evidence,
  sourceEvent: event.id,
};
const clinic = {
  type: "cyberware.clinic",
  doc: "doc",
  open: false,
  reason: "桥口封路",
  evidence,
  sourceEvent: event.id,
};
function read(world: WorldState, more: Record<string, unknown> = {}) {
  return readOffscreen(JSON.stringify({ events: [], npcs: [], messages: [], ...more }), world, {
    data,
  });
}

describe("场外推演的经营事实", () => {
  it("经营变化可以省略，只有已经记录或本批真实事件才能驱动，先记事件再改经营", () => {
    const world = base();
    expect(read(world).ok).toBe(true);
    const batch = read(world, { events: [event], merchantChanges: [block, close, clinic] });
    expect(batch.ok).toBe(true);
    expect(batch.commands.map((command) => command.type)).toEqual([
      "city.event",
      "logistics.route",
      "shopBusiness",
      "cyberware.clinic",
    ]);
    const changed = apply(world, batch.commands);
    expect(LogisticsStateSchema.parse(changed.slices.logistics).routes.bridge?.blocked).toBe(true);
    expect(inv(changed).merchants.store?.open).toBe(false);
    expect(cyber(changed).clinics.doc?.open).toBe(false);
    expect(EconomyStateSchema.parse(changed.slices.economy).eddies).toBe(1000);
    expect(cyber(changed).installed).toEqual([]);
    const recorded = apply(world, [{ type: "city.event", ...event }]);
    expect(read(recorded, { merchantChanges: [close] }).ok).toBe(true);
  });
  it.each([
    { merchantChanges: [close] },
    { events: [event], merchantChanges: [{ ...close, sourceEvent: "fake" }] },
    { events: [event], merchantChanges: [{ ...close, evidence: "店主没有说过的话" }] },
    { events: [event], merchantChanges: [{ ...close, sourceEvent: undefined }] },
    { events: [event], merchantChanges: [{ ...close, money: -100 }] },
    { events: [event], merchantChanges: [{ ...close, shop: "unvisited" }] },
    { events: [event], merchantChanges: [{ ...block, location: "far" }] },
    { events: [{ ...event, status: "over" }], merchantChanges: [block] },
    { events: [event], merchantChanges: [close, close] },
    { merchantChanges: {} },
  ])("不存在的事实、范围和扩展字段整批拒绝：%o", (reply) => {
    expect(read(base(), reply).ok).toBe(false);
  });
  it.each([
    "trade",
    "money",
    "shopOrder",
    "cyberware",
    "cyberware.service",
    "cyberware.part",
    "cyberware.supply",
    "cyberware.install",
    "constructor",
  ])("不能夹带 %s 替玩家交易或手术", (type) => {
    const got = read(base(), {
      events: [event],
      merchantChanges: [{ type, evidence, sourceEvent: event.id }],
    });
    expect(got.ok).toBe(false);
    expect(got.commands.some((command) => command.type === type)).toBe(false);
  });
  it("新事件优先于同 id 的旧事件，不可引用被本批改写掉的旧事实", () => {
    const before = apply(base(), [{ type: "city.event", ...event }]);
    expect(
      read(before, {
        events: [{ ...event, body: "路障已经移走，运输恢复通行。", status: "over" }],
        merchantChanges: [block],
      }).ok,
    ).toBe(false);
  });
  it("真实停业阻止成交，封路暂停已存在订单，恢复后走完剩余路程才到货", () => {
    const bought = apply(base(), [
      { type: "trade", action: "buy", with: "store", item: "tool", reason: "实际购买" },
    ]);
    const beforeBlock = registry.advanceTo(bought, 1020, context).world;
    const parsed = read(beforeBlock, { events: [event], merchantChanges: [close, block] });
    expect(parsed.ok).toBe(true);
    const blocked = apply(beforeBlock, parsed.commands);
    const attempted = registry.applyCommands(
      blocked,
      [{ type: "trade", action: "buy", with: "store", item: "tool", reason: "尝试购买" }],
      context,
    );
    expect(attempted.results[0]?.result.ok).toBe(false);
    expect(attempted.world).toEqual(blocked);
    const later = registry.advanceTo(blocked, 2000, context).world;
    expect(inv(later).merchants.store?.stock.tool).toBe(1);
    expect(inv(later).supplyOrders["supply:store:1"]).toMatchObject({
      status: "delayed",
      remainingMinutes: 40,
    });
    const clearEvidence = "路障已撤，工具店重新开门，配送恢复通行。";
    const clearEvent = { ...event, body: clearEvidence, status: "over" };
    const cleared = read(later, {
      events: [clearEvent],
      merchantChanges: [
        { ...block, blocked: false, reason: "恢复通行", evidence: clearEvidence },
        { ...close, action: "open", reason: "恢复营业", evidence: clearEvidence },
      ],
    });
    expect(cleared.ok).toBe(true);
    const reopened = apply(later, cleared.commands);
    expect(inv(reopened).merchants.store?.stock.tool).toBe(1);
    expect(inv(reopened).supplyOrders["supply:store:1"]?.dueAt).toBe(2040);
    expect(inv(registry.advanceTo(reopened, 2040, context).world).merchants.store?.stock.tool).toBe(
      2,
    );
  });
});

describe("场外商家材料按已激活状态组装", () => {
  it("保留未完订单、服务与有关路线，不发送全城商家货架或无关封锁", () => {
    const bought = apply(base(), [
      { type: "trade", action: "buy", with: "store", item: "tool", reason: "实际购买" },
    ]);
    const state: WorldState = {
      ...bought,
      slices: {
        ...bought.slices,
        logistics: {
          routes: {
            bridge: {
              blocked: true,
              reason: "运输桥已封锁",
              changedAt: 1000,
              source: "road-event",
            },
            far: {
              blocked: true,
              reason: "不相关的远方路障",
              changedAt: 1000,
              source: "far-event",
            },
          },
        },
        cyberware: {
          ...cyber(bought),
          services: {
            procedure: {
              id: "procedure",
              terms: { action: "install", doc: "doc", id: "service-model" },
              provider: "doc",
              providerName: "本地医生",
              scheduledAt: 1100,
              startedAt: null,
              endsAt: 1160,
              remaining: 60,
              status: "booked",
              price: 100,
              cash: 100,
              credit: 0,
              receive: 0,
              part: null,
              oldPart: null,
              reason: "已确认的后续预约",
            },
          },
          supplies: {
            delivery: {
              id: "delivery",
              doc: "doc",
              source: "诊所已确认供货商",
              stock: { "shipment-model": 1 },
              route: ["bridge", "corner"],
              due: 1200,
              remaining: 200,
              checkedAt: 1000,
              status: "pending",
              reason: "配送中",
            },
          },
        },
      },
    };
    const section = offscreenMerchantContext(state, data).join("\n");
    for (const required of [
      "街角工具店",
      "本地医生",
      "supply:store:1",
      "procedure",
      "service-model",
      "shipment-model",
      "运输桥已封锁",
      "bridge｜bridge｜沃森",
    ])
      expect(section).toContain(required);
    for (const omitted of ["从未到过的商店", "unrelated-stock", "不相关的远方路障"])
      expect(section).not.toContain(omitted);
    const prompt = buildOffscreenPrompt(state, [], { data }, "这一轮已经结束。");
    expect(prompt[1]?.content).toContain("【已激活商家】");
    expect(prompt[0]?.content).toContain("不得替玩家买卖、付款、订货、预约、开工或完成手术");
  });
});
