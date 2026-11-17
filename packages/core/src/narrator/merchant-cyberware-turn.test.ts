import { describe, expect, it } from "vitest";
import { applyPlayerAction } from "../actions";
import { newGameWorld, projectState } from "../game";
import type { LlmClient } from "../kernel/ports";
import type { WorldState } from "../kernel/world";
import { TurnInputSchema } from "../schemas/turn";
import { CyberwareDefSchema, CyberwareStateSchema, RipperdocSchema } from "../systems/cyberware";
import { EconomyStateSchema } from "../systems/economy";
import { SafehouseStateSchema } from "../systems/safehouse/schema";
import { withIndependentEvents } from "./extract-test-fixture";
import { runNarratorTurn } from "./turn";

const eye = CyberwareDefSchema.parse({
  id: "eye",
  name: "义眼",
  slot: "eyes",
  rarity: "rare",
  price: 1000,
  humanityCost: 0,
  ability: "看见热源",
});
const data = {
  cyberware: [eye, { ...eye, id: "old-eye", name: "旧义眼" }],
  ripperdocs: [
    RipperdocSchema.parse({
      id: "doctor",
      name: "医生",
      location: "clinic",
      shelf: ["eye"],
      initialStock: { eye: 2 },
      serviceMinutes: { install: 60, remove: 30, repair: 30 },
    }),
  ],
  locations: [
    { id: "clinic", name: "诊所", district: "沃森" },
    { id: "away", name: "另一处", district: "沃森" },
  ],
  items: [],
  quickhacks: [],
};
function initial(): WorldState {
  const base = newGameWorld({ startTime: 1000 });
  return {
    ...base,
    slices: {
      ...base.slices,
      world: { ...(base.slices.world as object), location: "clinic" },
      economy: { eddies: 10000, settled: [] },
    },
  };
}
const chrome = (world: WorldState) => CyberwareStateSchema.parse(world.slices.cyberware);
const cash = (world: WorldState) => EconomyStateSchema.parse(world.slices.economy).eddies;
const evidence = "医生按约定完成本次办理。";
async function turn(world: WorldState, buy: unknown, changes: unknown[]) {
  const llm: LlmClient = {
    async *stream(request) {
      const stage = request.responseFormat?.name;
      const value =
        stage === "judge"
          ? { read: "办理义体", ooc: false, ruling: null, buy, recall: [] }
          : stage === "extract"
            ? { changes, choices: [], dropped: [] }
            : stage === "repair_batch"
              ? { fixes: [] }
              : evidence;
      yield {
        type: "text",
        text: typeof value === "string" ? value : JSON.stringify(withIndependentEvents(value)),
      };
      yield { type: "done", finishReason: "stop" };
    },
  };
  const result = await runNarratorTurn(
    { llm, data, rng: { roll: () => 1 }, offscreen: null, contextWindow: 64000 },
    world,
    [],
    { kind: "action", input: TurnInputSchema.parse({ text: "按约定办理义体" }) },
  );
  if (result.kind !== "done") throw new Error(result.kind);
  return result.turn;
}
const proposal = { cyberware: "eye", with: "doctor" };
const command = {
  type: "cyberware",
  action: "install",
  id: "eye",
  doc: "doctor",
  reason: "接受服务",
};
const service = (action: string) => ({
  type: "cyberware.service",
  action,
  id: "appointment",
  reason: "接受服务",
  evidence,
});

