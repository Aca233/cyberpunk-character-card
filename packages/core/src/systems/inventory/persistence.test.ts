import { describe, expect, it } from "vitest";
import { fixedRng } from "../../kernel/rng";
import { NpcSchema, NpcStateSchema } from "../npc";
import { registry } from "../registry";
import { applyItem, itemCatalog, spend, withWorldObjects } from "./apply";
import { inventory } from "./index";
import { InventoryStateSchema, type ItemDef } from "./schema";

const token: ItemDef = {
  id: "obj-ana-token",
  name: "安娜刻字的铜牌",
  kind: "misc",
  iconic: false,
  ability: "向老修理工证明安娜的引荐",
  price: 100,
};
const packet: ItemDef = {
  id: "grenade",
  name: "破片手雷包",
  kind: "grenade",
  iconic: false,
  charges: 2,
};
const gain = {
  type: "item",
  action: "gain",
  id: token.id,
  reason: "安娜亲手交给我",
  definition: token,
  origin: "安娜随身佩戴，交给我作为引荐",
} as const;
const ctx = { rng: fixedRng([]), data: { items: [packet], locations: [] } };
const spareGun: ItemDef = {
  id: "spare-gun",
  name: "备用手枪",
  kind: "weapon",
  category: "pistol",
  attribute: "cool",
  iconic: false,
};
function recipient(location = "workshop", gear: string[] = []) {
  return NpcSchema.parse({
    id: "guard",
    name: "护卫",
    pronoun: "他",
    role: "护卫",
    look: "夹克",
    voice: "低沉",
    want: "看守",
    limit: "背叛",
    affinity: 0,
    alive: true,
    met: true,
    location,
    lastSeenAt: 0,
    memories: [],
    body: { gear, cyberware: [] },
  });
}

describe("赠予物品的实际交付", () => {
  const giftContext = { ...ctx, data: { ...ctx.data, items: [packet, spareGun] } };
  function setup(location = "workshop", gear: string[] = []) {
    const base = registry.initialWorld(10);
    return registry.applyCommands(
      {
        ...base,
        slices: {
          ...base.slices,
          npc: { npcs: { guard: recipient(location, gear) } },
          world: { ...(base.slices.world as object), location: "workshop" },
        },
      },
      [gain, { type: "item", action: "gain", id: spareGun.id, reason: "原有备用枪" }],
      giftContext,
    ).world;
  }
  const give = (id: string) => ({
    type: "item",
    action: "lose",
    id,
    recipient: "guard",
    reason: "亲手赠给护卫",
  });

  it("目录物品赠予时也同步人物装备，不会只扣除玩家物品", () => {
    const result = registry.applyCommands(setup(), [give(spareGun.id)], giftContext);
    expect(result.results[0]?.result.ok).toBe(true);
    expect(
      InventoryStateSchema.parse(result.world.slices.inventory).backpack[spareGun.id],
    ).toBeUndefined();
    expect(NpcStateSchema.parse(result.world.slices.npc).npcs.guard?.body?.gear).toEqual([
      spareGun.id,
    ]);
  });

  it.each([token.id, spareGun.id])("%s 不可隔空交给明确在别处的人物", (id) => {
    const world = setup("other-district");
    const result = registry.applyCommands(world, [give(id)], giftContext);
    expect(result.results[0]?.result.ok).toBe(false);
    expect(result.world).toEqual(world);
  });

  it("人物持有记录不能容纳第二件同型号时，不静默吞掉赠予物品", () => {
    const world = setup("workshop", [spareGun.id]);
    const result = registry.applyCommands(world, [give(spareGun.id)], giftContext);
    expect(result.results[0]?.result.ok).toBe(false);
    expect(result.world).toEqual(world);
  });
});

