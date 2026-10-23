import { applyPatches } from "immer";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { fixedRng } from "./rng";
import { type AnySystem, createRegistry, defineSystem, RegistryError } from "./system";

const ctx = { rng: fixedRng([]) };

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

const counter = defineSystem<{ value: number }, CounterCommand>({
  id: "counter",
  state: z.object({ value: z.number() }),
  initial: () => ({ value: 0 }),
  commands: {
    "counter.add": z.object({ type: z.literal("counter.add"), amount: z.number().int() }),
  },
  apply(draft, command) {
    draft.value += command.amount;
    return draft.value < 0 ? { ok: false, reason: "计数不能小于 0" } : { ok: true };
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

  it("拒绝两个系统注册同一种指令", () => {
    expect(() => createRegistry([stub("a", [], ["x.do"]), stub("b", [], ["x.do"])])).toThrow(
      /x\.do/,
    );
  });

  it("初始世界包含每个系统的初始状态", () => {
    const registry = createRegistry([counter, stub("a")]);
    expect(registry.initialWorld()).toEqual({ slices: { counter: { value: 0 }, a: null } });
  });
});

describe("parseCommand", () => {
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
    expect(registry.parseCommand({ type: "counter.reset" })).toEqual({
      ok: false,
      error: "未知的指令类型：counter.reset",
    });
    expect(registry.parseCommand({ type: "counter.add", amount: 1.5 }).ok).toBe(false);
  });
});

describe("applyCommands", () => {
  const registry = createRegistry([counter]);

  it("结算失败的指令整体不生效，其余照常", () => {
    const world = registry.initialWorld();
    const commands: CounterCommand[] = [
      { type: "counter.add", amount: 2 },
      { type: "counter.add", amount: -5 },
      { type: "counter.add", amount: 3 },
    ];
    const { world: next, patches, results } = registry.applyCommands(world, commands, ctx);
    expect(next.slices).toEqual({ counter: { value: 5 } });
    expect(results.map((r) => r.outcome.ok)).toEqual([true, false, true]);
    expect(world.slices).toEqual({ counter: { value: 0 } });
    expect(applyPatches(world, [...patches])).toEqual(next);
  });

  it("未知指令记为失败，不抛错", () => {
    const { results } = registry.applyCommands(registry.initialWorld(), [{ type: "ghost" }], ctx);
    expect(results[0]?.outcome).toEqual({ ok: false, reason: "未知的指令类型：ghost" });
  });
});
