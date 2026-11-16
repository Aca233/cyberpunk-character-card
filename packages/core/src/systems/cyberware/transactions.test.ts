import { describe, expect, it } from "vitest";
import { applyPlayerAction, type PlayerAction } from "../../actions";
import { newGameWorld } from "../../game";
import { fixedRng } from "../../kernel/rng";
import { createRegistry } from "../../kernel/system";
import type { WorldState } from "../../kernel/world";
import { AgreedQuoteSchema } from "../commerce";
import { EconomyStateSchema } from "../economy";
import { HealthStateSchema } from "../health";
import { NpcSchema } from "../npc";
import { registry, systems } from "../registry";
import { WorldClockStateSchema } from "../world";
import { type CyberwareQuoteRequest, quoteCyberware } from "./quote";
import { ripperdocView } from "./ripperdoc";
import {
  CyberwareCommandSchema,
  CyberwareDefSchema,
  CyberwareStateSchema,
  RipperdocSchema,
} from "./schema";

const chrome = (id: string, slot: "arms" | "eyes", price: number) =>
  CyberwareDefSchema.parse({
    id,
    name: id,
    slot,
    rarity: "legendary",
    price,
    humanityCost: 10,
    ability: "硬件功能",
  });
const parts = [
  chrome("old-arm", "arms", 1000),
  chrome("new-arm", "arms", 5000),
  chrome("eye", "eyes", 1250),
  chrome("second-eye", "eyes", 1500),
  chrome("off-shelf", "eyes", 2000),
];
const doc = RipperdocSchema.parse({
  id: "needle",
  name: "针眼",
  keeperNpc: "medic",
  location: "clinic",
  priceFactor: 0.8,
  shelf: ["old-arm", "new-arm", "eye", "second-eye"],
  credit: 3000,
  credGates: { legendary: 50 },
});
const data = { cyberware: parts, ripperdocs: [doc], items: [], quickhacks: [] };
const context = () => ({ rng: fixedRng([]), data });
const installed = (id: string, slot: "arms" | "eyes") => ({ id, slot, installedAt: 0 });

function world(
  options: {
    cash?: number;
    old?: boolean;
    location?: string;
    alive?: boolean;
    doctorLocation?: string | null;
    broken?: boolean;
  } = {},
): WorldState {
  const initial = newGameWorld({ startTime: 1000 });
  const doctor = NpcSchema.parse({
    id: "medic",
    name: "针眼",
    pronoun: "他",
    role: "义体医生",
    look: "白外套",
    voice: "直接",
    want: "完成手术",
    limit: "不伪造检查",
    affinity: 0,
    met: true,
    alive: options.alive ?? true,
    location: options.doctorLocation === undefined ? "clinic" : options.doctorLocation,
    lastSeenAt: 1000,
    memories: [],
  });
  return {
    ...initial,
    slices: {
      ...initial.slices,
      world: {
        ...WorldClockStateSchema.parse(initial.slices.world),
        location: options.location ?? "clinic",
      },
      economy: {
        ...EconomyStateSchema.parse(initial.slices.economy),
        eddies: options.cash ?? 10000,
      },
      cyberware: {
        ...CyberwareStateSchema.parse(initial.slices.cyberware),
        installed: options.old ? [installed("old-arm", "arms")] : [],
      },
      health: {
        ...HealthStateSchema.parse(initial.slices.health),
        brokenChrome: options.broken ? ["old-arm"] : [],
      },
      npc: { npcs: { medic: doctor }, seedTags: {} },
    },
  };
}

