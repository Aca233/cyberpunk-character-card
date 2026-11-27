/**
 * 仅供模型模拟测试使用：将顶层平铺的 changes / messages 包装成独立内嵌事件，保持原顺序。
 * 涉及共同成败或前置依赖的用例应显式提供 events；坏的顶层输入保持原样。
 */
export function withIndependentEvents(value: unknown): unknown {
  if (typeof value !== "object" || value === null) return value;
  const shape = value as Record<string, unknown>;
  if ("events" in shape || !Array.isArray(shape.changes)) return value;
  const { changes, messages, ...rest } = shape;
  const events: { id: string; requires: string[]; changes: unknown[]; messages?: unknown[] }[] = [];
  for (const item of changes) {
    events.push({
      id: `fixture-event-${events.length + 1}`,
      requires: [],
      changes: [item],
    });
  }
  if (Array.isArray(messages)) {
    for (const msg of messages) {
      events.push({
        id: `fixture-event-${events.length + 1}`,
        requires: [],
        changes: [],
        messages: [msg],
      });
    }
  }
  return { ...rest, events };
}
