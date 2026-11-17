import { describe, expect, it } from "vitest";
import { fixedRng } from "../../kernel/rng";
import type { Command } from "../../kernel/system";
import type { WorldState } from "../../kernel/world";
import { HeatStateSchema } from "../heat";
import { registry } from "../registry";
import { stealthView } from "./view";

const data = {
  locations: [
    { id: "warehouse", name: "仓库", district: "沃森" },
    { id: "bar", name: "酒吧", district: "沃森" },
  ],
};
const context = (facts: Record<string, unknown> = {}) => ({ data, rng: fixedRng([]), facts });
function start() {
  const world = registry.initialWorld(1000);
  return {
    ...world,
    slices: {
      ...world.slices,
      world: { ...(world.slices.world as object), location: "warehouse" },
    },
  };
}
function run(world: WorldState, command: Command, facts: Record<string, unknown> = {}) {
  const result = registry.applyCommands(world, [command], context(facts));
  expect(result.results[0]?.result).toMatchObject({ ok: true });
  return result.world;
}
const view = (world: WorldState) => stealthView({ world, data, records: [] });
const alert = (delta: number, reason: string) => ({ type: "alert", delta, reason });

describe("警戒持续记录现场事实", () => {
  it("同地点切场不清除警戒，也不凭空向警方上报", () => {
    let world = run(start(), alert(2, "仓库内部传感器报告异常，守卫搜索但未通知警方"));
    const beforeHeat = HeatStateSchema.parse(world.slices.heat);
    world = run(world, { type: "world.endScene" });
    expect(view(world)).toMatchObject({ level: 2, peak: 2 });
    expect(HeatStateSchema.parse(world.slices.heat)).toEqual(beforeHeat);
  });

  it("未上报警方的内部搜索反复切场仍不产生通缉星", () => {
    let world = run(start(), alert(2, "内部搜索，通讯尚未发出"));
    for (let i = 0; i < 3; i += 1) world = run(world, { type: "world.endScene" });
    expect(HeatStateSchema.parse(world.slices.heat).stars).toBe(0);
  });

  it("实际停火和两次解除依据可以连续降低警戒，不受每场额度限制", () => {
    let world = run(start(), alert(3, "守卫发现入侵者并交火"));
    world = run(world, alert(-1, "双方实际停火，守卫转为搜索离开的入侵者"));
    world = run(world, alert(-1, "监控确认错误身份，守卫撤回封锁线"));
    world = run(world, alert(-1, "负责人确认警报误报，解除现场戒备"));
    expect(view(world).level).toBe(0);
  });

  it("离开仓库不把警戒带到酒吧，读档后返回仓库仍保留原现场警戒", () => {
    let world = run(start(), alert(2, "守卫搜索仓库"));
    world = run(world, { type: "world", activity: "travel", location: "bar" });
    expect(view(world).level).toBe(0);
    world = run(world, alert(1, "酒保发现门锁被撬"));
    world = run(JSON.parse(JSON.stringify(world)), {
      type: "world",
      activity: "travel",
      location: "warehouse",
    });
    expect(view(world).level).toBe(2);
  });

  it("同轮离场后的警戒默认属于行动开始现场，显式地点可以记录目的地", () => {
    let world = run(start(), { type: "world", activity: "travel", location: "bar" });
    world = run(world, alert(2, "刚离开的仓库保安发现撬锁痕迹"), {
      actionStartLocation: "warehouse",
    });
    expect(view(world).level).toBe(0);
    world = run(
      world,
      { ...alert(1, "酒吧门卫注意到异常"), location: "bar" },
      { actionStartLocation: "warehouse" },
    );
    expect(view(world).level).toBe(1);
    world = run(world, { type: "world", activity: "travel", location: "warehouse" });
    expect(view(world).level).toBe(2);
  });

  it("拒绝凭空写入未知地点，边界拒绝不改原现场状态", () => {
    const world = start();
    for (const command of [
      { ...alert(1, "无实际地点"), location: "nonexistent" },
      alert(-1, "未起疑的地点无法再降低"),
    ]) {
      const result = registry.applyCommands(world, [command], context());
      expect(result.results[0]?.result.ok).toBe(false);
      expect(result.world).toEqual(world);
    }
  });
});
