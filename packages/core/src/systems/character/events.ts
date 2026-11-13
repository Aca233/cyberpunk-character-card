import type { EventContext, SystemEvent } from "../../kernel/system";

/** 已废除属性点与数值加点事件，不再弹出 RPG 升级提示条 */
export function characterEvents(_ctx: EventContext): readonly SystemEvent[] {
  return [];
}
