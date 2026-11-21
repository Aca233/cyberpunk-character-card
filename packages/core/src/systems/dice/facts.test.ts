import { describe, expect, it } from "vitest";
import { memberDeathBlocked, rulingFact } from "./facts";

describe("现场事实约束", () => {
  it("同行者死亡只接受已确认的致命危机，骰子失败不能替代依据", () => {
    expect(
      memberDeathBlocked({ check: { outcome: "failure", failure: "杰克会死" } }, ["杰克"]),
    ).toContain("致命危机");
    expect(
      memberDeathBlocked({ ruling: { id: "scene-1", kind: "costly", harm: "heavy" } }, ["杰克"]),
    ).toBeDefined();
    expect(
      memberDeathBlocked({ ruling: { id: "scene-1", kind: "costly", harm: "lethal" } }, ["杰克"]),
    ).toBeUndefined();
  });
  it("破损的裁决事实不会被当成有效状态", () => {
    expect(rulingFact({ ruling: { id: "", harm: "invented" } })).toBeUndefined();
  });
});
