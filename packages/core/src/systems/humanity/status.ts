import type { StatusContext, SystemStatus } from "../../kernel/system";
import type { humanityView } from "./view";

/** 【当前状态】里人性的一行 */

type HumanityView = ReturnType<typeof humanityView>;

const humanityOf = (ctx: StatusContext) => ctx.views.humanity as HumanityView;

export const humanityStatus: readonly SystemStatus[] = [
  {
    order: 40,
    lines(ctx) {
      const h = humanityOf(ctx);
      const base = `人性：${h.current}/${h.cap}，${h.stageLabel}`;
      if (h.current >= 40) return [base];
      if (h.suppressed) {
        return [`${base}（压制剂摁住了表层噪点与颤抖，世界恢复清晰却像隔着麻醉后的冷玻璃）`];
      }
      if (h.current === 0) {
        return [
          `${base}（视神经底噪尖啸，躯壳像半截不属于自己的冷铁，极度高压或重创下随时可能重度失控并断片）`,
        ];
      }
      if (h.current < 20) {
        return [`${base}（视野重影与金属回响频发，高压下容易误判与短暂失控，但理智尚能抓牢锚点）`];
      }
      return [`${base}（义眼偶闪红帧雪花、情绪抽离偏冷，强刺激下有轻微失真与冲动）`];
    },
  },
];
