/** 玩家在界面上直接做的操作：不调用模型，结算后作为 action 记录写进日志 */
import type { Patch } from "immer";
import { z } from "zod";
import type { ApplyContext, Command } from "./kernel/system";
import type { WorldState } from "./kernel/world";
import { AttributeSchema } from "./systems/dice/schema";
import { registry } from "./systems/registry";

export const PlayerActionSchema = z.discriminatedUnion("type", [
  /** 分配一个街头声望攒下的属性点 */
  z.strictObject({ type: z.literal("spendPoint"), attribute: AttributeSchema }),
]);
export type PlayerAction = z.infer<typeof PlayerActionSchema>;

/** POST /api/saves/:id/actions 的请求体 */
export const ActionRequestSchema = z.strictObject({
  requestId: z
    .string()
    .regex(/^[A-Za-z0-9_-]{8,64}$/, "requestId 只能是 8–64 位字母、数字、- 或 _"),
  baseVersion: z.number().int().min(0),
  action: PlayerActionSchema,
});
export type ActionRequest = z.infer<typeof ActionRequestSchema>;

/** 每种操作对应的内部指令；只放行这里列出的 */
function commandsFor(action: PlayerAction): Command[] {
  switch (action.type) {
    case "spendPoint":
      return [{ type: "character.spendPoint", attribute: action.attribute }];
  }
}

export type ActionResult =
  | {
      readonly ok: true;
      readonly world: WorldState;
      readonly commands: readonly Command[];
      readonly notes: readonly string[];
      readonly patches: readonly Patch[];
    }
  | { readonly ok: false; readonly reason: string };

/** 结算一个界面操作；任何一条指令不生效，整个操作都不生效 */
export function applyPlayerAction(
  world: WorldState,
  action: PlayerAction,
  ctx: ApplyContext,
): ActionResult {
  const parsed: Command[] = [];
  for (const raw of commandsFor(action)) {
    const result = registry.parseInternal(raw);
    if (!result.ok) return { ok: false, reason: result.error };
    parsed.push(result.command);
  }
  const applied = registry.applyCommands(world, parsed, ctx);
  const notes: string[] = [];
  for (const { result } of applied.results) {
    if (!result.ok) return { ok: false, reason: result.reason };
    notes.push(...result.notes);
  }
  return { ok: true, world: applied.world, commands: parsed, notes, patches: applied.patches };
}
