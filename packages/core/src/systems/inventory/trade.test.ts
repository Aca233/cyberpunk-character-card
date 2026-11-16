import { describe, expect, it } from "vitest";
import { applyPlayerAction } from "../../actions";
import { fixedRng } from "../../kernel/rng";
import type { Command } from "../../kernel/system";
import type { WorldState } from "../../kernel/world";
import { CommerceStateSchema } from "../commerce";
import { EconomyStateSchema } from "../economy";
import { NpcSchema, NpcStateSchema } from "../npc";
import { registry } from "../registry";
import { RESTOCK_MINUTES } from "./apply";
import { InventoryStateSchema, type ItemDef } from "./schema";
import { shopsView } from "./shops";
import { quoteTrade } from "./trade";

const gun: ItemDef = {
  id: "gun",
  name: "测试手枪",
  kind: "weapon",
  category: "pistol",
  attribute: "cool",
  iconic: false,
  price: 250,
  rarity: "rare",
};
const token: ItemDef = { id: "token", name: "刻字铜牌", kind: "misc", iconic: true, price: 100 };
const data = {
  items: [gun, token],
  locations: [],
  shops: [
    {
      id: "shop-a",
      name: "甲店",
      keeper: "甲老板",
      keeperNpc: "keeper-a",
      location: "market",
      priceFactor: 0.7,
      shelf: [gun.id],
    },
    {
      id: "shop-b",
      name: "乙店",
      keeper: "乙老板",
      location: "market",
      priceFactor: 1.3,
      shelf: [gun.id],
    },
    { id: "far-shop", name: "远处店", keeper: "远处老板", location: "far", shelf: [gun.id] },
  ],
  factions: [
    { id: "gang", name: "本地帮派", kind: "gang", turf: ["district"], initial: "neutral" },
  ],
};
function person(id: string, gear: string[] = [], name = id) {
  return NpcSchema.parse({
    id,
    name,
    pronoun: "他",
    role: "熟人",
    look: "旧夹克",
    voice: "低沉",
    want: "谋生",
    limit: "欠账",
    affinity: 0,
    alive: true,
    met: true,
    location: "market",
    lastSeenAt: 0,
    memories: [],
    body: { gear, cyberware: [] },
  });
}
function base(eddies = 2000): WorldState {
  const world = registry.initialWorld(10);
  return {
    ...world,
    slices: {
      ...world.slices,
      world: { ...(world.slices.world as object), location: "market" },
      economy: { eddies, settled: [] },
    },
  };
}
function alter(world: WorldState, slices: Record<string, unknown>): WorldState {
  return { ...world, slices: { ...world.slices, ...slices } };
}
const inventory = (world: WorldState) => InventoryStateSchema.parse(world.slices.inventory);
const money = (world: WorldState) => EconomyStateSchema.parse(world.slices.economy).eddies;
function trade(
  world: WorldState,
  withId = "shop-a",
  action: "buy" | "sell" = "buy",
  item = gun.id,
  offer?: string,
) {
  return registry.applyCommands(
    world,
    [
      {
        type: "trade",
        action,
        item,
        with: withId,
        reason: "双方确认交付",
        ...(offer ? { offer } : {}),
      },
    ],
    { rng: fixedRng([]), data },
  );
}
function button(
  world: WorldState,
  type: "buyItem" | "sellItem" = "buyItem",
  shop = "shop-a",
  id = gun.id,
) {
  return applyPlayerAction(world, { type, shop, id }, { rng: fixedRng([]), data });
}
function offer(
  world: WorldState,
  price: number,
  id = "agreed",
  seller = "shop-a",
  target = gun.id,
  kind = "item",
  action = "buy",
  party?: object,
) {
  const evidence = `卖家明确说：这件卖你 ${price} 欧元。`;
  const result = registry.applyCommands(
    world,
    [
      {
        type: "commerce.offer",
        id,
        seller,
        kind,
        action,
        target,
        tradeIn: false,
        price,
        evidence,
        ...(party ? { party } : {}),
      },
    ],
    { rng: fixedRng([]), data, facts: { tradeNarrative: evidence } },
  );
  expect(result.results[0]?.result.ok).toBe(true);
  return result.world;
}

