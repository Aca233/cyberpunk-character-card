/**
 * 仅供模型模拟测试使用：默认把每条账目作为独立事件，保持原顺序。
 * 涉及共同成败或前置依赖的用例应显式提供 events；坏的顶层输入保持原样。
 */
export function withIndependentEvents(value: unknown): unknown {
  if (typeof value !== "object" || value === null || !("changes" in value)) return value;
  const shape = value as Record<string, unknown>;
  if (!Array.isArray(shape.changes) || "events" in shape) return value;
  const entries = [
    ...shape.changes.map((_, index) => `changes[${index}]`),
    ...(Array.isArray(shape.messages)
      ? shape.messages.map((_, index) => `messages[${index}]`)
      : []),
  ];
  return {
    ...shape,
    events: entries.map((entry, index) => ({
      id: `fixture-event-${index + 1}`,
      requires: [],
      entries: [entry],
    })),
  };
}
