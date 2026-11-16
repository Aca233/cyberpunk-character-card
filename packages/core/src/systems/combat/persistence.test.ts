import { describe, expect, it } from "vitest";
import { fixedRng } from "../../kernel/rng";
import type { Command } from "../../kernel/system";
import { InventoryStateSchema } from "../inventory";
import { NpcSchema, NpcStateSchema } from "../npc";
import { registry } from "../registry";
import { CombatStateSchema } from "./schema";
import { combatView } from "./view";

const data = {
  items: [
    {
      id: "known-gun",
      name: "旧枪",
      kind: "weapon",
      category: "pistol",
      attribute: "cool",
      weaponType: "power",
    },
    { id: "key", name: "仓库钥匙", kind: "misc" },
  ],
  locations: [
    { id: "warehouse", name: "仓库", district: "沃森" },
    { id: "street", name: "街道", district: "沃森" },
  ],
};
const ctx = { rng: fixedRng([]), data };
const start = {
  type: "combat",
  action: "start",
  foes: [{ name: "护卫", npc: "guard", archetype: "gunner", tier: "legend" }],
};
const down = { type: "combat", action: "foe", target: "guard", state: "down" };
const end = { type: "combat", action: "end", witnesses: 0, cameras: false };
const take = (item: string): Command => ({ type: "combat", action: "loot", target: "guard", item });
function initial(gear = ["known-gun", "key"]) {
  const base = registry.initialWorld(0);
  const guard = NpcSchema.parse({
    id: "guard",
    name: "护卫",
    pronoun: "他",
    role: "仓库护卫",
    look: "破旧夹克",
    voice: "低沉",
    want: "守住仓库",
    limit: "失去岗位",
    affinity: 0,
    alive: true,
    met: true,
    location: "warehouse",
    lastSeenAt: 0,
    memories: [],
    body: { gear, cyberware: [] },
  });
  return {
    ...base,
    slices: {
      ...base.slices,
      npc: { npcs: { guard } },
      world: { ...(base.slices.world as object), location: "warehouse" },
    },
  };
}

