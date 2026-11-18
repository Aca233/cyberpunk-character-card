import { describe, expect, it } from "vitest";
import { newGameWorld } from "../../game";
import { fixedRng } from "../../kernel/rng";
import type { Command } from "../../kernel/system";
import type { WorldState } from "../../kernel/world";
import { EconomyStateSchema } from "../economy";
import { registry } from "../registry";
import { SafehouseStateSchema } from "../safehouse";
import { tradeInValue } from "./apply";
import { quoteCyberware } from "./quote";
import { CyberwareDefSchema, CyberwareStateSchema, RipperdocSchema } from "./schema";
import { quoteCyberwareService, type ServiceIntent } from "./service";
import { cyberwarePartsView } from "./view";
import { PartCommandSchema, ServiceCommandSchema } from "./workshop-schema";

const def = CyberwareDefSchema.parse({
  id: "field-eye",
  name: "现场义眼",
  slot: "eyes",
  rarity: "rare",
  price: 1000,
  humanityCost: 0,
  ability: "看见热源",
});

const data = { cyberware: [def], items: [], quickhacks: [], locations: [] };
const shopData = {
  ...data,
  cyberware: [def, CyberwareDefSchema.parse({ ...def, id: "old-eye", name: "旧义眼" })],
  ripperdocs: [
    RipperdocSchema.parse({
      id: "clinic-a",
      name: "诊所甲",
      location: "clinic",
      shelf: ["field-eye"],
      initialStock: { "field-eye": 1 },
      serviceMinutes: { install: 60, remove: 30, repair: 30 },
    }),
  ],
  locations: [
    { id: "clinic", name: "诊所", district: "沃森" },
    { id: "street", name: "街口", district: "沃森" },
    { id: "alias", name: "诊所图钉", district: "沃森" },
  ],
  merchantSites: [
    { merchant: "clinic-a", kind: "ripperdoc", locations: ["clinic", "alias"], source: "明确核对" },
  ],
};
const setup = (): WorldState => {
  const base = newGameWorld({ startTime: 1000 });
  return {
    ...base,
    slices: {
      ...base.slices,
      world: { ...(base.slices.world as object), location: "clinic" },
      economy: { eddies: 10000, settled: [] },
    },
  };
};
const ctx = (facts: Readonly<Record<string, unknown>> = {}) => ({
  data: shopData,
  rng: fixedRng([]),
  facts,
});
const state = (world: WorldState) => CyberwareStateSchema.parse(world.slices.cyberware);
function run(world: WorldState, command: Command, facts: Readonly<Record<string, unknown>> = {}) {
  const result = registry.applyCommands(world, [command], ctx(facts));
  expect(result.results[0]?.result).toMatchObject({ ok: true });
  return result.world;
}
function service(world: WorldState, intent: ServiceIntent) {
  const quote = quoteCyberwareService(world, shopData, intent);
  if (!quote.ok) throw new Error(quote.reason);
  return run(
    world,
    ServiceCommandSchema.parse({
      type: "cyberware.service",
      ...intent,
      reason: "已确认服务",
      evidence: "医生按约定办理",
    }),
    { tradeNarrative: "医生按约定办理", tradeQuote: quote.settlement },
  );
}
const surgery = { action: "install" as const, doc: "clinic-a", id: "field-eye" };

