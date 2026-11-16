import { z } from "zod";

export const RouteStateSchema = z.object({
  blocked: z.boolean(),
  reason: z.string().min(1),
  changedAt: z.number().int(),
  source: z.string().min(1),
});
export const LogisticsStateSchema = z.object({
  routes: z.record(z.string(), RouteStateSchema).default({}),
});
export type LogisticsState = z.infer<typeof LogisticsStateSchema>;
export const RouteCommandSchema = z.strictObject({
  type: z.literal("logistics.route"),
  location: z
    .string()
    .min(1)
    .describe("受到封锁或已经恢复通行的具体已知地点/道路 id，只影响途经它的供货"),
  blocked: z.boolean(),
  reason: z.string().min(1).max(240),
  evidence: z
    .string()
    .min(2)
    .max(500)
    .describe("逐字引用本轮正文或已记录城市事件里实际封锁/恢复通行的证据"),
  sourceEvent: z
    .string()
    .min(1)
    .optional()
    .describe("依据已有城市事件时填该事件 id；不能把无关新闻推成全城封锁"),
});
export type RouteCommand = z.infer<typeof RouteCommandSchema>;

export function routeBlocked(
  state: LogisticsState,
  route: readonly string[],
): { location: string; reason: string; at: number } | undefined {
  for (const location of route) {
    const block = state.routes[location];
    if (block?.blocked) return { location, reason: block.reason, at: block.changedAt };
  }
  return undefined;
}
