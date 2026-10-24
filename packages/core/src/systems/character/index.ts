import { defineSystem } from "../../kernel/system";
import { gainCred, setBonuses, setCharacter, spendPoint } from "./apply";
import { changeHabit, offerHabit } from "./habits";
import { habitRules, streetCredRules } from "./prompt";
import {
  type CharacterInternal,
  type CharacterState,
  CharacterStateSchema,
  GainCredSchema,
  HabitChangeSchema,
  type HabitCommand,
  HabitCommandSchema,
  SetBonusesSchema,
  SetCharacterSchema,
  SpendPointSchema,
  type StreetCredCommand,
  StreetCredCommandSchema,
} from "./schema";

/** 角色：名字、简介、属性、街头声望和属性点；声望升级时更新生命上限 */
export const character = defineSystem<
  CharacterState,
  StreetCredCommand | HabitCommand,
  CharacterInternal
>({
  id: "character",
  dependsOn: ["health"],
  state: CharacterStateSchema,
  initial: () => ({
    name: null,
    brief: "",
    attributes: { body: 3, reflexes: 3, tech: 3, intelligence: 3, cool: 3 },
    streetCred: 1,
    credHalf: false,
    attributePoints: 0,
    credSettled: [],
    traits: [],
    bonuses: {},
    habits: [],
    habitOffers: [],
  }),
  commands: { streetCred: StreetCredCommandSchema, habit: HabitCommandSchema },
  internal: {
    "character.set": SetCharacterSchema,
    "character.cred": GainCredSchema,
    "character.spendPoint": SpendPointSchema,
    "character.setBonuses": SetBonusesSchema,
    "character.habit": HabitChangeSchema,
  },
  apply(draft, command) {
    switch (command.type) {
      case "character.set":
        return setCharacter(draft, command);
      case "character.cred":
        return gainCred(draft, command.halves, command.reason, command.event);
      case "character.spendPoint":
        return spendPoint(draft, command);
      case "character.setBonuses":
        return setBonuses(draft, command);
      case "streetCred":
        return gainCred(draft, command.levels * 2, command.reason, command.event);
      case "habit":
        return offerHabit(draft, command.text);
      case "character.habit":
        return changeHabit(draft, command);
    }
  },
  rules: [streetCredRules, habitRules],
});

export * from "./apply";
export * from "./habits";
export * from "./prompt";
export * from "./schema";
