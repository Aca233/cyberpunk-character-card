import { describe, expect, it } from "vitest";
import { applyPlayerAction } from "../../actions";
import { fixedRng } from "../../kernel/rng";
import type { Command } from "../../kernel/system";
import type { WorldState } from "../../kernel/world";
import { registry } from "../registry";
import { PhoneStateSchema } from "./schema";

const context = { rng: fixedRng([]) };
function apply(world: WorldState, command: Command): WorldState {
  const result = registry.applyCommands(world, [command], context);
  expect(result.results[0]?.result).toMatchObject({ ok: true });
  return result.world;
}
function start() {
  return apply(registry.initialWorld(1000), {
    type: "npc.seed",
    id: "courier",
    name: "信使",
    pronoun: "她",
    role: "送货员",
    look: "灰色夹克",
    voice: "说话简短",
    want: "送完货",
    limit: "不送违禁品",
    met: true,
    canon: true,
  });
}

describe("通讯跟随人物实际生死", () => {
  it.each([
    { type: "phone.receive", from: "courier", text: "我到楼下了" },
    { type: "phone.call", from: "courier", about: "安排下一次送货" },
  ])("已经死亡的人不能继续发起通讯：$type", (command) => {
    const world = apply(start(), { type: "npcDeath", id: "courier", reason: "事故中死亡" });
    const result = registry.applyCommands(world, [command], context);
    expect(result.results[0]?.result.ok).toBe(false);
    expect(result.world).toEqual(world);
    expect(PhoneStateSchema.parse(result.world.slices.phone)).toMatchObject({
      messages: [],
      calls: [],
    });
  });

  it("来电后对方死亡，接通不会展开死人对话，仍可以拒接清掉提示", () => {
    let world = apply(start(), { type: "phone.call", from: "courier", about: "送货" });
    world = apply(world, { type: "npc.offscreenDeath", id: "courier", cause: "遭到袭击" });
    const answer = applyPlayerAction(world, { type: "answerCall", id: 1, answer: true }, context);
    expect(answer.ok).toBe(false);
    if (!answer.ok) expect(answer.reason).not.toContain("死");
    const declined = applyPlayerAction(
      world,
      { type: "answerCall", id: 1, answer: false },
      context,
    );
    expect(declined.ok).toBe(true);
    if (declined.ok) {
      expect(PhoneStateSchema.parse(declined.world.slices.phone).calls[0]?.status).toBe("declined");
    }
  });
});
