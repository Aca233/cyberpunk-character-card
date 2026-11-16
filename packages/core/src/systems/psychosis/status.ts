import type { StatusContext, SystemStatus } from "../../kernel/system";
import type { psychosisView } from "./apply";

/** 【当前状态】里赛博精神病的几行：压制剂、本场发作、记忆空白 */

type PsychosisView = ReturnType<typeof psychosisView>;

const psychosisOf = (ctx: StatusContext) => ctx.views.psychosis as PsychosisView;

export const psychosisStatus: readonly SystemStatus[] = [
  {
    order: 140,
    lines(ctx) {
      const p = psychosisOf(ctx);
      const lines: string[] = [];
      const s = p.suppressant;
      if (s.until) {
        lines.push(
          `压制剂生效到 ${s.until}：药力把颤抖和日常幻觉压了下去（若人性归零，极端刺激仍可能冲破药力）${s.tolerant ? "；已产生耐药，药效减半" : ""}`,
        );
      }
      if (s.withdrawal) {
        lines.push("压制剂戒断中：冷汗浸透衣领、扳机指发抖、太阳穴抽痛，神经极易被一点火星点着");
      } else if (s.dependent) {
        lines.push("已经依赖压制剂：停药超过一天就会出现戒断");
      }
      if (p.episodeHere) lines.push("这个场景已经发作过一次，不再安排发作");
      if (p.blackoutOpen)
        lines.push("意识正处在严重发作后的断层里：这一段事后会成为记忆空白，场景结束后角色记不清");
      if (p.blackouts.length > 0)
        lines.push(
          `记忆空白：${p.blackouts.map((b) => `${b.from} 到 ${b.to}`).join("、")}；角色自己完全想不起那段路里干了什么，只能从手上的血迹、弹壳、路人躲避的眼神或新闻倒推，真相以回合日志为准`,
        );
      return lines;
    },
  },
];
