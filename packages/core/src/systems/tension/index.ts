import { defineSystem, type RuleModule } from "../../kernel/system";
import type { WorldState } from "../../kernel/world";
import { WorldClockStateSchema, type WorldClockState, locationCatalog } from "../world/schema";
import { advanceTension, tensionFacts } from "./apply";
import { type TensionCommand, TensionCommandSchema, type TensionState, TensionStateSchema, TensionSiteSchema } from "./schema";

const TENSION_HINT = /(扫描|义眼|弱点|漏洞|散热|安保|增援|支援|警报|僵持|对峙|埋伏|潜入|交火|黑冰)/;
const siteKey = (location: string | null) => location ?? "unlocated";

export function currentTension(world: WorldState) {
  const state = TensionStateSchema.parse(world.slices.tension);
  const clock = WorldClockStateSchema.parse(world.slices.world);
  return state.sites[siteKey(clock.location)] ?? TensionSiteSchema.parse({});
}

export const tensionRules: RuleModule<TensionState> = {
  id: "tension",
  title: "现场物理局势",
  commands: ["tension"],
  when: (state, input) => Object.values(state.sites).some((site) => site.active) || TENSION_HINT.test(input.text),
  judge: `- 按当前位置的已知条件裁决。已瘫痪硬件不会因收场或离开自动修好。增援需要已发生的呼叫、警报或巡逻依据；冲突本身不自动生成警察。预计抵达时间不等于已抵达。`,
  text: `- tension 记录当前位置的真实变化。危局解除写 active:false，记录仍保留。新增援同时写 triggerBackupInMinutes 和 backupCause，交代实际呼叫、响应者及路线；取消写 cancelBackupReason，实际到达写 backupArrived:true。维修确已发生才写 repairChrome。不同地点的损坏和增援各自保存，不随玩家移动。`,
};

export const tension = defineSystem<TensionState, TensionCommand>({
  id: "tension",
  dependsOn: ["world"],
  state: TensionStateSchema,
  initial: () => TensionStateSchema.parse({}),
  commands: { tension: TensionCommandSchema },
  apply(draft, command, ctx) {
    const clock = ctx.read<WorldClockState>("world");
    const origin = ctx.facts.actionStartLocation;
    const fallback = typeof origin === "string" || origin === null ? origin : clock.location;
    const location = command.location ?? fallback;
    if (command.location !== undefined && location !== clock.location && location !== fallback &&
      !draft.sites[command.location] && !locationCatalog(ctx.data).has(command.location)) {
      return { ok: false, reason: "现场变化必须指向已知地点，先登记新地点" };
    }
    const key = siteKey(location);
    const site = draft.sites[key] ?? TensionSiteSchema.parse({});
    if (command.triggerBackupInMinutes !== undefined && !command.backupCause) {
      return { ok: false, reason: "增援需要已发生的呼叫、警报或巡逻依据" };
    }
    if (command.cancelBackupReason && (command.triggerBackupInMinutes !== undefined || command.backupArrived === true)) {
      return { ok: false, reason: "取消与发出或到达增援不能写在同一条记录" };
    }
    if (command.backupArrived === true && site.backupCause === null && !command.backupCause) {
      return { ok: false, reason: "尚无增援来源，不能直接宣称抵达" };
    }
    const next = advanceTension(site, command);
    draft.sites[key] = { ...next, active: command.active ?? next.active };
    return { ok: true };
  },
  // 镜头切换不改变现场事实，远离玩家的现场也按游戏时间计时。
  tick(draft, span) {
    const minutes = span.to - span.from;
    for (const site of Object.values(draft.sites)) {
      if (site.backupEtaMinutes !== null && !site.backupArrived) {
        site.backupEtaMinutes = Math.max(0, site.backupEtaMinutes - minutes);
      }
    }
  },
  rules: [tensionRules],
  sections: [{ order: 165, title: "现场局势", render: ({ world }) => tensionFacts(currentTension(world)) }],
});

export * from "./apply";
export * from "./schema";
