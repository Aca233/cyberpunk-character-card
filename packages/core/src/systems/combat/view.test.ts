import { describe, expect, it } from "vitest";
import { CombatStateSchema } from "./schema";
import { combatStatus } from "./status";
import { combatView } from "./view";

function project(slice: unknown) {
  return combatView({
    world: { time: 0, slices: { combat: slice } },
    records: [],
    data: {},
  });
}

describe("战利品投影", () => {
  it.each(["up", "down", "dead", "fled"] as const)("%s 只在倒下或死亡时展示可拾取物", (state) => {
    const view = project({
      active: {
        startedAt: 0,
        district: "沃森",
        foes: [
          {
            id: "foe1",
            name: "枪手",
            npc: null,
            gang: null,
            archetype: "gunner",
            tier: "street",
            state,
            carry: ["unity"],
          },
        ],
      },
      last: null,
    });
    const available = state === "down" || state === "dead";
    expect(view.active?.foes[0]?.carry).toEqual(available ? [{ id: "unity", name: "unity" }] : []);
    const text = combatStatus
      .flatMap((s) =>
        s.lines({
          views: { combat: view },
        }),
      )
      .join("\n");
    if (available) expect(text).toContain("能捡");
    else expect(text).not.toContain("能捡");
  });
});

describe("伤疤的投影和状态提示", () => {
  it.each([
    ["graze", false, "没处理，自然长好不留疤"],
    ["heavy", false, "尚未处理，深层创伤不能仅靠切场或休息消失"],
    ["lethal", false, "尚未处理，深层创伤不能仅靠切场或休息消失"],
    ["heavy", true, "处理过了"],
  ] as const)("%s 处理状态 %s 的提示符合恢复规则", (tier, treated, care) => {
    const view = project(
      CombatStateSchema.parse({
        active: null,
        last: null,
        wounds: [
          {
            id: "w1",
            by: "枪手",
            gang: null,
            weapon: "霰弹枪",
            part: "left-arm",
            tier,
            at: 0,
            district: "沃森",
            healsAt: 1440,
            treated,
          },
        ],
      }),
    );
    const text = combatStatus
      .flatMap((s) =>
        s.lines({
          views: { combat: view },
        }),
      )
      .join("\n");
    expect(text).toContain(care);
    expect(text).toContain("还要 1 天");
    expect(text).toContain("处理后仍需等待恢复");
    expect(text).not.toContain("治好发");
    if (treated || tier === "graze") expect(text).not.toContain("长好会留疤");
  });
  it.each(["沃森", null])("保留疤痕地区 %s，不编造未知地区", (district) => {
    const state = CombatStateSchema.parse({
      active: null,
      last: null,
      scars: [
        {
          by: "枪手",
          gang: null,
          weapon: "霰弹枪",
          part: "left-arm",
          at: 0,
          ...(district === null ? {} : { district }),
        },
      ],
    });
    const view = project(state);
    expect(view.scars[0]?.district).toBe(district);
    const text = combatStatus
      .flatMap((s) =>
        s.lines({
          views: { combat: view },
        }),
      )
      .join("\n");
    expect(text).toContain("左臂上枪手的霰弹枪留的疤");
    if (district) expect(text).toContain("（在沃森留下）");
    else expect(text).not.toContain("留下）");
  });
});
