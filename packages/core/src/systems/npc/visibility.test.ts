import { describe, expect, it } from "vitest";
import { fixedRng } from "../../kernel/rng";
import type { Command } from "../../kernel/system";
import type { WorldState } from "../../kernel/world";
import { registry } from "../registry";
import { NpcStateSchema } from "./schema";
import { npcsView } from "./view";

const data = {
  locations: [
    { id: "office", name: "办公室", district: "沃森" },
    { id: "depot", name: "秘密仓库", district: "沃森" },
    { id: "street", name: "街口", district: "沃森" },
  ],
};
const context = { data, rng: fixedRng([]) };

function apply(world: WorldState, command: Command): WorldState {
  const result = registry.applyCommands(world, [command], context);
  expect(result.results[0]?.result).toMatchObject({ ok: true });
  return result.world;
}

function start(met = true): WorldState {
  let world = apply(registry.initialWorld(1000), {
    type: "npc.seed",
    id: "liaison",
    name: "林澄",
    pronoun: "她",
    role: "公关顾问",
    look: "戴细框眼镜",
    voice: "礼貌的短句",
    want: "寻找客户",
    limit: "不暴露雇主",
    home: "office",
    met,
  });
  world = {
    ...world,
    slices: {
      ...world.slices,
      world: { ...(world.slices.world as object), location: "street", sceneStartedAt: 1050 },
    },
  };
  return world;
}

const visible = (world: WorldState) => npcsView({ world, data, records: [] })[0];

describe("人物地图与近况的玩家知情边界", () => {
  it("幕后移动和秘密行动持久保存，但人物面板仍只显示已知地点和公开近况", () => {
    let world = apply(start(), {
      type: "doing",
      id: "liaison",
      text: "最近在整理客户档案",
      location: "office",
    });
    world = apply(
      { ...world, time: 1100 },
      {
        type: "npc.offscreenDoing",
        id: "liaison",
        text: "去秘密仓库出售客户名单",
        location: "depot",
      },
    );
    world = JSON.parse(JSON.stringify(world));
    expect(NpcStateSchema.parse(world.slices.npc).npcs.liaison).toMatchObject({
      location: "depot",
      doing: { text: "去秘密仓库出售客户名单" },
    });
    expect(visible(world)).toMatchObject({
      lastPlace: "办公室",
      placeId: "office",
      doing: "最近在整理客户档案",
      here: false,
    });
    expect(JSON.stringify(visible(world))).not.toContain("秘密仓库");
  });

  it("公开消息只透露在做什么，不会顺带揭露幕后实际地点；明确透露地点后才更新", () => {
    let world = apply(start(), {
      type: "npc.offscreenDoing",
      id: "liaison",
      text: "正在查一份走私记录",
      location: "depot",
    });
    world = apply(world, { type: "doing", id: "liaison", text: "正在查一份走私记录" });
    expect(visible(world)).toMatchObject({ placeId: "office", doing: "正在查一份走私记录" });
    world = apply(world, {
      type: "doing",
      id: "liaison",
      text: "正在查一份走私记录",
      location: "depot",
    });
    expect(visible(world)).toMatchObject({ placeId: "depot", lastPlace: "秘密仓库" });
  });

  it("再次见面只确认人物位置，不自动公开她此前的秘密行动", () => {
    let world = apply(start(), {
      type: "npc.offscreenDoing",
      id: "liaison",
      text: "把证据卖给秘密雇主",
      location: "depot",
    });
    world = apply({ ...world, time: 1100 }, { type: "meet", id: "liaison", location: "street" });
    expect(visible(world)).toMatchObject({ here: true, placeId: "street", doing: null });
  });

  it("只听说过的人与玩家在同地，也不能直接显示已在场", () => {
    let world = apply(start(false), {
      type: "learn",
      id: "liaison",
      text: "听说她替公司办事",
      source: "rumor",
    });
    world = apply(world, {
      type: "npc.offscreenDoing",
      id: "liaison",
      text: "在街口等秘密买家",
      location: "street",
    });
    expect(visible(world)).toMatchObject({ met: false, here: false, placeId: null, doing: null });
  });
});
