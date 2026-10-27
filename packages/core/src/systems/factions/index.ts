import { defineSystem } from "../../kernel/system";
import { applyAgenda, applyAgendaMove, applyAgendaTold, tickAgendas } from "./agenda";
import { applyFaction } from "./apply";
import { agendaRules, factionRules } from "./prompt";
import {
  AgendaCommandSchema,
  AgendaMoveCommandSchema,
  AgendaToldSchema,
  FactionCommandSchema,
  type FactionsCommand,
  type FactionsInternal,
  type FactionsState,
  FactionsStateSchema,
} from "./schema";
import { factionsView } from "./view";

/**
 * 势力：每个帮派、公司对玩家的态度标签和一句理由，叙事模型按发生的事调整；
 * 势力动向是种子：每 2 个游戏日代码让一个势力到点、掷个倾向，具体发生什么由场外推演即兴写（agenda.move），
 * 一步最多改一个城区的地盘；玩家可以推一把、拖住或搅黄
 */
export const factions = defineSystem<FactionsState, FactionsCommand, FactionsInternal>({
  id: "factions",
  dependsOn: [],
  state: FactionsStateSchema,
  initial: () => ({ stances: {}, agendas: {}, due: [], agendaClock: null }),
  commands: {
    faction: FactionCommandSchema,
    agenda: AgendaCommandSchema,
    agendaTold: AgendaToldSchema,
  },
  internal: {
    "agenda.move": AgendaMoveCommandSchema,
  },
  apply(draft, command, ctx) {
    if (command.type === "agenda.move") return applyAgendaMove(draft, command, ctx);
    if (command.type === "agenda") return applyAgenda(draft, command, ctx);
    if (command.type === "agendaTold") return applyAgendaTold(draft, command, ctx);
    return applyFaction(draft, command, ctx);
  },
  tick: (draft, span, ctx) => tickAgendas(draft, span, ctx.data),
  rules: [factionRules, agendaRules],
  view: { key: "factions", project: factionsView },
});

export * from "./agenda";
export * from "./apply";
export * from "./prompt";
export * from "./schema";
export * from "./view";
