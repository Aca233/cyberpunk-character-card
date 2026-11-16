import { describe, expect, it } from "vitest";
import type { LlmClient, LlmRequest } from "./kernel/ports";
import { seededRng } from "./kernel/rng";
import type { Command } from "./kernel/system";
import type { WorldState } from "./kernel/world";
import { offscreenDue, presentNpcs } from "./narrator/offscreen";
import { accelerationRequested } from "./narrator/stages";
import { runNarratorTurn } from "./narrator/turn";
import { InventoryStateSchema } from "./systems/inventory";
import { JobsStateSchema } from "./systems/jobs";
import { NpcSchema } from "./systems/npc";
import { registry } from "./systems/registry";
import { currentTension, tensionFacts } from "./systems/tension";

const ctx = { rng: seededRng(18) };
function start(): WorldState {
  const world = registry.initialWorld(1000);
  return {
    ...world,
    slices: {
      ...world.slices,
      world: {
        ...(world.slices.world as object),
        location: "warehouse",
        sceneStartedAt: 1000,
      },
    },
  };
}
function apply(world: WorldState, commands: Command[]): WorldState {
  const result = registry.applyCommands(world, commands, ctx);
  expect(result.results.map((entry) => entry.result.ok)).toEqual(commands.map(() => true));
  return result.world;
}
function at(world: WorldState, location: string): WorldState {
  return {
    ...world,
    slices: { ...world.slices, world: { ...(world.slices.world as object), location } },
  };
}

describe("持续世界的因果与时间", () => {
  it("交火不会凭空召来增援，缺少呼叫来源的指令整条拒绝", () => {
    const world = apply(start(), [{ type: "tension", exposure: "openConflict" }]);
    expect(currentTension(world).backupEtaMinutes).toBeNull();
    const invalid = registry.applyCommands(
      world,
      [{ type: "tension", triggerBackupInMinutes: 4 }],
      ctx,
    );
    expect(invalid.results[0]?.result.ok).toBe(false);
    expect(invalid.world).toEqual(world);
  });
  it("收场与离开不修复硬件，其他地点不继承这里的危局", () => {
    const world = apply(start(), [
      { type: "tension", exposure: "openConflict", disableChrome: "北门炮塔" },
    ]);
    const closed = registry.signal(world, "scene.end", ctx).world;
    expect(currentTension(closed).disabledEnemyChrome).toContain("北门炮塔");
    const away = at(closed, "apartment");
    expect(currentTension(away).exposure).toBe("hidden");
    expect(currentTension(away).disabledEnemyChrome).toEqual([]);
    expect(currentTension(at(away, "warehouse")).disabledEnemyChrome).toContain("北门炮塔");
  });
  it("离场后增援继续计时，到预计时间也不凭空断言已抵达", () => {
    const world = apply(start(), [
      {
        type: "tension",
        triggerBackupInMinutes: 4,
        backupCause: "守卫通过未被屏蔽的电台呼叫街口巡逻车，沿北路驶来",
      },
    ]);
    const later = registry.advanceTo(at(world, "apartment"), 1006, ctx).world;
    const site = currentTension(at(later, "warehouse"));
    expect(site.backupEtaMinutes).toBe(0);
    expect(site.backupArrived).toBe(false);
    expect(tensionFacts(site)).toContain("尚未确认到达");
    const cancelled = apply(at(later, "warehouse"), [
      { type: "tension", cancelBackupReason: "队长确认误报，巡逻车取消任务" },
    ]);
    expect(currentTension(cancelled).backupEtaMinutes).toBeNull();
  });
  it("移动指令先结算也把原地损坏留在行动起点，允许明确指定目的地", () => {
    const moved = at(start(), "apartment");
    const context = { ...ctx, facts: { actionStartLocation: "warehouse" } };
    const original = registry.applyCommands(
      moved,
      [{ type: "tension", disableChrome: "仓库摄像头" }],
      context,
    );
    expect(original.results[0]?.result.ok).toBe(true);
    expect(currentTension(original.world).disabledEnemyChrome).toEqual([]);
    expect(currentTension(at(original.world, "warehouse")).disabledEnemyChrome).toContain(
      "仓库摄像头",
    );
    const destination = registry.applyCommands(
      original.world,
      [{ type: "tension", location: "apartment", exposeWeakpoint: "门锁线路松脱" }],
      context,
    );
    expect(currentTension(destination.world).exposedWeakpoints).toContain("门锁线路松脱");
  });
  it("直接观察到的增援抵达也能保存并交给后续叙事", () => {
    const world = apply(start(), [
      {
        type: "tension",
        backupArrived: true,
        backupCause: "此前报警的巡逻车已沿北路抵达门口，车上警员下车",
      },
    ]);
    expect(tensionFacts(currentTension(world))).toContain("已确认增援到达");
  });
  it("待在同一场景也会因经过半天而推演，短时间不重复调用", () => {
    const world = start();
    const later = registry.advanceTo(world, 1720, ctx).world;
    expect(offscreenDue(world, later)).toBe(true);
    const ran = apply(later, [{ type: "city.ran", through: -1, backlog: false }]);
    expect(offscreenDue(ran, registry.advanceTo(ran, 1721, ctx).world)).toBe(false);
  });
  it("从第零分钟分段推进也累积世界时间", () => {
    const world = registry.initialWorld(0);
    const midway = registry.advanceTo(world, 360, ctx).world;
    expect(offscreenDue(world, midway)).toBe(false);
    expect(offscreenDue(midway, registry.advanceTo(midway, 720, ctx).world)).toBe(true);
  });
  it("换地点后眼前刚见到的人不会又被场外推演移动", () => {
    const before = start();
    const after = at(
      {
        ...before,
        slices: {
          ...before.slices,
          npc: {
            npcs: {
              host: NpcSchema.parse({
                id: "host",
                name: "屋主",
                pronoun: "她",
                role: "住户",
                look: "穿着便服",
                voice: "简短",
                want: "休息",
                limit: "不许打扰",
                affinity: 0,
                alive: true,
                met: true,
                location: "apartment",
                lastSeenAt: before.time,
                memories: [],
              }),
            },
          },
        },
      },
      "apartment",
    );
    expect(presentNpcs(before, after).has("host")).toBe(true);
  });
  it("主动等待可以越过期限，约定自然逾期且同一节点只触发一次推演", () => {
    const world = apply(start(), [
      {
        type: "jobOffer",
        id: "delivery",
        title: "送信",
        client: "邻居",
        risk: 1,
        reward: 200,
        conflict: "信件需要亲手送到",
        due: 1020,
      },
      { type: "jobAccept", id: "delivery" },
    ]);
    const later = apply(world, [{ type: "world", activity: "wait", time: 1300 }]);
    expect(later.time).toBe(1300);
    expect(JobsStateSchema.parse(later.slices.jobs).jobs[0]?.overdue).toBe(true);
    expect(offscreenDue(world, later)).toBe(true);
    const ran = apply(later, [{ type: "city.ran", through: -1, backlog: false }]);
    expect(offscreenDue(ran, registry.advanceTo(ran, 1301, ctx).world)).toBe(false);
  });
  it("完成约定只记录真实到款，不按风险档发声望与好感", () => {
    const world = apply(start(), [
      {
        type: "jobOffer",
        id: "delivery",
        title: "送信",
        client: "邻居",
        risk: 5,
        reward: 200,
        conflict: "信件需要亲手送到",
      },
      { type: "jobAccept", id: "delivery" },
    ]);
    const later = apply(world, [
      {
        type: "jobEnd",
        id: "delivery",
        outcome: "clean",
        paid: 0,
        summary: "信已送到，对方说明周五付款，当前尚未收款",
      },
    ]);
    expect(later.slices.economy).toEqual(world.slices.economy);
    expect(later.slices.character).toEqual(world.slices.character);
    expect(later.slices.npc).toEqual(world.slices.npc);
    expect(JobsStateSchema.parse(later.slices.jobs).jobs[0]?.settlement).toMatchObject({
      credHalves: 0,
      affinity: null,
    });
  });
});

