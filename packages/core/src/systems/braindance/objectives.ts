import type { Objective, ViewContext } from "../../kernel/system";
import { BraindanceStateSchema } from "./schema";
import { braindanceView } from "./view";

/** 超梦交的待办：正在查的那一段；只用玩家视图里的东西，关键线索是哪几条、答案和真相都不进来 */
export function braindanceObjectives({ world }: ViewContext): readonly Objective[] {
  const active = braindanceView(BraindanceStateSchema.parse(world.slices.braindance ?? {})).active;
  if (!active) return [];
  const { found, total } = active.keys;
  return [
    {
      id: `braindance:${active.startedAt}`,
      source: "braindance",
      sourceLabel: "超梦",
      title: `${active.title}（${active.recorder}的录像）`,
      location: null,
      due: null,
      dueIn: null,
      progress: active.ready ? "关键线索找全了，可以下结论" : `关键线索找到 ${found}/${total} 条`,
      status: "active",
    },
  ];
}