describe("持久义体库存与真实手术阶段", () => {
  it("不朽标签不把真实已持有义体的回收价强制归零", () => {
    expect(tradeInValue(CyberwareDefSchema.parse({ ...def, iconic: true }))).toBe(200);
  });
  it("买下实物和安装分开，售罄后重访及时间流逝不刷新；自带件只付手术部分", () => {
    let world = run(setup(), {
      type: "cyberware",
      action: "buy",
      doc: "clinic-a",
      id: "field-eye",
      reason: "先拿走不安装",
    });
    expect(world.time).toBe(1000);
    expect(state(world).installed).toEqual([]);
    expect(state(world).clinics["clinic-a"]?.stock["field-eye"]).toBe(0);
    const part = Object.values(state(world).parts)[0];
    expect(part?.holder).toBe("player");
    expect(cyberwarePartsView({ world, data: shopData, records: [] })[0]?.model).toBe("field-eye");
    expect(EconomyStateSchema.parse(world.slices.economy).eddies).toBe(9200);
    world = registry.advanceTo(world, 1000 + 10 * 1440, ctx()).world;
    world = registry.signal(world, "world.arrived", ctx()).world;
    expect(state(world).clinics["clinic-a"]?.stock["field-eye"]).toBe(0);
    expect(quoteCyberware(world, shopData, surgery).ok).toBe(false);
    const before = world.time;
    world = run(world, { type: "cyberware", ...surgery, part: part?.id, reason: "自带件安装" });
    expect(world.time).toBe(before + 60);
    expect(EconomyStateSchema.parse(world.slices.economy).eddies).toBe(9000);
    expect(state(world).parts[part?.id ?? ""]?.holder).toBe("installed");
  });

  it("明确保留旧件会留下实物，明确报废才废弃，缺少处置不移除旧件", () => {
    const base = setup();
    const world: WorldState = {
      ...base,
      slices: {
        ...base.slices,
        cyberware: { ...state(base), installed: [{ id: "old-eye", slot: "eyes", installedAt: 0 }] },
      },
    };
    const rejected = registry.applyCommands(
      world,
      [{ type: "cyberware", ...surgery, replace: "old-eye", reason: "没决定旧件去向" }],
      ctx(),
    );
    expect(rejected.world).toEqual(world);
    const kept = run(world, {
      type: "cyberware",
      ...surgery,
      replace: "old-eye",
      disposition: "keep",
      reason: "保留旧件",
    });
    expect(Object.values(state(kept).parts).find((p) => p.model === "old-eye")?.holder).toBe(
      "player",
    );
    const scrapped = run(world, {
      type: "cyberware",
      ...surgery,
      replace: "old-eye",
      disposition: "scrap",
      reason: "授权报废",
    });
    expect(Object.values(state(scrapped).parts).find((p) => p.model === "old-eye")).toMatchObject({
      holder: "scrapped",
      condition: "scrapped",
    });
  });

  it("预约不付款，开始接收实物并扣款，完成只用原定终点且不能重复", () => {
    let world = service(setup(), {
      action: "book",
      id: "appt-1",
      request: surgery,
      scheduledAt: 1020,
    });
    expect(EconomyStateSchema.parse(world.slices.economy).eddies).toBe(10000);
    expect(state(world).parts).toEqual({});
    expect(quoteCyberwareService(world, shopData, { action: "start", id: "appt-1" }).ok).toBe(
      false,
    );
    expect(
      quoteCyberwareService(world, shopData, {
        action: "book",
        id: "appt-2",
        request: surgery,
        scheduledAt: 1025,
      }).ok,
    ).toBe(false);
    world = registry.advanceTo(world, 1020, ctx()).world;
    world = service(world, { action: "start", id: "appt-1" });
    expect(state(world).installed).toEqual([]);
    expect(EconomyStateSchema.parse(world.slices.economy).eddies).toBe(9000);
    expect(Object.values(state(world).parts)[0]?.holder).toBe("service:appt-1");
    const loaded: WorldState = JSON.parse(JSON.stringify(world));
    world = registry.advanceTo(loaded, 1080, ctx()).world;
    world = service(world, { action: "complete", id: "appt-1" });
    expect(world.time).toBe(1080);
    expect(state(world).installed[0]?.installedAt).toBe(1080);
    expect(EconomyStateSchema.parse(world.slices.economy).eddies).toBe(9000);
    expect(quoteCyberwareService(world, shopData, { action: "complete", id: "appt-1" }).ok).toBe(
      false,
    );
  });

  it("询价无法凭抽取预约或开工；取消已开工订单不退款、不复原拆下旧件", () => {
    const base = setup();
    const before: WorldState = {
      ...base,
      slices: {
        ...base.slices,
        cyberware: { ...state(base), installed: [{ id: "old-eye", slot: "eyes", installedAt: 0 }] },
      },
    };
    const book = {
      type: "cyberware.service",
      action: "book",
      id: "appt-1",
      request: { ...surgery, replace: "old-eye", disposition: "keep" },
      reason: "预约",
      evidence: "医生按约定办理",
    };
    expect(
      registry.applyCommands(before, [book], ctx({ tradeNarrative: "医生按约定办理" })).world,
    ).toEqual(before);
    let world = service(before, {
      action: "book",
      id: "appt-1",
      request: { ...surgery, replace: "old-eye", disposition: "keep" },
    });
    world = service(world, { action: "start", id: "appt-1" });
    expect(state(world).installed).toEqual([]);
    const paid = world.slices.economy;
    world = service(world, { action: "cancel", id: "appt-1" });
    expect(world.slices.economy).toEqual(paid);
    expect(state(world).installed).toEqual([]);
    expect(Object.values(state(world).parts).every((p) => p.holder === "service:appt-1")).toBe(
      true,
    );
    const part = Object.values(state(world).parts)[0];
    world = run(
      world,
      {
        type: "cyberware.part",
        action: "transfer",
        part: part?.id,
        from: "service:appt-1",
        holder: "player",
        source: "诊所交回寄存实物",
        evidence: "医生交回寄存件",
      },
      { tradeNarrative: "医生交回寄存件" },
    );
    expect(state(world).parts[part?.id ?? ""]?.holder).toBe("player");
  });

  it("中断暂停剩余时间，再继续不会重复收款或把暂停时段当完成", () => {
    let world = service(setup(), { action: "book", id: "appt-1", request: surgery });
    world = service(world, { action: "start", id: "appt-1" });
    world = registry.advanceTo(world, 1020, ctx()).world;
    world = run(
      world,
      {
        type: "cyberware.service",
        action: "interrupt",
        id: "appt-1",
        reason: "真实停电",
        evidence: "灯灭了",
      },
      { tradeNarrative: "灯灭了" },
    );
    expect(state(world).services["appt-1"]?.remaining).toBe(40);
    world = registry.advanceTo(world, 2000, ctx()).world;
    world = service(world, { action: "resume", id: "appt-1" });
    world = service(world, { action: "complete", id: "appt-1" });
    expect(world.time).toBe(2040);
    expect(EconomyStateSchema.parse(world.slices.economy).eddies).toBe(9000);
  });

  it("正文先推进到结束再抽取开始服务时，绑定原开始时间，不再累加一小时", () => {
    let world = service(setup(), { action: "book", id: "appt-1", request: surgery });
    const quote = quoteCyberwareService(world, shopData, {
      action: "start",
      id: "appt-1",
      startAt: 1000,
    });
    if (!quote.ok) throw new Error(quote.reason);
    world = registry.advanceTo(world, 1060, ctx()).world;
    world = run(
      world,
      {
        type: "cyberware.service",
        action: "start",
        id: "appt-1",
        startAt: 1000,
        reason: "按原时段手术",
        evidence: "医生按约定办理",
      },
      { tradeNarrative: "医生按约定办理", tradeQuote: quote.settlement },
    );
    world = service(world, { action: "complete", id: "appt-1" });
    expect(world.time).toBe(1060);
    expect(state(world).installed[0]?.installedAt).toBe(1060);
    expect(EconomyStateSchema.parse(world.slices.economy).eddies).toBe(9000);
  });

  it("真实取走诊所库存须扣同一现货，不生成第二件目录实物", () => {
    let world = run(
      setup(),
      {
        type: "cyberware.part",
        action: "takeStock",
        part: "stolen-eye",
        model: "field-eye",
        from: "clinic-a",
        holder: "player",
        source: "从诊所货柜实际拿走",
        evidence: "你拿走货柜里的义眼",
      },
      { tradeNarrative: "你拿走货柜里的义眼" },
    );
    expect(state(world).clinics["clinic-a"]?.stock["field-eye"]).toBe(0);
    expect(quoteCyberware(world, shopData, surgery).ok).toBe(false);
    world = registry.signal(world, "world.arrived", ctx()).world;
    expect(Object.values(state(world).parts).filter((p) => p.model === "field-eye")).toHaveLength(
      1,
    );
    expect(state(world).clinics["clinic-a"]?.stock["field-eye"]).toBe(0);
  });

  it("已核对的地图入口共用库存，留置与取回义体保持唯一实物身份", () => {
    let world = run(setup(), {
      type: "cyberware",
      action: "buy",
      doc: "clinic-a",
      id: "field-eye",
      reason: "买下",
    });
    const part = Object.values(state(world).parts)[0];
    world = run(world, {
      type: "cyberware.place",
      action: "leave",
      part: part?.id,
      holder: "home:locker",
      location: "clinic",
    });
    expect(state(world).parts[part?.id ?? ""]?.holder).toBe("home:locker");
    world = run(world, {
      type: "cyberware.place",
      action: "take",
      part: part?.id,
      holder: "home:locker",
      location: "clinic",
    });
    expect(state(world).parts[part?.id ?? ""]?.holder).toBe("player");
    const alias: WorldState = {
      ...world,
      slices: { ...world.slices, world: { ...(world.slices.world as object), location: "alias" } },
    };
    expect(quoteCyberware(alias, shopData, surgery).ok).toBe(false);
    expect(Object.keys(state(alias).parts)).toEqual([part?.id]);
  });

  it("留置在别处的义体不能绕过 itemPlace 转交", () => {
    let world = run(setup(), {
      type: "cyberware",
      action: "buy",
      doc: "clinic-a",
      id: "field-eye",
      reason: "买下实物",
    });
    const part = Object.values(state(world).parts)[0]?.id;
    world = run(world, { type: "safehouse.seed", id: "locker", name: "住处", location: "clinic" });
    world = run(world, {
      type: "itemPlace",
      action: "leave",
      item: part,
      where: "locker",
      reason: "留在家里",
    });
    const transfer = registry.applyCommands(
      world,
      [
        {
          type: "cyberware.part",
          action: "transfer",
          part,
          from: "home:locker",
          holder: "player",
          source: "取出义眼",
          evidence: "你从家里拿回义眼",
        },
      ],
      ctx({ tradeNarrative: "你从家里拿回义眼" }),
    );
    expect(transfer.results[0]?.result.ok).toBe(false);
    expect(transfer.world).toEqual(world);
    world = run(world, {
      type: "itemPlace",
      action: "take",
      item: part,
      where: "locker",
      reason: "取回",
    });
    expect(state(world).parts[part ?? ""]?.holder).toBe("player");
    expect(SafehouseStateSchema.parse(world.slices.safehouse).homes).toHaveLength(1);
  });

  it.each(["record", "takeStock", "transfer"])("%s 不能伪造未登记的住处或车辆归属", (action) => {
    let world = setup();
    if (action === "transfer")
      world = run(
        world,
        {
          type: "cyberware.part",
          action: "record",
          part: "loose-eye",
          model: "field-eye",
          holder: "player",
          source: "交付实物",
          evidence: "你拿到了义眼",
        },
        { tradeNarrative: "你拿到了义眼" },
      );
    const result = registry.applyCommands(
      world,
      [
        {
          type: "cyberware.part",
          action,
          part: "loose-eye",
          model: "field-eye",
          from: action === "takeStock" ? "clinic-a" : "player",
          holder: "home:missing",
          source: "留置义眼",
          evidence: "你放下了义眼",
        },
      ],
      ctx({ tradeNarrative: "你放下了义眼" }),
    );
    expect(result.results[0]?.result.ok).toBe(false);
    expect(result.world).toEqual(world);
  });

  it("首次展开后诊所身份与服务设置存入世界，改初始表再载入不替换它", () => {
    const world = registry.signal(setup(), "world.arrived", ctx()).world;
    const loaded: WorldState = JSON.parse(JSON.stringify(world));
    const changed = {
      ...shopData,
      ripperdocs: [
        RipperdocSchema.parse({
          ...shopData.ripperdocs[0],
          name: "被改名",
          location: "street",
          priceFactor: 2,
          serviceMinutes: { install: 120, remove: 60, repair: 60 },
          initialStock: { "field-eye": 99 },
        }),
      ],
    };
    const quote = quoteCyberware(loaded, changed, surgery);
    expect(quote).toMatchObject({
      ok: true,
      quote: { docName: "诊所甲", total: 1000, startsAt: 1000, endsAt: 1060 },
    });
    const after = registry.signal(loaded, "world.arrived", { ...ctx(), data: changed }).world;
    expect(state(after).clinics["clinic-a"]?.definition.location).toBe("clinic");
    expect(state(after).clinics["clinic-a"]?.stock["field-eye"]).toBe(1);
  });

  it("医生信用额度支持多笔欠款，未约期限不凭空生成七天截止", () => {
    const base = setup();
    const creditData = {
      ...shopData,
      ripperdocs: [
        RipperdocSchema.parse({
          ...shopData.ripperdocs[0],
          credit: 3000,
          initialStock: { "field-eye": 2 },
        }),
      ],
    };
    let world: WorldState = {
      ...base,
      slices: { ...base.slices, economy: { eddies: 0, settled: [] } },
    };
    const command = {
      type: "cyberware",
      action: "buy",
      doc: "clinic-a",
      id: "field-eye",
      credit: true,
      reason: "接受两笔赊购",
    };
    for (let i = 0; i < 2; i += 1) {
      const result = registry.applyCommands(world, [command], { ...ctx(), data: creditData });
      expect(result.results[0]?.result.ok).toBe(true);
      world = result.world;
    }
    expect(state(world).debts).toHaveLength(2);
    expect(state(world).debts.every((d) => d.due === null && d.deadline === null)).toBe(true);
    expect(state(world).debts.reduce((sum, d) => sum + d.amount, 0)).toBe(1600);
    world = { ...world, slices: { ...world.slices, economy: { eddies: 2000, settled: [] } } };
    const paid = registry.applyCommands(
      world,
      [{ type: "cyberware", action: "repay", doc: "clinic-a", reason: "一并还清" }],
      { ...ctx(), data: creditData },
    );
    expect(paid.results[0]?.result.ok).toBe(true);
    expect(state(paid.world).debts).toEqual([]);
    expect(EconomyStateSchema.parse(paid.world.slices.economy).eddies).toBe(400);
  });
});

