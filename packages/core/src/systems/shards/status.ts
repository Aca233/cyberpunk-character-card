import type { StatusContext, SystemStatus } from "../../kernel/system";
import type { shardsView } from "./view";

type ShardsView = ReturnType<typeof shardsView>;

export const shardsStatus: readonly SystemStatus[] = [
  {
    order: 185,
    lines(ctx: StatusContext) {
      const view = ctx.views.shards as ShardsView | undefined;
      if (!view) return [];
      if (view.slots.items.length === 0) return [];
      const list = view.slots.items
        .map(
          (slot) =>
            `《${slot.title}》（${slot.categoryLabel}${slot.ability ? `，${slot.ability}` : slot.protocol ? `，协议：${slot.protocol}` : ""}）`,
        )
        .join("、");
      return [`神经芯片槽（${view.slots.used}/${view.slots.max}）：${list}`];
    },
  },
];
