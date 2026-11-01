import type { ViewContext } from "../../kernel/system";
import { CharacterStateSchema } from "../character";
import { NpcStateSchema } from "../npc";
import { formatGameTime } from "../world";
import { FACTION_RISK_BONUS, isOpen, JOB_STATUS_LABELS, maxRisk, riskCap } from "./apply";
import { JOB_KIND_LABELS, JobsStateSchema } from "./schema";
import { factionSide } from "./side";

/** 状态接口带上的已结束委托，最近的优先 */
export const JOBS_CLOSED_SHOWN = 5;

/** 委托和中间人；隐藏的转折只给模型看，不在这里 */
export function jobsView({ world, data }: ViewContext) {
  const jobs = JobsStateSchema.parse(world.slices.jobs);
  const npcs = NpcStateSchema.parse(world.slices.npc);
  const character = CharacterStateSchema.parse(world.slices.character);
  return {
    fixers: Object.values(jobs.fixers).map((f) => {
      const affinity = npcs.npcs[f.id]?.affinity ?? 0;
      const cap = riskCap(affinity, character.streetCred);
      // 派单人所属势力的态度（用户 2026-10-31 选的「势力进机制」）：和派单时一样算
      const side = factionSide(npcs.npcs[f.id]?.faction, data, world.slices.factions);
      const bonus = side === undefined ? 0 : FACTION_RISK_BONUS[side.attitude];
      if (side !== undefined && bonus === null) {
        return {
          id: f.id,
          name: f.name,
          affinity,
          maxRisk: 0,
          cappedBy: null,
          capHint: `${side.name}和你结了仇，不派单`,
        };
      }
      const max = Math.min(5, maxRisk(affinity, character.streetCred) + (bonus ?? 0));
      return {
        id: f.id,
        name: f.name,
        affinity,
        maxRisk: max,
        cappedBy: max >= 5 ? null : cap.by,
        capHint: max >= 5 ? null : cap.hint,
      };
    }),
    list: [
      ...jobs.jobs.filter(isOpen),
      ...jobs.jobs.filter((j) => !isOpen(j)).slice(-JOBS_CLOSED_SHOWN),
    ].map((j) => ({
      id: j.id,
      title: j.title,
      /** 委托类型，例如“护送”；没写类型是 null */
      kindLabel: j.kind ? JOB_KIND_LABELS[j.kind] : null,
      fixer: j.fixer === null ? null : (jobs.fixers[j.fixer]?.name ?? j.fixer),
      client: j.client,
      location: j.location,
      risk: j.risk,
      reward: j.reward,
      due: j.due === null ? null : formatGameTime(j.due),
      /** 离期限还有多少分钟；已过期为负 */
      dueIn: j.due === null ? null : j.due - world.time,
      overdue: isOpen(j) && j.due !== null && j.due <= world.time,
      status: j.status,
      statusLabel: JOB_STATUS_LABELS[j.status],
      open: isOpen(j),
      notes: j.notes,
      paid: j.paid,
      summary: j.summary,
      /** 结算卡：声望按级、中间人好感变化、接单以来的人性变化 */
      settlement:
        j.settlement === null
          ? null
          : {
              squad: j.settlement.squad,
              streetCred: j.settlement.credHalves / 2,
              affinity: j.settlement.affinity,
              humanity: j.settlement.humanity,
            },
    })),
  };
}
