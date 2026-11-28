import type { ViewContext } from "../../kernel/system";
import { NpcStateSchema } from "../npc";
import { formatGameTime, locationCatalog } from "../world";
import {
  fixerBlocked,
  hasOutstandingPayment,
  isOpen,
  JOB_CREW_STATUS_LABELS,
  JOB_STATUS_LABELS,
} from "./apply";
import { JOB_KIND_LABELS, JobsStateSchema } from "./schema";
import { factionSide } from "./side";

/** 状态接口带上的已结束委托，最近的优先 */
export const JOBS_CLOSED_SHOWN = 5;

/** 委托和中间人；隐藏的转折只给模型看，不在这里 */
export function jobsView({ world, data }: ViewContext) {
  const jobs = JobsStateSchema.parse(world.slices.jobs);
  const npcs = NpcStateSchema.parse(world.slices.npc);
  const places = locationCatalog(data);
  const closed = jobs.jobs.filter((j) => !isOpen(j));
  const recentClosed = closed.slice(-JOBS_CLOSED_SHOWN);
  return {
    fixers: Object.values(jobs.fixers).map((f) => {
      const card = npcs.npcs[f.id];
      const side = factionSide(card?.faction, data, world.slices.factions);
      const blocked = side !== undefined && fixerBlocked(side.attitude);
      const locId = card?.location ?? null;
      const place = locId === null ? undefined : places.get(locId);
      return {
        id: f.id,
        name: f.name,
        relation: card?.relation?.text ?? null,
        factionName: side?.name ?? null,
        factionAttitude: side?.attitude ?? null,
        factionMember: Boolean(side?.member),
        met: Boolean(card?.met),
        alive: card?.alive !== false,
        location: locId,
        locationName: place?.name ?? locId,
        district: place?.district ?? null,
        blocked,
        blockReason: blocked && side ? `${side.name}和你结了仇，当前暂停派单` : null,
      };
    }),
    list: [
      ...jobs.jobs.filter(isOpen),
      ...closed.filter((j) => hasOutstandingPayment(j) || recentClosed.includes(j)),
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
      paymentTotal: j.paymentTotal,
      paymentHeld: j.paymentHeld,
      paymentOutstanding:
        j.paymentTotal === null ? null : Math.max(0, j.paymentTotal - (j.paid ?? 0)),
      summary: j.summary,
      crew: (j.crew ?? []).map((m) => ({
        npc: m.npc,
        name: m.name,
        role: m.role,
        cutPercent: m.cutPercent,
        paid: m.paid,
        status: m.status,
        statusLabel: JOB_CREW_STATUS_LABELS[m.status],
      })),
      /** 结算卡：接单以来的人性变化与扣除搭档分成后的玩家净到手 */
      settlement:
        j.settlement === null
          ? null
          : {
              humanity: j.settlement.humanity,
              playerNet: j.settlement.playerNet ?? j.paid,
            },
    })),
  };
}
