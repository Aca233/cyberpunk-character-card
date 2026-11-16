import { describe, expect, it } from "vitest";
import { applyPlayerAction } from "../actions";
import { newGameWorld, projectState } from "../game";
import type { LlmClient, LlmRequest } from "../kernel/ports";
import type { WorldState } from "../kernel/world";
import { TurnInputSchema } from "../schemas/turn";
import { CommerceStateSchema } from "../systems/commerce";
import { EconomyStateSchema } from "../systems/economy";
import { InventoryStateSchema, ItemDefSchema } from "../systems/inventory";
import { WorldClockStateSchema } from "../systems/world";
import { BuyProposalSchema, purchaseQuote } from "./stages";
import { runNarratorTurn } from "./turn";

const data = {
  items: [
    ItemDefSchema.parse({ id: "chip", name: "数据芯片", kind: "misc", price: 250 }),
    ItemDefSchema.parse({ id: "sensor", name: "传感器", kind: "misc", price: 900 }),
    ItemDefSchema.parse({ id: "drive", name: "加密驱动器", kind: "misc", price: 10000 }),
    ItemDefSchema.parse({ id: "spare", name: "备用驱动器", kind: "misc", price: 10000 }),
  ],
  locations: [
    { id: "market", name: "市场", district: "沃森" },
    { id: "outside", name: "门外", district: "沃森" },
  ],
  shops: [
    {
      id: "first",
      name: "前柜台",
      keeper: "甲",
      location: "market",
      priceFactor: 1,
      shelf: ["chip", "sensor", "drive", "spare"],
    },
    {
      id: "actual",
      name: "阿涛摊子",
      keeper: "阿涛",
      location: "market",
      priceFactor: 0.7,
      shelf: ["chip", "sensor", "drive", "spare"],
    },
  ],
};

function initial(eddies = 10000): WorldState {
  const world = newGameWorld({ startTime: 1000 });
  return {
    ...world,
    slices: {
      ...world.slices,
      world: { ...WorldClockStateSchema.parse(world.slices.world), location: "market" },
      economy: { ...EconomyStateSchema.parse(world.slices.economy), eddies },
    },
  };
}

async function run(
  options: {
    world?: WorldState;
    text?: string;
    buy?: unknown;
    narrative?: string;
    changes?: unknown[];
    approvedSpend?: string;
    spendOk?: boolean;
  } = {},
) {
  const world = options.world ?? initial();
  const requests: LlmRequest[] = [];
  const llm: LlmClient = {
    async *stream(request) {
      requests.push(request);
      const stage = request.responseFormat?.name ?? "narrate";
      const value =
        stage === "judge"
          ? { read: "回应交易", ooc: false, ruling: null, buy: options.buy ?? null, recall: [] }
          : stage === "extract"
            ? { changes: options.changes ?? [], choices: [], dropped: [] }
            : stage === "repair_batch"
              ? { fixes: [] }
              : (options.narrative ?? "阿涛把数据芯片递到柜台上，收下了约定的欧元。");
      yield { type: "text", text: typeof value === "string" ? value : JSON.stringify(value) };
      yield { type: "done", finishReason: "stop" };
    },
  };
  const result = await runNarratorTurn(
    {
      llm,
      rng: { roll: () => 1 },
      data,
      offscreen: null,
      contextWindow: 64000,
      approvedSpend: options.approvedSpend,
    },
    world,
    [],
    {
      kind: "action",
      input: TurnInputSchema.parse({
        text: options.text ?? "向阿涛买下数据芯片",
        spendOk: options.spendOk,
      }),
    },
  );
  return { result, requests, world };
}
const trade = (item = "chip", offer?: string) => ({
  type: "trade",
  action: "buy",
  item,
  with: "actual",
  reason: "付钱取货",
  ...(offer ? { offer } : {}),
});

