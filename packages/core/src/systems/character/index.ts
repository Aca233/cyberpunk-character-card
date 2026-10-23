import { defineSystem } from "../../kernel/system";
import { maxHp } from "../dice";
import {
  type CharacterState,
  CharacterStateSchema,
  type SetCharacter,
  SetCharacterSchema,
} from "./schema";

/** 角色的名字、简介、属性和街头声望；M1 只在建档时写入，成长在之后的阶段 */
export const character = defineSystem<CharacterState, never, SetCharacter>({
  id: "character",
  dependsOn: ["health"],
  state: CharacterStateSchema,
  initial: () => ({
    name: null,
    brief: "",
    attributes: { body: 3, reflexes: 3, tech: 3, intelligence: 3, cool: 3 },
    streetCred: 1,
  }),
  commands: {},
  internal: { "character.set": SetCharacterSchema },
  apply(draft, command) {
    draft.name = command.name;
    draft.brief = command.brief;
    draft.attributes = { ...command.attributes };
    draft.streetCred = command.streetCred;
    return {
      ok: true,
      emit: [{ type: "health.setMax", max: maxHp(command.attributes.body, command.streetCred) }],
    };
  },
});

export * from "./schema";
