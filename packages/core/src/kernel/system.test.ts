import { applyPatches } from "immer";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { fixedRng } from "./rng";
import { type AnySystem, createRegistry, defineSystem, RegistryError } from "./system";

const ctx = { rng: fixedRng([]) };
const T0 = 1000;

function stub(
  id: string,
  dependsOn: readonly string[] = [],
  types: readonly string[] = [],
): AnySystem {
  return {
    id,
    dependsOn,
    state: z.null(),
    initial: () => null,
    commands: Object.fromEntries(types.map((type) => [type, z.object({ type: z.literal(type) })])),
    apply: () => ({ ok: true }),
  };
}

type CounterCommand = { readonly type: "counter.add"; readonly amount: number };
type CounterInternal = { readonly type: "counter.reset" };

const counter = defineSystem<{ value: number; ticks: number }, CounterCommand, CounterInternal>({
  id: "counter",
  state: z.object({ value: z.number(), ticks: z.number() }),
  initial: () => ({ value: 0, ticks: 0 }),
  commands: {
    "counter.add": z.object({ type: z.literal("counter.add"), amount: z.number().int() }),
  },
  internal: { "counter.reset": z.object({ type: z.literal("counter.reset") }) },
  apply(draft, command) {
    if (command.type === "counter.reset") {
      draft.value = 0;
      return { ok: true };
    }
    draft.value += command.amount;
    return draft.value < 0 ? { ok: false, reason: "计数不能小于 0" } : { ok: true };
  },
  on: {
    ping(draft) {
      draft.value += 100;
    },
  },
  tick(draft, span) {
    draft.ticks += span.to - span.from;
  },
});

type MirrorCommand =
  | { readonly type: "mirror.copy" }
  | { readonly type: "mirror.bump"; readonly by: number };

/** 依赖 counter：读取它的值，并通过它的指令改它 */
const mirror = defineSystem<{ seen: number }, MirrorCommand>({
  id: "mirror",
  dependsOn: ["counter"],
  state: z.object({ seen: z.number() }),
  initial: () => ({ seen: 0 }),
  commands: {
    "mirror.copy": z.object({ type: z.literal("mirror.copy") }),
    "mirror.bump": z.object({ type: z.literal("mirror.bump"), by: z.number().int() }),
  },
  apply(draft, command, ctx) {
    if (command.type === "mirror.copy") {
      draft.seen = ctx.read<{ value: number }>("counter").value;
      return { ok: true, notes: ["已复制"], advanceTo: ctx.now + 5, signals: ["ping"] };
    }
    draft.seen += 1;
    return { ok: true, emit: [{ type: "counter.add", amount: command.by }] };
  },
});

/** 没声明依赖却去读别人的状态 */
const intruder = defineSystem<null, { readonly type: "intruder.peek" }>({
  id: "intruder",
  state: z.null(),
  initial: () => null,
  commands: { "intruder.peek": z.object({ type: z.literal("intruder.peek") }) },
  apply(_draft, _command, ctx) {
    ctx.read("counter");
    return { ok: true };
  },
});

describe("createRegistry", () => {
  it("按 dependsOn 排序，被依赖的在前", () => {
    const registry = createRegistry([stub("c", ["b"]), stub("a"), stub("b", ["a"])]);
    expect(registry.order.map((s) => s.id)).toEqual(["a", "b", "c"]);
  });

  it("拒绝循环依赖并指出环", () => {
    expect(() => createRegistry([stub("a", ["b"]), stub("b", ["a"])])).toThrow(/a → b → a/);
  });

  it("拒绝缺失的依赖", () => {
    expect(() => createRegistry([stub("a", ["ghost"])])).toThrow(RegistryError);
  });

  it("拒绝重复的系统 id", () => {
    expect(() => createRegistry([stub("a"), stub("a")])).toThrow(/系统 id 重复/);
  });

  it("拒绝两个系统注册同一种指令，内部指令也算", () => {
    expect(() => createRegistry([stub("a", [], ["x.do"]), stub("b", [], ["x.do"])])).toThrow(
      /x\.do/,
    );
    expect(() => createRegistry([counter, stub("b", [], ["counter.reset"])])).toThrow(
      /counter\.reset/,
    );
  });

  it("一个系统可以交多个投影；投影字段重名时拒绝，同一系统里重名也算", () => {
    const viewer = (id: string, keys: readonly string[]): AnySystem => ({
      ...stub(id),
      view: { key: keys[0] ?? id, project: () => `${id}:${keys[0]}` },
      views: keys.slice(1).map((key) => ({ key, project: () => `${id}:${key}` })),
    });
    const registry = createRegistry([viewer("a", ["one", "two", "three"])]);
    const world = registry.initialWorld(T0);
    expect(registry.viewKeys).toEqual(["one", "two", "three"]);
    expect(registry.project({ world, records: [], data: {} })).toEqual({
      one: "a:one",
      two: "a:two",
      three: "a:three",
    });
    expect(() => createRegistry([viewer("a", ["one", "one"])])).toThrow(/one/);
    expect(() => createRegistry([viewer("a", ["one"]), viewer("b", ["two", "one"])])).toThrow(
      /one 同时由 a 和 b/,
    );
  });

  it("初始世界包含时间和每个系统的初始状态", () => {
    const registry = createRegistry([counter, stub("a")]);
    expect(registry.initialWorld(T0)).toEqual({
      time: T0,
      slices: { counter: { value: 0, ticks: 0 }, a: null },
    });
  });
});

