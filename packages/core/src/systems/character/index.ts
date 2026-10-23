import { defineSystem } from "../../kernel/system";
import { gainCred, setCharacter, spendPoint } from "./apply";
import { streetCredRules } from "./prompt";
import {
  type CharacterInternal,
  type CharacterState,
  CharacterStateSchema,
  GainCredSchema,
  SetCharacterSchema,
  SpendPointSchema,
  type StreetCredCommand,
  StreetCredCommandSchema,
} from "./schema";

/** 角色：名字、简介、属性、街头声望和属性点；声望升级时更新生命上限 */
export const character = defineSystem<CharacterState, StreetCredCommand, CharacterInternal>({
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
  }),
  commands: { streetCred: StreetCredCommandSchema },
  internal: {
    "character.set": SetCharacterSchema,
    "character.cred": GainCredSchema,
    "character.spendPoint": SpendPointSchema,
  },
  apply(draft, command) {
    switch (command.type) {
      case "character.set":
        return setCharacter(draft, command);
      case "character.cred":
        return gainCred(draft, command.halves, command.reason, command.event);
      case "character.spendPoint":
        return spendPoint(draft, command);
      case "streetCred":
        return gainCred(draft, command.levels * 2, command.reason, command.event);
    }
  },
  rules: [streetCredRules],
});

export * from "./apply";
export * from "./prompt";
export * from "./schema";