describe("商店交易贯穿判断、正文和抽取", () => {
  it("同地点多店按实际对方报价，正文、按钮与文字成交同价同库存", async () => {
    const { result, requests, world } = await run({
      buy: { item: "chip", with: "actual" },
      changes: [trade()],
    });
    expect(result.kind).toBe("done");
    if (result.kind !== "done") throw new Error("未成交");
    const button = applyPlayerAction(
      world,
      { type: "buyItem", shop: "actual", id: "chip" },
      { rng: { roll: () => 1 }, data },
    );
    expect(button.ok).toBe(true);
    if (!button.ok) throw new Error(button.reason);
    expect(result.turn.unsettled).toBeUndefined();
    expect(result.turn.world.slices.economy).toEqual(button.world.slices.economy);
    expect(result.turn.world.slices.inventory).toEqual(button.world.slices.inventory);
    expect(EconomyStateSchema.parse(result.turn.world.slices.economy).eddies).toBe(9820);
    expect(
      InventoryStateSchema.parse(result.turn.world.slices.inventory).shopStock.first,
    ).toBeUndefined();
    const prompt =
      requests
        .find((r) => !r.responseFormat)
        ?.messages.map((m) => m.content)
        .join("\n") ?? "";
    expect(prompt).toContain("最终对价 180 欧元");
    expect(requests.map((r) => r.responseFormat?.name ?? "narrate")).toEqual([
      "judge",
      "narrate",
      "extract",
    ]);
  });

  it("单独商谈保存报价不扣款，下一轮接受与按钮购买都沿用该价", async () => {
    const evidence = "阿涛说：这枚数据芯片收你一百二十欧元。";
    const first = await run({
      text: "这芯片能便宜一些吗？",
      narrative: evidence,
      changes: [
        {
          type: "commerce.offer",
          id: "chip-deal",
          seller: "actual",
          kind: "item",
          action: "buy",
          target: "chip",
          price: 120,
          evidence,
        },
      ],
    });
    expect(first.result.kind).toBe("done");
    if (first.result.kind !== "done") throw new Error("无报价");
    const quotedWorld = first.result.turn.world;
    expect(quotedWorld.slices.economy).toEqual(first.world.slices.economy);
    expect(quotedWorld.slices.inventory).toEqual(first.world.slices.inventory);
    expect(CommerceStateSchema.parse(quotedWorld.slices.commerce).quotes["chip-deal"]?.status).toBe(
      "offered",
    );
    expect(
      projectState(quotedWorld, [], data)
        .shops.find((s) => s.id === "actual")
        ?.shelf.find((i) => i.id === "chip")?.price,
    ).toBe(120);
    const second = await run({
      world: quotedWorld,
      text: "就按刚才的价格买",
      buy: { item: "chip", with: "actual", offer: "chip-deal" },
      changes: [trade("chip", "chip-deal")],
    });
    expect(second.result.kind).toBe("done");
    if (second.result.kind !== "done") throw new Error("未成交");
    expect(EconomyStateSchema.parse(second.result.turn.world.slices.economy).eddies).toBe(9880);
    expect(
      CommerceStateSchema.parse(second.result.turn.world.slices.commerce).quotes["chip-deal"]
        ?.status,
    ).toBe("used");
  });

  it("正文之后抽取擅自改变成交价时，不按新金额扣款或交货", async () => {
    const evidence = "阿涛说：临时变价，现在要两百欧元。";
    const { result, world } = await run({
      buy: { item: "chip", with: "actual" },
      narrative: evidence,
      changes: [
        {
          type: "commerce.offer",
          id: "changed-price",
          seller: "actual",
          kind: "item",
          action: "buy",
          target: "chip",
          price: 200,
          evidence,
        },
        trade("chip", "changed-price"),
      ],
    });
    expect(result.kind).toBe("done");
    if (result.kind !== "done") throw new Error("无结果");
    expect(result.turn.world.slices.economy).toEqual(world.slices.economy);
    expect(result.turn.world.slices.inventory).toEqual(world.slices.inventory);
    expect(result.turn.unsettled).toBeDefined();
  });

  it("大额确认绑定实际店价和具体商品，布尔标记不能单独绕过", async () => {
    const proposal = { item: "drive", with: "actual" };
    const first = await run({ buy: proposal });
    expect(first.result).toMatchObject({ kind: "confirmSpend", price: 7000 });
    expect(first.requests).toHaveLength(1);
    if (first.result.kind !== "confirmSpend") throw new Error("未确认");
    const flag = await run({ buy: proposal, spendOk: true });
    expect(flag.result.kind).toBe("confirmSpend");
    const changed = await run({
      buy: { item: "spare", with: "actual" },
      spendOk: true,
      approvedSpend: first.result.quoteKey,
    });
    expect(changed.result.kind).toBe("confirmSpend");
    const accepted = await run({
      buy: proposal,
      spendOk: true,
      approvedSpend: first.result.quoteKey,
      changes: [trade("drive")],
    });
    expect(accepted.result.kind).toBe("done");
    if (accepted.result.kind !== "done") throw new Error("未成交");
    expect(EconomyStateSchema.parse(accepted.result.turn.world.slices.economy).eddies).toBe(3000);
  });

  it("本轮先实际到店再成交，执行时读取当前地点并扣实际店库存", async () => {
    const world = initial();
    const outside = {
      ...world,
      slices: {
        ...world.slices,
        world: { ...WorldClockStateSchema.parse(world.slices.world), location: "outside" },
      },
    };
    const { result } = await run({
      world: outside,
      text: "我走进旁边的市场，在阿涛那里买数据芯片",
      buy: { item: "chip", with: "actual", destination: "market" },
      changes: [{ type: "world", activity: "travel", location: "market", time: 1001 }, trade()],
    });
    expect(result.kind).toBe("done");
    if (result.kind !== "done") throw new Error("未成交");
    expect(result.turn.unsettled).toBeUndefined();
    expect(EconomyStateSchema.parse(result.turn.world.slices.economy).eddies).toBe(9820);
    expect(
      InventoryStateSchema.parse(result.turn.world.slices.inventory).shopStock.actual?.sold.chip,
    ).toBe(1);
  });

  it("身份或货源未确定不能以目录价格冒充可成交报价", () => {
    expect(purchaseQuote(initial(), data, BuyProposalSchema.parse({ item: "chip" }))).toMatchObject(
      { ok: false },
    );
    expect(
      purchaseQuote(
        initial(),
        data,
        BuyProposalSchema.parse({ item: "chip", with: "不存在的商店" }),
      ),
    ).toMatchObject({ ok: false });
  });

  it("询价时抽取擅自发交易也不扣钱或交货", async () => {
    const { result, world } = await run({ text: "芯片多少钱？", changes: [trade()] });
    if (result.kind !== "done") throw new Error("未完成");
    expect(result.turn.world.slices.inventory).toEqual(world.slices.inventory);
    expect(result.turn.world.slices.economy).toEqual(world.slices.economy);
    expect(result.turn.unsettled).toBeDefined();
  });

  it("单笔授权不能被重复成交或额外物品/扣款消费", async () => {
    const { result } = await run({
      buy: { item: "chip", with: "actual" },
      changes: [
        trade(),
        trade(),
        { type: "item", action: "gain", id: "chip", reason: "买到芯片" },
        { type: "money", delta: -180, reason: "买芯片" },
      ],
    });
    if (result.kind !== "done") throw new Error("未完成");
    expect(InventoryStateSchema.parse(result.turn.world.slices.inventory).backpack.chip).toBe(1);
    expect(EconomyStateSchema.parse(result.turn.world.slices.economy).eddies).toBe(9820);
    expect(result.turn.unsettled).toBeDefined();
  });

  it("明确买两件可成交两次，第三条重复抽取不再交付", async () => {
    const { result } = await run({
      text: "向阿涛买两枚数据芯片",
      buy: [
        { item: "chip", with: "actual" },
        { item: "chip", with: "actual" },
      ],
      changes: [trade(), trade(), trade()],
    });
    if (result.kind !== "done") throw new Error("未完成");
    expect(InventoryStateSchema.parse(result.turn.world.slices.inventory).backpack.chip).toBe(2);
    expect(EconomyStateSchema.parse(result.turn.world.slices.economy).eddies).toBe(9640);
  });

  it("购买后可以接着转交，不把相反方向的物件转移当成重复领取", async () => {
    const { result } = await run({
      buy: { item: "chip", with: "actual" },
      changes: [trade(), { type: "item", action: "lose", id: "chip", reason: "交给同行朋友" }],
    });
    if (result.kind !== "done") throw new Error("未完成");
    expect(
      InventoryStateSchema.parse(result.turn.world.slices.inventory).backpack.chip,
    ).toBeUndefined();
    expect(result.turn.unsettled).toBeUndefined();
  });

  it("多笔小额合计达到大额门槛也须确认", async () => {
    const buy = Array.from({ length: 2 }, () => ({ item: "sensor", with: "actual" }));
    const { result } = await run({ world: initial(2000), buy });
    expect(result).toMatchObject({ kind: "confirmSpend", price: 1260 });
  });

  it("只在判断中写目的地却没真正到达不能成交", async () => {
    const world = initial();
    const { result } = await run({
      world: {
        ...world,
        slices: {
          ...world.slices,
          world: { ...WorldClockStateSchema.parse(world.slices.world), location: "outside" },
        },
      },
      buy: { item: "chip", with: "actual", destination: "market" },
      changes: [trade()],
    });
    if (result.kind !== "done") throw new Error("未完成");
    expect(EconomyStateSchema.parse(result.turn.world.slices.economy).eddies).toBe(10000);
    expect(result.turn.unsettled).toBeDefined();
  });
});
