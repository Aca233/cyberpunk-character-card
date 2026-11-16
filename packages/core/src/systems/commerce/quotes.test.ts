import { describe, expect, it } from "vitest";
import { z } from "zod";
import { fixedRng } from "../../kernel/rng";
import { createRegistry, defineSystem } from "../../kernel/system";
import { parseLog, replay, serializeRecord } from "../../kernel/turnlog";
import type { WorldState } from "../../kernel/world";
import { EconomyStateSchema, economy } from "../economy";
import { npc } from "../npc";
import { world as clock } from "../world";
import { commerce } from "./index";
import { agreedQuote, priceMentioned, type QuoteSelector, registeredParty } from "./quotes";
import { CommerceStateSchema, OfferCommandSchema } from "./schema";

const NOW = 1000;
const terms = {
  seller: "lin-shop",
  kind: "item",
  action: "buy",
  target: "pistol",
  tradeIn: false,
} as const;
const evidence = "阿林说：这把手枪给你 800 欧元，就这个价。";
const data = {
  shops: [
    {
      id: terms.seller,
      name: "阿林的枪店",
      keeper: "阿林",
      location: "market",
      shelf: [terms.target],
    },
  ],
};

// 故意让报价消费发生在扣款之前/之后，覆盖任一连锁失败时的事务边界。
const CheckoutSchema = z.object({
  type: z.literal("test.checkout"),
  offer: z.string(),
  price: z.number(),
  moneyFirst: z.boolean().default(false),
});
const checkout = defineSystem<{ deliveries: number }, z.infer<typeof CheckoutSchema>>({
  id: "checkout",
  dependsOn: ["economy", "commerce"],
  state: z.object({ deliveries: z.number() }),
  initial: () => ({ deliveries: 0 }),
  commands: { "test.checkout": CheckoutSchema },
  apply(draft, command) {
    draft.deliveries += 1;
    const used = { type: "commerce.used", id: command.offer };
    const money = { type: "money", delta: -command.price, reason: "履行报价" };
    return { ok: true, emit: command.moneyFirst ? [money, used] : [used, money] };
  },
});
const registry = createRegistry([
  commerce,
  { ...clock, rules: [] },
  { ...npc, rules: [] },
  { ...economy, rules: [] },
  checkout,
]);

function initial(eddies = 2000): WorldState {
  const base = registry.initialWorld(NOW);
  return {
    ...base,
    slices: {
      ...base.slices,
      economy: { eddies, settled: [] },
      world: { ...(base.slices.world as object), location: "market" },
    },
  };
}

function offer(overrides: Partial<z.input<typeof OfferCommandSchema>> = {}) {
  return OfferCommandSchema.parse({
    type: "commerce.offer",
    id: "lin-pistol-offer",
    ...terms,
    price: 800,
    evidence,
    ...overrides,
  });
}

function context(tradeNarrative = evidence) {
  return { rng: fixedRng([]), data, facts: { tradeNarrative } };
}

function state(world: WorldState) {
  return CommerceStateSchema.parse(world.slices.commerce);
}

function register(command = offer(), world = initial(), tradeNarrative = command.evidence) {
  const result = registry.applyCommands(world, [command], context(tradeNarrative));
  expect(result.results[0]?.result.ok).toBe(true);
  return result;
}

