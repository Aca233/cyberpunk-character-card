import { expect, it } from "vitest";
import { fixedRng } from "../../kernel/rng";
import type { WorldState } from "../../kernel/world";
import { registry } from "../registry";
import { InventoryStateSchema } from "./schema";
import { shopsView } from "./shops";

const data = {
  items: [{ id: "tool", name: "工具", kind: "misc", price: 100 }],
  shops: [
    {
      id: "store",
      name: "街角工具店",
      keeper: "店员",
      location: "corner",
      shelf: ["tool"],
      initialStock: { tool: 2 },
    },
  ],
  locations: [],
};
const context = { rng: fixedRng([]), data };
function world(): WorldState {
  const base = registry.initialWorld(10);
  return {
    ...base,
    slices: {
      ...base.slices,
      world: { ...(base.slices.world as object), location: "corner" },
      economy: { eddies: 1000, settled: [] },
    },
  };
}
it("第一次到店固定身份和库存，浏览只读，重访/载入/内容表变化不重置", () => {
  const before = world();
  shopsView({ world: before, data, records: [] });
  expect(InventoryStateSchema.parse(before.slices.inventory).merchants).toEqual({});
  const visited = registry.signal(before, "world.arrived", context).world;
  const purchased = registry.applyCommands(
    visited,
    [{ type: "trade", action: "buy", with: "store", item: "tool", reason: "买下工具" }],
    context,
  ).world;
  const reloaded = JSON.parse(JSON.stringify(purchased));
  const changed = {
    ...data,
    shops: [
      {
        ...data.shops[0],
        name: "内容表里的另一个名字",
        initialStock: { tool: 99 },
        priceFactor: 2,
      },
    ],
  };
  const again = registry.signal(reloaded, "world.arrived", { ...context, data: changed }).world;
  const merchant = InventoryStateSchema.parse(again.slices.inventory).merchants.store;
  expect(merchant?.definition.name).toBe("街角工具店");
  expect(merchant?.stock.tool).toBe(1);
  expect(shopsView({ world: again, data: changed, records: [] })[0]?.shelf[0]?.price).toBe(100);
});
it("明确停业持续保存，没证据不能改，恢复营业也不会重置库存", () => {
  const before = registry.signal(world(), "world.arrived", context).world;
  const command = {
    type: "shopBusiness",
    shop: "store",
    action: "close",
    reason: "维修卷帘门",
    evidence: "店员挂上停业维修的牌子。",
  };
  expect(registry.applyCommands(before, [command], context).world).toEqual(before);
  const closed = registry.applyCommands(before, [command], {
    ...context,
    facts: { tradeNarrative: command.evidence },
  }).world;
  expect(shopsView({ world: closed, data, records: [] })[0]?.shelf[0]?.locked).toBe("维修卷帘门");
  const open = {
    ...command,
    action: "open",
    reason: "卷帘门修好了",
    evidence: "店员重新挂上营业牌。",
  };
  const reopened = registry.applyCommands(closed, [open], {
    ...context,
    facts: { tradeNarrative: open.evidence },
  }).world;
  expect(shopsView({ world: reopened, data, records: [] })[0]?.shelf[0]?.locked).toBeNull();
  expect(InventoryStateSchema.parse(reopened.slices.inventory).merchants.store?.stock.tool).toBe(2);
});