describe("自由输入义体服务与原面板衔接", () => {
  it("购买实物进入原背包，可通过原存放操作往返，同一件不会重复生成", async () => {
    const bought = await turn(initial(), { ...proposal, operation: "buy" }, [
      { ...command, action: "buy" },
    ]);
    expect(bought.unsettled).toBeUndefined();
    expect(cash(bought.world)).toBe(9200);
    const part = Object.values(chrome(bought.world).parts)[0];
    if (!part) throw new Error("没有实物");
    const view = projectState(bought.world, [], data);
    expect(view.inventory.backpack[part.id]).toBe(1);
    expect(view.names.items[part.id]).toContain("义眼（未安装）");
    const home: WorldState = {
      ...bought.world,
      slices: {
        ...bought.world.slices,
        safehouse: SafehouseStateSchema.parse({
          homes: [{ id: "home", name: "住处", location: "clinic", since: 0 }],
        }),
      },
    };
    const ctx = { data, rng: { roll: () => 1 } };
    const stored = applyPlayerAction(
      home,
      { type: "stash", action: "store", item: part.id, where: "home" },
      ctx,
    );
    if (!stored.ok) throw new Error(stored.reason);
    expect(projectState(stored.world, [], data).inventory.backpack[part.id]).toBeUndefined();
    expect(projectState(stored.world, [], data).safehouse.homes[0]?.items).toEqual([
      { id: part.id, name: "义眼（未安装）", count: 1 },
    ]);
    expect(
      applyPlayerAction(
        stored.world,
        { type: "stash", action: "store", item: part.id, where: "home" },
        ctx,
      ).ok,
    ).toBe(false);
    const away: WorldState = {
      ...stored.world,
      slices: {
        ...stored.world.slices,
        world: { ...(stored.world.slices.world as object), location: "away" },
      },
    };
    expect(
      applyPlayerAction(away, { type: "stash", action: "take", item: part.id, where: "home" }, ctx)
        .ok,
    ).toBe(false);
    const taken = applyPlayerAction(
      JSON.parse(JSON.stringify(stored.world)),
      { type: "stash", action: "take", item: part.id, where: "home" },
      ctx,
    );
    if (!taken.ok) throw new Error(taken.reason);
    expect(Object.keys(chrome(taken.world).parts)).toEqual([part.id]);
    expect(chrome(taken.world).parts[part.id]?.holder).toBe("player");
    const installed = await turn(taken.world, { ...proposal, part: part.id }, [
      { ...command, part: part.id },
    ]);
    expect(installed.unsettled).toBeUndefined();
    expect(cash(installed.world)).toBe(9000);
    expect(chrome(installed.world).clinics.doctor?.stock.eye).toBe(1);
    expect(projectState(installed.world, [], data).inventory.backpack[part.id]).toBeUndefined();
  });

  it("正文已推进到结束时刻仍沿用确认时段，保留旧件不自动出售", async () => {
    const base = initial();
    const world: WorldState = {
      ...base,
      slices: {
        ...base.slices,
        cyberware: {
          ...chrome(base),
          installed: [{ id: "old-eye", slot: "eyes", installedAt: 0 }],
        },
      },
    };
    const done = await turn(world, { ...proposal, replace: "old-eye", disposition: "keep" }, [
      { type: "world", time: 1060, activity: "rest" },
      { ...command, replace: "old-eye", disposition: "keep" },
    ]);
    expect(done.unsettled).toBeUndefined();
    expect(done.world.time).toBe(1060);
    expect(cash(done.world)).toBe(9000);
    expect(chrome(done.world).installed[0]?.id).toBe("eye");
    expect(Object.values(chrome(done.world).parts).find((p) => p.model === "old-eye")?.holder).toBe(
      "player",
    );
  });

  it("抽取不能擅自改手术起点或把保留旧件改成出售", async () => {
    const done = await turn(initial(), proposal, [{ ...command, startAt: 999 }]);
    expect(done.unsettled).toBeDefined();
    expect(cash(done.world)).toBe(10000);
    expect(chrome(done.world).installed).toEqual([]);
    const base = initial();
    const old: WorldState = {
      ...base,
      slices: {
        ...base.slices,
        cyberware: {
          ...chrome(base),
          installed: [{ id: "old-eye", slot: "eyes", installedAt: 0 }],
        },
      },
    };
    const changed = await turn(old, { ...proposal, replace: "old-eye", disposition: "keep" }, [
      { ...command, replace: "old-eye", disposition: "sell" },
    ]);
    expect(changed.unsettled).toBeDefined();
    expect(cash(changed.world)).toBe(10000);
    expect(chrome(changed.world).installed[0]?.id).toBe("old-eye");
  });

  it("判断也不能把新手术倒填到本轮之前以跳过耗时", async () => {
    const done = await turn(initial(), { ...proposal, startAt: 900 }, [
      { ...command, startAt: 900 },
    ]);
    expect(done.unsettled).toBeDefined();
    expect(cash(done.world)).toBe(10000);
    expect(chrome(done.world).installed).toEqual([]);
  });

  it("预约、开工、完成贯穿判断与抽取，开工时只收一次钱", async () => {
    const booked = await turn(
      initial(),
      { ...proposal, serviceOrder: "appointment", serviceAction: "book", scheduledAt: 1000 },
      [
        {
          ...service("book"),
          request: { action: "install", doc: "doctor", id: "eye" },
          scheduledAt: 1000,
        },
      ],
    );
    expect(booked.unsettled).toBeUndefined();
    expect(cash(booked.world)).toBe(10000);
    const started = await turn(
      booked.world,
      { serviceOrder: "appointment", serviceAction: "start" },
      [{ type: "world", time: 1060, activity: "rest" }, service("start")],
    );
    expect(started.unsettled).toBeUndefined();
    expect(cash(started.world)).toBe(9000);
    expect(chrome(started.world).services.appointment?.endsAt).toBe(1060);
    const completed = await turn(
      started.world,
      { serviceOrder: "appointment", serviceAction: "complete" },
      // 首次完成与错误重复抽取保持独立，第二笔失败不撤销已经完成的真实手术。
      [service("complete"), service("complete")],
    );
    expect(completed.world.time).toBe(1060);
    expect(cash(completed.world)).toBe(9000);
    expect(chrome(completed.world).services.appointment?.status).toBe("completed");
    expect(chrome(completed.world).installed).toHaveLength(1);
    expect(completed.unsettled).toBeDefined();
  });

  it("仅询价时抽取不能擅自登记预约", async () => {
    const done = await turn(initial(), null, [
      { ...service("book"), request: { action: "install", doc: "doctor", id: "eye" } },
    ]);
    expect(done.unsettled).toBeDefined();
    expect(chrome(done.world).services).toEqual({});
    expect(cash(done.world)).toBe(10000);
  });
});
