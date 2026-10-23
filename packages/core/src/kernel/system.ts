import { type Draft, enablePatches, type Patch, produceWithPatches } from "immer";
import type { z } from "zod";
import type { Rng } from "./ports";
import type { WorldState } from "./world";

enablePatches();

export interface Command {
  readonly type: string;
}

export type ApplyOutcome = { readonly ok: true } | { readonly ok: false; readonly reason: string };

export interface ApplyContext {
  readonly rng: Rng;
}

export interface SystemDef<S, C extends Command> {
  readonly id: string;
  /** 允许调用的其他系统；同时决定结算顺序 */
  readonly dependsOn?: readonly string[];
  readonly state: z.ZodType<S>;
  initial(): S;
  /** 这个系统负责的指令，键必须等于指令的 type */
  readonly commands: { readonly [K in C["type"]]: z.ZodType<Extract<C, { type: K }>> };
  /** 在草稿上结算一条指令；返回 ok: false 时这条指令整体不生效 */
  apply(draft: Draft<S>, command: C, ctx: ApplyContext): ApplyOutcome;
}

// biome-ignore lint/suspicious/noExplicitAny: 注册表要存放状态和指令类型各不相同的系统
export type AnySystem = SystemDef<any, any>;

export function defineSystem<S, C extends Command>(def: SystemDef<S, C>): SystemDef<S, C> {
  return def;
}

export class RegistryError extends Error {
  override name = "RegistryError";
}

export type ParseResult =
  | { readonly ok: true; readonly command: Command }
  | { readonly ok: false; readonly error: string };

export interface AppliedCommand {
  readonly command: Command;
  readonly outcome: ApplyOutcome;
}

export interface ApplyBatchResult {
  readonly world: WorldState;
  readonly patches: readonly Patch[];
  readonly results: readonly AppliedCommand[];
}

export interface Registry {
  /** 按 dependsOn 拓扑排序后的系统，被依赖的在前 */
  readonly order: readonly AnySystem[];
  initialWorld(): WorldState;
  commandTypes(): readonly string[];
  parseCommand(raw: unknown): ParseResult;
  applyCommands(
    world: WorldState,
    commands: readonly Command[],
    ctx: ApplyContext,
  ): ApplyBatchResult;
}

export function createRegistry(systems: readonly AnySystem[]): Registry {
  const order = sortByDependencies(systems);
  const owners = new Map<string, AnySystem>();
  for (const system of order) {
    for (const type of Object.keys(system.commands)) {
      const existing = owners.get(type);
      if (existing) {
        throw new RegistryError(`指令类型 ${type} 同时由 ${existing.id} 和 ${system.id} 注册`);
      }
      owners.set(type, system);
    }
  }

  return {
    order,
    initialWorld() {
      const slices: Record<string, unknown> = {};
      for (const system of order) slices[system.id] = system.initial();
      return { slices };
    },
    commandTypes: () => [...owners.keys()],
    parseCommand(raw) {
      const type =
        typeof raw === "object" && raw !== null ? (raw as { type?: unknown }).type : undefined;
      if (typeof type !== "string") return { ok: false, error: "指令缺少 type 字段" };
      const system = owners.get(type);
      if (!system) return { ok: false, error: `未知的指令类型：${type}` };
      const parsed = (system.commands[type] as z.ZodType<Command>).safeParse(raw);
      return parsed.success
        ? { ok: true, command: parsed.data }
        : { ok: false, error: parsed.error.message };
    },
    applyCommands(world, commands, ctx) {
      let current = world;
      const patches: Patch[] = [];
      const results: AppliedCommand[] = [];
      for (const command of commands) {
        const system = owners.get(command.type);
        if (!system) {
          results.push({
            command,
            outcome: { ok: false, reason: `未知的指令类型：${command.type}` },
          });
          continue;
        }
        let outcome = { ok: true } as ApplyOutcome;
        const [next, commandPatches] = produceWithPatches(current, (draft) => {
          outcome = system.apply(draft.slices[system.id], command, ctx);
        });
        results.push({ command, outcome });
        if (outcome.ok) {
          current = next;
          patches.push(...commandPatches);
        }
      }
      return { world: current, patches, results };
    },
  };
}

function sortByDependencies(systems: readonly AnySystem[]): AnySystem[] {
  const byId = new Map<string, AnySystem>();
  for (const system of systems) {
    if (byId.has(system.id)) throw new RegistryError(`系统 id 重复：${system.id}`);
    byId.set(system.id, system);
  }
  for (const system of systems) {
    for (const dep of system.dependsOn ?? []) {
      if (!byId.has(dep)) throw new RegistryError(`${system.id} 依赖的系统 ${dep} 没有注册`);
    }
  }

  const sorted: AnySystem[] = [];
  const marks = new Map<string, "visiting" | "done">();
  const visit = (system: AnySystem, path: readonly string[]): void => {
    const mark = marks.get(system.id);
    if (mark === "done") return;
    if (mark === "visiting") {
      const cycle = [...path.slice(path.indexOf(system.id)), system.id];
      throw new RegistryError(`系统之间有循环依赖：${cycle.join(" → ")}`);
    }
    marks.set(system.id, "visiting");
    for (const dep of system.dependsOn ?? []) {
      visit(byId.get(dep) as AnySystem, [...path, system.id]);
    }
    marks.set(system.id, "done");
    sorted.push(system);
  };
  for (const system of systems) visit(system, []);
  return sorted;
}
