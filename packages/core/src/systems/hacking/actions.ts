import { z } from "zod";
import { defineAction } from "../../kernel/system";
import { CombatStateSchema } from "../combat";
import { CyberwareStateSchema } from "../cyberware";
import { HealthStateSchema } from "../health";
import { deckOf } from "./apply";
import { DeckLoadCommandSchema, HackingStateSchema } from "./schema";

/** 玩家在生物监测面板直接插拔接入仓热待命程序芯片（仅限已持有芯片的插装/卸下/替换，脱战且未潜网时可用） */
export const DeckLoadActionSchema = z.strictObject({
  type: z.literal("deckLoad"),
  action: z.enum(["slot", "unslot"]),
  program: z.string().trim().min(1).max(40),
  replace: z.string().trim().min(1).max(40).optional(),
});
export type DeckLoadAction = z.infer<typeof DeckLoadActionSchema>;

export const hackingActions = {
  deckLoad: defineAction({
    schema: DeckLoadActionSchema,
    commands: (action, { world, data }) => {
      const installed = CyberwareStateSchema.parse(world.slices.cyberware ?? {}).installed;
      const broken = HealthStateSchema.parse(world.slices.health).brokenChrome;
      const found = deckOf(installed, data, broken);
      if (!found?.deck) return "没装完好的网络接入仓，无法插拔存储插槽里的程序芯片";
      if (CombatStateSchema.parse(world.slices.combat).active) {
        return "交火中没工夫腾手拆换接入仓里的程序芯片，脱战后再插拔";
      }
      if (HackingStateSchema.parse(world.slices.hacking ?? {}).dive !== null) {
        return "潜网连接维持中不能热插拔接入仓里的程序芯片，先退回肉身再换槽";
      }
      return [DeckLoadCommandSchema.parse(action)];
    },
  }),
};