function textAction(state: WorldState, request: CyberwareQuoteRequest, event?: string) {
  const command = CyberwareCommandSchema.parse({
    type: "cyberware",
    ...request,
    reason: "玩家已接受交易条件",
    event,
  });
  return registry.applyCommands(state, [command], context());
}
function button(state: WorldState, action: PlayerAction) {
  const result = applyPlayerAction(state, action, context());
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.reason);
  return result.world;
}
function succeeded(state: WorldState, request: CyberwareQuoteRequest, event?: string) {
  const result = textAction(state, request, event);
  expect(result.results[0]?.result.ok).toBe(true);
  return result.world;
}
function sameTransaction(a: WorldState, b: WorldState) {
  for (const slice of ["economy", "cyberware", "health", "world", "commerce"])
    expect(a.slices[slice]).toEqual(b.slices[slice]);
  expect(a.time).toBe(b.time);
}

describe("义体按钮与正文共享交易事实", () => {
  it("同一医生报价一致，询价只读且不恢复声望门槛", () => {
    const before = world();
    const snapshot = JSON.stringify(before);
    const q = quoteCyberware(before, data, { action: "install", doc: "needle", id: "eye" });
    expect(q).toMatchObject({
      ok: true,
      quote: { price: 1000, total: 1000, cash: 1000, blocked: null },
    });
    expect(JSON.stringify(before)).toBe(snapshot);
    const byButton = button(before, { type: "buyCyberware", doc: "needle", id: "eye" });
    const byText = succeeded(before, { action: "install", doc: "needle", id: "eye" });
    sameTransaction(byButton, byText);
    expect(EconomyStateSchema.parse(byText.slices.economy).eddies).toBe(9000);
  });

  it.each([{ location: "elsewhere" }, { alive: false }, { doctorLocation: "elsewhere" }])(
    "现场不成立时两个入口都拒绝，%j",
    (options) => {
      const before = world(options);
      expect(
        applyPlayerAction(before, { type: "buyCyberware", doc: "needle", id: "eye" }, context()).ok,
      ).toBe(false);
      const byText = textAction(before, { action: "install", doc: "needle", id: "eye" });
      expect(byText.results[0]?.result.ok).toBe(false);
      expect(byText.world).toEqual(before);
    },
  );

  it("未知医生位置不是缺席；明确登记的替班医生可继续服务", () => {
    expect(
      quoteCyberware(world({ doctorLocation: null }), data, {
        action: "install",
        doc: "needle",
        id: "eye",
      }).ok,
    ).toBe(true);
    const before = world({ alive: false });
    const npc = NpcSchema.parse({
      ...((world().slices.npc as { npcs: Record<string, unknown> }).npcs.medic as object),
      id: "relief",
      name: "替班医生",
    });
    const state = {
      ...before,
      slices: {
        ...before.slices,
        npc: {
          ...(before.slices.npc as object),
          npcs: { ...(before.slices.npc as { npcs: object }).npcs, relief: npc },
        },
      },
    };
    const staffed = { ...data, ripperdocs: [{ ...doc, serviceNpcs: ["relief"] }] };
    expect(
      quoteCyberware(state, staffed, { action: "install", doc: "needle", id: "eye" }),
    ).toMatchObject({ ok: true, quote: { provider: "替班医生" } });
  });

  it("拒绝不存在的医生和货架外商品，price 不能覆盖报价", () => {
    const before = world();
    for (const request of [
      { action: "install", doc: "missing", id: "eye" },
      { action: "install", doc: "needle", id: "off-shelf" },
    ] as const) {
      expect(quoteCyberware(before, data, request).ok).toBe(false);
      expect(textAction(before, request).world).toEqual(before);
    }
    expect(
      CyberwareCommandSchema.safeParse({
        type: "cyberware",
        action: "install",
        doc: "needle",
        id: "eye",
        price: 0,
        reason: "免费",
      }).success,
    ).toBe(false);
  });

  it("正文前确认的金额和对象不能在抽取时更改", () => {
    const before = world();
    const command = CyberwareCommandSchema.parse({
      type: "cyberware",
      action: "install",
      doc: "needle",
      id: "eye",
      reason: "已确认",
    });
    const expected = {
      seller: "needle",
      kind: "cyberware",
      action: "install",
      target: "eye",
      price: 1000,
      cash: 1000,
      credit: 0,
      creditAllowed: false,
    };
    for (const facts of [
      { tradeQuote: { ...expected, price: 800 } },
      { tradeQuote: { ...expected, seller: "someone-else" } },
      { tradeQuoteError: "未确认本次交易" },
    ]) {
      const result = registry.applyCommands(before, [command], { ...context(), facts });
      expect(result.results[0]?.result.ok).toBe(false);
      expect(result.world).toEqual(before);
    }
    expect(
      registry.applyCommands(before, [command], { ...context(), facts: { tradeQuote: expected } })
        .results[0]?.result.ok,
    ).toBe(true);
  });

  it("满槽文字安装必须指定并授权出售旧件，按钮确认同一目标得到相同折抵", () => {
    const before = world({ old: true });
    for (const request of [
      { action: "install", doc: "needle", id: "new-arm" },
      { action: "install", doc: "needle", id: "new-arm", replace: "old-arm" },
      { action: "install", doc: "needle", id: "new-arm", replace: "eye", tradeIn: true },
    ] as const)
      expect(textAction(before, request).world).toEqual(before);
    const request = {
      action: "install",
      doc: "needle",
      id: "new-arm",
      replace: "old-arm",
      tradeIn: true,
    } as const;
    expect(quoteCyberware(before, data, request)).toMatchObject({
      ok: true,
      quote: { price: 4000, tradeIn: 200, total: 3800 },
    });
    sameTransaction(
      button(before, { type: "buyCyberware", doc: "needle", id: "new-arm" }),
      succeeded(before, request),
    );
    expect(textAction(before, { action: "remove", doc: "needle", id: "old-arm" }).world).toEqual(
      before,
    );
  });

  it("拆卸回收与维修同价同结果，维修失败不扣钱", () => {
    const before = world({ old: true, broken: true });
    const repaired = succeeded(before, { action: "repair", doc: "needle", id: "old-arm" });
    sameTransaction(
      button(before, { type: "repairCyberware", doc: "needle", id: "old-arm" }),
      repaired,
    );
    expect(EconomyStateSchema.parse(repaired.slices.economy).eddies).toBe(9700);
    expect(textAction(repaired, { action: "repair", doc: "needle", id: "old-arm" }).world).toEqual(
      repaired,
    );
    const removed = succeeded(repaired, {
      action: "remove",
      doc: "needle",
      id: "old-arm",
      tradeIn: true,
    });
    sameTransaction(
      button(repaired, { type: "removeCyberware", doc: "needle", id: "old-arm" }),
      removed,
    );
    expect(EconomyStateSchema.parse(removed.slices.economy).eddies).toBe(9900);
  });

  it("文字指定的替换目标不是最早旧件时，只移走玩家选择的那件", () => {
    const initial = world();
    const before: WorldState = {
      ...initial,
      slices: {
        ...initial.slices,
        cyberware: {
          ...CyberwareStateSchema.parse(initial.slices.cyberware),
          installed: [installed("off-shelf", "eyes"), installed("eye", "eyes")],
        },
      },
    };
    const after = succeeded(before, {
      action: "install",
      doc: "needle",
      id: "second-eye",
      replace: "eye",
      tradeIn: true,
    });
    expect(CyberwareStateSchema.parse(after.slices.cyberware).installed.map((c) => c.id)).toEqual([
      "off-shelf",
      "second-eye",
    ]);
    expect(EconomyStateSchema.parse(after.slices.economy).eddies).toBe(9000);
  });

  it("赊账必须授权，超额或已有欠款全笔拒绝；还款同样一次完成", () => {
    const before = world({ old: true, cash: 1000 });
    const request = {
      action: "install",
      doc: "needle",
      id: "new-arm",
      replace: "old-arm",
      tradeIn: true,
    } as const;
    expect(textAction(before, request).world).toEqual(before);
    const onCredit = succeeded(before, { ...request, credit: true });
    sameTransaction(
      button(before, { type: "buyCyberware", doc: "needle", id: "new-arm", credit: true }),
      onCredit,
    );
    expect(CyberwareStateSchema.parse(onCredit.slices.cyberware).debts[0]?.amount).toBe(2800);
    expect(
      textAction(onCredit, { action: "install", doc: "needle", id: "eye", credit: true }).world,
    ).toEqual(onCredit);
    expect(
      textAction(world({ cash: 0 }), {
        action: "install",
        doc: "needle",
        id: "new-arm",
        credit: true,
      }).world,
    ).toEqual(world({ cash: 0 }));
    expect(textAction(onCredit, { action: "repay", doc: "needle" }).world).toEqual(onCredit);
    const funded = {
      ...onCredit,
      slices: { ...onCredit.slices, economy: { eddies: 3000, settled: [] } },
    };
    const paid = succeeded(funded, { action: "repay", doc: "needle" });
    sameTransaction(button(funded, { type: "repayRipperdoc", doc: "needle" }), paid);
    expect(EconomyStateSchema.parse(paid.slices.economy).eddies).toBe(200);
    expect(CyberwareStateSchema.parse(paid.slices.cyberware).debts).toEqual([]);
    expect(WorldClockStateSchema.parse(paid.slices.world).deadlines[0]?.handledAt).toBe(paid.time);
  });

  it("正文前没有授权的借款不能由抽取临时补上，现金和借款额也必须一致", () => {
    const before = world({ old: true, cash: 1000 });
    const command = CyberwareCommandSchema.parse({
      type: "cyberware",
      action: "install",
      doc: "needle",
      id: "new-arm",
      replace: "old-arm",
      tradeIn: true,
      credit: true,
      reason: "接受安装",
    });
    const expected = {
      seller: "needle",
      kind: "cyberware",
      action: "install",
      target: "new-arm",
      price: 3800,
      cash: 1000,
      credit: 2800,
      creditAllowed: true,
      replace: "old-arm",
      tradeIn: true,
    };
    for (const unauthorized of [
      { ...expected, creditAllowed: false },
      { ...expected, cash: 3800, credit: 0 },
      { ...expected, cash: 1200, credit: 2600 },
    ]) {
      const result = registry.applyCommands(before, [command], {
        ...context(),
        facts: { tradeNarrative: "针眼准备安装新义体。", tradeQuote: unauthorized },
      });
      expect(result.results[0]?.result.ok).toBe(false);
      expect(result.world).toEqual(before);
    }
    const result = registry.applyCommands(before, [command], {
      ...context(),
      facts: { tradeNarrative: "针眼同意现金一千、尾款赊账。", tradeQuote: expected },
    });
    expect(result.results[0]?.result.ok).toBe(true);
    expect(EconomyStateSchema.parse(result.world.slices.economy).eddies).toBe(0);
    expect(CyberwareStateSchema.parse(result.world.slices.cyberware).debts[0]?.amount).toBe(2800);
  });

  it("谈妥净价只扣一次，面板一致，显式过期/已使用报价不能重用", () => {
    const initial = world({ old: true });
    const offer = AgreedQuoteSchema.parse({
      id: "deal",
      seller: "needle",
      kind: "cyberware",
      action: "install",
      target: "new-arm",
      replace: "old-arm",
      tradeIn: true,
      price: 2500,
      evidence: "旧件抵完收你2500欧元",
      at: 1000,
      expiresAt: null,
      status: "offered",
    });
    const before: WorldState = {
      ...initial,
      slices: { ...initial.slices, commerce: { quotes: { deal: offer }, parties: {} } },
    };
    const request = {
      action: "install",
      doc: "needle",
      id: "new-arm",
      replace: "old-arm",
      tradeIn: true,
    } as const;
    expect(quoteCyberware(before, data, request)).toMatchObject({
      ok: true,
      quote: { price: 2700, total: 2500, tradeIn: 200, offer: "deal" },
    });
    expect(
      ripperdocView({ world: before, data, records: [] })?.shelf.find((i) => i.id === "new-arm")
        ?.net,
    ).toBe(2500);
    const after = succeeded(before, { ...request, offer: "deal" }, "buy-once");
    sameTransaction(button(before, { type: "buyCyberware", doc: "needle", id: "new-arm" }), {
      ...after,
      slices: {
        ...after.slices,
        cyberware: { ...CyberwareStateSchema.parse(after.slices.cyberware), settled: [] },
      },
    });
    expect(EconomyStateSchema.parse(after.slices.economy).eddies).toBe(7500);
    expect(
      (after.slices.commerce as { quotes: Record<string, { status: string }> }).quotes.deal?.status,
    ).toBe("used");
    expect(textAction(after, { ...request, offer: "deal" }, "buy-once").world).toEqual(after);
    const expired = {
      ...before,
      slices: {
        ...before.slices,
        commerce: { quotes: { deal: { ...offer, expiresAt: 1000 } }, parties: {} },
      },
    };
    expect(textAction(expired, { ...request, offer: "deal" }).world).toEqual(expired);
  });

  it("后续扣款失败时，已尝试的替换和报价消费全部回滚", () => {
    const initial = world({ old: true, cash: 200000 });
    const offer = AgreedQuoteSchema.parse({
      id: "too-large",
      seller: "needle",
      kind: "cyberware",
      action: "install",
      target: "new-arm",
      replace: "old-arm",
      tradeIn: true,
      price: 2500,
      evidence: "收你2500欧元",
      at: 1000,
      expiresAt: null,
      status: "offered",
    });
    const before: WorldState = {
      ...initial,
      slices: { ...initial.slices, commerce: { quotes: { [offer.id]: offer }, parties: {} } },
    };
    const command = CyberwareCommandSchema.parse({
      type: "cyberware",
      action: "install",
      doc: "needle",
      id: "new-arm",
      replace: "old-arm",
      tradeIn: true,
      offer: offer.id,
      reason: "确认安装",
    });
    const failing = createRegistry(
      systems.map((system) =>
        system.id === "economy"
          ? {
              ...system,
              apply: () => ({ ok: false as const, reason: "付款失败" }),
            }
          : system,
      ),
    );
    const rejected = failing.applyCommands(before, [command], context());
    expect(rejected.results[0]?.result).toEqual({ ok: false, reason: "付款失败" });
    expect(rejected.world).toEqual(before);
    const creditWorld = world({ old: true, cash: 1000 });
    const creditCommand = CyberwareCommandSchema.parse({
      type: "cyberware",
      action: "install",
      doc: "needle",
      id: "new-arm",
      replace: "old-arm",
      tradeIn: true,
      credit: true,
      reason: "接受赊账",
    });
    const rejectedCredit = failing.applyCommands(creditWorld, [creditCommand], context());
    expect(rejectedCredit.results[0]?.result.ok).toBe(false);
    expect(rejectedCredit.world).toEqual(creditWorld);
    expect(CyberwareStateSchema.parse(before.slices.cyberware).installed.map((c) => c.id)).toEqual([
      "old-arm",
    ]);
    expect(
      (before.slices.commerce as { quotes: Record<string, { status: string }> }).quotes[offer.id]
        ?.status,
    ).toBe("offered");
    const accepted = registry.applyCommands(before, [command], context());
    expect(accepted.results[0]?.result.ok).toBe(true);
    expect(EconomyStateSchema.parse(accepted.world.slices.economy).eddies).toBe(197500);
    const excessive: WorldState = {
      ...before,
      slices: {
        ...before.slices,
        commerce: {
          quotes: {
            [offer.id]: { ...offer, price: 150000 },
          },
          parties: {},
        },
      },
    };
    const overLimit = registry.applyCommands(excessive, [command], context());
    expect(overLimit.results[0]?.result.ok).toBe(false);
    expect(overLimit.world).toEqual(excessive);
  });
});