describe("交易报价的证据与生命周期", () => {
  it("从同店地图入口继续谈判仍能读到已谈报价及实物和旧件条件", () => {
    const quoted = register(
      offer({
        kind: "cyberware",
        action: "install",
        part: "loose-eye",
        disposition: "keep",
        replace: "old-eye",
      }),
    ).world;
    const world = {
      ...quoted,
      slices: {
        ...quoted.slices,
        world: { ...(quoted.slices.world as object), location: "poi:market" },
      },
    };
    const sections = registry
      .sections({
        world,
        input: { text: "就按刚才说好的办" },
        data: {
          ...data,
          merchantSites: [
            {
              merchant: terms.seller,
              kind: "ripperdoc",
              locations: ["market", "poi:market"],
              source: "已核对入口",
            },
          ],
        },
      })
      .join("\n");
    expect(sections).toContain("lin-pistol-offer");
    expect(sections).toContain("最终对价 800 欧元");
    expect(sections).toContain("自带实物 loose-eye");
    expect(sections).toContain("旧件去向 keep");
    expect(sections).toContain(evidence);
  });
  it("只保存对方报价，不交货、不扣钱；跨轮仍可自动匹配", () => {
    const before = initial();
    const quoted = register(offer(), before);
    expect(
      quoted.patches.every((patch) => patch.path[0] === "slices" && patch.path[1] === "commerce"),
    ).toBe(true);
    expect(quoted.world.slices.economy).toEqual(before.slices.economy);
    expect(quoted.world.slices.checkout).toEqual({ deliveries: 0 });
    expect(state(quoted.world).quotes["lin-pistol-offer"]).toMatchObject({
      price: 800,
      at: NOW,
      status: "offered",
      expiresAt: null,
    });
    expect(agreedQuote({ ...quoted.world, time: NOW + 300 }, terms)).toMatchObject({
      ok: true,
      quote: { id: "lin-pistol-offer", price: 800 },
    });
    expect(state(before).quotes).toEqual({});
  });

  it.each([
    { input: evidence },
    { input: evidence, tradeNarrative: "阿林摇了摇头，没有答应这个价。" },
    { narrative: evidence },
  ])("不能拿玩家输入或其他事实字段冒充本轮定稿正文：%j", (facts) => {
    const before = initial();
    const result = registry.applyCommands(before, [offer()], { rng: fixedRng([]), data, facts });
    expect(result.results[0]?.result.ok).toBe(false);
    expect(result.world).toBe(before);
    expect(result.patches).toEqual([]);
  });

  it("正文中只有 100 欧元时，不能登记成免费或其他金额", () => {
    const quote = "阿林说：这把手枪收你 100 欧元。";
    for (const price of [0, 10, 1000]) {
      const before = initial();
      const result = registry.applyCommands(
        before,
        [offer({ price, evidence: quote })],
        context(quote),
      );
      expect(result.results[0]?.result.ok).toBe(false);
      expect(result.world).toBe(before);
    }
  });

  it.each([
    ["阿林说：一千二百欧元，成交。", 1200],
    ["阿林说：一千二，给你。", 1200],
    ["阿林说：一万二，给你。", 12000],
    ["阿林说：一千零二欧元，成交。", 1002],
    ["阿林说：１，２００ 欧元，成交。", 1200],
    ["阿林说：1.2 千欧元，成交。", 1200],
    ["阿林说：两万五千欧元，成交。", 25000],
    ["阿林说：这次免费，不收钱。", 0],
  ])("金额证据支持正文的自然写法：%s", (text, price) => {
    expect(priceMentioned(text, price)).toBe(true);
    const quoted = register(offer({ price, evidence: text }));
    expect(state(quoted.world).quotes["lin-pistol-offer"]?.price).toBe(price);
  });

  it("只登记现场未知服务者，失败时也不残留人物身份", () => {
    const service = offer({
      id: "noodle-offer",
      seller: "noodle-vendor",
      kind: "service",
      action: "service",
      target: "meal",
      price: 20,
      evidence: "摊主说：一碗面 20 欧元。",
      party: { name: "面摊老板", location: "market" },
    });
    const quoted = register(service);
    expect(registeredParty(quoted.world, service.seller)).toEqual({
      id: service.seller,
      name: "面摊老板",
      location: "market",
    });
    const before = initial();
    const rejected = registry.applyCommands(
      before,
      [{ ...service, party: { name: "面摊老板", location: "elsewhere" } }],
      context(service.evidence),
    );
    expect(rejected.results[0]?.result.ok).toBe(false);
    expect(rejected.world).toBe(before);
  });

  it("到期瞬间不能再引用或消费，也不能登记已经过期的新报价", () => {
    const quoted = register(offer({ expiresAt: NOW + 5 })).world;
    const selector = { ...terms, offer: "lin-pistol-offer" };
    expect(agreedQuote({ ...quoted, time: NOW + 4 }, selector).ok).toBe(true);
    const later = { ...quoted, time: NOW + 5 };
    expect(agreedQuote(later, selector).ok).toBe(false);
    expect(agreedQuote(later, terms)).toEqual({ ok: true, quote: null });
    const consumed = registry.applyCommands(
      later,
      [{ type: "commerce.used", id: selector.offer }],
      context(),
    );
    expect(consumed.results[0]?.result.ok).toBe(false);
    expect(consumed.world).toBe(later);
    expect(
      registry.applyCommands(initial(), [offer({ expiresAt: NOW })], context()).results[0]?.result
        .ok,
    ).toBe(false);
  });

  it("撤回须有本轮证据，撤回后既不能成交，也不能覆盖旧 id", () => {
    const quoted = register().world;
    const withdrawal = {
      type: "commerce.withdraw",
      id: "lin-pistol-offer",
      evidence: "阿林说：刚才的报价作废。",
    };
    const unproven = registry.applyCommands(quoted, [withdrawal], context());
    expect(unproven.results[0]?.result.ok).toBe(false);
    expect(unproven.world).toBe(quoted);
    const withdrawn = registry.applyCommands(
      quoted,
      [withdrawal],
      context(withdrawal.evidence),
    ).world;
    expect(state(withdrawn).quotes[withdrawal.id]?.status).toBe("withdrawn");
    expect(agreedQuote(withdrawn, { ...terms, offer: withdrawal.id }).ok).toBe(false);
    const duplicate = registry.applyCommands(withdrawn, [offer()], context());
    expect(duplicate.results[0]?.result.ok).toBe(false);
    expect(duplicate.world).toBe(withdrawn);
  });

  it("新报价替换同一条件的旧报价，但不同物品、对方或旧件条件不能串用", () => {
    const first = register().world;
    const second = register(
      offer({ id: "revised", price: 700, evidence: "阿林说：改成 700 欧元。" }),
      first,
    ).world;
    expect(state(second).quotes["lin-pistol-offer"]?.status).toBe("withdrawn");
    expect(agreedQuote(second, terms)).toMatchObject({
      ok: true,
      quote: { id: "revised", price: 700 },
    });
    for (const changed of [
      { seller: "other-shop" },
      { target: "rifle" },
      { action: "sell" as const },
    ]) {
      expect(agreedQuote(second, { ...terms, offer: "revised", ...changed }).ok).toBe(false);
    }
    const chrome = offer({
      id: "chrome-offer",
      kind: "cyberware",
      action: "install",
      target: "new-arm",
      replace: "old-arm",
      tradeIn: true,
    });
    const quoted = register(chrome, second).world;
    const selector: QuoteSelector = {
      seller: chrome.seller,
      kind: chrome.kind,
      action: chrome.action,
      target: chrome.target,
      replace: chrome.replace,
      tradeIn: chrome.tradeIn,
      offer: chrome.id,
    };
    expect(agreedQuote(quoted, selector).ok).toBe(true);
    for (const changed of [
      { replace: "another-arm" },
      { replace: undefined },
      { tradeIn: false },
    ]) {
      expect(agreedQuote(quoted, { ...selector, ...changed }).ok).toBe(false);
    }
  });

  it("接受报价的自然输入仍能读到当前商店的已谈条件", () => {
    const quoted = register().world;
    const section = commerce.sections?.[0]?.render({
      world: quoted,
      data,
      input: { text: "就按刚才的价格买" },
    });
    expect(section).toContain("lin-pistol-offer");
    expect(section).toContain("800 欧元");
  });
});