describe("义体供货按事实与游戏时间推进", () => {
  it("封路暂停，解封后继续剩余运输，真实到货只发生一次", () => {
    let world = run(
      setup(),
      {
        type: "cyberware.supply",
        action: "order",
        id: "delivery-1",
        doc: "clinic-a",
        source: "义体批发商",
        stock: { "field-eye": 2 },
        route: ["street", "clinic"],
        due: 1100,
        evidence: "供货商确认送来两件",
      },
      { tradeNarrative: "供货商确认送来两件" },
    );
    world = registry.advanceTo(world, 1020, ctx()).world;
    world = run(
      world,
      {
        type: "logistics.route",
        location: "street",
        blocked: true,
        reason: "封路",
        evidence: "街口封路",
      },
      { tradeNarrative: "街口封路" },
    );
    world = registry.advanceTo(world, 2000, ctx()).world;
    expect(state(world).clinics["clinic-a"]?.stock["field-eye"]).toBe(1);
    world = run(
      world,
      {
        type: "logistics.route",
        location: "street",
        blocked: false,
        reason: "放行",
        evidence: "街口放行",
      },
      { tradeNarrative: "街口放行" },
    );
    expect(state(world).supplies["delivery-1"]?.due).toBe(2080);
    world = registry.advanceTo(world, 2080, ctx()).world;
    expect(state(world).clinics["clinic-a"]?.stock["field-eye"]).toBe(3);
    world = registry.advanceTo(JSON.parse(JSON.stringify(world)), 10000, ctx()).world;
    expect(state(world).clinics["clinic-a"]?.stock["field-eye"]).toBe(3);
    expect(state(world).supplies["delivery-1"]?.status).toBe("arrived");
  });

  it("路线可经过未访问地图图钉，但终点必须对应真正收货诊所", () => {
    const poiData = {
      ...shopData,
      mapAreas: { districts: [], centers: {} },
      servicePoints: [
        { id: "road-1", name: "未访问街口", kind: "food", district: null, sub: null, x: 10, y: 10 },
      ],
    };
    const order = {
      type: "cyberware.supply",
      action: "order",
      id: "poi-order",
      doc: "clinic-a",
      source: "批发商",
      stock: { "field-eye": 1 },
      route: ["poi:road-1", "clinic"],
      due: 1100,
      evidence: "已发货到诊所",
    };
    const okay = registry.applyCommands(setup(), [order], {
      ...ctx({ tradeNarrative: "已发货到诊所" }),
      data: poiData,
    });
    expect(okay.results[0]?.result.ok).toBe(true);
    const wrong = registry.applyCommands(setup(), [{ ...order, route: ["clinic", "poi:road-1"] }], {
      ...ctx({ tradeNarrative: "已发货到诊所" }),
      data: poiData,
    });
    expect(wrong.results[0]?.result.ok).toBe(false);
    expect(state(wrong.world).supplies).toEqual({});
  });
});

