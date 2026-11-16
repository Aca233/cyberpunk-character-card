import { describe, expect, it } from "vitest";
import { falloutKinds } from "./apply";

describe("神经状态后果归类", () => {
  it("已发生症状计入后果，恢复和废弃扣点不计入", () => {
    expect(
      falloutKinds(
        [
          {
            type: "humanity",
            action: "affect",
            id: "tremor",
            stage: "unstable",
            symptom: "手部震颤",
            reason: "设备反馈失调",
          },
        ],
        false,
      ),
    ).toEqual(["humanity"]);
    expect(
      falloutKinds(
        [{ type: "humanity", action: "recover", id: "tremor", reason: "校准后缓解" }],
        false,
      ),
    ).toEqual([]);
    expect(falloutKinds([{ type: "humanity", delta: -10, reason: "废弃数值" }], false)).toEqual([]);
  });
});