describe("动态物件穿过完整叙事流程", () => {
  it("一次三步调用即可记下新工具，下次输入能读到同一物件定义与来源", async () => {
    const requests: LlmRequest[] = [];
    const run = async (world: WorldState, changes: Command[], text: string) => {
      const replies = [
        JSON.stringify({
          read: "你想取用这件工具",
          ooc: false,
          ruling: null,
          buy: null,
          recall: [],
          foes: null,
        }),
        text,
        JSON.stringify({ changes, choices: [], dropped: [], sceneEnd: false }),
      ];
      const llm: LlmClient = {
        async *stream(request) {
          requests.push(request);
          const reply = replies.shift();
          if (reply === undefined) throw new Error("出现了意外的额外调用");
          yield { type: "text", text: reply };
          yield { type: "done", finishReason: "stop" };
        },
      };
      const result = await runNarratorTurn(
        { llm, rng: ctx.rng, offscreen: null, data: { items: [] } },
        world,
        [],
        { kind: "action", input: { text } },
      );
      expect(result.kind).toBe("done");
      if (result.kind !== "done") throw new Error(result.kind);
      expect(result.turn.unsettled).toBeUndefined();
      expect(result.turn.repairs).toBe(0);
      expect(replies).toEqual([]);
      return result.turn.world;
    };
    const first = await run(
      start(),
      [
        {
          type: "item",
          action: "gain",
          id: "handmade-probe",
          definition: {
            id: "handmade-probe",
            name: "绕线探针",
            kind: "misc",
            ability: "接触测试旧门锁线路",
          },
          origin: "从仓库废弃门锁上拆下的铜线制作，归玩家所有",
          reason: "绕好铜线并收入工具包",
        },
      ],
      "我把绕好的探针收入包里。",
    );
    expect(InventoryStateSchema.parse(first.slices.inventory).backpack["handmade-probe"]).toBe(1);
    const saved = JSON.parse(JSON.stringify(first)) as WorldState;
    const second = await run(saved, [], "我查看包里的绕线探针。");
    expect(
      InventoryStateSchema.parse(second.slices.inventory).objects["handmade-probe"]?.holder,
    ).toBe("player");
    expect(requests).toHaveLength(6);
    const secondPrompt = requests[3]?.messages.map((message) => message.content).join("\n");
    expect(secondPrompt).toContain("handmade-probe");
    expect(secondPrompt).toContain("仓库废弃门锁");
  });
});

describe("主动加速设备的玩家意图", () => {
  it.each(["开斯安威斯坦冲过去", "启动远地点", "使用子弹时间", "借助神经超频躲开枪口"])(
    "明确使用：%s",
    (text) => {
      expect(accelerationRequested({ text })).toBe(true);
    },
  );
  it.each([
    "枪口顶着我的脑门，赶快冲过去",
    "不要开斯安威斯坦",
    "斯安威斯坦能开启吗",
    "如果开斯安威斯坦会怎样",
    "上次启动远地点后头很痛",
  ])("不能因危险、否定或提问自动启动：%s", (text) => {
    expect(accelerationRequested({ text })).toBe(false);
  });
});
