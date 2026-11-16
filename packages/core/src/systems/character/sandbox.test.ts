import { describe, expect, it } from "vitest";
import { createRegistry } from "../../kernel/system";
import { character } from "./index";
import { applyFlashback, tickFlashback } from "./flashback";
import { setCharacter, setBonuses } from "./apply";

describe("角色经历不靠配额和属性成长", () => {
  it("同一段过往能重访，多次交互不会强制结束或丢失确认事实", () => {
    const state = character.initial();
    state.traits.push({ slot: "past", label: "旧工厂", ability: "熟悉地下车间" });
    expect(applyFlashback(state, { type: "flashback", action: "start", past: "旧工厂" }, 0).ok).toBe(true);
    for (let i = 0; i < 10; i++) tickFlashback(state);
    expect(state.flashback?.turns).toBe(10);
    applyFlashback(state, { type: "flashback", action: "end", fact: "钥匙交给了阿黎" }, 0);
    expect(applyFlashback(state, { type: "flashback", action: "start", past: "旧工厂" }, 10).ok).toBe(true);
    expect(state.pastFacts).toEqual([{ past: "旧工厂", text: "钥匙交给了阿黎" }]);
  });
  it("角色和义体属性不再发出生命上限指令，属性加点入口已删除", () => {
    const state = character.initial();
    const outcome = setCharacter(state, { type: "character.set", name: "V", brief: "", attributes: { body: 10, reflexes: 3, tech: 3, intelligence: 3, cool: 3 }, streetCred: 1 });
    expect(outcome).toEqual({ ok: true });
    expect(setBonuses(state, { type: "character.setBonuses", bonuses: { body: 3 } })).toEqual({ ok: true });
    expect(createRegistry([character]).actionTypes()).not.toContain("spendPoint");
  });
});
