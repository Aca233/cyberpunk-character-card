import { describe, expect, it } from "vitest";
import { fixedRng } from "../../kernel/rng";
import { registry } from "../registry";
import { applyItem, itemCatalog, spend, withWorldObjects } from "./apply";
import { inventory } from "./index";
import { InventoryStateSchema, type ItemDef } from "./schema";

const token: ItemDef = {
  id: "obj-ana-token", name: "安娜刻字的铜牌", kind: "misc", iconic: false,
  ability: "向老修理工证明安娜的引荐", price: 100,
};
const packet: ItemDef = {
  id: "grenade", name: "破片手雷包", kind: "grenade", iconic: false, charges: 2,
};
const gain = { type: "item", action: "gain", id: token.id, reason: "安娜亲手交给我", definition: token, origin: "安娜随身佩戴，交给我作为引荐" } as const;
const ctx = { rng: fixedRng([]), data: { items: [packet], locations: [] } };

describe("持续物件", () => {
  it("目录外物件的定义、来历、归属在保存载入后仍可查阅与使用", () => {
    const first = registry.applyCommands(registry.initialWorld(10), [gain], ctx);
    expect(first.results[0]?.result.ok).toBe(true);
    const inv = InventoryStateSchema.parse(JSON.parse(JSON.stringify(first.world.slices.inventory)));
    const data = withWorldObjects(ctx.data, inv.objects);
    expect(withWorldObjects(ctx.data, inv.objects)).toBe(data);
    expect(itemCatalog(data).get(token.id)).toEqual(token);
    expect(inv.objects[token.id]).toMatchObject({ origin: gain.origin, holder: "player", changedAt: 10 });
    expect(applyItem(inv, { type: "item", action: "use", id: token.id, reason: "出示引荐信物" }, itemCatalog(data)).ok).toBe(true);
    expect(inv.backpack[token.id]).toBe(1);
  });

  it("不能重复取得、重新定义或隔空拾取同一独立物件", () => {
    let world = registry.applyCommands(registry.initialWorld(10), [gain], ctx).world;
    const duplicate = registry.applyCommands(world, [{ type: "item", action: "gain", id: token.id, reason: "再拿一次" }], ctx);
    expect(duplicate.results[0]?.result.ok).toBe(false);
    expect(duplicate.world).toEqual(world);
    const rewrite = registry.applyCommands(world, [{ ...gain, definition: { ...token, name: "不存在的改名" } }], ctx);
    expect(rewrite.results[0]?.result.ok).toBe(false);
    world = { ...world, slices: { ...world.slices, world: { ...(world.slices.world as object), location: "workshop" } } };
    world = registry.applyCommands(world, [{ type: "item", action: "lose", id: token.id, reason: "放在工作台上" }], ctx).world;
    const elsewhere = { ...world, slices: { ...world.slices, world: { ...(world.slices.world as object), location: "street" } } };
    expect(registry.applyCommands(elsewhere, [{ type: "item", action: "gain", id: token.id, reason: "隔空拿回" }], ctx).results[0]?.result.ok).toBe(false);
    const retrieved = registry.applyCommands(world, [{ type: "item", action: "gain", id: token.id, reason: "从原来的工作台拿回" }], ctx);
    expect(retrieved.results[0]?.result.ok).toBe(true);
    expect(InventoryStateSchema.parse(retrieved.world.slices.inventory).backpack[token.id]).toBe(1);
  });

  it("新物件缺来源或重复定义静态模板时原子拒绝", () => {
    const world = registry.initialWorld(0);
    const missingOrigin = { ...gain, origin: undefined };
    const result = registry.applyCommands(world, [missingOrigin], ctx);
    expect(result.results[0]?.result.ok).toBe(false);
    expect(result.world).toEqual(world);
    expect(registry.applyCommands(world, [{ ...gain, id: packet.id, definition: packet }], ctx).results[0]?.result.ok).toBe(false);
  });
});

describe("补给来自实物", () => {
  it("场景结束和休整不恢复余量，只有携带的补充包可用", () => {
    let world = registry.applyCommands(registry.initialWorld(0), [
      { type: "item", action: "gain", id: packet.id, reason: "在车里取得一包" },
      { type: "inventory.spend", slot: "grenade" },
      { type: "inventory.spend", slot: "grenade" },
    ], ctx).world;
    world = registry.signal(world, "scene.end", ctx).world;
    world = registry.signal(world, "rest", ctx).world;
    const inv = InventoryStateSchema.parse(world.slices.inventory);
    expect(inv.grenade?.charges).toBe(0);
    expect(spend(inv, "grenade").ok).toBe(false);
    expect(applyItem(inv, { type: "item", action: "gain", id: packet.id, reason: "买到另一包" }, itemCatalog(ctx.data)).ok).toBe(true);
    expect(spend(inv, "grenade").ok).toBe(true);
    expect(inv.grenade?.charges).toBe(1);
    expect(inv.backpack[packet.id]).toBeUndefined();
    expect(registry.parseInternal({ type: "inventory.recharge" }).ok).toBe(false);
  });

  it("初始定义不会共享不同存档的物件记录", () => {
    const first = inventory.initial();
    const second = inventory.initial();
    applyItem(first, gain, new Map(), 0, null);
    expect(second.objects).toEqual({});
  });
});
