import type { StatusContext, SystemStatus } from "../../kernel/system";
import type { psychosisView } from "./apply";

/** 【当前状态】里赛博精神病的几行：压制剂、危机章节、本场发作、记忆空白 */

type PsychosisView = ReturnType<typeof psychosisView>;

const psychosisOf = (ctx: StatusContext) => ctx.views.psychosis as PsychosisView;

export const psychosisStatus: readonly SystemStatus[] = [
  {
    order: 140,
    lines(ctx) {
      const p = psychosisOf(ctx);
      const lines: string[] = [];
      const s = p.suppressant;
      if (s.until)
        lines.push(
          `压制剂起效到 ${s.until}：药力压住了神经震颤与幻觉冲动${s.tolerant ? "；已经耐受，药效变短" : ""}`,
        );
      if (s.withdrawal) lines.push("压制剂戒断中：烦躁、手抖、失眠，情绪与精细动作明显吃力");
      else if (s.dependent) lines.push("已经依赖压制剂：停药一天就会戒断");
      const c = p.crisis;
      if (c?.status === "open")
        lines.push(
          `危机章节（${c.since} 人性归零）：普通委托暂停；方向：被拉回来（身边的人或诊所出面，稳住局面后写 crisis pulledBack）、带着全部义体走向最后一战（crisis lastStand）、向暴恐机动队投降（crisis surrender），玩家别的合理办法也能接住`,
        );
      else if (c?.status === "lastStand")
        lines.push(
          "最后一战：角色带着全部义体冲向结局，普通委托暂停；结局照剧情写，被拉回来仍可以写 crisis pulledBack",
        );
      else if (c?.status === "recovering")
        lines.push(
          `恢复期到 ${c.until}：刚从危机里被拉回来，身上的义体大多拆了；这段时间义体医生不给装新义体`,
        );
      else if (c?.status === "surrendered") lines.push("已向暴恐机动队投降：写被带走之后的事");
      if (p.episodeHere) lines.push("这个场景已经发作过一次，不再安排发作");
      if (p.blackoutOpen)
        lines.push("严重发作还没过去：这一段事后会成为记忆空白，场景结束后角色记不清");
      if (p.blackouts.length > 0)
        lines.push(
          `记忆空白：${p.blackouts.map((b) => `${b.from} 到 ${b.to}`).join("、")}；角色自己想不起这些时候的事，只能从别人的反应、新闻和物证拼回，真相以回合日志为准`,
        );
      return lines;
    },
  },
];