describe("报价消费与保存", () => {
  it("消费只允许内部结算发出，不能让模型直接标为成交", () => {
    expect(registry.parseCommand({ type: "commerce.used", id: "lin-pistol-offer" }).ok).toBe(false);
    expect(registry.parseInternal({ type: "commerce.used", id: "lin-pistol-offer" }).ok).toBe(true);
  });

  it("已经消费报价后扣款失败，报价、交付和余额一起回滚", () => {
    const quoted = register(offer(), initial(700)).world;
    const failed = registry.applyCommands(
      quoted,
      [{ type: "test.checkout", offer: "lin-pistol-offer", price: 800 }],
      context(),
    );
    expect(failed.results[0]?.result.ok).toBe(false);
    expect(failed.world).toBe(quoted);
    expect(failed.patches).toEqual([]);
    expect(state(failed.world).quotes["lin-pistol-offer"]?.status).toBe("offered");
    expect(EconomyStateSchema.parse(failed.world.slices.economy).eddies).toBe(700);
    expect(failed.world.slices.checkout).toEqual({ deliveries: 0 });
  });

  it("成功成交只消费一次；再次消费失败能回滚先扣的钱", () => {
    const quoted = register().world;
    const purchase = {
      type: "test.checkout",
      offer: "lin-pistol-offer",
      price: 800,
      moneyFirst: true,
    };
    const paid = registry.applyCommands(quoted, [purchase], context());
    expect(paid.results[0]?.result.ok).toBe(true);
    expect(EconomyStateSchema.parse(paid.world.slices.economy).eddies).toBe(1200);
    expect(paid.world.slices.checkout).toEqual({ deliveries: 1 });
    expect(state(paid.world).quotes[purchase.offer]?.status).toBe("used");
    const repeated = registry.applyCommands(paid.world, [purchase], context());
    expect(repeated.results[0]?.result.ok).toBe(false);
    expect(repeated.world).toBe(paid.world);
    expect(repeated.patches).toEqual([]);
    expect(agreedQuote(paid.world, { ...terms, offer: purchase.offer }).ok).toBe(false);
    expect(registry.applyCommands(paid.world, [offer()], context()).results[0]?.result.ok).toBe(
      false,
    );
  });

  it("报价日志重放与 JSON 存档恢复后仍按原条件可用", () => {
    const before = initial();
    const quoted = register(offer(), before);
    const log = serializeRecord({
      kind: "action",
      seq: 0,
      at: "2026-11-17T00:00:00.000Z",
      requestId: "quote-test",
      action: { type: "test.offer" },
      commands: [offer()],
      notes: [],
      patches: [...quoted.patches],
    });
    const restored = replay({ nextSeq: 0, world: before }, parseLog(log).records);
    expect(restored).toEqual(quoted.world);
    const snapshot: WorldState = JSON.parse(JSON.stringify(restored));
    expect(agreedQuote(snapshot, terms)).toMatchObject({
      ok: true,
      quote: { id: "lin-pistol-offer", price: 800 },
    });
    const paid = registry.applyCommands(
      snapshot,
      [{ type: "test.checkout", offer: "lin-pistol-offer", price: 800 }],
      context(),
    );
    expect(paid.results[0]?.result.ok).toBe(true);
    expect(EconomyStateSchema.parse(paid.world.slices.economy).eddies).toBe(1200);
    expect(state(paid.world).quotes["lin-pistol-offer"]?.status).toBe("used");
  });
});
