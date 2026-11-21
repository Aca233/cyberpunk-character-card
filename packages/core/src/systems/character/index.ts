import { defineSystem } from "../../kernel/system";
import { characterActions } from "./actions";
import { gainCred, setCharacter } from "./apply";
import { characterEvents } from "./events";
import { applyFlashback, tickFlashback } from "./flashback";
import { changeHabit, offerHabit } from "./habits";
import { flashbackRules, habitRules, streetCredRules } from "./prompt";
import {
  type CharacterInternal,
  type CharacterState,
  CharacterStateSchema,
  type FlashbackCommand,
  FlashbackCommandSchema,
  FlashbackTickSchema,
  GainCredSchema,
  HabitChangeSchema,
  type HabitCommand,
  HabitCommandSchema,
  legacyStreetCred,
  SetCharacterSchema,
  type StreetCredCommand,
  StreetCredCommandSchema,
  StreetCredProposalSchema,
} from "./schema";
import { characterStatus } from "./status";
import { characterView } from "./view";

/** 角色：名字、简介、街头声望、主板模块、习惯与闪回 */
export const character = defineSystem<
  CharacterState,
  StreetCredCommand | HabitCommand | FlashbackCommand,
  CharacterInternal
>({
  id: "character",
  state: CharacterStateSchema,
  initial: () => ({
    name: null,
    brief: "",
    streetCred: 1,
    credHalf: false,
    credSettled: [],
    traits: [],
    habits: [],
    habitOffers: [],
    flashbackUsed: [],
    flashback: null,
    pastFacts: [],
  }),
  commands: {
    streetCred: StreetCredCommandSchema,
    habit: HabitCommandSchema,
    flashback: FlashbackCommandSchema,
  },
  proposals: { streetCred: { schema: StreetCredProposalSchema, legacy: legacyStreetCred } },
  internal: {
    "character.set": SetCharacterSchema,
    "character.cred": GainCredSchema,
    "character.habit": HabitChangeSchema,
    "character.flashbackTick": FlashbackTickSchema,
  },
  apply(draft, command, ctx) {
    switch (command.type) {
      case "character.set":
        return setCharacter(draft, command);
      case "character.cred":
        return gainCred(draft, command.halves, command.reason, command.event);
      case "streetCred":
        return gainCred(draft, command.levels * 2, command.reason, command.event);
      case "habit":
        return offerHabit(draft, command.text);
      case "character.habit":
        return changeHabit(draft, command);
      case "flashback":
        return applyFlashback(draft, command, ctx.now);
      case "character.flashbackTick":
        return tickFlashback(draft);
    }
  },
  rules: [streetCredRules, habitRules, flashbackRules],
  view: { key: "character", project: characterView },
  status: characterStatus,
  actions: characterActions,
  events: characterEvents,
});

export * from "./actions";
export * from "./apply";
export * from "./events";
export * from "./flashback";
export * from "./habits";
export * from "./prompt";
export * from "./schema";
export * from "./status";
export * from "./view";