describe("持续物件", () => {
  it("独立物件赠予和归还在一次事务内同步人物财物，不能复制双重归属", () => {
    const base = registry.initialWorld(10);
    const guard = NpcSchema.parse({
      id: "guard",
      name: "护卫",
      pronoun: "他",
      role: "护卫",
      look: "夹克",
      voice: "低沉",
      want: "看守",
      limit: "背叛",
      affinity: 0,
      alive: true,
      met: true,
      location: "workshop",
      lastSeenAt: 0,
      memories: [],
      body: { gear: [], cyberware: [] },
    });
    const world = {
      ...base,
      slices: {
        ...base.slices,
        npc: { npcs: { guard } },
        world: { ...(base.slices.world as object), location: "workshop" },
      },
    };
    const given = registry.applyCommands(
      world,
      [
        gain,
        { type: "item", action: "lose", id: token.id, recipient: "guard", reason: "交给护卫保管" },
      ],
      ctx,
    );
    expect(given.results.every((r) => r.result.ok)).toBe(true);
    expect(NpcStateSchema.parse(given.world.slices.npc).npcs.guard?.body?.gear).toEqual([token.id]);
    expect(InventoryStateSchema.parse(given.world.slices.inventory).objects[token.id]?.holder).toBe(
      "guard",
    );
    const returned = registry.applyCommands(
      given.world,
      [{ type: "item", action: "gain", id: token.id, reason: "护卫交还" }],
      ctx,
    );
    expect(returned.results[0]?.result.ok).toBe(true);
    expect(NpcStateSchema.parse(returned.world.slices.npc).npcs.guard?.body?.gear).toEqual([]);
    expect(InventoryStateSchema.parse(returned.world.slices.inventory).backpack[token.id]).toBe(1);
    const duplicate = registry.applyCommands(
      returned.world,
      [{ type: "npcGear", id: "guard", action: "add", item: token.id }],
      ctx,
    );
    expect(duplicate.results[0]?.result.ok).toBe(false);
    expect(duplicate.world).toEqual(returned.world);
  });
  it("目录外物件的定义、来历、归属在保存载入后仍可查阅与使用", () => {
    const first = registry.applyCommands(registry.initialWorld(10), [gain], ctx);
    expect(first.results[0]?.result.ok).toBe(true);
    const inv = InventoryStateSchema.parse(
      JSON.parse(JSON.stringify(first.world.slices.inventory)),
    );
    const data = withWorldObjects(ctx.data, inv.objects);
    expect(withWorldObjects(ctx.data, inv.objects)).toBe(data);
    expect(itemCatalog(data).get(token.id)).toEqual(token);
    expect(inv.objects[token.id]).toMatchObject({
      origin: gain.origin,
      holder: "player",
      changedAt: 10,
    });
    expect(
      applyItem(
        inv,
        { type: "item", action: "use", id: token.id, reason: "出示引荐信物" },
        itemCatalog(data),
      ).ok,
    ).toBe(true);
    expect(inv.backpack[token.id]).toBe(1);
  });

  it("不能重复取得、重新定义或隔空拾取同一独立物件", () => {
    let world = registry.applyCommands(registry.initialWorld(10), [gain], ctx).world;
    const duplicate = registry.applyCommands(
      world,
      [{ type: "item", action: "gain", id: token.id, reason: "再拿一次" }],
      ctx,
    );
    expect(duplicate.results[0]?.result.ok).toBe(false);
    expect(duplicate.world).toEqual(world);
    const rewrite = registry.applyCommands(
      world,
      [{ ...gain, definition: { ...token, name: "不存在的改名" } }],
      ctx,
    );
    expect(rewrite.results[0]?.result.ok).toBe(false);
    world = {
      ...world,
      slices: {
        ...world.slices,
        world: { ...(world.slices.world as object), location: "workshop" },
      },
    };
    world = registry.applyCommands(
      world,
      [{ type: "item", action: "lose", id: token.id, reason: "放在工作台上" }],
      ctx,
    ).world;
    const elsewhere = {
      ...world,
      slices: { ...world.slices, world: { ...(world.slices.world as object), location: "street" } },
    };
    expect(
      registry.applyCommands(
        elsewhere,
        [{ type: "item", action: "gain", id: token.id, reason: "隔空拿回" }],
        ctx,
      ).results[0]?.result.ok,
    ).toBe(false);
    const retrieved = registry.applyCommands(
      world,
      [{ type: "item", action: "gain", id: token.id, reason: "从原来的工作台拿回" }],
      ctx,
    );
    expect(retrieved.results[0]?.result.ok).toBe(true);
    expect(InventoryStateSchema.parse(retrieved.world.slices.inventory).backpack[token.id]).toBe(1);
  });

  it("新物件缺来源或重复定义静态模板时原子拒绝", () => {
    const world = registry.initialWorld(0);
    const missingOrigin = { ...gain, origin: undefined };
    const result = registry.applyCommands(world, [missingOrigin], ctx);
    expect(result.results[0]?.result.ok).toBe(false);
    expect(result.world).toEqual(world);
    expect(
      registry.applyCommands(world, [{ ...gain, id: packet.id, definition: packet }], ctx)
        .results[0]?.result.ok,
    ).toBe(false);
  });
});

describe("补给来自实物", () => {
  it("独立补给丢下再捡起也保留剩余用量", () => {
    const inv = inventory.initial();
    const unique = { ...packet, id: "obj-found-grenade" };
    expect(
      applyItem(
        inv,
        {
          type: "item",
          action: "gain",
          id: unique.id,
          definition: unique,
          origin: "维修工送的一包",
          reason: "收下补给",
        },
        new Map(),
        0,
        "street",
      ).ok,
    ).toBe(true);
    expect(spend(inv, "grenade").ok).toBe(true);
    const catalog = itemCatalog(withWorldObjects({ items: [] }, inv.objects));
    expect(
      applyItem(
        inv,
        { type: "item", action: "lose", id: unique.id, reason: "放在地上" },
        catalog,
        1,
        "street",
      ).ok,
    ).toBe(true);
    expect(
      applyItem(
        inv,
        { type: "item", action: "gain", id: unique.id, reason: "捡回原来的一包" },
        catalog,
        2,
        "street",
      ).ok,
    ).toBe(true);
    expect(inv.grenade?.charges).toBe(1);
    expect(spend(inv, "grenade").ok).toBe(true);
    expect(inv.objects[unique.id]?.holder).toBe("consumed");
    applyItem(
      inv,
      { type: "item", action: "lose", id: unique.id, reason: "丢弃空包" },
      catalog,
      3,
      "street",
    );
    expect(
      applyItem(
        inv,
        { type: "item", action: "gain", id: unique.id, reason: "再拿一次" },
        catalog,
        4,
        "street",
      ).ok,
    ).toBe(false);
  });
  it("场景结束和休整不恢复余量，只有携带的补充包可用", () => {
    let world = registry.applyCommands(
      registry.initialWorld(0),
      [
        { type: "item", action: "gain", id: packet.id, reason: "在车里取得一包" },
        { type: "inventory.spend", slot: "grenade" },
        { type: "inventory.spend", slot: "grenade" },
      ],
      ctx,
    ).world;
    world = registry.signal(world, "scene.end", ctx).world;
    world = registry.signal(world, "rest", ctx).world;
    const inv = InventoryStateSchema.parse(world.slices.inventory);
    expect(inv.grenade?.charges).toBe(0);
    expect(spend(inv, "grenade").ok).toBe(false);
    expect(
      applyItem(
        inv,
        { type: "item", action: "gain", id: packet.id, reason: "买到另一包" },
        itemCatalog(ctx.data),
      ).ok,
    ).toBe(true);
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