const context = (facts: Readonly<Record<string, unknown>>) => ({ rng: fixedRng([]), data, facts });

describe("义体沙盘实物登记", () => {
  it("取得自带义体必须有独立来源，转交只改变持有人，不凭目录生成安装", () => {
    const before = newGameWorld({ startTime: 1000 });
    const record = PartCommandSchema.parse({
      type: "cyberware.part",
      action: "record",
      part: "found-eye-1",
      model: "field-eye",
      holder: "player",
      source: "从废弃手术台找到",
      evidence: "从废弃手术台找到",
    });
    const first = registry.applyCommands(
      before,
      [record],
      context({ tradeNarrative: "从废弃手术台找到" }),
    );
    expect(first.results[0]?.result.ok).toBe(true);
    expect(
      CyberwareStateSchema.parse(first.world.slices.cyberware).parts["found-eye-1"],
    ).toMatchObject({
      model: "field-eye",
      holder: "player",
      source: "从废弃手术台找到",
    });
    const transfer = PartCommandSchema.parse({
      type: "cyberware.part",
      action: "transfer",
      part: "found-eye-1",
      from: "player",
      holder: "clinic-a",
      source: "交给诊所保管",
      evidence: "交给诊所保管",
    });
    const second = registry.applyCommands(
      first.world,
      [transfer],
      context({ tradeNarrative: "交给诊所保管" }),
    );
    expect(second.results[0]?.result.ok).toBe(true);
    expect(
      CyberwareStateSchema.parse(second.world.slices.cyberware).parts["found-eye-1"]?.holder,
    ).toBe("clinic-a");
  });

  it("没有正文来源或重复实物时拒绝，失败不改状态", () => {
    const before = newGameWorld({ startTime: 1000 });
    const command = PartCommandSchema.parse({
      type: "cyberware.part",
      action: "record",
      part: "fake-eye-1",
      model: "field-eye",
      holder: "player",
      source: "目录上有",
      evidence: "目录上有",
    });
    expect(
      registry.applyCommands(before, [command], context({ tradeNarrative: "只是目录信息" }))
        .results[0]?.result.ok,
    ).toBe(false);
    const actual = registry.applyCommands(
      before,
      [command],
      context({ tradeNarrative: "目录上有" }),
    );
    expect(actual.results[0]?.result.ok).toBe(true);
    const duplicate = registry.applyCommands(
      actual.world,
      [command],
      context({ tradeNarrative: "目录上有" }),
    );
    expect(duplicate.results[0]?.result.ok).toBe(false);
    expect(duplicate.world).toEqual(actual.world);
  });
});