describe("普通交易共用实际报价和货源", () => {
  it("同条件按钮与自由输入取得相同物件、价格和库存", () => {
    const world = base();
    const byButton = button(world);
    const byText = trade(world);
    expect(byButton.ok).toBe(true);
    if (!byButton.ok) throw new Error(byButton.reason);
    expect(byText.results[0]?.result.ok).toBe(true);
    expect(money(byText.world)).toBe(1820);
    expect(inventory(byText.world)).toEqual(inventory(byButton.world));
    expect(money(byButton.world)).toBe(money(byText.world));
    expect(shopsView({ world, data, records: [] })[0]?.shelf[0]?.price).toBe(180);
    expect(byButton.commands).toHaveLength(1);
    expect(byButton.commands[0]?.type).toBe("trade");
  });
  it("同地两家商店按明确对象交易，不取第一家", () => {
    const result = trade(base(), "shop-b");
    expect(result.results[0]?.result.ok).toBe(true);
    expect(money(result.world)).toBe(1670);
    expect(inventory(result.world).shopStock["shop-b"]?.sold.gun).toBe(1);
    expect(inventory(result.world).shopStock["shop-a"]).toBeUndefined();
  });
  it.each(["far-shop", "不存在的卖家"])("拒绝无法交付的卖方 %s，钱货不变化", (seller) => {
    const world = base();
    const result = trade(world, seller);
    expect(result.results[0]?.result.ok).toBe(false);
    expect(result.world).toEqual(world);
  });
  it("目录中的物品不代表店铺有货", () => {
    const world = base();
    const result = trade(world, "shop-a", "buy", token.id);
    expect(result.results[0]?.result.ok).toBe(false);
    expect(result.world).toEqual(world);
  });
  it("余额恰够可买，余额不足时扣款、库存与交付都不生效", () => {
    expect(money(trade(base(180)).world)).toBe(0);
    const poor = base(179);
    expect(trade(poor).world).toEqual(poor);
    expect(button(poor).ok).toBe(false);
  });
  it("同轮连续买最后一件只成功一次，三日边界才补货", () => {
    const world = base();
    const command: Command = {
      type: "trade",
      action: "buy",
      item: gun.id,
      with: "shop-a",
      reason: "购买",
    };
    const result = registry.applyCommands(world, [command, command], { rng: fixedRng([]), data });
    expect(result.results.map((r) => r.result.ok)).toEqual([true, false]);
    expect(
      trade({ ...result.world, time: world.time + RESTOCK_MINUTES - 1 }).results[0]?.result.ok,
    ).toBe(false);
    expect(
      trade({ ...result.world, time: world.time + RESTOCK_MINUTES }).results[0]?.result.ok,
    ).toBe(true);
  });
  it("店主明确所属势力才影响报价和拒售，不由帮派城区推断", () => {
    const keeper = { ...person("keeper-a"), faction: "gang" };
    const world = alter(base(), {
      npc: { npcs: { "keeper-a": keeper } },
      factions: { stances: { gang: { attitude: "hostile" } }, turf: [] },
    });
    const quoted = quoteTrade(world, data, { action: "buy", item: gun.id, with: "shop-a" });
    expect(quoted.ok && quoted.price).toBe(230);
    const blocked = alter(world, {
      factions: { stances: { gang: { attitude: "kos" } }, turf: [] },
    });
    expect(button(blocked).ok).toBe(false);
    expect(trade(blocked).world).toEqual(blocked);
    const neutralKeeper = alter(world, { npc: { npcs: {} } });
    expect(money(trade(neutralKeeper).world)).toBe(1820);
  });
  it("店内向另一人物买实际装备，不扣店库存，不能重复买其唯一一把", () => {
    const world = alter(base(), { npc: { npcs: { friend: person("friend", [gun.id]) } } });
    const result = trade(world, "friend");
    expect(result.results[0]?.result.ok).toBe(true);
    expect(inventory(result.world).backpack.gun).toBe(1);
    expect(inventory(result.world).shopStock).toEqual({});
    expect(NpcStateSchema.parse(result.world.slices.npc).npcs.friend?.body?.gear).toEqual([]);
    expect(trade(result.world, "friend").world).toEqual(result.world);
  });
  it("同名交易对象必须消歧，人物不能代售同地另一个人的独立物件", () => {
    const world = alter(base(), {
      npc: { npcs: { a: person("a", [token.id], "老李"), b: person("b", [], "老李") } },
      inventory: {
        ...inventory(base()),
        objects: {
          token: {
            definition: token,
            origin: "甲的祖传物件",
            holder: "a",
            location: "market",
            changedAt: 0,
            lastChange: "随身携带",
            remaining: null,
          },
        },
      },
    });
    expect(trade(world, "老李", "buy", token.id).world).toEqual(world);
    expect(trade(world, "b", "buy", token.id).world).toEqual(world);
    const real = trade(world, "a", "buy", token.id);
    expect(real.results[0]?.result.ok).toBe(true);
    expect(inventory(real.world).objects.token?.holder).toBe("player");
  });
  it("最后一把带配件的武器不能由任一入口卖出，两把时只卖一把", () => {
    const world = alter(base(), {
      inventory: { ...inventory(base()), backpack: { gun: 1 }, mods: { gun: { scope: "scope" } } },
    });
    expect(button(world, "sellItem").ok).toBe(false);
    expect(trade(world, "shop-a", "sell").world).toEqual(world);
    const two = alter(world, { inventory: { ...inventory(world), backpack: { gun: 2 } } });
    const sold = trade(two, "shop-a", "sell");
    expect(sold.results[0]?.result.ok).toBe(true);
    expect(inventory(sold.world).mods.gun).toEqual({ scope: "scope" });
    expect(inventory(sold.world).backpack.gun).toBe(1);
  });
  it("出售所得实物留在商家，可重新购买，读档后仍保持归属", () => {
    const world = alter(base(), {
      inventory: {
        ...inventory(base()),
        backpack: { token: 1 },
        objects: {
          token: {
            definition: token,
            origin: "玩家所有",
            holder: "player",
            location: null,
            changedAt: 0,
            lastChange: "携带",
            remaining: null,
          },
        },
      },
    });
    const sold = trade(world, "shop-a", "sell", token.id);
    expect(sold.results[0]?.result.ok).toBe(true);
    const loaded = JSON.parse(JSON.stringify(sold.world)) as WorldState;
    expect(inventory(loaded).objects.token?.holder).toBe("shop-a");
    expect(
      shopsView({ world: loaded, data, records: [] })[0]?.shelf.some((s) => s.id === token.id),
    ).toBe(true);
    const bought = trade(loaded, "shop-a", "buy", token.id);
    expect(bought.results[0]?.result.ok).toBe(true);
    expect(inventory(bought.world).objects.token?.holder).toBe("player");
    expect(inventory(bought.world).shopReturns["shop-a"]?.token).toBeUndefined();
    expect(trade(bought.world, "shop-a", "buy", token.id).world).toEqual(bought.world);
  });
  it("报价不交付，保存后的谈妥价格由文字与按钮共用且只消费一次", () => {
    const offered = offer(base(), 123);
    expect(inventory(offered).backpack).toEqual({});
    expect(money(offered)).toBe(2000);
    const loaded = JSON.parse(JSON.stringify(offered)) as WorldState;
    const byText = trade(loaded, "shop-a", "buy", gun.id, "agreed");
    const byButton = button(loaded);
    expect(byText.results[0]?.result.ok).toBe(true);
    expect(byButton.ok).toBe(true);
    if (!byButton.ok) throw new Error(byButton.reason);
    expect(money(byText.world)).toBe(1877);
    expect(money(byButton.world)).toBe(1877);
    expect(CommerceStateSchema.parse(byText.world.slices.commerce).quotes.agreed?.status).toBe(
      "used",
    );
    expect(trade(byText.world, "shop-a", "buy", gun.id, "agreed").world).toEqual(byText.world);
  });
  it("交付失败不消耗报价或资金，真实赠与才允许零元报价", () => {
    const offered = offer(base(10), 100);
    expect(trade(offered).world).toEqual(offered);
    expect(CommerceStateSchema.parse(offered.slices.commerce).quotes.agreed?.status).toBe(
      "offered",
    );
    const gifted = offer(base(0), 0);
    const received = trade(gifted);
    expect(received.results[0]?.result.ok).toBe(true);
    expect(money(received.world)).toBe(0);
    expect(inventory(received.world).backpack.gun).toBe(1);
  });
  it("无人物卡服务者可凭现场报价登记并收款，但不能凭登记生成目录货物", () => {
    const registered = offer(
      base(),
      15,
      "meal-quote",
      "noodle-seller",
      "meal",
      "service",
      "service",
      { name: "面摊老板", location: "market" },
    );
    const meal = registry.applyCommands(
      registered,
      [
        {
          type: "trade",
          action: "service",
          service: "meal",
          with: "noodle-seller",
          offer: "meal-quote",
          reason: "吃面后付款",
        },
      ],
      { rng: fixedRng([]), data },
    );
    expect(meal.results[0]?.result.ok).toBe(true);
    expect(money(meal.world)).toBe(1985);
    expect(trade(meal.world, "noodle-seller").world).toEqual(meal.world);
  });
  it("人物装备接收失败时撤销交付、收款和报价消耗", () => {
    const buyer = person(
      "buyer",
      Array.from({ length: 6 }, (_, i) => `gear-${i}`),
    );
    const world = alter(base(), {
      npc: { npcs: { buyer } },
      inventory: { ...inventory(base()), backpack: { gun: 1 } },
    });
    const offered = offer(world, 75, "sale", "buyer", gun.id, "item", "sell");
    expect(quoteTrade(offered, data, { action: "sell", item: gun.id, with: "buyer" }).ok).toBe(
      false,
    );
    const result = trade(offered, "buyer", "sell", gun.id, "sale");
    expect(result.results[0]?.result.ok).toBe(false);
    expect(result.world).toEqual(offered);
  });
  it("报价超过现金协议额度时在展示与执行阶段一致拒绝", () => {
    const offered = offer(base(200000), 150000);
    expect(quoteTrade(offered, data, { action: "buy", item: gun.id, with: "shop-a" }).ok).toBe(
      false,
    );
    expect(trade(offered).world).toEqual(offered);
  });
  it("商店列出的独立物件仍要核对实际持有人的装备记录", () => {
    const world = alter(base(), {
      npc: { npcs: { "keeper-a": person("keeper-a") } },
      inventory: {
        ...inventory(base()),
        objects: {
          gun: {
            definition: gun,
            origin: "老板的旧手枪",
            holder: "keeper-a",
            location: "market",
            changedAt: 0,
            lastChange: "曾随身携带",
            remaining: null,
          },
        },
      },
    });
    expect(quoteTrade(world, data, { action: "buy", item: gun.id, with: "shop-a" }).ok).toBe(false);
    expect(trade(world).world).toEqual(world);
  });
  it("已给正文的价格不同于当前实扣时不悄悄成交", () => {
    const world = base();
    const result = registry.applyCommands(
      world,
      [{ type: "trade", action: "buy", item: gun.id, with: "shop-a", reason: "购买" }],
      {
        rng: fixedRng([]),
        data,
        facts: {
          tradeQuote: { seller: "shop-a", kind: "item", action: "buy", target: gun.id, price: 250 },
        },
      },
    );
    expect(result.results[0]?.result.ok).toBe(false);
    expect(result.world).toEqual(world);
  });
});