describe("财物随人物和地点持续存在", () => {
  it("已有卡人物不开战抽装备；拾取与人物失去装备同一事务，重开不能复制", () => {
    const began = registry.applyCommands(initial(), [start, down], ctx);
    expect(began.results.every((r) => r.result.ok)).toBe(true);
    expect(CombatStateSchema.parse(began.world.slices.combat).active?.foes[0]?.carry).toEqual([
      "known-gun",
      "key",
    ]);
    const looted = registry.applyCommands(began.world, [take("known-gun")], ctx);
    expect(looted.results[0]?.result.ok).toBe(true);
    expect(NpcStateSchema.parse(looted.world.slices.npc).npcs.guard?.body?.gear).toEqual(["key"]);
    expect(InventoryStateSchema.parse(looted.world.slices.inventory).backpack["known-gun"]).toBe(1);
    const again = registry.applyCommands(looted.world, [end, start, down, take("known-gun")], ctx);
    expect(again.results.at(-1)?.result.ok).toBe(false);
    expect(NpcStateSchema.parse(again.world.slices.npc).npcs.guard?.vitals?.condition).toBe("down");
    expect(CombatStateSchema.parse(again.world.slices.combat).active?.foes[0]?.state).toBe("down");
    expect(CombatStateSchema.parse(again.world.slices.combat).active?.foes[0]?.carry).toEqual([
      "key",
    ]);
    expect(InventoryStateSchema.parse(again.world.slices.inventory).backpack["known-gun"]).toBe(1);
  });

  it("同一个独立物件由人物持有时可通过冲突拾取，转移只结算一次", () => {
    const unique = { id: "one-key", name: "唯一钥匙", kind: "misc", iconic: false };
    const first = registry.applyCommands(
      initial([]),
      [
        {
          type: "item",
          action: "gain",
          id: unique.id,
          definition: unique,
          origin: "屋主给的唯一一把钥匙",
          reason: "收下",
        },
        { type: "item", action: "lose", id: unique.id, recipient: "guard", reason: "交给护卫保管" },
        start,
        down,
        take(unique.id),
      ],
      ctx,
    );
    expect(first.results.every((r) => r.result.ok)).toBe(true);
    expect(NpcStateSchema.parse(first.world.slices.npc).npcs.guard?.body?.gear).toEqual([]);
    expect(InventoryStateSchema.parse(first.world.slices.inventory).backpack[unique.id]).toBe(1);
  });

  it("空装备的人不会因身份或稀有度生成武器", () => {
    const result = registry.applyCommands(initial([]), [start], ctx);
    expect(result.results[0]?.result.ok).toBe(true);
    expect(CombatStateSchema.parse(result.world.slices.combat).active?.foes[0]?.carry).toEqual([]);
  });

  it("另一场冲突不会消除遗物；异地不可见也不可隔空拾取，返回后可取", () => {
    const first = registry.applyCommands(initial(), [start, down, end], ctx).world;
    const moved = {
      ...first,
      slices: { ...first.slices, world: { ...(first.slices.world as object), location: "street" } },
    };
    const next = registry.applyCommands(
      moved,
      [
        {
          type: "combat",
          action: "start",
          foes: [{ name: "路边袭击者", archetype: "gunner", tier: "street" }],
        },
        end,
      ],
      { rng: fixedRng([1]), data },
    ).world;
    expect(CombatStateSchema.parse(next.slices.combat).groundLoot).toHaveLength(1);
    expect(combatView({ world: next, data, records: [] }).loot).toEqual([]);
    expect(registry.applyCommands(next, [take("key")], ctx).results[0]?.result.ok).toBe(false);
    const returned = {
      ...next,
      slices: {
        ...next.slices,
        world: { ...(next.slices.world as object), location: "warehouse" },
      },
    };
    expect(combatView({ world: returned, data, records: [] }).loot).toHaveLength(1);
    const result = registry.applyCommands(returned, [take("key")], ctx);
    expect(result.results[0]?.result.ok).toBe(true);
    expect(NpcStateSchema.parse(result.world.slices.npc).npcs.guard?.body?.gear).toEqual([
      "known-gun",
    ]);
  });

  it("物件已被别人取走时拒绝陈旧拾取，不凭快照复制", () => {
    const first = registry.applyCommands(
      initial(),
      [start, down, end, { type: "npcGear", id: "guard", action: "remove", item: "key" }],
      ctx,
    ).world;
    const result = registry.applyCommands(first, [take("key")], ctx);
    expect(result.results[0]?.result.ok).toBe(false);
    expect(result.world).toEqual(first);
    expect(combatView({ world: first, data, records: [] }).loot[0]?.items.map((i) => i.id)).toEqual(
      ["known-gun"],
    );
  });

  it("死者遗物可以真实转移，空身尸体不能重复搜出同一物件", () => {
    const first = registry.applyCommands(initial(), [start, down, end], ctx).world;
    const npcs = NpcStateSchema.parse(first.slices.npc);
    const dead = {
      ...first,
      slices: {
        ...first.slices,
        npc: { npcs: { ...npcs.npcs, guard: { ...npcs.npcs.guard, alive: false } } },
      },
    };
    const looted = registry.applyCommands(dead, [take("key")], ctx);
    expect(looted.results[0]?.result.ok).toBe(true);
    expect(NpcStateSchema.parse(looted.world.slices.npc).npcs.guard?.body?.gear).toEqual([
      "known-gun",
    ]);
    expect(registry.applyCommands(looted.world, [take("key")], ctx).results[0]?.result.ok).toBe(
      false,
    );
  });

  it("冲突中确认死亡同步人物存活状态，不能下次重新站起开战", () => {
    const result = registry.applyCommands(
      initial(),
      [start, { type: "combat", action: "foe", target: "guard", state: "dead" }, end],
      { rng: fixedRng([1, 1, 1]), data },
    );
    expect(result.results.every((r) => r.result.ok)).toBe(true);
    expect(NpcStateSchema.parse(result.world.slices.npc).npcs.guard?.alive).toBe(false);
    expect(registry.applyCommands(result.world, [start], ctx).results[0]?.result.ok).toBe(false);
    expect(registry.applyCommands(result.world, [take("key")], ctx).results[0]?.result.ok).toBe(
      true,
    );
  });

  it("原主人带着物件离开后，旧地点不能凭遗留记录复制其财物", () => {
    const first = registry.applyCommands(initial(), [start, down, end], ctx).world;
    const npcs = NpcStateSchema.parse(first.slices.npc);
    const left = {
      ...first,
      slices: {
        ...first.slices,
        npc: { npcs: { ...npcs.npcs, guard: { ...npcs.npcs.guard, location: "street" } } },
      },
    };
    expect(combatView({ world: left, data, records: [] }).loot).toEqual([]);
    expect(registry.applyCommands(left, [take("key")], ctx).results[0]?.result.ok).toBe(false);
  });
});
