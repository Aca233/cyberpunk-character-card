import { defineSystem } from "../../kernel/system";
import { characterActions } from "./actions";
import { recordDeed, setCharacter } from "./apply";
import { characterEvents } from "./events";
import { applyFlashback, tickFlashback } from "./flashback";
import { changeHabit, offerHabit } from "./habits";
import { flashbackRules, habitRules, reputationRules } from "./prompt";
import {
  type CharacterInternal,
  type CharacterState,
  CharacterStateSchema,
  type FlashbackCommand,
  FlashbackCommandSchema,
  FlashbackTickSchema,
  HabitChangeSchema,
  type HabitCommand,
  HabitCommandSchema,
  RecordDeedSchema,
  type ReputationCommand,
  ReputationCommandSchema,
  SetCharacterSchema,
} from "./schema";
import { characterStatus } from "./status";
import { characterView } from "./view";

/** 角色：名字、简介、外界知道的事迹、主板模块、习惯与闪回 */
export const character = defineSystem<
  CharacterState,
  ReputationCommand | HabitCommand | FlashbackCommand,
  CharacterInternal
>({
  id: "character",
  state: CharacterStateSchema,
  initial: () => ({
    name: null,
    brief: "",
    deeds: [],
    traits: [],
    habits: [],
    habitOffers: [],
    flashbackUsed: [],
    flashback: null,
    pastFacts: [],
  }),
  commands: {
    reputation: ReputationCommandSchema,
    habit: HabitCommandSchema,
    flashback: FlashbackCommandSchema,
  },
  internal: {
    "character.set": SetCharacterSchema,
    "character.deed": RecordDeedSchema,
    "character.habit": HabitChangeSchema,
    "character.flashbackTick": FlashbackTickSchema,
  },
  apply(draft, command, ctx) {
    switch (command.type) {
      case "character.set":
        return setCharacter(draft, command);
      case "character.deed":
      case "reputation":
        return recordDeed(draft, command, ctx.now);
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
  rules: [reputationRules, habitRules, flashbackRules],
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