describe("parseCommand / parseInternal", () => {
  const registry = createRegistry([counter]);

  it("接受合法指令", () => {
    expect(registry.parseCommand({ type: "counter.add", amount: 2 })).toEqual({
      ok: true,
      command: { type: "counter.add", amount: 2 },
    });
  });

  it("拒绝缺少 type、未知类型和字段不合法的指令", () => {
    expect(registry.parseCommand({ amount: 2 }).ok).toBe(false);
    expect(registry.parseCommand(null).ok).toBe(false);
    expect(registry.parseCommand({ type: "counter.zero" })).toEqual({
      ok: false,
      error: "未知的指令类型：counter.zero",
    });
    expect(registry.parseCommand({ type: "counter.add", amount: 1.5 }).ok).toBe(false);
  });

  it("模型不能使用内部指令，代码可以", () => {
    expect(registry.commandTypes()).toEqual(["counter.add"]);
    expect(registry.parseCommand({ type: "counter.reset" }).ok).toBe(false);
    expect(registry.parseInternal({ type: "counter.reset" }).ok).toBe(true);
  });
});

describe("applyCommands", () => {
  const registry = createRegistry([counter, mirror]);
  const world = registry.initialWorld(T0);
  const value = (w: typeof world) => (w.slices.counter as { value: number }).value;

  it("结算失败的指令整体不生效，其余照常；补丁能重现结果", () => {
    const commands: CounterCommand[] = [
      { type: "counter.add", amount: 2 },
      { type: "counter.add", amount: -5 },
      { type: "counter.add", amount: 3 },
    ];
    const { world: next, patches, results } = registry.applyCommands(world, commands, ctx);
    expect(value(next)).toBe(5);
    expect(results.map((r) => r.result.ok)).toEqual([true, false, true]);
    expect(results[1]?.result).toEqual({ ok: false, reason: "计数不能小于 0" });
    expect(value(world)).toBe(0);
    expect(applyPatches(world, [...patches])).toEqual(next);
  });

  it("未知指令和格式不对的指令记为失败，不抛错", () => {
    const { results } = registry.applyCommands(
      world,
      [{ type: "ghost" }, { type: "counter.add" }],
      ctx,
    );
    expect(results[0]?.result).toEqual({ ok: false, reason: "未知的指令类型：ghost" });
    expect(results[1]?.result.ok).toBe(false);
  });

  it("读取依赖、推进时间、广播信号，都算进同一条指令", () => {
    const start = registry.applyCommands(world, [{ type: "counter.add", amount: 7 }], ctx).world;
    const {
      world: next,
      patches,
      results,
    } = registry.applyCommands(start, [{ type: "mirror.copy" }], ctx);
    expect(results[0]?.result).toEqual({ ok: true, notes: ["已复制"] });
    expect(next.slices.mirror).toEqual({ seen: 7 });
    expect(next.time).toBe(T0 + 5);
    expect(next.slices.counter).toEqual({ value: 107, ticks: 5 });
    expect(applyPatches(start, [...patches])).toEqual(next);
  });

  it("连锁指令失败时，发起的那条也整体丢弃", () => {
    const { world: next, results } = registry.applyCommands(
      world,
      [{ type: "mirror.bump", by: -1 }],
      ctx,
    );
    expect(results[0]?.result).toEqual({ ok: false, reason: "计数不能小于 0" });
    expect(next).toBe(world);
  });

  it("连锁指令成功时，两个系统一起生效", () => {
    const { world: next } = registry.applyCommands(world, [{ type: "mirror.bump", by: 4 }], ctx);
    expect(next.slices.mirror).toEqual({ seen: 1 });
    expect(value(next)).toBe(4);
  });

  it("没声明依赖就读取别人的状态，直接报错", () => {
    const bad = createRegistry([counter, intruder]);
    expect(() => bad.applyCommands(bad.initialWorld(T0), [{ type: "intruder.peek" }], ctx)).toThrow(
      /没有声明依赖 counter/,
    );
  });
});

describe("signal / advanceTo", () => {
  const registry = createRegistry([counter]);
  const world = registry.initialWorld(T0);

  it("信号只交给订阅了它的系统", () => {
    expect(registry.signal(world, "ping", ctx).world.slices.counter).toEqual({
      value: 100,
      ticks: 0,
    });
    expect(registry.signal(world, "nobody", ctx).world).toEqual(world);
  });

  it("推进时间时运行 tick，倒退时报错", () => {
    const { world: next } = registry.advanceTo(world, T0 + 30, ctx);
    expect(next.time).toBe(T0 + 30);
    expect(next.slices.counter).toEqual({ value: 0, ticks: 30 });
    expect(() => registry.advanceTo(next, T0, ctx)).toThrow(/不能倒退/);
    expect(registry.advanceTo(next, T0 + 30, ctx).world).toBe(next);
  });
});
