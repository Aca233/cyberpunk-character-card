import { describe, expect, it } from "vitest";
import type { WorldState } from "../../kernel/world";
import { InventoryStateSchema, ItemDefSchema } from "../../systems/inventory";
import { NpcSchema } from "../../systems/npc";
import { registry } from "../../systems/registry";
import { WorldClockStateSchema } from "../../systems/world";
import { buildExtractPrompt } from "./extract";

const tool = (id: string, name: string, ability: string) =>
  ItemDefSchema.parse({ id, name, ability, kind: "misc", price: 100 });
const data = {
  items: [
    tool("held-tool", "随身钳", "夹断铜线。"),
    tool("npc-tool", "维修探针", "探测线路断点。"),
    tool("shop-tool", "绝缘手套", "隔绝低压电流。"),
    tool("unused-tool", "磁性取件器", "吸出狭缝深处的金属件。"),
  ],
  cyberware: [
    {
      id: "optics-mk2",
      name: "测试义眼 MK.2",
      slot: "eyes",
      rarity: "common",
      price: 500,
      humanityCost: 0,
      ability: "读取探针投射的信号。",
    },
  ],
  shops: [{ id: "tools", name: "工具店", keeper: "老赵", location: "shop", shelf: ["shop-tool"] }],
  ripperdocs: [{ id: "doctor", name: "诊所", location: "clinic", shelf: ["optics-mk2"] }],
};

function worldAt(location: string): WorldState {
  const initial = registry.initialWorld(100);
  const clock = WorldClockStateSchema.parse(initial.slices.world);
  const inventory = InventoryStateSchema.parse(initial.slices.inventory);
  const npc = NpcSchema.parse({
    id: "technician",
    name: "老赵",
    pronoun: "他",
    role: "修理工",
    look: "沾着机油",
    voice: "直说",
    want: "修好门",
    limit: "不拆别人义体",
    affinity: 0,
    alive: true,
    met: true,
    location: "garage",
    lastSeenAt: null,
    memories: [],
    body: { gear: ["npc-tool"], cyberware: ["optics-mk2"] },
  });
  return {
    ...initial,
    slices: {
      ...initial.slices,
      world: { ...clock, location },
      inventory: { ...inventory, backpack: { "held-tool": 1 } },
      npc: { npcs: { technician: npc }, seedTags: {} },
    },
  };
}

function prompt(world: WorldState, narrative = "雨还没停，他点了点头。") {
  const result = buildExtractPrompt(
    world,
    [],
    { kind: "action", input: { text: "我等他回答。" } },
    { data },
    narrative,
  );
  return { system: result.messages[0]?.content ?? "", user: result.messages[1]?.content ?? "" };
}

describe("抽取目录按需展开能力，完整身份索引保留", () => {
  it("不在场物件仍可按索引引用，随身和在场人物装备带详情", () => {
    const { system, user } = prompt(worldAt("garage"));
    expect(system).toContain("unused-tool 磁性取件器");
    expect(system).toContain("optics-mk2 测试义眼 MK.2");
    expect(system).not.toContain("吸出狭缝深处的金属件。");
    expect(user).not.toContain("吸出狭缝深处的金属件。");
    expect(user).toContain("夹断铜线。");
    expect(user).toContain("npc-tool 维修探针：探测线路断点。");
    expect(user).toContain("optics-mk2 测试义眼 MK.2：读取探针投射的信号。");
  });

  it("当前店铺货架和医生货架展开，名称标点与大小写变化也能匹配", () => {
    expect(prompt(worldAt("shop")).user).toContain("shop-tool 绝缘手套：隔绝低压电流。");
    expect(prompt(worldAt("clinic")).user).toContain("读取探针投射的信号。");
    const mentioned = prompt(worldAt("street"), "他展示了测试义眼 mk 2 和磁性取件器。");
    expect(mentioned.user).toContain("读取探针投射的信号。");
    expect(mentioned.user).toContain("吸出狭缝深处的金属件。");
    expect(prompt(worldAt("street")).user).not.toContain("读取探针投射的信号。");
  });

  it("已交出的独立物件仍在索引中，提及时展开保存的定义", () => {
    const base = worldAt("street");
    const inventory = InventoryStateSchema.parse(base.slices.inventory);
    const world: WorldState = {
      ...base,
      slices: {
        ...base.slices,
        inventory: {
          ...inventory,
          objects: {
            token: {
              definition: tool("token", "划痕信物", "凭刻痕认出原主人。"),
              origin: "原主人赠送",
              holder: "npc:technician",
              location: "garage",
              changedAt: 20,
              lastChange: "交给老赵保管",
              remaining: null,
            },
          },
        },
      },
    };
    const result = prompt(world, "老赵把划痕信物还给你。");
    expect(result.system).toContain("token 划痕信物");
    expect(result.user).toContain("token 划痕信物：凭刻痕认出原主人。");
    expect(result.system).toContain("不是存在资格白名单");
  });
});
