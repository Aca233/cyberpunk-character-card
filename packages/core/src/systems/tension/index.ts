import { defineSystem, type RuleModule } from "../../kernel/system";
import { advanceTension, tensionFacts } from "./apply";
import {
  type TensionCommand,
  TensionCommandSchema,
  type TensionState,
  TensionStateSchema,
} from "./schema";

const TENSION_HINT = /(扫描|义眼|弱点|漏洞|散热|安保|增援|支援|警报|僵持|对峙|埋伏|潜入|交火|黑冰)/;

export const tensionRules: RuleModule<TensionState> = {
  id: "tension",
  title: "现场物理局势",
  commands: ["tension"],
  when: (state, input) => state.active || (input.mode !== "ooc" && TENSION_HINT.test(input.text)),
  judge: `- 若现场正在潜行、对峙、交火、追逐或深层潜网，结合【现场局势】里列出的客观条件：敌方剩余增援 ETA、已知物理弱点、扫出的与已瘫痪的敌方硬件，直接裁决战术收益与紧迫感；已瘫痪的硬件不再起效。`,
  text: `- 当场景进入持续物理危局（stealth/firefight/boardroom/honeytrap/chase/deepDive）、或暴露态势变化、玩家摸清了真实弱点（exposeWeakpoint）、扫出了敌方硬件（scanChrome）、击毁或EMP瘫痪了硬件（disableChrome）、对方叫来增援（triggerBackupInMinutes）时，发一条 tension 记录，危局解除时写 active: false；日常闲逛或纯聊天时不发。`,
};

export const tension = defineSystem<TensionState, TensionCommand>({
  id: "tension",
  dependsOn: [],
  state: TensionStateSchema,
  initial: () => TensionStateSchema.parse({}),
  commands: { tension: TensionCommandSchema },
  apply(draft, command) {
    const next = advanceTension(draft, {
      ...(command.mode === undefined ? {} : { mode: command.mode }),
      ...(command.exposure === undefined ? {} : { exposure: command.exposure }),
      ...(command.exposeWeakpoint === undefined
        ? {}
        : { exposeWeakpoint: command.exposeWeakpoint }),
      ...(command.scanChrome === undefined ? {} : { scanChrome: command.scanChrome }),
      ...(command.disableChrome === undefined ? {} : { disableChrome: command.disableChrome }),
      ...(command.triggerBackupInMinutes === undefined
        ? {}
        : { triggerBackupInMinutes: command.triggerBackupInMinutes }),
    });
    const touched =
      command.mode !== undefined ||
      command.exposure !== undefined ||
      command.exposeWeakpoint !== undefined ||
      (command.scanChrome?.length ?? 0) > 0 ||
      command.triggerBackupInMinutes !== undefined;
    draft.active = command.active ?? (next.active || touched);
    draft.mode = next.mode;
    draft.exposure = next.exposure;
    draft.backupEtaMinutes = next.backupEtaMinutes;
    draft.exposedWeakpoints = [...next.exposedWeakpoints];
    draft.scannedEnemyChrome = [...next.scannedEnemyChrome];
    draft.disabledEnemyChrome = [...next.disabledEnemyChrome];
    return { ok: true };
  },
  on: {
    "scene.end": (draft) => {
      draft.active = false;
      draft.exposure = "hidden";
      draft.backupEtaMinutes = null;
      draft.exposedWeakpoints = [];
      draft.scannedEnemyChrome = [];
      draft.disabledEnemyChrome = [];
    },
  },
  tick(draft, span) {
    if (!draft.active || draft.backupEtaMinutes === null) return;
    const mins = Math.max(0, span.to - span.from);
    if (mins <= 0) return;
    const next = advanceTension(draft, { elapsedMinutes: mins });
    draft.backupEtaMinutes = next.backupEtaMinutes;
  },
  rules: [tensionRules],
  sections: [
    {
      order: 165,
      title: "现场局势",
      render: ({ world }) => {
        const parsed = TensionStateSchema.safeParse(world.slices.tension ?? {});
        return parsed.success ? tensionFacts(parsed.data) : undefined;
      },
    },
  ],
});

export * from "./apply";
export * from "./schema";
